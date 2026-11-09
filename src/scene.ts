/**
 * Excalidraw scene core. Pure node-side scene logic shared by every surface:
 * the cordis plugin (`src/index.ts`) and the MCP server (`src/mcp.ts`). No host
 * framework imports here, so the MCP entry can run standalone.
 *
 * A scene is the object Excalidraw persists (`{ elements, appState, files? }`).
 * The default drawing is the workspace file
 * `<workspace>/.agents/excalidraw/scene.json`; named drawings live next to it
 * under `drawings/<id>.json`. Scenes can be exported to and imported from
 * native `.excalidraw` files, and a caller-supplied path can never leave the
 * workspace.
 * @module excalidraw-mcp/scene
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Fixed scene directory shared by every agent in a workspace. */
export const SCENE_DIRECTORY = join('.agents', 'excalidraw')

/** Relative scene file of the default drawing inside a workspace. */
export const SCENE_RELATIVE = join(SCENE_DIRECTORY, 'scene.json')

/** Directory holding named drawings (`<id>.json`). */
export const DRAWINGS_DIRECTORY = join(SCENE_DIRECTORY, 'drawings')
/** Directory holding native `.excalidraw` exports of named drawings. */
export const EXPORT_DIRECTORY = join(SCENE_DIRECTORY, 'exports')
/** Directory holding screenshots of named drawings. */
export const SCREENSHOT_DIRECTORY = join(SCENE_DIRECTORY, 'screenshots')

/** Identifier of the drawing backed by `scene.json`. */
export const DEFAULT_DRAWING_ID = 'default'

/** Default SVG export path inside a workspace. */
export const DEFAULT_EXPORT_RELATIVE = join(SCENE_DIRECTORY, 'export.svg')
/** Default destination for PNG exports. */
export const DEFAULT_EXPORT_PNG_RELATIVE = join(SCENE_DIRECTORY, 'export.png')
/** Default destination for native Excalidraw file exports. */
export const DEFAULT_EXPORT_FILE_RELATIVE = join(SCENE_DIRECTORY, 'export.excalidraw')
/** Default screenshot path of the default drawing. */
export const DEFAULT_SCREENSHOT_RELATIVE = join(SCENE_DIRECTORY, 'screenshot.png')

/** Version of the native Excalidraw file format written by `exportScene`. */
export const EXCALIDRAW_FILE_VERSION = 2
/** `source` field of exported `.excalidraw` files. */
export const EXCALIDRAW_FILE_SOURCE = 'https://github.com/ReachForStar/excalidraw-tools'

/** Cap for the full scene JSON echoed back to the caller (keeps context sane). */
export const READ_FULL_JSON_MAX_BYTES = 128 * 1024
/** Cap for the number of elements a single draw call may add. */
export const DRAW_MAX_ELEMENTS = 256
/** Upper bound on the preview SVG embedded in a tool result (64 KiB). */
export const PREVIEW_SVG_MAX_BYTES = 64 * 1024
/** Upper bound on the structured canvas description (64 KiB). */
export const DESCRIPTION_MAX_BYTES = 64 * 1024
/** Elements listed in a structured description before it is summarized. */
export const DESCRIPTION_MAX_ELEMENTS = 300
/** Upper bound on one screenshot PNG; larger renders must lower `scale`. */
export const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024

/** Lossless JSON value, structurally identical to the host's `JsonValue`. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Scene summary shape returned to the caller. */
export interface SceneSummary {
  readonly elementCount: number
  readonly byType: Record<string, number>
  readonly textElements: Record<string, JsonValue>[]
  readonly theme: string
  readonly viewBackgroundColor: string
}

/** Empty scene summary for a missing or corrupt scene file. */
export const EMPTY_SUMMARY: SceneSummary = {
  elementCount: 0,
  byType: {},
  textElements: [],
  theme: 'light',
  viewBackgroundColor: 'transparent',
}

/** Where a scene lives: the workspace root that bounds exports, and the scene file. */
export interface SceneTarget {
  readonly workspace: string
  readonly scenePath: string
  /** Drawing identifier; `default` maps to `scene.json`. */
  readonly drawing: string
}

/** Compact element entry returned by `readScene`. */
export type CompactElement = Record<string, JsonValue>

/** Result of `readScene`. */
export interface ReadResult {
  cwd: string
  drawing: string
  /** Absolute path of the scene file. */
  path: string
  exists: boolean
  summary: SceneSummary
  elements: CompactElement[]
  /** Structured text description of the visible canvas. */
  description: string
  /** Complete scene JSON when the file is small enough. */
  sceneJson?: string
  error?: string
}

/** Parsed scene parts shared by every scene operation. */
export interface SceneParts {
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

/** Result of loading a scene file without failing on a missing or corrupt file. */
export interface LoadedScene {
  exists: boolean
  /** File text when it exists; absent for a missing file. */
  text?: string
  parts: SceneParts
  error?: string
}

/** Result of `screenshotScene`. */
export interface ScreenshotResult {
  ok: true
  cwd: string
  drawing: string
  /** Absolute path of the written PNG. */
  path: string
  width: number
  height: number
  bytes: number
}

/** Result of a scene mutation that reports a preview. */
export interface MutationResult {
  ok: true
  cwd: string
  drawing: string
  elementCount: number
  previewSvg?: string
}

/** Result of `drawScene`. */
export interface DrawResult {
  ok: true
  cwd: string
  drawing: string
  added: number
  totalElements: number
  skipped: number
  previewSvg?: string
}

/** Result of `exportScene`. */
export interface ExportResult {
  ok: true
  path: string
  drawing: string
  format: ExportFormat
  elementCount: number
  bytes: number
  /** Pixel width of the exported image; absent for `excalidraw` files. */
  width?: number
  /** Pixel height of the exported image; absent for `excalidraw` files. */
  height?: number
}

/** Output formats `exportScene` writes. */
export type ExportFormat = 'svg' | 'png' | 'excalidraw'

/**
 * Default export path of one drawing. The default drawing keeps the historical
 * top-level names; named drawings use `exports/<id>.<ext>` so they never
 * overwrite each other.
 * @param format - output format.
 * @param drawing - drawing id.
 * @returns the workspace-relative path.
 */
export function defaultExportRelative(format: ExportFormat, drawing: string): string {
  if (drawing === DEFAULT_DRAWING_ID) {
    if (format === 'png') return DEFAULT_EXPORT_PNG_RELATIVE
    if (format === 'excalidraw') return DEFAULT_EXPORT_FILE_RELATIVE
    return DEFAULT_EXPORT_RELATIVE
  }
  const extension = format === 'excalidraw' ? 'excalidraw' : format
  return join(EXPORT_DIRECTORY, `${drawing}.${extension}`)
}

/**
 * Default screenshot path of one drawing.
 * @param drawing - drawing id.
 * @returns the workspace-relative PNG path.
 */
export function defaultScreenshotRelative(drawing: string): string {
  return drawing === DEFAULT_DRAWING_ID
    ? DEFAULT_SCREENSHOT_RELATIVE
    : join(SCREENSHOT_DIRECTORY, `${drawing}.png`)
}

/** Result of `importScene`. */
export interface ImportResult {
  ok: true
  cwd: string
  drawing: string
  /** Absolute path of the imported file. */
  path: string
  elementCount: number
  /** Size of the imported file in bytes. */
  bytes: number
  previewSvg?: string
}

/** A high-level shape description from the caller. */
export interface DrawShape {
  type: string
  x: number
  y: number
  width: number
  height: number
  text?: string
  points?: unknown
  strokeColor?: string
  backgroundColor?: string
  fillStyle?: string
  strokeWidth?: number
  opacity?: number
}

/** Element types the high-level draw tool accepts. */
export const DRAWABLE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'text', 'arrow', 'line'])

