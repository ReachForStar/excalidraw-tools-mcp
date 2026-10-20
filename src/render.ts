/**
 * Excalidraw-native scene rendering. Excalidraw's own export runs in a local
 * headless Chrome, so hand-drawn texture, embedded images, font subsetting and
 * wrapped text match what the web app produces. A browser is required because
 * the export path measures text and rasterizes through a real canvas.
 *
 * The browser is started lazily and reused; call {@link closeRenderer} when the
 * host shuts down so the process can exit.
 * @module excalidraw-mcp/render
 */

import { createServer } from 'node:http'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright-core'

const require = createRequire(import.meta.url)

/** Supported output formats. */
export type RenderFormat = 'svg' | 'png'

/** Scene data handed to Excalidraw's exporter. */
export interface RenderScene {
  readonly elements: readonly unknown[]
  readonly appState: Record<string, unknown>
  readonly files?: Record<string, unknown>
}

/** Options for one render. */
export interface RenderOptions {
  readonly format: RenderFormat
  /** Output scale for PNG; 1 keeps Excalidraw's natural pixel size. */
  readonly scale: number
  readonly transparent: boolean
  /** Background color, or null for the Excalidraw default. */
  readonly background: string | null
}

/** Rendered bytes plus the image dimensions. */
export interface RenderedScene {
  readonly data: Buffer
  readonly width: number
  readonly height: number
}

/** Browser-side bridge installed by {@link BRIDGE_HTML}. */
interface Bridge {
  svg(payload: BridgePayload): Promise<{ svg: string; width: number; height: number }>
  png(payload: BridgePayload): Promise<{ base64: string; width: number; height: number }>
}

/** Payload shape the bridge expects. */
interface BridgePayload {
  elements: readonly unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown> | null
  scale: number
  transparent: boolean
  background: string | null
}

/**
 * Bridge page. Excalidraw's export functions come straight from the package, so
 * the rendering pipeline is the official one; the page only adapts the JSON
 * payload and serializes results.
 */
const BRIDGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script type="module">
import { exportToSvg, exportToBlob, MIME_TYPES } from '/utils.js'

function dataOf(payload) {
  return {
    elements: payload.elements,
    appState: {
      exportBackground: !payload.transparent,
      viewBackgroundColor: payload.background || '#ffffff',
      exportWithDarkMode: false,
      exportPadding: 10,
      exportScale: payload.scale,
    },
    files: payload.files || null,
  }
}

window.excalidrawBridge = {
  async svg(payload) {
    const el = await exportToSvg({ data: dataOf(payload), config: { exportPadding: 10 } })
    return { svg: el.outerHTML, width: el.width.baseVal.value, height: el.height.baseVal.value }
  },
  async png(payload) {
    const blob = await exportToBlob({
      data: dataOf(payload),
      config: {
        mimeType: MIME_TYPES.png,
        scale: payload.scale,
        padding: 10,
        canvasBackgroundColor: payload.transparent ? false : (payload.background || '#ffffff'),
      },
    })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let text = ''
    for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i])
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return { base64: btoa(text), ...size }
  },
}

