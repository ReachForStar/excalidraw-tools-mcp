/**
 * MCP tools for whole-scene operations: read/write/import/draw/export. Each
 * tool takes an optional drawing id and defaults to the workspace's default
 * drawing, so existing single-canvas clients keep working.
 * @module excalidraw-mcp/tools/scene
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  DRAWABLE_TYPES,
  drawScene,
  exportScene,
  importScene,
  readScene,
  writeScene,
  type WorkspaceScope,
} from '../../scene.js'
import { drawingSchema, fail, ok, targetOf, workspaceSchema } from './common.js'

/** High-level shape description accepted by `excalidraw_draw`. */
const shapeSchema = z.object({
  type: z.string().describe('One of rectangle/ellipse/diamond/text/arrow/line.'),
  x: z.number().describe('Left edge in canvas pixels.'),
  y: z.number().describe('Top edge in canvas pixels.'),
  width: z.number().describe('Width in canvas pixels.'),
  height: z.number().describe('Height in canvas pixels.'),
  text: z.string().optional().describe('Text content (for type "text"), or a centered label when set on rectangle/ellipse/diamond.'),
  points: z.array(z.array(z.number())).optional().describe('Line/arrow points as [[x,y],...]; defaults to a diagonal across the box.'),
  strokeColor: z.string().optional().describe('Outline color (CSS color).'),
  backgroundColor: z.string().optional().describe('Fill color (CSS color).'),
  fillStyle: z.string().optional().describe('hachure/solid/cross-hatch/zigzag.'),
  strokeWidth: z.number().optional().describe('Outline width in pixels.'),
  opacity: z.number().min(0).max(100).optional().describe('Opacity 0-100.'),
})

/**
 * Register the whole-scene tools.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerSceneTools(server: McpServer, scope: WorkspaceScope): void {
  server.registerTool(
    'excalidraw_read',
    {
      title: 'Read Excalidraw scene',
      description:
          'Read one drawing of a workspace. Returns a summary (visible element counts by '
          + 'type, text elements, theme), a compact `elements` list '
          + '(id/type/x/y/width/height/text/locked/groups) and a structured `description` '
          + 'of the canvas. When the file is small the complete scene JSON is included as '
          + '`sceneJson`. Use `excalidraw_screenshot` for a PNG view. Omit `drawing` for '
          + 'the default drawing.',
      inputSchema: { workspace: workspaceSchema, drawing: drawingSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ workspace, drawing }) => {
      try {
        return ok(await readScene(await targetOf(scope, workspace, drawing)))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_write',
    {
      title: 'Write Excalidraw scene',
      description:
          'Overwrite one drawing from a complete scene JSON string — the shape produced by '
          + '`excalidraw_read`\'s `sceneJson`: an object with `elements` and `appState`. '
          + 'Malformed elements are repaired before saving. A missing scene file is created. '
          + 'Scene size is not capped. Omit `drawing` for the default drawing.',
      inputSchema: {
        scene: z.string().describe('Complete Excalidraw scene JSON (object with `elements` array and `appState` object).'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ scene, workspace, drawing }) => {
      try {
        return ok(await writeScene(await targetOf(scope, workspace, drawing), scene))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_import',
    {
      title: 'Import an Excalidraw file',
      description:
          'Replace one drawing with an Excalidraw file from inside the workspace. Reads '
          + '`<workspace>/<path>` — a native `.excalidraw` document or any JSON scene with '
          + '`elements`/`appState` — repairs malformed elements, keeps embedded image `files`, '
          + 'and writes it as the drawing. Excalidraw libraries are rejected. Omit `drawing` '
          + 'for the default drawing.',
      inputSchema: {
        path: z.string().describe('Workspace-relative path of the file to import (e.g. "docs/flow.excalidraw").'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, workspace, drawing }) => {
      try {
        return ok(await importScene(await targetOf(scope, workspace, drawing), path))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_draw',
    {
      title: 'Draw on Excalidraw canvas',
      description:
          'Draw shapes on one Excalidraw drawing. Describe shapes at a high level — no '
          + 'Excalidraw internals needed. Use it to draw diagrams, flowcharts, or to work a '
          + 'problem on the canvas. `action: "append"` adds to the existing scene; '
          + '`action: "replace"` clears the drawing first. Setting `text` on a rectangle, '
          + 'ellipse, or diamond adds a centered label. Coordinates are in canvas pixels '
          + `(top-left origin); supported types: ${[...DRAWABLE_TYPES].join(', ')}.`,
      inputSchema: {
        elements: z.array(shapeSchema).min(1).max(256).describe('Shapes to draw.'),
        action: z.enum(['append', 'replace']).optional().describe('"append" (default) adds shapes; "replace" clears the canvas first.'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ elements, action, workspace, drawing }) => {
      try {
        return ok(await drawScene(await targetOf(scope, workspace, drawing), elements, action))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_export',
    {
      title: 'Export Excalidraw drawing to SVG, PNG or .excalidraw',
      description:
          'Export one drawing to a file inside the workspace. `format: "svg"` and `"png"` '
          + 'render through Excalidraw\'s own export pipeline in a local headless Chrome, so '
          + 'hand-drawn texture, embedded images and wrapped text are preserved; they need '
          + 'Chrome/Chromium on the host. `format: "excalidraw"` writes the native scene file '
          + '(openable in the Excalidraw app) and needs no browser. Defaults for the default '
          + 'drawing: `.agents/excalidraw/export.svg`, `export.png` or `export.excalidraw`; '
          + 'named drawings default to `.agents/excalidraw/exports/<id>.<ext>`.',
      inputSchema: {
        path: z.string().optional().describe('Workspace-relative output path (e.g. "docs/flow.png"); default depends on `format`.'),
        format: z.enum(['svg', 'png', 'excalidraw']).optional().describe('Output format; default "svg".'),
        scale: z.number().min(0.5).max(4).optional().describe('PNG pixel scale; default 1. Ignored for SVG and .excalidraw.'),
        transparent: z.boolean().optional().describe('When true, the image has a transparent background; default uses the canvas background color. Ignored for .excalidraw.'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { openWorldHint: false },
    },
    async ({ path, format, scale, transparent, workspace, drawing }) => {
      try {
        return ok(await exportScene(await targetOf(scope, workspace, drawing), {
          ...(path !== undefined ? { path } : {}),
          ...(format !== undefined ? { format } : {}),
          ...(scale !== undefined ? { scale } : {}),
          ...(transparent !== undefined ? { transparent } : {}),
        }))
      } catch (error) {
        return fail(error)
      }
    },
  )
}
