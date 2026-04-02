# Codex OpenAI Provider Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional `~/.claude/codex.json` configuration path that skips the Anthropic onboarding login step and routes large-model traffic through the OpenAI Responses API, while preserving the current Anthropic login and request flow as the fallback.

**Architecture:** Keep Anthropic, Bedrock, Vertex, and Foundry behavior intact. Add a new `codex` provider chosen from a dedicated config loader in `src/utils/codexConfig.ts`. Keep the existing exported request entrypoints in `src/services/api/claude.ts`, but make them dispatch to new OpenAI Responses modules when `getAPIProvider()` resolves to `codex`. Gate onboarding/login selection off the same provider resolver so startup is deterministic.

**Tech Stack:** Bun, TypeScript/ESM, Ink/React, existing Anthropic SDK path, new OpenAI Node SDK path, Bun test for pure helper and adapter coverage.

---

## File Structure

**Create**

- `src/utils/codexConfig.ts` — load, validate, normalize, and cache `~/.claude/codex.json`.
- `src/utils/codexConfig.test.ts` — verify config parsing, normalization, and skip-login decisions.
- `src/utils/model/providers.test.ts` — verify provider precedence and Codex selection.
- `src/services/api/openaiClient.ts` — build an OpenAI client from Codex config and proxy-aware fetch.
- `src/services/api/openaiResponses.ts` — build Responses API payloads and execute streaming/non-streaming Codex requests.
- `src/services/api/openaiResponses.test.ts` — verify internal-message → Responses payload conversion.
- `src/services/api/openaiStreamAdapter.ts` — translate Responses streaming/final outputs into internal events/messages.
- `src/services/api/openaiStreamAdapter.test.ts` — verify text delta and function-call mapping.
- `src/utils/model/modelOptions.test.ts` — verify Codex mode collapses `/model` choices to the configured model.

**Modify**

- `package.json` — add the `openai` dependency.
- `src/utils/model/providers.ts` — add `codex` provider and config-first precedence.
- `src/utils/auth.ts` — treat valid Codex config as an auth source and avoid Anthropic-only assumptions.
- `src/interactiveHelpers.tsx` — keep onboarding, but skip the OAuth step when Codex mode is active.
- `src/components/Onboarding.tsx` — remove the OAuth onboarding step in Codex mode.
- `src/cli/handlers/auth.ts` — show provider-aware auth status when Codex mode is active.
- `src/utils/status.tsx` — render Codex base URL/proxy/provider properties.
- `src/services/api/bootstrap.ts` — skip Anthropic bootstrap fetches in Codex mode.
- `src/services/api/claude.ts` — branch exported query functions to Anthropic or OpenAI Responses.
- `src/utils/model/model.ts` — use the Codex-configured model as the default active model in Codex mode.
- `src/utils/model/modelOptions.ts` — collapse the picker to the configured Codex model when provider is `codex`.
- `src/commands/model/model.tsx` — avoid Anthropic validation paths in Codex mode.
- `src/utils/model/validateModel.ts` — accept the configured Codex model without Anthropic validation.

## Implementation Notes

- Keep `setup-token`, Teleport’s forced Claude.ai login, and other explicitly Anthropic-only flows unchanged. The skip behavior is for startup/onboarding, not for every place `ConsoleOAuthFlow` exists.
- Keep `queryModelWithStreaming` and `queryModelWithoutStreaming` exported from `src/services/api/claude.ts` so existing import sites like `src/query/deps.ts` and `src/services/awaySummary.ts` continue to work without broad call-site churn.
- Add pure helper exports in new OpenAI modules so behavior can be covered with Bun tests before wiring network calls.
- Use `CLAUDE_CONFIG_DIR` in tests and manual validation so the developer’s real `~/.claude` directory is untouched.

## Chunk 1: Codex Config and Provider Resolution

### Task 1: Add Codex config loader

**Files:**
- Create: `src/utils/codexConfig.ts`
- Test: `src/utils/codexConfig.test.ts`

