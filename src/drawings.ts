/**
 * Drawing management for one workspace: the default drawing lives in
 * `scene.json`, named drawings live in `drawings/<id>.json`. Listing scans the
 * directory instead of keeping an index, so a drawing never goes stale when a
 * file is added or deleted by hand.
 * @module excalidraw-mcp/drawings
 */

import { randomBytes } from 'node:crypto'
import { readdir, stat, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  DEFAULT_DRAWING_ID,
  DRAWINGS_DIRECTORY,
  exportScene,
  loadSceneParts,
  normalizeDrawingId,
  saveSceneParts,
  sceneTarget,
  summarizeScene,
  writeScene,
  type ExportResult,
  type LoadedScene,
  type SceneTarget,
  type SceneSummary,
} from './scene.js'

/** One drawing listed by `listDrawings`. */
export interface DrawingEntry {
  id: string
  /** Absolute path of the scene file. */
  path: string
  exists: boolean
  elementCount: number
  byType: Record<string, number>
  theme: string
  bytes: number
  /** File modification time in ISO 8601, or null when the file is missing. */
  updatedAt: string | null
  error?: string
}

/** Result of `listDrawings`. */
export interface ListDrawingsResult {
  ok: true
  cwd: string
  count: number
  drawings: DrawingEntry[]
}

/** Result of `createDrawing`. */
export interface CreateDrawingResult {
  ok: true
  cwd: string
  drawing: string
  path: string
  elementCount: number
  previewSvg?: string
}

/** Result of `updateDrawing`. */
export interface UpdateDrawingResult {
  ok: true
  cwd: string
  drawing: string
  path: string
  elementCount: number
  previewSvg?: string
}

/** Result of `deleteDrawing`. */
export interface DeleteDrawingResult {
  ok: true
  cwd: string
  drawing: string
  path: string
  deleted: true
}

/** Generate an unused drawing id. */
function generatedDrawingId(): string {
  return `drawing-${randomBytes(4).toString('hex')}`
}

/** Rewrite the scene parser's error prefix for a drawing-management tool. */
function withToolPrefix(error: unknown, tool: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(message.replace(/^excalidraw_write: /, `${tool}: `))
}

/** Write a scene for a drawing tool and shape the metadata result. */
function drawingResult(
  target: SceneTarget,
  id: string,
  written: { elementCount: number; previewSvg?: string },
): CreateDrawingResult {
  return {
    ok: true,
    cwd: target.workspace,
    drawing: id,
    path: target.scenePath,
    elementCount: written.elementCount,
    ...(written.previewSvg !== undefined ? { previewSvg: written.previewSvg } : {}),
  }
}

/**
 * Create a drawing. Without an explicit id a fresh `drawing-<hex>` id is
 * generated. The drawing starts empty unless `sceneJson` supplies a complete
 * scene; an existing drawing is never overwritten — the create itself is an
 * exclusive write, so two concurrent creates cannot both succeed.
 * @param workspace - workspace root.
 * @param drawing - requested id; omitted means generate one.
 * @param sceneJson - optional complete scene JSON.
 * @returns the created drawing metadata.
 */
export async function createDrawing(
  workspace: string,
  drawing?: string,
  sceneJson?: string,
  sceneOverride?: string,
): Promise<CreateDrawingResult> {
  const explicit = drawing !== undefined && drawing.trim().length > 0
  const requested = explicit ? normalizeDrawingId(drawing) : undefined
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = requested ?? generatedDrawingId()
    const target = sceneTarget(workspace, sceneOverride, id)
    try {
      if (sceneJson !== undefined && sceneJson.length > 0) {
        const written = await writeScene(target, sceneJson, { exclusive: true })
        return drawingResult(target, id, written)
      }
      await saveSceneParts(target, { elements: [], appState: {}, files: {} }, { exclusive: true })
      return drawingResult(target, id, { elementCount: 0 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        if (!explicit) continue
        throw new Error(`excalidraw_create_drawing: drawing already exists: ${id}`)
      }
      throw withToolPrefix(error, 'excalidraw_create_drawing')
    }
  }
  throw new Error('excalidraw_create_drawing: could not allocate a drawing id')
}

/**
 * Replace a drawing's content from a complete scene JSON string. The drawing
 * must already exist; use `createDrawing` for a new one.
 * @param workspace - workspace root.
 * @param drawing - drawing id.
 * @param sceneJson - complete scene JSON.
 * @returns the updated drawing metadata.
 */
