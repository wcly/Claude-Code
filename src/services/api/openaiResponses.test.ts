import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { createUserMessage } from '../../utils/messages.js'

describe('openai responses adapter', () => {
  let configDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'claude-openai-'))
    process.env.CLAUDE_CONFIG_DIR = configDir
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )
  })

  afterEach(async () => {
    const { _resetCodexConfigCacheForTesting } = await import(
      '../../utils/codexConfig.js'
    )

    _resetCodexConfigCacheForTesting()

    delete process.env.CLAUDE_CONFIG_DIR

    rmSync(configDir, { recursive: true, force: true })
  })

  test('builds OpenAI input items from user, tool call, and tool result history', async () => {
    const { buildOpenAIInputItems } = await import('./openaiResponses.js')

    const items = buildOpenAIInputItems([
      createUserMessage({ content: 'List project files' }),
      {
        type: 'assistant',
        uuid: 'assistant-1',
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg_1',
          container: null,
          model: 'gpt-5-codex',
          role: 'assistant',
          stop_reason: 'tool_use',
          stop_sequence: null,
          type: 'message',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
            service_tier: 'standard',
            cache_creation: {
              ephemeral_1h_input_tokens: 0,
              ephemeral_5m_input_tokens: 0,
            },
            inference_geo: '',
            iterations: [],
            speed: 'standard',
          },
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'Bash',
              input: { command: 'ls' },
            },
          ],
          context_management: null,
        },
      },
      createUserMessage({
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_1',
            content: 'README.md\nsrc',
          },
        ],
      }),
    ] as never[])

    expect(items).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'List project files' }],
      },
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'Bash',
        arguments: '{"command":"ls"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: 'README.md\nsrc',
      },
    ])
  })

  test('encodes assistant text history as output_text for responses api', async () => {
    const { buildOpenAIInputItems } = await import('./openaiResponses.js')

    const items = buildOpenAIInputItems([
      createUserMessage({ content: '你好' }),
      {
        type: 'assistant',
        uuid: 'assistant-2',
        timestamp: new Date().toISOString(),
        message: {
          id: 'msg_2',
          container: null,
          model: 'gpt-5-codex',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
            service_tier: 'standard',
            cache_creation: {
              ephemeral_1h_input_tokens: 0,
              ephemeral_5m_input_tokens: 0,
            },
            inference_geo: '',
            iterations: [],
            speed: 'standard',
          },
          content: [
            {
              type: 'text',
              text: '你好！很高兴和你一起合作。',
            },
          ],
          context_management: null,
        },
      },
      createUserMessage({ content: '你是什么模型' }),
    ] as never[])

    expect(items).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '你好' }],
      },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '你好！很高兴和你一起合作。' }],
      },
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '你是什么模型' }],
      },
    ])
  })

  test('maps a Responses API payload into assistant messages and synthetic stream events', async () => {
    const { queryOpenAIWithStreaming } = await import('./openaiResponses.js')

    const requestBodies: unknown[] = []
    const fetchOverride = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          id: 'resp_123',
          model: 'gpt-5-codex',
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            input_tokens_details: {
              cached_tokens: 2,
            },
          },
          output: [
            {
              type: 'message',
              id: 'msg_123',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Hello from Codex' }],
            },
            {
              type: 'function_call',
              call_id: 'call_123',
              name: 'Bash',
              arguments: '{"command":"pwd"}',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      )
    }

    const results = []
    for await (const item of queryOpenAIWithStreaming({
      messages: [createUserMessage({ content: 'Say hi and inspect cwd' })],
      systemPrompt: asSystemPrompt(['You are a helpful coding assistant.']),
      thinkingConfig: { type: 'disabled' },
      tools: [
        {
          name: 'Bash',
          prompt: async () => 'Run a shell command',
          inputJSONSchema: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        } as never,
      ],
      signal: new AbortController().signal,
      options: {
        getToolPermissionContext: async () =>
          ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }) as never,
        model: 'gpt-5-codex',
        isNonInteractiveSession: false,
        querySource: 'sdk',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
        fetchOverride,
      },
    })) {
      results.push(item)
    }

    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]).toMatchObject({
      model: 'gpt-5-codex',
      instructions: 'You are a helpful coding assistant.',
      tools: [
        expect.objectContaining({
          type: 'function',
          name: 'Bash',
        }),
      ],
    })

    const shape = results.map(item => {
      if (item.type === 'stream_event') {
        return `stream:${String(item.event.type)}`
      }

      const firstBlock = Array.isArray(item.message?.content)
        ? item.message.content[0]
        : null

      return `assistant:${String(firstBlock?.type)}`
    })

    expect(shape).toEqual([
      'stream:message_start',
      'assistant:text',
      'assistant:tool_use',
      'stream:message_delta',
      'stream:message_stop',
    ])

    expect(results[2]).toMatchObject({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'call_123',
            name: 'Bash',
            input: {
              command: 'pwd',
            },
          },
        ],
      },
    })
  })

  test('falls back to chat completions when responses endpoint returns non-json', async () => {
    const { queryOpenAIWithStreaming } = await import('./openaiResponses.js')

    let callCount = 0
    const fetchOverride = async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1
      const url = String(input)

      if (url.endsWith('/responses')) {
        return new Response('upstream proxy banner', {
          status: 200,
          headers: {
            'content-type': 'text/plain',
          },
        })
      }

      expect(url.endsWith('/chat/completions')).toBe(true)
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'gpt-5-codex',
      })

      return new Response(
        JSON.stringify({
          id: 'chatcmpl_123',
          model: 'gpt-5-codex',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: 'I will inspect the cwd.',
                tool_calls: [
                  {
                    id: 'call_chat_1',
                    type: 'function',
                    function: {
                      name: 'Bash',
                      arguments: '{"command":"pwd"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 7,
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      )
    }

    const results = []
    for await (const item of queryOpenAIWithStreaming({
      messages: [createUserMessage({ content: 'Check cwd' })],
      systemPrompt: asSystemPrompt(['You are a helpful coding assistant.']),
      thinkingConfig: { type: 'disabled' },
      tools: [
        {
          name: 'Bash',
          prompt: async () => 'Run a shell command',
          inputJSONSchema: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        } as never,
      ],
      signal: new AbortController().signal,
      options: {
        getToolPermissionContext: async () =>
          ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }) as never,
        model: 'gpt-5-codex',
        isNonInteractiveSession: false,
        querySource: 'sdk',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
        fetchOverride,
      },
    })) {
      results.push(item)
    }

    expect(callCount).toBe(2)
    expect(results.some(item => item.type === 'assistant')).toBe(true)
    expect(results).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: 'tool_use',
              id: 'call_chat_1',
              name: 'Bash',
            }),
          ],
        }),
      }),
    )
  })

  test('surfaces responses json errors without falling back to chat completions', async () => {
    const { queryOpenAIWithStreaming } = await import('./openaiResponses.js')

    let callCount = 0
    let chatFallbackCalled = false
    const fetchOverride = async (input: RequestInfo | URL) => {
      callCount += 1
      const url = String(input)

      if (url.endsWith('/responses')) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'unsupported model for responses',
              type: 'invalid_request_error',
            },
          }),
          {
            status: 400,
            headers: {
              'content-type': 'application/json',
            },
          },
        )
      }

      chatFallbackCalled = true
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_unexpected',
          model: 'gpt-5-codex',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'unexpected chat fallback',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      )
    }

    const results = []
    for await (const item of queryOpenAIWithStreaming({
      messages: [createUserMessage({ content: 'Check cwd' })],
      systemPrompt: asSystemPrompt(['You are a helpful coding assistant.']),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: {
        getToolPermissionContext: async () =>
          ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }) as never,
        model: 'gpt-5-codex',
        isNonInteractiveSession: false,
        querySource: 'sdk',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
        fetchOverride,
      },
    })) {
      results.push(item)
    }

    expect(callCount).toBe(1)
    expect(chatFallbackCalled).toBe(false)
    expect(results).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining(
                'OpenAI Responses request failed (400)',
              ),
            }),
          ],
        }),
      }),
    )
  })

  test('retries against /v1 when baseURL points at a web app root', async () => {
    writeFileSync(
      join(configDir, 'codex.json'),
      JSON.stringify({
        baseURL: 'https://proxy.example.com',
        apiKey: 'sk-test',
        model: 'gpt-5-codex',
      }),
    )

    const { _resetCodexConfigCacheForTesting } = await import(
      '../../utils/codexConfig.js'
    )
    _resetCodexConfigCacheForTesting()

    const { queryOpenAIWithStreaming } = await import('./openaiResponses.js')

    const urls: string[] = []
    const fetchOverride = async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)

      if (url === 'https://proxy.example.com/responses') {
        return new Response('<html>web app</html>', {
          status: 200,
          headers: {
            'content-type': 'text/html',
          },
        })
      }

      if (url === 'https://proxy.example.com/v1/responses') {
        return new Response(
          JSON.stringify({
            id: 'resp_v1',
            model: 'gpt-5-codex',
            usage: {
              input_tokens: 3,
              output_tokens: 2,
            },
            output: [
              {
                type: 'message',
                id: 'msg_v1',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Hello via /v1' }],
              },
            ],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        )
      }

      return new Response('unexpected', { status: 500 })
    }

    const results = []
    for await (const item of queryOpenAIWithStreaming({
      messages: [createUserMessage({ content: 'Say hi' })],
      systemPrompt: asSystemPrompt(['You are a helpful coding assistant.']),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: {
        getToolPermissionContext: async () =>
          ({
            mode: 'default',
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: false,
          }) as never,
        model: 'gpt-5-codex',
        isNonInteractiveSession: false,
        querySource: 'sdk',
        agents: [],
        hasAppendSystemPrompt: false,
        mcpTools: [],
        fetchOverride,
      },
    })) {
      results.push(item)
    }

    expect(urls).toEqual([
      'https://proxy.example.com/responses',
      'https://proxy.example.com/v1/responses',
    ])
    expect(results).toContainEqual(
      expect.objectContaining({
        type: 'assistant',
        message: expect.objectContaining({
          content: [
            expect.objectContaining({
              type: 'text',
              text: 'Hello via /v1',
            }),
          ],
        }),
      }),
    )
  })
})
