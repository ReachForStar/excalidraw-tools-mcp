/**
 * Element-level scene operations: raw element CRUD, layout transforms and
 * external image assets. Everything works on one drawing at a time, repairs
 * elements through the same sanitizer as the scene layer, and keeps embedded
 * image `files` attached to the scene.
 * @module excalidraw-mcp/elements
 */

import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { imageSize } from 'image-size'
import {
  DRAW_MAX_ELEMENTS,
  loadSceneParts,
  previewSvgOf,
  resolveWorkspacePath,
  saveSceneParts,
  sanitizeScene,
  visibleElements,
  withSceneLock,
  type SceneParts,
  type SceneTarget,
} from './scene.js'

/** Result of `createElements`. */
export interface ElementCreateResult {
  ok: true
  cwd: string
  drawing: string
  added: number
  ids: string[]
  skipped: number
  totalElements: number
  previewSvg?: string
}

/** Result of `getElement`. */
export interface ElementGetResult {
  ok: true
  cwd: string
  drawing: string
  id: string
  index: number
  element: Record<string, unknown>
}

/** Result of `updateElement`. */
export interface ElementUpdateResult {
  ok: true
  cwd: string
  drawing: string
  id: string
  element: Record<string, unknown>
  totalElements: number
  previewSvg?: string
}

/** Result of `deleteElements`. */
export interface ElementDeleteResult {
  ok: true
  cwd: string
  drawing: string
  deleted: string[]
  missing: string[]
  totalElements: number
  previewSvg?: string
}

/** Layout actions accepted by `layoutScene`. */
export const LAYOUT_ACTIONS = [
  'align-left', 'align-center-h', 'align-right',
  'align-top', 'align-middle', 'align-bottom',
  'distribute-h', 'distribute-v',
  'group', 'ungroup', 'lock', 'unlock', 'duplicate',
] as const

/** One layout action. */
export type LayoutAction = typeof LAYOUT_ACTIONS[number]

/** Result of `layoutScene`. */
export interface LayoutResult {
  ok: true
  cwd: string
  drawing: string
  action: LayoutAction
  affected: number
  ids: string[]
  totalElements: number
  groupId?: string
  removedGroups?: string[]
  previewSvg?: string
}

/** Result of `addImage`. */
export interface AddImageResult {
  ok: true
  cwd: string
  drawing: string
  elementId: string
  fileId: string
  /** Absolute path of the source image. */
  path: string
  width: number
  height: number
  mimeType: string
  bytes: number
  totalElements: number
  previewSvg?: string
}

/** MIME types accepted for external images. */
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}

/** Image types the `image-size` detector reports, mapped to their MIME. */
const DETECTED_IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** Reject images above this size before reading them into memory. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Fresh element id. */
function newElementId(): string {
  return randomBytes(9).toString('base64url')
}

/** Fresh non-negative integer for Excalidraw seeds and nonces. */
function randomInt(): number {
  return randomBytes(4).readUInt32BE(0) % 0x7fffffff
}

/** Fresh fractional index so Excalidraw keeps the element on load. */
function fractionalIndex(): string {
  const base = Math.floor(Date.now() / 1000).toString(36)
  const tail = randomBytes(3).readUIntBE(0, 3).toString(36)
  return `a${base}${tail}`
}

/** Load scene parts for editing; a corrupt scene is an error, not a reset. */
async function editableParts(target: SceneTarget, tool: string): Promise<SceneParts> {
  const loaded = await loadSceneParts(target)
  if (loaded.error !== undefined) throw new Error(`${tool}: scene file is corrupted (not valid JSON)`)
  return loaded.parts
}

/** Mark one element as changed for Excalidraw's reconciliation. */
function touch(element: Record<string, unknown>): void {
  const version = typeof element['version'] === 'number' ? element['version'] : 0
  element['version'] = version + 1
  element['versionNonce'] = randomInt()
  element['updated'] = Date.now()
}

