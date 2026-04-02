# Codex OpenAI Provider Design

## Summary

This change adds an optional Codex/OpenAI runtime path to the restored Claude Code codebase without removing the existing Anthropic login and request flow. When a local Codex configuration file is present and valid, the app should skip the login-method picker and route large-model traffic through the OpenAI Responses API. When the configuration is missing or invalid, the current Anthropic-based flow remains the default.

The design intentionally avoids a risky full rewrite. Instead, it introduces a provider split at the model client/request layer and keeps the current internal message model, tool model, and UI structure as stable as possible.

## Goals

- Preserve the current Anthropic login flow as the fallback path.
- Add a dedicated Codex configuration file for `baseURL`, `apiKey`, `model`, and proxy settings.
- Detect a valid Codex config during startup and prefer Codex/OpenAI automatically.
- Route all large-model requests through the OpenAI Responses API when Codex mode is active.
- Keep the internal chat/tool workflow usable across both providers.
- Minimize the amount of unrelated churn in this restored codebase.

## Non-Goals

- Removing Anthropic, Bedrock, Vertex, or Foundry support.
- Rebuilding every Anthropic-specific feature in the first iteration.
- Reusing `cc-switch` or embedding external desktop proxy logic.
- Refactoring the entire internal message architecture.
- Solving every provider-specific telemetry mismatch in the first pass.

## User Experience

### Startup and login behavior

At startup, the app checks for a Codex config file before showing the existing login-method selection flow. If the config exists and passes validation, the app enters Codex mode and bypasses the current login prompt that asks the user to choose between Claude subscription, Anthropic Console, and third-party platforms.

If the Codex config is absent, disabled, or incomplete, the existing login flow behaves exactly as it does today.

### Status behavior

The authentication/status surfaces should no longer treat Codex mode as "not logged in". Instead, they should show a provider-aware state such as "Codex config" or "OpenAI API key" so the app can operate without forcing Anthropic-specific login messaging.

### Failure behavior

If Codex mode is selected by config but the config is malformed or the OpenAI request fails due to invalid credentials or base URL issues, the app should surface a provider-specific configuration error. It should not silently fall back to Anthropic for that session, because that would hide misconfiguration and create surprising behavior.

## Configuration Design

### File location

Add a dedicated user-scoped config file in the Claude config home directory so it lives beside the existing app config but remains logically separate from Anthropic settings.

Proposed filename:

- `~/.claude/codex.json`

This keeps the implementation simple and consistent with the repo's existing JSON config patterns. The config should be read-only from the app's point of view in the first iteration; users edit it manually.

### Schema

Initial schema:

```json
{
  "enabled": true,
  "baseURL": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-5-codex",
  "proxy": {
    "http": "http://127.0.0.1:7890",
    "https": "http://127.0.0.1:7890"
  }
}
```

Field rules:

- `enabled`: optional boolean, defaults to `true` when the file exists.
- `baseURL`: required non-empty string.
- `apiKey`: required non-empty string.
- `model`: required non-empty string.
- `proxy.http`: optional string.
- `proxy.https`: optional string.

Validation rules:

- If the file exists and `enabled === false`, Codex mode is disabled.
- If the file exists and is enabled but missing `baseURL`, `apiKey`, or `model`, startup treats Codex mode as invalid and surfaces an actionable config error.
- `baseURL` should be normalized to avoid trailing slash issues.

### Config loading responsibility

Add a dedicated Codex config loader instead of overloading the global config type with provider-specific secrets. This keeps the current config object stable and avoids mixing Anthropic and OpenAI auth semantics into the same storage path.

Proposed new module:

- `src/utils/codexConfig.ts`

Responsibilities:

- Resolve config path.
- Read/parse JSON.
- Validate required fields.
- Return normalized config plus a derived `isEnabledAndValid` state.

## Provider Model

### New provider type

Expand the provider concept so the request layer can distinguish Anthropic-family traffic from Codex/OpenAI traffic.

Current provider code is Anthropic-oriented and only knows:

- `firstParty`
- `bedrock`
- `vertex`
- `foundry`

Add:

