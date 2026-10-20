/**
 * MCP server assembly: one server instance exposes the scene, drawing, element,
 * layout and media tools over a workspace scope, so a single process can serve
 * several workspaces and drawings. The server is transport-agnostic, so the same
 * factory serves stdio, Streamable HTTP, and in-memory tests.
 * @module excalidraw-mcp/server
 */

import { createRequire } from 'node:module'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkspaceScope } from '../scene.js'
import { registerAllTools } from './tools.js'

const require = createRequire(import.meta.url)
// Same depth in source (src/mcp) and build output (lib/mcp).
const pkg = require('../../package.json') as { name: string; version: string }

/** Instructions sent to clients during initialization. */
const INSTRUCTIONS =
  'Excalidraw drawing tools. `excalidraw_draw` is the everyday path: describe shapes at a '
  + 'high level and the server fills the rendering fields. `excalidraw_read` returns a '
  + 'structured description of the canvas and `excalidraw_screenshot` returns a PNG you can '
  + 'look at. `excalidraw_element_*` performs raw element CRUD, `excalidraw_layout` aligns, '
  + 'distributes, groups, locks and duplicates, `excalidraw_add_image` places an image file, '
  + 'and `excalidraw_create_drawing`/`get`/`update`/`delete`/`list_drawings` manage several '
  + 'drawings per workspace. `excalidraw_import`, `excalidraw_write` and `excalidraw_export` '
  + 'remain available for whole scenes; `excalidraw_export_to_json` writes native '
  + '`.excalidraw` JSON. Every tool takes an optional `workspace`, and canvas tools take an '
  + 'optional `drawing`: one server serves several workspaces, and drawings default to the '
  + 'workspace scene.'

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
  registerAllTools(server, scope)
  return server
}

/** Package name, exported for `--version` output. */
export const PACKAGE_NAME = pkg.name

/** Package version, exported for `--version` output and the MCP handshake. */
export const PACKAGE_VERSION = pkg.version
