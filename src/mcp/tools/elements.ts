/**
 * MCP tools for raw element CRUD: create, read, update and delete individual
 * Excalidraw elements without replacing the whole scene.
 * @module excalidraw-mcp/tools/elements
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  createElements,
  deleteElements,
  getElement,
  updateElement,
} from '../../elements.js'
import type { WorkspaceScope } from '../../scene.js'
import { drawingSchema, fail, ok, targetOf, workspaceSchema } from './common.js'

/** Raw element object: arbitrary Excalidraw fields. */
const rawElementSchema = z.record(z.string(), z.unknown())

/**
 * Register the element tools.
 * @param server - the MCP server to register on.
 * @param scope - workspace roots the tools may operate on.
 */
export function registerElementTools(server: McpServer, scope: WorkspaceScope): void {
  server.registerTool(
    'excalidraw_element_create',
    {
      title: 'Create Excalidraw elements',
      description:
          'Append raw Excalidraw elements to one drawing, or replace its element list. '
          + 'Pass element objects with at least `type` (rectangle, ellipse, diamond, arrow, '
          + 'line, text, image, freedraw, frame, embed); `id` is generated when omitted. '
          + 'Missing seed/version/index fields are repaired on save. Duplicate ids are '
          + 'rejected. For images use `excalidraw_add_image`, which embeds the file. Omit '
          + '`drawing` for the default drawing.',
      inputSchema: {
        elements: z.array(rawElementSchema).min(1).max(256).describe('Raw Excalidraw element objects.'),
        action: z.enum(['append', 'replace']).optional().describe('"append" (default) adds elements; "replace" clears the element list first.'),
        workspace: workspaceSchema,
        drawing: drawingSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ elements, action, workspace, drawing }) => {
      try {
        return ok(await createElements(await targetOf(scope, workspace, drawing), elements, action))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_element_get',
    {
      title: 'Get an Excalidraw element',
      description:
          'Read one element by id from a drawing, including every raw field and its index '
          + 'in the element list. Omit `drawing` for the default drawing.',
      inputSchema: {
        id: z.string().min(1).describe('Element id.'),
        drawing: drawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, workspace, drawing }) => {
      try {
        return ok(await getElement(await targetOf(scope, workspace, drawing), id))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_element_update',
    {
      title: 'Update an Excalidraw element',
      description:
          'Shallow-merge fields into one element. `id` and `type` cannot be changed; '
          + 'version, versionNonce and updated are refreshed automatically. A patch that '
          + 'makes the element unrenderable is rejected before writing. Omit `drawing` for '
          + 'the default drawing.',
      inputSchema: {
        id: z.string().min(1).describe('Element id.'),
        patch: rawElementSchema.describe('Fields to merge into the element (id/type excluded).'),
        drawing: drawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ id, patch, workspace, drawing }) => {
      try {
        return ok(await updateElement(await targetOf(scope, workspace, drawing), id, patch))
      } catch (error) {
        return fail(error)
      }
    },
  )

  server.registerTool(
    'excalidraw_element_delete',
    {
      title: 'Delete Excalidraw elements',
      description:
          'Delete elements by id. Text labels bound to a deleted container are removed with '
          + 'it, and references from remaining elements (bindings, boundElements, '
          + 'containerId) are cleared. Omit `drawing` for the default drawing.',
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1).describe('Element ids to delete.'),
        drawing: drawingSchema,
        workspace: workspaceSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    async ({ ids, workspace, drawing }) => {
      try {
        return ok(await deleteElements(await targetOf(scope, workspace, drawing), ids))
      } catch (error) {
        return fail(error)
      }
    },
  )
}
