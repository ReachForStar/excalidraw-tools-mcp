/**
 * MCP tool surface for an Excalidraw scene. Each tool maps one-to-one onto the
 * core scene operations and returns a JSON document as a text content block;
 * tool failures come back as `isError` results so a client can show the reason
 * without treating the call as a transport fault.
 * @module excalidraw-mcp/tools
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  DRAWABLE_TYPES,
  drawScene,
  exportScene,
  readScene,
  writeScene,
  type SceneTarget,
} from '../scene.js'

/** Result shape a tool handler returns to the MCP layer. */
type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/** Wrap a successful value as a JSON text result. */
function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Wrap a failure as an `isError` result with the error message. */
function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: message }], isError: true }
}

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
 * Register the four scene tools on an MCP server bound to one scene target.
 * @param server - the MCP server to register on.
 * @param target - workspace root and scene file the tools operate on.
 */
export function registerSceneTools(server: McpServer, target: SceneTarget): void {
  server.registerTool(
    'excalidraw_read',
    {
      title: 'Read Excalidraw scene',
      description:
          'Read the Excalidraw canvas scene. Returns a summary (element counts by type, '
          + 'text elements, theme), a compact `elements` list (id/type/x/y/width/height/text) '
          + 'so you can reason about what is on the canvas, and the complete scene JSON in '
          + '`sceneJson` when the file is small. Use `excalidraw_draw` to add shapes, or '
          + '`excalidraw_write` to replace the scene.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await readScene(target))
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
          'Overwrite the Excalidraw canvas scene from a complete scene JSON string — the '
          + 'shape produced by `excalidraw_read`\'s `sceneJson`: an object with `elements` '
          + 'and `appState`. Malformed elements are repaired before saving. A missing scene '
          + 'file is created.',
      inputSchema: {
        scene: z.string().describe('Complete Excalidraw scene JSON (object with `elements` array and `appState` object).'),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ scene }) => {
      try {
        return ok(await writeScene(target, scene))
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
          'Draw shapes on the Excalidraw canvas. Describe shapes at a high level — no '
          + 'Excalidraw internals needed. Use it to draw diagrams, flowcharts, or to work a '
          + 'problem on the canvas. `action: "append"` adds to the existing scene; '
          + '`action: "replace"` clears the canvas first. Setting `text` on a rectangle, '
          + 'ellipse, or diamond adds a centered label. Coordinates are in canvas pixels '
          + `(top-left origin); supported types: ${[...DRAWABLE_TYPES].join(', ')}.`,
      inputSchema: {
        elements: z.array(shapeSchema).min(1).max(256).describe('Shapes to draw.'),
        action: z.enum(['append', 'replace']).optional().describe('"append" (default) adds shapes; "replace" clears the canvas first.'),
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ elements, action }) => {
      try {
        return ok(await drawScene(target, elements, action))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_export',
    {
      title: 'Export Excalidraw scene to SVG',
      description:
          'Export the Excalidraw canvas to an SVG file inside the workspace (pure node-side '
          + 'rendering — no browser needed). Writes `<workspace>/<path>` (default '
          + '`.agents/excalidraw/export.svg`). The SVG uses flat fills/strokes (no hand-drawn '
          + 'texture); text keeps its content and font size.',
      inputSchema: {
        path: z.string().optional().describe('Workspace-relative output path (e.g. "docs/flow.svg"); default ".agents/excalidraw/export.svg".'),
        transparent: z.boolean().optional().describe('When true, the SVG has a transparent background; default uses the canvas background color.'),
      },
      annotations: { openWorldHint: false },
    },
    async ({ path, transparent }) => {
      try {
        return ok(await exportScene(target, {
          ...(path !== undefined ? { path } : {}),
          ...(transparent !== undefined ? { transparent } : {}),
        }))
      } catch (error) {
        return fail(error)
      }
    },
  )
}
