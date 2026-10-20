/**
 * Cordis plugin mounting the five Excalidraw scene tools into a host's tool
 * registry. The scene logic lives in `./scene.ts` and is shared with the MCP
 * server (`src/mcp.ts`), which serves the same tools to any MCP client.
 *
 *  - `excalidraw_read`   → scene summary + full JSON when the file is small.
 *  - `excalidraw_write`  → overwrite the workspace scene from a JSON string.
 *  - `excalidraw_import` → replace the scene with a `.excalidraw` file.
 *  - `excalidraw_draw`   → add/replace shapes from a high-level description.
 *  - `excalidraw_export` → write the scene as SVG, PNG or `.excalidraw`.
 *
 * The target workspace comes from the calling agent's session; a non-agent
 * caller has no owning workspace and is rejected.
 * @module @reachforstar/excalidraw-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
// Type-only: pulls the tools registry Context merge (ctx.tools).
import type {} from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_EXPORT_RELATIVE,
  drawScene,
  exportScene,
  importScene,
  readScene,
  sceneTarget,
  writeScene,
} from './scene.js'

export {
  DEFAULT_EXPORT_FILE_RELATIVE,
  DEFAULT_EXPORT_RELATIVE,
  DRAW_MAX_ELEMENTS,
  SCENE_RELATIVE,
  sanitizeScene,
  sceneToSvg,
} from './scene.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-excalidraw'

/** Services required by the Excalidraw scene tools. */
export const inject = ['tools']

/** Find the workspace owning the calling session, if any. */
function workspaceOf(ctx: Context, sessionId: unknown): Workspace | undefined {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof sessionId !== 'string') return undefined
  return registry.list().find(workspace => workspace.sessionIds.includes(sessionId as never))
}

/** Resolve the scene target from the calling session's workspace or cwd. */
function targetOf(
  ctx: Context,
  exec: { agent?: { session: { id: unknown; header: { cwd?: string } } } },
) {
  const workspace = workspaceOf(ctx, exec.agent?.session.id)
  if (workspace !== undefined) return sceneTarget(workspace.path)
  const cwd = exec.agent?.session.header.cwd
  return cwd === undefined || cwd.length === 0 ? undefined : sceneTarget(cwd)
}

