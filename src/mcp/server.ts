/**
 * MCP server assembly: one server instance exposes the five scene tools over a
 * workspace scope, so a single process can serve several workspaces. The server
 * is transport-agnostic, so the same factory serves stdio, Streamable HTTP, and
 * in-memory tests.
 * @module excalidraw-mcp/server
 */

import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkspaceScope } from '../scene.js'
import { registerSceneTools } from './tools.js'

const require = createRequire(import.meta.url)
// Same depth in source (src/mcp) and build output (lib/mcp).
const pkg = require('../../package.json') as { name: string; version: string }

/** Instructions sent to clients during initialization. */
const INSTRUCTIONS =
  'Excalidraw scene tools. `excalidraw_draw` is the everyday path: describe shapes at a '
  + 'high level and the server fills the rendering fields. `excalidraw_read` inspects the '
  + 'canvas, `excalidraw_write` replaces the whole scene, `excalidraw_import` loads a '
  + '`.excalidraw` file from the workspace, and `excalidraw_export` writes SVG, PNG or a '
  + 'native `.excalidraw` file (images need Chrome). Every tool takes an optional '
  + '`workspace` argument: one server serves several workspaces, and the argument selects '
  + 'which one.'

/**
 * Create an MCP server exposing the scene tools.
 * @param scope - workspace roots the tools may operate on; the first is the default.
 * @returns a server ready to connect to a transport.
 */
export function createMcpServer(scope: WorkspaceScope): McpServer {
  const server = new McpServer(
    { name: 'excalidraw-mcp', version: pkg.version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )
  registerSceneTools(server, scope)
  return server
}

/** Package name, exported for `--version` output. */
export const PACKAGE_NAME = pkg.name

/** Package version, exported for `--version` output and the MCP handshake. */
export const PACKAGE_VERSION = pkg.version
