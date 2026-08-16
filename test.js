import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import {
  assertCpaBinary,
  buildManagedConfig,
  chatCompletionsUrl,
  fetchModels,
  modelsUrl,
  normalizeModels,
  readCpaSettings,
  resolveOptions,
  resolveCpaBinary,
  sanitizeCpaSettings,
  writeCpaSettings,
} from './src/core/config.js'
import {
  CpaAdapter,
  parseCpaTraceId,
} from './src/core/adapter.js'
import {
  cpaRoot,
  EXECUTION_STATUS_PATH,
  installManagementPanelWhenReady,
  managementCookieValue,
  PANEL_PATH,
  SETTINGS_PATH,
  STATUS_PATH,
} from './src/server/management.js'
import {
  cpaSettingsEqual,
  mergeCpaSettings,
  resolveInitialCpaSettings,
} from './src/server/runtime.js'
import {
  CpaQuotaService,
  formatResetLabel,
  normalizeAntigravityWindows,
  normalizeGeminiWindows,
  normalizeQuotaReport,
  sanitizeAuthFiles,
} from './src/server/quota.js'
import {
  aggregateCpaUsage,
  CpaExecutionStore,
  sanitizeExecutionRecord,
  simpleProjectionSchema,
} from './src/core/services.js'

const DEFAULT_ADVANCED_SETTINGS = Object.freeze({
  refreshIntervalMs: 300_000,
  port: 8317,
  configPath: '',
  settingsPath: '',
  executionsPath: '',
  authFilesTtlMs: 30_000,
  quotaTtlMs: 60_000,
  quotaConcurrency: 4,
})

