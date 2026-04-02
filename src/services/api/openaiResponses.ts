import { randomUUID } from 'crypto'

import type { Tool, Tools, ToolPermissionContext } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../../types/message.js'
import {
  createAssistantAPIErrorMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { getActiveCodexConfig } from '../../utils/codexConfig.js'
import { getProxyAgent, getProxyFetchOptions } from '../../utils/proxy.js'
import { getTLSFetchOptions } from '../../utils/mtls.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import { zodToJsonSchema } from '../../utils/zodToJsonSchema.js'
import { EMPTY_USAGE } from './emptyUsage.js'

import type { Options } from './claude.js'

type OpenAIInputContentPart =
  | {
      type: 'input_text'
      text: string
    }
  | {
      type: 'output_text'
      text: string
    }
  | {
      type: 'input_image'
      image_url: string
    }
  | {
      type: 'input_file'
      filename: string
      file_data: string
    }

type OpenAIInputItem =
  | {
      type: 'message'
      role: 'assistant' | 'user'
      content: OpenAIInputContentPart[]
    }
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

type OpenAITool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

type OpenAIChatCompletionContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image_url'
      image_url: {
        url: string
      }
    }

type OpenAIResponseUsage = {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
  }
}

type OpenAIResponseOutputItem =
  | {
      type: 'message'
      id?: string
      role?: 'assistant'
      content?: Array<{
        type?: string
        text?: string
      }>
    }
  | {
      type: 'function_call'
      call_id?: string
      name?: string
      arguments?: string
    }

type OpenAIResponsePayload = {
  id?: string
  model?: string
  usage?: OpenAIResponseUsage
  output?: OpenAIResponseOutputItem[]
  incomplete_details?: {
    reason?: string
  }
}

type OpenAIChatCompletionToolCall = {
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

type OpenAIChatCompletionPayload = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      role?: 'assistant'
      content?: string | Array<{ type?: string; text?: string }>
      tool_calls?: OpenAIChatCompletionToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
  }
}

type OpenAIRequestErrorReason =
  | 'api_error'
  | 'endpoint_unavailable'
  | 'non_json'
  | 'transport'

class OpenAIRequestError extends Error {
  reason: OpenAIRequestErrorReason
  status?: number
  canFallbackToChatCompletions: boolean

  constructor({
    message,
    reason,
    status,
    canFallbackToChatCompletions,
  }: {
    message: string
    reason: OpenAIRequestErrorReason
    status?: number
    canFallbackToChatCompletions: boolean
  }) {
    super(message)
    this.name = 'OpenAIRequestError'
    this.reason = reason
    this.status = status
    this.canFallbackToChatCompletions = canFallbackToChatCompletions
  }
}

function toDataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`
}

function truncateForError(text: string, maxLength = 400): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function normalizeOpenAIRequestError(error: unknown): OpenAIRequestError {
  if (error instanceof OpenAIRequestError) {
    return error
  }

  return new OpenAIRequestError({
    message: error instanceof Error ? error.message : String(error),
    reason: 'transport',
    canFallbackToChatCompletions: false,
  })
}

function isEndpointUnavailableStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 410 || status === 501
}

function shouldFallbackToChatCompletions(error: unknown): boolean {
  return (
    error instanceof OpenAIRequestError &&
    error.canFallbackToChatCompletions
  )
}

function blockTextFromUnknownContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content)
  }

  const textParts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      textParts.push(JSON.stringify(block))
      continue
    }

    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      textParts.push(block.text)
      continue
    }

    textParts.push(JSON.stringify(block))
  }

  return textParts.join('\n')
}

function buildMessageContentFromBlocks(
  role: 'assistant' | 'user',
  blocks: unknown[],
): OpenAIInputContentPart[] {
  const content: OpenAIInputContentPart[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      continue
    }

    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      content.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: block.text,
      })
      continue
    }

    if (
      block.type === 'image' &&
      'source' in block &&
      block.source &&
      typeof block.source === 'object' &&
      'type' in block.source &&
      block.source.type === 'base64' &&
      'media_type' in block.source &&
      typeof block.source.media_type === 'string' &&
      'data' in block.source &&
      typeof block.source.data === 'string'
    ) {
      content.push({
        type: 'input_image',
        image_url: toDataUrl(block.source.media_type, block.source.data),
      })
      continue
    }

    if (
      block.type === 'document' &&
      'source' in block &&
      block.source &&
      typeof block.source === 'object' &&
      'type' in block.source &&
      block.source.type === 'base64' &&
      'media_type' in block.source &&
      typeof block.source.media_type === 'string' &&
      'data' in block.source &&
      typeof block.source.data === 'string'
    ) {
      const filename =
        'title' in block && typeof block.title === 'string'
          ? block.title
          : 'attachment'

      content.push({
        type: 'input_file',
        filename,
        file_data: toDataUrl(block.source.media_type, block.source.data),
      })
    }
  }

  return content
}

function buildChatCompletionContentFromBlocks(
  blocks: unknown[],
): OpenAIChatCompletionContentPart[] {
  const content: OpenAIChatCompletionContentPart[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      continue
    }

    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      content.push({
        type: 'text',
        text: block.text,
      })
      continue
    }

    if (
      block.type === 'image' &&
      'source' in block &&
      block.source &&
      typeof block.source === 'object' &&
      'type' in block.source &&
      block.source.type === 'base64' &&
      'media_type' in block.source &&
      typeof block.source.media_type === 'string' &&
      'data' in block.source &&
      typeof block.source.data === 'string'
    ) {
      content.push({
        type: 'image_url',
        image_url: {
          url: toDataUrl(block.source.media_type, block.source.data),
        },
      })
    }
  }

  return content
}

function pushMessageBuffer(
  items: OpenAIInputItem[],
  role: 'assistant' | 'user',
  bufferedBlocks: unknown[],
): void {
  if (bufferedBlocks.length === 0) {
    return
  }

  const content = buildMessageContentFromBlocks(role, bufferedBlocks)
  if (content.length === 0) {
    bufferedBlocks.length = 0
    return
  }

  items.push({
    type: 'message',
    role,
    content,
  })

  bufferedBlocks.length = 0
}

function pushChatMessageBuffer(
  items: Array<Record<string, unknown>>,
  role: 'assistant' | 'user',
  bufferedBlocks: unknown[],
): void {
  if (bufferedBlocks.length === 0) {
    return
  }

  const content = buildChatCompletionContentFromBlocks(bufferedBlocks)
  if (content.length === 0) {
    bufferedBlocks.length = 0
    return
  }

  items.push({
    role,
    content,
  })

  bufferedBlocks.length = 0
}

export function buildOpenAIInputItems(
  messages: Message[],
  tools: Tools = [],
): OpenAIInputItem[] {
  const normalizedMessages = normalizeMessagesForAPI(messages, tools)
  const items: OpenAIInputItem[] = []

  for (const message of normalizedMessages) {
    const rawContent =
      typeof message.message.content === 'string'
        ? [{ type: 'text', text: message.message.content }]
        : message.message.content

    const bufferedBlocks: unknown[] = []

    for (const block of rawContent) {
      if (!block || typeof block !== 'object' || !('type' in block)) {
        bufferedBlocks.push(block)
        continue
      }

      if (message.type === 'assistant' && block.type === 'tool_use') {
        pushMessageBuffer(items, 'assistant', bufferedBlocks)
        items.push({
          type: 'function_call',
          call_id:
            'id' in block && typeof block.id === 'string'
              ? block.id
              : randomUUID(),
          name:
            'name' in block && typeof block.name === 'string'
              ? block.name
              : 'unknown',
          arguments: JSON.stringify(
            'input' in block && block.input !== undefined ? block.input : {},
          ),
        })
        continue
      }

      if (message.type === 'user' && block.type === 'tool_result') {
        pushMessageBuffer(items, 'user', bufferedBlocks)
        items.push({
          type: 'function_call_output',
          call_id:
            'tool_use_id' in block && typeof block.tool_use_id === 'string'
              ? block.tool_use_id
              : randomUUID(),
          output:
            'content' in block ? blockTextFromUnknownContent(block.content) : '',
        })
        continue
      }

      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        continue
      }

      bufferedBlocks.push(block)
    }

    pushMessageBuffer(items, message.type === 'assistant' ? 'assistant' : 'user', bufferedBlocks)
  }

  return items
}

function buildChatCompletionMessages(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools = [],
): Array<Record<string, unknown>> {
  const normalizedMessages = normalizeMessagesForAPI(messages, tools)
  const items: Array<Record<string, unknown>> = []
  const systemText = systemPrompt.join('\n\n').trim()

  if (systemText) {
    items.push({
      role: 'system',
      content: systemText,
    })
  }

  for (const message of normalizedMessages) {
    const rawContent =
      typeof message.message.content === 'string'
        ? [{ type: 'text', text: message.message.content }]
        : message.message.content

    const bufferedBlocks: unknown[] = []

    for (const block of rawContent) {
      if (!block || typeof block !== 'object' || !('type' in block)) {
        bufferedBlocks.push(block)
        continue
      }

      if (message.type === 'assistant' && block.type === 'tool_use') {
        pushChatMessageBuffer(items, 'assistant', bufferedBlocks)
        items.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id:
                'id' in block && typeof block.id === 'string'
                  ? block.id
                  : randomUUID(),
              type: 'function',
              function: {
                name:
                  'name' in block && typeof block.name === 'string'
                    ? block.name
                    : 'unknown',
                arguments: JSON.stringify(
                  'input' in block && block.input !== undefined
                    ? block.input
                    : {},
                ),
              },
            },
          ],
        })
        continue
      }

      if (message.type === 'user' && block.type === 'tool_result') {
        pushChatMessageBuffer(items, 'user', bufferedBlocks)
        items.push({
          role: 'tool',
          tool_call_id:
            'tool_use_id' in block && typeof block.tool_use_id === 'string'
              ? block.tool_use_id
              : randomUUID(),
          content:
            'content' in block ? blockTextFromUnknownContent(block.content) : '',
        })
        continue
      }

      if (block.type === 'thinking' || block.type === 'redacted_thinking') {
        continue
      }

      bufferedBlocks.push(block)
    }

    pushChatMessageBuffer(
      items,
      message.type === 'assistant' ? 'assistant' : 'user',
      bufferedBlocks,
    )
  }

  return items
}

async function toolToOpenAITool(
  tool: Tool,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  tools: Tools,
  options: Options,
): Promise<OpenAITool> {
  const parameters =
    'inputJSONSchema' in tool && tool.inputJSONSchema
      ? (tool.inputJSONSchema as Record<string, unknown>)
      : zodToJsonSchema(tool.inputSchema)

  return {
    type: 'function',
    name: tool.name,
    description: await tool.prompt({
      getToolPermissionContext,
      tools,
      agents: options.agents,
      allowedAgentTypes: options.allowedAgentTypes,
    }),
    parameters,
  }
}

async function buildOpenAITools(
  tools: Tools,
  options: Options,
): Promise<OpenAITool[]> {
  return Promise.all(
    tools.map(tool =>
      toolToOpenAITool(tool, options.getToolPermissionContext, tools, options),
    ),
  )
}

function getCodexFetchOptions(config: NonNullable<ReturnType<typeof getActiveCodexConfig>>) {
  const proxyUrl = config.proxy?.https || config.proxy?.http
  if (!proxyUrl) {
    return getProxyFetchOptions()
  }

  if (typeof Bun !== 'undefined') {
    return {
      proxy: proxyUrl,
      ...getTLSFetchOptions(),
    }
  }

  return {
    dispatcher: getProxyAgent(proxyUrl),
  }
}

function getFetchImpl(fetchOverride?: Options['fetchOverride']) {
  return fetchOverride ?? fetch
}

function buildURL(baseURL: string, endpointPath: string): string {
  const url = new URL(baseURL)
  const basePath = url.pathname.replace(/\/+$/, '')
  const normalizedEndpoint = endpointPath.startsWith('/')
    ? endpointPath
    : `/${endpointPath}`

  url.pathname = `${basePath}${normalizedEndpoint}`.replace(/\/{2,}/g, '/')

  return url.toString()
}

function buildEndpointCandidates(baseURL: string, endpointPath: string): string[] {
  const candidates = [buildURL(baseURL, endpointPath)]
  const url = new URL(baseURL)
  const normalizedPath = url.pathname.replace(/\/+$/, '')
  const hasV1Suffix =
    normalizedPath === '/v1' || normalizedPath.endsWith('/v1')

  if (!hasV1Suffix) {
    candidates.push(
      buildURL(
        baseURL,
        `/v1${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`,
      ),
    )
  }

  return [...new Set(candidates)]
}

async function readJSONResponse<T>(
  response: Response,
  requestLabel: string,
): Promise<T> {
  const responseText = await response.text()

  if (!response.ok) {
    throw new OpenAIRequestError({
      message: `${requestLabel} request failed (${response.status}): ${truncateForError(responseText)}`,
      reason: isEndpointUnavailableStatus(response.status)
        ? 'endpoint_unavailable'
        : 'api_error',
      status: response.status,
      canFallbackToChatCompletions: isEndpointUnavailableStatus(
        response.status,
      ),
    })
  }

  try {
    return JSON.parse(responseText) as T
  } catch (error) {
    throw new OpenAIRequestError({
      message: `${requestLabel} returned non-JSON content: ${truncateForError(responseText || (error instanceof Error ? error.message : String(error)))}`,
      reason: 'non_json',
      canFallbackToChatCompletions: true,
    })
  }
}

async function requestOpenAIJSON<T>({
  baseURL,
  endpointPath,
  requestLabel,
  fetchImpl,
  requestInit,
  signal,
}: {
  baseURL: string
  endpointPath: string
  requestLabel: string
  fetchImpl: typeof fetch
  requestInit: RequestInit
  signal: AbortSignal
}): Promise<T> {
  const candidates = buildEndpointCandidates(baseURL, endpointPath)
  let lastError: OpenAIRequestError | undefined
  let lastNonFallbackableError: OpenAIRequestError | undefined

  for (const candidate of candidates) {
    try {
      const response = await fetchImpl(candidate, requestInit)
      return await readJSONResponse<T>(response, requestLabel)
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const normalizedError = normalizeOpenAIRequestError(error)
      lastError = normalizedError

      if (!normalizedError.canFallbackToChatCompletions) {
        lastNonFallbackableError = normalizedError
      }
    }
  }

  const preferredError = lastNonFallbackableError ?? lastError

  if (!preferredError) {
    throw new OpenAIRequestError({
      message: `${requestLabel} failed for endpoint candidates ${candidates.join(', ')}. Unknown error`,
      reason: 'transport',
      canFallbackToChatCompletions: false,
    })
  }

  throw new OpenAIRequestError({
    message: `${requestLabel} failed for endpoint candidates ${candidates.join(', ')}. ${preferredError.message}`,
    reason: preferredError.reason,
    status: preferredError.status,
    canFallbackToChatCompletions:
      preferredError.canFallbackToChatCompletions,
  })
}

function buildUsage(response: OpenAIResponsePayload) {
  return {
    ...EMPTY_USAGE,
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
    cache_read_input_tokens:
      response.usage?.input_tokens_details?.cached_tokens ?? 0,
  }
}

function buildChatCompletionUsage(response: OpenAIChatCompletionPayload) {
  return {
    ...EMPTY_USAGE,
    input_tokens: response.usage?.prompt_tokens ?? 0,
    output_tokens: response.usage?.completion_tokens ?? 0,
    cache_read_input_tokens:
      response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

function getStopReason(response: OpenAIResponsePayload): 'end_turn' | 'max_tokens' | 'tool_use' {
  if (
    response.output?.some(outputItem => outputItem.type === 'function_call')
  ) {
    return 'tool_use'
  }

  if (response.incomplete_details?.reason === 'max_output_tokens') {
    return 'max_tokens'
  }

  return 'end_turn'
}

function getChatCompletionStopReason(
  response: OpenAIChatCompletionPayload,
): 'end_turn' | 'max_tokens' | 'tool_use' {
  const choice = response.choices?.[0]

  if (choice?.finish_reason === 'tool_calls') {
    return 'tool_use'
  }

  if (choice?.finish_reason === 'length') {
    return 'max_tokens'
  }

  return 'end_turn'
}

function createAssistantMessageForOpenAI({
  messageId,
  model,
  content,
  usage,
  stopReason,
  requestId,
}: {
  messageId: string
  model: string
  content: unknown[]
  usage: ReturnType<typeof buildUsage>
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use'
  requestId?: string
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId,
    message: {
      id: messageId,
      container: null,
      model,
      role: 'assistant',
      stop_reason: stopReason,
      stop_sequence: null,
      type: 'message',
      usage,
      content,
      context_management: null,
    },
  }
}

function adaptOpenAIResponse(
  response: OpenAIResponsePayload,
  configuredModel: string,
): {
  messages: AssistantMessage[]
  streamEvents: StreamEvent[]
} {
  const usage = buildUsage(response)
  const stopReason = getStopReason(response)
  const messageId =
    response.output?.find(output => output.type === 'message' && output.id)?.id ??
    response.id ??
    randomUUID()

  const streamEvents: StreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: messageId,
        container: null,
        model: response.model ?? configuredModel,
        role: 'assistant',
        stop_reason: null,
        stop_sequence: null,
        type: 'message',
        usage,
        content: [],
        context_management: null,
      },
    },
  ]

  const messages: AssistantMessage[] = []

  for (const outputItem of response.output ?? []) {
    if (outputItem.type === 'message') {
      const textBlocks = (outputItem.content ?? [])
        .filter(part => part.type === 'output_text' && typeof part.text === 'string')
        .map(part => ({
          type: 'text' as const,
          text: part.text as string,
        }))

      if (textBlocks.length > 0) {
        messages.push(
          createAssistantMessageForOpenAI({
            messageId,
            model: response.model ?? configuredModel,
            content: textBlocks,
            usage,
            stopReason,
            requestId: response.id,
          }),
        )
      }
      continue
    }

    if (outputItem.type === 'function_call') {
      const input = (() => {
        try {
          return JSON.parse(outputItem.arguments ?? '{}')
        } catch {
          return {}
        }
      })()

      messages.push(
        createAssistantMessageForOpenAI({
          messageId,
          model: response.model ?? configuredModel,
          content: [
            {
              type: 'tool_use' as const,
              id: outputItem.call_id ?? randomUUID(),
              name: outputItem.name ?? 'unknown',
              input,
            },
          ],
          usage,
          stopReason,
          requestId: response.id,
        }),
      )
    }
  }

  streamEvents.push({
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage,
  })
  streamEvents.push({
    type: 'message_stop',
  })

  return {
    messages,
    streamEvents,
  }
}

function adaptChatCompletionResponse(
  response: OpenAIChatCompletionPayload,
  configuredModel: string,
): {
  messages: AssistantMessage[]
  streamEvents: StreamEvent[]
} {
  const usage = buildChatCompletionUsage(response)
  const stopReason = getChatCompletionStopReason(response)
  const choice = response.choices?.[0]
  const messageId = response.id ?? randomUUID()
  const streamEvents: StreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: messageId,
        container: null,
        model: response.model ?? configuredModel,
        role: 'assistant',
        stop_reason: null,
        stop_sequence: null,
        type: 'message',
        usage,
        content: [],
        context_management: null,
      },
    },
  ]

  const messages: AssistantMessage[] = []
  const content = choice?.message?.content
  const textBlocks =
    typeof content === 'string'
      ? content
          ? [{ type: 'text' as const, text: content }]
          : []
      : (content ?? [])
          .filter(part => part.type === 'text' && typeof part.text === 'string')
          .map(part => ({
            type: 'text' as const,
            text: part.text as string,
          }))

  if (textBlocks.length > 0) {
    messages.push(
      createAssistantMessageForOpenAI({
        messageId,
        model: response.model ?? configuredModel,
        content: textBlocks,
        usage,
        stopReason,
        requestId: response.id,
      }),
    )
  }

  for (const toolCall of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(toolCall.function?.arguments ?? '{}') as Record<
        string,
        unknown
      >
    } catch {
      input = {}
    }

    messages.push(
      createAssistantMessageForOpenAI({
        messageId,
        model: response.model ?? configuredModel,
        content: [
          {
            type: 'tool_use' as const,
            id: toolCall.id ?? randomUUID(),
            name: toolCall.function?.name ?? 'unknown',
            input,
          },
        ],
        usage,
        stopReason,
        requestId: response.id,
      }),
    )
  }

  streamEvents.push({
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage,
  })
  streamEvents.push({
    type: 'message_stop',
  })

  return {
    messages,
    streamEvents,
  }
}

async function callResponsesAPI({
  messages,
  systemPrompt,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<OpenAIResponsePayload> {
  const codexConfig = getActiveCodexConfig()
  if (!codexConfig?.baseURL || !codexConfig.apiKey || !codexConfig.model) {
    throw new Error('Codex config is missing required OpenAI settings')
  }

  const fetchImpl = getFetchImpl(options.fetchOverride)
  const input = buildOpenAIInputItems(messages, tools)
  const openAITools = await buildOpenAITools(tools, options)

  const toolChoice =
    options.toolChoice && 'name' in options.toolChoice
      ? {
          type: 'function',
          name: options.toolChoice.name,
        }
      : 'auto'

  return requestOpenAIJSON<OpenAIResponsePayload>({
    baseURL: codexConfig.baseURL,
    endpointPath: '/responses',
    requestLabel: 'OpenAI Responses',
    fetchImpl,
    signal,
    requestInit: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${codexConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: codexConfig.model,
        instructions: systemPrompt.join('\n\n'),
        input,
        ...(openAITools.length > 0
          ? { tools: openAITools, tool_choice: toolChoice }
          : {}),
        ...(options.maxOutputTokensOverride
          ? { max_output_tokens: options.maxOutputTokensOverride }
          : {}),
        ...(options.temperatureOverride !== undefined
          ? { temperature: options.temperatureOverride }
          : {}),
        ...(options.effortValue
          ? { reasoning: { effort: options.effortValue } }
          : {}),
      }),
      signal,
      ...(options.fetchOverride ? {} : getCodexFetchOptions(codexConfig)),
    },
  })
}

async function callChatCompletionsAPI({
  messages,
  systemPrompt,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<OpenAIChatCompletionPayload> {
  const codexConfig = getActiveCodexConfig()
  if (!codexConfig?.baseURL || !codexConfig.apiKey || !codexConfig.model) {
    throw new Error('Codex config is missing required OpenAI settings')
  }

  const fetchImpl = getFetchImpl(options.fetchOverride)
  const chatMessages = buildChatCompletionMessages(messages, systemPrompt, tools)
  const openAITools = await buildOpenAITools(tools, options)

  const toolChoice =
    options.toolChoice && 'name' in options.toolChoice
      ? {
          type: 'function',
          function: {
            name: options.toolChoice.name,
          },
        }
      : 'auto'

  return requestOpenAIJSON<OpenAIChatCompletionPayload>({
    baseURL: codexConfig.baseURL,
    endpointPath: '/chat/completions',
    requestLabel: 'OpenAI Chat Completions',
    fetchImpl,
    signal,
    requestInit: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${codexConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: codexConfig.model,
        messages: chatMessages,
        ...(openAITools.length > 0
          ? { tools: openAITools, tool_choice: toolChoice }
          : {}),
        ...(options.maxOutputTokensOverride
          ? { max_tokens: options.maxOutputTokensOverride }
          : {}),
        ...(options.temperatureOverride !== undefined
          ? { temperature: options.temperatureOverride }
          : {}),
      }),
      signal,
      ...(options.fetchOverride ? {} : getCodexFetchOptions(codexConfig)),
    },
  })
}

export async function* queryOpenAIWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    const codexConfig = getActiveCodexConfig()
    if (!codexConfig?.model) {
      throw new Error('Codex config is missing the configured model')
    }

    let adapted:
      | ReturnType<typeof adaptOpenAIResponse>
      | ReturnType<typeof adaptChatCompletionResponse>

    try {
      const response = await callResponsesAPI({
        messages,
        systemPrompt,
        thinkingConfig,
        tools,
        signal,
        options,
      })
      adapted = adaptOpenAIResponse(response, codexConfig.model)
    } catch (error) {
      if (!shouldFallbackToChatCompletions(error)) {
        throw error
      }

      try {
        const response = await callChatCompletionsAPI({
          messages,
          systemPrompt,
          thinkingConfig,
          tools,
          signal,
          options,
        })
        adapted = adaptChatCompletionResponse(response, codexConfig.model)
      } catch (chatError) {
        throw new OpenAIRequestError({
          message: `${normalizeOpenAIRequestError(chatError).message}. Earlier OpenAI Responses error: ${error.message}`,
          reason: 'transport',
          canFallbackToChatCompletions: false,
        })
      }
    }

    for (const event of adapted.streamEvents.slice(0, 1)) {
      yield {
        type: 'stream_event',
        event,
      }
    }

    for (const message of adapted.messages) {
      yield message
    }

    for (const event of adapted.streamEvents.slice(1)) {
      yield {
        type: 'stream_event',
        event,
      }
    }
  } catch (error) {
    yield createAssistantAPIErrorMessage({
      content: error instanceof Error ? error.message : String(error),
      error: 'api_error',
    })
  }
}
