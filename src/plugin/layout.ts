/**
 * Cordis plugin layout tool: align, distribute, group, lock and duplicate.
 * @module @reachforstar/excalidraw-tools/plugin/layout
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LAYOUT_ACTIONS, layoutScene, type LayoutAction } from '../elements.js'
import { drawingParameter, previewMeta, requireTarget, type ToolExec } from './shared.js'

/**
 * Register the layout tool.
 * @param ctx - host context.
 * @returns the tool disposer.
 */
export function registerLayoutTools(ctx: Context): (() => void)[] {
  const layout = ctx.tools.register(defineTool({
    name: 'excalidraw_layout',
    description:
        'Transform a selection of elements in one drawing. Actions: align-left, '
        + 'align-center-h, align-right, align-top, align-middle, align-bottom; '
        + 'distribute-h/distribute-v (equal gaps between the outermost elements); '
        + 'group/ungroup; lock/unlock; duplicate (offset by offsetX/offsetY, default '
        + '20,20). Omit `ids` to select every visible element. The selection expands to '
        + 'whole groups and bound text labels; duplicated groups, labels and arrow '
        + 'bindings are remapped to the copies.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: `Layout action: ${LAYOUT_ACTIONS.join(', ')}.`,
      },
      ids: { type: 'array', items: { type: 'string' }, description: 'Element ids; omit for all visible elements.' },
      offsetX: { type: 'number', description: 'Duplicate horizontal offset; default 20.' },
      offsetY: { type: 'number', description: 'Duplicate vertical offset; default 20.' },
      groupIds: { type: 'array', items: { type: 'string' }, description: 'For ungroup: specific group ids; omit to remove all groups.' },
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
          action: { type: 'string', required: true },
          affected: { type: 'integer', required: true },
          ids: { type: 'array', required: true, items: { type: 'string' } },
          totalElements: { type: 'integer', required: true },
          groupId: { type: 'string' },
          removedGroups: { type: 'array', items: { type: 'string' } },
          previewSvg: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Applied ${value['action']} to ${value['affected']} elements.`,
      }],
      presentationMeta: (_args, value) => previewMeta(value),
    },
    execute: async (args, exec) => layoutScene(
      requireTarget(ctx, exec as ToolExec, args['drawing'], 'excalidraw_layout'),
      String(args['action']) as LayoutAction,
      {
        ...(Array.isArray(args['ids']) ? { ids: args['ids'] as string[] } : {}),
        ...(typeof args['offsetX'] === 'number' ? { offsetX: args['offsetX'] } : {}),
        ...(typeof args['offsetY'] === 'number' ? { offsetY: args['offsetY'] } : {}),
        ...(Array.isArray(args['groupIds']) ? { groupIds: args['groupIds'] as string[] } : {}),
      },
    ),
    presentCall: args => ({
      card: 'generic',
      title: 'Lay out Excalidraw elements',
      kind: 'other',
      rawInput: String(args['action']),
    }),
  }))
  return [layout]
}
