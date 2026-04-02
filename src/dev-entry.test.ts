import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const repoRoot = join(import.meta.dir, '..')

describe('dev entry packaging', () => {
  test('package manifest exposes the ccc launcher', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

    expect(pkg.bin).toMatchObject({
      ccc: './bin/ccc',
    })
    expect(pkg.bin.cc).toBeUndefined()
  })

  test('derives the repository root from the entry file path', async () => {
    const { getRepoRootFromEntryFile } = await import('./devEntryPaths.js')

    expect(getRepoRootFromEntryFile('/tmp/example-repo/src/dev-entry.ts')).toBe(
      '/tmp/example-repo',
    )
  })

  test('builds scan roots from the repository root instead of process cwd', async () => {
    const { getScanRootsForRepo } = await import('./devEntryPaths.js')

    expect(getScanRootsForRepo('/tmp/example-repo')).toEqual([
      '/tmp/example-repo/src',
      '/tmp/example-repo/vendor',
    ])
  })

  test('ccc launcher uses a bun shebang and does not change directories', () => {
    const launcher = readFileSync(join(repoRoot, 'bin', 'ccc'), 'utf8')

    expect(launcher.startsWith('#!/usr/bin/env bun')).toBe(true)
    expect(launcher.includes('process.chdir(')).toBe(false)
  })
})