/** Shape of a drawing id: path-safe, 1-64 characters. */
const DRAWING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
/** Windows device names cannot be used as file names even with an extension. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/**
 * Normalize a caller-supplied drawing id.
 * @param raw - drawing id; omitted or empty means the default drawing.
 * @returns a path-safe id.
 * @throws when the id could escape the drawings directory or collide with a
 * Windows device name.
 */
export function normalizeDrawingId(raw?: string): string {
  const id = raw?.trim()
  if (id === undefined || id.length === 0) return DEFAULT_DRAWING_ID
  if (!DRAWING_ID_PATTERN.test(id) || WINDOWS_RESERVED.has(id.toLowerCase())) {
    throw new Error(
      `invalid drawing id "${id}": use 1-64 letters, digits, "-" or "_", starting with a letter or digit`,
    )
  }
  return id
}

/**
 * Resolve the scene file of one drawing in a workspace.
 * @param workspace - workspace root, absolute.
 * @param sceneOverride - optional scene path from the operator (absolute, or
 * relative to the workspace). Model input never reaches this parameter, so an
 * absolute override is safe here; it only applies to the default drawing.
 * @param drawing - drawing id; omitted means the default drawing.
 * @returns the workspace root, drawing id and absolute scene path.
 */
export function sceneTarget(workspace: string, sceneOverride?: string, drawing?: string): SceneTarget {
  const root = resolve(workspace)
  const id = normalizeDrawingId(drawing)
  const override = sceneOverride?.trim()
  if (id === DEFAULT_DRAWING_ID) {
    if (override !== undefined && override.length > 0) {
      return {
        workspace: root,
        scenePath: isAbsolute(override) ? override : join(root, override),
        drawing: id,
      }
    }
    return { workspace: root, scenePath: join(root, SCENE_RELATIVE), drawing: id }
  }
  return { workspace: root, scenePath: join(root, DRAWINGS_DIRECTORY, `${id}.json`), drawing: id }
}

/**
 * Workspaces one server may operate on. A single process serves many
 * workspaces: each tool call names its target, and every target must lie inside
 * one of these roots.
 */
export interface WorkspaceScope {
  /** Absolute, de-duplicated workspace roots; the first one is the default. */
  readonly roots: readonly string[]
  /** Operator scene override, only meaningful with a single root. */
  readonly scene?: string
}

/**
 * Test whether a path is a root itself or lies inside it.
 * @param root - absolute root directory.
 * @param candidate - absolute path to test.
 * @returns true when the path stays inside the root.
 */
export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel.length === 0 || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** In-flight mutations keyed by scene file, so concurrent calls never interleave. */
const sceneLocks = new Map<string, Promise<unknown>>()

/**
 * Serialize one read-modify-write cycle on a scene file. Only mutations need
 * this: plain writes are atomic, so readers never observe a partial file, and
 * parallel replacements resolve last-writer-wins.
 * @param target - resolved scene target.
 * @param work - the whole load-change-save cycle.
 * @returns the result of `work`.
 */
export function withSceneLock<T>(target: SceneTarget, work: () => Promise<T>): Promise<T> {
  const previous = sceneLocks.get(target.scenePath) ?? Promise.resolve()
  const running = previous.then(work, work)
  const settled = running.then(() => undefined, () => undefined)
  sceneLocks.set(target.scenePath, settled)
  void settled.then(() => {
    if (sceneLocks.get(target.scenePath) === settled) sceneLocks.delete(target.scenePath)
  })
  return running
}

/** Write then rename, so readers see either the old file or the new one. */
async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tempPath = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, data)
    await rename(tempPath, path)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

/**
 * Build the workspace scope of a server.
 * @param roots - operator-supplied workspace roots.
 * @param scene - optional scene override; rejected when several roots exist,
 * because one fixed scene file cannot describe several workspaces.
 * @returns the normalized scope.
 */
export function workspaceScope(roots: readonly string[], scene?: string): WorkspaceScope {
  if (roots.length === 0) throw new Error('at least one workspace root is required')
  const normalized: string[] = []
  for (const raw of roots) {
    const root = resolve(raw)
    if (!normalized.includes(root)) normalized.push(root)
  }
  const override = scene?.trim()
  if (override === undefined || override.length === 0) return { roots: normalized }
  if (normalized.length > 1) throw new Error('`scene` requires a single workspace root')
  return { roots: normalized, scene: override }
}

/**
 * Scene target of the default workspace (the first configured root).
 * @param scope - server scope.
 * @param drawing - drawing id; omitted means the default drawing.
 * @returns the resolved scene target.
 */
export function defaultTarget(scope: WorkspaceScope, drawing?: string): SceneTarget {
  return sceneTarget(scope.roots[0] as string, scope.scene, drawing)
}

/**
 * Resolve the scene target a tool call asked for.
 * @param scope - server scope.
 * @param requested - workspace from the caller: absolute, or relative to the
 * first root. Omitted means the default root.
 * @param drawing - drawing id; omitted means the default drawing.
 * @returns the resolved scene target.
 * @throws when the workspace is outside every root or is not an existing
 * directory, so a model cannot reach arbitrary paths on the host.
 */
export async function targetFor(
  scope: WorkspaceScope,
  requested?: string,
  drawing?: string,
): Promise<SceneTarget> {
  const asked = requested?.trim()
  if (asked === undefined || asked.length === 0) return defaultTarget(scope, drawing)
  const primary = scope.roots[0] as string
  const candidate = isAbsolute(asked) ? resolve(asked) : resolve(primary, asked)
  // A relative `..` resolves outside the root; containment covers both forms.
  // The real path is what actually gets read, so a symlink inside a root that
  // points elsewhere must be rejected.
  let realCandidate: string
  try {
    realCandidate = await realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`workspace does not exist: ${candidate}`)
    }
    throw error
  }
  const realRoots = await Promise.all(scope.roots.map(async (root) => {
    try {
      return await realpath(root)
    } catch {
      return root
    }
  }))
  if (!scope.roots.some((_root, index) => isWithin(realRoots[index] as string, realCandidate))) {
    throw new Error(`workspace "${asked}" is outside the allowed roots: ${scope.roots.join(', ')}`)
  }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(realCandidate)
  } catch {
    throw new Error(`workspace does not exist: ${candidate}`)
  }
  if (!info.isDirectory()) throw new Error(`workspace is not a directory: ${candidate}`)
  // The explicit scene pins the configured root; another workspace keeps its own.
  const pinned = candidate === primary || realCandidate === primary
  return sceneTarget(candidate, pinned ? scope.scene : undefined, drawing)
}

