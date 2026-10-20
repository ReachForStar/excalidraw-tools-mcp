/**
 * Cordis plugin mounting the Excalidraw tools into a host's tool registry.
 * Scene logic lives in `./scene.ts`, element/layout/image logic in
 * `./elements.ts`, drawing management in `./drawings.ts`; the same modules back
 * the MCP server (`src/mcp.ts`).
 *
 *  - Scene: read/write/import/draw/export.
 *  - Drawings: create/get/update/delete/list/export_to_json.
 *  - Elements: element_create/get/update/delete.
 *  - Layout: align, distribute, group/ungroup, lock/unlock, duplicate.
 *  - Media: add_image, screenshot.
 *
 * The target workspace comes from the calling agent's session; a non-agent
 * caller has no owning workspace and is rejected.
 * @module @reachforstar/excalidraw-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
// Type-only: pulls the tools registry Context merge (ctx.tools).
import type {} from '@deepseek-ai/dsh-tools'
import { registerDrawingTools } from './plugin/drawings.js'
import { registerElementTools } from './plugin/elements.js'
import { registerLayoutTools } from './plugin/layout.js'
import { registerMediaTools } from './plugin/media.js'
import { registerSceneTools } from './plugin/scene.js'

export {
  DEFAULT_EXPORT_FILE_RELATIVE,
  DEFAULT_EXPORT_PNG_RELATIVE,
  DEFAULT_EXPORT_RELATIVE,
  DEFAULT_SCREENSHOT_RELATIVE,
  DEFAULT_DRAWING_ID,
  DRAWINGS_DIRECTORY,
  DRAW_MAX_ELEMENTS,
  EXPORT_DIRECTORY,
  SCENE_DIRECTORY,
  SCENE_RELATIVE,
  SCREENSHOT_DIRECTORY,
  defaultExportRelative,
  defaultScreenshotRelative,
  describeScene,
  normalizeDrawingId,
  sanitizeScene,
  sceneToSvg,
} from './scene.js'
export { LAYOUT_ACTIONS } from './elements.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-excalidraw'

/** Services required by the Excalidraw tools. */
export const inject = ['tools']

/**
 * Register every Excalidraw tool into the composed tool registry.
 * @param ctx - Host context with the tools and workspaceRegistry services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers = [
      ...registerSceneTools(ctx),
      ...registerDrawingTools(ctx),
      ...registerElementTools(ctx),
      ...registerLayoutTools(ctx),
      ...registerMediaTools(ctx),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'tool-excalidraw: drawing tools')
}

/** JsonValue re-export kept for consumers that typed against the old module. */
export type { JsonValue }