/** Keys that would pollute object prototypes if merged into scene data. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/** Reject prototype-polluting keys before caller data reaches the scene. */
function assertSafeKeys(value: unknown, tool: string, depth = 0): void {
  if (depth > 64) throw new Error(`${tool}: element data nests too deeply`)
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeKeys(entry, tool, depth + 1)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${tool}: \`${key}\` is not an allowed field`)
    assertSafeKeys(entry, tool, depth + 1)
  }
}

/** Persist changed parts and return a preview when one fits. */
async function saveWithPreview(
  target: SceneTarget,
  parts: SceneParts,
): Promise<{ persisted: SceneParts; previewSvg?: string }> {
  const persisted = await saveSceneParts(target, parts)
  const preview = previewSvgOf(persisted.elements, persisted.appState)
  return preview === undefined ? { persisted } : { persisted, previewSvg: preview }
}

/** Validate a raw element object and fill identity/index defaults. */
function prepareElement(
  raw: unknown,
  existingIds: Set<string>,
  fileIds: ReadonlySet<string>,
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('excalidraw_element_create: every element must be an object')
  }
  assertSafeKeys(raw, 'excalidraw_element_create')
  const element = structuredClone(raw) as Record<string, unknown>
  const type = element['type']
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error('excalidraw_element_create: every element needs a non-empty `type`')
  }
  if (type === 'image' && (typeof element['fileId'] !== 'string' || element['fileId'].length === 0)) {
    throw new Error('excalidraw_element_create: an image element needs `fileId`; use excalidraw_add_image')
  }
  if (type === 'image' && !fileIds.has(element['fileId'] as string)) {
    throw new Error(
      'excalidraw_element_create: `fileId` is not embedded in the scene; use excalidraw_add_image',
    )
  }
  const id = element['id']
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
    throw new Error('excalidraw_element_create: `id` must be a non-empty string')
  }
  if (typeof id === 'string') {
    if (existingIds.has(id)) throw new Error(`excalidraw_element_create: element id already exists: ${id}`)
    existingIds.add(id)
  } else {
    const assigned = newElementId()
    element['id'] = assigned
    existingIds.add(assigned)
  }
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const value = element[field]
    if (value === undefined) element[field] = 0
    else if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`excalidraw_element_create: \`${field}\` must be a finite number`)
    }
  }
  if (element['index'] === undefined) element['index'] = fractionalIndex()
  if (element['updated'] === undefined) element['updated'] = Date.now()
  return element
}

/**
 * Append raw Excalidraw elements to a drawing, or replace its element list.
 * Missing render fields are repaired on save. Ids are generated when omitted;
 * duplicates are rejected so a call cannot silently overwrite an element.
 * @param target - resolved scene target.
 * @param rawElements - raw element objects.
 * @param action - `append` (default) or `replace`.
 * @returns the created ids and skipped count.
 */
