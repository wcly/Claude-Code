# `ccc` Global Install Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a globally linkable `ccc` command that launches the restored CLI without changing workspace detection.

**Architecture:** Expose a thin `bin/ccc` launcher through `package.json` and keep it import-only so the calling shell's current working directory remains the active workspace. Harden `src/dev-entry.ts` so its repository preflight scans resolve from the repository root derived from the entry file location rather than from the caller's current directory.

**Tech Stack:** Bun, TypeScript ESM, Bun test

> Commit steps are intentionally omitted from this plan because this session should not create git commits unless the user explicitly requests them.

---

## File Map

- Modify: `package.json`
- Modify: `src/dev-entry.ts`
- Create: `bin/ccc`
- Create: `src/dev-entry.test.ts`

## Chunk 1: Add repository-aware entrypoint tests

### Task 1: Cover repository-root resolution and wrapper-safe scanning

**Files:**
- Create: `src/dev-entry.test.ts`
- Modify: `src/dev-entry.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test'

describe('dev entry path resolution', () => {
  test('finds the repository root from an entry file path', async () => {
    const { getRepoRootFromEntryFile } = await import('./dev-entry.js')

    expect(getRepoRootFromEntryFile('/tmp/repo/src/dev-entry.ts')).toBe(
      '/tmp/repo',
    )
  })

  test('builds scan roots from the repository root instead of process.cwd()', async () => {
    const { getScanRootsForRepo } = await import('./dev-entry.js')

    expect(getScanRootsForRepo('/tmp/repo')).toEqual([
      '/tmp/repo/src',
      '/tmp/repo/vendor',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dev-entry.test.ts`

Expected: FAIL because `getRepoRootFromEntryFile` and `getScanRootsForRepo` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add small exported helpers in `src/dev-entry.ts` that:

- derive the repository root from an absolute entry file path
- derive the `src` and `vendor` scan roots from the repository root

Keep the rest of the entrypoint behavior unchanged for now.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dev-entry.test.ts`

Expected: PASS

## Chunk 2: Expose the `ccc` launcher

### Task 2: Add global `bin` mapping

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Use the existing repository-aware path test file to add an assertion that the package manifest exposes a `ccc` bin entry pointing at `./bin/ccc`.

```ts
test('package manifest exposes the ccc launcher', async () => {
  const pkg = await import('../package.json')

  expect(pkg.default.bin).toMatchObject({
    ccc: './bin/ccc',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dev-entry.test.ts`

Expected: FAIL because `package.json` does not define `bin.ccc`.

- [ ] **Step 3: Write minimal implementation**

Add this shape to `package.json`:

```json
{
  "bin": {
    "ccc": "./bin/ccc"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dev-entry.test.ts`

Expected: PASS

### Task 3: Add the thin `ccc` launcher script

**Files:**
- Create: `bin/ccc`

- [ ] **Step 1: Write the failing test**

Extend `src/dev-entry.test.ts` with a filesystem-level check that `bin/ccc` exists and starts with the Bun shebang.

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

test('ccc launcher uses a bun shebang', () => {
  const launcher = readFileSync(join(import.meta.dir, '..', 'bin', 'ccc'), 'utf8')

  expect(launcher.startsWith('#!/usr/bin/env bun')).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dev-entry.test.ts`

Expected: FAIL because `bin/ccc` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `bin/ccc` as a Bun executable that:

- resolves the repository root from `import.meta.url`
- imports `../src/dev-entry.ts`
- does not call `process.chdir()`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dev-entry.test.ts`

Expected: PASS

## Chunk 3: Wire the repository-aware scan paths into runtime flow

### Task 4: Switch preflight scanning to repository-relative roots

**Files:**
- Modify: `src/dev-entry.ts`
- Test: `src/dev-entry.test.ts`

- [ ] **Step 1: Write the failing test**

Add a focused test that the runtime scan roots are computed from the entry file path rather than from the caller's working directory.

```ts
test('runtime scan roots ignore the caller working directory', async () => {
  const { getRuntimeScanRoots } = await import('./dev-entry.js')

  expect(
    getRuntimeScanRoots({
      entryFile: '/workspace/claude-code/src/dev-entry.ts',
      cwd: '/tmp/other-project',
    }),
  ).toEqual([
    '/workspace/claude-code/src',
    '/workspace/claude-code/vendor',
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/dev-entry.test.ts`

Expected: FAIL because the runtime helper does not exist yet or still depends on `process.cwd()`.

- [ ] **Step 3: Write minimal implementation**

Refactor `src/dev-entry.ts` so the startup path uses the repository-aware scan-root helpers for the missing-import preflight while keeping help/version/forwarding behavior unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/dev-entry.test.ts`

Expected: PASS

## Chunk 4: Validate the launcher end to end

### Task 5: Run focused validation commands

**Files:**
- Modify: `package.json`
- Modify: `src/dev-entry.ts`
- Create: `bin/ccc`
- Create: `src/dev-entry.test.ts`

- [ ] **Step 1: Run the targeted test file**

Run: `bun test src/dev-entry.test.ts`

Expected: PASS

- [ ] **Step 2: Run existing adjacent tests for regression coverage**

Run: `bun test src/utils/codexConfig.test.ts src/utils/auth.test.ts src/utils/status.test.ts`

Expected: PASS

- [ ] **Step 3: Smoke-test version output through the repository entry**

Run: `bun run version`

Expected: Either the normal version output or the current restored-workspace version output, but no path-resolution regression.

- [ ] **Step 4: Smoke-test help output from a different directory**

Run:

```bash
tmpdir="$(mktemp -d)"
cd "$tmpdir"
bun /absolute/path/to/repo/bin/ccc --help
```

Expected: The command reports the restored CLI help or restored-workspace status for the repository, without treating the temporary directory as the source tree.
