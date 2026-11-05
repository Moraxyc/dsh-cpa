import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createAssistantMessage,
  createToolResultMessage,
  MessageId,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  DeveloperMessage,
  GenerateOptions,
  ImageBlock,
  RequestMessage,
} from '@deepseek-ai/dsh-llm'

import {
  CpaAdapter,
  cpaImageTarget,
  parseCpaTraceId,
  serializeMessages,
} from '../../src/core/adapter.js'
import type {
  CpaAdapterOptions,
  CpaExecutionEvent,
  CpaRequestImage,
  CpaRequestImages,
  WireContentPart,
  WireMessage,
  WireRequest,
} from '../../src/core/adapter.js'
import { normalizeModels } from '../../src/core/config.js'
import { sessionId } from '../helpers/fixtures.ts'
import { readText, sendJson, startServer } from '../helpers/http.ts'

type ImageRef = ImageBlock['attachment']

const TRACE_ID = '20260101120000-auth-index-1234abcd'

const IMAGE_REF: ImageRef = {
  attachmentId: 'a'.repeat(64),
  mediaType: 'image/png',
  bytes: 3,
  width: 4000,
  height: 3000,
  name: 'shot.png',
}

const REQUEST_IMAGE: CpaRequestImage = {
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'image/png',
  width: 2364,
  height: 1773,
}

const REQUEST_IMAGES: CpaRequestImages = {
  versions: new Map([[IMAGE_REF.attachmentId, REQUEST_IMAGE]]),
  access: () => undefined,
}

function makeAdapter(overrides: Partial<CpaAdapterOptions> = {}): CpaAdapter {
  return new CpaAdapter({
    baseURL: '',
    provider: 'cpa',
    defaultContextWindow: 128_000,
    defaultMaxTokens: 4096,
    getModels: () => [],
    resolveApiKey: () => Promise.resolve('sk-test'),
    ...overrides,
  })
}

function userText(text: string): GenerateOptions {
  return {
    provider: 'cpa',
    model: 'gpt-5',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    sessionId: sessionId('session-1'),
    purpose: 'code',
  }
}

function toolResult(callId: string, content: ContentBlock[]): RequestMessage {
  return createToolResultMessage({ callId: ToolCallId(callId), content, isError: false })
}

function sseBody(...events: string[]): string {
  return events.map(event => `${event}\n\n`).join('')
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iterable) items.push(item)
  return items
}

function wireAt(wire: readonly WireMessage[], index: number): WireMessage {
  const message = wire[index]
  if (message === undefined) throw new Error(`no wire message at ${index}`)
  return message
}

function multipartContent(message: WireMessage): WireContentPart[] {
  if (!Array.isArray(message.content)) throw new Error('expected multipart content')
  return message.content
}

function textContent(message: WireMessage): string {
  if (Array.isArray(message.content)) throw new Error('expected text content')
  return message.content
}

