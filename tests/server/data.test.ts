import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CpaDataService } from '../../src/server/data.js'
import { makeIdToken } from '../helpers/fixtures.ts'
import { sendJson, startServer } from '../helpers/http.ts'

const MANAGEMENT_KEY = 'mgmt-live'

describe('server/data', () => {
  it('summary normalizes and caches sanitized management data', async () => {
    const requestCounts = new Map<string, number>()
    const server = await startServer((req, res) => {
      req.resume()
      const url = new URL(req.url ?? '/', 'http://localhost')
      assert.equal(req.headers.authorization, `Bearer ${MANAGEMENT_KEY}`)
      requestCounts.set(url.pathname, (requestCounts.get(url.pathname) ?? 0) + 1)

      switch (url.pathname) {
        case '/v8/management/observability/usage/api-keys':
          sendJson(res, 200, {
            deepseek: {
              'https://api.deepseek.com|sk-secret': { success: 5, failed: 1 },
            },
          })
          return
        case '/v8/management/config':
          sendJson(res, 200, {
            routing: {
              strategy: 'round-robin',
              'force-model-prefix': true,
              retry: { 'request-retry': 3, 'max-retry-interval': 60_000 },
            },
            requests: {
              'proxy-url': 'https://user:pass@proxy.example/path?token=abc',
            },
            observability: {
              logs: {
                debug: true,
                'request-log': false,
                'logging-to-file': true,
                'logs-max-total-size-mb': 512,
                'error-logs-max-files': 7,
              },
              usage: { 'usage-statistics-enabled': true },
            },
            oauth: {
              providers: { aistudio: { 'ws-auth': false } },
            },
            access: {
              api_key: 'raw-secret',
              secret_token: 'secret-token',
            },
          }, { 'x-cpa-version': 'v0.1.2' })
          return
        case '/v8/management/config/api-keys':
          sendJson(res, 200, {})
          return
        case '/v8/management/server/latest-version':
          sendJson(res, 200, { 'latest-version': 'v0.1.3' })
          return
        case '/v8/management/credentials':
          sendJson(res, 200, {
            files: [{
              auth_index: 'auth-1',
              label: 'Codex',
              id: '/home/user/.cli-proxy-api/codex.json',
              name: 'codex.json',
              provider: 'codex',
              success: 8,
              failed: 2,
              id_token: makeIdToken('acct-1'),
              plan_type: 'pro',
              secret: 'raw-secret',
            }],
          })
          return
        case '/v8/management/credentials/models':
          assert.equal(url.searchParams.get('name'), 'codex.json')
          sendJson(res, 200, { models: ['gpt-5', 'gpt-5', 'claude-3-7-sonnet'] })
          return
        default:
          res.writeHead(404)
          res.end()
      }
    })

    try {
      const service = new CpaDataService({
        baseURL: () => server.baseURL,
        managementKey: () => MANAGEMENT_KEY,
        dataTtlMs: 60_000,
        modelTtlMs: 60_000,
        concurrency: 2,
      })
      const summary = await service.summary()
      const cached = await service.summary()

      assert.deepEqual(summary.instance, {
        version: 'v0.1.2',
        latestVersion: 'v0.1.3',
        updateAvailable: true,
        config: {
          routingStrategy: 'round-robin',
          proxyUrl: 'https://proxy.example/path',
          requestRetry: 3,
          maxRetryInterval: 60_000,
          debug: true,
          requestLog: false,
          loggingToFile: true,
          usageStatisticsEnabled: true,
          websocketAuth: false,
          forceModelPrefix: true,
          logsMaxTotalSizeMb: 512,
          errorLogsMaxFiles: 7,
        },
      })
      assert.deepEqual(summary.usage.totals, {
        totalRequests: 16,
        successRequests: 13,
        failedRequests: 3,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        successRate: 0.8125,
      })
      assert.deepEqual(summary.usage.models, [{
        modelId: 'codex / Codex',
        totalRequests: 10,
        successRequests: 8,
        failedRequests: 2,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        successRate: 0.8,
        firstRequestAt: '',
        lastRequestAt: '',
      }, {
        modelId: 'deepseek API',
        totalRequests: 6,
        successRequests: 5,
        failedRequests: 1,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        successRate: 0.8333333333333334,
        firstRequestAt: '',
        lastRequestAt: '',
      }])

      const account = summary.accounts.find(entry => entry.authIndex === 'auth-1')
      assert.ok(account)
      assert.equal(account.name, 'codex.json')
      assert.equal(account.label, 'Codex')
      assert.deepEqual(account.models, ['claude-3-7-sonnet', 'gpt-5'])
      assert.deepEqual(summary.models, ['claude-3-7-sonnet', 'gpt-5'])
      assert.deepEqual(summary.errors, [])
      assert.equal('id_token' in account, false)
      assert.equal('secret' in account, false)
      assert.equal('accountId' in account, false)

      const serialized = `${JSON.stringify(summary)}\n${JSON.stringify(cached)}`
      for (const secret of [
        MANAGEMENT_KEY,
        'raw-secret',
        'secret-token',
        'api_key',
        'user:pass',
        'token=abc',
        '/home/user/.cli-proxy-api/codex.json',
      ]) {
        assert.equal(serialized.includes(secret), false)
      }

      for (const path of [
        '/v8/management/observability/usage/api-keys',
        '/v8/management/config',
        '/v8/management/config/api-keys',
        '/v8/management/server/latest-version',
        '/v8/management/credentials',
        '/v8/management/credentials/models',
      ]) {
        assert.equal(requestCounts.get(path), 1)
      }
      assert.equal([...requestCounts.keys()].some(path => path.startsWith('/v0/management')), false)
    } finally {
      await server.close()
    }
  })

  it('summary reports upstream errors per source without crashing', async () => {
    const server = await startServer((req, res) => {
      req.resume()
      assert.equal(req.headers.authorization, `Bearer ${MANAGEMENT_KEY}`)
      res.writeHead(500)
      res.end('upstream unavailable')
    })
    try {
      const service = new CpaDataService({
        baseURL: server.baseURL,
        managementKey: MANAGEMENT_KEY,
        dataTtlMs: 1_000,
        modelTtlMs: 1_000,
        concurrency: 1,
      })
      const summary = await service.summary()

      assert.equal(summary.available, true)
      assert.deepEqual(summary.usage.totals, {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        successRate: 0,
      })
      assert.deepEqual(summary.accounts, [])
      assert.deepEqual(summary.models, [])
      assert.deepEqual(
        summary.errors.map(error => error.source).sort(),
        ['accounts', 'config', 'latest-version', 'usage'],
      )
      assert.equal(JSON.stringify(summary).includes(MANAGEMENT_KEY), false)
    } finally {
      await server.close()
    }
  })
})
