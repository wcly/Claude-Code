# Global `ccc` Install Design

## Summary

This change makes the restored CLI installable as a global command named `ccc` without changing how the app detects the current workspace. The design uses a thin executable wrapper that keeps the caller's current working directory intact, resolves the repository root from the wrapper's own location, and then forwards execution into the existing development entrypoint.

The design also hardens the restored development entrypoint so its missing-import preflight checks always scan the restored repository itself instead of accidentally scanning whatever directory the user happened to run `ccc` from.

## Goals

- Expose a global command named `ccc`.
- Support local global linking with Bun or npm-style workflows.
- Preserve current workspace detection so the active workspace remains the directory where the user runs `ccc`.
- Avoid changing the main CLI startup path more than necessary.
- Keep the implementation small and auditable in this restored codebase.

## Non-Goals

- Publishing this package to npm.
- Building a bundled single-file binary.
- Reworking the existing CLI boot sequence.
- Fixing unrelated restored-entry limitations beyond global invocation support.

## User Experience

### Installation flow

From the repository root, the user installs dependencies and links the package globally:

- `bun install`
- `bun link`

After linking, the user can run `ccc` from any project directory.

### Runtime behavior

When a user runs `ccc` from `/path/to/project`, Claude Code should still treat `/path/to/project` as the current workspace. The wrapper must not change `process.cwd()` or implicitly switch into the repository where the `ccc` command was installed from.

### Restored-entry behavior

If the restored source tree still has missing relative imports, `ccc` should show the same restored development workspace message that the repository shows today. The only difference is that the missing-import scan should inspect the restored repository, not the user's current project.

## Approach Options

### Option A: Thin wrapper plus repository-root-aware dev entrypoint

Add a `bin` mapping in `package.json` for `ccc`, create a thin `bin/ccc` executable, and update `src/dev-entry.ts` so it resolves `src/` and `vendor/` relative to the repository root derived from the file location.

This keeps startup behavior stable, preserves workspace detection, and fixes the current mismatch between global invocation and repository-local preflight scanning.

### Option B: Point `bin.ccc` directly at `src/dev-entry.ts`

Expose `src/dev-entry.ts` directly as the executable.

This is smaller on paper, but it is unsafe in practice because the current entrypoint resolves `src/` and `vendor/` from `process.cwd()`. A global invocation from another project would make the preflight scan inspect the wrong tree.

### Option C: Add a build step and publish a generated executable

Build a separate distribution artifact and point the global command at that artifact.

This could improve long-term ergonomics, but it adds packaging complexity that is unnecessary for the immediate goal and increases churn in a restored repository.

### Recommendation

Use **Option A**.

It is the smallest change that provides correct behavior for both global linking and workspace detection, and it avoids introducing a new build pipeline.

## Design

## Packaging changes

Update `package.json` to expose:

```json
{
  "bin": {
    "ccc": "./bin/ccc"
  }
}
```

The package remains private. The goal is local global linking, not registry publishing.

## Wrapper design

Create `bin/ccc` as a Bun executable with a shebang:

- `#!/usr/bin/env bun`

Responsibilities:

- Resolve the absolute path to the repository root from the wrapper file's own path.
- Resolve the development entrypoint from that repository root.
- Dynamically import the development entrypoint.
- Preserve `process.argv` passthrough semantics.
- Preserve `process.cwd()` exactly as provided by the invoking shell.

The wrapper should be intentionally thin and should not own any CLI logic.

## Dev entrypoint hardening

Update `src/dev-entry.ts` so repository-relative scanning does not depend on the caller's current working directory.

Required changes:

- Derive the repository root from `import.meta.url`.
- Scan `<repoRoot>/src` and `<repoRoot>/vendor` instead of `resolve('src')` and `resolve('vendor')`.
- Keep the existing help/version/restored-message behavior unchanged.
- Continue forwarding into `src/entrypoints/cli.tsx` when no relative imports are missing.

This change ensures the preflight logic always reasons about the restored codebase itself while the main runtime still uses the user's working directory as workspace context.

## Workspace detection

No workspace-detection logic should be changed.

The existing startup flow reads the current process working directory, stores it as the original working directory and project root at startup, and passes it into `setup()`. Because the wrapper does not change directories, global invocation should continue to use the caller's directory as the active workspace.

## Error handling

- If `bin/ccc` cannot resolve the development entrypoint, it should fail fast with a clear startup error.
- If the restored entrypoint finds missing imports, it should emit the existing restored workspace output.
- If Bun is unavailable, the shebang-based executable will fail at the shell level, which is acceptable for this local-link workflow.

## Validation

Targeted validation should cover:

- Running `ccc --help` from the repository root.
- Running `ccc --version` from the repository root.
- Running `ccc --help` from a different temporary directory and confirming it still inspects the restored repository instead of the temporary directory.
- Confirming that the active workspace remains the invocation directory by checking the startup path behavior or equivalent observable output.

## Implementation Plan Shape

The implementation can stay small:

1. Add `bin` mapping in `package.json`.
2. Add executable wrapper in `bin/ccc`.
3. Update `src/dev-entry.ts` to resolve repository-relative scan paths safely.
4. Run focused validation for help/version and cross-directory invocation.

## Risks and Mitigations

- **Risk:** The wrapper accidentally changes workspace behavior.
  - **Mitigation:** Keep the wrapper import-only and avoid `process.chdir()`.
- **Risk:** Repository-root detection breaks on symlinked global installs.
  - **Mitigation:** Resolve paths from the executed wrapper file rather than from `process.cwd()`.
- **Risk:** The restored CLI still cannot fully boot because of missing imports.
  - **Mitigation:** Preserve current restored-entry behavior and limit this change to global invocation support.
