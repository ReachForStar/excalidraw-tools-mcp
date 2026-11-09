/** Regression tests for the 2026-11 full-repo review (see docs/wiki/queries/ocr-full-scan-2026-11.md). */
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LAYOUT_ACTIONS, addImage, createElements, deleteElements, layoutScene, updateElement } from '../src/elements.ts'
import { createDrawing } from '../src/drawings.ts'
import { fail, ok } from '../src/mcp/tools/common.ts'
import {
  SCENE_RELATIVE,
  drawScene,
  readScene,
  sceneTarget,
  screenshotScene,
  targetFor,
  workspaceScope,
  writeScene,
} from '../src/scene.ts'

const TEST_ROOT = join(process.cwd(), 'tmp', 'tests')
const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEST_ROOT, 'fix-'))
  workspaces.push(dir)
  return dir
}

/** Read the persisted scene file. */
async function sceneOnDisk(root: string): Promise<{ elements: Record<string, unknown>[]; files?: Record<string, unknown> }> {
  return JSON.parse(await readFile(join(root, SCENE_RELATIVE), 'utf8')) as {
    elements: Record<string, unknown>[]
    files?: Record<string, unknown>
  }
}

describe('scene data integrity', () => {
  it('rejects tombstoning an element through update and leaves the file untouched', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await createElements(target, [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }])
    const before = await readFile(target.scenePath, 'utf8')

    await expect(updateElement(target, 'box', { isDeleted: true })).rejects.toThrow('unrenderable')
    expect(await readFile(target.scenePath, 'utf8')).toBe(before)
  })

  it('allows replace to reuse ids from the discarded element list', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await createElements(target, [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }])
    const replaced = await createElements(
      target,
      [{ id: 'box', type: 'ellipse', x: 0, y: 0, width: 20, height: 20 }],
      'replace',
    )
    expect(replaced).toMatchObject({ ok: true, ids: ['box'], totalElements: 1 })
    expect((await sceneOnDisk(root)).elements[0]).toMatchObject({ id: 'box', type: 'ellipse' })
  })

  it('rejects an image element whose fileId is not embedded in the scene', async () => {
    const root = await workspace()
    await expect(createElements(sceneTarget(root), [
      { id: 'img', type: 'image', x: 0, y: 0, width: 10, height: 10, fileId: 'missing', status: 'saved' },
    ])).rejects.toThrow('fileId')
  })

  it('prunes embedded files nothing references and touches elements with cleared bindings', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await writeScene(target, JSON.stringify({
      elements: [
        {
          id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10,
          boundElements: [{ type: 'text', id: 'label' }],
        },
        { id: 'label', type: 'text', x: 0, y: 0, width: 5, height: 5, text: 'hi', containerId: 'box' },
        { id: 'img', type: 'image', x: 0, y: 0, width: 5, height: 5, fileId: 'f1', status: 'saved' },
      ],
      appState: {},
      files: {
        f1: { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 },
        f2: { id: 'f2', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 },
      },
    }))
    const before = (await sceneOnDisk(root)).elements.find(element => element['id'] === 'box')!

    await deleteElements(target, ['label', 'img'])
    const after = await sceneOnDisk(root)
    expect(after.elements.map(element => element['id'])).toEqual(['box'])
    expect(after.elements[0]!['boundElements']).toBeNull()
    expect(after.elements[0]!['version'] as number).toBeGreaterThan(before['version'] as number)
    expect(after.files).toBeUndefined()
  })

  it('rejects an unknown layout action instead of duplicating', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await createElements(target, [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }])
    expect(LAYOUT_ACTIONS).not.toContain('duplicate-x')
    await expect(layoutScene(target, 'duplicate-x' as never)).rejects.toThrow('unsupported action')
  })

  it('rejects malformed polyline points', async () => {
    const root = await workspace()
    await expect(drawScene(sceneTarget(root), [
      { type: 'line', x: 0, y: 0, width: 10, height: 10, points: [[1]] },
    ])).rejects.toThrow('points')
    await expect(drawScene(sceneTarget(root), [
      { type: 'line', x: 0, y: 0, width: 10, height: 10, points: [[0, 0]] },
    ])).rejects.toThrow('points')
  })

  it('compares the scene echo cap in bytes, not UTF-16 units', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await writeScene(target, JSON.stringify({
      elements: [{
        id: 'big', type: 'rectangle', x: 0, y: 0, width: 10, height: 10,
        // 100k CJK characters: ~300 KB UTF-8 but under the 128 KiB string length.
        note: '图'.repeat(100_000),
      }],
      appState: {},
    }))
    expect((await readScene(target)).sceneJson).toBeUndefined()
  })
})

describe('concurrency', () => {
  it('serializes concurrent element appends instead of losing updates', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await Promise.all(Array.from({ length: 5 }, (_, index) => createElements(target, [
      { id: `box-${index}`, type: 'rectangle', x: index * 10, y: 0, width: 10, height: 10 },
    ])))
    expect((await sceneOnDisk(root)).elements).toHaveLength(5)
  })

  it('lets only one of two concurrent creates with the same id succeed', async () => {
    const root = await workspace()
    const results = await Promise.allSettled([createDrawing(root, 'race'), createDrawing(root, 'race')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect((rejected as PromiseRejectedResult).reason.message).toContain('already exists')
  })
})

describe('image intake', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK8sAAAAASUVORK5CYII=',
    'base64',
  )

  it('rejects a file whose content disagrees with its extension', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await writeFile(join(root, 'fake.png'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>', 'utf8')
    await expect(addImage(target, { path: 'fake.png' })).rejects.toThrow('not image/png')
  })

  it('rejects oversized images before reading them', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    const path = join(root, 'huge.png')
    await writeFile(path, png)
    await truncate(path, 10 * 1024 * 1024 + 1)
    await expect(addImage(target, { path: 'huge.png' })).rejects.toThrow('byte limit')
  })
})

describe('path boundaries', () => {
  it('rejects a symlinked image that points outside the workspace', async () => {
    const root = await workspace()
    const outside = await workspace()
    await writeFile(join(outside, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await symlink(join(outside, 'secret.png'), join(root, 'link.png'))
    await expect(addImage(sceneTarget(root), { path: 'link.png' })).rejects.toThrow('inside the workspace')
  })

  it('rejects a workspace symlink that points outside the allowed roots', async () => {
    const root = await workspace()
    const outside = await workspace()
    await symlink(outside, join(root, 'alias'))
    await expect(targetFor(workspaceScope([root]), 'alias')).rejects.toThrow('outside the allowed roots')
  })

  it('refuses to overwrite non-PNG paths with a screenshot', async () => {
    const root = await workspace()
    const target = sceneTarget(root)
    await writeScene(target, JSON.stringify({
      elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }],
      appState: {},
    }))
    // Rejected before any rendering, so no browser is needed.
    await expect(screenshotScene(target, { path: 'scene.json' })).rejects.toThrow('.png')
  })
})

describe('MCP result contract', () => {
  it('wraps failures as structured JSON and serializes undefined as null', () => {
    const failed = fail(new Error('boom'))
    expect(failed.isError).toBe(true)
    expect(JSON.parse(failed.content[0]!.text)).toEqual({ ok: false, error: 'boom' })
    expect(ok(undefined).content[0]!.text).toBe('null')
  })
})