- [ ] **Step 1: Write the failing config-loader test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('codex config loader', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-codex-config-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    rmSync(configDir, { recursive: true, force: true })
  })

  test('returns enabled normalized config when codex.json is complete', async () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        enabled: true,
        baseURL: 'https://api.openai.com/v1/',
        apiKey: 'sk-test',
        model: 'gpt-5-codex'
      }),
    )

    const { readCodexConfig } = await import('./codexConfig.js')
    const result = readCodexConfig()

    expect(result.enabled).toBe(true)
    expect(result.isValid).toBe(true)
    expect(result.baseURL).toBe('https://api.openai.com/v1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/codexConfig.test.ts`

Expected: FAIL because `src/utils/codexConfig.ts` does not exist yet.

- [ ] **Step 3: Write the minimal config loader**

```ts
export type CodexConfig = {
  enabled: boolean
  isValid: boolean
  path: string
  baseURL?: string
  apiKey?: string
  model?: string
  proxy?: { http?: string; https?: string }
  error?: string
}

export function getCodexConfigPath(): string
export function readCodexConfig(): CodexConfig
export function hasValidCodexConfig(): boolean
export function getActiveCodexConfig(): CodexConfig | null
export function _resetCodexConfigCacheForTesting(): void
```

Implementation details:

- Read `join(getClaudeConfigHomeDir(), 'codex.json')`.
- Default `enabled` to `true` when the file exists.
- Trim trailing slash from `baseURL`.
- Set `isValid` only when `enabled` is true and `baseURL`, `apiKey`, and `model` are all non-empty strings.
- Return `error` text for malformed JSON or missing required fields.
- Memoize reads, but expose `_resetCodexConfigCacheForTesting()` to avoid stale cache during Bun tests.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/utils/codexConfig.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/codexConfig.ts src/utils/codexConfig.test.ts
git commit -m "feat: add codex config loader"
```

### Task 2: Add provider precedence for Codex

**Files:**
- Modify: `src/utils/model/providers.ts`
- Modify: `src/utils/auth.ts`
- Test: `src/utils/model/providers.test.ts`

- [ ] **Step 1: Write the failing provider test**

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('provider resolution', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-provider-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    rmSync(configDir, { recursive: true, force: true })
  })

  test('prefers codex over first-party when codex config is valid', async () => {
    mkdirSync(configDir, { recursive: true })
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { getAPIProvider } = await import('./providers.js')
    expect(getAPIProvider()).toBe('codex')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/model/providers.test.ts`

Expected: FAIL because `getAPIProvider()` does not return `codex`.

- [ ] **Step 3: Implement provider precedence and auth-source hooks**

```ts
export type APIProvider =
  | 'codex'
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'

export function getAPIProvider(): APIProvider {
  if (hasValidCodexConfig()) return 'codex'
  // existing env-based resolution follows unchanged
}
```

Auth-side updates:

- Add a Codex-aware helper in `src/utils/auth.ts`:

```ts
export function hasCodexAuth(): boolean {
  return hasValidCodexConfig()
}
```

- Keep `isAnthropicAuthEnabled()` semantics Anthropic-specific.
- Do not let valid Codex config masquerade as Anthropic OAuth or Anthropic API key.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/utils/codexConfig.test.ts src/utils/model/providers.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/providers.ts src/utils/auth.ts src/utils/model/providers.test.ts
git commit -m "feat: add codex provider selection"
```

## Chunk 2: Startup, Onboarding, and Status

### Task 3: Skip the onboarding OAuth step in Codex mode

**Files:**
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/interactiveHelpers.tsx`
- Test: `src/utils/codexConfig.test.ts`

- [ ] **Step 1: Extend the failing helper test for skip-login behavior**

```ts
test('shouldSkipAnthropicOAuthOnboarding returns true when codex config is valid', async () => {
  writeFileSync(
    join(configDir, 'codex.json'),
    JSON.stringify({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5-codex',
    }),
  )

  const { shouldSkipAnthropicOAuthOnboarding } = await import('./codexConfig.js')
  expect(shouldSkipAnthropicOAuthOnboarding(true)).toBe(true)
  expect(shouldSkipAnthropicOAuthOnboarding(false)).toBe(false)
})
```

The UI wiring should depend on `shouldSkipAnthropicOAuthOnboarding()` instead of adding a new untested condition inline.

- [ ] **Step 2: Run the test to verify it fails for the intended reason**

Run: `bun test src/utils/codexConfig.test.ts`

Expected: FAIL because `shouldSkipAnthropicOAuthOnboarding()` does not exist yet.

- [ ] **Step 3: Implement the onboarding gate**

Implementation details:

- In `src/utils/codexConfig.ts`, add:

```ts
export function shouldSkipAnthropicOAuthOnboarding(
  oauthEnabled: boolean,
): boolean {
  return oauthEnabled && hasValidCodexConfig()
}
```

- In `src/components/Onboarding.tsx`, compute `const codexEnabled = hasValidCodexConfig()`.
- Keep the preflight and theme steps.
- When `codexEnabled` is true, do **not** push the `oauth` onboarding step.
- Leave `setup-token`, `/login`, and Teleport-specific login surfaces unchanged.
- In `src/interactiveHelpers.tsx`, keep onboarding completion logic unchanged; only the onboarding contents should differ.

- [ ] **Step 4: Run the test and a focused manual smoke**

Run:

```bash
bun test src/utils/codexConfig.test.ts
CLAUDE_CONFIG_DIR=/tmp/claude-codex-empty bun run version
```

Expected:

- Test PASS
- `bun run version` still prints the version successfully

Manual smoke:

- Start `CLAUDE_CONFIG_DIR=/tmp/claude-codex-valid bun run dev`
- Confirm the onboarding reaches theme/security flow without showing the login-method picker

- [ ] **Step 5: Commit**

```bash
git add src/components/Onboarding.tsx src/interactiveHelpers.tsx src/utils/codexConfig.test.ts
git commit -m "feat: skip onboarding oauth in codex mode"
```

### Task 4: Surface Codex status and skip Anthropic bootstrap

**Files:**
- Modify: `src/cli/handlers/auth.ts`
- Modify: `src/utils/status.tsx`
- Modify: `src/services/api/bootstrap.ts`

- [ ] **Step 1: Write the failing provider-status test**

Add a second assertion block to `src/utils/model/providers.test.ts`:

```ts
test('provider properties render codex-friendly labels', async () => {
  const { buildAPIProviderProperties } = await import('../status.js')
  const props = buildAPIProviderProperties()
  expect(props.some(p => p.value === 'Codex / OpenAI')).toBe(true)
})
```

If importing `status.tsx` is too heavy for a Bun test, instead extract a pure helper:

```ts
export function getProviderDisplayLabel(provider: APIProvider): string
```

and test that helper from `providers.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/model/providers.test.ts`

Expected: FAIL because Codex has no label/status path yet.

- [ ] **Step 3: Implement status/bootstrap handling**

Implementation details:

- In `src/cli/handlers/auth.ts`, detect Codex first and report a non-`none` auth method such as `codex_config`.
- In `src/utils/status.tsx`, add:

```ts
if (apiProvider === 'codex') {
  properties.push({ label: 'API provider', value: 'Codex / OpenAI' })
  properties.push({ label: 'OpenAI base URL', value: codex.baseURL })
}
```

- Reuse configured proxy values from `codex.json` if present rather than pretending `getProxyUrl()` is the only proxy source.
- In `src/services/api/bootstrap.ts`, return early when `getAPIProvider() === 'codex'`.

- [ ] **Step 4: Run the tests and a CLI smoke**

Run:

```bash
bun test src/utils/model/providers.test.ts
CLAUDE_CONFIG_DIR=/tmp/claude-codex-valid bun run ./src/dev-entry.ts auth status --text
```

Expected:

- Test PASS
- Status command reports a Codex/OpenAI-backed auth/provider state instead of "Not logged in"

- [ ] **Step 5: Commit**

```bash
git add src/cli/handlers/auth.ts src/utils/status.tsx src/services/api/bootstrap.ts src/utils/model/providers.test.ts
git commit -m "feat: add codex auth status and bootstrap gating"
```

## Chunk 3: OpenAI Responses Request Path

### Task 5: Add OpenAI SDK client and request builder

**Files:**
- Modify: `package.json`
- Create: `src/services/api/openaiClient.ts`
- Create: `src/services/api/openaiResponses.ts`
- Test: `src/services/api/openaiResponses.test.ts`

- [ ] **Step 1: Write the failing request-builder test**

```ts
import { expect, test } from 'bun:test'
import { createUserMessage } from '../../utils/messages.js'

test('buildResponsesCreateParams maps system and user content', async () => {
  const { buildResponsesCreateParams } = await import('./openaiResponses.js')

  const params = buildResponsesCreateParams({
    model: 'gpt-5-codex',
    systemPromptText: 'You are helpful.',
    messages: [createUserMessage({ content: 'hello' })],
    tools: [],
    stream: false,
  })

  expect(params.model).toBe('gpt-5-codex')
  expect(params.instructions).toBe('You are helpful.')
  expect(params.input).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/services/api/openaiResponses.test.ts`

Expected: FAIL because the OpenAI Responses module does not exist yet.

- [ ] **Step 3: Add the dependency and implement the minimal client/builder**

Run:

```bash
bun add openai
```

Implementation skeleton:

```ts
import OpenAI from 'openai'

export function getOpenAIClient() {
  const codex = getActiveCodexConfig()
  if (!codex) throw new Error('Codex config is not active')
  return new OpenAI({
    apiKey: codex.apiKey,
    baseURL: codex.baseURL,
    fetch: buildCodexFetch(),
  })
}
```

`openaiResponses.ts` should export:

```ts
export function buildResponsesCreateParams(...)
export async function queryModelWithoutStreamingOpenAI(...)
export async function* queryModelWithStreamingOpenAI(...)
```

Use OpenAI Responses fields from the official API shape:

- `model`
- `instructions`
- `input`
- `tools`
- `stream`

Do **not** try to send Anthropic `betas`, `max_tokens`, or `metadata` unchanged.

- [ ] **Step 4: Run the request-builder test to verify it passes**

Run: `bun test src/services/api/openaiResponses.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/services/api/openaiClient.ts src/services/api/openaiResponses.ts src/services/api/openaiResponses.test.ts
git commit -m "feat: add openai responses request builder"
```

### Task 6: Add Responses stream adapter and wire provider dispatch

**Files:**
- Create: `src/services/api/openaiStreamAdapter.ts`
- Test: `src/services/api/openaiStreamAdapter.test.ts`
- Modify: `src/services/api/claude.ts`

- [ ] **Step 1: Write the failing adapter test**

```ts
import { expect, test } from 'bun:test'

test('maps response.output_text.delta into a stream event', async () => {
  const { mapOpenAIStreamEvent } = await import('./openaiStreamAdapter.js')

  const event = mapOpenAIStreamEvent({
    type: 'response.output_text.delta',
    delta: 'Hi',
    output_index: 0,
    content_index: 0,
    item_id: 'msg_1',
  })

  expect(event).not.toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/services/api/openaiStreamAdapter.test.ts`

Expected: FAIL because the stream adapter does not exist yet.

- [ ] **Step 3: Implement the adapter and dispatch path**

Stream adapter responsibilities:

- map `response.output_text.delta` to the internal streaming text event
- map final assistant text output into `AssistantMessage`
- map `function_call` outputs into internal tool-use/tool-result continuation inputs
- capture usage data from final response payloads

In `src/services/api/claude.ts`, update the exported request entrypoints:

```ts
export async function queryModelWithoutStreaming(args) {
  if (getAPIProvider() === 'codex') {
    return queryModelWithoutStreamingOpenAI(args)
  }
  return queryModelWithoutStreamingAnthropic(args)
}

export async function* queryModelWithStreaming(args) {
  if (getAPIProvider() === 'codex') {
    yield* queryModelWithStreamingOpenAI(args)
    return
  }
  yield* queryModelWithStreamingAnthropic(args)
}
```

Do not rename the external exports yet. Keep import stability across:

- `src/query/deps.ts`
- `src/services/awaySummary.ts`
- `src/utils/hooks/apiQueryHookHelper.ts`
- `src/tools/WebSearchTool/WebSearchTool.ts`

- [ ] **Step 4: Run the adapter test and the request tests**

Run:

```bash
bun test src/services/api/openaiResponses.test.ts src/services/api/openaiStreamAdapter.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/openaiStreamAdapter.ts src/services/api/openaiStreamAdapter.test.ts src/services/api/claude.ts
git commit -m "feat: dispatch model requests to openai in codex mode"
```

## Chunk 4: Model UI, Validation, and Final Verification

### Task 7: Restrict `/model` to the configured Codex model

**Files:**
- Modify: `src/utils/model/model.ts`
- Modify: `src/utils/model/modelOptions.ts`
- Modify: `src/commands/model/model.tsx`
- Modify: `src/utils/model/validateModel.ts`

- [ ] **Step 1: Write the failing model-option test**

Create `src/utils/model/modelOptions.test.ts`:

```ts
import { expect, test } from 'bun:test'

test('codex mode exposes only the configured model option', async () => {
  const { getModelOptions } = await import('./modelOptions.js')
  const options = getModelOptions(false)
  expect(options.some(opt => opt.value === 'gpt-5-codex')).toBe(true)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/utils/model/modelOptions.test.ts`

Expected: FAIL because the model picker only knows Anthropic-family options today.

- [ ] **Step 3: Implement the minimal Codex model UX**

Implementation details:

- In `src/utils/model/model.ts`, if provider is `codex`, return the configured Codex model as the default main-loop model.
- In `src/utils/model/modelOptions.ts`, short-circuit to:

```ts
return [
  {
    value: codex.model,
    label: renderModelName(codex.model),
    description: 'Configured in ~/.claude/codex.json',
  },
]
```

- In `src/commands/model/model.tsx`, skip Anthropic validation paths in Codex mode and accept the configured model as-is.
- In `src/utils/model/validateModel.ts`, if provider is `codex`, treat the configured model as valid and reject ad-hoc alternative values with a clear message instead of calling Anthropic validation endpoints.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
bun test src/utils/model/modelOptions.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/model.ts src/utils/model/modelOptions.ts src/utils/model/modelOptions.test.ts src/commands/model/model.tsx src/utils/model/validateModel.ts
git commit -m "feat: limit model picker in codex mode"
```

### Task 8: Run focused verification for both providers

**Files:**
- No code changes required unless a failing check reveals a real bug in the touched scope

- [ ] **Step 1: Run the pure Bun tests**

Run:

```bash
bun test \
  src/utils/codexConfig.test.ts \
  src/utils/model/providers.test.ts \
  src/services/api/openaiResponses.test.ts \
  src/services/api/openaiStreamAdapter.test.ts \
  src/utils/model/modelOptions.test.ts
```

Expected: PASS

- [ ] **Step 2: Run the CLI version smoke**

Run: `bun run version`

Expected: version output prints successfully.

- [ ] **Step 3: Manual smoke with Codex disabled**

Run:

```bash
mkdir -p /tmp/claude-no-codex
CLAUDE_CONFIG_DIR=/tmp/claude-no-codex bun run dev
```

Expected: the existing Anthropic onboarding/login picker still appears.

- [ ] **Step 4: Manual smoke with Codex enabled**

Prepare `/tmp/claude-codex-valid/codex.json`:

```json
{
  "enabled": true,
  "baseURL": "https://api.openai.com/v1",
  "apiKey": "sk-your-key",
  "model": "gpt-5-codex"
}
```

Run:

```bash
CLAUDE_CONFIG_DIR=/tmp/claude-codex-valid bun run dev
```

Expected:

- onboarding does not show the Anthropic login picker
- `/model` shows only the configured Codex model
- one basic prompt succeeds through the OpenAI path

- [ ] **Step 5: Commit the verified implementation**

```bash
git add \
  package.json \
  bun.lock \
  src/utils/codexConfig.ts \
  src/utils/codexConfig.test.ts \
  src/utils/model/providers.ts \
  src/utils/model/providers.test.ts \
  src/utils/auth.ts \
  src/components/Onboarding.tsx \
  src/interactiveHelpers.tsx \
  src/cli/handlers/auth.ts \
  src/utils/status.tsx \
  src/services/api/bootstrap.ts \
  src/services/api/openaiClient.ts \
  src/services/api/openaiResponses.ts \
  src/services/api/openaiResponses.test.ts \
  src/services/api/openaiStreamAdapter.ts \
  src/services/api/openaiStreamAdapter.test.ts \
  src/services/api/claude.ts \
  src/utils/model/model.ts \
  src/utils/model/modelOptions.ts \
  src/utils/model/modelOptions.test.ts \
  src/commands/model/model.tsx \
  src/utils/model/validateModel.ts
git commit -m "feat: add codex openai provider path"
```

## Review Checklist

- Codex config is optional and isolated from Anthropic auth state.
- Startup/onboarding skip only happens when the config is valid.
- Explicit Anthropic-only login surfaces remain available where they are intentionally required.
- Existing Anthropic request flow is unchanged when Codex mode is inactive.
- OpenAI path uses Responses API, not Anthropic `messages` API.
- `/model` does not leak Anthropic-only choices in Codex mode.
- Pure helpers and adapters have Bun coverage before network/manual checks.

## Expected Outcome

After these tasks, the app behaves in two stable modes:

- **No `codex.json`:** current Claude/Anthropic flow remains intact.
- **Valid `codex.json`:** startup uses Codex/OpenAI Responses automatically, all large-model requests go through the OpenAI path, and the login picker is skipped during onboarding.
