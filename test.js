import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildManagedConfig,
  chatCompletionsUrl,
  modelsUrl,
  normalizeModels,
} from './config.js'
import {
  cpaRoot,
  installManagementPanelWhenReady,
  PANEL_PATH,
  STATUS_PATH,
} from './management.js'

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
      description: 'CPA model',
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
      description: 'CPA model',
      contextLength: 128_000,
      maxCompletionTokens: 4096,
    },
    { id: 'beta' },
  ])
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
      ['prefix', PANEL_PATH],
    ],
  )
  dispose()
  assert.deepEqual(routes, [])
})

test('cpaRoot strips v1 for the management proxy', () => {
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317')
  assert.equal(cpaRoot('http://127.0.0.1:8317/v1/'), 'http://127.0.0.1:8317')
})