export async function createElements(
  target: SceneTarget,
  rawElements: readonly unknown[],
  action?: string,
): Promise<ElementCreateResult> {
  if (!Array.isArray(rawElements)) {
    throw new Error('excalidraw_element_create: `elements` must be an array')
  }
  if (rawElements.length === 0) {
    throw new Error('excalidraw_element_create: `elements` must be a non-empty array')
  }
  if (rawElements.length > DRAW_MAX_ELEMENTS) {
    throw new Error(`excalidraw_element_create: at most ${DRAW_MAX_ELEMENTS} elements per call`)
  }
  if (action !== undefined && action !== 'append' && action !== 'replace') {
    throw new Error('excalidraw_element_create: `action` must be "append" or "replace"')
  }
  return withSceneLock(target, async () => {
    const parts = await editableParts(target, 'excalidraw_element_create')
    // Replace discards the old list, so ids may be reused; only the batch itself
    // must stay unique.
    const existingIds = new Set<string>()
    if (action !== 'replace') {
      for (const element of parts.elements) {
        if (typeof element === 'object' && element !== null && typeof (element as Record<string, unknown>)['id'] === 'string') {
          existingIds.add((element as Record<string, unknown>)['id'] as string)
        }
      }
    }
    const fileIds = new Set(Object.keys(parts.files))
    const prepared = rawElements.map(raw => prepareElement(raw, existingIds, fileIds))
    const inputIds = prepared.map(element => element['id'] as string)
    const elements = action === 'replace' ? prepared : [...parts.elements, ...prepared]
    const files = action === 'replace' ? pruneFiles(prepared, parts.files) : parts.files
    const saved = await saveWithPreview(target, { ...parts, elements, files })
    const persistedIds = new Set(
      visibleElements(saved.persisted.elements)
        .map(element => element['id'])
        .filter((id): id is string => typeof id === 'string'),
    )
    const ids = inputIds.filter(id => persistedIds.has(id))
    return {
      ok: true,
      cwd: target.workspace,
      drawing: target.drawing,
      added: ids.length,
      ids,
      skipped: prepared.length - ids.length,
      totalElements: saved.persisted.elements.length,
      ...(saved.previewSvg !== undefined ? { previewSvg: saved.previewSvg } : {}),
    }
  })
}

/** Drop embedded files no surviving element references any more. */
function pruneFiles(
  elements: readonly Record<string, unknown>[],
  files: Record<string, unknown>,
): Record<string, unknown> {
  const referenced = new Set<string>()
  for (const element of elements) {
    const fileId = element['fileId']
    if (typeof fileId === 'string') referenced.add(fileId)
  }
  const kept: Record<string, unknown> = {}
  for (const [fileId, file] of Object.entries(files)) {
    if (referenced.has(fileId)) kept[fileId] = file
  }
  return kept
}

/**
 * Read one element by id, including its position in the element list.
 * @param target - resolved scene target.
 * @param id - element id.
 * @returns the full element object.
 */
export async function getElement(target: SceneTarget, id: string): Promise<ElementGetResult> {
  const parts = await editableParts(target, 'excalidraw_element_get')
  const index = parts.elements.findIndex(element =>
    typeof element === 'object' && element !== null && (element as Record<string, unknown>)['id'] === id)
  if (index < 0) throw new Error(`excalidraw_element_get: element not found: ${id}`)
  const element = structuredClone(parts.elements[index]) as Record<string, unknown>
  return { ok: true, cwd: target.workspace, drawing: target.drawing, id, index, element }
}

/**
 * Shallow-merge a patch into one element. `id` and `type` are immutable; the
 * version, nonce and timestamp are refreshed, and a patch that makes the
 * element unrenderable is rejected before anything is written.
 * @param target - resolved scene target.
 * @param id - element id.
 * @param patch - fields to merge.
 * @returns the updated element.
 */
export async function updateElement(
  target: SceneTarget,
  id: string,
  patch: Record<string, unknown>,
): Promise<ElementUpdateResult> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error('excalidraw_element_update: `patch` must be an object')
  }
  assertSafeKeys(patch, 'excalidraw_element_update')
  return withSceneLock(target, async () => {
    const parts = await editableParts(target, 'excalidraw_element_update')
    const index = parts.elements.findIndex(element =>
      typeof element === 'object' && element !== null && (element as Record<string, unknown>)['id'] === id)
    if (index < 0) throw new Error(`excalidraw_element_update: element not found: ${id}`)
    const current = parts.elements[index] as Record<string, unknown>
    if (patch['id'] !== undefined && patch['id'] !== id) {
      throw new Error('excalidraw_element_update: `id` cannot be changed')
    }
    if (patch['type'] !== undefined && patch['type'] !== current['type']) {
      throw new Error('excalidraw_element_update: `type` cannot be changed')
    }
    const merged: Record<string, unknown> = {
      ...structuredClone(current), ...structuredClone(patch), id, type: current['type'],
    }
    touch(merged)
    // Tombstoned elements survive sanitization but never render, so this check
    // must run before the file is written — otherwise the caller sees an error
    // on a mutation that already happened.
    if (merged['isDeleted'] === true) {
      throw new Error('excalidraw_element_update: the update makes the element unrenderable')
    }
    const check = sanitizeScene({ elements: [structuredClone(merged)], appState: parts.appState }) as {
      elements?: unknown[]
    }
    if (!Array.isArray(check.elements) || check.elements.length === 0) {
      throw new Error('excalidraw_element_update: the update makes the element unrenderable')
    }
    const elements = [...parts.elements]
    elements[index] = merged
    const saved = await saveWithPreview(target, { ...parts, elements })
    const persisted = visibleElements(saved.persisted.elements).find(element => element['id'] === id)
    if (persisted === undefined) {
      throw new Error('excalidraw_element_update: the update makes the element unrenderable')
    }
    return {
      ok: true,
      cwd: target.workspace,
      drawing: target.drawing,
      id,
      element: persisted,
      totalElements: saved.persisted.elements.length,
      ...(saved.previewSvg !== undefined ? { previewSvg: saved.previewSvg } : {}),
    }
  })
}

