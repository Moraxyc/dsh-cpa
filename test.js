import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
  resolveCpaBinary,
  sanitizeCpaSettings,
  writeCpaSettings,
} from './config.js'
import { CpaAdapter } from './adapter.js'
import {
  cpaRoot,
  installManagementPanelWhenReady,
  PANEL_PATH,
  SETTINGS_PATH,
  STATUS_PATH,
} from './management.js'
import {
  cpaSettingsEqual,
  mergeCpaSettings,
  resolveInitialCpaSettings,
} from './runtime.js'

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
      ['exact', SETTINGS_PATH],
      ['prefix', PANEL_PATH],
    ],
  )
  dispose()
  assert.deepEqual(routes, [])
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
    apiKeyEnv: 'CPA_API_KEY_DSH_TEST',
    url: 'http://127.0.0.1:9000/v1',
    managementKey: 'mgmt-env',
  }
  try {
    process.env.CPA_API_KEY_DSH_TEST = 'sk-env'
    assert.deepEqual(resolveInitialCpaSettings(options, undefined), {
      mode: 'external',
      externalUrl: 'http://127.0.0.1:9000/v1',
      externalApiKey: 'sk-env',
      externalManagementKey: 'mgmt-env',
      internalBin: '',
    })
    const stored = {
      mode: 'internal',
      externalUrl: 'http://saved.example/v1',
      externalApiKey: 'sk-saved',
      externalManagementKey: 'mgmt-saved',
      internalBin: '/opt/cli-proxy-api',
    }
    assert.deepEqual(resolveInitialCpaSettings(options, stored), stored)
  } finally {
    delete process.env.CPA_API_KEY_DSH_TEST
  }

  const merged = mergeCpaSettings({
    mode: 'internal',
    externalUrl: '',
    externalApiKey: '',
    externalManagementKey: '',
    internalBin: '',
  }, {
    mode: 'external',
    externalUrl: '  http://127.0.0.1:9000/v1  ',
    externalApiKey: 'sk-next',
    internalBin: '  /usr/local/bin/cli-proxy-api  ',
  })
  assert.deepEqual(merged, {
    mode: 'external',
    externalUrl: 'http://127.0.0.1:9000/v1',
    externalApiKey: 'sk-next',
    externalManagementKey: '',
    internalBin: '/usr/local/bin/cli-proxy-api',
  })
  assert.equal(cpaSettingsEqual(merged, { ...merged }), true)
  assert.throws(() => mergeCpaSettings(merged, { mode: 'sideways' }), /invalid mode/)
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
    })
    assert.deepEqual(await readCpaSettings(settingsPath), {
      mode: 'external',
      externalUrl: 'http://127.0.0.1:9000/v1',
      externalApiKey: 'sk-secret',
      externalManagementKey: 'mgmt-secret',
      internalBin: '/opt/cli-proxy-api',
    })
    assert.deepEqual(sanitizeCpaSettings({ mode: 'sideways', externalUrl: 7 }), {
      mode: 'internal',
      externalUrl: '',
      externalApiKey: '',
      externalManagementKey: '',
      internalBin: '',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('cpaRoot strips v1 for the management proxy', () => {
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317')
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1/'), 'http://127.0.0.1:8317')
})
