import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { getClaudeConfigHomeDir } from './envUtils.js'

export type CodexConfig = {
  enabled: boolean
  isValid: boolean
  path: string
  baseURL?: string
  apiKey?: string
  model?: string
  proxy?: {
    http?: string
    https?: string
  }
  error?: string
}

type RawCodexConfig = {
  enabled?: boolean
  baseURL?: unknown
  apiKey?: unknown
  model?: unknown
  proxy?: {
    http?: unknown
    https?: unknown
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : undefined
}

function normalizeBaseURL(baseURL: unknown): string | undefined {
  const normalizedBaseURL = normalizeOptionalString(baseURL)
  if (!normalizedBaseURL) {
    return undefined
  }

  return normalizedBaseURL.replace(/\/+$/, '')
}

function buildMissingFieldsError(config: CodexConfig): string | undefined {
  const missingFields = ['baseURL', 'apiKey', 'model'].filter(
    field => !config[field as keyof Pick<CodexConfig, 'baseURL' | 'apiKey' | 'model'>],
  )

  if (missingFields.length === 0) {
    return undefined
  }

  return `Missing required Codex config fields: ${missingFields.join(', ')}`
}

export function getCodexConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'codex.json')
}

export function readCodexConfig(): CodexConfig {
  const path = getCodexConfigPath()
  if (!existsSync(path)) {
    return {
      enabled: false,
      isValid: false,
      path,
    }
  }

  try {
    const parsed = JSON.parse(
      readFileSync(path, { encoding: 'utf8' }),
    ) as RawCodexConfig

    const enabled = parsed.enabled !== false
    const config: CodexConfig = {
      enabled,
      isValid: false,
      path,
      baseURL: normalizeBaseURL(parsed.baseURL),
      apiKey: normalizeOptionalString(parsed.apiKey),
      model: normalizeOptionalString(parsed.model),
      proxy: parsed.proxy
        ? {
            http: normalizeOptionalString(parsed.proxy.http),
            https: normalizeOptionalString(parsed.proxy.https),
          }
        : undefined,
    }

    if (!enabled) {
      return config
    }

    const error = buildMissingFieldsError(config)
    return {
      ...config,
      isValid: !error,
      error,
    }
  } catch (error) {
    return {
      enabled: false,
      isValid: false,
      path,
      error:
        error instanceof Error
          ? `Invalid Codex config JSON: ${error.message}`
          : 'Invalid Codex config JSON',
    }
  }
}

export function hasValidCodexConfig(): boolean {
  return readCodexConfig().isValid
}

export function getActiveCodexConfig(): CodexConfig | null {
  const config = readCodexConfig()
  return config.isValid ? config : null
}

export function _resetCodexConfigCacheForTesting(): void {
  return
}
