import type * as React from 'react'
import type {
  CpaAccountPublic,
  ExecutionRecord,
  QuotaObservation,
  QuotaRisk,
  QuotaWindow,
} from './wire.js'
import { clientRuntime } from './runtime.js'
import {
  accountLabel,
  accountStatus,
  executionTimeline,
  fallbackReasonLabel,
  planLabel,
  positiveCount,
  providerFamily,
  providerFromModel,
  providerLabel,
  reportWindows,
  resolveAccount,
  routeIssueLabel,
  sourceLabel,
  windowPercent,
} from './format.js'
import type { AccountView, QuotaMap } from './format.js'

export type ReadoutTone = '' | 'warn' | 'error'
export type ReadoutMode = 'quota' | 'model'

/** Show the weekly window only at or below this remaining percent. */
export const WEEKLY_WINDOW_REVEAL_PERCENT = 20

export interface ModelSelectionLike {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** Wire view of the session's `modelSelection` projection. */
export interface SessionModelSelection {
  lastUsed: ModelSelectionLike | null
  next: ModelSelectionLike | null
}

export interface ReadoutPresentation {
  account: AccountView | undefined
  full: string
  headline: string
  mode: ReadoutMode
  primary: string
  secondary: string
  tone: ReadoutTone
}

export interface DetailRow {
  label: string
  value: React.ReactNode
  tone?: ReadoutTone
  wide?: boolean
}

export interface DetailGroup {
  title: string
  rows: DetailRow[]
}

export function activeSelection(selection: SessionModelSelection | undefined): ModelSelectionLike | undefined {
  return selection?.next ?? selection?.lastUsed ?? undefined
}

function toneRank(tone: ReadoutTone): number {
  return tone === 'error' ? 2 : tone === 'warn' ? 1 : 0
}

function worstTone(...tones: ReadoutTone[]): ReadoutTone {
  let worst: ReadoutTone = ''
  for (const tone of tones) {
    if (toneRank(tone) > toneRank(worst)) worst = tone
  }
  return worst
}

function windowTone(window: QuotaWindow): ReadoutTone {
  const percent = windowPercent(window)
  if (window.risk === 'critical' || window.exhausted || (percent !== null && percent <= 5)) return 'error'
  if (window.risk === 'warning' || (percent !== null && percent <= 20)) return 'warn'
  return ''
}

function accountRank(account: AccountView): number {
  const unavailable = account.disabled === true
    || account.unavailable === true
    || accountStatus(account) !== ''
  const rawPriority = Number(account.priority ?? 0)
  const priority = Number.isFinite(rawPriority) ? rawPriority : 0
  const success = positiveCount(account.success)
  return (unavailable ? 0 : 1_000_000) + priority * 1_000 + Math.min(success, 999)
}

/**
 * Pick the account this session is most likely using. A recorded execution
 * names the serving account. Otherwise the model's provider family narrows the list,
 * and accounts that report quota win.
 */
export function readoutAccount(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
  execution: ExecutionRecord | null | undefined,
  model: string,
): AccountView | undefined {
  const resolved = resolveAccount(accounts, execution)
  if (resolved?.authIndex !== undefined && resolved.authIndex !== '') return resolved
  if (execution === null || execution === undefined) {
    if (accounts.length === 1) return accounts[0]
    return familyAccount(accounts, quota, model)
  }
  return familyAccount(accounts, quota, model) ?? resolved
}

function familyAccount(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
  model: string,
): AccountView | undefined {
  const family = providerFamily(providerFromModel(model))
  if (family === '') return undefined
  const candidates = accounts.filter(account => providerFamily(account.provider) === family)
  if (candidates.length === 0) return undefined
  const usable = candidates.filter(account => account.disabled !== true
    && account.unavailable !== true
    && accountStatus(account) === '')
  const pool = usable.length > 0 ? usable : candidates
  const withQuota = pool.filter(account => reportWindows(quota, account.authIndex).length > 0)
  const preferred = withQuota.length > 0 ? withQuota : pool
  return [...preferred].sort((left, right) => accountRank(right) - accountRank(left))[0]
}

/** Currently used quota windows: 5h always, 7d only while it is low. */
export function displayedQuotaWindows(windows: readonly QuotaWindow[]): QuotaWindow[] {
  const valued = windows.filter(window => windowPercent(window) !== null)
  if (valued.length === 0) return []
  const fiveHour = valued.find(window => window.id === 'code-5h' || window.label === '5h')
  const weekly = valued.find(window => window.id === 'code-7d' || window.label === '7d')
  if (fiveHour !== undefined || weekly !== undefined) {
    const primary = fiveHour ?? weekly
    if (primary === undefined) return []
    const weeklyPercent = windowPercent(weekly)
    const revealWeekly = weekly !== undefined
      && weekly !== primary
      && weeklyPercent !== null
      && weeklyPercent <= WEEKLY_WINDOW_REVEAL_PERCENT
    return revealWeekly ? [primary, weekly] : [primary]
  }
  let tightest: QuotaWindow | undefined
  for (const window of valued) {
    const percent = windowPercent(window)
    if (percent === null) continue
    const current = windowPercent(tightest)
    if (tightest === undefined || current === null || percent < current) tightest = window
  }
  return tightest === undefined ? [] : [tightest]
}

export function windowReading(window: QuotaWindow): string {
  const percent = windowPercent(window)
  if (percent === null) return ''
  return `${shortWindowLabel(window.label)} ${Math.round(percent)}%`
}

function shortWindowLabel(label: string): string {
  const trimmed = label.trim()
  if (trimmed === '') return '额度'
  return trimmed.replace(/^Gemini\s+/i, '').replace(/\s+Series$/i, '') || trimmed
}

function quotaRisk(percent: number): QuotaRisk {
  if (percent <= 5) return 'critical'
  if (percent <= 20) return 'warning'
  return 'normal'
}

function observedResetLabel(resetAt: number | undefined): string {
  if (resetAt === undefined || !Number.isFinite(resetAt)) return ''
  const date = new Date(resetAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Turn response-header observations into display windows, dropping resets already past. */
export function observationWindows(
  observation: QuotaObservation | undefined,
  now = Date.now(),
): QuotaWindow[] {
  if (observation === undefined) return []
  const windows: QuotaWindow[] = []
  for (const window of observation.windows) {
    if (window.resetAt !== undefined && window.resetAt <= now) continue
    const percent = Math.min(100, Math.max(0, window.remainingPercent))
    windows.push({
      id: window.id,
      label: window.label,
      remainingPercent: percent,
      resetLabel: observedResetLabel(window.resetAt),
      exhausted: percent <= 0,
      risk: quotaRisk(percent),
    })
  }
  return windows
}

/**
 * Response headers describe the account that just served a request, so they
 * win while they are newer than the management snapshot and still in-window.
 */
export function currentQuotaWindows(
  execution: ExecutionRecord | null | undefined,
  quota: QuotaMap | undefined,
  authIndex: string | undefined,
  now = Date.now(),
): readonly QuotaWindow[] {
  const observed = observationWindows(execution?.quota, now)
  const report = reportWindows(quota, authIndex)
  if (observed.length === 0) return report
  if (report.length === 0) return observed
  const observedAt = execution?.quota?.observedAt ?? 0
  const reportAt = Date.parse(quota?.[authIndex ?? '']?.refreshedAt ?? '')
  return Number.isFinite(reportAt) && reportAt > observedAt ? report : observed
}

export function readoutPresentation(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
  execution: ExecutionRecord | null | undefined,
  selection: SessionModelSelection | undefined,
): ReadoutPresentation {
  const chosen = activeSelection(selection)
  const selectedModel = chosen?.model?.trim() ?? ''
  const model = selectedModel !== '' ? selectedModel : execution?.model?.trim() ?? ''
  const account = readoutAccount(accounts, quota, execution, model)
  const windows = displayedQuotaWindows(currentQuotaWindows(execution, quota, account?.authIndex))
  const mode: ReadoutMode = windows.length > 0 ? 'quota' : 'model'
  const primary = windows[0] === undefined ? model : windowReading(windows[0])
  const secondary = windows[1] === undefined ? '' : windowReading(windows[1])
  const status = accountStatus(account)
  const failed = execution?.outcome === 'failure' || execution?.preflightStatus === 'blocked'
  const tone = worstTone(
    failed ? 'error' : '',
    status !== '' ? 'error' : '',
    ...windows.map(windowTone),
  )
  const fullParts: string[] = []
  if (mode === 'quota') {
    for (const window of windows) {
      const percent = windowPercent(window)
      fullParts.push(`${window.label === '' ? '额度' : window.label} 剩余 ${Math.round(percent ?? 0)}%`)
    }
  } else if (model !== '') {
    fullParts.push(`模型 ${model}`)
  }
  if (status !== '') fullParts.push(status)
  if (failed) fullParts.push('最近请求失败')
  if (execution?.fallbackFrom !== undefined && execution.fallbackFrom !== '') {
    fullParts.push(`已切换至 ${execution.model === '' ? '未知模型' : execution.model}`)
  }
  return {
    account,
    full: fullParts.join(' · '),
    headline: [primary, secondary].filter(Boolean).join(' · '),
    mode,
    primary,
    secondary,
    tone,
  }
}

export function quotaDetailRows(windows: readonly QuotaWindow[]): DetailRow[] {
  const rows: DetailRow[] = []
  for (const window of windows) {
    const percent = windowPercent(window)
    if (percent === null) continue
    const reset = window.resetLabel !== '' ? ` · 重置 ${window.resetLabel}` : ''
    rows.push({
      label: window.label === '' ? '额度' : window.label,
      value: `${Math.round(percent)}%${reset}`,
      tone: windowTone(window),
    })
  }
  return rows
}

export function accountDetailRows(
  account: AccountView,
  execution: ExecutionRecord | null | undefined,
): DetailRow[] {
  const rows: DetailRow[] = []
  const label = accountLabel(account)
  if (label !== '') rows.push({ label: '账号', value: label, wide: label.length > 24 })
  const provider = providerLabel(account.provider) || providerLabel(execution?.provider)
  const plan = planLabel(account)
  if (provider !== '' || plan !== '') {
    rows.push({ label: '服务商', value: [provider, plan].filter(Boolean).join(' ') })
  }
  const status = accountStatus(account)
  if (status !== '') rows.push({ label: '状态', value: status, tone: 'error' })
  const success = positiveCount(account.success)
  const failed = positiveCount(account.failed)
  if (success > 0 || failed > 0) {
    rows.push({ label: '账号用量', value: `成功 ${success} · 失败 ${failed}` })
  }
  const source = sourceLabel(account)
  if (source !== '') rows.push({ label: '来源', value: source })
  if (account.authIndex !== undefined && account.authIndex !== '') {
    rows.push({ label: '认证', value: account.authIndex, wide: account.authIndex.length > 24 })
  }
  if (account.baseUrl !== undefined && account.baseUrl !== '') {
    rows.push({ label: 'Base URL', value: account.baseUrl, wide: true })
  }
  if (account.prefix !== undefined && account.prefix !== '') {
    rows.push({ label: '前缀', value: account.prefix, wide: account.prefix.length > 24 })
  }
  if (account.priority !== undefined) {
    rows.push({ label: '优先级', value: String(account.priority) })
  }
  if (account.statusMessage !== undefined && account.statusMessage !== '') {
    rows.push({ label: '状态消息', value: account.statusMessage, wide: true })
  }
  if (account.modelAliases !== undefined && account.modelAliases.length > 0) {
    rows.push({ label: '模型别名', value: account.modelAliases.join('、'), wide: true })
  }
  if (account.websockets === true) rows.push({ label: 'WebSocket', value: '开启' })
  if (account.lastRefresh !== undefined && account.lastRefresh !== '') {
    rows.push({ label: '刷新时间', value: account.lastRefresh })
  }
  if (account.nextRetryAfter !== undefined && account.nextRetryAfter !== '') {
    rows.push({ label: '重试时间', value: account.nextRetryAfter })
  }
  if (account.note !== undefined && account.note !== '') {
    rows.push({ label: '备注', value: account.note, wide: true })
  }
  return rows
}

export function executionDetailRows(
  execution: ExecutionRecord,
  executions: readonly ExecutionRecord[] | undefined,
  account: AccountView | undefined,
): DetailRow[] {
  const rows: DetailRow[] = []
  if (execution.outcome !== '') {
    rows.push({
      label: '结果',
      value: execution.outcome === 'success' ? '成功' : '失败',
      tone: execution.outcome === 'success' ? '' : 'error',
    })
  }
  const executionProvider = providerLabel(execution.provider)
  const accountProvider = account === undefined
    ? ''
    : providerLabel(account.provider) || providerLabel(execution.provider)
  if (executionProvider !== '' && accountProvider !== executionProvider) {
    rows.push({ label: '服务商', value: executionProvider })
  }
  if (execution.model !== '') {
    rows.push({ label: '模型', value: execution.model, wide: true })
  }
  if (execution.requestedModel !== undefined
    && execution.requestedModel !== ''
    && execution.requestedModel !== execution.model) {
    rows.push({ label: '原始模型', value: execution.requestedModel, wide: true })
  }
  if (execution.fallbackFrom !== undefined && execution.fallbackFrom !== '') {
    rows.push({
      label: '自动切换',
      value: `${execution.fallbackFrom} → ${execution.model === '' ? '未知' : execution.model} · ${fallbackReasonLabel(execution.fallbackReason)}`,
      tone: 'warn',
      wide: true,
    })
  }
  const accountAuthIndex = account?.authIndex
  if (execution.authIndex !== undefined
    && execution.authIndex !== ''
    && (accountAuthIndex === undefined || accountAuthIndex !== execution.authIndex)) {
    rows.push({ label: '认证', value: execution.authIndex, wide: execution.authIndex.length > 24 })
  }
  if (execution.purpose !== '') {
    rows.push({ label: '用途', value: execution.purpose })
  }
  if (execution.preflightStatus !== undefined && execution.preflightStatus !== 'ready') {
    const issues = execution.preflightIssues?.map(routeIssueLabel).join('、') ?? ''
    rows.push({
      label: '请求预检',
      value: `${execution.preflightStatus === 'blocked' ? '阻断' : '有风险'}${issues === '' ? '' : ` · ${issues}`}`,
      tone: execution.preflightStatus === 'blocked' ? 'error' : 'warn',
      wide: true,
    })
  }
  if (execution.route !== undefined && execution.route.length > 1) {
    rows.push({ label: '候选路由', value: execution.route.join(' → '), wide: true })
  }
  const timeline = executionTimeline(executions)
  if (timeline !== '') rows.push({ label: '执行链路', value: timeline, wide: true })
  if (execution.traceId !== '') {
    rows.push({ label: 'Trace', value: execution.traceId, wide: true })
  }
  if (execution.requestId !== '') {
    const React = clientRuntime().React
    rows.push({
      label: 'Request',
      wide: true,
      value: React.createElement('span', { className: 'dsh-cpa-dialog-request' },
        execution.requestId,
        React.createElement('a', {
          href: `/dsh-cpa/management/v8/management/observability/logs/requests/${encodeURIComponent(execution.requestId)}`,
          target: '_blank',
          rel: 'noreferrer',
        }, '查看日志'),
      ),
    })
  }
  return rows
}

export function detailGroups(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
  execution: ExecutionRecord | null | undefined,
  executions: readonly ExecutionRecord[] | undefined,
  selection: SessionModelSelection | undefined,
): DetailGroup[] {
  const groups: DetailGroup[] = []
  const chosen = activeSelection(selection)
  const model = chosen?.model?.trim() || execution?.model?.trim() || ''
  const account = readoutAccount(accounts, quota, execution, model)
  const quotaRows = quotaDetailRows(currentQuotaWindows(execution, quota, account?.authIndex))
  if (quotaRows.length > 0) groups.push({ title: '额度', rows: quotaRows })
  if (account !== undefined) {
    const rows = accountDetailRows(account, execution)
    if (rows.length > 0) groups.push({ title: '账号', rows })
  }
  if (execution !== null && execution !== undefined) {
    const executionRows = executionDetailRows(execution, executions, account)
    if (executionRows.length > 0) groups.push({ title: '执行', rows: executionRows })
  }
  return groups
}
