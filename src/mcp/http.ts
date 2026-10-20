/**
 * Streamable HTTP transport for the MCP server. Stateless: every POST carries a
 * complete JSON-RPC exchange, so one server plus one transport is created per
 * request and no session state survives between calls. That keeps concurrent
 * agents independent and avoids session bookkeeping.
 *
 * The listener binds to loopback by default; exposing it on another interface
 * requires an explicit `--host` and, for anything beyond a trusted network, a
 * bearer token.
 * @module excalidraw-mcp/http
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createMcpServer } from './server.js'
import type { WorkspaceScope } from '../scene.js'

/** Options for {@link startHttpServer}. */
export interface HttpServerOptions {
  readonly scope: WorkspaceScope
  readonly host: string
  readonly port: number
  readonly token?: string
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

/**
 * Start the Streamable HTTP listener.
 * @param options - workspace scope, bind address, port (0 picks a free port), and optional bearer token.
 * @returns the reachable URL and a close function.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const { scope, host, port, token } = options
  const httpServer: Server = createServer((req, res) => { void handle(req, res) })

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
    if (token !== undefined && req.headers.authorization !== `Bearer ${token}`) {
      sendJsonRpcError(res, 401, -32600, 'Unauthorized')
      return
    }
    const server = createMcpServer(scope)
    // Omitted `sessionIdGenerator` selects stateless mode: the transport serves
    // exactly one request, hence a fresh server/transport pair per POST.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    // Tear down the per-request pair when the socket closes, whether or not the
    // request completed, so nothing accumulates across calls.
    res.on('close', () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport as unknown as Transport)
      await transport.handleRequest(req, res)
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
      resolve()
    })
  })
  const address = httpServer.address()
  const boundPort = typeof address === 'object' && address !== null ? address.port : port
  return {
    url: `http://${host}:${boundPort}/mcp`,
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => {
      httpServer.close(error => (error === undefined ? resolve() : reject(error)))
      // Keep-alive sockets would otherwise hold the listener open.
      httpServer.closeAllConnections()
    }),
  }
}