- `codex`

The provider resolver should check Codex config first. If a valid Codex config is present, it returns `codex`. Otherwise it keeps the current environment-based provider behavior unchanged.

### Provider selection principle

Provider choice must be centralized. The rest of the code should ask for the active provider instead of independently guessing based on auth state or environment variables.

This keeps the Codex path from scattering conditional logic across login, request, model, and status modules.

## Request Architecture

### Current state

The existing request path is deeply coupled to the Anthropic SDK:

- client creation uses `@anthropic-ai/sdk`
- main requests use `anthropic.beta.messages.create(...)`
- streaming and fallback handling interpret Anthropic event formats
- tool schemas are shaped around Anthropic tool definitions

This means Codex support cannot be added by only swapping a base URL.

### Proposed architecture

Introduce a provider-specific API layer while preserving the current high-level query flow.

New split:

- Anthropic path remains in the current API modules
- Codex path gets a parallel OpenAI client and adapter layer

Proposed new modules:

- `src/services/api/openaiClient.ts`
- `src/services/api/openaiResponses.ts`
- `src/services/api/openaiStreamAdapter.ts`

Responsibilities:

- `openaiClient.ts`: create an OpenAI client using `baseURL`, `apiKey`, and proxy-aware fetch options.
- `openaiResponses.ts`: execute non-streaming and streaming Responses API calls.
- `openaiStreamAdapter.ts`: map Responses API events and final payloads into the app's internal message/event model.

The top-level query path should branch once by provider, not many times by feature.

## Message Mapping

### Internal-to-OpenAI mapping

The app should continue to use its existing internal `Message` model. For Codex mode, add a mapper that converts internal messages into OpenAI Responses `input` items.

Mapping strategy:

- System prompt -> `instructions`
- User message text -> `input` item with `role: "user"` and `input_text`
- Assistant text -> `input` item with `role: "assistant"` and output text history where required
- Tool calls/results -> OpenAI function call / function call output items

The first iteration should focus on text and function-call paths that power the CLI's core behavior.

### OpenAI-to-internal mapping

OpenAI Responses outputs should be normalized back into the app's internal assistant/tool event structures so downstream UI code changes stay small.

Needed output handling:

- final assistant text
- function call outputs
- streaming text deltas
- request/response usage metadata

This adapter layer is the key compatibility boundary and should stay isolated from UI code.

## Tool Calling

### Tool schema conversion

Existing tools are already represented with structured schemas before being handed to Anthropic. Codex mode should convert those tool definitions into OpenAI function tools:

- Anthropic-style tool name -> OpenAI function `name`
- tool description -> OpenAI function `description`
- JSON schema -> OpenAI function `parameters`

Parallel tool calls should map to OpenAI's standard function-calling behavior where possible.

### Tool result continuation

When the model returns function calls, the current tool execution pipeline should continue to run locally. The only provider-specific part should be:

- how the call is decoded from the model response
- how the tool result is sent back into the next model turn

This preserves the current tool execution engine and limits scope.

## Model Selection

### Default model behavior

When Codex mode is active, the configured `model` in `codex.json` is authoritative. The Anthropic default-model selection logic should not run for Codex sessions.

Recommended default example:

- `gpt-5-codex`

The OpenAI docs confirm GPT-5-Codex is available through the Responses API only, which is why this path needs its own provider implementation rather than reuse of Anthropic Messages calls.

### `/model` and related controls

The existing `/model` command will need provider-aware validation:

- in Anthropic mode, keep current behavior
- in Codex mode, allow the configured OpenAI model or other explicitly supported OpenAI models

The first iteration can keep this narrow and only support the configured Codex model cleanly, rather than trying to port the entire Anthropic model alias system.

## Login and Auth Changes

### Login UI

Do not remove the current `ConsoleOAuthFlow` implementation. Instead, gate entry into it:

- valid Codex config -> skip login selection UI
- no valid Codex config -> existing login UI appears unchanged

### Auth helpers

Current auth helpers assume "logged in" means Anthropic OAuth, Anthropic API key, or supported third-party Anthropic providers. Codex mode needs a separate auth source classification.

