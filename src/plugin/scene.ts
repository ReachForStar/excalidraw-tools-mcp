/**
 * Cordis plugin tools for whole-scene operations. Mirrors the MCP scene tools:
 * read/write/import/draw/export with an optional drawing id.
 * @module @reachforstar/excalidraw-tools/plugin/scene
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_DRAWING_ID, defaultExportRelative, drawScene, exportScene, importScene, readScene, writeScene } from '../scene.js'
import { drawingParameter, previewMeta, requireTarget, type ToolExec } from './shared.js'

/**
 * Register the scene tools.
 * @param ctx - host context.
 * @returns disposers for the registered tools.
 */
export function registerSceneTools(ctx: Context): (() => void)[] {
  const read = ctx.tools.register(defineTool({
    name: 'excalidraw_read',
    description:
        'Read one drawing of the current workspace. Returns a summary (visible element '
        + 'counts by type, text elements, theme), a compact `elements` list and a structured '
        + '`description` of the canvas. The complete scene JSON is included as `sceneJson` '
        + 'when small. Omit `drawing` for the default drawing.',
    parameters: { drawing: drawingParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cwd: { type: 'string', required: true, description: 'Workspace directory owning the scene.' },
          drawing: { type: 'string', required: true, description: 'Drawing id.' },
          path: { type: 'string', required: true, description: 'Absolute scene file path.' },
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
            description: 'Compact element list.',
            items: { type: 'object', additionalProperties: true },
          },
          description: { type: 'string', required: true, description: 'Structured text description of the visible canvas.' },
          sceneJson: {
            type: 'string',
            description: 'Complete scene JSON (absent when the scene is too large or missing).',
          },
          error: { type: 'string', description: 'Present when the scene file is corrupted.' },
        },
      },
      render: (_args, value) => {
        const summary = value['summary']
        const count = typeof summary === 'object' && summary !== null
          && typeof (summary as Record<string, unknown>)['elementCount'] === 'number'
          ? (summary as Record<string, unknown>)['elementCount'] as number
          : 0
        const error = typeof value['error'] === 'string' ? ` (${value['error']})` : ''
        return [{
          type: 'text',
          text: `Excalidraw drawing "${value['drawing']}": ${count} elements${error}.`,
        }]
      },
    },
    execute: async (args, exec) => readScene(requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_read')),
    presentCall: args => ({
      card: 'generic',
      title: 'Read Excalidraw drawing',
      kind: 'other',
      rawInput: `drawing: ${typeof args['drawing'] === 'string' ? args['drawing'] : 'default'}`,
    }),
  }))

  const write = ctx.tools.register(defineTool({
    name: 'excalidraw_write',
    description:
        'Overwrite one drawing from a complete scene JSON string (the shape produced by '
        + '`excalidraw_read`\'s `sceneJson`). A missing scene file is created and malformed '
        + 'elements are repaired. Omit `drawing` for the default drawing.',
    parameters: {
      scene: {
        type: 'string',
        required: true,
        description: 'Complete Excalidraw scene JSON (object with `elements` array and `appState` object).',
      },
      drawing: drawingParameter,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cwd: { type: 'string', required: true },
          drawing: { type: 'string', required: true },
          elementCount: { type: 'integer', required: true },
          previewSvg: { type: 'string', description: 'SVG preview of the current scene for UI display.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Excalidraw drawing "${value['drawing']}" saved: ${value['elementCount']} elements.`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => writeScene(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_write'),
      String(args['scene']),
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Write Excalidraw drawing',
      kind: 'other',
      rawInput: `${String(args['scene']).length} chars`,
    }),
  }))

  const draw = ctx.tools.register(defineTool({
    name: 'excalidraw_draw',
    description:
        'Draw shapes on one drawing of the current workspace. Describe shapes at a high '
        + 'level. `action: "append"` adds to the existing scene; `"replace"` clears the '
        + 'drawing first. Supported types: rectangle, ellipse, diamond, text, arrow, line. '
        + 'Setting `text` on a container adds a centered label. Omit `drawing` for the '
        + 'default drawing.',
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
            x: { type: 'number', required: true },
            y: { type: 'number', required: true },
            width: { type: 'number', required: true },
            height: { type: 'number', required: true },
            text: { type: 'string' },
            points: { type: 'array' },
            strokeColor: { type: 'string' },
            backgroundColor: { type: 'string' },
            fillStyle: { type: 'string' },
            strokeWidth: { type: 'number' },
            opacity: { type: 'number' },
          },
        },
      },
      action: { type: 'string', description: '"append" (default) or "replace".' },
      drawing: drawingParameter,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cwd: { type: 'string', required: true },
          drawing: { type: 'string', required: true },
          added: { type: 'integer', required: true },
          totalElements: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Drew ${value['added']} shapes on "${value['drawing']}" (${value['totalElements']} total).`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => drawScene(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_draw'),
      (args as { elements: unknown[] }).elements,
      typeof args['action'] === 'string' ? args['action'] : undefined,
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Draw on Excalidraw canvas',
      kind: 'other',
      rawInput: `${(args as { elements?: unknown[] }).elements?.length ?? 0} shapes`,
    }),
  }))

  const importTool = ctx.tools.register(defineTool({
    name: 'excalidraw_import',
    description:
        'Replace one drawing with an Excalidraw file from inside the workspace — a native '
        + '`.excalidraw` document or any JSON scene with `elements`/`appState`. Embedded '
        + 'image `files` are kept; Excalidraw libraries are rejected. Omit `drawing` for the '
        + 'default drawing.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Workspace-relative path of the file to import (e.g. "docs/flow.excalidraw").',
      },
      drawing: drawingParameter,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cwd: { type: 'string', required: true },
          drawing: { type: 'string', required: true },
          path: { type: 'string', required: true, description: 'Absolute path of the imported file.' },
          elementCount: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Imported ${value['elementCount']} elements into "${value['drawing']}".`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => importScene(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_import'),
      String(args['path']),
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Import Excalidraw file',
      kind: 'other',
      rawInput: `path: ${String(args['path'])}`,
    }),
  }))

  const exportTool = ctx.tools.register(defineTool({
    name: 'excalidraw_export',
    description:
        'Export one drawing to a file inside the workspace. `format: "svg"` and `"png"` '
        + 'render through Excalidraw\'s own exporter in a local headless Chrome (browser '
        + 'required). `format: "excalidraw"` writes the native scene file and needs no '
        + 'browser. Named drawings default to `.agents/excalidraw/exports/<id>.<ext>`.',
    parameters: {
      path: { type: 'string', description: 'Workspace-relative output path; default depends on `format`.' },
      format: { type: 'string', description: 'Output format: "svg" (default), "png" or "excalidraw".' },
      scale: { type: 'number', description: 'PNG pixel scale between 0.5 and 4; default 1.' },
      transparent: { type: 'boolean', description: 'Transparent background for svg/png.' },
      drawing: drawingParameter,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          path: { type: 'string', required: true },
          drawing: { type: 'string', required: true },
          format: { type: 'string', required: true },
          elementCount: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer' },
          height: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exported "${value['drawing']}" (${value['elementCount']} elements) to ${value['path']}.`,
      }],
    },
    execute: async (args, exec) => {
      const raw = args as {
        path?: unknown
        format?: unknown
        scale?: unknown
        transparent?: unknown
        drawing?: unknown
      }
      if (raw.path !== undefined && typeof raw.path !== 'string') {
        throw new Error('excalidraw_export: `path` must be a string')
      }
      if (raw.format !== undefined && raw.format !== 'svg' && raw.format !== 'png' && raw.format !== 'excalidraw') {
        throw new Error('excalidraw_export: `format` must be "svg", "png" or "excalidraw"')
      }
      if (raw.scale !== undefined && (typeof raw.scale !== 'number' || !Number.isFinite(raw.scale))) {
        throw new Error('excalidraw_export: `scale` must be a finite number')
      }
      if (raw.transparent !== undefined && typeof raw.transparent !== 'boolean') {
        throw new Error('excalidraw_export: `transparent` must be a boolean')
      }
      return exportScene(requireTarget(ctx, exec as ToolExec, raw.drawing, 'excalidraw_export'), {
        ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
        ...(raw.format !== undefined ? { format: raw.format } : {}),
        ...(typeof raw.scale === 'number' ? { scale: raw.scale } : {}),
        transparent: raw.transparent === true,
      })
    },
    presentCall: args => {
      const format = args['format'] === 'png' || args['format'] === 'excalidraw' ? args['format'] : 'svg'
      const drawing = typeof args['drawing'] === 'string' && args['drawing'].trim().length > 0
        ? args['drawing'].trim()
        : DEFAULT_DRAWING_ID
      return {
        card: 'generic',
        title: 'Export Excalidraw drawing',
        kind: 'other',
        rawInput: `path: ${typeof args['path'] === 'string'
          ? args['path']
          : defaultExportRelative(format, drawing)}`,
      }
    },
  }))

  return [read, write, draw, importTool, exportTool]
}
