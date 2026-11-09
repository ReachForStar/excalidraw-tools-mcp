/**
 * Streamable HTTP transport for the MCP server. Stateless: every POST carries a
 * complete JSON-RPC exchange, so one server plus one transport is created per
 * request and no session state survives between calls. That keeps concurrent
 * agents independent and avoids session bookkeeping.
 *
 * The listener binds to loopback by default; a non-loopback `--host` requires a
 * bearer token, and browser origins are limited to loopback hosts so a DNS
 * rebinding page cannot drive the server.
 * @module excalidraw-mcp/http
 */

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpServer } from './server.js'
import type { WorkspaceScope } from '../scene.js'

/** Default ceiling for one JSON-RPC request body (64 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024
/** Requests accepted in parallel before new ones get 429. */
const MAX_CONCURRENT_REQUESTS = 32
/** Whole-request budget; long exports still fit. */
const REQUEST_TIMEOUT_MS = 300_000
/** Slow clients sending headers must not hold a socket forever. */
const HEADERS_TIMEOUT_MS = 15_000

/** Options for {@link startHttpServer}. */
export interface HttpServerOptions {
  readonly scope: WorkspaceScope
  readonly host: string
  readonly port: number
  readonly token?: string
  /** Request body ceiling in bytes; defaults to {@link DEFAULT_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number
}

/** A running HTTP listener. */
export interface RunningHttpServer {
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

/** Reply with a JSON-RPC error envelope. */
function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
}

/** True for addresses that only accept local connections. */
function isLoopbackHost(host: string): boolean {
  const value = host.toLowerCase()
  return value === 'localhost' || value === '::1' || value.startsWith('127.')
}

/** True when a browser origin (if any) points back at loopback. */
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    return isLoopbackHost(new URL(origin).hostname)
  } catch {
    return false
  }
}

/** Constant-time bearer check; a missing header still costs one comparison. */
function tokenMatches(provided: string | undefined, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`, 'utf8')
  if (provided === undefined) {
    timingSafeEqual(expected, expected)
    return false
  }
  const actual = Buffer.from(provided, 'utf8')
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(actual, expected)
}

/** A wildcard bind address is not directly reachable; show loopback instead. */
function formatHostForUrl(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::' || host === '0:0:0:0:0:0:0:0') return '[::1]'
  return isIP(host) === 6 || host.includes(':') ? `[${host}]` : host
}

/** Body too large; the request stream has been destroyed. */
class PayloadTooLargeError extends Error {}

/** Read the request body with a hard ceiling, so chunked requests are bounded too. */
async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > limit) {
    throw new PayloadTooLargeError(`request body exceeds ${limit} bytes`)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > limit) {
      throw new PayloadTooLargeError(`request body exceeds ${limit} bytes`)
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.length === 0 ? undefined : JSON.parse(text)
}

/**
 * Start the Streamable HTTP listener.
 * @param options - workspace scope, bind address, port (0 picks a free port),
 * optional bearer token and body ceiling.
 * @returns the reachable URL and a close function.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const { scope, host, port, token } = options
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  if (!isLoopbackHost(host) && token === undefined) {
    throw new Error(
      `refusing to listen on ${host} without --token: a non-loopback HTTP listener must require a bearer token`,
    )
  }
  let inFlight = 0

  const httpServer: Server = createServer((req, res) => {
    if (inFlight >= MAX_CONCURRENT_REQUESTS) {
      sendJsonRpcError(res, 429, -32000, 'Too many concurrent requests')
      return
    }
    inFlight += 1
    void handle(req, res)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`excalidraw-mcp: unhandled request error: ${message}\n`)
        sendJsonRpcError(res, 500, -32603, 'Internal error')
      })
      .finally(() => {
        inFlight -= 1
      })
  })
  httpServer.requestTimeout = REQUEST_TIMEOUT_MS
  httpServer.headersTimeout = HEADERS_TIMEOUT_MS

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname
    if (pathname !== '/mcp') {
      sendJsonRpcError(res, 404, -32601, 'Not found — the MCP endpoint is /mcp')
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'POST')
      sendJsonRpcError(res, 405, -32600, 'Method not allowed — use POST')
      return
    }
    if (!isLoopbackOrigin(req.headers.origin)) {
      sendJsonRpcError(res, 403, -32600, 'Forbidden origin')
      return
    }
    if (token !== undefined && !tokenMatches(req.headers.authorization, token)) {
      sendJsonRpcError(res, 401, -32600, 'Unauthorized')
      return
    }
    let parsedBody: unknown
    try {
      parsedBody = await readBody(req, maxBodyBytes)
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        // The body is not consumed; close instead of pooling the socket.
        res.setHeader('connection', 'close')
        sendJsonRpcError(res, 413, -32600, 'Request body too large')
        return
      }
      if (error instanceof SyntaxError) {
        sendJsonRpcError(res, 400, -32700, 'Parse error')
        return
      }
      throw error
    }
    const server = createMcpServer(scope)
    // Omitted `sessionIdGenerator` selects stateless mode: the transport serves
    // exactly one request, hence a fresh server/transport pair per POST.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    // Tear down the per-request pair when the socket closes, whether or not the
    // request completed, so nothing accumulates across calls. Both closes may
    // reject on a dropped connection; log nothing but keep the process alive.
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void server.close().catch(() => undefined)
    })
    try {
      await server.connect(transport as unknown as Transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`excalidraw-mcp: request failed: ${message}\n`)
      sendJsonRpcError(res, 500, -32603, 'Internal error')
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject)
      // Keep a resident handler: an unhandled 'error' event would kill the process.
      httpServer.on('error', (error: Error) => {
        process.stderr.write(`excalidraw-mcp: server error: ${error.message}\n`)
      })
      resolve()
    })
  })
  const address = httpServer.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port
  return {
    url: `http://${formatHostForUrl(host)}:${boundPort}/mcp`,
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close(error => (error === undefined ? resolve() : reject(error)))
      // Keep-alive sockets would otherwise hold the listener open.
      httpServer.closeAllConnections()
    }),
  }
}