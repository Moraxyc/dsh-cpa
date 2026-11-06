import type * as React from 'react'
import type { CpaAccountPublic, ExecutionRecord } from './wire.js'
import { clientRuntime } from './runtime.js'
import {
  accountCore,
  accountLabel,
  accountStatus,
  executionTimeline,
  fallbackReasonLabel,
  planLabel,
  positiveCount,
  preferredWindow,
  providerLabel,
  reportWindows,
  resolveAccount,
  routeIssueLabel,
  sourceLabel,
  windowPercent,
} from './format.js'
import type { AccountView, QuotaMap } from './format.js'

export type ReadoutTone = '' | 'warn' | 'error'

export interface ReadoutPresentation {
  account: AccountView | undefined
  full: string
  headline: string
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

export function readoutAccount(
  accounts: readonly CpaAccountPublic[],
  execution: ExecutionRecord | null | undefined,
): AccountView | undefined {
  const resolved = resolveAccount(accounts, execution)
  if (resolved !== undefined) return resolved
  if (execution !== null && execution !== undefined) return undefined
  return accounts.length === 1 ? accounts[0] : undefined
}

export function readoutTone(
  account: AccountView | undefined,
  quota: QuotaMap | undefined,
  execution: ExecutionRecord | null | undefined,
): ReadoutTone {
  if (execution?.outcome === 'failure' || execution?.preflightStatus === 'blocked') return 'error'
  if (account !== undefined
    && (account.disabled === true || account.unavailable === true || accountStatus(account) !== '')) {
    return 'error'
  }
  const window = preferredWindow(reportWindows(quota, account?.authIndex))
  if (window === undefined) return ''
  const percent = windowPercent(window)
  if (window.risk === 'critical' || (percent !== null && percent <= 0)) return 'error'
  if (window.risk === 'warning' || (percent !== null && percent <= 20)) return 'warn'
  return ''
}

export function readoutPresentation(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
  execution: ExecutionRecord | null | undefined,
): ReadoutPresentation {
  const account = readoutAccount(accounts, execution)
  const provider = providerLabel(account?.provider) || providerLabel(execution?.provider)
  const plan = planLabel(account)
  const label = accountLabel(account)
  const status = accountStatus(account)
  let primary = [provider, plan].filter(Boolean).join(' ')
  if (primary === '' && execution !== null && execution !== undefined && execution.model !== '') {
    primary = execution.model
  }
  if (primary === '') {
    primary = accounts.length > 1 ? `${accounts.length} 账号` : 'CPA'
  }
  const window = preferredWindow(reportWindows(quota, account?.authIndex))
  const percent = windowPercent(window)
  const quotaText = window !== undefined && percent !== null
    ? `${window.label} ${Math.round(percent)}%`
    : ''
  let secondary = ''
  if (execution?.outcome === 'failure') {
    secondary = '失败'
  } else if (status !== '') {
    secondary = status
  } else if (execution?.fallbackFrom !== undefined && execution.fallbackFrom !== '') {
    secondary = '已切换'
  } else if (quotaText !== '') {
    secondary = quotaText
  } else if (execution === null || execution === undefined) {
    const unavailable = accounts.filter(item => item.unavailable).length
    const disabled = accounts.filter(item => item.disabled).length
    secondary = [
      unavailable > 0 ? `${unavailable} 不可用` : '',
      disabled > 0 ? `${disabled} 停用` : '',
    ].filter(Boolean).join(' · ')
  }
  const failed = Math.max(positiveCount(account?.failed), execution?.outcome === 'failure' ? 1 : 0)
  const fullParts = ['CPA']
  if (primary !== 'CPA') fullParts.push(primary)
  if (secondary !== '') fullParts.push(secondary)
  if (quotaText !== '' && !fullParts.includes(quotaText)) fullParts.push(quotaText)
  if (label !== '' && label !== primary && !fullParts.includes(label)) fullParts.push(label)
  if (status !== '' && secondary !== status) fullParts.push(status)
  if (failed > 0 && !fullParts.some(part => part.includes('失败'))) fullParts.push(`失败 ${failed}`)
  if (execution?.fallbackFrom !== undefined && execution.fallbackFrom !== '' && !secondary.includes('切换')) {
    fullParts.push(`已切换至 ${execution.model === '' ? '未知模型' : execution.model}`)
  }
  return {
    account,
    full: fullParts.join(' · '),
    headline: quotaText !== '' ? quotaText : secondary,
    primary,
    secondary,
    tone: readoutTone(account, quota, execution),
  }
}

export function quotaDetailRows(quota: QuotaMap | undefined, authIndex: string | undefined): DetailRow[] {
  const rows: DetailRow[] = []
  for (const window of reportWindows(quota, authIndex)) {
    const percent = windowPercent(window)
    if (percent === null) continue
    const reset = window.resetLabel !== '' ? ` · 重置 ${window.resetLabel}` : ''
    const tone: ReadoutTone = window.risk === 'critical' || percent <= 0
      ? 'error'
      : window.risk === 'warning' || percent <= 20 ? 'warn' : ''
    rows.push({
      label: window.label === '' ? '额度' : `额度 ${window.label}`,
      value: `${Math.round(percent)}%${reset}`,
      tone,
    })
  }
  return rows
}

export function accountDetailRows(
  account: AccountView,
  quota: QuotaMap | undefined,
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
  rows.push(...quotaDetailRows(quota, account.authIndex))
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

export function accountsDetailRows(
  accounts: readonly CpaAccountPublic[],
  quota: QuotaMap | undefined,
): DetailRow[] {
  const rows: DetailRow[] = []
  for (const [index, account] of accounts.entries()) {
    const label = accountLabel(account) || `账号 ${index + 1}`
    const core = accountCore(account)
    rows.push({ label, value: core === '' ? '—' : core, wide: label.length > 24 })
    const quotaRows = quotaDetailRows(quota, account.authIndex)
    if (quotaRows.length > 0) {
      rows.push({
        label: '额度',
        value: quotaRows
          .map(row => `${row.label.replace(/^额度\s*/u, '')} ${String(row.value)}`.trim())
          .join(' · '),
        tone: quotaRows.some(row => row.tone === 'error')
          ? 'error'
          : quotaRows.some(row => row.tone === 'warn') ? 'warn' : '',
        wide: true,
      })
    }
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
): DetailGroup[] {
  const groups: DetailGroup[] = []
  const account = readoutAccount(accounts, execution)
  if (account !== undefined) {
    const rows = accountDetailRows(account, quota, execution)
    if (rows.length > 0) groups.push({ title: '账号', rows })
  } else if (execution === null || execution === undefined) {
    const rows = accountsDetailRows(accounts, quota)
    if (rows.length > 0) groups.push({ title: '账号', rows })
  }
  if (execution !== null && execution !== undefined) {
    const executionRows = executionDetailRows(execution, executions, account)
    if (executionRows.length > 0) groups.push({ title: '执行', rows: executionRows })
  }
  return groups
}
