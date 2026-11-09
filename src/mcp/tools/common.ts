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
  return { content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }] }
}

/** Wrap a value as JSON text plus an inline image block. */
export function okWithImage(value: unknown, data: Buffer, mimeType: string): ToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ ...value as Record<string, unknown>, image: 'attached' }) ?? 'null' },
      { type: 'image', data: data.toString('base64'), mimeType },
    ],
  }
}

/** Wrap a failure as an `isError` result carrying `{ ok: false, error }`. */
export function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error)
  // The client sees the message; keep the full failure on the server log too.
  process.stderr.write(`excalidraw-mcp: tool failed: ${message}\n`)
  return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], isError: true }
}

/** Workspace selector shared by every tool. */
export const workspaceSchema = z.string().trim().min(1, 'workspace must not be empty').optional().describe(
  'Workspace directory to operate on: absolute, or relative to the server root. '
  + 'Omit to use the default root. Must lie inside an allowed root.',
)

/** Optional drawing selector. */
export const drawingSchema = z.string().trim().min(1, 'drawing id must not be empty').optional().describe(
  'Drawing id inside the workspace. Omit for the default drawing (id `default`, '
  + 'backed by `scene.json`). Named drawings live under `drawings/<id>.json` in the scene directory.',
)

/** Required drawing selector. */
export const requiredDrawingSchema = z.string().trim().min(1, 'drawing id must not be empty').describe(
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
