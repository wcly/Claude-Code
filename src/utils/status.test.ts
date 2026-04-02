import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('status properties for codex provider', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-status-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    const { _resetCodexConfigCacheForTesting } = await import(
      './codexConfig.js'
    )

    _resetCodexConfigCacheForTesting()

    delete process.env.CLAUDE_CONFIG_DIR

    rmSync(configDir, { recursive: true, force: true })
  })

  test('shows codex provider metadata from codex config', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1/',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
        proxy: {
          https: 'http://127.0.0.1:7890',
        },
      }),
    )

    const { buildAPIProviderProperties } = await import('./status.js')
    const properties = buildAPIProviderProperties()
    const propertyMap = new Map(
      properties
        .filter(prop => prop.label)
        .map(prop => [prop.label as string, String(prop.value)]),
    )

    expect(propertyMap.get('API provider')).toBe('OpenAI-compatible (Codex)')
    expect(propertyMap.get('OpenAI base URL')).toBe(
      'https://api.openai.com/v1',
    )
    expect(propertyMap.get('OpenAI model')).toBe('gpt-5-codex')
    expect(propertyMap.get('HTTPS proxy')).toBe('http://127.0.0.1:7890')
  })
})