/**
 * Delete elements by id. Bound text children of a deleted container are removed
 * with it, and references from remaining elements (bindings, `boundElements`,
 * `containerId`) are cleared so no element points at a missing target.
 * @param target - resolved scene target.
 * @param ids - element ids to delete.
 * @returns the deleted and missing ids.
 */
export async function deleteElements(
  target: SceneTarget,
  ids: readonly string[],
): Promise<ElementDeleteResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('excalidraw_element_delete: `ids` must be a non-empty array')
  }
  return withSceneLock(target, async () => {
    const parts = await editableParts(target, 'excalidraw_element_delete')
    const present = new Map<string, Record<string, unknown>>()
    for (const element of parts.elements) {
      if (typeof element === 'object' && element !== null && typeof (element as Record<string, unknown>)['id'] === 'string') {
        present.set((element as Record<string, unknown>)['id'] as string, element as Record<string, unknown>)
      }
    }
    const removed = new Set<string>()
    const missing: string[] = []
    for (const id of ids) {
      const element = present.get(id)
      if (element === undefined) {
        missing.push(id)
        continue
      }
      removed.add(id)
      if (Array.isArray(element['boundElements'])) {
        for (const binding of element['boundElements'] as unknown[]) {
          if (typeof binding === 'object' && binding !== null
            && (binding as Record<string, unknown>)['type'] === 'text'
            && typeof (binding as Record<string, unknown>)['id'] === 'string') {
            removed.add((binding as Record<string, unknown>)['id'] as string)
          }
        }
      }
    }
    const elements = parts.elements
      .filter(element => typeof element !== 'object' || element === null
        || !removed.has((element as Record<string, unknown>)['id'] as string))
      .filter((element): element is Record<string, unknown> => typeof element === 'object' && element !== null)
    for (const element of elements) {
      // Excalidraw reconciles on `version`; without a touch the cleared
      // references never reach the canvas (and may be overwritten by peers).
      let changed = false
      if (Array.isArray(element['boundElements'])) {
        const kept = (element['boundElements'] as unknown[]).filter(binding =>
          typeof binding !== 'object' || binding === null
          || !removed.has((binding as Record<string, unknown>)['id'] as string))
        if (kept.length !== (element['boundElements'] as unknown[]).length) changed = true
        element['boundElements'] = kept.length > 0 ? kept : null
      }
      for (const field of ['startBinding', 'endBinding'] as const) {
        const binding = element[field]
        if (typeof binding === 'object' && binding !== null
          && removed.has((binding as Record<string, unknown>)['elementId'] as string)) {
          element[field] = null
          changed = true
        }
      }
      const containerId = element['containerId']
      if (typeof containerId === 'string' && removed.has(containerId)) {
        element['containerId'] = null
        changed = true
      }
      if (changed) touch(element)
    }
    const saved = await saveWithPreview(target, { ...parts, elements, files: pruneFiles(elements, parts.files) })
    return {
      ok: true,
      cwd: target.workspace,
      drawing: target.drawing,
      deleted: [...removed],
      missing,
      totalElements: saved.persisted.elements.length,
      ...(saved.previewSvg !== undefined ? { previewSvg: saved.previewSvg } : {}),
    }
  })
}

