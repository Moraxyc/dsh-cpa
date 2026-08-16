import {
  assertUsableApiKey,
  attributionHeaders,
  CallId,
  contentHasImage,
  EMPTY_RESPONSE_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmErrorOptions,
  LlmModelInfo,
  LlmModelReasoningInfo,
  LlmProviderInfo,
  LlmReasoningEffortInfo,
  LlmResolvedModelInfo,
  Message,
  StreamChunk,
  TokenUsage,
  ToolCallBlock,
  ToolResultBlock,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import { chatCompletionsUrl } from './config.js'
import type { CpaModel } from './config.js'
import { isFunction, isJsonRecord, isNonEmptyString, isString } from './json.js'

const DONE = '[DONE]'
const EMPTY_RESPONSE = EMPTY_RESPONSE_CODE

export interface CpaTrace {
  traceId: string
  authIndex: string
  requestId: ProviderRequestId
}

export interface CpaExecutionEvent {
  authIndex: string
  traceId: string
  requestId: ProviderRequestId
  sessionId?: GenerateOptions['sessionId']
  provider: string
  model: string
  purpose?: GenerateOptions['purpose']
  outcome: 'success' | 'failure'
  inputTokens?: number
  outputTokens?: number
}

export interface CpaAdapterOptions {
  baseURL: string
  provider: string
  defaultContextWindow: number
  defaultMaxTokens: number
  getModels: () => CpaModel[]
  resolveApiKey: () => Promise<string>
  onExecution?: (execution: CpaExecutionEvent) => void | Promise<void>
}

export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface WireMessage {
  role: string
  content: string
  tool_calls?: WireToolCall[]
  tool_call_id?: CallId
}

export interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: ToolSchema['parameters'] }
}

export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: boolean
  tools?: WireTool[]
  reasoning_effort?: string
  temperature?: number
  max_tokens?: number
  stop?: string[]
}

interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
  prompt_cache_hit_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface WireToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface WireDelta {
  content?: unknown
  reasoning_content?: unknown
  reasoning?: { content?: unknown }
  tool_calls?: WireToolCallDelta[]
}

interface WireChoice {
  delta?: WireDelta
  finish_reason?: unknown
}

interface WireChunk {
  choices?: WireChoice[]
  usage?: WireUsage
}

type BlockKind = 'text' | 'reasoning' | 'tool-call'

interface Block {
  index: number
  kind: BlockKind
  text: string
  callId?: string
  name?: string
}

export interface CredentialHit {
  value: string
}

export interface CredentialsService {
  resolve(ref: string): Promise<CredentialHit | undefined>
}

export interface ApiKeyContext {
  get<T>(key: string): T | undefined
}

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ProviderRequestId | undefined {
  const value = headers.get('x-request-id')
    ?? headers.get('x-cpa-request-id')
    ?? headers.get('x-cli-proxy-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

export function parseCpaTraceId(value: string | undefined): CpaTrace | undefined {
  if (!isString(value)) return undefined
  const trimmed = value.trim()
  if (trimmed.length <= 15) return undefined
  const separator = trimmed.indexOf('-', 14)
  if (separator !== 14 || !/^\d{14}$/.test(trimmed.slice(0, 14))) return undefined
  const tail = trimmed.slice(15)
  const requestSeparator = tail.lastIndexOf('-')
  if (requestSeparator <= 0 || requestSeparator === tail.length - 1) return undefined
  const authIndex = tail.slice(0, requestSeparator)
  const requestIdValue = tail.slice(requestSeparator + 1)
  if (authIndex.length === 0 || !/^[0-9a-f]{8}$/i.test(requestIdValue)) return undefined
  return {
    traceId: trimmed,
    authIndex,
    requestId: ProviderRequestId(requestIdValue),
  }
}

function cpaTrace(headers: Headers): CpaTrace | undefined {
  return parseCpaTraceId(headers.get('x-cpa-trace-id') ?? undefined)
}

function responseRequestId(headers: Headers): ProviderRequestId | undefined {
  return requestId(headers) ?? cpaTrace(headers)?.requestId
}

function httpErrorCode(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (isQuotaExceededError(detail)) return 'QUOTA'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return 'CONTEXT_WINDOW_EXCEEDED'
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function modelInfo(provider: string, model: CpaModel): LlmModelInfo {
  const name = model.displayName ?? model.id
  const info: LlmModelInfo = {
    provider,
    id: model.id,
    name,
    inputModalities: ['text'],
  }
  if (model.id !== name) info.description = model.id
  return info
}

function flattenText(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
  }
  return text
}

function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('CPA does not support images', 'UNSUPPORTED_CONTENT')
  }
}

