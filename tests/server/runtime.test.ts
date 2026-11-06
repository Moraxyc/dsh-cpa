import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerResponse } from 'node:http'

import { resolveOptions, sanitizeCpaSettings } from '../../lib/core/config.js'
import type { CpaSettings } from '../../lib/core/config.js'
import {
  CpaController,
  cpaSettingsEqual,
  mergeCpaSettings,
  modelSyncRetryDelay,
  resolveInitialCpaSettings,
} from '../../lib/server/runtime.js'
import { DEFAULT_ADVANCED_SETTINGS } from '../helpers/fixtures.ts'
import { sendJson, startServer } from '../helpers/http.ts'

const SYNC_TIMEOUT_TICK_MS = 20

function externalSettings(baseURL: string): CpaSettings {
  return sanitizeCpaSettings({
    mode: 'external',
    externalUrl: baseURL,
    externalApiKey: 'sk-test',
  })
}

describe('server/runtime', () => {
  it('modelSyncRetryDelay backs off exponentially up to the refresh interval', () => {
    assert.deepEqual([1, 2, 3, 4, 10].map(n => modelSyncRetryDelay(n, 20_000)), [
      3_000, 6_000, 12_000, 20_000, 20_000,
    ])
  })

  it('model sync keeps the last catalog on failure and ignores superseded results', async () => {
    const warnings: string[] = []
    // Each request is answered by whatever handler is current when it arrives.
    let respond: (res: ServerResponse) => void = res => sendJson(res, 200, { models: [{ slug: 'first' }] })
    const server = await startServer((_req, res) => respond(res))
    const controller = new CpaController({
      get: () => undefined,
      logger: { warn: message => { warnings.push(String(message)) } },
      llm: { registerAdapter: () => () => {} },
      effect: () => {},
    }, resolveOptions({}), externalSettings(server.baseURL))
    const modelIds = async () => (await controller.diagnostics()).models.map(model => model.id)

    try {
      await controller.applySettings(externalSettings(server.baseURL))
      assert.deepEqual(await modelIds(), ['first'])

      respond = res => {
        res.writeHead(500)
        res.end()
      }
      assert.equal(await controller.syncModels(), false)
      assert.equal(await controller.syncModels(), false)
      assert.deepEqual(await modelIds(), ['first'])
      assert.equal(warnings.filter(message => message.includes('model sync failed')).length, 1)

      // Hold the first sync open, then let a newer sync win before the older one answers.
      const held: Array<() => void> = []
      respond = res => {
        held.push(() => sendJson(res, 200, { models: [{ slug: 'stale' }] }))
      }
      const slow = controller.syncModels()
      await new Promise(resolve => setTimeout(resolve, SYNC_TIMEOUT_TICK_MS))
      respond = res => sendJson(res, 200, { models: [{ slug: 'fresh' }] })
      assert.equal(await controller.syncModels(), true)
      held.at(0)?.()
      assert.equal(await slow, false)
      assert.deepEqual(await modelIds(), ['fresh'])
    } finally {
      await controller.stopRuntime()
      await server.close()
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

    // Persisted settings win over deployment options, field by field.
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
