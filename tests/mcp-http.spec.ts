import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHttpServer, type RunningHttpServer } from '../src/mcp/http.ts'
import { workspaceScope } from '../src/scene.ts'

const cleanups: (() => Promise<void>)[] = []
// Project-local scratch root: tests must not write to the system temp directory.
const TEST_ROOT = join(process.cwd(), 'tmp', 'tests')

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

/** Start a server on a free port and register its teardown. */
async function serve(root: string, token?: string): Promise<RunningHttpServer> {
  const running = await startHttpServer({
    scope: workspaceScope([root]),
    host: '127.0.0.1',
    port: 0,
    ...(token !== undefined ? { token } : {}),
  })
  cleanups.push(() => running.close())
  return running
}

/** Temporary workspace, removed after each test. */
async function workspace(): Promise<string> {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEST_ROOT, 'http-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}

describe('excalidraw MCP over Streamable HTTP', () => {
  it('serves tool calls statelessly over POST /mcp', async () => {
    const running = await serve(await workspace())
    const client = new Client({ name: 'http-test', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url)))
    cleanups.push(() => client.close())

    const { tools } = await client.listTools()
    expect(tools).toHaveLength(18)
    const drawn = await client.callTool({
      name: 'excalidraw_draw',
      arguments: { elements: [{ type: 'ellipse', x: 5, y: 5, width: 40, height: 40 }] },
    })
    expect(drawn.isError).toBeFalsy()
    const read = await client.callTool({ name: 'excalidraw_read', arguments: {} })
    const text = (read.content as { text: string }[])[0]!.text
    expect(JSON.parse(text)).toMatchObject({ exists: true, summary: { elementCount: 1 } })
  })

  it('rejects requests without the configured bearer token', async () => {
    const running = await serve(await workspace(), 'secret-token')
    const response = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(response.status).toBe(401)

    const client = new Client({ name: 'http-test', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(running.url), {
      requestInit: { headers: { authorization: 'Bearer secret-token' } },
    }))
    cleanups.push(() => client.close())
    expect((await client.listTools()).tools).toHaveLength(18)
  })

  it('answers unknown paths with 404 and non-POST methods with 405', async () => {
    const running = await serve(await workspace())
    const notFound = await fetch(running.url.replace('/mcp', '/other'), { method: 'POST' })
    expect(notFound.status).toBe(404)
    const notAllowed = await fetch(running.url, { method: 'GET' })
    expect(notAllowed.status).toBe(405)
    expect(notAllowed.headers.get('allow')).toBe('POST')
  })

  it('refuses a non-loopback bind without a bearer token', async () => {
    const root = await workspace()
    await expect(startHttpServer({
      scope: workspaceScope([root]),
      host: '0.0.0.0',
      port: 0,
    })).rejects.toThrow('without --token')
  })

  it('rejects request bodies above the configured ceiling', async () => {
    const root = await workspace()
    const running = await startHttpServer({
      scope: workspaceScope([root]),
      host: '127.0.0.1',
      port: 0,
      maxBodyBytes: 64,
    })
    cleanups.push(() => running.close())
    const response = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: 'x'.repeat(200),
    })
    expect(response.status).toBe(413)
  })

  it('rejects browser origins that are not loopback', async () => {
    const running = await serve(await workspace())
    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    expect(response.status).toBe(403)
  })

  it('reports a wildcard bind as loopback in its URL', async () => {
    const root = await workspace()
    const running = await startHttpServer({
      scope: workspaceScope([root]),
      host: '0.0.0.0',
      port: 0,
      token: 'wildcard-test',
    })
    cleanups.push(() => running.close())
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })
})