Update status/auth helpers so they can report:

- `codex_config`
- `openai_api_key`

This prevents false negatives in onboarding and status commands.

## Proxy Support

Proxy config should be supported in the Codex config file and fed into the OpenAI fetch/client layer. The design should reuse existing proxy utilities where possible instead of inventing separate networking code.

The preferred approach is:

- normalize proxy values from `codex.json`
- inject them through a provider-aware fetch builder
- keep the proxy behavior local to OpenAI/Codex requests

This avoids side effects on Anthropic and third-party provider flows.

## Error Handling

### Config errors

Codex config errors should be surfaced clearly and early:

- invalid JSON
- missing required fields
- unsupported or empty model
- malformed base URL

These should produce actionable terminal errors that tell the user to fix `~/.claude/codex.json`.

### Runtime errors

OpenAI request errors should be rendered with provider-aware labels so users can distinguish them from Anthropic failures. For example:

- invalid API key
- unsupported model
- network/proxy failure
- malformed Responses payload

### Fallback policy

Runtime request failures in Codex mode should not auto-switch to Anthropic in the same session. Silent cross-provider fallback would make failures harder to reason about and could accidentally send prompts to the wrong backend.

## Analytics and Provider Metadata

The codebase currently logs provider and auth metadata assuming Anthropic semantics. The first iteration should make this safe rather than perfect.

Required behavior:

- do not mislabel Codex requests as Anthropic first-party
- do not assume Anthropic OAuth account data exists in Codex mode
- avoid provider-specific crashes in analytics enrichment

It is acceptable for first-pass Codex analytics to be more limited than Anthropic analytics as long as the app remains stable.

## Testing Strategy

There is no strong root test harness in this restored repo, so validation should focus on targeted checks near the changed modules.

Planned verification:

- unit-style tests for Codex config parsing if there is already adjacent test coverage support
- smoke validation for provider resolution
- manual runtime validation of startup behavior:
  - no `codex.json` -> old login flow appears
  - valid `codex.json` -> login flow is skipped
- manual validation of one Codex text request
- manual validation of one Codex tool-call request
- `bun run version` to confirm the CLI still boots

If there is no adjacent test pattern for a module, favor focused runtime checks over introducing an entirely new test framework.

## File-Level Plan

Likely new files:

- `src/utils/codexConfig.ts`
- `src/services/api/openaiClient.ts`
- `src/services/api/openaiResponses.ts`
- `src/services/api/openaiStreamAdapter.ts`

Likely modified files:

- `src/utils/model/providers.ts`
- `src/interactiveHelpers.tsx`
- `src/components/ConsoleOAuthFlow.tsx`
- `src/cli/handlers/auth.ts`
- `src/utils/auth.ts`
- `src/services/api/client.ts`
- `src/services/api/claude.ts`
- `src/utils/model/model.ts`

## Risks

- Anthropic-only assumptions are spread wider than the obvious API modules.
- Streaming event adaptation may require more UI-facing normalization than expected.
- Some side-query or auxiliary model paths may still call Anthropic code until explicitly migrated.
- Provider-specific analytics or status rendering may surface hidden coupling.

## Recommended Delivery Sequence

1. Add Codex config loader and provider resolution.
2. Gate startup/login flow on valid Codex config.
3. Add OpenAI client creation and a minimal Responses request path.
4. Add internal message -> Responses input mapping.
5. Add streaming and function-call adapters.
6. Make auth/status/provider metadata Codex-aware.
7. Run focused smoke validation on both Codex and legacy Anthropic startup paths.

## Open Questions Resolved

- Keep old login flow? Yes, as fallback only.
- Add a separate Codex config file? Yes.
- Should requests keep Anthropic format? No.
- Should the Codex path use OpenAI's official API shape? Yes, via Responses API.

## Recommendation

Implement Codex support as a first-class optional provider, not as a base-URL tweak on Anthropic SDK calls. This gives the smallest change that is still structurally correct: Anthropic remains intact, Codex becomes a config-driven OpenAI Responses provider, and startup chooses between them deterministically.
