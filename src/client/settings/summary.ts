import type * as React from 'react'
import type {
  CpaAccountSummary,
  CpaConfig,
  CpaSummary,
  CpaSummaryError,
  UsageModel,
} from '../wire.js'
import { fetchCpaSummary, MAX_SUMMARY_MODELS, SUMMARY_REFRESH_MS } from '../api.js'
import { accountLabel, accountStatus, labelMentionsProvider, providerLabel, sourceLabel } from '../format.js'
import { clientRuntime } from '../runtime.js'

interface SummaryItem {
  label: string
  value: string
}

export interface CpaDataSummaryProps {
  active: boolean
  managementAvailable: boolean
}

function formatSummaryNumber(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString()
}

function formatSuccessRate(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

function configSummaryItems(config: CpaConfig): SummaryItem[] {
  const items: SummaryItem[] = []
  if (config.routingStrategy !== '') {
    items.push({ label: '路由策略', value: config.routingStrategy })
  }
  if (config.proxyUrl !== '') {
    items.push({ label: '代理', value: config.proxyUrl })
  }
  if (config.requestRetry > 0) {
    items.push({ label: '请求重试', value: formatSummaryNumber(config.requestRetry) })
  }
  items.push({ label: '请求日志', value: config.requestLog ? '开启' : '关闭' })
  items.push({ label: '强制模型前缀', value: config.forceModelPrefix ? '开启' : '关闭' })
  items.push({ label: '使用统计', value: config.usageStatisticsEnabled ? '开启' : '关闭' })
  return items
}

function sortSummaryModels(models: readonly UsageModel[]): UsageModel[] {
  return [...models]
    .sort((left, right) => {
      if (left.totalTokens !== right.totalTokens) return right.totalTokens - left.totalTokens
      if (left.totalRequests !== right.totalRequests) return right.totalRequests - left.totalRequests
      return left.modelId.localeCompare(right.modelId, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    })
    .slice(0, MAX_SUMMARY_MODELS)
}

function accountSummaryText(account: CpaAccountSummary): string {
  const parts: string[] = []
  const provider = providerLabel(account.provider)
  const label = accountLabel(account)
  const status = accountStatus(account) || '正常'
  const source = sourceLabel(account)
  if (provider !== '') parts.push(provider)
  if (label !== '' && !labelMentionsProvider(label, provider)) parts.push(label)
  if (source !== '') parts.push(source)
  parts.push(`${account.models.length} 模型`)
  if (status !== '') parts.push(status)
  return parts.join(' · ')
}

function summaryAccountWarning(account: CpaAccountSummary): boolean {
  return account.disabled || account.unavailable || accountStatus(account) !== ''
}

function summaryErrorSources(errors: readonly CpaSummaryError[]): string[] {
  const sources: string[] = []
  for (const error of errors) {
    const source = error.source === '' ? 'summary' : error.source
    if (!sources.includes(source)) sources.push(source)
  }
  return sources
}

export function CpaDataSummary(props: CpaDataSummaryProps): React.ReactElement {
  const { React, primitives } = clientRuntime()
  const [summary, setSummary] = React.useState<CpaSummary | null>(null)
  const [summaryError, setSummaryError] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const body = await fetchCpaSummary()
        if (!cancelled) {
          setSummary(body)
          setSummaryError('')
        }
      } catch {
        if (!cancelled) setSummaryError('CPA 摘要不可用')
      }
    }
    void load()
    const timer = setInterval(() => { void load() }, SUMMARY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [props.active, props.managementAvailable])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    setSummaryError('')
    try {
      setSummary(await fetchCpaSummary())
    } catch {
      setSummaryError('CPA 摘要不可用')
    } finally {
      setRefreshing(false)
    }
  }

  const header = React.createElement('div', { className: 'dsh-cpa-summary-header' },
    React.createElement('span', { className: 'dsh-cpa-summary-title' }, 'CPA 摘要'),
    React.createElement(primitives.Button, {
      variant: 'outline',
      size: 'sm',
      onClick: () => { void refresh() },
      disabled: refreshing,
    }, refreshing ? '刷新中' : '刷新'),
  )

  if (summary === null || !summary.available) {
    return React.createElement('div', { className: 'dsh-cpa-summary' },
      header,
      React.createElement('div', {
        className: 'dsh-cpa-summary-status dsh-cpa-summary-status-warning',
      }, summaryError || (summary === null ? 'CPA 摘要加载中' : 'CPA 摘要不可用')),
    )
  }

  const instance = summary.instance
  const config = instance.config
  const usage = summary.usage
  const totals = usage.totals
  const models = sortSummaryModels(usage.models)
  const accounts = summary.accounts
  const errorSources = summaryErrorSources(summary.errors)

  const instanceItems: SummaryItem[] = [
    { label: '当前版本', value: instance.version || '未获取' },
    { label: '最新版本', value: instance.latestVersion || '未获取' },
    { label: '更新', value: instance.updateAvailable
      ? '可更新'
      : instance.version !== '' && instance.latestVersion !== ''
        ? '已是最新'
        : '未知' },
  ]
  const configItems = configSummaryItems(config)
  const usageItems: SummaryItem[] = [
    { label: '总请求', value: formatSummaryNumber(totals.totalRequests) },
    { label: '成功', value: formatSummaryNumber(totals.successRequests) },
    { label: '失败', value: formatSummaryNumber(totals.failedRequests) },
    { label: '成功率', value: formatSuccessRate(totals.successRate) },
    { label: '输入 tokens', value: formatSummaryNumber(totals.totalPromptTokens) },
    { label: '输出 tokens', value: formatSummaryNumber(totals.totalCompletionTokens) },
    { label: '总 tokens', value: formatSummaryNumber(totals.totalTokens) },
  ]

  function summaryBlock(title: string, children: React.ReactNode): React.ReactElement {
    return React.createElement('div', { className: 'dsh-cpa-summary-block' },
      React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, title),
      children,
    )
  }

  function summaryItems(items: readonly SummaryItem[]): React.ReactElement {
    return React.createElement('div', { className: 'dsh-cpa-summary-grid' },
      items.map(item => React.createElement('span', {
        className: 'dsh-cpa-summary-item',
        key: item.label,
      },
        React.createElement('span', { className: 'dsh-cpa-summary-key' }, item.label),
        React.createElement('span', { className: 'dsh-cpa-summary-value' }, item.value),
      )),
    )
  }

  const modelList = models.length > 0 ? summaryBlock('用量明细',
    React.createElement('div', { className: 'dsh-cpa-summary-list' },
      models.map((model, index) => React.createElement('div', {
        className: `dsh-cpa-summary-list-row${model.failedRequests > 0 ? ' dsh-cpa-summary-list-warning' : ''}`,
        key: model.modelId === '' ? String(index) : model.modelId,
      },
        React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, model.modelId || '未知'),
        React.createElement('span', null, `请求 ${formatSummaryNumber(model.totalRequests)}`),
        model.totalTokens > 0 ? React.createElement('span', null, `tokens ${formatSummaryNumber(model.totalTokens)}`) : null,
        React.createElement('span', null, `失败 ${formatSummaryNumber(model.failedRequests)}`),
      )),
    ),
  ) : null

  const accountList = summaryBlock('账号',
    accounts.length > 0 ? React.createElement('div', { className: 'dsh-cpa-summary-list' },
      accounts.map((account, index) => React.createElement('div', {
        className: `dsh-cpa-summary-list-row${summaryAccountWarning(account) ? ' dsh-cpa-summary-list-warning' : ''}`,
        key: account.authIndex === '' ? String(index) : account.authIndex,
      },
        React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, accountSummaryText(account) || '未知账号'),
      )),
    ) : React.createElement('div', { className: 'dsh-cpa-summary-list-row' },
      React.createElement('span', null, '无账号'),
    ),
  )

  const errorBlock = errorSources.length > 0 ? summaryBlock('错误',
    React.createElement('div', { className: 'dsh-cpa-summary-list-row dsh-cpa-summary-list-warning' },
      React.createElement('span', null, `部分数据不可用: ${errorSources.join('、')}`),
    ),
  ) : null

  return React.createElement('div', { className: 'dsh-cpa-summary' },
    header,
    summaryError === '' ? null : React.createElement('div', {
      className: 'dsh-cpa-summary-status dsh-cpa-summary-status-warning',
    }, '刷新失败'),
    summaryBlock('实例', summaryItems(instanceItems)),
    configItems.length > 0 ? summaryBlock('运行配置', summaryItems(configItems)) : null,
    summaryBlock('用量', summaryItems(usageItems)),
    modelList,
    accountList,
    errorBlock,
  )
}
