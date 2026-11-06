import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  aggregateCpaUsage,
  CpaExecutionStore,
  sanitizeExecutionRecord,
  simpleProjectionSchema,
} from '../../lib/core/services.js'
import type { ExecutionInput } from '../../lib/core/services.js'

describe('core/services', () => {
  it('CpaExecutionStore persists sanitized records, reloads them, and summarizes local usage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-exec-'))
    const filePath = join(dir, 'executions.json')
    try {
      const store = new CpaExecutionStore(filePath)
      await store.ensureLoaded()

      // Built outside an object literal so the credential-looking field is not an excess-property error.
      const withSecret = {
        authIndex: 'auth-1',
        sessionId: 's1',
        provider: 'cpa',
        model: 'gpt-5',
        outcome: 'success',
        traceId: 'trace-1',
        requestId: 'request-1',
        time: 123,
        inputTokens: 10,
        outputTokens: 2,
        secret: 'raw-secret',
      } satisfies ExecutionInput & { secret: string }
      const appended = await store.append(withSecret)
      assert.ok(appended)
      assert.equal('secret' in appended, false)
      assert.deepEqual(appended, {
        authIndex: 'auth-1',
        sessionId: 's1',
        provider: 'cpa',
        model: 'gpt-5',
        purpose: '',
        outcome: 'success',
        traceId: 'trace-1',
        requestId: 'request-1',
        time: 123,
        inputTokens: 10,
        outputTokens: 2,
      })
      assert.equal((await stat(filePath)).mode & 0o777, 0o600)

      const reloaded = new CpaExecutionStore(filePath)
      await reloaded.ensureLoaded()
      assert.deepEqual(reloaded.latest('s1'), appended)

      await reloaded.append({
        authIndex: 'auth-2',
        sessionId: 's1',
        outcome: 'success',
        traceId: 'trace-2',
        time: 124,
        inputTokens: 1,
        outputTokens: 1,
      })
      await reloaded.append({
        authIndex: 'auth-2',
        sessionId: 's1',
        outcome: 'failure',
        traceId: 'trace-3',
        time: 125,
      })
      assert.deepEqual(reloaded.latest('s1'), {
        authIndex: 'auth-2',
        sessionId: 's1',
        provider: '',
        model: '',
        purpose: '',
        outcome: 'failure',
        traceId: 'trace-3',
        requestId: '',
        time: 125,
      })
      assert.deepEqual(reloaded.recent('s1').map(record => record.traceId), ['trace-3', 'trace-2', 'trace-1'])
      assert.deepEqual(reloaded.recentAll().map(record => record.traceId), ['trace-3', 'trace-2', 'trace-1'])

      const localUsage = reloaded.localUsage(123)
      assert.equal(localUsage.since, new Date(123).toISOString())
      assert.equal(localUsage.retainedRecords, 3)
      assert.deepEqual(localUsage.totals, {
        totalRequests: 3,
        successRequests: 2,
        failedRequests: 1,
        inputTokens: 11,
        outputTokens: 3,
        totalTokens: 14,
        successRate: 2 / 3,
      })
      assert.deepEqual(localUsage.models, [
        {
          modelId: 'unknown',
          totalRequests: 2,
          successRequests: 1,
          failedRequests: 1,
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
        {
          modelId: 'gpt-5',
          totalRequests: 1,
          successRequests: 1,
          failedRequests: 0,
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
        },
      ])

      assert.equal(sanitizeExecutionRecord({ time: 1 }), undefined)
      assert.equal(sanitizeExecutionRecord(null), undefined)
      const withQuota = sanitizeExecutionRecord({
        authIndex: 'auth-quota',
        sessionId: 's-quota',
        time: 1,
        quota: {
          provider: 'codex',
          observedAt: 2,
          windows: [
            { id: 'code-5h', label: '5h', remainingPercent: 25, resetAt: 3 },
            { id: '', label: 'dropped', remainingPercent: 10 },
          ],
        },
      })
      assert.deepEqual(withQuota?.quota, {
        provider: 'codex',
        observedAt: 2,
        windows: [{ id: 'code-5h', label: '5h', remainingPercent: 25, resetAt: 3 }],
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aggregateCpaUsage keeps per-account request, failure, and token totals', () => {
    const first = aggregateCpaUsage(null, {
      authIndex: 'auth-1',
      sessionId: 's1',
      traceId: 'trace-1',
      outcome: 'success',
      inputTokens: 10,
      outputTokens: 2,
    })
    assert.ok(first)
    const second = aggregateCpaUsage(first, {
      authIndex: 'auth-1',
      sessionId: 's1',
      traceId: 'trace-2',
      outcome: 'failure',
      inputTokens: 1,
      outputTokens: 1,
    })
    assert.ok(second)
    assert.equal(second.requests, 2)
    assert.equal(second.failed, 1)
    assert.equal(second.inputTokens, 11)
    assert.equal(second.outputTokens, 3)
    assert.equal(second.latest?.outcome, 'failure')
    assert.equal(second.latest?.inputTokens, 1)
    assert.equal(second.latest?.outputTokens, 1)
    assert.deepEqual(second.byAccount['auth-1'], {
      authIndex: 'auth-1',
      requests: 2,
      failed: 1,
      inputTokens: 11,
      outputTokens: 3,
    })
  })

  it('simpleProjectionSchema accepts the null empty state needed by history restore', () => {
    assert.equal(simpleProjectionSchema().parse(null), null)
    assert.deepEqual(simpleProjectionSchema().parse({ requests: 0 }), { requests: 0 })
    assert.throws(
      () => simpleProjectionSchema().parse([]),
      /cpaUsage projection must be an object or null/,
    )
  })
})
