import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/mcp/server.ts'
import { SCENE_RELATIVE, sceneTarget } from '../src/scene.ts'

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
async function connect(root: string): Promise<Client> {
  const server = createMcpServer(sceneTarget(root))
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

describe('excalidraw MCP tools', () => {
  it('lists the four scene tools with input schemas', async () => {
    const client = await connect(await workspace())
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'excalidraw_draw',
      'excalidraw_export',
      'excalidraw_read',
      'excalidraw_write',
    ])
    const draw = tools.find(tool => tool.name === 'excalidraw_draw')
    expect(draw?.inputSchema.required).toEqual(['elements'])
    const read = tools.find(tool => tool.name === 'excalidraw_read')
    expect(read?.annotations?.readOnlyHint).toBe(true)
    await client.close()
  })

  it('draws, reads back, and exports a scene', async () => {
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

    const exported = payload(await client.callTool({ name: 'excalidraw_export', arguments: { path: 'out/board.svg' } }))
    expect(exported['ok']).toBe(true)
    const svg = await readFile(join(root, 'out/board.svg'), 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('hello mcp')
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

    const exported = payload(await client.callTool({ name: 'excalidraw_export', arguments: {} }))
    const svg = await readFile(String(exported['path']), 'utf8')
    expect(svg).toContain('>start<')
    // Opacity is stored 0-100 and emitted 0-1; a unit bug used to flatten every shape.
    expect(svg).toContain('opacity="1"')
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
})
