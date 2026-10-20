/**
 * Cordis plugin tools for raw element CRUD.
 * @module @reachforstar/excalidraw-tools/plugin/elements
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createElements, deleteElements, getElement, updateElement } from '../elements.js'
import { drawingParameter, previewMeta, requireTarget, type ToolExec } from './shared.js'

/**
 * Register the element tools.
 * @param ctx - host context.
 * @returns disposers for the registered tools.
 */
export function registerElementTools(ctx: Context): (() => void)[] {
  const create = ctx.tools.register(defineTool({
    name: 'excalidraw_element_create',
    description:
        'Append raw Excalidraw elements to one drawing, or replace its element list. Pass '
        + 'objects with at least `type`; `id` is generated when omitted. Missing '
        + 'seed/version/index fields are repaired. Duplicate ids are rejected. For images '
        + 'use `excalidraw_add_image`.',
    parameters: {
      elements: {
        type: 'array',
        required: true,
        description: 'Raw Excalidraw element objects.',
        items: { type: 'object', additionalProperties: true },
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
          ids: { type: 'array', required: true, items: { type: 'string' } },
          skipped: { type: 'integer', required: true },
          totalElements: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created ${value['added']} elements in "${value['drawing']}".`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => createElements(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_element_create'),
      (args as { elements: unknown[] }).elements,
      typeof args['action'] === 'string' ? args['action'] : undefined,
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Create Excalidraw elements',
      kind: 'other',
      rawInput: `${(args as { elements?: unknown[] }).elements?.length ?? 0} elements`,
    }),
  }))

  const get = ctx.tools.register(defineTool({
    name: 'excalidraw_element_get',
    description:
        'Read one element by id from a drawing, including every raw field and its index in '
        + 'the element list. Omit `drawing` for the default drawing.',
    parameters: {
      id: { type: 'string', required: true, description: 'Element id.' },
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
          id: { type: 'string', required: true },
          index: { type: 'integer', required: true },
          element: { type: 'object', additionalProperties: true, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Element ${value['id']} at index ${value['index']}.`,
      }],
    },
    execute: async (args, exec) => {
      const result = await getElement(
        requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_element_get'),
        String(args['id']),
      )
      return { ...result, element: result.element as unknown as Record<string, JsonValue> }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Get Excalidraw element',
      kind: 'other',
      rawInput: `id: ${String(args['id'])}`,
    }),
  }))

  const update = ctx.tools.register(defineTool({
    name: 'excalidraw_element_update',
    description:
        'Shallow-merge fields into one element. `id` and `type` cannot be changed; version, '
        + 'versionNonce and updated are refreshed automatically. Omit `drawing` for the '
        + 'default drawing.',
    parameters: {
      id: { type: 'string', required: true, description: 'Element id.' },
      patch: { type: 'object', additionalProperties: true, required: true, description: 'Fields to merge.' },
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
          id: { type: 'string', required: true },
          element: { type: 'object', additionalProperties: true, required: true },
          totalElements: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated element ${value['id']}.`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => {
      const result = await updateElement(
        requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_element_update'),
        String(args['id']),
        args['patch'] as Record<string, unknown>,
      )
      return { ...result, element: result.element as unknown as Record<string, JsonValue> }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Update Excalidraw element',
      kind: 'other',
      rawInput: `id: ${String(args['id'])}`,
    }),
  }))

  const remove = ctx.tools.register(defineTool({
    name: 'excalidraw_element_delete',
    description:
        'Delete elements by id. Text labels bound to a deleted container are removed with '
        + 'it, and references from remaining elements are cleared. Omit `drawing` for the '
        + 'default drawing.',
    parameters: {
      ids: { type: 'array', required: true, items: { type: 'string' }, description: 'Element ids to delete.' },
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
          deleted: { type: 'array', required: true, items: { type: 'string' } },
          missing: { type: 'array', required: true, items: { type: 'string' } },
          totalElements: { type: 'integer', required: true },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Deleted ${(value['deleted'] as unknown[]).length} elements.`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => deleteElements(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_element_delete'),
      (args as { ids: string[] }).ids,
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Delete Excalidraw elements',
      kind: 'other',
      rawInput: `${(args as { ids?: unknown[] }).ids?.length ?? 0} ids`,
    }),
  }))

  return [create, get, update, remove]
}
