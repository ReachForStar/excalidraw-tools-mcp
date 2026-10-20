import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/mcp/server.ts'
import { closeRenderer, findChrome } from '../src/render.ts'
import { SCENE_RELATIVE, sceneTarget, workspaceScope } from '../src/scene.ts'

// Export tests need a browser; the rest of the suite runs without one.
const CHROME = await findChrome().catch(() => undefined)
const withChrome = it.skipIf(CHROME === undefined)

const workspaces: string[] = []
// Project-local scratch root: tests must not write to the system temp directory.
const TEST_ROOT = join(process.cwd(), 'tmp', 'tests')

/** Fresh workspace directory, removed after each test. */
async function workspace(): Promise<string> {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEST_ROOT, 'mcp-'))
  workspaces.push(dir)
  return dir
}

/** Connected client talking to a server over the in-memory transport pair. */
async function connect(root: string | string[]): Promise<Client> {
  const roots = Array.isArray(root) ? root : [root]
  const server = createMcpServer(workspaceScope(roots))
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  return client
}

/** Parse the JSON document a tool returns in its text block. */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content
  return JSON.parse(content[0]!.text) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

// The headless browser is shared by every export; shut it down so vitest exits.
afterAll(async () => {
  await closeRenderer()
})

describe('excalidraw MCP tools', () => {
  it('lists all drawing, element, layout and media tools with input schemas', async () => {
    const client = await connect(await workspace())
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual([
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
    const draw = tools.find(tool => tool.name === 'excalidraw_draw')
    expect(draw?.inputSchema.required).toEqual(['elements'])
    const read = tools.find(tool => tool.name === 'excalidraw_read')
    expect(read?.annotations?.readOnlyHint).toBe(true)
    await client.close()
  })

  it('draws and reads back a scene', async () => {
    const root = await workspace()
    const client = await connect(root)

    const drawn = await client.callTool({
      name: 'excalidraw_draw',
      arguments: {
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 120, height: 60 },
          { type: 'text', x: 10, y: 90, width: 200, height: 30, text: 'hello mcp' },
          { type: 'arrow', x: 0, y: 0, width: 60, height: 60, points: [[0, 0], [60, 60]] },
        ],
      },
    })
    expect(drawn.isError).toBeFalsy()
    expect(payload(drawn)).toMatchObject({ ok: true, added: 3, totalElements: 3, skipped: 0 })

    const read = payload(await client.callTool({ name: 'excalidraw_read', arguments: {} }))
    expect(read['exists']).toBe(true)
    expect((read['summary'] as { elementCount: number }).elementCount).toBe(3)
    expect((read['summary'] as { byType: Record<string, number> }).byType).toEqual({ rectangle: 1, text: 1, arrow: 1 })
    expect(read['sceneJson']).toBeTypeOf('string')
    await client.close()
  })

  withChrome('exports the scene as SVG through Excalidraw', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: {
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 120, height: 60 },
          { type: 'text', x: 10, y: 90, width: 200, height: 30, text: 'hello mcp' },
        ],
      },
    })

    const exported = payload(await client.callTool({ name: 'excalidraw_export', arguments: { path: 'out/board.svg' } }))
    expect(exported).toMatchObject({ ok: true, format: 'svg', elementCount: 2 })
    expect(exported['width']).toBeGreaterThan(0)
    const svg = await readFile(join(root, 'out/board.svg'), 'utf8')
    // Excalidraw's own exporter marks its output and inlines fonts.
    expect(svg).toContain('svg-source:excalidraw')
    expect(svg).toContain('hello mcp')
    await client.close()
  })

  withChrome('exports a scaled PNG through Excalidraw', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 50, backgroundColor: '#ffc9c9' }] },
    })

    const exported = payload(await client.callTool({
      name: 'excalidraw_export',
      arguments: { format: 'png', scale: 2 },
    }))
    expect(exported).toMatchObject({ ok: true, format: 'png' })
    expect(exported['path']).toBe(join(root, '.agents', 'excalidraw', 'export.png'))
    const png = await readFile(String(exported['path']))
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(exported['width'])
    expect(png.readUInt32BE(20)).toBe(exported['height'])
    await client.close()
  })

  it('exports a native .excalidraw file and imports it back', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: {
        elements: [
          { type: 'rectangle', x: 0, y: 0, width: 100, height: 50, backgroundColor: '#ffc9c9' },
          { type: 'text', x: 0, y: 60, width: 120, height: 30, text: 'native' },
        ],
      },
    })

    const exported = payload(await client.callTool({
      name: 'excalidraw_export',
      arguments: { format: 'excalidraw' },
    }))
    expect(exported).toMatchObject({ ok: true, format: 'excalidraw', elementCount: 2 })
    expect(exported['path']).toBe(join(root, '.agents', 'excalidraw', 'export.excalidraw'))
    expect(exported['width']).toBeUndefined()
    const file = JSON.parse(await readFile(String(exported['path']), 'utf8')) as {
      type: string
      version: number
      source: string
      elements: { id: string }[]
      appState: Record<string, unknown>
    }
    expect(file.type).toBe('excalidraw')
    expect(file.version).toBe(2)
    expect(file.source).toContain('github.com')
    expect(file.elements).toHaveLength(2)
    expect(file.appState).toHaveProperty('gridSize')
    expect(typeof file.appState['viewBackgroundColor']).toBe('string')

    // Replace the canvas, then restore it from the exported file.
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: {
        elements: [{ type: 'ellipse', x: 0, y: 0, width: 10, height: 10 }],
        action: 'replace',
      },
    })
    const replaced = payload(await client.callTool({ name: 'excalidraw_read', arguments: {} }))
    expect((replaced['summary'] as { elementCount: number }).elementCount).toBe(1)

    const imported = payload(await client.callTool({
      name: 'excalidraw_import',
      arguments: { path: '.agents/excalidraw/export.excalidraw' },
    }))
    expect(imported).toMatchObject({
      ok: true,
      elementCount: 2,
      path: join(root, '.agents', 'excalidraw', 'export.excalidraw'),
    })
    expect(imported['bytes']).toBeGreaterThan(0)
    const restored = payload(await client.callTool({ name: 'excalidraw_read', arguments: {} }))
    expect((restored['summary'] as { elementCount: number }).elementCount).toBe(2)
    const onDisk = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as { elements: { id: string }[] }
    expect(onDisk.elements.map(element => element.id)).toEqual(file.elements.map(element => element.id))
    await client.close()
  })

  it('imports embedded image files and keeps them across draws', async () => {
    const root = await workspace()
    const client = await connect(root)
    const document = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [
        { id: 'img', type: 'image', x: 0, y: 0, width: 20, height: 20, fileId: 'file-1', status: 'saved', scale: [1, 1] },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {
        'file-1': { id: 'file-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,iVBORw0KGgo=', created: 1 },
      },
    }
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'image.excalidraw'), JSON.stringify(document), 'utf8')

    expect(payload(await client.callTool({
      name: 'excalidraw_import',
      arguments: { path: 'docs/image.excalidraw' },
    }))).toMatchObject({ ok: true, elementCount: 1 })

    await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'rectangle', x: 30, y: 0, width: 10, height: 10 }] },
    })
    const onDisk = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as {
      elements: { type: string }[]
      files: Record<string, { id: string }>
    }
    expect(onDisk.elements).toHaveLength(2)
    expect(onDisk.files['file-1']).toMatchObject({ id: 'file-1' })
    await client.close()
  })

  it('rejects missing, invalid and out-of-workspace imports', async () => {
    const root = await workspace()
    const client = await connect(root)
    const errorOf = async (path: string): Promise<string> => {
      const result = await client.callTool({ name: 'excalidraw_import', arguments: { path } })
      expect(result.isError).toBe(true)
      return (result.content as { text: string }[])[0]!.text
    }

    expect(await errorOf('nope.excalidraw')).toContain('file not found')

    await writeFile(join(root, 'broken.excalidraw'), '{oops', 'utf8')
    expect(await errorOf('broken.excalidraw')).toContain('not valid JSON')

    await writeFile(join(root, 'not-scene.json'), '{"hello":1}', 'utf8')
    expect(await errorOf('not-scene.json')).toContain('no `elements` array')

    await writeFile(join(root, 'library.excalidraw'), JSON.stringify({ type: 'excalidrawlib', libraryItems: [] }), 'utf8')
    expect(await errorOf('library.excalidraw')).toContain('libraries are not scenes')

    expect(await errorOf('../outside.excalidraw')).toContain('inside the workspace')
    await client.close()
  })

  it('writes a complete scene and repairs malformed elements', async () => {
    const root = await workspace()
    const client = await connect(root)
    const scene = { type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle' }], appState: { theme: 'dark' } }
    const written = payload(await client.callTool({
      name: 'excalidraw_write',
      arguments: { scene: JSON.stringify(scene) },
    }))
    expect(written).toMatchObject({ ok: true, elementCount: 1 })
    const onDisk = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as { elements: Record<string, unknown>[] }
    expect(onDisk.elements[0]).toMatchObject({ id: 'a', version: 1, angle: 0 })
    expect(typeof onDisk.elements[0]!['seed']).toBe('number')
    await client.close()
  })

  it('binds a label to a container and renders it in the SVG', async () => {
    const root = await workspace()
    const client = await connect(root)
    const drawn = await client.callTool({
      name: 'excalidraw_draw',
      arguments: {
        elements: [{ type: 'rectangle', x: 0, y: 0, width: 200, height: 100, text: 'start' }],
        action: 'replace',
      },
    })
    expect(payload(drawn)).toMatchObject({ ok: true, added: 2, totalElements: 2 })

    const onDisk = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as {
      elements: { id: string; type: string; containerId?: string; boundElements?: { id: string }[] }[]
    }
    const container = onDisk.elements.find(element => element.type === 'rectangle')!
    const label = onDisk.elements.find(element => element.type === 'text')!
    expect(label.containerId).toBe(container.id)
    expect(container.boundElements?.[0]?.id).toBe(label.id)

    if (CHROME !== undefined) {
      const exported = payload(await client.callTool({ name: 'excalidraw_export', arguments: {} }))
      const svg = await readFile(String(exported['path']), 'utf8')
      expect(svg).toContain('start')
      expect(svg).toContain('svg-source:excalidraw')
    }
    await client.close()
  })

  it('returns isError with the reason for invalid input', async () => {
    const client = await connect(await workspace())
    const badJson = await client.callTool({ name: 'excalidraw_write', arguments: { scene: '{oops' } })
    expect(badJson.isError).toBe(true)
    expect((badJson.content as { text: string }[])[0]!.text).toContain('not valid JSON')

    const escape = await client.callTool({ name: 'excalidraw_export', arguments: { path: '../evil.svg' } })
    expect(escape.isError).toBe(true)
    expect((escape.content as { text: string }[])[0]!.text).toContain('inside the workspace')

    const emptyExport = await client.callTool({ name: 'excalidraw_export', arguments: {} })
    expect(emptyExport.isError).toBe(true)
    expect((emptyExport.content as { text: string }[])[0]!.text).toContain('no scene to export')
    await client.close()
  })

  it('rejects a draw schema violation before the handler runs', async () => {
    const client = await connect(await workspace())
    const bad = await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'rectangle', x: 0, y: 0, width: 10 }] },
    })
    expect(bad.isError).toBe(true)
    const text = (bad.content as { text: string }[])[0]!.text
    expect(text.toLowerCase()).toMatch(/invalid|required|height/)
    await client.close()
  })

  it('stores the scene at .agents/excalidraw/scene.json', async () => {
    const root = await workspace()
    expect(SCENE_RELATIVE).toBe(join('.agents', 'excalidraw', 'scene.json'))
    expect(sceneTarget(root).scenePath).toBe(join(root, '.agents', 'excalidraw', 'scene.json'))

    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'ellipse', x: 0, y: 0, width: 20, height: 20 }] },
    })
    if (CHROME !== undefined) {
      const exported = payload(await client.callTool({ name: 'excalidraw_export', arguments: {} }))
      expect(exported['path']).toBe(join(root, '.agents', 'excalidraw', 'export.svg'))
    }
    expect(JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8'))).toHaveProperty('elements')
    await client.close()
  })

  it('serves several workspaces from one server', async () => {
    const first = await workspace()
    const second = await workspace()
    const client = await connect([first, second])

    const shape = { type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }
    expect(payload(await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [shape], workspace: second },
    }))).toMatchObject({ ok: true, added: 1, totalElements: 1 })

    expect(payload(await client.callTool({ name: 'excalidraw_read', arguments: {} })))
      .toMatchObject({ exists: false })
    expect(payload(await client.callTool({
      name: 'excalidraw_read',
      arguments: { workspace: second },
    }))).toMatchObject({ exists: true })

    // A relative workspace resolves against the default root.
    const nested = join(first, 'nested')
    await mkdir(nested, { recursive: true })
    expect(payload(await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [shape], workspace: 'nested' },
    }))).toMatchObject({ ok: true })
    await client.close()
  })

  it('rejects a workspace outside the allowed roots', async () => {
    const root = await workspace()
    const outside = await workspace()
    const client = await connect(root)

    const escaped = await client.callTool({
      name: 'excalidraw_read',
      arguments: { workspace: outside },
    })
    expect(escaped.isError).toBe(true)
    expect((escaped.content as { text: string }[])[0]!.text).toContain('outside the allowed roots')

    const missing = await client.callTool({
      name: 'excalidraw_read',
      arguments: { workspace: join(root, 'nope') },
    })
    expect(missing.isError).toBe(true)
    expect((missing.content as { text: string }[])[0]!.text).toContain('does not exist')
    await client.close()
  })

  it('accepts a scene larger than the old write cap and omits the oversized echo', async () => {
    const root = await workspace()
    const client = await connect(root)
    const scene = {
      type: 'excalidraw',
      elements: [{
        id: 'big', type: 'rectangle', x: 0, y: 0, width: 10, height: 10,
        // Unknown element fields survive sanitization, so this pads the file.
        note: 'x'.repeat(1_300_000),
      }],
      appState: {},
    }
    const written = await client.callTool({
      name: 'excalidraw_write',
      arguments: { scene: JSON.stringify(scene) },
    })
    expect(written.isError).toBeFalsy()
    expect(payload(written)).toMatchObject({ ok: true, elementCount: 1 })
    expect((await readFile(join(root, SCENE_RELATIVE), 'utf8')).length).toBeGreaterThan(1_000_000)

    const read = payload(await client.callTool({ name: 'excalidraw_read', arguments: {} }))
    expect(read['sceneJson']).toBeUndefined()
    expect((read['summary'] as { elementCount: number }).elementCount).toBe(1)
    await client.close()
  })

  it('creates, lists, updates, exports and deletes drawings', async () => {
    const root = await workspace()
    const client = await connect(root)

    const created = payload(await client.callTool({
      name: 'excalidraw_create_drawing',
      arguments: { drawing: 'arch' },
    }))
    expect(created).toMatchObject({
      ok: true,
      drawing: 'arch',
      elementCount: 0,
      path: join(root, '.agents', 'excalidraw', 'drawings', 'arch.json'),
    })

    const duplicate = await client.callTool({
      name: 'excalidraw_create_drawing',
      arguments: { drawing: 'arch' },
    })
    expect(duplicate.isError).toBe(true)
    expect((duplicate.content as { text: string }[])[0]!.text).toContain('already exists')

    const invalid = await client.callTool({
      name: 'excalidraw_create_drawing',
      arguments: { drawing: '../escape' },
    })
    expect(invalid.isError).toBe(true)
    expect((invalid.content as { text: string }[])[0]!.text).toContain('invalid drawing id')

    expect(payload(await client.callTool({
      name: 'excalidraw_get_drawing',
      arguments: { drawing: 'arch' },
    }))).toMatchObject({
      drawing: 'arch',
      exists: true,
      description: expect.stringContaining('Drawing "arch": 0 visible elements'),
    })

    const updated = payload(await client.callTool({
      name: 'excalidraw_update_drawing',
      arguments: {
        drawing: 'arch',
        scene: JSON.stringify({
          elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
          appState: {},
        }),
      },
    }))
    expect(updated).toMatchObject({ ok: true, drawing: 'arch', elementCount: 1 })

    const exported = payload(await client.callTool({
      name: 'excalidraw_export_to_json',
      arguments: { drawing: 'arch' },
    }))
    expect(exported).toMatchObject({
      ok: true,
      drawing: 'arch',
      format: 'excalidraw',
      elementCount: 1,
      path: join(root, '.agents', 'excalidraw', 'exports', 'arch.excalidraw'),
    })
    const native = JSON.parse(await readFile(String(exported['path']), 'utf8')) as {
      type: string
      elements: { id: string }[]
    }
    expect(native.type).toBe('excalidraw')
    expect(native.elements.map(element => element.id)).toEqual(['box'])

    const listed = payload(await client.callTool({ name: 'excalidraw_list_drawings', arguments: {} }))
    expect(listed['count']).toBe(1)
    const entries = listed['drawings'] as { id: string; elementCount: number }[]
    expect(entries[0]).toMatchObject({ id: 'arch', elementCount: 1 })

    // The default drawing is addressable explicitly and sorts first.
    expect(payload(await client.callTool({
      name: 'excalidraw_create_drawing',
      arguments: { drawing: 'default' },
    }))).toMatchObject({ drawing: 'default' })
    const withDefault = payload(await client.callTool({ name: 'excalidraw_list_drawings', arguments: {} }))
    expect((withDefault['drawings'] as { id: string }[]).map(entry => entry.id)).toEqual(['default', 'arch'])

    expect(payload(await client.callTool({
      name: 'excalidraw_delete_drawing',
      arguments: { drawing: 'arch' },
    }))).toMatchObject({ ok: true, drawing: 'arch', deleted: true })
    expect(payload(await client.callTool({
      name: 'excalidraw_get_drawing',
      arguments: { drawing: 'arch' },
    }))).toMatchObject({ exists: false })

    const missing = await client.callTool({
      name: 'excalidraw_delete_drawing',
      arguments: { drawing: 'arch' },
    })
    expect(missing.isError).toBe(true)
    expect((missing.content as { text: string }[])[0]!.text).toContain('drawing not found')
    await client.close()
  })

  it('creates, reads, updates and deletes individual elements', async () => {
    const root = await workspace()
    const client = await connect(root)

    const created = payload(await client.callTool({
      name: 'excalidraw_element_create',
      arguments: {
        elements: [
          {
            id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50,
            boundElements: [{ type: 'text', id: 't1' }],
          },
          { id: 't1', type: 'text', x: 10, y: 15, width: 40, height: 20, text: 'label', containerId: 'r1' },
        ],
      },
    }))
    expect(created).toMatchObject({ ok: true, added: 2, ids: ['r1', 't1'], skipped: 0, totalElements: 2 })

    const got = payload(await client.callTool({
      name: 'excalidraw_element_get',
      arguments: { id: 'r1' },
    }))
    expect(got['element']).toMatchObject({ id: 'r1', type: 'rectangle', width: 100 })

    const patched = payload(await client.callTool({
      name: 'excalidraw_element_update',
      arguments: { id: 'r1', patch: { width: 120, backgroundColor: '#ffc9c9' } },
    }))
    const updated = patched['element'] as { width: number; backgroundColor: string; version: number }
    expect(updated).toMatchObject({ width: 120, backgroundColor: '#ffc9c9' })
    expect(updated.version).toBeGreaterThanOrEqual(2)

    const duplicate = await client.callTool({
      name: 'excalidraw_element_create',
      arguments: { elements: [{ id: 'r1', type: 'ellipse', x: 0, y: 0, width: 5, height: 5 }] },
    })
    expect(duplicate.isError).toBe(true)
    expect((duplicate.content as { text: string }[])[0]!.text).toContain('already exists')

    const badImage = await client.callTool({
      name: 'excalidraw_element_create',
      arguments: { elements: [{ type: 'image', x: 0, y: 0, width: 5, height: 5 }] },
    })
    expect(badImage.isError).toBe(true)
    expect((badImage.content as { text: string }[])[0]!.text).toContain('excalidraw_add_image')

    const deleted = payload(await client.callTool({
      name: 'excalidraw_element_delete',
      arguments: { ids: ['r1', 'missing'] },
    }))
    expect(deleted).toMatchObject({
      ok: true,
      deleted: expect.arrayContaining(['r1', 't1']),
      missing: ['missing'],
      totalElements: 0,
    })
    await client.close()
  })

  it('aligns, distributes, groups, locks, duplicates and ungroups', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_element_create',
      arguments: {
        drawing: 'layout',
        elements: [
          { id: 'a', type: 'rectangle', x: 0, y: 10, width: 10, height: 10 },
          { id: 'b', type: 'rectangle', x: 100, y: 50, width: 20, height: 10 },
          { id: 'c', type: 'rectangle', x: 200, y: 30, width: 10, height: 10 },
        ],
      },
    })

    const distributed = payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'distribute-h' },
    }))
    expect(distributed).toMatchObject({ ok: true, action: 'distribute-h', affected: 3 })
    const xs: number[] = []
    for (const id of ['a', 'b', 'c']) {
      const element = payload(await client.callTool({
        name: 'excalidraw_element_get',
        arguments: { drawing: 'layout', id },
      }))['element'] as { x: number }
      xs.push(element.x)
    }
    expect(xs[1]! - (xs[0]! + 10)).toBeCloseTo(85)
    expect(xs[2]! - (xs[1]! + 20)).toBeCloseTo(85)

    const aligned = payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'align-top' },
    }))
    expect(aligned).toMatchObject({ ok: true, affected: 3 })
    for (const id of ['a', 'b', 'c']) {
      const element = payload(await client.callTool({
        name: 'excalidraw_element_get',
        arguments: { drawing: 'layout', id },
      }))['element'] as { y: number }
      expect(element.y).toBe(10)
    }

    const grouped = payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'group', ids: ['a', 'b'] },
    }))
    const groupId = grouped['groupId'] as string
    expect(grouped).toMatchObject({ ok: true, affected: 2 })
    expect(groupId).toMatch(/^group-/)
    for (const id of ['a', 'b']) {
      const element = payload(await client.callTool({
        name: 'excalidraw_element_get',
        arguments: { drawing: 'layout', id },
      }))['element'] as { groupIds: string[] }
      expect(element.groupIds).toContain(groupId)
    }

    // Locking a group member expands to the whole group.
    expect(payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'lock', ids: ['b'] },
    }))).toMatchObject({ ok: true, affected: 2 })
    expect((payload(await client.callTool({
      name: 'excalidraw_element_get',
      arguments: { drawing: 'layout', id: 'b' },
    }))['element'] as { locked: boolean }).locked).toBe(true)
    expect((payload(await client.callTool({
      name: 'excalidraw_element_get',
      arguments: { drawing: 'layout', id: 'a' },
    }))['element'] as { locked: boolean }).locked).toBe(true)

    const duplicated = payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'duplicate', ids: ['a', 'b'], offsetX: 50, offsetY: 60 },
    }))
    const copies = duplicated['ids'] as string[]
    expect(copies).toHaveLength(2)
    const copyGroups: string[] = []
    for (const id of copies) {
      const element = payload(await client.callTool({
        name: 'excalidraw_element_get',
        arguments: { drawing: 'layout', id },
      }))['element'] as { groupIds: string[]; x: number }
      copyGroups.push(...element.groupIds)
      expect(element.x).toBeGreaterThan(0)
    }
    expect(new Set(copyGroups).size).toBe(1)
    expect(copyGroups[0]).not.toBe(groupId)

    const ungrouped = payload(await client.callTool({
      name: 'excalidraw_layout',
      arguments: { drawing: 'layout', action: 'ungroup', ids: copies },
    }))
    expect(ungrouped['removedGroups']).toContain(copyGroups[0])
    await client.close()
  })

  it('adds an external image and keeps it across later draws', async () => {
    const root = await workspace()
    const client = await connect(root)
    await mkdir(join(root, 'assets'), { recursive: true })
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK8sAAAAASUVORK5CYII=',
      'base64',
    )
    await writeFile(join(root, 'assets', 'icon.png'), png)

    const added = payload(await client.callTool({
      name: 'excalidraw_add_image',
      arguments: { path: 'assets/icon.png', x: 5, y: 6 },
    }))
    expect(added).toMatchObject({
      ok: true,
      width: 1,
      height: 1,
      mimeType: 'image/png',
      bytes: png.length,
      totalElements: 1,
    })
    const fileId = added['fileId'] as string
    const elementId = added['elementId'] as string
    expect(fileId).toMatch(/^file-/)
    expect(elementId.length).toBeGreaterThan(0)

    const onDisk = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as {
      elements: { id: string; type: string; fileId: string; x: number; y: number }[]
      files: Record<string, { mimeType: string; dataURL: string }>
    }
    expect(onDisk.elements[0]).toMatchObject({ id: elementId, type: 'image', fileId, x: 5, y: 6 })
    expect(onDisk.files[fileId]).toMatchObject({ mimeType: 'image/png' })
    expect(onDisk.files[fileId]!.dataURL.startsWith('data:image/png;base64,')).toBe(true)

    const scaled = payload(await client.callTool({
      name: 'excalidraw_add_image',
      arguments: { path: 'assets/icon.png', width: 24 },
    }))
    expect(scaled).toMatchObject({ width: 24, height: 24 })

    await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'rectangle', x: 30, y: 0, width: 10, height: 10 }] },
    })
    const afterDraw = JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as {
      files: Record<string, unknown>
    }
    expect(Object.keys(afterDraw.files)).toHaveLength(2)

    const unsupported = await client.callTool({
      name: 'excalidraw_add_image',
      arguments: { path: 'assets/icon.txt' },
    })
    expect(unsupported.isError).toBe(true)
    expect((unsupported.content as { text: string }[])[0]!.text).toContain('unsupported image type')

    const outside = await client.callTool({
      name: 'excalidraw_add_image',
      arguments: { path: '../outside.png' },
    })
    expect(outside.isError).toBe(true)
    expect((outside.content as { text: string }[])[0]!.text).toContain('inside the workspace')
    await client.close()
  })

  it('describes the canvas with ids, geometry and labels', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_element_create',
      arguments: {
        drawing: 'desc',
        elements: [
          {
            id: 'card', type: 'rectangle', x: 20, y: 30, width: 200, height: 100,
            boundElements: [{ type: 'text', id: 'card-label' }],
          },
          { id: 'card-label', type: 'text', x: 60, y: 60, width: 80, height: 20, text: 'Hello', containerId: 'card' },
        ],
      },
    })
    const read = payload(await client.callTool({
      name: 'excalidraw_get_drawing',
      arguments: { drawing: 'desc' },
    }))
    const description = read['description'] as string
    expect(description).toContain('Drawing "desc": 2 visible elements')
    expect(description).toContain('rectangle id=card at (20,30) size 200x100')
    expect(description).toContain('label "Hello"')
    expect(description).toContain('text id=card-label')
    expect(description).toContain('label of card')
    await client.close()
  })

  withChrome('returns a PNG screenshot as an image content block', async () => {
    const root = await workspace()
    const client = await connect(root)
    await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'rectangle', x: 0, y: 0, width: 120, height: 60, backgroundColor: '#ffc9c9' }] },
    })

    const result = await client.callTool({
      name: 'excalidraw_screenshot',
      arguments: { path: 'shots/board.png' },
    })
    expect(result.isError).toBeFalsy()
    const content = result.content as { type: string; text?: string; data?: string; mimeType?: string }[]
    const meta = JSON.parse(content[0]!.text!) as Record<string, unknown>
    expect(meta).toMatchObject({
      ok: true,
      drawing: 'default',
      path: join(root, 'shots', 'board.png'),
      image: 'attached',
    })
    expect(meta['width']).toBeGreaterThan(0)
    expect(content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' })
    const png = Buffer.from(content[1]!.data!, 'base64')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const written = await readFile(String(meta['path']))
    expect(written.equals(png)).toBe(true)
    await client.close()
  })
})