/** Read an element's numeric geometry, defaulting to zero. */
function geometryOf(element: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    x: number(element['x']),
    y: number(element['y']),
    width: Math.max(0, number(element['width'])),
    height: Math.max(0, number(element['height'])),
  }
}

/**
 * Expand a selection to whole groups and attached labels so a layout move never
 * tears a group or separates a label from its container.
 */
function expandSelection(
  all: readonly Record<string, unknown>[],
  requested: readonly string[] | undefined,
  tool: string,
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const element of all) {
    if (typeof element['id'] === 'string') byId.set(element['id'], element)
  }
  let selected: Record<string, unknown>[]
  if (requested === undefined) {
    selected = [...all]
  } else {
    selected = requested.map((id) => {
      const element = byId.get(id)
      if (element === undefined) throw new Error(`${tool}: element not found: ${id}`)
      return element
    })
  }
  const selectedIds = new Set(selected.map(element => element['id'] as string))
  let changed = true
  while (changed) {
    changed = false
    for (const element of all) {
      const id = element['id']
      if (typeof id !== 'string' || selectedIds.has(id)) continue
      const groupIds = Array.isArray(element['groupIds']) ? element['groupIds'] as unknown[] : []
      const sharesGroup = groupIds.some(groupId =>
        selected.some(chosen => Array.isArray(chosen['groupIds']) && (chosen['groupIds'] as unknown[]).includes(groupId)))
      const containerId = element['containerId']
      const belongsToContainer = typeof containerId === 'string' && selectedIds.has(containerId)
      const boundChild = selected.some(chosen => Array.isArray(chosen['boundElements'])
        && (chosen['boundElements'] as unknown[]).some(binding =>
          typeof binding === 'object' && binding !== null
          && (binding as Record<string, unknown>)['id'] === id))
      if (sharesGroup || belongsToContainer || boundChild) {
        selectedIds.add(id)
        selected.push(element)
        changed = true
      }
    }
  }
  return selected
}

/** Apply a translation to one element. */
function moveBy(element: Record<string, unknown>, dx: number, dy: number): void {
  const geometry = geometryOf(element)
  element['x'] = geometry.x + dx
  element['y'] = geometry.y + dy
  touch(element)
}

