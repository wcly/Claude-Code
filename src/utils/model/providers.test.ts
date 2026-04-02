import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    rmSync(configDir, { recursive: true, force: true })
  })

  test('prefers codex over first-party when codex config is valid', async () => {
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

  test('prefers codex over third-party env providers when codex config is valid', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'

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
