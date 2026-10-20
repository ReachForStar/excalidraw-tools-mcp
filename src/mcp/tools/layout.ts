/**
 * MCP layout tool: align, distribute, group, lock and duplicate elements in one
 * drawing. Selection expands to whole groups and attached labels.
 * @module excalidraw-mcp/tools/layout
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { LAYOUT_ACTIONS, layoutScene, type LayoutAction } from '../../elements.js'
import type { WorkspaceScope } from '../../scene.js'
import { drawingSchema, fail, ok, targetOf, workspaceSchema } from './common.js'

/**
 * Register the layout tool.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerLayoutTools(server: McpServer, scope: WorkspaceScope): void {
  server.registerTool(
    'excalidraw_layout',
    {
      title: 'Lay out Excalidraw elements',
      description:
          'Transform a selection of elements in one drawing. Actions: `align-left`, '
          + '`align-center-h`, `align-right`, `align-top`, `align-middle`, `align-bottom`; '
          + '`distribute-h`/`distribute-v` (equal gaps between the outermost elements); '
          + '`group`/`ungroup`; `lock`/`unlock`; `duplicate` (offset by `offsetX`/`offsetY`, '
          + 'default 20,20). Omit `ids` to select every visible element. The selection '
          + 'automatically expands to whole groups and bound text labels. Duplicated groups, '
          + 'labels and arrow bindings are remapped to the copies.',
      inputSchema: {
        action: z.enum(LAYOUT_ACTIONS).describe('Layout action to apply.'),
        ids: z.array(z.string().min(1)).optional().describe('Element ids to transform; omit for all visible elements.'),
        offsetX: z.number().optional().describe('Duplicate horizontal offset; default 20.'),
        offsetY: z.number().optional().describe('Duplicate vertical offset; default 20.'),
        groupIds: z.array(z.string().min(1)).optional().describe('For ungroup: specific group ids to remove; omit to remove all groups from the selection.'),
        drawing: drawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ action, ids, offsetX, offsetY, groupIds, workspace, drawing }) => {
      try {
        return ok(await layoutScene(
          await targetOf(scope, workspace, drawing),
          action as LayoutAction,
          {
            ...(ids !== undefined ? { ids } : {}),
            ...(offsetX !== undefined ? { offsetX } : {}),
            ...(offsetY !== undefined ? { offsetY } : {}),
            ...(groupIds !== undefined ? { groupIds } : {}),
          },
        ))
      } catch (error) {
        return fail(error)
      }
    },
  )
}