/**
 * Register the five Excalidraw scene tools into the composed tool registry.
 * @param ctx - Host context with the tools and workspaceRegistry services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposeRead = ctx.tools.register(defineTool({
      name: 'excalidraw_read',
      description:
          'Read the current workspace\'s Excalidraw canvas scene. Returns a summary '
          + '(element counts by type, text elements, theme), a compact `elements` list '
          + '(id/type/x/y/width/height/text) so you can reason about what is on the '
          + 'canvas, and the complete scene JSON string in `sceneJson` when small. Use '
          + '`excalidraw_draw` to add shapes, or `excalidraw_write` to replace the scene.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cwd: { type: 'string', required: true, description: 'Workspace directory owning the scene.' },
            exists: { type: 'boolean', required: true, description: 'Whether a scene file exists yet.' },
            summary: {
              type: 'object',
              additionalProperties: false,
              required: true,
              description: 'Scene summary for model consumption.',
              properties: {
                elementCount: { type: 'integer', required: true },
                byType: { type: 'object', additionalProperties: true, required: true, description: 'Element counts grouped by type.' },
                textElements: {
                  type: 'array',
                  required: true,
                  description: 'Text elements with id/text/position.',
                  items: { type: 'object', additionalProperties: true },
                },
                theme: { type: 'string', required: true },
                viewBackgroundColor: { type: 'string', required: true },
              },
            },
            elements: {
              type: 'array',
              required: true,
              description: 'Compact element list: id/type/x/y/width/height/text per element.',
              items: { type: 'object', additionalProperties: true },
            },
            sceneJson: {
              type: 'string',
              description: 'Complete scene JSON (absent when the scene is too large or missing).',
            },
            error: { type: 'string', description: 'Present when the scene file is corrupted.' },
          },
        },
        render: (_args, value) => {
          const summary = value['summary']
          const count = typeof summary['elementCount'] === 'number' ? summary['elementCount'] : 0
          const hasJson = typeof value['sceneJson'] === 'string'
          return [{
            type: 'text',
            text: `Excalidraw scene: ${count} elements${hasJson ? ' (full JSON included)' : ''}.`,
          }]
        },
      },
      execute: async (_args, exec) => {
        const target = targetOf(ctx, exec)
        if (target === undefined) {
          throw new Error('excalidraw_read requires an owning agent session in a workspace')
        }
        return readScene(target)
      },
      presentCall: () => ({ card: 'generic', title: 'Read Excalidraw scene', kind: 'other', rawInput: {} }),
    }))
    const disposeWrite = ctx.tools.register(defineTool({
      name: 'excalidraw_write',
      description:
          'Overwrite the current workspace\'s Excalidraw canvas scene from a complete '
          + 'scene JSON string (the shape produced by `excalidraw_read`\'s `sceneJson`: '
          + 'an object with `elements` and `appState`). The canvas tab renders this '
          + 'exact file. A missing scene file is created.',
      parameters: {
        scene: {
          type: 'string',
          required: true,
          description: 'Complete Excalidraw scene JSON (object with `elements` array and `appState` object).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            cwd: { type: 'string', required: true, description: 'Workspace directory owning the scene.' },
            elementCount: { type: 'integer', required: true },
            previewSvg: { type: 'string', description: 'SVG preview of the current scene for UI display.' },
          },
        },
        render: (_args, value) => {
          return [{ type: 'text', text: `Excalidraw scene saved: ${value['elementCount']} elements.` }]
        },
        presentationMeta: (_args, value) => ({ previewSvg: value['previewSvg'] ?? null }),
      },
      execute: async (args, exec) => {
        const target = targetOf(ctx, exec)
        if (target === undefined) {
          throw new Error('excalidraw_write requires an owning agent session in a workspace')
        }
        return writeScene(target, args['scene'])
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Write Excalidraw scene',
        kind: 'other',
        rawInput: `elements: ${args['scene'].length} chars`,
      }),
    }))
    const disposeDraw = ctx.tools.register(defineTool({
      name: 'excalidraw_draw',
      description:
          'Draw shapes on the current workspace\'s Excalidraw canvas (the shared whiteboard). '
          + 'Describe shapes at a high level — no Excalidraw internals needed. Use it to '
          + 'draw diagrams, flowcharts, or to work a problem on the canvas (e.g. geometry). '
          + '`action: "append"` adds to the existing scene; `action: "replace"` clears the '
          + 'canvas first. Supported element `type` values: "rectangle", "ellipse", "diamond", '
          + '"text" (put the content in `text`), "arrow", "line" (optionally give `points` '
          + 'as [[x1,y1],[x2,y2],...] else a diagonal across the box is used). Setting `text` '
          + 'on rectangle/ellipse/diamond adds a centered label. Coordinates are in canvas '
          + 'pixels (top-left origin).',
      parameters: {
        elements: {
          type: 'array',
          required: true,
          description: 'Shapes to draw.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              type: { type: 'string', required: true, description: 'One of rectangle/ellipse/diamond/text/arrow/line.' },
              x: { type: 'number', required: true, description: 'Left edge in canvas pixels.' },
              y: { type: 'number', required: true, description: 'Top edge in canvas pixels.' },
              width: { type: 'number', required: true, description: 'Width in canvas pixels.' },
              height: { type: 'number', required: true, description: 'Height in canvas pixels.' },
              text: { type: 'string', description: 'Text content (for type "text"), or a centered label when set on rectangle/ellipse/diamond.' },
              points: { type: 'array', description: 'Line/arrow points as [[x,y],...] (optional).' },
              strokeColor: { type: 'string', description: 'Outline color (CSS color).' },
              backgroundColor: { type: 'string', description: 'Fill color (CSS color).' },
              fillStyle: { type: 'string', description: 'hachure/solid/cross-hatch/zigzag.' },
              strokeWidth: { type: 'number', description: 'Outline width in pixels.' },
              opacity: { type: 'number', description: 'Opacity 0-100.' },
            },
          },
        },
        action: {
          type: 'string',
          description: '"append" (default) adds shapes; "replace" clears the canvas first.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            cwd: { type: 'string', required: true, description: 'Workspace directory owning the scene.' },
            added: { type: 'integer', required: true, description: 'Elements added; a labelled container also adds its text element.' },
            totalElements: { type: 'integer', required: true, description: 'Total elements after the draw.' },
            skipped: { type: 'integer', required: true, description: 'Shapes dropped for an unsupported type.' },
            previewSvg: { type: 'string', description: 'SVG preview of the current scene for UI display.' },
          },
        },
        render: (_args, value) => {
          return [{ type: 'text', text: `Drew ${value['added']} shapes on the canvas (${value['totalElements']} total).` }]
        },
        presentationMeta: (_args, value) => ({ previewSvg: value['previewSvg'] ?? null }),
      },
      execute: async (args, exec) => {
        const target = targetOf(ctx, exec)
        if (target === undefined) {
          throw new Error('excalidraw_draw requires an owning agent session in a workspace')
        }
        return drawScene(target, (args as { elements: unknown[] }).elements, (args as { action?: string }).action)
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Draw on Excalidraw canvas',
        kind: 'other',
        rawInput: `${(args as { elements?: unknown[] }).elements?.length ?? 0} shapes`,
      }),
    }))
    const disposeImport = ctx.tools.register(defineTool({
      name: 'excalidraw_import',
      description:
          'Replace the current workspace\'s Excalidraw canvas with an Excalidraw file '
          + 'from inside that workspace. Reads `<workspace>/<path>` — a native '
          + '`.excalidraw` document or any JSON scene with `elements`/`appState` — repairs '
          + 'malformed elements, keeps embedded image `files`, and writes it as the '
          + 'workspace scene. Use it to load a diagram without pasting its JSON. Excalidraw '
          + 'libraries are rejected.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Workspace-relative path of the file to import (e.g. "docs/flow.excalidraw").',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            cwd: { type: 'string', required: true, description: 'Workspace directory owning the scene.' },
            path: { type: 'string', required: true, description: 'Absolute path of the imported file.' },
            elementCount: { type: 'integer', required: true, description: 'Elements imported into the scene.' },
            bytes: { type: 'integer', required: true, description: 'Size of the imported file in bytes.' },
            previewSvg: { type: 'string', description: 'SVG preview of the imported scene for UI display.' },
          },
        },
        render: (_args, value) => {
          return [{ type: 'text', text: `Imported ${value['elementCount']} elements from ${value['path']}.` }]
        },
        presentationMeta: (_args, value) => ({ previewSvg: value['previewSvg'] ?? null }),
      },
      execute: async (args, exec) => {
        const target = targetOf(ctx, exec)
        if (target === undefined) {
          throw new Error('excalidraw_import requires an owning agent session in a workspace')
        }
        return importScene(target, String(args['path']))
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Import Excalidraw file',
        kind: 'other',
        rawInput: `path: ${String(args['path'])}`,
      }),
    }))
    const disposeExport = ctx.tools.register(defineTool({
      name: 'excalidraw_export',
      description:
          'Export the current workspace\'s Excalidraw canvas to a file inside the '
          + 'workspace. `format: "svg"` and `"png"` render through Excalidraw\'s own '
          + 'export pipeline in a local headless Chrome, so hand-drawn texture, embedded '
          + 'images and wrapped text are preserved; they need Chrome/Chromium on the host. '
          + '`format: "excalidraw"` writes the native scene file (openable in the Excalidraw '
          + 'app) and needs no browser. Defaults: `.agents/excalidraw/export.svg`, '
          + '`export.png` or `export.excalidraw`.',
      parameters: {
        path: {
          type: 'string',
          description: 'Workspace-relative output path (e.g. "docs/flow.png"); default depends on `format`.',
        },
        format: {
          type: 'string',
          description: 'Output format: "svg" (default), "png" or "excalidraw".',
        },
        scale: {
          type: 'number',
          description: 'PNG pixel scale between 0.5 and 4; default 1. Ignored for SVG and .excalidraw.',
        },
        transparent: {
          type: 'boolean',
          description: 'When true, the image has a transparent background; default uses the canvas background color. Ignored for .excalidraw.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            path: { type: 'string', required: true, description: 'Absolute path of the written file.' },
            format: { type: 'string', required: true, description: 'Written format: svg, png or excalidraw.' },
            elementCount: { type: 'integer', required: true, description: 'Elements included in the export.' },
            bytes: { type: 'integer', required: true, description: 'Size of the written file in bytes.' },
            width: { type: 'integer', description: 'Pixel width of the image; svg and png only.' },
            height: { type: 'integer', description: 'Pixel height of the image; svg and png only.' },
          },
        },
        render: (_args, value) => {
          return [{ type: 'text', text: `Exported ${value['elementCount']} elements to ${value['path']}.` }]
        },
      },
      execute: async (args, exec) => {
        const target = targetOf(ctx, exec)
        if (target === undefined) {
          throw new Error('excalidraw_export requires an owning agent session in a workspace')
        }
        const raw = args as { path?: string; format?: 'svg' | 'png' | 'excalidraw'; scale?: number; transparent?: boolean }
        return exportScene(target, {
          ...(raw.path !== undefined ? { path: raw.path } : {}),
          ...(raw.format !== undefined ? { format: raw.format } : {}),
          ...(raw.scale !== undefined ? { scale: raw.scale } : {}),
          transparent: raw.transparent === true,
        })
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Export Excalidraw canvas',
        kind: 'other',
        rawInput: `path: ${(args as { path?: string }).path ?? DEFAULT_EXPORT_RELATIVE}`,
      }),
    }))
    return () => { disposeRead(); disposeWrite(); disposeImport(); disposeDraw(); disposeExport() }
  }, 'tool-excalidraw: scene tools')
}

/** JsonValue re-export kept for consumers that typed against the old module. */
export type { JsonValue }