/** True for a tombstoned element that no longer appears on the canvas. */
function isDeleted(element: Record<string, unknown>): boolean {
  return element['isDeleted'] === true
}

/** Visible elements only; tombstoned elements stay in the file but not on screen. */
export function visibleElements(elements: readonly unknown[]): Record<string, unknown>[] {
  return elements.filter((element): element is Record<string, unknown> =>
    typeof element === 'object' && element !== null && !isDeleted(element as Record<string, unknown>))
}

/** Summarize a scene without dumping every element field. */
export function summarizeScene(scene: unknown): SceneSummary {
  const record = (typeof scene === 'object' && scene !== null) ? scene as Record<string, unknown> : {}
  const elements = visibleElements(Array.isArray(record['elements']) ? record['elements'] : [])
  const appState = (typeof record['appState'] === 'object' && record['appState'] !== null)
    ? record['appState'] as Record<string, unknown>
    : {}
  const byType: Record<string, number> = {}
  const textElements: Record<string, JsonValue>[] = []
  for (const element of elements) {
    if (typeof element !== 'object' || element === null) continue
    const entry = element as Record<string, unknown>
    const type = typeof entry['type'] === 'string' ? entry['type'] : 'unknown'
    byType[type] = (byType[type] ?? 0) + 1
    if (type === 'text' || typeof entry['text'] === 'string') {
      const item: Record<string, JsonValue> = {}
      for (const field of ['id', 'text', 'x', 'y'] as const) {
        if (entry[field] !== undefined) item[field] = entry[field] as JsonValue
      }
      textElements.push(item)
    }
  }
  return {
    elementCount: elements.length,
    byType,
    textElements,
    theme: typeof appState['theme'] === 'string' ? appState['theme'] : 'light',
    viewBackgroundColor: typeof appState['viewBackgroundColor'] === 'string'
      ? appState['viewBackgroundColor']
      : 'transparent',
  }
}

/** Format a coordinate without trailing noise. */
function formatNumber(value: unknown): string {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10)
}

/** Shorten and quote element text for one description line. */
function formatText(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  const clipped = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
  return JSON.stringify(clipped)
}

/**
 * Build a structured text description of the visible canvas for a model: one
 * line per element with type, id, geometry, text, image file and grouping
 * state. Tombstoned elements are skipped, labels bound to a container are
 * inlined, and the result is bounded in both element count and bytes.
 * @param elements - the scene's element objects.
 * @param appState - the scene's `appState` object.
 * @param drawing - drawing id used in the header.
 * @returns the description text.
 */
export function describeScene(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  drawing: string = DEFAULT_DRAWING_ID,
): string {
  const visible = visibleElements(elements)
  const labels = new Map<string, string>()
  for (const element of visible) {
    if (element['type'] !== 'text') continue
    const containerId = element['containerId']
    if (typeof containerId === 'string' && typeof element['text'] === 'string') {
      labels.set(containerId, element['text'])
    }
  }
  const background = backgroundOf(appState) ?? 'transparent'
  const byType = new Map<string, number>()
  for (const element of visible) {
    const type = typeof element['type'] === 'string' ? element['type'] : 'unknown'
    byType.set(type, (byType.get(type) ?? 0) + 1)
  }
  const typeText = [...byType.entries()].map(([type, count]) => `${type} ${count}`).join(', ') || 'none'
  const lines: string[] = [
    `Drawing "${drawing}": ${visible.length} visible elements on a ${background} canvas.`,
    `Types: ${typeText}.`,
  ]
  const listed = visible.slice(0, DESCRIPTION_MAX_ELEMENTS)
  listed.forEach((element, index) => {
    const type = typeof element['type'] === 'string' ? element['type'] : 'unknown'
    const id = typeof element['id'] === 'string' ? element['id'] : '(no id)'
    const x = element['x']
    const y = element['y']
    const width = element['width']
    const height = element['height']
    const notes: string[] = []
    if (typeof element['text'] === 'string') {
      notes.push(`text ${formatText(element['text'])}`)
      if (typeof element['containerId'] === 'string') notes.push(`label of ${element['containerId']}`)
    }
    if (type !== 'text') {
      const label = labels.get(id)
      if (label !== undefined) notes.push(`label ${formatText(label)}`)
    }
    if (type === 'image' && typeof element['fileId'] === 'string') {
      notes.push(`file ${element['fileId']}`)
    }
    if ((type === 'arrow' || type === 'line') && Array.isArray(element['points'])) {
      const points = element['points'] as unknown[]
      notes.push(`points ${points.length}`)
      const last = points[points.length - 1]
      if (Array.isArray(last) && typeof last[0] === 'number' && typeof last[1] === 'number') {
        const baseX = typeof x === 'number' ? x : 0
        const baseY = typeof y === 'number' ? y : 0
        const start = points[0]
        if (Array.isArray(start) && typeof start[0] === 'number' && typeof start[1] === 'number') {
          notes.push(`from (${formatNumber(baseX + start[0])},${formatNumber(baseY + start[1])})`)
        }
        notes.push(`to (${formatNumber(baseX + last[0])},${formatNumber(baseY + last[1])})`)
      }
    }
    if (element['locked'] === true) notes.push('locked')
    if (Array.isArray(element['groupIds']) && element['groupIds'].length > 0) {
      notes.push(`groups=${(element['groupIds'] as unknown[]).map(String).join(',')}`)
    }
    const opacity = element['opacity']
    if (typeof opacity === 'number' && opacity < 100) notes.push(`opacity ${formatNumber(opacity)}`)
    const suffix = notes.length > 0 ? ` — ${notes.join('; ')}` : ''
    lines.push(
      `${index + 1}. ${type} id=${id} at (${formatNumber(x)},${formatNumber(y)}) `
      + `size ${formatNumber(width)}x${formatNumber(height)}${suffix}`,
    )
  })
  if (visible.length > listed.length) {
    lines.push(`… ${visible.length - listed.length} more elements not listed.`)
  }
  const result: string[] = []
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > DESCRIPTION_MAX_BYTES) {
      result.push('… description truncated.')
      break
    }
    result.push(line)
    bytes += size
  }
  return result.join('\n')
}

/** Generate a short unique element id (url-safe, 12 chars). */
function elementId(): string {
  return randomBytes(9).toString('base64url')
}

/** Validate one shape field into a finite number. */
function shapeNumber(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`excalidraw_draw: element field "${name}" must be a number`)
  }
  return value
}

/** A polyline is 2-1024 `[x,y]` pairs of finite numbers. */
function isPointList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 1024) return false
  return value.every(point => Array.isArray(point) && point.length === 2
    && typeof point[0] === 'number' && Number.isFinite(point[0])
    && typeof point[1] === 'number' && Number.isFinite(point[1]))
}

