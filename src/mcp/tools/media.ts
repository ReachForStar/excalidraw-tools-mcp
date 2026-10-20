/**
 * MCP media tools: place an external image on the canvas and render a PNG
 * screenshot of the drawing. Screenshots return a real MCP image block so an
 * agent can look at the canvas.
 * @module excalidraw-mcp/tools/media
 */

import { readFile } from 'node:fs/promises'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { addImage } from '../../elements.js'
import { screenshotScene, type WorkspaceScope } from '../../scene.js'
import { drawingSchema, fail, ok, okWithImage, targetOf, workspaceSchema } from './common.js'

/**
 * Register the media tools.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerMediaTools(server: McpServer, scope: WorkspaceScope): void {
  server.registerTool(
    'excalidraw_add_image',
    {
      title: 'Add an image to the Excalidraw canvas',
      description:
          'Place an image file from inside the workspace on the drawing as a native '
          + 'Excalidraw image element — useful for icons, logos and reference pictures. '
          + 'Supports png, jpeg, gif, webp and svg. Dimensions come from the file; passing '
          + 'only `width` or only `height` keeps the aspect ratio. The binary is embedded in '
          + 'the scene `files`, so the drawing stays self-contained. Omit `drawing` for the '
          + 'default drawing.',
      inputSchema: {
        path: z.string().min(1).describe('Workspace-relative path of the image (e.g. "assets/icon.png").'),
        x: z.number().optional().describe('Left edge in canvas pixels; default 0.'),
        y: z.number().optional().describe('Top edge in canvas pixels; default 0.'),
        width: z.number().positive().optional().describe('Display width; defaults to the intrinsic width.'),
        height: z.number().positive().optional().describe('Display height; defaults to the intrinsic height.'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, x, y, width, height, workspace, drawing }) => {
      try {
        return ok(await addImage(await targetOf(scope, workspace, drawing), {
          path,
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        }))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_screenshot',
    {
      title: 'Screenshot the Excalidraw canvas',
      description:
          'Render one drawing to a PNG screenshot inside the workspace and return the image '
          + 'itself, so you can see the canvas. Rendering uses Excalidraw\'s own exporter in '
          + 'a local headless Chrome (Chrome/Chromium is required). With '
          + '`transparent: true` the background is transparent. The PNG is also written to '
          + '`<path>` (default `.agents/excalidraw/screenshot.png`, named drawings use '
          + '`.agents/excalidraw/screenshots/<id>.png`). Omit `drawing` for the default '
          + 'drawing.',
      inputSchema: {
        path: z.string().optional().describe('Workspace-relative output path; default depends on the drawing id.'),
        scale: z.number().min(0.5).max(4).optional().describe('PNG pixel scale; default 1.'),
        transparent: z.boolean().optional().describe('When true, render a transparent background.'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ path, scale, transparent, workspace, drawing }) => {
      try {
        const result = await screenshotScene(await targetOf(scope, workspace, drawing), {
          ...(path !== undefined ? { path } : {}),
          ...(scale !== undefined ? { scale } : {}),
          ...(transparent !== undefined ? { transparent } : {}),
        })
        const data = await readFile(result.path)
        return okWithImage(result, data, 'image/png')
      } catch (error) {
        return fail(error)
      }
    },
  )
}