export async function updateDrawing(
  workspace: string,
  drawing: string,
  sceneJson: string,
  sceneOverride?: string,
): Promise<UpdateDrawingResult> {
  const id = normalizeDrawingId(drawing)
  const target = sceneTarget(workspace, sceneOverride, id)
  const existing = await loadSceneParts(target)
  if (!existing.exists) {
    throw new Error(`excalidraw_update_drawing: drawing not found: ${id}; use excalidraw_create_drawing`)
  }
  let written: { elementCount: number; previewSvg?: string }
  try {
    written = await writeScene(target, sceneJson)
  } catch (error) {
    throw withToolPrefix(error, 'excalidraw_update_drawing')
  }
  return drawingResult(target, id, written)
}

/**
 * Delete a drawing file. The default drawing can be deleted too; it then reads
 * as an empty canvas until it is written again.
 * @param workspace - workspace root.
 * @param drawing - drawing id.
 * @returns the deleted path.
 */
export async function deleteDrawing(
  workspace: string,
  drawing: string,
  sceneOverride?: string,
): Promise<DeleteDrawingResult> {
  const id = normalizeDrawingId(drawing)
  const target = sceneTarget(workspace, sceneOverride, id)
  try {
    await unlink(target.scenePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`excalidraw_delete_drawing: drawing not found: ${id}`)
    throw error
  }
  return { ok: true, cwd: target.workspace, drawing: id, path: target.scenePath, deleted: true }
}

/** Build one list entry, reusing an already loaded scene when available. */
async function entryOf(id: string, target: SceneTarget, preloaded?: LoadedScene): Promise<DrawingEntry> {
  const loaded = preloaded ?? await loadSceneParts(target)
  if (!loaded.exists) {
    return {
      id,
      path: target.scenePath,
      exists: false,
      elementCount: 0,
      byType: {},
      theme: 'light',
      bytes: 0,
      updatedAt: null,
    }
  }
  let bytes = 0
  let updatedAt: string | null = null
  try {
    const info = await stat(target.scenePath)
    bytes = info.size
    updatedAt = info.mtime.toISOString()
  } catch {
    // The file disappeared between load and stat; report what was loaded.
  }
  const summary: SceneSummary = summarizeScene(loaded.parts)
  const entry: DrawingEntry = {
    id,
    path: target.scenePath,
    exists: true,
    elementCount: summary.elementCount,
    byType: summary.byType,
    theme: summary.theme,
    bytes,
    updatedAt,
  }
  if (loaded.error !== undefined) entry.error = loaded.error
  return entry
}

/**
 * List every drawing in a workspace: the default drawing first when its file
 * exists, then named drawings in id order. Files that are not valid drawing
 * ids are ignored because no tool could address them.
 * @param workspace - workspace root.
 * @returns the drawing list.
 */
export async function listDrawings(
  workspace: string,
  sceneOverride?: string,
): Promise<ListDrawingsResult> {
  const drawings: DrawingEntry[] = []
  const defaultTarget = sceneTarget(workspace, sceneOverride)
  const defaultLoaded = await loadSceneParts(defaultTarget)
  if (defaultLoaded.exists) drawings.push(await entryOf(DEFAULT_DRAWING_ID, defaultTarget, defaultLoaded))
  let names: string[] = []
  try {
    names = await readdir(join(workspace, DRAWINGS_DIRECTORY))
  } catch (error) {
    // A missing drawings directory just means no named drawings yet.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const ids = names
    .filter(name => extname(name).toLowerCase() === '.json')
    .map(name => basename(name, extname(name)))
    .flatMap((name) => {
      try {
        // File names are not tool input: only names that round-trip through the
        // id rules could ever be addressed again.
        const id = normalizeDrawingId(name)
        return id === name && id !== DEFAULT_DRAWING_ID ? [id] : []
      } catch {
        return []
      }
    })
    .sort()
  const entries = await Promise.all(ids.map(id => entryOf(id, sceneTarget(workspace, undefined, id))))
  drawings.push(...entries)
  return { ok: true, cwd: workspace, count: drawings.length, drawings }
}

/**
 * Export one drawing as a native `.excalidraw` JSON file. Named drawings
 * default to `.agents/excalidraw/exports/<id>.excalidraw`.
 * @param workspace - workspace root.
 * @param drawing - drawing id.
 * @param path - optional workspace-relative output path.
 * @returns the export result.
 */
export async function exportDrawingToJson(
  workspace: string,
  drawing: string,
  path?: string,
  sceneOverride?: string,
): Promise<ExportResult> {
  const target = sceneTarget(workspace, sceneOverride, normalizeDrawingId(drawing))
  return exportScene(target, {
    format: 'excalidraw',
    ...(path !== undefined && path.trim().length > 0 ? { path } : {}),
  })
}
