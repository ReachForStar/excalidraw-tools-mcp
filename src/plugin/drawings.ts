/**
 * Cordis plugin tools for drawing management: create/read/update/delete/list
 * and native JSON export.
 * @module @reachforstar/excalidraw-tools/plugin/drawings
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  createDrawing,
  deleteDrawing,
  exportDrawingToJson,
  listDrawings,
  updateDrawing,
} from '../drawings.js'
import { readScene } from '../scene.js'
import { drawingParameter, previewMeta, requireTarget, type ToolExec } from './shared.js'

/**
 * Register the drawing-management tools.
 * @param ctx - host context.
 * @returns disposers for the registered tools.
 */
export function registerDrawingTools(ctx: Context): (() => void)[] {
  const create = ctx.tools.register(defineTool({
    name: 'excalidraw_create_drawing',
    description:
        'Create a new drawing in the current workspace. Omit `drawing` to generate an id; '
        + 'pass one to choose it. The drawing starts empty unless `scene` supplies a complete '
        + 'scene JSON. An existing drawing is never overwritten.',
    parameters: {
      drawing: { type: 'string', description: 'Optional drawing id to create; omit to generate one.' },
      scene: { type: 'string', description: 'Optional complete scene JSON to initialize the drawing.' },
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
          elementCount: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created drawing "${value['drawing']}" (${value['elementCount']} elements).`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => {
      const target = requireTarget(ctx, exec as ToolExec, undefined, 'excalidraw_create_drawing')
      return createDrawing(
        target.workspace,
        typeof args['drawing'] === 'string' ? args['drawing'] : undefined,
        typeof args['scene'] === 'string' ? args['scene'] : undefined,
      )
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Create Excalidraw drawing',
      kind: 'other',
      rawInput: `drawing: ${typeof args['drawing'] === 'string' ? args['drawing'] : '(generated)'}`,
    }),
  }))

  const get = ctx.tools.register(defineTool({
    name: 'excalidraw_get_drawing',
    description:
        'Read one drawing by id: summary, compact elements, structured description and the '
        + 'full scene JSON when small. Omit `drawing` for the default drawing.',
    parameters: { drawing: drawingParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cwd: { type: 'string', required: true },
          drawing: { type: 'string', required: true },
          path: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          summary: { type: 'object', additionalProperties: true, required: true },
          elements: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
          description: { type: 'string', required: true },
          sceneJson: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Drawing "${value['drawing']}" has ${(value['summary'] as { elementCount?: number }).elementCount ?? 0} elements.`,
      }],
    },
    execute: async (args, exec) => {
      const result = await readScene(
        requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_get_drawing'),
      )
      return {
        ...result,
        summary: result.summary as unknown as Record<string, JsonValue>,
        elements: result.elements as unknown as Record<string, JsonValue>[],
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Get Excalidraw drawing',
      kind: 'other',
      rawInput: `drawing: ${typeof args['drawing'] === 'string' ? args['drawing'] : 'default'}`,
    }),
  }))

  const update = ctx.tools.register(defineTool({
    name: 'excalidraw_update_drawing',
    description:
        'Replace the content of an existing drawing from a complete scene JSON string. The '
        + 'drawing must already exist; use `excalidraw_create_drawing` for a new one.',
    parameters: {
      drawing: { type: 'string', required: true, description: 'Drawing id to update.' },
      scene: { type: 'string', required: true, description: 'Complete scene JSON.' },
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
          elementCount: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated drawing "${value['drawing']}" (${value['elementCount']} elements).`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => {
      const target = requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_update_drawing')
      return updateDrawing(target.workspace, target.drawing, String(args['scene']))
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Update Excalidraw drawing',
      kind: 'other',
      rawInput: `drawing: ${String(args['drawing'])}`,
    }),
  }))

  const remove = ctx.tools.register(defineTool({
    name: 'excalidraw_delete_drawing',
    description:
        'Delete one drawing file by id. Deleting the default drawing removes `scene.json`; '
        + 'the workspace directory itself is kept.',
    parameters: {
      drawing: { type: 'string', required: true, description: 'Drawing id to delete.' },
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
          deleted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Deleted drawing "${value['drawing']}".`,
      }],
    },
    execute: async (args, exec) => {
      const target = requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_delete_drawing')
      return deleteDrawing(target.workspace, target.drawing)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Delete Excalidraw drawing',
      kind: 'other',
      rawInput: `drawing: ${String(args['drawing'])}`,
    }),
  }))

  const list = ctx.tools.register(defineTool({
    name: 'excalidraw_list_drawings',
    description:
        'List every drawing in the current workspace: the default drawing when it exists, '
        + 'then named drawings under `.agents/excalidraw/drawings/`, with element counts, '
        + 'file size and modification time.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cwd: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          drawings: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value['count']} Excalidraw drawing(s) in the workspace.`,
      }],
    },
    execute: async (_args, exec) => {
      const target = requireTarget(ctx, exec as ToolExec, undefined, 'excalidraw_list_drawings')
      const result = await listDrawings(target.workspace)
      return {
        ...result,
        drawings: result.drawings as unknown as Record<string, JsonValue>[],
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List Excalidraw drawings', kind: 'other', rawInput: {} }),
  }))

  const exportJson = ctx.tools.register(defineTool({
    name: 'excalidraw_export_to_json',
    description:
        'Write one drawing as a native `.excalidraw` JSON file inside the workspace. Named '
        + 'drawings default to `.agents/excalidraw/exports/<id>.excalidraw`; the default '
        + 'drawing defaults to `.agents/excalidraw/export.excalidraw`. No browser is needed.',
    parameters: {
      drawing: drawingParameter,
      path: { type: 'string', description: 'Workspace-relative output path; default depends on the drawing id.' },
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Exported "${value['drawing']}" to ${value['path']}.`,
      }],
    },
    execute: async (args, exec) => {
      const target = requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_export_to_json')
      return exportDrawingToJson(
        target.workspace,
        target.drawing,
        typeof args['path'] === 'string' ? args['path'] : undefined,
      )
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Export Excalidraw drawing to JSON',
      kind: 'other',
      rawInput: `drawing: ${typeof args['drawing'] === 'string' ? args['drawing'] : 'default'}`,
    }),
  }))

  return [create, get, update, remove, list, exportJson]
}
