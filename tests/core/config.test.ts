import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  cpaSettingsEqual,
  mergeCpaSettings,
  readCpaSettings,
  resolveCpaSettingsFromConfig,
  resolveInitialCpaSettings,
  resolveOptions,
  sanitizeCpaSettings,
  writeCpaSettings,
} from '../../lib/core/config.js'
import type { Config, CpaSettings } from '../../lib/core/config.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../helpers/fixtures.ts'

type VolatileField<T> = { get: () => T }

function volatile<T>(value: T): VolatileField<T> {
  return { get: () => value }
}

function unsetVolatile<T>(): VolatileField<T> {
  // SAFETY: unset host fields return undefined even when the declared type excludes it.
  return { get: () => undefined as T }
}

describe('core/config', () => {
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

  it('resolveInitialCpaSettings seeds from deployment options, and mergeCpaSettings validates patches', () => {
    const options = resolveOptions({
      url: 'http://127.0.0.1:9000/v1',
      apiKey: 'sk-config',
      managementKey: 'mgmt-env',
    })
    assert.deepEqual(resolveInitialCpaSettings(options, undefined), {
      mode: 'external',
      externalUrl: 'http://127.0.0.1:9000/v1',
      externalApiKey: 'sk-config',
      externalManagementKey: 'mgmt-env',
      internalBin: options.bin,
      usageStatisticsEnabled: true,
      ...DEFAULT_ADVANCED_SETTINGS,
      configPath: options.configPath,
      settingsPath: options.settingsPath,
      executionsPath: options.executionsPath,
    })

    const stored: CpaSettings = {
      mode: 'internal',
      externalUrl: 'http://saved.example/v1',
      externalApiKey: 'sk-saved',
      externalManagementKey: 'mgmt-saved',
      internalBin: '/opt/cli-proxy-api',
      usageStatisticsEnabled: true,
      ...DEFAULT_ADVANCED_SETTINGS,
      configPath: '/saved/config.yaml',
      settingsPath: '/saved/settings.json',
      executionsPath: '/saved/executions.json',
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
      routingStrategy: 'quota',
      dailyRequestLimit: 100,
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
      routingStrategy: 'quota',
      dailyRequestLimit: 100,
    })
    assert.equal(cpaSettingsEqual(merged, { ...merged }), true)

    const disabled = mergeCpaSettings(merged, { usageStatisticsEnabled: false })
    assert.equal(disabled.usageStatisticsEnabled, false)
    assert.equal(cpaSettingsEqual(merged, disabled), false)

    const invalid = mergeCpaSettings(merged, { port: -1, refreshIntervalMs: 0 })
    assert.equal(invalid.port, 9000)
    assert.equal(invalid.refreshIntervalMs, 120_000)
    assert.throws(() => mergeCpaSettings(merged, { mode: 'sideways' }), /invalid mode/)
    assert.throws(() => mergeCpaSettings(merged, { routingStrategy: 'sideways' }), /invalid routing strategy/)
  })
})
