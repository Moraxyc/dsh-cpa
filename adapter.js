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

import { chatCompletionsUrl } from './config.js'

const DONE = '[DONE]'
const EMPTY_RESPONSE = EMPTY_RESPONSE_CODE

function providerRetryAfterMs(value) {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers) {
  const value = headers.get('x-request-id')
    ?? headers.get('x-cpa-request-id')
    ?? headers.get('x-cli-proxy-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

function httpErrorCode(status, detail) {
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

function modelInfo(provider, model) {
  const name = model.displayName ?? model.id
  const description = model.id === name ? undefined : model.id
  return {
    provider,
    id: model.id,
    name,
    ...description === undefined ? {} : { description },
    inputModalities: ['text'],
  }
}

function modelReasoningInfo(model) {
  const reasoning = model?.reasoning
  if (reasoning === undefined) return {}
  return {
    reasoning: {
      efforts: reasoning.efforts.map(effort => ({
        id: ReasoningEffortId(effort.id),
        name: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
      ...reasoning.defaultEffort === undefined
        ? {}
        : { defaultEffort: ReasoningEffortId(reasoning.defaultEffort) },
    },
  }
}

function flattenText(blocks) {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function assertTextOnly(blocks) {
  if (contentHasImage(blocks)) {
    throw new LlmError('CPA does not support images', 'UNSUPPORTED_CONTENT')
  }
}

function serializeAssistant(message) {
  const text = flattenText(message.content)
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    content: text,
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

export function serializeMessages(messages) {
  const wire = []
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
    const toolResults = message.content.filter(block => block.type === 'tool-result')
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

export function serializeRequest(options) {
  const messages = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))
  const tools = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  return {
    model: options.model,
    messages,
    stream: true,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.reasoningEffort !== undefined ? { reasoning_effort: options.reasoningEffort } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

async function* ssePayloads(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data = []
  const flush = () => {
    if (data.length === 0) return undefined
    const payload = data.join('\n')
    data = []
    return payload
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let newline
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

export async function* parseSse(stream) {
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

function mapFinishReason(reason) {
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

function mapUsage(usage) {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

function closeBlock(block) {
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

export async function* translate(payloads) {
  let nextIndex = 0
  let textBlock
  let reasoningBlock
  const toolBlocks = new Map()
  const order = []
  let pendingFinish
  let pendingUsage

  function open(kind) {
    const block = { index: nextIndex++, kind, text: '' }
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

    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError(`malformed SSE: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {}
      const reasoning = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning?.content === 'string'
          ? delta.reasoning.content
          : undefined
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta.content
      if (typeof content === 'string' && content.length > 0) {
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
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
  }

  throw new LlmError('stream ended without [DONE]', 'STREAM_CLOSED')
}

async function readError(response) {
  let message = `CPA HTTP ${response.status}`
  let detail = ''
  try {
    const parsed = await response.json()
    const error = parsed?.error
    message = typeof error?.message === 'string' && error.message.length > 0
      ? error.message
      : typeof parsed?.message === 'string' && parsed.message.length > 0
        ? parsed.message
        : message
    detail = [error?.code, error?.type, error?.message, parsed?.message].filter(Boolean).join(' ')
  } catch {
    // Keep HTTP status for malformed error bodies.
  }
  const delay = providerRetryAfterMs(response.headers.get('retry-after'))
  const id = requestId(response.headers)
  throw new LlmError(message, httpErrorCode(response.status, detail), {
    status: response.status,
    ...delay === undefined ? {} : { providerRetryAfterMs: delay },
    ...id === undefined ? {} : { requestId: id },
  })
}

export class CpaAdapter extends LlmAdapter {
  constructor(options) {
    super()
    this.options = options
  }

  providerInfo(provider) {
    return { id: provider, name: 'CLI Proxy API' }
  }

  listModels(provider) {
    return Promise.resolve(this.options.getModels().map(model => modelInfo(provider, model)))
  }

  resolveModel(provider, model, _signal) {
    const configured = this.options.getModels().find(entry => entry.id === model)
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model }
        : modelInfo(provider, configured),
      inputModalities: ['text'],
      context: {
        contextWindow: configured?.contextLength ?? this.options.defaultContextWindow,
      },
      defaultMaxTokens: configured?.maxCompletionTokens ?? this.options.defaultMaxTokens,
      ...modelReasoningInfo(configured),
    })
  }

  async * stream(options) {
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

    let response
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
      await readError(response)
      return
    }
    if (!response.body) {
      throw new LlmError('empty response', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body))
  }
}

export function resolveApiKey(ctx, ref) {
  return async () => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) {
        return assertUsableApiKey(hit.value, 'dsh-cpa', ref)
      }
    }
    const ambient = process.env[ref]
    if (ambient !== undefined && ambient.length > 0) {
      return assertUsableApiKey(ambient, 'dsh-cpa', ref)
    }
    throw new LlmError(`no API key for ${ref}`, 'MISSING_CREDENTIAL')
  }
}
