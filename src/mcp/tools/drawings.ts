/**
 * MCP tools for drawing management: create, read, update, delete, list and
 * export one drawing as native `.excalidraw` JSON.
 * @module excalidraw-mcp/tools/drawings
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createDrawing,
  deleteDrawing,
  exportDrawingToJson,
  listDrawings,
  updateDrawing,
} from '../../drawings.js'
import { readScene, DEFAULT_DRAWING_ID, type SceneTarget, type WorkspaceScope } from '../../scene.js'
import {
  drawingSchema,
  fail,
  ok,
  requiredDrawingSchema,
  targetOf,
  workspaceSchema,
} from './common.js'

/**
 * Register the drawing-management tools.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerDrawingTools(server: McpServer, scope: WorkspaceScope): void {
  // Re-resolving inside the drawing helpers must honour the target the tool
  // already resolved; otherwise an operator scene override leaks into other
  // workspaces of the same server.
  const sceneOverrideOf = (target: SceneTarget): string | undefined =>
    target.drawing === DEFAULT_DRAWING_ID ? target.scenePath : undefined
  server.registerTool(
    'excalidraw_create_drawing',
    {
      title: 'Create an Excalidraw drawing',
      description:
          'Create a new drawing in a workspace. Omit `drawing` to generate an id '
          + '(`drawing-<hex>`); pass one to choose it (letters, digits, "-" or "_", 1-64 '
          + 'characters). The drawing starts empty unless `scene` supplies a complete scene '
          + 'JSON. An existing drawing is never overwritten. The default drawing id is '
          + '`default` and maps to `.agents/excalidraw/scene.json`.',
      inputSchema: {
        drawing: z.string().optional().describe('Optional drawing id to create; omit to generate one.'),
        scene: z.string().optional().describe('Optional complete scene JSON (`elements` array + `appState` object) to initialize the drawing.'),
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    async ({ drawing, scene, workspace }) => {
      try {
        const target = await targetOf(scope, workspace)
        return ok(await createDrawing(target.workspace, drawing, scene, sceneOverrideOf(target)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_get_drawing',
    {
      title: 'Get an Excalidraw drawing',
      description:
          'Read one drawing by id: summary, compact elements, structured description and '
          + 'the full scene JSON when small. Omit `drawing` for the default drawing. Use '
          + '`excalidraw_element_get` when you already know the element id.',
      inputSchema: {
        drawing: drawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ drawing, workspace }) => {
      try {
        return ok(await readScene(await targetOf(scope, workspace, drawing)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_update_drawing',
    {
      title: 'Update an Excalidraw drawing',
      description:
          'Replace the content of an existing drawing from a complete scene JSON string. '
          + 'The drawing must already exist; use `excalidraw_create_drawing` for a new one. '
          + 'Malformed elements are repaired before saving.',
      inputSchema: {
        drawing: requiredDrawingSchema,
        scene: z.string().describe('Complete scene JSON (`elements` array + `appState` object).'),
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ drawing, scene, workspace }) => {
      try {
        const target = await targetOf(scope, workspace, drawing)
        return ok(await updateDrawing(target.workspace, target.drawing, scene, sceneOverrideOf(target)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_delete_drawing',
    {
      title: 'Delete an Excalidraw drawing',
      description:
          'Delete one drawing file by id. Deleting the default drawing removes '
          + '`.agents/excalidraw/scene.json`; it then reads as an empty canvas. The '
          + 'workspace directory itself is kept.',
      inputSchema: {
        drawing: requiredDrawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ drawing, workspace }) => {
      try {
        const target = await targetOf(scope, workspace, drawing)
        return ok(await deleteDrawing(target.workspace, target.drawing, sceneOverrideOf(target)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_list_drawings',
    {
      title: 'List Excalidraw drawings',
      description:
          'List every drawing in a workspace: the default drawing when it exists, then '
          + 'named drawings under `.agents/excalidraw/drawings/`. Each entry reports element '
          + 'counts by type, file size and modification time.',
      inputSchema: { workspace: workspaceSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workspace }) => {
      try {
        const target = await targetOf(scope, workspace)
        return ok(await listDrawings(target.workspace, sceneOverrideOf(target)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_export_to_json',
    {
      title: 'Export an Excalidraw drawing to JSON',
      description:
          'Write one drawing as a native `.excalidraw` JSON file inside the workspace. '
          + 'Named drawings default to `.agents/excalidraw/exports/<id>.excalidraw`; the '
          + 'default drawing defaults to `.agents/excalidraw/export.excalidraw`. No browser '
          + 'is needed.',
      inputSchema: {
        drawing: drawingSchema,
        path: z.string().optional().describe('Workspace-relative output path; default depends on the drawing id.'),
        workspace: workspaceSchema,
      },
      annotations: { openWorldHint: false },
    },
    async ({ drawing, path, workspace }) => {
      try {
        const target = await targetOf(scope, workspace, drawing)
        return ok(await exportDrawingToJson(target.workspace, target.drawing, path, sceneOverrideOf(target)))
      } catch (error) {
        return fail(error)
      }
    },
  )
}
