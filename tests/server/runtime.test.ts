import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ServerResponse } from 'node:http'

import { Context } from '@deepseek-ai/cordis'
import { KNOWN_SESSION_EVENT_TYPES, pluginRecordOf, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { resolveOptions, sanitizeCpaSettings } from '../../lib/core/config.js'
import type { CpaSettings } from '../../lib/core/config.js'
import { isJsonRecord } from '../../lib/core/json.js'
import { EXECUTION_RECORD_TYPE } from '../../lib/core/services.js'
import {
  CpaController,
  cpaSettingsEqual,
  mergeCpaSettings,
  modelSyncRetryDelay,
  resolveInitialCpaSettings,
} from '../../lib/server/runtime.js'
import type { CpaRuntimeContext } from '../../lib/server/runtime.js'
import { DEFAULT_ADVANCED_SETTINGS, sessionId } from '../helpers/fixtures.ts'
import { sendJson, startServer } from '../helpers/http.ts'

const SYNC_TIMEOUT_TICK_MS = 20

type ProjectionState = null | { requests: number }

interface ProjectionDefinitionStub {
  key: string
  stateSchema?: { parse(state: ProjectionState): ProjectionState }
  apply?(state: ProjectionState, event: { type: string }): ProjectionState
  wire?: {
    viewSchema?: { parse(state: ProjectionState): ProjectionState }
    view?(state: ProjectionState): ProjectionState
    summary?: boolean
  }
  stateVersion?: number
}

interface ProjectionCapture {
  definition?: ProjectionDefinitionStub
  onRejected?: (error: Error) => void
}

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

      // Older sync still pending.
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

  it('registers the cpaUsage projection with the schema and client view a current host restores', () => {
    const warnings: string[] = []
    const captured: ProjectionCapture = {}
    const scope = {
      sessionProjections: {
        register(definition: ProjectionDefinitionStub) {
          captured.definition = definition
          return {
            catch(onRejected: (error: Error) => void) {
              captured.onRejected = onRejected
            },
          }
        },
      },
    }
    const controller = new CpaController({
      get: () => undefined,
      logger: { warn: message => { warnings.push(String(message)) } },
      llm: { registerAdapter: () => () => {} },
      effect: () => {},
      // SAFETY: the stub accepts the projection definition the controller registers.
      inject: ((_deps: readonly string[], factory: (injected: typeof scope) => void) => {
        factory(scope)
        return { dispose: () => {} }
      }) as CpaRuntimeContext['inject'],
    }, resolveOptions({}), externalSettings('http://127.0.0.1:1'))

    controller.installProjection()

    const definition = captured.definition
    assert.equal(definition?.key, 'cpaUsage')
    assert.equal(definition?.stateSchema?.parse(null), null)
    const state = { requests: 1 }
    assert.equal(definition?.apply?.(state, { type: 'turn/start' }), state)
    assert.equal(definition?.wire?.summary, false)
    assert.equal(definition?.wire?.view?.(null), null)
    assert.equal(definition?.wire?.viewSchema?.parse(state), state)
    captured.onRejected?.(new Error('registry offline'))
    assert.ok(warnings.some(message => message.includes('projection registration failed: registry offline')))
  })

  it('records executions as ignorable plugin records a current host can still restore', async () => {
    const store = new SessionStore(new Context())
    const target = sessionId('session-1')
    const session = store.create(SessionId(target), { meta: { cwd: '/' } })
    const controller = new CpaController({
      get: () => undefined,
      logger: { warn: () => {} },
      llm: { registerAdapter: () => () => {} },
      effect: () => {},
      sessions: { get: id => store.get(SessionId(id)) },
    }, resolveOptions({}), externalSettings('http://127.0.0.1:1'))

    await controller.recordExecution({
      provider: 'cpa',
      model: 'gpt-5',
      sessionId: target,
      outcome: 'success',
    })

    const events = session.snapshotEvents()
    assert.equal(events.length, 1)
    assert.ok(events[0] !== undefined)
    assert.equal(events[0].ignorable, true)
    assert.equal(KNOWN_SESSION_EVENT_TYPES.has(EXECUTION_RECORD_TYPE), false)
    const record = pluginRecordOf(events[0])
    assert.equal(record?.type, EXECUTION_RECORD_TYPE)
    const data = isJsonRecord(record?.data) ? record.data : undefined
    assert.equal(data?.model, 'gpt-5')
    assert.equal(data?.outcome, 'success')
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
