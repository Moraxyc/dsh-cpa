import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { ExecutionRecord } from '../../lib/core/services.js'
import type { CpaRoutePlan, CpaRouteOptions } from '../../lib/core/router.js'
import {
  cpaRoot,
  EXECUTION_STATUS_PATH,
  installManagementPanel,
  managementCookieValue,
  PANEL_PATH,
  PREFLIGHT_PATH,
  SUMMARY_PATH,
} from '../../lib/server/management.js'
import type { ManagementWebScope } from '../../lib/server/management.js'
import { emptyCpaSummary } from '../../lib/server/data.js'
import { normalizeQuotaReport, sanitizeAuthFiles } from '../../lib/server/quota.js'
import type { CpaQuotaReport } from '../../lib/server/quota.js'
import { readJson, startServer } from '../helpers/http.ts'
import {
  createCarrierScope,
  createRouteRecorder,
  findRoute,
  injectedContext,
  serveRoute,
} from '../helpers/management.ts'

const MANAGEMENT_KEY = 'mgmt-test'
const BASE_URL = 'http://127.0.0.1:8317/v1'

describe('server/management', () => {
  it('binds panel routes to each web carrier scope and releases them on unload', async () => {
    const deps: string[][] = []
    const factories: Array<(scope: ManagementWebScope) => void> = []
    let disposed = 0
    const release = installManagementPanel({
      inject(injectDeps, factory) {
        deps.push([...injectDeps])
        factories.push(factory)
        return { dispose() { disposed += 1 } }
      },
      logger: { warn() {} },
    }, { baseURL: BASE_URL, managementKey: MANAGEMENT_KEY })
    assert.deepEqual(deps, [['webServer']])

    const install = factories[0]
    assert.ok(install)

    // Every carrier owns its own routes, and they leave with the scope instead of the first carrier.
    const first = createRouteRecorder()
    const firstScope = createCarrierScope(first.webServer)
    install(firstScope.scope)
    const boundRoutes = first.routes.length
    assert.ok(boundRoutes > 0)
    firstScope.unload()
    assert.deepEqual(first.routes, [])

    const second = createRouteRecorder()
    const secondScope = createCarrierScope(second.webServer)
    install(secondScope.scope)
    assert.equal(second.routes.length, boundRoutes)
    secondScope.unload()
    assert.deepEqual(second.routes, [])

    await release()
    assert.equal(disposed, 1)
  })

  it('summary route returns a safe shape without a management key or upstream calls', async () => {
    const recorder = createRouteRecorder()
    let summaryCalls = 0
    installManagementPanel(injectedContext(recorder.webServer), {
      baseURL: () => BASE_URL,
      managementKey: () => '',
      dataService: {
        async summary() {
          summaryCalls += 1
          return emptyCpaSummary()
        },
      },
    })

    const server = await serveRoute(findRoute(recorder.routes, SUMMARY_PATH))
    try {
      const response = await fetch(`${server.origin}${SUMMARY_PATH}`)
      const body = await readJson<{
        available: boolean
        accounts: unknown[]
        models: unknown[]
        instance: { latestVersion: string }
        usage: { totals: { totalRequests: number } }
      }>(response)

      assert.equal(response.status, 200)
      assert.equal(body.available, false)
      assert.deepEqual(body.accounts, [])
      assert.deepEqual(body.models, [])
      assert.equal(body.instance.latestVersion, '')
      assert.equal(body.usage.totals.totalRequests, 0)
      assert.equal(summaryCalls, 0)
    } finally {
      await server.close()
    }
  })

  it('preflight route validates input and forwards only routing facts', async () => {
    const recorder = createRouteRecorder()
    const calls: CpaRouteOptions[] = []
    const plan: CpaRoutePlan = {
      requestedModel: 'gpt-5',
      models: ['gpt-5', 'fallback'],
      candidates: [],
      preflight: {
        model: 'gpt-5',
        inputTokens: 12_000,
        maxTokens: 2_000,
        contextWindow: 128_000,
        status: 'ready',
        issues: [],
      },
    }
    installManagementPanel(injectedContext(recorder.webServer), {
      baseURL: () => BASE_URL,
      managementKey: () => MANAGEMENT_KEY,
      preflight: async input => {
        calls.push(input)
        return plan
      },
    })

    const server = await serveRoute(findRoute(recorder.routes, PREFLIGHT_PATH))
    try {
      const response = await fetch(`${server.origin}${PREFLIGHT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ' gpt-5 ',
          inputTokens: 12_000,
          maxTokens: 2_000,
          reasoningEffort: 'high',
          messages: [{ role: 'user', content: 'must not be forwarded' }],
        }),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), plan)
      assert.deepEqual(calls, [{
        model: 'gpt-5',
        messages: [],
        inputTokens: 12_000,
        maxTokens: 2_000,
        reasoningEffort: 'high',
      }])

      const invalid = await fetch(`${server.origin}${PREFLIGHT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(invalid.status, 400)
      assert.deepEqual(await readJson(invalid), { error: 'model required' })
    } finally {
      await server.close()
    }
  })

  it('management proxy blocks browser access to the api-call endpoints', async () => {
    let apiCalls = 0
    const upstream = await startServer((_req, res) => {
      apiCalls += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const recorder = createRouteRecorder()
    installManagementPanel(injectedContext(recorder.webServer), {
      baseURL: () => upstream.baseURL,
      managementKey: () => MANAGEMENT_KEY,
    })
    const server = await serveRoute(findRoute(recorder.routes, PANEL_PATH))
    try {
      const cookie = `dsh_cpa_mgmt=${managementCookieValue(MANAGEMENT_KEY)}`
      for (const path of ['/v0/management/api-call', '/v8/management/requests/api-call']) {
        const response = await fetch(`${server.origin}${PANEL_PATH}${path}`, {
          method: 'POST',
          headers: { cookie },
        })
        assert.equal(response.status, 403)
      }
      assert.equal(apiCalls, 0)
    } finally {
      await server.close()
      await upstream.close()
    }
  })

  it('execution status route returns sanitized account, quota, and session execution', async () => {
    const recorder = createRouteRecorder()
    const accounts = sanitizeAuthFiles([{ auth_index: 'auth-1', label: 'one' }])
    const quota: CpaQuotaReport = normalizeQuotaReport('codex', 'Codex', 'auth-1', 'pro', {
      rate_limit: {
        primary_window: { limit_window_seconds: 5 * 60 * 60, used_percent: 95 },
      },
    }, new Date('2026-01-01T00:00:00.000Z'))
    const execution: ExecutionRecord = {
      authIndex: 'auth-1',
      sessionId: 's1',
      provider: 'cpa',
      model: 'gpt-5',
      purpose: '',
      outcome: 'success',
      traceId: 'trace-1',
      requestId: '',
      time: 123,
    }
    installManagementPanel(injectedContext(recorder.webServer), {
      baseURL: () => BASE_URL,
      managementKey: () => MANAGEMENT_KEY,
      quotaService: {
        async status() {
          return { accounts, quota: { 'auth-1': quota } }
        },
      },
      executionStore: () => ({
        latest: sessionId => (sessionId === 's1' ? execution : undefined),
      }),
    })

    const server = await serveRoute(findRoute(recorder.routes, EXECUTION_STATUS_PATH))
    try {
      const response = await fetch(`${server.origin}${EXECUTION_STATUS_PATH}?sessionId=s1`)
      assert.equal(response.status, 200)
      assert.deepEqual(await readJson(response), {
        available: true,
        accounts: JSON.parse(JSON.stringify(accounts)),
        quota: { 'auth-1': JSON.parse(JSON.stringify(quota)) },
        execution,
        executions: [execution],
      })
    } finally {
      await server.close()
    }
  })

  it('cpaRoot strips the v1 suffix for the management proxy', () => {
    assert.equal(cpaRoot('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317')
    assert.equal(cpaRoot('http://127.0.0.1:8317/v1/'), 'http://127.0.0.1:8317')
  })
})