function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const toolCalls: WireToolCall[] = message.content
    .filter((block): block is ToolCallBlock => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))
  const wire: WireMessage = { role: 'assistant', content: text }
  if (toolCalls.length > 0) wire.tool_calls = toolCalls
  return wire
}

export function serializeMessages(messages: readonly Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    const toolResults = message.content.filter((block): block is ToolResultBlock => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

export function serializeRequest(options: GenerateOptions): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))
  const request: WireRequest = {
    model: options.model,
    messages,
    stream: true,
  }
  const tools = options.tools?.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  if (tools !== undefined && tools.length > 0) request.tools = tools
  if (options.reasoningEffort !== undefined) request.reasoning_effort = options.reasoningEffort
  if (options.temperature !== undefined) request.temperature = options.temperature
  if (options.maxTokens !== undefined) request.max_tokens = options.maxTokens
  if (options.stop !== undefined) request.stop = options.stop
  return request
}

async function* ssePayloads(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  const flush = (): string | undefined => {
    if (data.length === 0) return undefined
    const payload = data.join('\n')
    data = []
    return payload
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line === '') {
        const payload = flush()
        if (payload !== undefined) {
          yield payload
          if (payload === DONE) return
        }
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''))
      }
    }
  }
  const payload = flush()
  if (payload !== undefined) yield payload
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let done = false
  for await (const payload of ssePayloads(stream)) {
    if (payload === DONE) {
      done = true
      yield payload
      return
    }
    yield payload
  }
  if (!done) {
    throw new LlmError('stream ended without [DONE]', 'STREAM_CLOSED')
  }
}

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  const mapped: TokenUsage = {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
  }
  if (cacheRead !== undefined) mapped.cacheReadTokens = cacheRead
  if (reasoning !== undefined) mapped.reasoningTokens = reasoning
  return mapped
}

