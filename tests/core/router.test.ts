import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { planCpaRoute, selectCpaModels } from '../../lib/core/router.js'
import type { CpaRouteOptions, CpaRouteSnapshot } from '../../lib/core/router.js'

const SMALL_REQUEST: CpaRouteOptions = {
  model: 'requested',
  messages: [],
  reasoningEffort: undefined,
  maxTokens: 1024,
}

const TWO_MODELS = [
  { id: 'low-quota', contextLength: 16_384 },
  { id: 'healthy', contextLength: 16_384 },
]

describe('core/router', () => {
  it('selectCpaModels keeps the requested model first and prefers healthy quota candidates', () => {
    const snapshot: CpaRouteSnapshot = {
      models: TWO_MODELS,
      accounts: [
        { authIndex: 'low', modelAliases: ['low-quota'] },
        { authIndex: 'high', modelAliases: ['healthy'] },
      ],
      quota: {
        low: {
          status: 'low',
          windows: [{ id: 'low-quota', label: 'low-quota', remainingPercent: 10, exhausted: false }],
        },
        high: {
          status: 'high',
          windows: [{ id: 'healthy', label: 'healthy', remainingPercent: 90, exhausted: false }],
        },
      },
      defaultContextWindow: 16_384,
      defaultMaxTokens: 1024,
    }
    assert.deepEqual(selectCpaModels(SMALL_REQUEST, snapshot), ['requested', 'healthy', 'low-quota'])
  })

  it('planCpaRoute explains quota risk and preflight issues', () => {
    const plan = planCpaRoute({
      model: 'requested',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      reasoningEffort: undefined,
      maxTokens: 1024,
    }, {
      models: [
        { id: 'requested', contextLength: 16_384 },
        { id: 'fallback', contextLength: 16_384 },
      ],
      accounts: [
        { authIndex: 'exhausted', modelAliases: ['requested'] },
        { authIndex: 'healthy', modelAliases: ['fallback'], success: 4 },
      ],
      quota: {
        exhausted: {
          status: 'exhausted',
          windows: [{ id: 'requested', label: 'requested', remainingPercent: 0, exhausted: true }],
        },
        healthy: {
          status: 'high',
          windows: [{ id: 'fallback', label: 'fallback', remainingPercent: 80, exhausted: false }],
        },
      },
      defaultContextWindow: 16_384,
      defaultMaxTokens: 1024,
    })

    assert.deepEqual(plan.models, ['requested', 'fallback'])
    assert.equal(plan.preflight.status, 'warning')
    assert.deepEqual(plan.preflight.issues.map(issue => issue.code), ['QUOTA_EXHAUSTED'])
    assert.deepEqual(plan.candidates.find(candidate => candidate.model === 'fallback'), {
      model: 'fallback',
      eligible: true,
      remainingPercent: 80,
      priority: 0,
      health: 'healthy',
      reasons: ['quota-available'],
    })
  })
})
