import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isEntryPoint } from '../src/mcp.ts'

const TEST_ROOT = join(process.cwd(), 'tmp', 'tests', 'entry')
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function fixture(withLink = false): Promise<{ real: string; other: string; link: string; url: string }> {
  await mkdir(TEST_ROOT, { recursive: true })
  const dir = await mkdtemp(join(TEST_ROOT, 'case-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const real = join(dir, 'mcp.mjs')
  const other = join(dir, 'other.mjs')
  const link = join(dir, 'excalidraw-mcp')
  await writeFile(real, '')
  await writeFile(other, '')
  if (withLink) await symlink(real, link, 'file')
  return { real, other, link, url: pathToFileURL(real).href }
}

describe('excalidraw-mcp entry detection', () => {
  it.skipIf(process.platform === 'win32')('recognizes a symlinked bin', async () => {
    const { link, url } = await fixture(true)
    expect(isEntryPoint(link, url)).toBe(true)
  })

  it('recognizes the real module path', async () => {
    const { real, url } = await fixture()
    expect(isEntryPoint(real, url)).toBe(true)
  })

  it('rejects missing, unrelated, and absent entries', async () => {
    const { other, url } = await fixture()
    expect(isEntryPoint(other, url)).toBe(false)
    expect(isEntryPoint(join(TEST_ROOT, 'missing'), url)).toBe(false)
    expect(isEntryPoint(undefined, url)).toBe(false)
  })
})