function closeBlock(block: Block): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: CallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: Block | undefined
  let reasoningBlock: Block | undefined
  const toolBlocks = new Map<number, Block>()
  const order: Block[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined

  const open = (kind: BlockKind): Block => {
    const block: Block = { index: nextIndex, kind, text: '' }
    nextIndex += 1
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === DONE) {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? {
              kind: 'error',
              failure: { message: 'empty response', code: EMPTY_RESPONSE },
            }
          : reason,
      }
      return
    }

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError(`malformed SSE: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}
      const reasoning = isString(delta.reasoning_content)
        ? delta.reasoning_content
        : isString(delta.reasoning?.content)
          ? delta.reasoning.content
          : undefined
      if (isNonEmptyString(reasoning)) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta.content
      if (isNonEmptyString(content)) {
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }

      for (const call of delta.tool_calls ?? []) {
        const callIndex = call.index ?? 0
        let block = toolBlocks.get(callIndex)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(callIndex, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (call.id !== undefined) block.callId = call.id
        if (call.function?.name !== undefined) block.name = call.function.name
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        const deltaEvent: StreamChunk = {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          argumentsDelta: fragment,
        }
        if (block.name !== undefined) deltaEvent.name = block.name
        yield deltaEvent
      }

      if (isString(choice.finish_reason)) {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
  }

  throw new LlmError('stream ended without [DONE]', 'STREAM_CLOSED')
}

async function readError(response: Response): Promise<never> {
  let message = `CPA HTTP ${response.status}`
  let detail = ''
  try {
    const body: unknown = await response.json()
    const parsed = isJsonRecord(body) ? body : null
    const error = isJsonRecord(parsed?.error) ? parsed.error : null
    message = isNonEmptyString(error?.message)
      ? error.message
      : isNonEmptyString(parsed?.message)
        ? parsed.message
        : message
    detail = [error?.code, error?.type, error?.message, parsed?.message]
      .filter((value): value is string => isString(value))
      .join(' ')
  } catch {
    // Keep the HTTP status line for malformed error bodies.
  }
  const delay = providerRetryAfterMs(response.headers.get('retry-after'))
  const trace = cpaTrace(response.headers)
  const id = responseRequestId(response.headers)
  const options: LlmErrorOptions & { authIndex?: string } = { status: response.status }
  if (delay !== undefined) options.providerRetryAfterMs = delay
  if (id !== undefined) options.requestId = id
  if (trace !== undefined) options.authIndex = trace.authIndex
  throw new LlmError(message, httpErrorCode(response.status, detail), options)
}

export class CpaAdapter extends LlmAdapter {
  constructor(readonly options: CpaAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'CLI Proxy API' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.options.getModels().map(model => modelInfo(provider, model)))
  }

  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const configured = this.options.getModels().find(entry => entry.id === model)
    const resolved: LlmResolvedModelInfo = configured === undefined
      ? { provider, id: model, name: model, inputModalities: ['text'] }
      : modelInfo(provider, configured)
    resolved.context = {
      contextWindow: configured?.contextLength ?? this.options.defaultContextWindow,
    }
    resolved.defaultMaxTokens = configured?.maxCompletionTokens ?? this.options.defaultMaxTokens
    const reasoning = configured?.reasoning
    if (reasoning !== undefined) {
      const efforts: LlmReasoningEffortInfo[] = reasoning.efforts.map(effort => {
        const info: LlmReasoningEffortInfo = {
          id: ReasoningEffortId(effort.id),
          name: effort.name,
        }
        if (effort.description !== undefined) info.description = effort.description
        return info
      })
      const reasoningInfo: LlmModelReasoningInfo = { efforts }
      if (reasoning.defaultEffort !== undefined) {
        reasoningInfo.defaultEffort = ReasoningEffortId(reasoning.defaultEffort)
      }
      resolved.reasoning = reasoningInfo
    }
    return Promise.resolve(resolved)
  }

  override async * stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const apiKey = await this.options.resolveApiKey()
    const url = chatCompletionsUrl(this.options.baseURL)
    const body = serializeRequest(options)
    const payload = JSON.stringify(body)
    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError('aborted', 'ABORTED', { cause: error })
      }
      throw new LlmError('request failed', 'TRANSPORT', { cause: error })
    }

    if (!response.ok) {
      const trace = cpaTrace(response.headers)
      if (trace !== undefined && this.options.onExecution !== undefined) {
        await this.options.onExecution({
          authIndex: trace.authIndex,
          traceId: trace.traceId,
          requestId: trace.requestId,
          sessionId: options.sessionId,
          provider: this.options.provider,
          model: options.model,
          purpose: options.purpose,
          outcome: 'failure',
        })
      }
      await readError(response)
      return
    }
    if (!response.body) {
      throw new LlmError('empty response', 'EMPTY_RESPONSE')
    }

    const trace = cpaTrace(response.headers)
    let executionUsage: TokenUsage | undefined
    let completed = false
    try {
      for await (const event of translate(parseSse(response.body))) {
        if (event.type === 'usage' && event.usage !== undefined) executionUsage = event.usage
        yield event
      }
      completed = true
    } finally {
      if (trace !== undefined && this.options.onExecution !== undefined) {
        const execution: CpaExecutionEvent = {
          authIndex: trace.authIndex,
          traceId: trace.traceId,
          requestId: trace.requestId,
          sessionId: options.sessionId,
          provider: this.options.provider,
          model: options.model,
          purpose: options.purpose,
          outcome: completed ? 'success' : 'failure',
        }
        if (executionUsage !== undefined) {
          execution.inputTokens = executionUsage.inputTokens
          execution.outputTokens = executionUsage.outputTokens
        }
        await this.options.onExecution(execution)
      }
    }
  }
}

export function resolveApiKey(
  ctx: ApiKeyContext,
  ref: string,
  provided: string | (() => Promise<string | undefined> | string | undefined),
): () => Promise<string> {
  return async () => {
    const configured = isFunction(provided) ? await provided() : provided
    if (configured !== undefined && configured !== null && configured !== '') {
      return assertUsableApiKey(configured, 'dsh-cpa', ref)
    }
    const credentials = ctx.get<CredentialsService>('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) {
        return assertUsableApiKey(hit.value, 'dsh-cpa', ref)
      }
    }
    throw new LlmError(`no API key for ${ref}`, 'MISSING_CREDENTIAL')
  }
}
