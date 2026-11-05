import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertCpaBinary,
  buildManagedConfig,
  chatCompletionsUrl,
  fetchModels,
  modelsUrl,
  normalizeModels,
  readBoundedJson,
  readCpaSettings,
  resolveCpaBinary,
  resolveCpaSettingsFromConfig,
  resolveOptions,
  sanitizeCpaSettings,
  writeCpaSettings,
} from '../../src/core/config.js'
import type { Config } from '../../src/core/config.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../helpers/fixtures.ts'
import { sendJson, startServer } from '../helpers/http.ts'

/** A volatile profile field, read through `get()` as dsh exposes it. */
type VolatileField<T> = { get: () => T }

function volatile<T>(value: T): VolatileField<T> {
  return { get: () => value }
}

/**
 * A volatile profile field the user never set. dsh's `get()` yields `undefined` for it at
 * runtime, while the `Volatile<T>` type omits `undefined` for most fields; the resolver must
 * fall back to deployment options for these values.
 */
function unsetVolatile<T>(): VolatileField<T> {
  // SAFETY: unset profile fields read as undefined at runtime; the declared type under-describes this.
  return { get: () => undefined as T }
}

describe('core/config', () => {
  it('keeps the v1 prefix stable for models and chat completions URLs', () => {
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

  it('normalizeModels reads CPA metadata fields and drops entries without a usable id', () => {
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

  it('normalizeModels sorts models and maps reasoning levels', () => {
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
    ])
  })

  it('normalizeModels skips hidden models and reads alternate catalog fields', () => {
    assert.deepEqual(normalizeModels([
      { slug: 'hidden', visibility: 'hide' },
      { slug: 'listed', visibility: 'list', name: 'Listed', max_output_tokens: 8192 },
      { id: 'plain', max_tokens: 1024 },
    ]), [
      { id: 'listed', displayName: 'Listed', maxCompletionTokens: 8192 },
      { id: 'plain', maxCompletionTokens: 1024 },
    ])
  })

  it('normalizeModels reads catalog input modalities', () => {
    assert.deepEqual(normalizeModels([
      { slug: 'vision', input_modalities: ['text', 'image', 'IMAGE', 'audio'] },
      { slug: 'empty', input_modalities: ['audio'] },
    ]), [
      { id: 'empty' },
      { id: 'vision', inputModalities: ['text', 'image'] },
    ])
  })

  it('fetchModels requests the CPA rich model catalog and reads its metadata', async () => {
    const server = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      assert.equal(url.searchParams.get('client_version'), 'dsh-cpa')
      sendJson(res, 200, {
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
      })
    })
    try {
      assert.deepEqual(await fetchModels(server.baseURL, 'sk-test'), [
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
      await server.close()
    }
  })

  it('fetchModels points auth failures at the CPA API key', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401)
      res.end()
    })
    try {
      await assert.rejects(
        fetchModels(server.baseURL, 'sk-bad'),
        /models returned 401; check the CPA API key/,
      )
    } finally {
      await server.close()
    }
  })

  it('readBoundedJson rejects streamed bodies larger than the limit', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('["aaaa",'))
        controller.enqueue(new TextEncoder().encode('"bbbb"]'))
        controller.close()
      },
    })
    await assert.rejects(readBoundedJson(new Response(body), 10), /exceeds 10 bytes/)
    assert.deepEqual(await readBoundedJson(new Response('[1,2]'), 10), [1, 2])
  })

  it('resolveCpaSettingsFromConfig reads volatile values and inherits deployment defaults', () => {
    const options = resolveOptions({
      url: 'http://deployment.example/v1',
      apiKey: 'deployment-api-key',
      managementKey: 'deployment-management-key',
      bin: '/opt/cli-proxy-api',
      configPath: '/opt/cpa/config.yaml',
      port: 9000,
      refreshIntervalMs: 120_000,
    })
    const config: Config = {
      provider: 'cpa',
      apiKeyRef: 'CPA_API_KEY',
      bin: 'cli-proxy-api',
      host: '127.0.0.1',
      startTimeoutMs: 30_000,
      defaultContextWindow: 262_144,
      defaultMaxTokens: 32_768,
      mode: volatile('external'),
      externalUrl: volatile('http://profile.example/v1'),
      externalApiKey: volatile('profile-api-key'),
      externalManagementKey: unsetVolatile(),
      internalBin: unsetVolatile(),
      usageStatisticsEnabled: volatile(false),
      routingStrategy: unsetVolatile(),
      dailyRequestLimit: volatile(12),
      refreshIntervalMs: unsetVolatile(),
      port: volatile(9100),
      configPath: unsetVolatile(),
      settingsPath: volatile('/profile/settings.json'),
      executionsPath: unsetVolatile(),
      authFilesTtlMs: unsetVolatile(),
      quotaTtlMs: volatile(15_000),
      quotaConcurrency: unsetVolatile(),
    }
    const settings = resolveCpaSettingsFromConfig(config, options)

    assert.equal(settings.mode, 'external')
    assert.equal(settings.externalUrl, 'http://profile.example/v1')
    assert.equal(settings.externalApiKey, 'profile-api-key')
    assert.equal(settings.externalManagementKey, 'deployment-management-key')
    assert.equal(settings.internalBin, '/opt/cli-proxy-api')
    assert.equal(settings.usageStatisticsEnabled, false)
    assert.equal(settings.routingStrategy, 'balanced')
    assert.equal(settings.dailyRequestLimit, 12)
    assert.equal(settings.refreshIntervalMs, 120_000)
    assert.equal(settings.port, 9100)
    assert.equal(settings.configPath, '/opt/cpa/config.yaml')
    assert.equal(settings.settingsPath, '/profile/settings.json')
    assert.equal(settings.quotaTtlMs, 15_000)
    assert.equal(settings.quotaConcurrency, 4)
  })

  it('resolveOptions ignores legacy CPA environment variables', () => {
    const legacyKeys = [
      'CPA_URL',
      'CPA_API_KEY',
      'CPA_MANAGEMENT_KEY',
      'CPA_BIN',
      'CPA_CONFIG',
      'CPA_SETTINGS',
      'CPA_EXECUTIONS',
      'CPA_REFRESH_INTERVAL_MS',
    ] as const
    const previous = legacyKeys.map(key => [key, process.env[key]] as const)
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
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('buildManagedConfig writes a local CPA config with the usage flag', () => {
    const yaml = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'sk-test',
      managementKey: 'mgmt-test',
    })
    assert.match(yaml, /^config-version: 8$/m)
    assert.match(yaml, /^server:$/m)
    assert.match(yaml, /^  host: "127\.0\.0\.1"$/m)
    assert.match(yaml, /^  port: 8317$/m)
    assert.match(yaml, /^management:$/m)
    assert.match(yaml, /^  secret-key: "mgmt-test"$/m)
    assert.match(yaml, /^access:$/m)
    assert.match(yaml, /^  api-keys:$/m)
    assert.match(yaml, /^    - "sk-test"$/m)
    assert.match(yaml, /^observability:$/m)
    assert.match(yaml, /^  usage:$/m)
    assert.match(yaml, /^    usage-statistics-enabled: true$/m)

    const disabled = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'sk-test',
      managementKey: 'mgmt-test',
      usageStatisticsEnabled: false,
    })
    assert.match(disabled, /^    usage-statistics-enabled: false$/m)
  })

  it('resolveCpaBinary checks PATH and the executable bit before spawning', { skip: process.platform === 'win32' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-bin-'))
    const script = join(dir, 'cli-proxy-api')
    const previousPath = process.env.PATH
    try {
      await writeFile(script, '#!/bin/sh\n')
      await chmod(script, 0o755)
      process.env.PATH = dir
      assert.equal(await resolveCpaBinary('cli-proxy-api'), script)
      assert.equal(await resolveCpaBinary(join(dir, 'missing')), undefined)
      await assert.rejects(assertCpaBinary('not-a-real-cpa'), /CPA binary not found/)
      await chmod(script, 0o644)
      assert.equal(await resolveCpaBinary('cli-proxy-api'), undefined)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists CPA settings and sanitizes an invalid mode on write-read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-'))
    const settingsPath = join(dir, 'settings.json')
    try {
      const settings = {
        mode: 'external',
        externalUrl: 'http://127.0.0.1:9000/v1',
        externalApiKey: 'sk-secret',
        externalManagementKey: 'mgmt-secret',
        internalBin: '/opt/cli-proxy-api',
        usageStatisticsEnabled: true,
        ...DEFAULT_ADVANCED_SETTINGS,
      } as const
      await writeCpaSettings(settingsPath, settings)
      assert.deepEqual(await readCpaSettings(settingsPath), settings)

      assert.deepEqual(sanitizeCpaSettings({ mode: 'sideways', externalUrl: 7 }), {
        mode: 'internal',
        externalUrl: '',
        externalApiKey: '',
        externalManagementKey: '',
        internalBin: '',
        usageStatisticsEnabled: true,
        ...DEFAULT_ADVANCED_SETTINGS,
      })

      await writeCpaSettings(settingsPath, sanitizeCpaSettings({
        mode: 'internal',
        usageStatisticsEnabled: false,
      }))
      assert.equal((await readCpaSettings(settingsPath))?.usageStatisticsEnabled, false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
