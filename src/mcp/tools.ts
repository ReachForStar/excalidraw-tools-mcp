/**
 * MCP tool surface for Excalidraw drawings. Tools are grouped by domain and
 * registered on one server: scene operations, drawing management, element CRUD,
 * layout transforms and media (image/screenshot). Every tool takes an optional
 * `workspace`; canvas tools take an optional `drawing`, so one process serves
 * several workspaces and drawings.
 * @module excalidraw-mcp/tools
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { WorkspaceScope } from '../scene.js'
import { registerDrawingTools } from './tools/drawings.js'
import { registerElementTools } from './tools/elements.js'
import { registerLayoutTools } from './tools/layout.js'
import { registerMediaTools } from './tools/media.js'
import { registerSceneTools } from './tools/scene.js'

export { registerDrawingTools } from './tools/drawings.js'
export { registerElementTools } from './tools/elements.js'
export { registerLayoutTools } from './tools/layout.js'
export { registerMediaTools } from './tools/media.js'
export { registerSceneTools } from './tools/scene.js'

/**
 * Register every Excalidraw tool on an MCP server bound to a workspace scope.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerAllTools(server: McpServer, scope: WorkspaceScope): void {
  registerSceneTools(server, scope)
  registerDrawingTools(server, scope)
  registerElementTools(server, scope)
  registerLayoutTools(server, scope)
  registerMediaTools(server, scope)
}
