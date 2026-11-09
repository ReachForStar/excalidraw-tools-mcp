/**
 * Shared cordis-plugin plumbing: resolve the drawing target from the calling
 * agent's workspace and the parameter/schema fragments every tool reuses.
 * @module @reachforstar/excalidraw-tools/plugin/shared
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { sceneTarget, type SceneTarget } from '../scene.js'

/** The slice of the tool execution context the tools use. */
export interface ToolExec {
  /** Hosts may omit `header`; a session without a cwd is simply unresolvable. */
  agent?: { session: { id: unknown; header?: { cwd?: string } } }
}

/** Drawing parameter shared by every plugin tool. */
export const drawingParameter = {
  type: 'string',
  description: 'Drawing id; omit for the default drawing (`scene.json`).',
} as const

/** Find the workspace owning the calling session, if any. */
function workspaceOf(ctx: Context, sessionId: unknown): Workspace | undefined {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof sessionId !== 'string') return undefined
  // Compare as plain strings: a host could store the ids in any string shape,
  // and `as never` would silently never match.
  return registry.list().find(workspace => workspace.sessionIds.some(id => String(id) === sessionId))
}

/** Resolve the scene target from the calling session's workspace or cwd. */
export function targetOf(ctx: Context, exec: ToolExec, drawing?: unknown): SceneTarget | undefined {
  const workspace = workspaceOf(ctx, exec.agent?.session.id)
  const id = typeof drawing === 'string' ? drawing : undefined
  if (workspace !== undefined) return sceneTarget(workspace.path, undefined, id)
  const cwd = exec.agent?.session.header?.cwd
  return cwd === undefined || cwd.length === 0 ? undefined : sceneTarget(cwd, undefined, id)
}

/**
 * Resolve a target or fail with a tool-specific message.
 * @param ctx - host context.
 * @param exec - tool execution context.
 * @param drawing - drawing id from the call.
 * @param tool - tool name for the error.
 * @returns the resolved scene target.
 */
export function requireTarget(
  ctx: Context,
  exec: ToolExec,
  drawing: unknown,
  tool: string,
): SceneTarget {
  const target = targetOf(ctx, exec, drawing)
  if (target === undefined) throw new Error(`${tool} requires an owning agent session in a workspace`)
  return target
}

/** Presentation metadata for results carrying a scene preview. */
export function previewMeta(value: Record<string, unknown>): { previewSvg: string | null } {
  return { previewSvg: typeof value['previewSvg'] === 'string' ? value['previewSvg'] : null }
}