/** Clone selected elements with fresh ids and remapped internal references. */
function duplicateSelection(
  selected: readonly Record<string, unknown>[],
  offsetX: number,
  offsetY: number,
): Record<string, unknown>[] {
  const idMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  for (const element of selected) {
    const id = element['id']
    if (typeof id === 'string') idMap.set(id, newElementId())
  }
  for (const element of selected) {
    if (!Array.isArray(element['groupIds'])) continue
    for (const groupId of element['groupIds'] as unknown[]) {
      if (typeof groupId === 'string' && !groupMap.has(groupId)) {
        groupMap.set(groupId, `group-${randomBytes(6).toString('hex')}`)
      }
    }
  }
  return selected.map((source) => {
    const clone = structuredClone(source)
    const oldId = source['id']
    const id = typeof oldId === 'string' ? idMap.get(oldId) : undefined
    if (id !== undefined) clone['id'] = id
    const geometry = geometryOf(clone)
    clone['x'] = geometry.x + offsetX
    clone['y'] = geometry.y + offsetY
    clone['version'] = 1
    clone['versionNonce'] = randomInt()
    clone['seed'] = randomInt()
    clone['index'] = fractionalIndex()
    clone['updated'] = Date.now()
    if (Array.isArray(clone['groupIds'])) {
      clone['groupIds'] = (clone['groupIds'] as unknown[])
        .map(groupId => typeof groupId === 'string' ? groupMap.get(groupId) : undefined)
        .filter((groupId): groupId is string => groupId !== undefined)
    }
    const containerId = clone['containerId']
    clone['containerId'] = typeof containerId === 'string' ? idMap.get(containerId) ?? null : null
    if (Array.isArray(clone['boundElements'])) {
      const kept = (clone['boundElements'] as unknown[]).flatMap((binding) => {
        if (typeof binding !== 'object' || binding === null) return []
        const record = binding as Record<string, unknown>
        const target = typeof record['id'] === 'string' ? idMap.get(record['id']) : undefined
        return target === undefined ? [] : [{ ...record, id: target }]
      })
      clone['boundElements'] = kept.length > 0 ? kept : null
    }
    for (const field of ['startBinding', 'endBinding'] as const) {
      const binding = clone[field]
      if (typeof binding !== 'object' || binding === null) continue
      const record = binding as Record<string, unknown>
      const target = typeof record['elementId'] === 'string' ? idMap.get(record['elementId']) : undefined
      clone[field] = target === undefined ? null : { ...record, elementId: target }
    }
    return clone
  })
}

/**
 * Transform a selection of elements: align, distribute, group/ungroup, lock or
 * duplicate. Selection expands to whole groups and attached labels. Mutated
 * elements get a fresh version/nonce; duplicate clones remap ids, groups,
 * labels and arrow bindings to the copies.
 * @param target - resolved scene target.
 * @param action - layout action.
 * @param options - element ids, duplicate offset and explicit groups to ungroup.
 * @returns the affected elements and optional new group id.
 */
export async function layoutScene(
  target: SceneTarget,
  action: LayoutAction,
  options: {
    ids?: readonly string[]
    offsetX?: number
    offsetY?: number
    groupIds?: readonly string[]
  } = {},
): Promise<LayoutResult> {
  if (!(LAYOUT_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`excalidraw_layout: unsupported action "${String(action)}"`)
  }
  return withSceneLock(target, () => layoutSceneLocked(target, action, options))
}