test('modelsUrl and chatCompletionsUrl keep the v1 prefix stable', () => {
  assert.equal(modelsUrl('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317/v1/models')
  assert.equal(modelsUrl('http://127.0.0.1:8317'), 'http://127.0.0.1:8317/v1/models')
  assert.equal(modelsUrl('http://127.0.0.1:8317/'), 'http://127.0.0.1:8317/v1/models')
  assert.equal(
    chatCompletionsUrl('http://127.0.0.1:8317/v1'),
    'http://127.0.0.1:8317/v1/chat/completions',
  )
  assert.equal(
    chatCompletionsUrl('http://127.0.0.1:8317'),
    'http://127.0.0.1:8317/v1/chat/completions',
  )
})

test('normalizeModels reads CPA model metadata fields', () => {
  assert.deepEqual(normalizeModels([
    {
      id: 'alpha',
      display_name: 'Alpha',
      context_length: 128_000,
      max_completion_tokens: 4096,
    },
    { id: 'beta' },
    { id: '' },
    null,
    { id: 7 },
  ]), [
    {
      id: 'alpha',
      displayName: 'Alpha',
      contextLength: 128_000,
      maxCompletionTokens: 4096,
    },
    { id: 'beta' },
  ])
})

test('normalizeModels sorts models and maps reasoning levels', () => {
  assert.deepEqual(normalizeModels([
    { id: 'model-10', display_name: 'Model 10' },
    { id: 'model-2', display_name: 'Model 2' },
    {
      id: 'model-1',
      display_name: 'Model 1',
      supported_reasoning_levels: [
        { effort: 'high', description: 'High effort' },
        { effort: 'low', description: 'Low effort' },
      ],
      default_reasoning_level: 'high',
    },
    { id: 'model-1' },
  ]), [
    {
      id: 'model-1',
      displayName: 'Model 1',
      reasoning: {
        efforts: [
          { id: 'high', name: 'High', description: 'High effort' },
          { id: 'low', name: 'Low', description: 'Low effort' },
        ],
        defaultEffort: 'high',
      },
    },
    { id: 'model-2', displayName: 'Model 2' },
    { id: 'model-10', displayName: 'Model 10' },
    { id: 'model-1' },
  ])
})

test('fetchModels requests the CPA rich model catalog', async () => {
  const server = createServer((req, res) => {
    assert.equal(
      new URL(req.url, 'http://localhost').searchParams.get('client_version'),
      'dsh-cpa',
    )
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      models: [
        {
          slug: 'gpt-5.5',
          display_name: 'GPT 5.5',
          context_window: 272_000,
          default_reasoning_level: 'high',
          supported_reasoning_levels: [{ effort: 'high' }],
        },
        { id: 'raw-model' },
      ],
    }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const models = await fetchModels(`http://127.0.0.1:${port}/v1`, 'sk-test')
    assert.deepEqual(models, [
      {
        id: 'gpt-5.5',
        displayName: 'GPT 5.5',
        contextLength: 272_000,
        reasoning: {
          efforts: [{ id: 'high', name: 'High' }],
          defaultEffort: 'high',
        },
      },
      { id: 'raw-model' },
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('CpaAdapter.resolveModel exposes branded reasoning metadata', async () => {
  const adapter = new CpaAdapter({
    defaultContextWindow: 128_000,
    defaultMaxTokens: 4096,
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
    resolveApiKey: () => Promise.resolve('sk-test'),
  })

  const listed = await adapter.listModels('cpa')
  assert.equal(listed[0].name, 'DeepSeek R1')
  assert.equal(listed[0].description, 'deepseek-r1')
  assert.equal(listed[1].name, 'raw-model')
  assert.equal(listed[1].description, undefined)

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

test('parseCpaTraceId reads CPA auth and request ids', () => {
  const parsed = parseCpaTraceId('20260101120000-auth-index-1234abcd')
  assert.equal(parsed.authIndex, 'auth-index')
  assert.equal(String(parsed.requestId), '1234abcd')
  assert.equal(parsed.traceId, '20260101120000-auth-index-1234abcd')
  assert.equal(parseCpaTraceId('not-a-trace-id'), undefined)
  assert.equal(parseCpaTraceId('20260101120000-auth-1-'), undefined)
  assert.equal(parseCpaTraceId('20260101120000--1234abcd'), undefined)
  assert.equal(parseCpaTraceId('20260101120000-auth-1-request-9'), undefined)
})

test('CpaAdapter captures CPA trace metadata from successful streams', async () => {
  let captured
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'x-cpa-trace-id': '20260101120000-auth-index-1234abcd',
    })
    res.end([
      'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const adapter = new CpaAdapter({
      baseURL: `http://127.0.0.1:${port}/v1`,
      provider: 'cpa',
      getModels: () => [],
      resolveApiKey: () => Promise.resolve('sk-test'),
      onExecution: value => { captured = value },
    })
    const events = []
    for await (const event of adapter.stream({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      model: 'gpt-5',
      sessionId: 'session-1',
      purpose: 'code',
    })) {
      events.push(event)
    }
    assert.equal(captured.authIndex, 'auth-index')
    assert.equal(String(captured.requestId), '1234abcd')
    assert.equal(captured.traceId, '20260101120000-auth-index-1234abcd')
    assert.equal(captured.sessionId, 'session-1')
    assert.equal(captured.provider, 'cpa')
    assert.equal(captured.model, 'gpt-5')
    assert.equal(captured.purpose, 'code')
    assert.equal(captured.outcome, 'success')
    assert.equal(captured.inputTokens, 1)
    assert.equal(captured.outputTokens, 1)
    assert.equal(events.some(event => event.type === 'finish'), true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('CpaAdapter reports failed executions with the actual account', async () => {
  let captured
  const server = createServer((_req, res) => {
    res.writeHead(429, {
      'content-type': 'application/json',
      'x-cpa-trace-id': '20260101120000-auth-index-1234abcd',
    })
    res.end(JSON.stringify({ error: { message: 'quota exceeded' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const adapter = new CpaAdapter({
      baseURL: `http://127.0.0.1:${port}/v1`,
      provider: 'cpa',
      getModels: () => [],
      resolveApiKey: () => Promise.resolve('sk-test'),
      onExecution: value => { captured = value },
    })
    await assert.rejects(
      async () => {
        for await (const _event of adapter.stream({
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          model: 'gpt-5',
          sessionId: 'session-1',
          purpose: 'code',
        })) {
          // Consume the generator so failure reporting runs before the error is thrown.
        }
      },
      /quota exceeded/,
    )
    assert.equal(captured.authIndex, 'auth-index')
    assert.equal(captured.traceId, '20260101120000-auth-index-1234abcd')
    assert.equal(captured.sessionId, 'session-1')
    assert.equal(captured.provider, 'cpa')
    assert.equal(captured.model, 'gpt-5')
    assert.equal(captured.purpose, 'code')
    assert.equal(captured.outcome, 'failure')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('buildManagedConfig writes a local CPA config', () => {
  const yaml = buildManagedConfig({
    host: '127.0.0.1',
    port: 8317,
    apiKey: 'sk-test',
    managementKey: 'mgmt-test',
  })
  assert.match(yaml, /^host: "127\.0\.0\.1"$/m)
  assert.match(yaml, /^port: 8317$/m)
  assert.match(yaml, /^  secret-key: "mgmt-test"$/m)
  assert.match(yaml, /^  - "sk-test"$/m)
  assert.match(yaml, /^usage-statistics-enabled: true$/m)
  const disabled = buildManagedConfig({
    host: '127.0.0.1',
    port: 8317,
    apiKey: 'sk-test',
    managementKey: 'mgmt-test',
    usageStatisticsEnabled: false,
  })
  assert.match(disabled, /^usage-statistics-enabled: false$/m)
})

test('resolveCpaBinary checks PATH before spawning', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-bin-'))
  const script = join(dir, 'cli-proxy-api')
  const previousPath = process.env.PATH
  try {
    await writeFile(script, '#!/bin/sh\n')
    await chmod(script, 0o755)
    process.env.PATH = dir
    assert.equal(await resolveCpaBinary('cli-proxy-api'), script)
    assert.equal(await resolveCpaBinary(join(dir, 'missing')), undefined)
    await assert.rejects(
      () => assertCpaBinary('not-a-real-cpa'),
      /CPA binary not found/,
    )
    await chmod(script, 0o644)
    assert.equal(await resolveCpaBinary('cli-proxy-api'), undefined)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(dir, { recursive: true, force: true })
  }
})

test('management panel registers status and proxy routes', () => {
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const ctx = {
    get(key) {
      return key === 'webServer' ? server : undefined
    },
    logger: { warn() {} },
  }

  const dispose = installManagementPanelWhenReady(ctx, {
    baseURL: 'http://127.0.0.1:8317/v1',
    managementKey: 'mgmt-test',
  })
  assert.deepEqual(
    routes.map(route => [route.kind, route.path]),
    [
      ['exact', STATUS_PATH],
      ['exact', EXECUTION_STATUS_PATH],
      ['exact', SETTINGS_PATH],
      ['prefix', PANEL_PATH],
    ],
  )
  dispose()
  assert.deepEqual(routes, [])
})

test('management proxy blocks browser access to api-call', async () => {
  let apiCalls = 0
  const upstream = createServer((_req, res) => {
    apiCalls += 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const ctx = {
    get(key) {
      return key === 'webServer' ? server : undefined
    },
    logger: { warn() {} },
  }
  try {
    const { port } = upstream.address()
    installManagementPanelWhenReady(ctx, {
      baseURL: () => `http://127.0.0.1:${port}/v1`,
      managementKey: () => 'mgmt-test',
    })
    const route = routes.find(route => route.kind === 'prefix' && route.path === PANEL_PATH)
    const req = Readable.from([])
    req.method = 'POST'
    req.url = `${PANEL_PATH}/v0/management/api-call`
    req.headers = { cookie: `dsh_cpa_mgmt=${managementCookieValue('mgmt-test')}` }
    const res = {
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(body) {
        this.body = body
      },
    }
    await route.handler(req, res)
    assert.equal(res.status, 403)
    assert.equal(apiCalls, 0)
  } finally {
    await new Promise(resolve => upstream.close(resolve))
  }
})

test('execution status route returns sanitized account, quota, and session execution', async () => {
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const ctx = {
    get(key) {
      return key === 'webServer' ? server : undefined
    },
    logger: { warn() {} },
  }
  const execution = {
    authIndex: 'auth-1',
    sessionId: 's1',
    provider: 'cpa',
    model: 'gpt-5',
    outcome: 'success',
    traceId: 'trace-1',
  }
  installManagementPanelWhenReady(ctx, {
    baseURL: () => 'http://127.0.0.1:8317/v1',
    managementKey: () => 'mgmt-test',
    quotaService: {
      async status() {
        return {
          accounts: [{ authIndex: 'auth-1', label: 'one' }],
          quota: { 'auth-1': { status: 'low' } },
        }
      },
    },
    executionStore: () => ({
      latest(sessionId) {
        return sessionId === 's1' ? execution : undefined
      },
    }),
  })
  const route = routes.find(route => route.path === EXECUTION_STATUS_PATH)
  const req = Readable.from([])
  req.method = 'GET'
  req.url = `${EXECUTION_STATUS_PATH}?sessionId=s1`
  req.headers = {}
  const res = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
  await route.handler(req, res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), {
    available: true,
    accounts: [{ authIndex: 'auth-1', label: 'one' }],
    quota: { 'auth-1': { status: 'low' } },
    execution,
  })
})

test('settings route exposes state and forwards control updates', async () => {
  const routes = []
  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  const ctx = {
    get(key) {
      return key === 'webServer' ? server : undefined
    },
    logger: { warn() {} },
  }
  const calls = []
  installManagementPanelWhenReady(ctx, {
    baseURL: () => 'http://127.0.0.1:8317/v1',
    managementKey: () => 'mgmt-test',
    getState: () => ({ mode: 'off' }),
    update(patch) {
      calls.push(patch)
      return Promise.resolve({ mode: patch.mode })
    },
  })
  const settings = routes.find(route => route.path === SETTINGS_PATH)
  const req = Readable.from([Buffer.from(JSON.stringify({ mode: 'internal' }))])
  req.method = 'POST'
  req.headers = {}
  const res = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
  await settings.handler(req, res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { mode: 'internal' })
  assert.deepEqual(calls, [{ mode: 'internal' }])
})

test('cpa settings merge and initial resolution control runtime mode', () => {
  const options = {
    provider: 'cpa',
    apiKey: 'sk-config',
    url: 'http://127.0.0.1:9000/v1',
    managementKey: 'mgmt-env',
  }
  assert.deepEqual(resolveInitialCpaSettings(options, undefined), {
    mode: 'external',
    externalUrl: 'http://127.0.0.1:9000/v1',
    externalApiKey: 'sk-config',
    externalManagementKey: 'mgmt-env',
    internalBin: '',
    usageStatisticsEnabled: true,
    ...DEFAULT_ADVANCED_SETTINGS,
  })
  const stored = {
    mode: 'internal',
    externalUrl: 'http://saved.example/v1',
    externalApiKey: 'sk-saved',
    externalManagementKey: 'mgmt-saved',
    internalBin: '/opt/cli-proxy-api',
    usageStatisticsEnabled: true,
    ...DEFAULT_ADVANCED_SETTINGS,
  }
  assert.deepEqual(resolveInitialCpaSettings(options, stored), stored)

  const merged = mergeCpaSettings({
    mode: 'internal',
    externalUrl: '',
    externalApiKey: '',
    externalManagementKey: '',
    internalBin: '',
    usageStatisticsEnabled: true,
    ...DEFAULT_ADVANCED_SETTINGS,
  }, {
    mode: 'external',
    externalUrl: '  http://127.0.0.1:9000/v1  ',
    externalApiKey: 'sk-next',
    internalBin: '  /usr/local/bin/cli-proxy-api  ',
    port: 9000,
    refreshIntervalMs: 120_000,
    configPath: '/tmp/cpa.yaml',
    settingsPath: '/tmp/settings.json',
    executionsPath: '/tmp/executions.json',
    authFilesTtlMs: 1_000,
    quotaTtlMs: 2_000,
    quotaConcurrency: 2,
  })
  assert.deepEqual(merged, {
    mode: 'external',
    externalUrl: 'http://127.0.0.1:9000/v1',
    externalApiKey: 'sk-next',
    externalManagementKey: '',
    internalBin: '/usr/local/bin/cli-proxy-api',
    usageStatisticsEnabled: true,
    port: 9000,
    refreshIntervalMs: 120_000,
    configPath: '/tmp/cpa.yaml',
    settingsPath: '/tmp/settings.json',
    executionsPath: '/tmp/executions.json',
    authFilesTtlMs: 1_000,
    quotaTtlMs: 2_000,
    quotaConcurrency: 2,
  })
  assert.equal(cpaSettingsEqual(merged, { ...merged }), true)
  const disabled = mergeCpaSettings(merged, { usageStatisticsEnabled: false })
  assert.equal(disabled.usageStatisticsEnabled, false)
  assert.equal(cpaSettingsEqual(merged, disabled), false)
  const invalid = mergeCpaSettings(merged, { port: -1, refreshIntervalMs: 0 })
  assert.equal(invalid.port, 9000)
  assert.equal(invalid.refreshIntervalMs, 120_000)
  assert.throws(() => mergeCpaSettings(merged, { mode: 'sideways' }), /invalid mode/)
})

test('resolveOptions ignores legacy CPA environment variables', () => {
  const previous = {
    url: process.env.CPA_URL,
    apiKey: process.env.CPA_API_KEY,
    managementKey: process.env.CPA_MANAGEMENT_KEY,
    bin: process.env.CPA_BIN,
    config: process.env.CPA_CONFIG,
    settings: process.env.CPA_SETTINGS,
    executions: process.env.CPA_EXECUTIONS,
    refreshIntervalMs: process.env.CPA_REFRESH_INTERVAL_MS,
  }
  try {
    process.env.CPA_URL = 'http://env.example/v1'
    process.env.CPA_API_KEY = 'sk-env'
    process.env.CPA_MANAGEMENT_KEY = 'mgmt-env'
    process.env.CPA_BIN = '/tmp/env-cpa'
    process.env.CPA_CONFIG = '/tmp/env-config.yaml'
    process.env.CPA_SETTINGS = '/tmp/env-settings.json'
    process.env.CPA_EXECUTIONS = '/tmp/env-executions.json'
    process.env.CPA_REFRESH_INTERVAL_MS = '12345'
    const options = resolveOptions({})
    assert.equal(options.url, '')
    assert.equal(options.apiKey, '')
    assert.equal(options.apiKeyRef, 'CPA_API_KEY')
    assert.equal(options.managementKey, '')
    assert.equal(options.bin, 'cli-proxy-api')
    assert.equal(options.refreshIntervalMs, 300_000)
    assert.match(options.configPath, /cpa[/\\]config\.yaml$/)
    assert.match(options.settingsPath, /cpa[/\\]settings\.json$/)
    assert.match(options.executionsPath, /cpa[/\\]executions\.json$/)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[`CPA_${key.toUpperCase()}`]
      else process.env[`CPA_${key.toUpperCase()}`] = value
    }
  }
})

test('cpa settings persist and sanitize mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-'))
  const settingsPath = join(dir, 'settings.json')
  try {
    await writeCpaSettings(settingsPath, {
      mode: 'external',
      externalUrl: 'http://127.0.0.1:9000/v1',
      externalApiKey: 'sk-secret',
      externalManagementKey: 'mgmt-secret',
      internalBin: '/opt/cli-proxy-api',
      usageStatisticsEnabled: true,
      ...DEFAULT_ADVANCED_SETTINGS,
    })
    assert.deepEqual(await readCpaSettings(settingsPath), {
      mode: 'external',
      externalUrl: 'http://127.0.0.1:9000/v1',
      externalApiKey: 'sk-secret',
      externalManagementKey: 'mgmt-secret',
      internalBin: '/opt/cli-proxy-api',
      usageStatisticsEnabled: true,
      ...DEFAULT_ADVANCED_SETTINGS,
    })
    assert.deepEqual(sanitizeCpaSettings({ mode: 'sideways', externalUrl: 7 }), {
      mode: 'internal',
      externalUrl: '',
      externalApiKey: '',
      externalManagementKey: '',
      internalBin: '',
      usageStatisticsEnabled: true,
      ...DEFAULT_ADVANCED_SETTINGS,
    })
    await writeCpaSettings(settingsPath, {
      mode: 'internal',
      usageStatisticsEnabled: false,
    })
    assert.equal((await readCpaSettings(settingsPath)).usageStatisticsEnabled, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('quota normalizers reduce provider payloads to compact windows', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const codex = normalizeQuotaReport('codex', 'Codex', 'auth-1', 'pro', {
    rate_limit: {
      primary_window: {
        limit_window_seconds: 5 * 60 * 60,
        used_percent: 40,
        reset_at: 1_700_000_000,
      },
      secondary_window: {
        limit_window_seconds: 7 * 24 * 60 * 60,
        used_percent: 20,
        reset_at: 1_700_000_000,
      },
    },
  }, now)
  assert.equal(codex.status, 'medium')
  assert.deepEqual(
    codex.windows.map(window => [window.id, window.remainingPercent]),
    [['code-5h', 60], ['code-7d', 80]],
  )

  const gemini = normalizeGeminiWindows({
    buckets: [
      { modelId: 'gemini-2.5-flash', remainingFraction: 0.8 },
      { modelId: 'gemini-3-flash-preview', remainingFraction: 0.2 },
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.5 },
    ],
  })
  assert.deepEqual(
    gemini.map(window => [window.id, window.remainingPercent]),
    [['gemini-flash-series', 20], ['gemini-pro-series', 50]],
  )

  const antigravity = normalizeAntigravityWindows({
    models: {
      'gpt-oss-120b-medium': {
        displayName: 'GPT OSS',
        quotaInfo: { remainingFraction: 0.65 },
      },
    },
  })
  assert.deepEqual(
    antigravity.map(window => [window.label, window.remainingPercent]),
    [['GPT OSS', 65]],
  )
  const unknown = normalizeQuotaReport('codex', 'Codex', 'auth-x', 'plus', null, now)
  assert.equal(unknown.status, 'unknown')
  assert.deepEqual(unknown.windows, [])
  assert.match(formatResetLabel(1_700_000_000), /^\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('sanitizeAuthFiles removes credentials and retains account metadata', () => {
  const idToken = [
    'header',
    Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-1' })).toString('base64url'),
    'signature',
  ].join('.')
  const files = sanitizeAuthFiles([
    {
      auth_index: 'auth-1',
      label: 'one',
      provider: 'codex',
      id_token: idToken,
      plan_type: 'pro',
      status: 'active',
      status_message: 'ready',
      source: 'file',
      priority: 2,
      note: 'primary',
      websockets: true,
      last_refresh: '2026-01-01T00:00:00.000Z',
      next_retry_after: '2026-01-02T00:00:00.000Z',
      success: 3,
      failed: 1,
      recent_requests: [
        { time: '10:00-10:10', success: 2, failed: 1 },
        { time: '09:50-10:00', success: 1, failed: 0 },
      ],
      secret: 'raw-secret',
    },
    {
      authIndex: 'auth-2',
      type: 'gemini-cli',
      metadata: { id_token: idToken, project_id: 'proj-1' },
    },
    { auth_index: '' },
  ])
  assert.deepEqual(files, [
    {
      authIndex: 'auth-1',
      label: 'one',
      provider: 'codex',
      status: 'active',
      source: 'file',
      statusMessage: 'ready',
      disabled: false,
      unavailable: false,
      success: 3,
      failed: 1,
      recentRequests: 4,
      accountId: 'acct-1',
      planType: 'pro',
      projectId: '',
      priority: 2,
      note: 'primary',
      lastRefresh: '2026-01-01T00:00:00.000Z',
      nextRetryAfter: '2026-01-02T00:00:00.000Z',
      websockets: true,
    },
    {
      authIndex: 'auth-2',
      label: 'auth-2',
      provider: 'gemini-cli',
      status: '',
      source: 'auth-file',
      disabled: false,
      unavailable: false,
      success: 0,
      failed: 0,
      recentRequests: 0,
      accountId: 'acct-1',
      planType: '',
      projectId: 'proj-1',
    },
  ])
  assert.equal('id_token' in files[0], false)
  assert.equal('secret' in files[0], false)
})

test('CpaQuotaService resolves live baseURL and management key', async () => {
  const idToken = [
    'header',
    Buffer.from(JSON.stringify({ chatgpt_account_id: 'acct-1' })).toString('base64url'),
    'signature',
  ].join('.')
  let apiCalls = 0
  const server = createServer((req, res) => {
    req.resume()
    const url = new URL(req.url, 'http://localhost')
    assert.equal(req.headers.authorization, 'Bearer mgmt-live')
    if (url.pathname === '/v0/management/auth-files') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        files: [{
          auth_index: 'auth-1',
          name: 'Codex',
          provider: 'codex',
          id_token: idToken,
          plan_type: 'pro',
        }],
      }))
      return
    }
    if (url.pathname === '/v0/management/openai-compatibility') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        'openai-compatibility': [{
          name: 'DeepSeek API',
          'base-url': 'https://api.deepseek.com',
          prefix: 'deep',
          priority: 7,
          disabled: false,
          'disable-cooling': true,
          'api-key-entries': [{
            'api-key': 'sk-secret',
            'auth-index': 'api-1',
          }],
          models: [
            { name: 'deepseek-chat', alias: 'deepseek-chat' },
            { name: 'deepseek-reasoner', alias: 'deepseek-reasoner', 'display-name': 'DeepSeek Reasoner' },
          ],
        }],
      }))
      return
    }
    if (url.pathname === '/v0/management/api-call') {
      apiCalls += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        status_code: 200,
        body: JSON.stringify({
          rate_limit: {
            primary_window: {
              limit_window_seconds: 5 * 60 * 60,
              used_percent: 10,
            },
          },
        }),
      }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const service = new CpaQuotaService({
      baseURL: () => `http://127.0.0.1:${port}/v1`,
      managementKey: () => 'mgmt-live',
      authFilesTtlMs: 60_000,
      quotaTtlMs: 60_000,
      concurrency: 1,
    })
    await service.refreshAccounts()
    await service.refreshQuota()
    const report = service.quota.get('auth-1')
    assert.equal(report.provider, 'codex')
    assert.equal(report.windows.find(window => window.id === 'code-5h').remainingPercent, 90)
    const callsAfterFirst = apiCalls
    await service.refreshQuota()
    assert.equal(apiCalls, callsAfterFirst)
    const status = await service.status()
    assert.equal('accountId' in status.accounts[0], false)
    assert.equal('projectId' in status.accounts[0], false)
    assert.equal(status.accounts[0].planType, 'pro')
    const apiProvider = status.accounts.find(account => account.authIndex === 'api-1')
    assert.deepEqual(apiProvider, {
      authIndex: 'api-1',
      label: 'DeepSeek API',
      provider: 'deepseek',
      source: 'api-key',
      status: '',
      disabled: false,
      unavailable: false,
      success: 0,
      failed: 0,
      recentRequests: 0,
      planType: '',
      baseUrl: 'https://api.deepseek.com',
      prefix: 'deep',
      priority: 7,
      modelAliases: ['deepseek-chat', 'deepseek-reasoner'],
      disableCooling: true,
    })
    assert.equal('api-key' in apiProvider, false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('execution store persists sanitized records without credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-exec-'))
  const filePath = join(dir, 'executions.json')
  try {
    const store = new CpaExecutionStore(filePath)
    await store.ensureLoaded()
    const appended = await store.append({
      authIndex: 'auth-1',
      sessionId: 's1',
      provider: 'cpa',
      model: 'gpt-5',
      outcome: 'success',
      traceId: 'trace-1',
      requestId: 'request-1',
      time: 123,
      inputTokens: 10,
      outputTokens: 2,
      secret: 'raw-secret',
    })
    assert.equal('secret' in appended, false)
    assert.deepEqual(appended, {
      authIndex: 'auth-1',
      sessionId: 's1',
      provider: 'cpa',
      model: 'gpt-5',
      purpose: '',
      outcome: 'success',
      traceId: 'trace-1',
      requestId: 'request-1',
      time: 123,
      inputTokens: 10,
      outputTokens: 2,
    })
    assert.equal((await stat(filePath)).mode & 0o777, 0o600)
    const reloaded = new CpaExecutionStore(filePath)
    await reloaded.ensureLoaded()
    assert.deepEqual(reloaded.latest('s1'), appended)
    await reloaded.append({
      authIndex: 'auth-2',
      sessionId: 's1',
      outcome: 'success',
      traceId: 'trace-2',
      time: 124,
      inputTokens: 1,
      outputTokens: 1,
    })
    await reloaded.append({
      authIndex: 'auth-2',
      sessionId: 's1',
      outcome: 'failure',
      traceId: 'trace-3',
      time: 125,
    })
    assert.deepEqual(reloaded.latest('s1'), {
      authIndex: 'auth-2',
      sessionId: 's1',
      provider: '',
      model: '',
      purpose: '',
      outcome: 'failure',
      traceId: 'trace-3',
      requestId: '',
      time: 125,
    })
    assert.equal(sanitizeExecutionRecord({ time: 1 }), undefined)
    assert.equal(sanitizeExecutionRecord(null), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('aggregateCpaUsage keeps per-account request, failure, and token totals', () => {
  const first = aggregateCpaUsage(null, {
    authIndex: 'auth-1',
    sessionId: 's1',
    traceId: 'trace-1',
    outcome: 'success',
    inputTokens: 10,
    outputTokens: 2,
  })
  const second = aggregateCpaUsage(first, {
    authIndex: 'auth-1',
    sessionId: 's1',
    traceId: 'trace-2',
    outcome: 'failure',
    inputTokens: 1,
    outputTokens: 1,
  })
  assert.equal(second.requests, 2)
  assert.equal(second.failed, 1)
  assert.equal(second.inputTokens, 11)
  assert.equal(second.outputTokens, 3)
  assert.equal(second.latest.outcome, 'failure')
  assert.equal(second.latest.inputTokens, 1)
  assert.equal(second.latest.outputTokens, 1)
  assert.deepEqual(second.byAccount['auth-1'], {
    authIndex: 'auth-1',
    requests: 2,
    failed: 1,
    inputTokens: 11,
    outputTokens: 3,
  })
})

test('simpleProjectionSchema accepts the null empty state for history restore', () => {
  assert.equal(simpleProjectionSchema().parse(null), null)
  assert.deepEqual(simpleProjectionSchema().parse({ requests: 0 }), { requests: 0 })
  assert.throws(() => simpleProjectionSchema().parse([]), /cpaUsage projection must be an object or null/)
})

test('cpaRoot strips v1 for the management proxy', () => {
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317')
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1/'), 'http://127.0.0.1:8317')
})
