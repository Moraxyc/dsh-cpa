import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  quotaFamily,
  quotaObservationFromHeaders,
  sanitizeQuotaObservation,
} from '../../lib/core/quota-headers.js'

const NOW = Date.parse('2026-10-30T16:28:41Z')

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('core/quota-headers', () => {
  it('reads Codex windows from response headers', () => {
    const observation = quotaObservationFromHeaders('gpt-5.6-sol', headers({
      'X-Codex-Primary-Used-Percent': '75',
      'X-Codex-Primary-Window-Minutes': '300',
      'X-Codex-Primary-Reset-After-Seconds': '5860',
      'X-Codex-Secondary-Used-Percent': '57',
      'X-Codex-Secondary-Window-Minutes': '10080',
      'X-Codex-Secondary-Reset-At': '1793775764',
    }), NOW)
    assert.ok(observation)
    assert.equal(observation.provider, 'codex')
    assert.equal(observation.observedAt, NOW)
    assert.deepEqual(observation.windows, [
      { id: 'code-5h', label: '5h', remainingPercent: 25, resetAt: NOW + 5_860_000 },
      { id: 'code-7d', label: '7d', remainingPercent: 43, resetAt: 1_793_775_764_000 },
    ])
  })

  it('reads Claude fraction utilization and epoch resets case-insensitively', () => {
    const observation = quotaObservationFromHeaders('anthropic/claude-opus-4-5', headers({
      'Anthropic-Ratelimit-Unified-5h-Utilization': '0.59',
      'anthropic-ratelimit-unified-5h-reset': '1793379600',
      'anthropic-ratelimit-unified-7d-utilization': '0.15',
    }), NOW)
    assert.ok(observation)
    assert.equal(observation.provider, 'claude')
    assert.deepEqual(observation.windows, [
      { id: 'claude-5h', label: '5h', remainingPercent: 41, resetAt: 1_793_379_600_000 },
      { id: 'claude-7d', label: '7d', remainingPercent: 85 },
    ])
  })

  it('ignores malformed values and clamps exhausted utilization', () => {
    assert.equal(quotaObservationFromHeaders('gpt-5', headers({
      'x-codex-primary-used-percent': 'NaN',
      authorization: 'synthetic',
    }), NOW), undefined)
    const claude = quotaObservationFromHeaders('claude-sonnet-4-5', headers({
      'anthropic-ratelimit-unified-5h-utilization': '1.1',
    }), NOW)
    assert.equal(claude?.windows[0]?.remainingPercent, 0)
    assert.equal(claude?.windows[0]?.resetAt, undefined)
  })

  it('still reads a present header family when the model id is from another family', () => {
    const observation = quotaObservationFromHeaders('deepseek/deepseek-flash', headers({
      'x-codex-primary-used-percent': '10',
      'x-codex-primary-window-minutes': '300',
    }), NOW)
    assert.equal(observation?.provider, 'codex')
    assert.equal(observation?.windows[0]?.remainingPercent, 90)
  })

  it('classifies model ids for header preference', () => {
    assert.equal(quotaFamily('gpt-6.1-sol'), 'codex')
    assert.equal(quotaFamily('codex-auto-review'), 'codex')
    assert.equal(quotaFamily('claude-opus-5'), 'claude')
    assert.equal(quotaFamily('gemini-3-pro'), undefined)
    assert.equal(quotaFamily('deepseek-v4-pro'), undefined)
  })

  it('sanitizes persisted observations', () => {
    assert.deepEqual(sanitizeQuotaObservation({
      provider: 'codex',
      observedAt: 123,
      windows: [
        { id: 'code-5h', label: '5h', remainingPercent: 130, resetAt: 456 },
        { id: '', label: 'bad', remainingPercent: 10 },
        { id: 'code-7d', label: '7d', remainingPercent: 5, resetAt: 'nope' },
      ],
    }), {
      provider: 'codex',
      observedAt: 123,
      windows: [
        { id: 'code-5h', label: '5h', remainingPercent: 100, resetAt: 456 },
        { id: 'code-7d', label: '7d', remainingPercent: 5 },
      ],
    })
    assert.equal(sanitizeQuotaObservation({ provider: 'codex', observedAt: 0, windows: [] }), undefined)
    assert.equal(sanitizeQuotaObservation({ provider: '', observedAt: 1, windows: [] }), undefined)
    assert.equal(sanitizeQuotaObservation(null), undefined)
  })
})
