/**
 * Cordis plugin media tools: add an external image and render a screenshot.
 * The plugin surface returns the PNG path (the MCP surface also returns the
 * image block).
 * @module @reachforstar/excalidraw-tools/plugin/media
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { addImage } from '../elements.js'
import { screenshotScene } from '../scene.js'
import { drawingParameter, previewMeta, requireTarget, type ToolExec } from './shared.js'

/**
 * Register the media tools.
 * @param ctx - host context.
 * @returns disposers for the registered tools.
 */
export function registerMediaTools(ctx: Context): (() => void)[] {
  const add = ctx.tools.register(defineTool({
    name: 'excalidraw_add_image',
    description:
        'Place an image file from inside the workspace on the drawing as a native '
        + 'Excalidraw image element — useful for icons, logos and reference pictures. '
        + 'Supports png, jpeg, gif, webp and svg. Dimensions come from the file; passing '
        + 'only width or only height keeps the aspect ratio. The binary is embedded in '
        + 'the scene `files`, so the drawing stays self-contained.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative image path.' },
      x: { type: 'number', description: 'Left edge; default 0.' },
      y: { type: 'number', description: 'Top edge; default 0.' },
      width: { type: 'number', description: 'Display width; defaults to the intrinsic width.' },
      height: { type: 'number', description: 'Display height; defaults to the intrinsic height.' },
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
          elementId: { type: 'string', required: true },
          fileId: { type: 'string', required: true },
          path: { type: 'string', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          mimeType: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          totalElements: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Added ${value['mimeType']} image (${value['width']}x${value['height']}) to "${value['drawing']}".`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => {
      const path = args['path']
      if (typeof path !== 'string') throw new Error('excalidraw_add_image: `path` must be a string')
      return addImage(
        requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_add_image'),
        {
          path,
          ...(typeof args['x'] === 'number' ? { x: args['x'] } : {}),
          ...(typeof args['y'] === 'number' ? { y: args['y'] } : {}),
          ...(typeof args['width'] === 'number' ? { width: args['width'] } : {}),
          ...(typeof args['height'] === 'number' ? { height: args['height'] } : {}),
        },
      )
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Add image to Excalidraw canvas',
      kind: 'other',
      rawInput: `path: ${String(args['path'])}`,
    }),
  }))

  const screenshot = ctx.tools.register(defineTool({
    name: 'excalidraw_screenshot',
    description:
        'Render one drawing to a PNG screenshot inside the workspace. Uses Excalidraw\'s '
        + 'own exporter in a local headless Chrome (Chrome/Chromium required). The PNG is '
        + 'written to `path` (default `.agents/excalidraw/screenshot.png`; named drawings '
        + 'use `.agents/excalidraw/screenshots/<id>.png`) and its path is returned.',
    parameters: {
      path: { type: 'string', description: 'Workspace-relative output path; default depends on the drawing id.' },
      scale: { type: 'number', description: 'PNG pixel scale between 0.5 and 4; default 1.' },
      transparent: { type: 'boolean', description: 'Transparent background.' },
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
          path: { type: 'string', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Screenshot of "${value['drawing']}" written to ${value['path']}.`,
      }],
    },
    execute: async (args, exec) => screenshotScene(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_screenshot'),
      {
        ...(typeof args['path'] === 'string' ? { path: args['path'] } : {}),
        ...(typeof args['scale'] === 'number' ? { scale: args['scale'] } : {}),
        ...(typeof args['transparent'] === 'boolean' ? { transparent: args['transparent'] } : {}),
      },
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Screenshot Excalidraw canvas',
      kind: 'other',
      rawInput: `drawing: ${typeof args['drawing'] === 'string' ? args['drawing'] : 'default'}`,
    }),
  }))

  return [add, screenshot]
}
