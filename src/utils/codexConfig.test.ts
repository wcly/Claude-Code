import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        enabled: true,
        baseURL: 'https://api.openai.com/v1/',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { readCodexConfig } = await import('./codexConfig.js')
    const result = readCodexConfig()

    expect(result.enabled).toBe(true)
    expect(result.isValid).toBe(true)
    expect(result.baseURL).toBe('https://api.openai.com/v1')
  })

  test('marks config invalid when required fields are missing', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        enabled: true,
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-5-codex',
      }),
    )

    const { readCodexConfig } = await import('./codexConfig.js')
    const result = readCodexConfig()

    expect(result.enabled).toBe(true)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('apiKey')
  })

  test('returns the active config only when codex config is valid', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { getActiveCodexConfig, hasValidCodexConfig } = await import(
      './codexConfig.js'
    )

    expect(hasValidCodexConfig()).toBe(true)
    expect(getActiveCodexConfig()?.model).toBe('gpt-5-codex')
  })

  test('reloads codex config after codex.json changes in the same process', async () => {
    const configPath = join(configDir, 'codex.json')

    writeFileSync(
      configPath,
      JSON.stringify({
        baseURL: 'https://www.packyapi.com',
        apiKey: 'sk-old',
        model: 'gpt-5.4',
      }),
    )

    const { readCodexConfig } = await import('./codexConfig.js')

    expect(readCodexConfig()).toMatchObject({
      baseURL: 'https://www.packyapi.com',
      model: 'gpt-5.4',
    })

    writeFileSync(
      configPath,
      JSON.stringify({
        baseURL: 'https://www.packyapi.com/v1',
        apiKey: 'sk-new',
        model: 'gpt-5-codex',
      }),
    )

    expect(readCodexConfig()).toMatchObject({
      baseURL: 'https://www.packyapi.com/v1',
      model: 'gpt-5-codex',
      apiKey: 'sk-new',
    })
  })
})