/**
 * Build a complete Excalidraw element from one high-level shape. Every field
 * roughjs needs to RENDER the shape is emitted: without `seed` (and the other
 * base fields below) Excalidraw's updateScene only fills index/versionNonce,
 * and roughjs throws during path generation — the canvas stays blank. The
 * caller supplies only semantic fields; this function fills the rendering
 * surface.
 * @param shape - the caller-supplied shape description.
 * @returns a complete element object, or null when the type is unsupported.
 */
export function elementFromShape(shape: DrawShape): Record<string, unknown> | null {
  const type = shape.type
  if (!DRAWABLE_TYPES.has(type)) return null
  const strokeColor = shape.strokeColor ?? '#1e1e1e'
  const backgroundColor = shape.backgroundColor ?? 'transparent'
  const strokeWidth = shapeNumber(shape.strokeWidth, 'strokeWidth', 2)
  // Excalidraw opacity is an integer 0-100 (not a 0-1 fraction); 1 would make
  // the shape nearly invisible.
  const opacity = Math.round(Math.max(0, Math.min(100, shapeNumber(shape.opacity, 'opacity', 100))))
  const fillStyle = shape.fillStyle ?? 'hachure'
  const base: Record<string, unknown> = {
    id: elementId(),
    type,
    x: shapeNumber(shape.x, 'x', 0),
    y: shapeNumber(shape.y, 'y', 0),
    width: Math.max(0, shapeNumber(shape.width, 'width', 100)),
    height: Math.max(0, shapeNumber(shape.height, 'height', 100)),
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle,
    strokeWidth,
    strokeStyle: 'solid',
    roughness: 1,
    opacity,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    index: fractionalIndex(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    roundness: { type: 3 },
  }
  if (type === 'text') {
    const text = typeof shape.text === 'string' ? shape.text : ''
    base['text'] = text
    base['fontSize'] = 20
    base['fontFamily'] = 1
    base['textAlign'] = 'left'
    base['verticalAlign'] = 'top'
    base['containerId'] = null
    base['originalText'] = text
    base['autoResize'] = true
    base['lineHeight'] = 1.25
    base['roundness'] = null
  }
  if (type === 'arrow' || type === 'line') {
    const points = Array.isArray(shape.points)
      ? shape.points
      : [[0, 0], [shapeNumber(shape.width, 'width', 100), shapeNumber(shape.height, 'height', 100)]]
    base['points'] = points
    base['lastCommittedPoint'] = null
    base['startBinding'] = null
    base['endBinding'] = null
    base['startArrowhead'] = type === 'arrow' ? 'arrow' : null
    base['endArrowhead'] = type === 'arrow' ? 'arrow' : null
    if (type === 'arrow') base['elbowed'] = false
  }
  return base
}

/** Random non-negative integer seed (roughjs shape seed). */
function randomInt(): number {
  return randomBytes(4).readUInt32BE(0) % 0x7fffffff
}

/**
 * Expand one high-level shape into the elements Excalidraw actually renders.
 * A container shape (`rectangle`/`ellipse`/`diamond`) with `text` becomes two
 * elements: the container plus a centered text element bound through
 * `containerId`/`boundElements`. Excalidraw ignores a `text` field on a
 * container, so without the child element a labelled box would render as an
 * empty box.
 * @param shape - the caller-supplied shape description.
 * @returns the elements to add, empty when the type is unsupported.
 */
export function elementsFromShape(shape: DrawShape): Record<string, unknown>[] {
  const base = elementFromShape(shape)
  if (base === null) return []
  const label = shape.text?.trim()
  const containerType = base['type']
  const bindable = containerType === 'rectangle' || containerType === 'ellipse' || containerType === 'diamond'
  if (label === undefined || label.length === 0 || !bindable) return [base]

  const containerId = base['id'] as string
  const fontSize = 20
  const lineHeight = 1.25
  const lines = label.split('\n')
  // Approximate Helvetica metrics: no font file is available node-side, and the
  // canvas only needs a sane box to center in.
  const textWidth = Math.max(1, ...lines.map(line => Math.ceil(line.length * fontSize * 0.6)))
  const textHeight = Math.ceil(lines.length * fontSize * lineHeight)
  const cx = (base['x'] as number) + (base['width'] as number) / 2
  const cy = (base['y'] as number) + (base['height'] as number) / 2
  const textElement: Record<string, unknown> = {
    id: elementId(),
    type: 'text',
    x: cx - textWidth / 2,
    y: cy - textHeight / 2,
    width: textWidth,
    height: textHeight,
    angle: 0,
    strokeColor: base['strokeColor'],
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: base['opacity'],
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    index: fractionalIndex(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    roundness: null,
    text: label,
    originalText: label,
    fontSize,
    fontFamily: 1,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId,
    autoResize: true,
    lineHeight,
  }
  base['boundElements'] = [{ type: 'text', id: textElement['id'] }]
  return [base, textElement]
}

/**
 * Deterministic pseudo-seed for an element id. The same id always yields the
 * same seed, so normalizing an on-disk scene is idempotent: re-reading never
 * changes an element's seed.
 * @param id - the element id, if any.
 * @returns a non-negative seed usable by roughjs.
 */
export function stableSeedFor(id: unknown): number {
  const text = typeof id === 'string' ? id : String(id)
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 0x7fffffff
}

/**
 * A fractional index for scene ordering (the same scheme Excalidraw uses via
 * fractional-indexing: strings compare alphabetically, `a0` < `a1` < `b0`…).
 * Elements without an `index` can be dropped as invalid by Excalidraw's scene
 * reconciliation on load, which made model-drawn shapes disappear from the
 * canvas; every drawn element carries one.
 */
function fractionalIndex(): string {
  const base = Math.floor(Date.now() / 1000).toString(36)
  const tail = randomBytes(3).readUIntBE(0, 3).toString(36)
  return `a${base}${tail}`
}

/**
 * Repair an Excalidraw scene payload before it is persisted or rendered.
 *
 * Malformed elements make the canvas crash on click: a missing `seed` (roughjs
 * throws during path generation), `version: null` (breaks optimistic
 * concurrency and binding), a `pending`/file-less `image` (no data source to
 * render), or missing shape-geometry defaults. Repair is idempotent —
 * well-formed elements pass through untouched. Elements that cannot render are
 * dropped from the returned element array.
 * @param scene - the parsed scene payload (an object with an `elements` array).
 * @returns the repaired scene payload.
 */
export function sanitizeScene(scene: unknown): unknown {
  if (typeof scene !== 'object' || scene === null || !('elements' in scene)) {
    return scene
  }
  const record = scene as Record<string, unknown>
  const elements = record['elements']
  if (!Array.isArray(elements)) {
    return scene
  }
  record['elements'] = elements.map((raw): unknown => {
    if (typeof raw !== 'object' || raw === null) {
      return raw
    }
    const element = raw as Record<string, unknown>
    if (element['type'] === 'image' &&
        (element['status'] === 'pending' ||
          typeof element['fileId'] !== 'string' ||
          element['fileId'].length === 0)) {
      // Cannot render a file-less image; clicking it throws.
      return null
    }
    if (element['seed'] === undefined) element['seed'] = stableSeedFor(element['id'])
    if (element['version'] === null || element['version'] === undefined) element['version'] = 1
    if (element['angle'] === undefined) element['angle'] = 0
    if (element['isDeleted'] === undefined) element['isDeleted'] = false
    if (element['groupIds'] === undefined) element['groupIds'] = []
    if (element['frameId'] === undefined) element['frameId'] = null
    if (element['boundElements'] === undefined) element['boundElements'] = null
    if (element['link'] === undefined) element['link'] = null
    if (element['locked'] === undefined) element['locked'] = false
    if (element['roundness'] === undefined) element['roundness'] = null
    return element
  }).filter(element => element !== null)
  return scene
}

/**
 * Render an Excalidraw scene as an SVG document. Pure node-side (no canvas).
 * Supports the shapes the draw tool emits plus freedraw paths; hand-drawn
 * (roughjs) texture is not reproduced — flat fills/strokes only.
 * @param elements - the scene's element objects.
 * @param background - backdrop color, or null for transparent.
 * @returns the SVG document as a string.
 */
export function sceneToSvg(elements: readonly unknown[], background: string | null): string {
  const visible = elements.filter((raw) => {
    if (typeof raw !== 'object' || raw === null) return false
    const element = raw as Record<string, unknown>
    return element['isDeleted'] !== true
  })
  // Compute the bounding box over every element so the SVG viewBox frames it.
  const padding = 24
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  for (const raw of visible) {
    const element = raw as Record<string, unknown>
    const x = numOf(element['x'])
    const y = numOf(element['y'])
    const w = Math.max(0, numOf(element['width']))
    const h = Math.max(0, numOf(element['height']))
    const points = Array.isArray(element['points']) ? element['points'] as unknown[] : undefined
    let bx = x
    let by = y
    let bw = w
    let bh = h
    if (points !== undefined && points.length > 0) {
      // Points are element-relative; fold them into the box.
      let px = 0
      let py = 0
      let pw = 0
      let ph = 0
      for (const point of points) {
        if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') continue
        px = Math.min(px, point[0])
        py = Math.min(py, point[1])
        pw = Math.max(pw, point[0])
        ph = Math.max(ph, point[1])
      }
      bx = x + px
      by = y + py
      bw = pw - px
      bh = ph - py
    }
    boxes.push({ x: bx, y: by, w: bw, h: bh })
    minX = Math.min(minX, bx)
    minY = Math.min(minY, by)
    maxX = Math.max(maxX, bx + bw)
    maxY = Math.max(maxY, by + bh)
  }
  if (!Number.isFinite(minX)) {
    minX = 0; minY = 0; maxX = 800; maxY = 600
  }
  const viewX = minX - padding
  const viewY = minY - padding
  const viewW = maxX - minX + padding * 2
  const viewH = maxY - minY + padding * 2

  const parts: string[] = []
  if (background !== null) {
    parts.push(`<rect x="${viewX}" y="${viewY}" width="${viewW}" height="${viewH}" fill="${xmlAttr(background)}"/>`)
  }
  visible.forEach((raw) => {
    const element = raw as Record<string, unknown>
    const type = String(element['type'] ?? '')
    const x = numOf(element['x'])
    const y = numOf(element['y'])
    const w = Math.max(0, numOf(element['width']))
    const h = Math.max(0, numOf(element['height']))
    const stroke = strOf(element['strokeColor']) || '#1e1e1e'
    const fill = type === 'text' ? strOf(element['strokeColor']) || '#1e1e1e' : strOf(element['backgroundColor'])
    const strokeWidth = numOf(element['strokeWidth']) || 2
    // Excalidraw stores opacity as an integer 0-100; SVG wants 0-1 with a floor
    // so a fully transparent element still produces a visible outline.
    const opacity = Math.max(0.05, Math.min(1, (numOf(element['opacity']) || 100) / 100))
    const angle = numOf(element['angle']) || 0
    const cx = x + w / 2
    const cy = y + h / 2
    const transform = angle === 0
      ? ''
      : ` transform="rotate(${angle * 180 / Math.PI} ${cx} ${cy})"`

    const style = `fill="${fill === '' ? 'none' : xmlAttr(fill)}" stroke="${xmlAttr(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"`
    switch (type) {
      case 'rectangle':
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${style}${transform}/>`)
        break
      case 'ellipse':
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${style}${transform}/>`)
        break
      case 'diamond':
        parts.push(
          `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${style}${transform}/>`,
        )
        break
      case 'text': {
        const fontSize = numOf(element['fontSize']) || 20
        const text = String(element['text'] ?? '')
        parts.push(
          `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${xmlAttr(fill)}" font-family="sans-serif"${transform}>${xmlText(text)}</text>`,
        )
        break
      }
      case 'line':
      case 'arrow': {
        const points = Array.isArray(element['points']) ? element['points'] as unknown[] : []
        if (points.length >= 2) {
          const coords = points
            .filter((point): point is unknown[] => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number')
            .map(point => `${numOf(point[0]) + x},${numOf(point[1]) + y}`)
          if (coords.length >= 2) {
            const strokeOnly = `fill="none" stroke="${xmlAttr(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"`
            parts.push(`<polyline points="${coords.join(' ')}" ${strokeOnly}${transform}/>`)
            if (type === 'arrow') {
              const lastParts = (coords[coords.length - 1] as string).split(',').map(Number)
              const prevParts = (coords[coords.length - 2] as string).split(',').map(Number)
              const ax = lastParts[0] as number; const ay = lastParts[1] as number
              const dx = ax - (prevParts[0] as number); const dy = ay - (prevParts[1] as number)
              const len = Math.hypot(dx, dy) || 1
              const ux = dx / len; const uy = dy / len
              const size = 10
              const head = [
                [ax - ux * size + -uy * size * 0.5, ay - uy * size + ux * size * 0.5],
                [ax, ay],
                [ax - ux * size + uy * size * 0.5, ay - uy * size + -ux * size * 0.5],
              ]
              parts.push(
                `<polygon points="${head.map(p => `${p[0]},${p[1]}`).join(' ')}" fill="${xmlAttr(stroke)}" opacity="${opacity}"${transform}/>`,
              )
            }
          }
        }
        break
      }
      case 'freedraw': {
        const points = Array.isArray(element['points']) ? element['points'] as unknown[] : []
        const d = points
          .filter((point): point is unknown[] => Array.isArray(point) && typeof point[0] === 'number' && typeof point[1] === 'number')
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${numOf(point[0]) + x},${numOf(point[1]) + y}`)
          .join(' ')
        if (d.length > 0) {
          parts.push(`<path d="${d}" fill="none" stroke="${xmlAttr(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"${transform}/>`)
        }
        break
      }
      default:
        break
    }
  })

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewX} ${viewY} ${viewW} ${viewH}" width="${viewW}" height="${viewH}">\n`
    + parts.join('\n')
    + '\n</svg>\n'
}

/** Read a finite number field, defaulting to 0. */
function numOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Read a string field, defaulting to ''. */
function strOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Escape an attribute value. */
function xmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Escape text content. */
function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Read the canvas background color from an `appState` object, mapping the
 * Excalidraw "transparent" sentinel and empty strings to null so `sceneToSvg`
 * omits the backdrop rect.
 * @param appState - the scene's `appState` object (may be empty).
 * @returns the background color, or null for a transparent canvas.
 */
function backgroundOf(appState: Record<string, unknown>): string | null {
  const color = typeof appState['viewBackgroundColor'] === 'string' ? appState['viewBackgroundColor'] : ''
  return color.length === 0 || color === 'transparent' ? null : color
}

/**
 * Build the preview SVG for a scene, returning undefined when the scene is
 * empty or the rendered SVG exceeds {@link PREVIEW_SVG_MAX_BYTES} so tool
 * results stay bounded.
 * @param elements - the scene's element objects.
 * @param appState - the scene's `appState` object (may be empty).
 * @returns the SVG document, or undefined when no preview is emitted.
 */
export function previewSvgOf(elements: readonly unknown[], appState: Record<string, unknown>): string | undefined {
  if (elements.length === 0) return undefined
  const svg = sceneToSvg(elements, backgroundOf(appState))
  return svg.length <= PREVIEW_SVG_MAX_BYTES ? svg : undefined
}

/** Empty scene parts used for a missing or corrupt file. */
function emptyParts(): SceneParts {
  return { elements: [], appState: {}, files: {} }
}

/** Parse a scene body, returning its elements, app state and embedded files. */
export function splitScene(parsed: unknown): SceneParts {
  const record = (typeof parsed === 'object' && parsed !== null) ? parsed as Record<string, unknown> : {}
  const elements = Array.isArray(record['elements']) ? record['elements'] : []
  const appState = (typeof record['appState'] === 'object' && record['appState'] !== null)
    ? record['appState'] as Record<string, unknown>
    : {}
  const files = (typeof record['files'] === 'object' && record['files'] !== null)
    ? record['files'] as Record<string, unknown>
    : {}
  return { elements, appState, files }
}

/**
 * Load the scene file without throwing on a missing or corrupt file. A corrupt
 * file keeps its raw text and reports `error`, so callers can decide whether to
 * start from an empty canvas or refuse the operation.
 * @param target - resolved scene target.
 * @returns the loaded scene parts and any read error.
 */
export async function loadSceneParts(target: SceneTarget): Promise<LoadedScene> {
  let text: string
  try {
    text = await readFile(target.scenePath, 'utf8')
  } catch {
    return { exists: false, parts: emptyParts() }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      exists: true,
      text,
      parts: emptyParts(),
      error: 'scene file is corrupted (not valid JSON)',
    }
  }
  return { exists: true, text, parts: splitScene(parsed) }
}

/**
 * Persist scene parts after repairing render-critical fields. Embedded image
 * `files` are written only when non-empty, matching Excalidraw's own files.
 * @param target - resolved scene target.
 * @param parts - elements, app state and embedded files.
 * @param options - `exclusive` fails instead of overwriting an existing file.
 * @returns the parts as persisted.
 */
export async function saveSceneParts(
  target: SceneTarget,
  parts: SceneParts,
  options: { exclusive?: boolean } = {},
): Promise<SceneParts> {
  const repaired = sanitizeScene({ elements: parts.elements, appState: parts.appState }) as Record<string, unknown>
  const persisted: Record<string, unknown> = {
    elements: Array.isArray(repaired['elements']) ? repaired['elements'] : [],
    appState: typeof repaired['appState'] === 'object' && repaired['appState'] !== null ? repaired['appState'] : {},
  }
  if (Object.keys(parts.files).length > 0) persisted['files'] = parts.files
  await mkdir(dirname(target.scenePath), { recursive: true })
  const data = JSON.stringify(persisted)
  if (options.exclusive === true) {
    // 'wx' makes competing creates fail instead of silently overwriting.
    await writeFile(target.scenePath, data, { encoding: 'utf8', flag: 'wx' })
  } else {
    await writeFileAtomic(target.scenePath, data)
  }
  return splitScene(persisted)
}

/**
 * Read the target scene and return a bounded summary, a compact element list
 * and a structured text description. Missing or corrupt files do not throw: a
 * missing file reads as an empty canvas, a corrupt file as an empty scene with
 * an `error` field, matching the web surface's behavior.
 * @param target - resolved scene target.
 * @returns the read result.
 */
export async function readScene(target: SceneTarget): Promise<ReadResult> {
  const loaded = await loadSceneParts(target)
  if (!loaded.exists) {
    return {
      cwd: target.workspace,
      drawing: target.drawing,
      path: target.scenePath,
      exists: false,
      summary: EMPTY_SUMMARY,
      elements: [],
      description: describeScene([], {}, target.drawing),
    }
  }
  if (loaded.error !== undefined) {
    return {
      cwd: target.workspace,
      drawing: target.drawing,
      path: target.scenePath,
      exists: true,
      summary: EMPTY_SUMMARY,
      elements: [],
      description: describeScene([], {}, target.drawing),
      error: loaded.error,
    }
  }
  const { elements, appState } = loaded.parts
  const compact = visibleElements(elements).map((entry): CompactElement => {
    const out: CompactElement = {}
    for (const field of [
      'id', 'type', 'x', 'y', 'width', 'height', 'text',
      'locked', 'groupIds', 'containerId', 'fileId',
    ] as const) {
      if (entry[field] !== undefined) out[field] = entry[field] as JsonValue
    }
    return out
  })
  const result: ReadResult = {
    cwd: target.workspace,
    drawing: target.drawing,
    path: target.scenePath,
    exists: true,
    summary: summarizeScene(loaded.parts),
    elements: compact,
    description: describeScene(elements, appState, target.drawing),
  }
  if (loaded.text !== undefined && Buffer.byteLength(loaded.text, 'utf8') <= READ_FULL_JSON_MAX_BYTES) {
    result.sceneJson = loaded.text
  }
  return result
}

/**
 * Overwrite the target scene from a complete scene JSON string, repairing
 * malformed elements before persistence so the canvas never receives a scene it
 * crashes on (same normalization the web `/scene` routes apply). Scene size is
 * not capped: the canvas may legitimately grow without bound.
 * @param target - resolved scene target.
 * @param sceneJson - complete scene JSON (`{ elements, appState }`).
 * @param options - `exclusive` fails instead of overwriting an existing file.
 * @returns the mutation result with an optional preview SVG.
 */
export async function writeScene(
  target: SceneTarget,
  sceneJson: string,
  options: { exclusive?: boolean } = {},
): Promise<MutationResult> {
  if (sceneJson.length === 0) {
    throw new Error('excalidraw_write: `scene` must be a non-empty JSON string')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(sceneJson)
  } catch {
    throw new Error('excalidraw_write: `scene` is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('excalidraw_write: `scene` must be a JSON object with `elements` and `appState`')
  }
  const record = parsed as Record<string, unknown>
  if (!Array.isArray(record['elements']) || typeof record['appState'] !== 'object' || record['appState'] === null) {
    throw new Error('excalidraw_write: `scene` must contain an `elements` array and an `appState` object')
  }
  const persisted = await saveSceneParts(target, {
    elements: record['elements'] as unknown[],
    appState: record['appState'] as Record<string, unknown>,
    files: splitScene(record).files,
  }, options)
  const result: MutationResult = {
    ok: true,
    cwd: target.workspace,
    drawing: target.drawing,
    elementCount: persisted.elements.length,
  }
  const preview = previewSvgOf(persisted.elements, persisted.appState)
  if (preview !== undefined) result.previewSvg = preview
  return result
}

/**
 * Add shapes to the target scene, or replace the scene with them. Existing
 * scene content is preserved for `append`; a missing or corrupt scene starts
 * from an empty canvas.
 * @param target - resolved scene target.
 * @param rawShapes - high-level shape descriptions.
 * @param action - `append` (default) or `replace`.
 * @returns the draw result with an optional preview SVG.
 */
export async function drawScene(
  target: SceneTarget,
  rawShapes: readonly unknown[],
  action?: string,
): Promise<DrawResult> {
  return withSceneLock(target, () => drawSceneLocked(target, rawShapes, action))
}

async function drawSceneLocked(
  target: SceneTarget,
  rawShapes: readonly unknown[],
  action?: string,
): Promise<DrawResult> {
  if (!Array.isArray(rawShapes)) {
    throw new Error('excalidraw_draw: `elements` must be an array')
  }
  if (rawShapes.length === 0) {
    throw new Error('excalidraw_draw: `elements` must be a non-empty array')
  }
  if (rawShapes.length > DRAW_MAX_ELEMENTS) {
    throw new Error(`excalidraw_draw: at most ${DRAW_MAX_ELEMENTS} elements per call`)
  }
  if (action !== undefined && action !== 'append' && action !== 'replace') {
    throw new Error('excalidraw_draw: `action` must be "append" or "replace"')
  }
  const built: Record<string, unknown>[] = []
  let skipped = 0
  for (const raw of rawShapes) {
    if (typeof raw !== 'object' || raw === null) {
      skipped += 1
      continue
    }
    const shape = raw as Record<string, unknown>
    const typed = shape['type']
    if (typeof typed !== 'string' || !DRAWABLE_TYPES.has(typed)) {
      skipped += 1
      continue
    }
    if (shape['points'] !== undefined && !isPointList(shape['points'])) {
      throw new Error('excalidraw_draw: `points` must be 2-1024 [x,y] pairs of finite numbers')
    }
    const produced = elementsFromShape({
      type: typed,
      x: shapeNumber(shape['x'], 'x', 0),
      y: shapeNumber(shape['y'], 'y', 0),
      width: shapeNumber(shape['width'], 'width', 100),
      height: shapeNumber(shape['height'], 'height', 100),
      ...(typeof shape['text'] === 'string' ? { text: shape['text'] } : {}),
      ...(shape['points'] !== undefined ? { points: shape['points'] } : {}),
      ...(typeof shape['strokeColor'] === 'string' ? { strokeColor: shape['strokeColor'] } : {}),
      ...(typeof shape['backgroundColor'] === 'string' ? { backgroundColor: shape['backgroundColor'] } : {}),
      ...(typeof shape['fillStyle'] === 'string' ? { fillStyle: shape['fillStyle'] } : {}),
      ...(typeof shape['strokeWidth'] === 'number' ? { strokeWidth: shape['strokeWidth'] } : {}),
      ...(typeof shape['opacity'] === 'number' ? { opacity: shape['opacity'] } : {}),
    })
    if (produced.length === 0) { skipped += 1; continue }
    built.push(...produced)
  }
  if (built.length === 0) {
    throw new Error('excalidraw_draw: no supported element types in `elements`')
  }
  // Missing or corrupt scene → start from an empty canvas; embedded image
  // `files` are kept so a draw never orphans existing images.
  const loaded = await loadSceneParts(target)
  const elements = action === 'replace' ? built : [...loaded.parts.elements, ...built]
  const persisted = await saveSceneParts(target, {
    elements,
    appState: loaded.parts.appState,
    files: loaded.parts.files,
  })
  const result: DrawResult = {
    ok: true,
    cwd: target.workspace,
    drawing: target.drawing,
    added: built.length,
    totalElements: persisted.elements.length,
    skipped,
  }
  const preview = previewSvgOf(persisted.elements, persisted.appState)
  if (preview !== undefined) result.previewSvg = preview
  return result
}

/**
 * Reject a caller-supplied file path that could leave the workspace, including
 * through a symlink: the deepest existing ancestor is resolved for real and
 * re-checked before the path is accepted.
 * @param workspace - workspace root.
 * @param relPath - the raw path from the caller.
 * @param tool - tool name used in the rejection message.
 * @returns the absolute path, guaranteed inside the workspace.
 */
export async function resolveWorkspacePath(workspace: string, relPath: string, tool: string): Promise<string> {
  const reject = () => new Error(`${tool}: \`path\` must stay inside the workspace`)
  if (relPath.includes('..') || relPath.startsWith('/') || relPath.includes('\\')) {
    throw reject()
  }
  const root = resolve(workspace)
  const abs = resolve(root, relPath)
  const rel = relative(root, abs)
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    throw reject()
  }
  const rootReal = await realpath(root)
  let probe = abs
  for (;;) {
    let real: string
    try {
      real = await realpath(probe)
    } catch (error) {
      // A missing output file is fine; walk up to the nearest existing ancestor.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw reject()
      const parent = dirname(probe)
      if (parent === probe) throw reject()
      probe = parent
      continue
    }
    if (!isWithin(rootReal, real)) throw reject()
    return abs
  }
}

/**
 * Reject a caller-supplied export path that could leave the workspace.
 * @param workspace - workspace root.
 * @param relPath - the raw path from the caller.
 * @returns the absolute output path, guaranteed inside the workspace.
 */
export function resolveExportPath(workspace: string, relPath: string): Promise<string> {
  return resolveWorkspacePath(workspace, relPath, 'excalidraw_export')
}

/**
 * Build a native `.excalidraw` document. Scene state is reduced to the fields
 * the web app persists (grid size, canvas background); elements are repaired on
 * a copy so the stored scene is never mutated.
 */
function serializeExcalidrawFile(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): string {
  const repaired = sanitizeScene({ elements: structuredClone(elements) }) as { elements: unknown[] }
  const document: Record<string, unknown> = {
    type: 'excalidraw',
    version: EXCALIDRAW_FILE_VERSION,
    source: EXCALIDRAW_FILE_SOURCE,
    elements: repaired.elements,
    appState: {
      gridSize: appState['gridSize'] ?? null,
      viewBackgroundColor: appState['viewBackgroundColor'] ?? 'transparent',
    },
  }
  if (Object.keys(files).length > 0) document['files'] = files
  return JSON.stringify(document)
}

/**
 * Export the target scene inside the workspace. `svg` and `png` render through
 * Excalidraw's own exporter in a local headless Chrome, so hand-drawn texture,
 * embedded images, font subsetting and wrapped text match the web app; a
 * browser is required, and a missing one is reported instead of degrading the
 * output. `excalidraw` writes the native scene file and needs no browser.
 * @param target - resolved scene target.
 * @param options - format, output path (workspace-relative), PNG scale, and background handling.
 * @returns the export result.
 */
export async function exportScene(
  target: SceneTarget,
  options: {
    path?: string
    transparent?: boolean
    format?: ExportFormat
    scale?: number
  } = {},
): Promise<ExportResult> {
  const format: ExportFormat = options.format ?? 'svg'
  const scale = options.scale ?? 1
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 4) {
    throw new Error('excalidraw_export: `scale` must be between 0.5 and 4')
  }
  const relPath = options.path?.trim()
  const defaultPath = defaultExportRelative(format, target.drawing)
  // Validate the destination before touching the scene: a bad path is a caller
  // error regardless of whether a scene exists yet.
  const abs = await resolveExportPath(
    target.workspace,
    relPath !== undefined && relPath.length > 0 ? relPath : defaultPath,
  )
  const loaded = await loadSceneParts(target)
  if (!loaded.exists) {
    throw new Error('excalidraw_export: no scene to export — draw something first')
  }
  if (loaded.error !== undefined) {
    throw new Error('excalidraw_export: scene file is corrupted (not valid JSON)')
  }
  const { elements, appState, files } = loaded.parts
  if (format === 'excalidraw') {
    const data = serializeExcalidrawFile(elements, appState, files)
    await mkdir(dirname(abs), { recursive: true })
    await writeFileAtomic(abs, data)
    return {
      ok: true,
      path: abs,
      drawing: target.drawing,
      format,
      elementCount: elements.length,
      bytes: Buffer.byteLength(data, 'utf8'),
    }
  }
  const transparent = options.transparent === true
  const background = transparent ? null : backgroundOf(appState)
  // Loaded lazily so plugin users that never export do not pay for playwright.
  const { renderScene } = await import('./render.js')
  const rendered = await renderScene(
    { elements, appState, ...(Object.keys(files).length > 0 ? { files } : {}) },
    { format, scale, transparent, background },
  )
  await mkdir(dirname(abs), { recursive: true })
  await writeFileAtomic(abs, rendered.data)
  return {
    ok: true,
    path: abs,
    drawing: target.drawing,
    format,
    elementCount: elements.length,
    bytes: rendered.data.length,
    width: rendered.width,
    height: rendered.height,
  }
}

/**
 * Render the target scene to a PNG screenshot inside the workspace. Uses the
 * same official Excalidraw renderer as `exportScene`; Chrome is required.
 * @param target - resolved scene target.
 * @param options - output path (workspace-relative), PNG scale, background handling.
 * @returns the screenshot metadata.
 */
export async function screenshotScene(
  target: SceneTarget,
  options: { path?: string; transparent?: boolean; scale?: number } = {},
): Promise<ScreenshotResult> {
  const scale = options.scale ?? 1
  if (!Number.isFinite(scale) || scale < 0.5 || scale > 4) {
    throw new Error('excalidraw_screenshot: `scale` must be between 0.5 and 4')
  }
  const relPath = options.path?.trim()
  const requested = relPath !== undefined && relPath.length > 0
    ? relPath
    : defaultScreenshotRelative(target.drawing)
  // A screenshot is rendered PNG bytes; refuse to overwrite anything else.
  if (!requested.toLowerCase().endsWith('.png')) {
    throw new Error('excalidraw_screenshot: `path` must end with .png')
  }
  const abs = await resolveWorkspacePath(target.workspace, requested, 'excalidraw_screenshot')
  const loaded = await loadSceneParts(target)
  if (!loaded.exists) {
    throw new Error('excalidraw_screenshot: no scene to screenshot — draw something first')
  }
  if (loaded.error !== undefined) {
    throw new Error('excalidraw_screenshot: scene file is corrupted (not valid JSON)')
  }
  const { elements, appState, files } = loaded.parts
  const transparent = options.transparent === true
  const { renderScene } = await import('./render.js')
  const rendered = await renderScene(
    { elements, appState, ...(Object.keys(files).length > 0 ? { files } : {}) },
    { format: 'png', scale, transparent, background: transparent ? null : backgroundOf(appState) },
  )
  if (rendered.data.length > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `excalidraw_screenshot: PNG is ${rendered.data.length} bytes, above the ${MAX_SCREENSHOT_BYTES} byte limit; `
      + 'lower `scale` or the canvas size',
    )
  }
  await mkdir(dirname(abs), { recursive: true })
  await writeFileAtomic(abs, rendered.data)
  return {
    ok: true,
    cwd: target.workspace,
    drawing: target.drawing,
    path: abs,
    width: rendered.width,
    height: rendered.height,
    bytes: rendered.data.length,
  }
}

/**
 * Replace the target scene with an Excalidraw file from inside the workspace.
 * Accepts the native `.excalidraw` document and the bare
 * `{ elements, appState }` scene. Elements are repaired before saving and
 * embedded `files` are kept so imported images still render. Excalidraw
 * libraries are rejected: they are item collections, not scenes.
 * @param target - resolved scene target.
 * @param relPath - workspace-relative path of the file to import.
 * @returns the import result with an optional preview SVG.
 */
export async function importScene(target: SceneTarget, relPath: string): Promise<ImportResult> {
  const trimmed = relPath.trim()
  if (trimmed.length === 0) {
    throw new Error('excalidraw_import: `path` is required')
  }
  const abs = await resolveWorkspacePath(target.workspace, trimmed, 'excalidraw_import')
  let text: string
  try {
    text = await readFile(abs, 'utf8')
  } catch {
    throw new Error(`excalidraw_import: file not found: ${trimmed}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`excalidraw_import: ${trimmed} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`excalidraw_import: ${trimmed} is not an Excalidraw scene`)
  }
  const record = parsed as Record<string, unknown>
  if (record['type'] === 'excalidrawlib' || Array.isArray(record['libraryItems'])) {
    throw new Error('excalidraw_import: Excalidraw libraries are not scenes; copy the items to a scene first')
  }
  if (!Array.isArray(record['elements'])) {
    throw new Error(`excalidraw_import: ${trimmed} has no \`elements\` array`)
  }
  const persisted = await saveSceneParts(target, splitScene(record))
  const result: ImportResult = {
    ok: true,
    cwd: target.workspace,
    drawing: target.drawing,
    path: abs,
    elementCount: persisted.elements.length,
    bytes: Buffer.byteLength(text, 'utf8'),
  }
  const preview = previewSvgOf(persisted.elements, persisted.appState)
  if (preview !== undefined) result.previewSvg = preview
  return result
}
