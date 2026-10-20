/** Excalidraw scene model tools: registration, schema enforcement, and the
 * workspace-scene read/write behavior. The tools are captured through a mock
 * tool registry, then executed directly with a fake agent session. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { apply, defaultExportRelative, defaultScreenshotRelative, normalizeDrawingId, SCENE_RELATIVE } from '../src/index.ts'
import { closeRenderer, findChrome } from '../src/render.ts'
import type { Context } from '@deepseek-ai/cordis'

// Export tests need a browser; the rest of the suite runs without one.
const CHROME = await findChrome().catch(() => undefined)
const withChrome = it.skipIf(CHROME === undefined)
// Project-local scratch root: tests must not write to the system temp directory.
const TEST_ROOT = join(process.cwd(), 'tmp', 'tests')

afterAll(async () => {
  await closeRenderer()
})

/** Minimal context double with an inject that forwards to a mock registry. */
function bench() {
  type ToolDefinition = {
    name: string
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
    parameters: unknown
    output: unknown
  }
  const registered: { name: string; definition: ToolDefinition }[] = []
  const disposers: (() => void)[] = []
  const tools = {
    register(definition: ToolDefinition) {
      registered.push({ name: definition.name, definition })
      return () => {
        const index = registered.findIndex(entry => entry.name === definition.name)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  }
  const ctx = {
    tools,
    effect(fn: () => (() => void) | undefined) {
      const disposer = fn()
      if (disposer !== undefined) disposers.push(disposer)
    },
    get() { return undefined },
  }
  apply(ctx as unknown as Context)
  return { registered, disposers, ctx }
}

/** A fake agent execution carrying a workspace-owned session header. */
function execFor(cwd: string) {
  return {
    agent: { session: { id: 'session-1', header: { cwd } } },
    signal: new AbortController().signal,
  }
}

describe('excalidraw model tools', () => {
  it('registers all drawing tools and unwinds on dispose', () => {
    const b = bench()
    expect(b.registered.map(entry => entry.name).sort()).toEqual([
      'excalidraw_add_image',
      'excalidraw_create_drawing',
      'excalidraw_delete_drawing',
      'excalidraw_draw',
      'excalidraw_element_create',
      'excalidraw_element_delete',
      'excalidraw_element_get',
      'excalidraw_element_update',
      'excalidraw_export',
      'excalidraw_export_to_json',
      'excalidraw_get_drawing',
      'excalidraw_import',
      'excalidraw_layout',
      'excalidraw_list_drawings',
      'excalidraw_read',
      'excalidraw_screenshot',
      'excalidraw_update_drawing',
      'excalidraw_write',
    ])
    b.disposers.forEach(dispose => dispose())
    expect(b.registered).toHaveLength(0)
  })

  it('read returns an empty scene summary when no scene exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const tool = b.registered.find(entry => entry.name === 'excalidraw_read')!
      const value = await tool.definition.execute({}, execFor(workspace))
      expect(value).toMatchObject({ cwd: workspace, exists: false })
      expect((value as { summary: { elementCount: number } }).summary.elementCount).toBe(0)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('write persists the scene and read round-trips it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const writeTool = b.registered.find(entry => entry.name === 'excalidraw_write')!
      const scene = { elements: [{ id: 'a', type: 'rectangle' }, { id: 't', type: 'text', text: 'hello' }], appState: { theme: 'dark' } }
      const written = await writeTool.definition.execute({ scene: JSON.stringify(scene) }, execFor(workspace))
      expect(written).toMatchObject({ ok: true, elementCount: 2 })

      const onDisk = JSON.parse(await readFile(join(workspace, SCENE_RELATIVE), 'utf8')) as { elements: Record<string, unknown>[] }
      // sanitizeScene fills render-critical defaults on write, so only the
      // user-supplied identity fields are asserted here, plus the repaired
      // element where a shape was missing seed/version.
      expect(onDisk.elements).toHaveLength(2)
      for (const el of onDisk.elements) {
        expect(el['id']).toBeDefined()
        expect(el['type']).toBeDefined()
        expect(typeof el['seed']).toBe('number')
        expect(el['version']).toBe(1)
        expect(el['angle']).toBe(0)
        expect(el['isDeleted']).toBe(false)
      }

      const readTool = b.registered.find(entry => entry.name === 'excalidraw_read')!
      const value = await readTool.definition.execute({}, execFor(workspace))
      expect(value).toMatchObject({ exists: true })
      expect((value as { summary: { elementCount: number; byType: Record<string, number> } }).summary).toMatchObject({
        elementCount: 2,
        byType: { rectangle: 1, text: 1 },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('rejects writes without an owning workspace', async () => {
    const b = bench()
    const writeTool = b.registered.find(entry => entry.name === 'excalidraw_write')!
    await expect(writeTool.definition.execute(
      { scene: JSON.stringify({ elements: [], appState: {} }) },
      { agent: undefined, signal: new AbortController().signal },
    )).rejects.toThrow('requires an owning agent session')
  })

  it('rejects invalid scene payloads', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const writeTool = b.registered.find(entry => entry.name === 'excalidraw_write')!
      await expect(writeTool.definition.execute({ scene: '' }, execFor(workspace))).rejects.toThrow('non-empty')
      await expect(writeTool.definition.execute({ scene: '{oops' }, execFor(workspace))).rejects.toThrow('not valid JSON')
      await expect(writeTool.definition.execute({ scene: '[1,2]' }, execFor(workspace))).rejects.toThrow('must be a JSON object')
      await expect(writeTool.definition.execute(
        { scene: JSON.stringify({ elements: [], appState: null }) },
        execFor(workspace),
      )).rejects.toThrow('elements')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('read reports a corrupted scene file as an error field', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const scenePath = join(workspace, SCENE_RELATIVE)
      await mkdir(join(scenePath, '..'), { recursive: true })
      await writeFile(scenePath, '{broken', 'utf8')
      const b = bench()
      const readTool = b.registered.find(entry => entry.name === 'excalidraw_read')!
      const value = await readTool.definition.execute({}, execFor(workspace))
      expect(value).toMatchObject({ exists: true })
      expect((value as { error?: string }).error).toContain('corrupted')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('draw appends shapes to a fresh scene and read reflects them', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      const drawn = await drawTool.definition.execute({
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
          { type: 'text', x: 10, y: 80, width: 200, height: 30, text: 'answer' },
          { type: 'arrow', x: 0, y: 0, width: 50, height: 50, points: [[0, 0], [50, 50]] },
        ],
        action: 'append',
      }, execFor(workspace))
      expect(drawn).toMatchObject({ ok: true, added: 3, totalElements: 3, skipped: 0 })

      const onDisk = JSON.parse(await readFile(join(workspace, SCENE_RELATIVE), 'utf8'))
      expect(onDisk.elements).toHaveLength(3)
      expect(onDisk.elements.map((e: { type: string }) => e.type)).toEqual(['rectangle', 'text', 'arrow'])
      // Complete rendering fields: seed (roughjs needs it to draw the shape),
      // index (reconciliation), opacity 0-100 (1 would be near-invisible) and
      // roundness are all emitted by the tool.
      expect(onDisk.elements[0]).toHaveProperty('seed')
      expect(onDisk.elements[0]).toHaveProperty('version')
      expect(onDisk.elements[0]).toHaveProperty('roughness')
      expect(onDisk.elements[0]).toHaveProperty('index')
      expect(onDisk.elements[0]).toMatchObject({ opacity: 100, roundness: { type: 3 } })

      const readTool = b.registered.find(entry => entry.name === 'excalidraw_read')!
      const value = await readTool.definition.execute({}, execFor(workspace))
      expect((value as { elements: unknown[] }).elements).toHaveLength(3)
      expect((value as { elements: { type: string }[] }).elements[1]).toMatchObject({ type: 'text', text: 'answer' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('draw replace clears the canvas before adding', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      await drawTool.definition.execute({ elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] }, execFor(workspace))
      await drawTool.definition.execute({
        elements: [{ type: 'ellipse', x: 5, y: 5, width: 20, height: 20 }],
        action: 'replace',
      }, execFor(workspace))
      const onDisk = JSON.parse(await readFile(join(workspace, SCENE_RELATIVE), 'utf8'))
      expect(onDisk.elements).toHaveLength(1)
      expect(onDisk.elements[0].type).toBe('ellipse')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('draw skips unsupported types and rejects an all-invalid call', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      const drawn = await drawTool.definition.execute({
        elements: [
          { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
          { type: 'wiggly-widget', x: 0, y: 0, width: 10, height: 10 },
        ],
      }, execFor(workspace))
      expect(drawn).toMatchObject({ added: 1, totalElements: 1, skipped: 1 })

      await expect(drawTool.definition.execute({
        elements: [{ type: 'nope', x: 0, y: 0, width: 1, height: 1 }],
      }, execFor(workspace))).rejects.toThrow('no supported element types')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('draw rejects non-array elements and a bad action', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      // A non-array `elements` is rejected by the tool schema before execute.
      await expect(drawTool.definition.execute({ elements: 'nope' }, execFor(workspace))).rejects.toThrow('must be an array')
      await expect(drawTool.definition.execute({ elements: [] }, execFor(workspace))).rejects.toThrow('non-empty array')
      await expect(drawTool.definition.execute({
        elements: [{ type: 'rectangle', x: 0, y: 0, width: 1, height: 1 }],
        action: 'clear',
      }, execFor(workspace))).rejects.toThrow('append')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('imports a .excalidraw file and exports the scene back to the same format', async () => {
    await mkdir(TEST_ROOT, { recursive: true })
    const workspace = await mkdtemp(join(TEST_ROOT, 'plugin-'))
    try {
      const b = bench()
      const importTool = b.registered.find(entry => entry.name === 'excalidraw_import')!
      const exportTool = b.registered.find(entry => entry.name === 'excalidraw_export')!
      const document = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
        appState: { gridSize: 20, viewBackgroundColor: '#ffc9c9' },
      }
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(join(workspace, 'docs', 'in.excalidraw'), JSON.stringify(document), 'utf8')

      const imported = await importTool.definition.execute({ path: 'docs/in.excalidraw' }, execFor(workspace))
      expect(imported).toMatchObject({ ok: true, elementCount: 1, cwd: workspace })

      const exported = await exportTool.definition.execute(
        { format: 'excalidraw', path: 'docs/out.excalidraw' },
        execFor(workspace),
      )
      expect(exported).toMatchObject({ ok: true, format: 'excalidraw', elementCount: 1 })
      const written = JSON.parse(await readFile(join(workspace, 'docs', 'out.excalidraw'), 'utf8')) as {
        appState: { gridSize: number; viewBackgroundColor: string }
      }
      expect(written.appState).toEqual({ gridSize: 20, viewBackgroundColor: '#ffc9c9' })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  withChrome('export writes an SVG of the scene to the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      await drawTool.definition.execute({
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
          { type: 'text', x: 10, y: 80, width: 200, height: 30, text: 'hello' },
          { type: 'arrow', x: 0, y: 0, width: 50, height: 50, points: [[0, 0], [50, 50]] },
        ],
      }, execFor(workspace))
      const exportTool = b.registered.find(entry => entry.name === 'excalidraw_export')!
      const result = await exportTool.definition.execute({}, execFor(workspace))
      expect(result).toMatchObject({ ok: true, elementCount: 3 })
      const abs = (result as { path: string }).path
      expect(abs.startsWith(workspace)).toBe(true)
      const svg = await readFile(abs, 'utf8')
      expect(svg).toContain('svg-source:excalidraw')
      expect(svg).toContain('<rect')
      expect(svg).toContain('<text')
      expect(svg).toContain('hello')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  withChrome('export honors a custom path and rejects escaping paths', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      await drawTool.definition.execute({ elements: [{ type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] }, execFor(workspace))
      const exportTool = b.registered.find(entry => entry.name === 'excalidraw_export')!
      const result = await exportTool.definition.execute({ path: 'docs/diagram.svg' }, execFor(workspace))
      expect((result as { path: string }).path).toMatch(/[\\/]docs[\\/]diagram\.svg$/)
      expect(await readFile((result as { path: string }).path, 'utf8')).toContain('<svg')
      await expect(exportTool.definition.execute({ path: '../evil.svg' }, execFor(workspace))).rejects.toThrow('inside the workspace')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('manages named drawings, elements and layout in the session workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const tool = (name: string) => b.registered.find(entry => entry.name === name)!.definition
      const exec = execFor(workspace)

      const created = await tool('excalidraw_create_drawing').execute({ drawing: 'flow' }, exec)
      expect(created).toMatchObject({ ok: true, drawing: 'flow', elementCount: 0 })

      const elements = await tool('excalidraw_element_create').execute({
        drawing: 'flow',
        elements: [
          { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 },
          { id: 'b', type: 'rectangle', x: 50, y: 20, width: 10, height: 10 },
        ],
      }, exec)
      expect(elements).toMatchObject({ ok: true, drawing: 'flow', added: 2, totalElements: 2 })

      const aligned = await tool('excalidraw_layout').execute({
        drawing: 'flow',
        action: 'align-left',
        ids: ['a', 'b'],
      }, exec)
      expect(aligned).toMatchObject({ ok: true, action: 'align-left', affected: 2 })

      const got = await tool('excalidraw_get_drawing').execute({ drawing: 'flow' }, exec)
      expect((got as { summary: { elementCount: number } }).summary.elementCount).toBe(2)
      expect((got as { description: string }).description).toContain('Drawing "flow": 2 visible elements')

      const listed = await tool('excalidraw_list_drawings').execute({}, exec)
      expect(listed).toMatchObject({ ok: true, count: 1 })
      expect((listed as { drawings: { id: string }[] }).drawings[0]).toMatchObject({ id: 'flow' })

      const exported = await tool('excalidraw_export_to_json').execute({ drawing: 'flow' }, exec)
      expect(exported).toMatchObject({
        ok: true,
        drawing: 'flow',
        path: join(workspace, '.agents', 'excalidraw', 'exports', 'flow.excalidraw'),
      })

      const updated = await tool('excalidraw_update_drawing').execute({
        drawing: 'flow',
        scene: JSON.stringify({ elements: [{ id: 'c', type: 'ellipse', x: 0, y: 0, width: 5, height: 5 }], appState: {} }),
      }, exec)
      expect(updated).toMatchObject({ ok: true, drawing: 'flow', elementCount: 1 })

      const deleted = await tool('excalidraw_delete_drawing').execute({ drawing: 'flow' }, exec)
      expect(deleted).toMatchObject({ ok: true, drawing: 'flow', deleted: true })
      expect((await tool('excalidraw_get_drawing').execute({ drawing: 'flow' }, exec) as { exists: boolean }).exists).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('adds an external image through the plugin tool', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      await mkdir(join(workspace, 'assets'), { recursive: true })
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK8sAAAAASUVORK5CYII=',
        'base64',
      )
      await writeFile(join(workspace, 'assets', 'icon.png'), png)
      const addTool = b.registered.find(entry => entry.name === 'excalidraw_add_image')!
      const added = await addTool.definition.execute({ path: 'assets/icon.png', x: 2, y: 3 }, execFor(workspace))
      expect(added).toMatchObject({ ok: true, width: 1, height: 1, mimeType: 'image/png', totalElements: 1 })
      const scene = JSON.parse(await readFile(join(workspace, SCENE_RELATIVE), 'utf8')) as {
        elements: { type: string; fileId: string }[]
        files: Record<string, unknown>
      }
      expect(scene.elements[0]).toMatchObject({ type: 'image', fileId: (added as { fileId: string }).fileId })
      expect(Object.keys(scene.files)).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  withChrome('screenshot writes a PNG through the plugin tool', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-excalidraw-tool-'))
    try {
      const b = bench()
      const drawTool = b.registered.find(entry => entry.name === 'excalidraw_draw')!
      await drawTool.definition.execute({
        elements: [{ type: 'rectangle', x: 0, y: 0, width: 80, height: 40 }],
      }, execFor(workspace))
      const shotTool = b.registered.find(entry => entry.name === 'excalidraw_screenshot')!
      const result = await shotTool.definition.execute({ path: 'shots/plugin.png' }, execFor(workspace))
      expect(result).toMatchObject({ ok: true, drawing: 'default', path: join(workspace, 'shots', 'plugin.png') })
      const png = await readFile((result as { path: string }).path)
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps default paths and namespaces named drawings', () => {
    expect(defaultExportRelative('svg', 'default')).toBe(join('.agents', 'excalidraw', 'export.svg'))
    expect(defaultExportRelative('png', 'default')).toBe(join('.agents', 'excalidraw', 'export.png'))
    expect(defaultExportRelative('excalidraw', 'default')).toBe(join('.agents', 'excalidraw', 'export.excalidraw'))
    expect(defaultExportRelative('png', 'arch')).toBe(join('.agents', 'excalidraw', 'exports', 'arch.png'))
    expect(defaultScreenshotRelative('default')).toBe(join('.agents', 'excalidraw', 'screenshot.png'))
    expect(defaultScreenshotRelative('arch')).toBe(join('.agents', 'excalidraw', 'screenshots', 'arch.png'))
  })

  it('normalizes safe drawing ids and rejects path escapes', () => {
    expect(normalizeDrawingId()).toBe('default')
    expect(normalizeDrawingId('  arch  ')).toBe('arch')
    for (const id of ['../escape', 'a/b', 'a\\b', '.hidden', '-dash', 'CON', 'lpt9', 'a'.repeat(65)]) {
      expect(() => normalizeDrawingId(id)).toThrow('invalid drawing id')
    }
  })
})
