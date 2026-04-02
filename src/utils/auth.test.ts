import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('codex auth gating', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-auth-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    const { _resetCodexConfigCacheForTesting } = await import(
      './codexConfig.js'
    )
    const { resetSettingsCache } = await import('./settings/settingsCache.js')

    _resetCodexConfigCacheForTesting()
    resetSettingsCache()

    delete process.env.CLAUDE_CONFIG_DIR

    rmSync(configDir, { recursive: true, force: true })
  })

  test('disables anthropic auth and treats codex as non-first-party', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { isAnthropicAuthEnabled, isUsing3PServices } = await import(
      './auth.js'
    )

    expect(isAnthropicAuthEnabled()).toBe(false)
    expect(isUsing3PServices()).toBe(true)
  })
})