async function layoutSceneLocked(
  target: SceneTarget,
  action: LayoutAction,
  options: {
    ids?: readonly string[]
    offsetX?: number
    offsetY?: number
    groupIds?: readonly string[]
  },
): Promise<LayoutResult> {
  const parts = await editableParts(target, 'excalidraw_layout')
  const all = visibleElements(parts.elements)
  if (all.length === 0) throw new Error('excalidraw_layout: the drawing has no elements')
  if (options.ids !== undefined && options.ids.length === 0) {
    throw new Error('excalidraw_layout: `ids` must not be empty when provided')
  }
  const selected = expandSelection(all, options.ids, 'excalidraw_layout')
  let affected: Record<string, unknown>[] = selected
  let groupId: string | undefined
  let removedGroups: string[] | undefined

  if (action === 'align-left' || action === 'align-center-h' || action === 'align-right'
    || action === 'align-top' || action === 'align-middle' || action === 'align-bottom') {
    if (selected.length < 2) throw new Error('excalidraw_layout: alignment needs at least 2 elements')
    const boxes = selected.map(geometryOf)
    const minX = Math.min(...boxes.map(box => box.x))
    const maxX = Math.max(...boxes.map(box => box.x + box.width))
    const minY = Math.min(...boxes.map(box => box.y))
    const maxY = Math.max(...boxes.map(box => box.y + box.height))
    for (const element of selected) {
      const box = geometryOf(element)
      let dx = 0
      let dy = 0
      if (action === 'align-left') dx = minX - box.x
      else if (action === 'align-center-h') dx = (minX + maxX) / 2 - (box.x + box.width / 2)
      else if (action === 'align-right') dx = maxX - (box.x + box.width)
      else if (action === 'align-top') dy = minY - box.y
      else if (action === 'align-middle') dy = (minY + maxY) / 2 - (box.y + box.height / 2)
      else dy = maxY - (box.y + box.height)
      moveBy(element, dx, dy)
    }
  } else if (action === 'distribute-h' || action === 'distribute-v') {
    if (selected.length < 3) throw new Error('excalidraw_layout: distribution needs at least 3 elements')
    const horizontal = action === 'distribute-h'
    const ordered = [...selected].sort((left, right) => {
      const a = geometryOf(left)
      const b = geometryOf(right)
      return horizontal ? a.x - b.x : a.y - b.y
    })
    const boxes = ordered.map(geometryOf)
    const first = boxes[0] as { x: number; y: number; width: number; height: number }
    const last = boxes[boxes.length - 1] as { x: number; y: number; width: number; height: number }
    const start = horizontal ? first.x : first.y
    const end = horizontal ? last.x + last.width : last.y + last.height
    const total = boxes.reduce((sum, box) => sum + (horizontal ? box.width : box.height), 0)
    const gap = (end - start - total) / (ordered.length - 1)
    let cursor = start
    ordered.forEach((element, index) => {
      const box = geometryOf(element)
      const size = horizontal ? box.width : box.height
      if (index > 0 && index < ordered.length - 1) {
        const targetPosition = cursor
        moveBy(element, horizontal ? targetPosition - box.x : 0, horizontal ? 0 : targetPosition - box.y)
      }
      cursor += size + gap
    })
  } else if (action === 'group') {
    if (selected.length < 2) throw new Error('excalidraw_layout: grouping needs at least 2 elements')
    groupId = `group-${randomBytes(6).toString('hex')}`
    for (const element of selected) {
      const groups = Array.isArray(element['groupIds']) ? element['groupIds'] as unknown[] : []
      element['groupIds'] = [...groups.filter(group => group !== groupId), groupId]
      touch(element)
    }
  } else if (action === 'ungroup') {
    const requested = options.groupIds
    const removed = new Set<string>()
    for (const element of selected) {
      const groups = Array.isArray(element['groupIds']) ? element['groupIds'] as string[] : []
      const kept = groups.filter((group) => {
        const remove = requested === undefined || requested.includes(group)
        if (remove) removed.add(group)
        return !remove
      })
      if (kept.length !== groups.length) {
        element['groupIds'] = kept
        touch(element)
      }
    }
    removedGroups = [...removed]
  } else if (action === 'lock' || action === 'unlock') {
    for (const element of selected) {
      element['locked'] = action === 'lock'
      touch(element)
    }
  } else if (action === 'duplicate') {
    const offsetX = options.offsetX ?? 20
    const offsetY = options.offsetY ?? 20
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
      throw new Error('excalidraw_layout: duplicate offset must be finite numbers')
    }
    const clones = duplicateSelection(selected, offsetX, offsetY)
    affected = clones
    parts.elements = [...parts.elements, ...clones]
  }

  const saved = await saveWithPreview(target, parts)
  return {
    ok: true,
    cwd: target.workspace,
    drawing: target.drawing,
    action,
    affected: affected.length,
    ids: affected.map(element => element['id']).filter((id): id is string => typeof id === 'string'),
    totalElements: saved.persisted.elements.length,
    ...(groupId !== undefined ? { groupId } : {}),
    ...(removedGroups !== undefined ? { removedGroups } : {}),
    ...(saved.previewSvg !== undefined ? { previewSvg: saved.previewSvg } : {}),
  }
}

/**
 * Place an image file from inside the workspace on the canvas as an Excalidraw
 * image element. Dimensions come from the file itself; supplying only one side
 * preserves the aspect ratio. The binary is embedded in the scene `files` map,
 * so the drawing stays self-contained.
 * @param target - resolved scene target.
 * @param options - source path, position and optional size.
 * @returns the created element and file ids.
 */
