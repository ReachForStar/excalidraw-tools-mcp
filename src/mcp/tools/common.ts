/**
 * Shared MCP tool plumbing: result wrappers, workspace/drawing selectors and
 * target resolution. Every tool result carries a text JSON block; screenshot
 * results additionally carry the PNG as an MCP image block.
 * @module excalidraw-mcp/tools/common
 */

import { z } from 'zod'
import { targetFor, type SceneTarget, type WorkspaceScope } from '../../scene.js'

/** One content block a tool may return. */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/** Result shape a tool handler returns to the MCP layer. */
export type ToolResult = {
  content: ContentBlock[]
  isError?: boolean
}

/** Wrap a successful value as a JSON text result. */
export function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Wrap a value as JSON text plus an inline image block. */
export function okWithImage(value: unknown, data: Buffer, mimeType: string): ToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ ...value as Record<string, unknown>, image: 'attached' }) },
      { type: 'image', data: data.toString('base64'), mimeType },
    ],
  }
}

/** Wrap a failure as an `isError` result with the error message. */
export function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Workspace selector shared by every tool. */
export const workspaceSchema = z.string().optional().describe(
  'Workspace directory to operate on: absolute, or relative to the server root. '
  + 'Omit to use the default root. Must lie inside an allowed root.',
)

/** Optional drawing selector. */
export const drawingSchema = z.string().optional().describe(
  'Drawing id inside the workspace. Omit for the default drawing (`scene.json`). '
  + 'Named drawings live in `.agents/excalidraw/drawings/<id>.json`.',
)

/** Required drawing selector. */
export const requiredDrawingSchema = z.string().min(1).describe(
  'Drawing id inside the workspace (the default drawing is `default`).',
)

/** Resolve the target of a tool call. */
export function targetOf(
  scope: WorkspaceScope,
  workspace?: string,
  drawing?: string,
): Promise<SceneTarget> {
  return targetFor(scope, workspace, drawing)
}
