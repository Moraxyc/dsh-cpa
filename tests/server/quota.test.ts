import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CpaQuotaService,
  deriveQuotaRisk,
  normalizeAntigravityWindows,
  normalizeGeminiWindows,
  normalizeQuotaReport,
  sanitizeAuthFiles,
} from '../../lib/server/quota.js'
import { makeIdToken } from '../helpers/fixtures.ts'
import { sendJson, startServer } from '../helpers/http.ts'

const MANAGEMENT_KEY = 'mgmt-live'

describe('server/quota', () => {
  it('quota normalizers reduce provider payloads to compact windows', () => {
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
    assert.equal(codex.risk, 'normal')
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
    assert.equal(gemini.find(window => window.id === 'gemini-flash-series')?.risk, 'warning')

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
    assert.equal(unknown.risk, 'unknown')
    assert.deepEqual(unknown.windows, [])

    assert.equal(deriveQuotaRisk(5, false), 'critical')
    assert.equal(deriveQuotaRisk(20, false), 'warning')
    assert.equal(deriveQuotaRisk(null, false), 'unknown')
  })

  it('sanitizeAuthFiles removes credentials and keeps account metadata', () => {
    const files = sanitizeAuthFiles([
      {
        auth_index: 'auth-1',
        label: 'one',
        name: 'codex.json',
        provider: 'codex',
        id_token: makeIdToken('acct-1'),
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
        metadata: { id_token: makeIdToken('acct-1'), project_id: 'proj-1' },
      },
      { auth_index: '' },
    ])
    assert.deepEqual(files, [
      {
        authIndex: 'auth-1',
        label: 'one',
        name: 'codex.json',
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
    assert.equal('id_token' in (files[0] ?? {}), false)
    assert.equal('secret' in (files[0] ?? {}), false)
  })

  it('CpaQuotaService reads credentials and api-key providers, and caches quota within its TTL', async () => {
    const requestedPaths = new Set<string>()
    let apiCalls = 0
    const server = await startServer((req, res) => {
      req.resume()
      const url = new URL(req.url ?? '/', 'http://localhost')
      assert.equal(req.headers.authorization, `Bearer ${MANAGEMENT_KEY}`)
      requestedPaths.add(url.pathname)

      switch (url.pathname) {
        case '/v8/management/credentials':
          sendJson(res, 200, {
            files: [{
              auth_index: 'auth-1',
              name: 'Codex',
              provider: 'codex',
              id_token: makeIdToken('acct-1'),
              plan_type: 'pro',
            }],
          })
          return
        case '/v8/management/config/api-keys':
          sendJson(res, 200, {
            'openai-compatibility': [{
              name: 'DeepSeek API',
              'base-url': 'https://api.deepseek.com',
              prefix: 'deep',
              priority: 7,
              disabled: false,
              'disable-cooling': true,
              keys: [{ 'api-key': 'sk-secret', auth_index: 'api-1' }],
              models: [
                { name: 'deepseek-chat', alias: 'deepseek-chat' },
                { name: 'deepseek-reasoner', alias: 'deepseek-reasoner', 'display-name': 'DeepSeek Reasoner' },
              ],
            }],
          })
          return
        case '/v8/management/requests/api-call':
          apiCalls += 1
          sendJson(res, 200, {
            status_code: 200,
            body: JSON.stringify({
              rate_limit: {
                primary_window: { limit_window_seconds: 5 * 60 * 60, used_percent: 10 },
              },
            }),
          })
          return
        default:
          res.writeHead(404)
          res.end()
      }
    })

    try {
      const service = new CpaQuotaService({
        baseURL: () => server.baseURL,
        managementKey: () => MANAGEMENT_KEY,
        authFilesTtlMs: 60_000,
        quotaTtlMs: 60_000,
        concurrency: 1,
      })
      await service.refreshAccounts()
      await service.refreshQuota()

      const report = service.quota.get('auth-1')
      assert.equal(report?.provider, 'codex')
      assert.equal(report?.windows.find(window => window.id === 'code-5h')?.remainingPercent, 90)

      const callsAfterFirst = apiCalls
      await service.refreshQuota()
      assert.equal(apiCalls, callsAfterFirst)

      const status = await service.status()
      assert.equal('accountId' in (status.accounts[0] ?? {}), false)
      assert.equal('projectId' in (status.accounts[0] ?? {}), false)
      assert.equal(status.accounts[0]?.planType, 'pro')

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
      assert.equal(apiProvider !== undefined && 'api-key' in apiProvider, false)
      assert.equal([...requestedPaths].some(path => path.startsWith('/v0/management')), false)
    } finally {
      await server.close()
    }
  })

  it('CpaQuotaService merges credential runtime state with provider metadata by authIndex', async () => {
    const server = await startServer((req, res) => {
      req.resume()
      const url = new URL(req.url ?? '/', 'http://localhost')
      assert.equal(req.headers.authorization, `Bearer ${MANAGEMENT_KEY}`)

      switch (url.pathname) {
        case '/v8/management/credentials':
          sendJson(res, 200, {
            files: [{
              auth_index: 'shared-1',
              provider: 'openai-compatible-deepseek',
              label: 'DeepSeek API',
              status: 'active',
              source: 'memory',
              runtime_only: true,
              success: 9,
              failed: 2,
              recent_requests: [{ time: '10:00-10:10', success: 4, failed: 1 }],
            }],
          })
          return
        case '/v8/management/config/api-keys':
          sendJson(res, 200, {
            'openai-compatibility': [{
              name: 'DeepSeek API',
              'base-url': 'https://api.deepseek.com',
              prefix: 'deep',
              priority: 7,
              'disable-cooling': true,
              keys: [{ 'api-key': 'sk-secret', 'auth-index': 'shared-1' }],
              models: [{ name: 'deepseek-chat', alias: 'deepseek-chat' }],
            }],
          })
          return
        default:
          res.writeHead(404)
          res.end()
      }
    })

    try {
      const service = new CpaQuotaService({
        baseURL: server.baseURL,
        managementKey: MANAGEMENT_KEY,
        authFilesTtlMs: 60_000,
      })
      const accounts = await service.refreshAccounts()
      assert.equal(accounts.length, 1)
      assert.deepEqual(accounts[0], {
        authIndex: 'shared-1',
        label: 'DeepSeek API',
        provider: 'deepseek',
        status: 'active',
        source: 'api-key',
        disabled: false,
        unavailable: false,
        success: 9,
        failed: 2,
        recentRequests: 5,
        accountId: '',
        planType: '',
        projectId: '',
        baseUrl: 'https://api.deepseek.com',
        prefix: 'deep',
        priority: 7,
        modelAliases: ['deepseek-chat'],
        disableCooling: true,
        runtimeOnly: true,
      })
      assert.equal(accounts[0] !== undefined && 'api-key' in accounts[0], false)
    } finally {
      await server.close()
    }
  })

  it('CpaQuotaService keeps the cached account snapshot when management is offline', async () => {
    const server = await startServer((req, res) => {
      req.resume()
      res.writeHead(500, { connection: 'close' })
      res.end('management unavailable')
    })
    try {
      const service = new CpaQuotaService({
        baseURL: server.baseURL,
        managementKey: MANAGEMENT_KEY,
        authFilesTtlMs: 1,
        quotaTtlMs: 1,
        concurrency: 1,
      })
      service.accounts = sanitizeAuthFiles([{
        auth_index: 'auth-cached',
        label: 'cached account',
        provider: 'codex',
      }])

      const status = await service.status()
      assert.deepEqual(status.accounts.map(account => account.authIndex), ['auth-cached'])
      assert.deepEqual(status.quota, {})
    } finally {
      await server.close()
    }
  })
})