export async function addImage(
  target: SceneTarget,
  options: {
    path: string
    x?: number
    y?: number
    width?: number
    height?: number
  },
): Promise<AddImageResult> {
  const trimmed = options.path.trim()
  if (trimmed.length === 0) throw new Error('excalidraw_add_image: `path` is required')
  const abs = await resolveWorkspacePath(target.workspace, trimmed, 'excalidraw_add_image')
  const mimeType = IMAGE_MIME_TYPES[extname(trimmed).toLowerCase()]
  if (mimeType === undefined) {
    throw new Error('excalidraw_add_image: unsupported image type; use png, jpeg, gif, webp or svg')
  }
  let size: Awaited<ReturnType<typeof stat>>
  try {
    size = await stat(abs)
  } catch {
    throw new Error(`excalidraw_add_image: file not found: ${trimmed}`)
  }
  if (size.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `excalidraw_add_image: ${trimmed} is ${size.size} bytes, above the ${MAX_IMAGE_BYTES} byte limit`,
    )
  }
  let data: Buffer
  try {
    data = await readFile(abs)
  } catch {
    throw new Error(`excalidraw_add_image: file not found: ${trimmed}`)
  }
  let intrinsic: { width?: number; height?: number; type?: string }
  try {
    intrinsic = imageSize(data)
  } catch {
    throw new Error(`excalidraw_add_image: ${trimmed} is not a readable ${mimeType} image`)
  }
  // The extension is caller-controlled; the detected type must agree with it,
  // so a renamed file cannot be served with the wrong content type.
  const detected = intrinsic.type !== undefined ? DETECTED_IMAGE_MIME[intrinsic.type] : undefined
  if (detected !== mimeType) {
    throw new Error(
      `excalidraw_add_image: ${trimmed} is ${detected ?? 'an unsupported format'}, not ${mimeType}`,
    )
  }
  const intrinsicWidth = intrinsic.width
  const intrinsicHeight = intrinsic.height
  if (intrinsicWidth === undefined || intrinsicHeight === undefined
    || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    throw new Error(`excalidraw_add_image: cannot determine the size of ${trimmed}`)
  }
  let width = options.width
  let height = options.height
  if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
    throw new Error('excalidraw_add_image: `width` must be a positive number')
  }
  if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
    throw new Error('excalidraw_add_image: `height` must be a positive number')
  }
  if (width === undefined && height === undefined) {
    width = intrinsicWidth
    height = intrinsicHeight
  } else if (width === undefined) {
    width = (height as number) * intrinsicWidth / intrinsicHeight
  } else if (height === undefined) {
    height = width * intrinsicHeight / intrinsicWidth
  }
  const x = options.x ?? 0
  const y = options.y ?? 0
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('excalidraw_add_image: `x` and `y` must be finite numbers')
  }
  const elementId = newElementId()
  const fileId = `file-${randomBytes(10).toString('hex')}`
  const dataURL = `data:${mimeType};base64,${data.toString('base64')}`
  const element: Record<string, unknown> = {
    id: elementId,
    type: 'image',
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    index: fractionalIndex(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    roundness: null,
    fileId,
    status: 'saved',
    scale: [1, 1],
    crop: null,
  }
  return withSceneLock(target, async () => {
    const parts = await editableParts(target, 'excalidraw_add_image')
    const saved = await saveWithPreview(target, {
      ...parts,
      elements: [...parts.elements, element],
      files: {
        ...parts.files,
        [fileId]: {
          id: fileId,
          mimeType,
          dataURL,
          created: Date.now(),
        },
      },
    })
    return {
      ok: true,
      cwd: target.workspace,
      drawing: target.drawing,
      elementId,
      fileId,
      path: abs,
      width: Math.round(width as number),
      height: Math.round(height as number),
      mimeType,
      bytes: data.length,
      totalElements: saved.persisted.elements.length,
      ...(saved.previewSvg !== undefined ? { previewSvg: saved.previewSvg } : {}),
    }
  })
}