window.__bridgeReady = true
</script>
</body></html>`

/** Known Chrome/Chromium locations per platform. */
function chromeCandidates(env: NodeJS.ProcessEnv): string[] {
  const windowsRoots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']]
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
  const windows = windowsRoots.flatMap(root => [
    join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    case 'win32':
      return windows
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ]
  }
}

/** Readable file check that never throws. */
async function isFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Locate a Chrome/Chromium executable for rendering.
 * @param env - environment to read `EXCALIDRAW_CHROME` from (also accepts a PATH list).
 * @returns the executable path.
 * @throws when nothing usable is installed, so the caller can tell the operator
 * to install a browser instead of silently degrading output.
 */
export async function findChrome(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const override = env['EXCALIDRAW_CHROME']?.trim()
  if (override !== undefined && override.length > 0) {
    for (const candidate of override.split(delimiter).filter(entry => entry.length > 0)) {
      if (await isFile(candidate)) return candidate
    }
    throw new Error(`EXCALIDRAW_CHROME does not point to an executable: ${override}`)
  }
  for (const candidate of chromeCandidates(env)) {
    if (await isFile(candidate)) return candidate
  }
  throw new Error(
    'Excalidraw export needs a local Chrome/Chromium — install Google Chrome '
    + 'or set EXCALIDRAW_CHROME to the browser executable',
  )
}

/** Absolute path of the Excalidraw export bundle shipped by `@excalidraw/utils`. */
function bundlePath(): string {
  return require.resolve('@excalidraw/utils')
}

/** Serve the bridge page and the export bundle to the headless browser. */
async function startAssetServer(): Promise<{ url: string; close: () => Promise<void> }> {
  let bundle: Promise<Buffer> | undefined
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/utils.js') {
      bundle ??= readFile(bundlePath()).then(buffer => buffer)
      void bundle.then((buffer) => {
        res.writeHead(200, { 'content-type': 'text/javascript', 'content-length': buffer.length })
        res.end(buffer)
      }, (error: unknown) => {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(error instanceof Error ? error.message : String(error))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(BRIDGE_HTML)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
      server.closeAllConnections()
    }),
  }
}

/** Reject after `ms` so a stuck render cannot hang a tool call forever. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)
    work.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (error: unknown) => {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

/** A running headless browser bound to one bridge page. */
class Renderer {
  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly assets: { close: () => Promise<void> },
  ) {}

  /** Launch the browser and open the bridge page. */
  static async start(): Promise<Renderer> {
    const executablePath = await findChrome()
    const assets = await startAssetServer()
    // Root shells (containers) cannot use Chrome's sandbox unless it is set up.
    const args = ['--disable-dev-shm-usage']
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox')
    let browser: Browser | undefined
    try {
      browser = await chromium.launch({ executablePath, headless: true, args })
      const page = await browser.newPage()
      await withTimeout(page.goto(assets.url, { waitUntil: 'load' }), 30_000, 'loading the Excalidraw export bridge')
      await withTimeout(
        page.waitForFunction(() => (globalThis as { __bridgeReady?: boolean }).__bridgeReady === true),
        30_000,
        'starting the Excalidraw export bridge',
      )
      return new Renderer(browser, page, assets)
    } catch (error) {
      await browser?.close().catch(() => undefined)
      await assets.close().catch(() => undefined)
      throw error
    }
  }

  /** Render one scene. */
  async render(scene: RenderScene, options: RenderOptions): Promise<RenderedScene> {
    const payload: BridgePayload = {
      elements: scene.elements,
      appState: scene.appState,
      files: scene.files ?? null,
      scale: options.scale,
      transparent: options.transparent,
      background: options.background,
    }
    if (options.format === 'svg') {
      const result = await withTimeout(
        this.page.evaluate(
          async (data: BridgePayload) => (globalThis as unknown as { excalidrawBridge: Bridge })
            .excalidrawBridge.svg(data),
          payload,
        ),
        120_000,
        'rendering the scene to SVG',
      )
      return { data: Buffer.from(result.svg, 'utf8'), width: result.width, height: result.height }
    }
    const result = await withTimeout(
      this.page.evaluate(
        async (data: BridgePayload) => (globalThis as unknown as { excalidrawBridge: Bridge })
          .excalidrawBridge.png(data),
        payload,
      ),
      120_000,
      'rendering the scene to PNG',
    )
    return { data: Buffer.from(result.base64, 'base64'), width: result.width, height: result.height }
  }

  /** Close the page, the asset server, and the browser. */
  async close(): Promise<void> {
    await this.page.close().catch(() => undefined)
    await this.browser.close().catch(() => undefined)
    await this.assets.close().catch(() => undefined)
  }
}

/** Shared renderer, created on first use. */
let shared: Promise<Renderer> | undefined
/** Renders are serialized: one page, and font/canvas state is global to it. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Render a scene with Excalidraw's own exporter.
 * @param scene - elements, app state, and binary files.
 * @param options - format, scale, and background handling.
 * @returns the rendered bytes and image dimensions.
 */
export async function renderScene(scene: RenderScene, options: RenderOptions): Promise<RenderedScene> {
  const run = async (): Promise<RenderedScene> => {
    try {
      shared ??= Renderer.start()
      return await (await shared).render(scene, options)
    } catch (error) {
      // A broken browser must not poison later calls: drop it and retry once.
      const current = shared
      shared = undefined
      await current?.then(renderer => renderer.close(), () => undefined)
      throw error
    }
  }
  const pending = queue.then(run, run)
  queue = pending.catch(() => undefined)
  return pending
}

/** Stop the shared browser; safe to call when nothing was started. */
export async function closeRenderer(): Promise<void> {
  const current = shared
  shared = undefined
  if (current === undefined) return
  await current.then(renderer => renderer.close(), () => undefined)
}

/** Directory of the export bundle, for diagnostics. */
export const BUNDLE_DIRECTORY = dirname(bundlePath())