describe('core/adapter', () => {
  it('parseCpaTraceId reads the auth index and request id, and rejects malformed ids', () => {
    const parsed = parseCpaTraceId(TRACE_ID)
    assert.ok(parsed)
    assert.equal(parsed.authIndex, 'auth-index')
    assert.equal(String(parsed.requestId), '1234abcd')
    assert.equal(parsed.traceId, TRACE_ID)
    assert.equal(parseCpaTraceId('not-a-trace-id'), undefined)
    assert.equal(parseCpaTraceId('20260101120000-auth-1-'), undefined)
    assert.equal(parseCpaTraceId('20260101120000--1234abcd'), undefined)
    assert.equal(parseCpaTraceId('20260101120000-auth-1-request-9'), undefined)
  })

  it('serializeMessages keeps developer and tool roles in the alpha.1 wire format', () => {
    const developer: DeveloperMessage = {
      id: MessageId('msg-developer'),
      role: 'developer',
      content: [{ type: 'text', text: 'runtime note' }],
      source: { kind: 'user' },
    }
    const wire = serializeMessages([
      developer,
      toolResult('call-1', [{ type: 'text', text: 'tool output' }]),
    ])
    assert.deepEqual(wire, [
      { role: 'developer', content: 'runtime note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'tool output' },
    ])
  })

  it('serializeMessages sends user images natively and moves tool images after the tool run', () => {
    const image: ImageBlock = { type: 'image', attachment: IMAGE_REF }
    const toolCalls = createAssistantMessage({
      source: { provider: 'cpa', model: 'gpt-5' },
      content: [
        { type: 'tool-call', id: ToolCallId('c1'), name: 'shot', arguments: '{}' },
        { type: 'tool-call', id: ToolCallId('c2'), name: 'read', arguments: '{}' },
      ],
    })
    const wire = serializeMessages([
      { role: 'user', content: [{ type: 'text', text: 'look' }, image] },
      toolCalls,
      toolResult('c1', [image]),
      toolResult('c2', [{ type: 'text', text: 'done' }]),
      { role: 'user', content: [{ type: 'image', attachment: IMAGE_REF, offloaded: true }] },
    ], REQUEST_IMAGES)

    const dataUrl = 'data:image/png;base64,AQID'
    assert.deepEqual(wire.map(message => message.role), ['user', 'assistant', 'tool', 'tool', 'user', 'user'])

    const userParts = multipartContent(wireAt(wire, 0))
    assert.deepEqual(userParts[0], { type: 'text', text: 'look' })
    assert.equal(userParts[1]?.type, 'text')
    assert.deepEqual(userParts[2], { type: 'image_url', image_url: { url: dataUrl } })

    assert.equal(textContent(wireAt(wire, 2)).length > 0, true)
    assert.deepEqual(multipartContent(wireAt(wire, 4)), [{ type: 'image_url', image_url: { url: dataUrl } }])
    assert.equal(textContent(wireAt(wire, 5)).length > 0, true)

    assert.throws(
      () => serializeMessages([{ role: 'user', content: [image] }]),
      { code: 'UNSUPPORTED_CONTENT' },
    )
  })

  it('cpaImageTarget keeps small images and downscales large ones to the pixel budget', () => {
    assert.deepEqual(cpaImageTarget({ width: 800, height: 600 }), { width: 800, height: 600, maxBytes: 1_048_576 })
    const target = cpaImageTarget(IMAGE_REF)
    assert.ok(target.width * target.height <= 4_194_304)
    assert.equal(target.width, 2364)
  })

  it('resolveModel exposes branded reasoning metadata and listModels falls back to ids', async () => {
    const adapter = makeAdapter({
      getModels: () => normalizeModels([
        {
          id: 'deepseek-r1',
          display_name: 'DeepSeek R1',
          description: 'Reasoning model',
          supported_reasoning_levels: [
            { effort: 'low', description: 'Low effort' },
            { effort: 'high', description: 'High effort' },
          ],
          default_reasoning_level: 'high',
        },
        { id: 'raw-model' },
      ]),
    })

    const listed = await adapter.listModels('cpa')
    assert.equal(listed[0]?.name, 'DeepSeek R1')
    assert.equal(listed[0]?.description, 'deepseek-r1')
    assert.equal(listed[1]?.name, 'raw-model')
    assert.equal(listed[1]?.description, undefined)

    const resolved = await adapter.resolveModel('cpa', 'deepseek-r1', new AbortController().signal)
    assert.deepEqual(resolved.reasoning, {
      efforts: [
        { id: 'low', name: 'Low', description: 'Low effort' },
        { id: 'high', name: 'High', description: 'High effort' },
      ],
      defaultEffort: 'high',
    })
    assert.equal(resolved.name, 'DeepSeek R1')
    assert.equal(resolved.description, 'deepseek-r1')
  })

  it('captures CPA trace metadata from a successful stream', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-cpa-trace-id': TRACE_ID,
      })
      res.end(sseBody(
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
        'data: [DONE]',
      ))
    })
    try {
      const executions: CpaExecutionEvent[] = []
      const adapter = makeAdapter({
        baseURL: server.baseURL,
        onExecution: value => { executions.push(value) },
      })
      const events = await collect(adapter.stream(userText('hi')))

      const captured = executions[0]
      assert.ok(captured)
      assert.equal(executions.length, 1)
      assert.equal(captured.authIndex, 'auth-index')
      assert.equal(String(captured.requestId), '1234abcd')
      assert.equal(captured.traceId, TRACE_ID)
      assert.equal(captured.sessionId, 'session-1')
      assert.equal(captured.provider, 'cpa')
      assert.equal(captured.model, 'gpt-5')
      assert.equal(captured.purpose, 'code')
      assert.equal(captured.outcome, 'success')
      assert.equal(captured.inputTokens, 1)
      assert.equal(captured.outputTokens, 1)
      assert.equal(events.some(event => event.type === 'finish'), true)
    } finally {
      await server.close()
    }
  })

  it('reports a failed execution with the account that served it', async () => {
    const server = await startServer((_req, res) => {
      sendJson(res, 429, { error: { message: 'quota exceeded' } }, { 'x-cpa-trace-id': TRACE_ID })
    })
    try {
      const executions: CpaExecutionEvent[] = []
      const adapter = makeAdapter({
        baseURL: server.baseURL,
        onExecution: value => { executions.push(value) },
      })
      await assert.rejects(collect(adapter.stream(userText('hi'))), /quota exceeded/)

      const captured = executions[0]
      assert.ok(captured)
      assert.equal(captured.authIndex, 'auth-index')
      assert.equal(captured.traceId, TRACE_ID)
      assert.equal(captured.sessionId, 'session-1')
      assert.equal(captured.provider, 'cpa')
      assert.equal(captured.model, 'gpt-5')
      assert.equal(captured.purpose, 'code')
      assert.equal(captured.outcome, 'failure')
    } finally {
      await server.close()
    }
  })

  it('sends images only to image-capable models and moves on to the next capable candidate', async () => {
    const bodies: WireRequest[] = []
    const server = await startServer(async (req, res) => {
      bodies.push(JSON.parse(await readText(req)))
      if (bodies.length === 1) {
        sendJson(res, 503, { error: { message: 'busy' } })
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(sseBody(
        'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ))
    })
    const targets: Array<{ width: number; height: number; maxBytes: number }> = []
    const adapter = makeAdapter({
      baseURL: server.baseURL,
      getModels: () => [
        { id: 'vision', inputModalities: ['text', 'image'] },
        { id: 'text-only', inputModalities: ['text'] },
        { id: 'vision-2', inputModalities: ['text', 'image'] },
      ],
      resolveRoute: () => Promise.resolve(['text-only', 'vision-2']),
      resolveAttachments: () => ({
        readImageRequest: (_ref, target) => {
          targets.push(target)
          return Promise.resolve(REQUEST_IMAGE)
        },
      }),
    })
    const imageRequest = (model: string): GenerateOptions => ({
      provider: 'cpa',
      model,
      messages: [{ role: 'user', content: [{ type: 'image', attachment: IMAGE_REF }] }],
    })
    try {
      await assert.rejects(collect(adapter.stream(imageRequest('text-only'))), { code: 'UNSUPPORTED_CONTENT' })
      await collect(adapter.stream(imageRequest('vision')))

      assert.deepEqual(bodies.map(body => body.model), ['vision', 'vision-2'])
      assert.equal(multipartContent(wireAt(bodies[1]?.messages ?? [], 0)).at(-1)?.type, 'image_url')
      assert.equal(targets.length, 1)
      assert.equal((await adapter.resolveModel('cpa', 'vision')).inputModalities?.includes('image'), true)
    } finally {
      await server.close()
    }
  })

  it('falls back to the next route candidate before emitting any partial stream', async () => {
    let calls = 0
    const server = await startServer((_req, res) => {
      calls += 1
      if (calls === 1) {
        sendJson(res, 429, { error: { message: 'quota exceeded' } })
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end(sseBody(
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
        'data: [DONE]',
      ))
    })
    try {
      const executions: CpaExecutionEvent[] = []
      const adapter = makeAdapter({
        baseURL: server.baseURL,
        resolveRoute: () => Promise.resolve(['requested', 'fallback']),
        onExecution: value => { executions.push(value) },
      })
      const events = await collect(adapter.stream({ ...userText('hi'), model: 'requested' }))

      assert.equal(calls, 2)
      assert.equal(events.some(event => event.type === 'text-delta' && event.text === 'ok'), true)
      assert.equal(executions.length, 2)

      const [failed, served] = executions
      assert.ok(failed)
      assert.ok(served)
      assert.equal(failed.model, 'requested')
      assert.equal(failed.outcome, 'failure')
      assert.equal(failed.errorCode, 'QUOTA')
      assert.equal(failed.attempt, 1)
      assert.deepEqual(failed.route, ['requested', 'fallback'])
      assert.equal(served.model, 'fallback')
      assert.equal(served.outcome, 'success')
      assert.equal(served.attempt, 2)
      assert.equal(served.fallbackFrom, 'requested')
      assert.equal(served.fallbackReason, 'QUOTA')
    } finally {
      await server.close()
    }
  })

  it('does not replay a request once stream content has started', async () => {
    let calls = 0
    const server = await startServer((_req, res) => {
      calls += 1
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n')
    })
    try {
      const adapter = makeAdapter({
        baseURL: server.baseURL,
        resolveRoute: () => Promise.resolve(['requested', 'fallback']),
      })
      await assert.rejects(
        collect(adapter.stream({ ...userText('hi'), model: 'requested' })),
        /stream ended without \[DONE\]/,
      )
      assert.equal(calls, 1)
    } finally {
      await server.close()
    }
  })
})
