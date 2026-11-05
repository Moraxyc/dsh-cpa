import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { CpaSettings } from '../src/core/config.js'
import type { JsonRecord } from '../src/core/json.js'
import { migrateLegacySettings } from '../src/index.js'
import type { CpaRuntimeContext } from '../src/server/runtime.js'

/** The slice of the host profile-settings service that legacy migration calls. */
interface ProfileSettingsStub {
  describe(): Array<{
    ns: string
    revision: number
    user: JsonRecord
    secrets: Array<{ path: string[]; set: boolean }>
  }>
  update(ns: string, patch: Partial<CpaSettings>, revision: number): Promise<void>
}

function runtimeWithProfile(settings: ProfileSettingsStub): CpaRuntimeContext {
  return {
    get<T>(key: string): T | undefined {
      if (key !== 'settings') return undefined
      // SAFETY: the host resolves the 'settings' key to its profile service; the stub implements the methods migration calls.
      return settings as T
    },
    llm: { registerAdapter: () => () => {} },
    effect: () => {},
  }
}

describe('index', () => {
  it('legacy settings migration leaves existing profile fields untouched', async () => {
    const persisted: CpaSettings = {
      mode: 'internal',
      externalUrl: 'http://legacy.example/v1',
      externalApiKey: 'legacy-api-key',
      externalManagementKey: 'legacy-management-key',
      internalBin: '/legacy/cli-proxy-api',
      usageStatisticsEnabled: false,
      routingStrategy: 'quota',
      dailyRequestLimit: 20,
      refreshIntervalMs: 10_000,
      port: 8318,
      configPath: '/legacy/config.yaml',
      settingsPath: '/legacy/settings.json',
      executionsPath: '/legacy/executions.json',
      authFilesTtlMs: 10_000,
      quotaTtlMs: 20_000,
      quotaConcurrency: 2,
    }
    const updates: Array<{ ns: string; patch: Partial<CpaSettings>; revision: number }> = []
    const ctx = runtimeWithProfile({
      describe: () => [{
        ns: 'dsh-cpa',
        revision: 7,
        user: { mode: 'external', port: 9000, quotaTtlMs: 1_000 },
        secrets: [{ path: ['externalApiKey'], set: true }],
      }],
      update: async (ns, patch, revision) => {
        updates.push({ ns, patch, revision })
      },
    })

    const migrated = await migrateLegacySettings(ctx, persisted)

    assert.ok(migrated)
    assert.equal(migrated.mode, undefined)
    assert.equal(migrated.port, undefined)
    assert.equal(migrated.quotaTtlMs, undefined)
    assert.equal(migrated.externalApiKey, undefined)
    assert.equal(migrated.externalUrl, 'http://legacy.example/v1')
    assert.equal(migrated.routingStrategy, 'quota')
    assert.deepEqual(updates, [{
      ns: 'dsh-cpa',
      patch: migrated,
      revision: 7,
    }])
  })
})
