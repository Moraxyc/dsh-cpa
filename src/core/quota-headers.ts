import { isJsonRecord, isNonEmptyString, isNumber, isString } from './json.js'
import type { JsonRecord, JsonValue } from './json.js'
import type { CpaQuotaObservation, CpaQuotaWindowObservation } from './wire.js'

export type { CpaQuotaObservation, CpaQuotaWindowObservation } from './wire.js'

export type QuotaSignalWindow = CpaQuotaWindowObservation & {
  exhausted: boolean
}

export type QuotaFamily = 'codex' | 'claude'

const MAX_WINDOWS = 8
const MAX_LABEL = 40

function clampPercent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

export function quotaFamily(model: string): QuotaFamily | undefined {
  if (/(^|[/:_-])(?:gpt|codex)(?:[./_-]|$)/i.test(model)) return 'codex'
  if (/(^|[/:_-])claude(?:[./_-]|$)/i.test(model)) return 'claude'
  return undefined
}

export function signalMapFromHeaders(headers: Headers): Map<string, string> {
  const map = new Map<string, string>()
  headers.forEach((value, key) => map.set(key.toLowerCase(), value))
  return map
}

export function signalMapFromRecord(record: JsonRecord): Map<string, JsonValue | undefined> {
  const map = new Map<string, JsonValue | undefined>()
  for (const [key, value] of Object.entries(record)) {
    map.set(key.toLowerCase(), value)
  }
  return map
}

function readNumber(signals: ReadonlyMap<string, JsonValue | undefined>, name: string): number | undefined {
  const value = signals.get(name)
  if (value === undefined || value === null) return undefined
  if (isString(value) && value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function readTimestampMs(signals: ReadonlyMap<string, JsonValue | undefined>, name: string): number | undefined {
  const numeric = readNumber(signals, name)
  if (numeric !== undefined && numeric > 0) return numeric * 1_000
  const raw = signals.get(name)
  if (isString(raw) && raw.trim() !== '') {
    const parsed = Date.parse(raw.trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
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

function codexWindows(signals: ReadonlyMap<string, JsonValue | undefined>, now: number): QuotaSignalWindow[] {
  const limitReached = String(signals.get('x-codex-limit-reached') ?? '').toLowerCase() === 'true'
    || String(signals.get('x-codex-allowed') ?? '').toLowerCase() === 'false'
  const windows: QuotaSignalWindow[] = []
  for (const name of ['primary', 'secondary'] as const) {
    const prefix = `x-codex-${name}-`
    const used = readNumber(signals, `${prefix}used-percent`)
    if (used === undefined) continue
    const minutes = readNumber(signals, `${prefix}window-minutes`)
    const resetAtMs = readTimestampMs(signals, `${prefix}reset-at`)
    const resetAfter = readNumber(signals, `${prefix}reset-after-seconds`)
    const resetAt = resetAtMs !== undefined
      ? resetAtMs
      : resetAfter !== undefined
        ? now + resetAfter * 1_000
        : undefined
    const remainingPercent = clampPercent(100 - used)
    const window: QuotaSignalWindow = {
      id: codexWindowId(name, minutes),
      label: durationLabel(minutes),
      remainingPercent,
      exhausted: remainingPercent <= 0 || (limitReached && resetAt !== undefined && resetAt > 0),
    }
    if (resetAt !== undefined) window.resetAt = resetAt
    windows.push(window)
  }
  return windows
}

function claudeWindows(signals: ReadonlyMap<string, JsonValue | undefined>): QuotaSignalWindow[] {
  const windows: QuotaSignalWindow[] = []
  for (const label of ['5h', '7d'] as const) {
    const used = readNumber(signals, `anthropic-ratelimit-unified-${label}-utilization`)
    if (used === undefined) continue
    const resetAt = readTimestampMs(signals, `anthropic-ratelimit-unified-${label}-reset`)
    const remainingPercent = clampPercent(100 - used * 100)
    const window: QuotaSignalWindow = {
      id: `claude-${label}`,
      label,
      // Anthropic reports utilization as a 0..1 fraction.
      remainingPercent,
      exhausted: remainingPercent <= 0,
    }
    if (resetAt !== undefined) window.resetAt = resetAt
    windows.push(window)
  }
  return windows
}

export function parseQuotaSignalWindows(
  family: QuotaFamily,
  signals: ReadonlyMap<string, JsonValue | undefined>,
  now = Date.now(),
): QuotaSignalWindow[] {
  return family === 'claude' ? claudeWindows(signals) : codexWindows(signals, now)
}

/** Parses quota headers across provider families; the serving account may differ from `model`. */
export function quotaObservationFromHeaders(
  model: string,
  headers: Headers,
  now = Date.now(),
): CpaQuotaObservation | undefined {
  const signals = signalMapFromHeaders(headers)
  const preferred = quotaFamily(model)
  const families: readonly QuotaFamily[] = preferred === 'claude'
    ? ['claude', 'codex']
    : ['codex', 'claude']
  for (const family of families) {
    const windows = parseQuotaSignalWindows(family, signals, now)
    if (windows.length > 0) {
      return {
        provider: family,
        windows: windows.map(({ exhausted: _exhausted, ...window }) => window),
        observedAt: now,
      }
    }
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
