import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('codex model flow', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-codex-model-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    const { _resetCodexConfigCacheForTesting } = await import(
      '../codexConfig.js'
    )
    const { resetSettingsCache } = await import('../settings/settingsCache.js')

    _resetCodexConfigCacheForTesting()
    resetSettingsCache()

    delete process.env.CLAUDE_CONFIG_DIR
    delete process.env.ANTHROPIC_MODEL

    rmSync(configDir, { recursive: true, force: true })
  })

  test('maps defaults and aliases to the configured codex model', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const {
      getDefaultMainLoopModelSetting,
      getMainLoopModel,
      parseUserSpecifiedModel,
    } = await import('./model.js')

    expect(getDefaultMainLoopModelSetting()).toBe('gpt-5-codex')
    expect(getMainLoopModel()).toBe('gpt-5-codex')
    expect(parseUserSpecifiedModel('sonnet')).toBe('gpt-5-codex')
    expect(parseUserSpecifiedModel('opus')).toBe('gpt-5-codex')
    expect(parseUserSpecifiedModel('haiku')).toBe('gpt-5-codex')
  })

  test('collapses model options to the configured codex model', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { getModelOptions } = await import('./modelOptions.js')

    expect(getModelOptions().map(option => option.value)).toEqual([
      null,
      'gpt-5-codex',
    ])
  })

  test('uses the configured codex model for teammate fallbacks', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { getHardcodedTeammateModelFallback } = await import(
      '../swarm/teammateModel.js'
    )

    expect(getHardcodedTeammateModelFallback()).toBe('gpt-5-codex')
  })

  test('accepts only the configured codex model during validation', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { validateModel } = await import('./validateModel.js')

    await expect(validateModel('gpt-5-codex')).resolves.toEqual({ valid: true })

    await expect(validateModel('claude-sonnet-4-6')).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining('gpt-5-codex'),
    })
  })

  test('keeps the configured codex model even when availableModels differs', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )
    writeFileSync(
      join(configDir, 'settings.json'),
      JSON.stringify({
        availableModels: ['claude-sonnet-4-6'],
        model: 'claude-sonnet-4-6',
      }),
    )

    const { isModelAllowed } = await import('./modelAllowlist.js')
    const { getMainLoopModel } = await import('./model.js')

    expect(isModelAllowed('gpt-5-codex')).toBe(true)
    expect(getMainLoopModel()).toBe('gpt-5-codex')
  })
})
