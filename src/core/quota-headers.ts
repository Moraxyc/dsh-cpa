import { isJsonRecord, isNonEmptyString, isNumber } from './json.js'
import type { JsonValue } from './json.js'

/**
 * A quota window seen in an inference response. `remainingPercent` is the
 * share left, not the share used. `resetAt` is epoch milliseconds.
 */
export type CpaQuotaWindowObservation = {
  id: string
  label: string
  remainingPercent: number
  resetAt?: number
}

/** Quota from one upstream response, describing the account that served it. */
export type CpaQuotaObservation = {
  provider: string
  windows: CpaQuotaWindowObservation[]
  observedAt: number
}

type Family = 'codex' | 'claude'

const MAX_WINDOWS = 8
const MAX_LABEL = 40

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

export function quotaFamily(model: string): Family | undefined {
  if (/(^|[/:_-])(?:gpt|codex)(?:[./_-]|$)/i.test(model)) return 'codex'
  if (/(^|[/:_-])claude(?:[./_-]|$)/i.test(model)) return 'claude'
  return undefined
}

function headerMap(headers: Headers): Map<string, string> {
  const map = new Map<string, string>()
  headers.forEach((value, key) => map.set(key.toLowerCase(), value))
  return map
}

function readNumber(signals: ReadonlyMap<string, string>, name: string): number | undefined {
  const value = signals.get(name)
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function durationLabel(minutes: number | undefined): string {
  if (minutes === undefined || minutes <= 0) return '额度'
  const seconds = minutes * 60
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  return `${minutes}m`
}

function codexWindowId(name: 'primary' | 'secondary', minutes: number | undefined): string {
  if (minutes === 300) return 'code-5h'
  if (minutes === 10_080) return 'code-7d'
  return `code-${minutes === undefined ? name : `${minutes}m`}`
}

function codexWindows(signals: ReadonlyMap<string, string>, now: number): CpaQuotaWindowObservation[] {
  const windows: CpaQuotaWindowObservation[] = []
  for (const name of ['primary', 'secondary'] as const) {
    const prefix = `x-codex-${name}-`
    const used = readNumber(signals, `${prefix}used-percent`)
    if (used === undefined) continue
    const minutes = readNumber(signals, `${prefix}window-minutes`)
    const resetAtSeconds = readNumber(signals, `${prefix}reset-at`)
    const resetAfter = readNumber(signals, `${prefix}reset-after-seconds`)
    const resetAt = resetAtSeconds !== undefined && resetAtSeconds > 0
      ? resetAtSeconds * 1_000
      : resetAfter !== undefined
        ? now + resetAfter * 1_000
        : undefined
    const window: CpaQuotaWindowObservation = {
      id: codexWindowId(name, minutes),
      label: durationLabel(minutes),
      remainingPercent: clampPercent(100 - used),
    }
    if (resetAt !== undefined) window.resetAt = resetAt
    windows.push(window)
  }
  return windows
}

function claudeWindows(signals: ReadonlyMap<string, string>): CpaQuotaWindowObservation[] {
  const windows: CpaQuotaWindowObservation[] = []
  for (const label of ['5h', '7d'] as const) {
    const used = readNumber(signals, `anthropic-ratelimit-unified-${label}-utilization`)
    if (used === undefined) continue
    const resetAtSeconds = readNumber(signals, `anthropic-ratelimit-unified-${label}-reset`)
    const window: CpaQuotaWindowObservation = {
      id: `claude-${label}`,
      label,
      // Anthropic reports utilization as a 0..1 fraction.
      remainingPercent: clampPercent(100 - used * 100),
    }
    if (resetAtSeconds !== undefined && resetAtSeconds > 0) window.resetAt = resetAtSeconds * 1_000
    windows.push(window)
  }
  return windows
}

/**
 * Parse quota headers from one inference response. The model family only picks
 * which header set is tried first. The other set still counts, because a CPA
 * account can serve a model from another family.
 */
export function quotaObservationFromHeaders(
  model: string,
  headers: Headers,
  now = Date.now(),
): CpaQuotaObservation | undefined {
  const signals = headerMap(headers)
  const preferred = quotaFamily(model)
  const families: readonly Family[] = preferred === 'claude'
    ? ['claude', 'codex']
    : ['codex', 'claude']
  for (const family of families) {
    const windows = family === 'claude' ? claudeWindows(signals) : codexWindows(signals, now)
    if (windows.length > 0) return { provider: family, windows, observedAt: now }
  }
  return undefined
}

export function sanitizeQuotaObservation(value: JsonValue | undefined): CpaQuotaObservation | undefined {
  if (!isJsonRecord(value)) return undefined
  const provider = isNonEmptyString(value.provider) ? value.provider.slice(0, MAX_LABEL) : ''
  const observedAt = isNumber(value.observedAt) && value.observedAt > 0 ? value.observedAt : 0
  if (provider === '' || observedAt === 0 || !Array.isArray(value.windows)) return undefined
  const windows: CpaQuotaWindowObservation[] = []
  for (const entry of value.windows.slice(0, MAX_WINDOWS)) {
    if (!isJsonRecord(entry)) continue
    const id = isNonEmptyString(entry.id) ? entry.id.slice(0, MAX_LABEL) : ''
    const label = isNonEmptyString(entry.label) ? entry.label.slice(0, MAX_LABEL) : ''
    const remaining = isNumber(entry.remainingPercent) ? clampPercent(entry.remainingPercent) : undefined
    if (id === '' || label === '' || remaining === undefined) continue
    const window: CpaQuotaWindowObservation = { id, label, remainingPercent: remaining }
    if (isNumber(entry.resetAt) && entry.resetAt > 0) window.resetAt = entry.resetAt
    windows.push(window)
  }
  return windows.length === 0 ? undefined : { provider, windows, observedAt }
}
