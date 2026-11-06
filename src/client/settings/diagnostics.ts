import type * as React from 'react'
import type { CpaDiagnostics } from '../wire.js'
import { downloadCpaReport, fetchCpaDiagnostics } from '../api.js'
import { clientRuntime } from '../runtime.js'

export interface CpaDiagnosticsProps {
  active: boolean
  managementAvailable: boolean
}

function formatNumber(value: number): string {
  return Math.round(Number.isFinite(value) ? value : 0).toLocaleString()
}

export function CpaDiagnosticsPanel(props: CpaDiagnosticsProps): React.ReactElement {
  const { React, primitives } = clientRuntime()
  const [diagnostics, setDiagnostics] = React.useState<CpaDiagnostics | null>(null)
  const [error, setError] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const body = await fetchCpaDiagnostics()
        if (!cancelled) {
          setDiagnostics(body)
          setError('')
        }
      } catch {
        if (!cancelled) setError('CPA 诊断不可用')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [props.active, props.managementAvailable])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    setError('')
    try {
      setDiagnostics(await fetchCpaDiagnostics())
    } catch {
      setError('CPA 诊断不可用')
    } finally {
      setRefreshing(false)
    }
  }

  async function exportReport(): Promise<void> {
    setExporting(true)
    setError('')
    try {
      await downloadCpaReport()
    } catch {
      setError('CPA 报告不可用')
    } finally {
      setExporting(false)
    }
  }

  const checks = diagnostics?.checks ?? []
  const models = diagnostics?.models.slice(0, 12) ?? []
  const modelAccounts = diagnostics?.modelAccounts ?? {}
  const localUsage = diagnostics?.localUsage ?? null
  const budget = diagnostics?.budget ?? null
  const statusLabel = diagnostics?.status === 'healthy'
    ? '正常'
    : diagnostics?.status === 'warning'
      ? '需注意'
      : '不可用'
  const statusWarning = diagnostics?.status !== 'healthy'
  const header = React.createElement('div', { className: 'dsh-cpa-summary-header' },
    React.createElement('span', { className: 'dsh-cpa-summary-title' }, 'CPA 连接诊断'),
    React.createElement('div', { style: { display: 'flex', gap: '6px' } },
      React.createElement(primitives.Button, {
        variant: 'outline',
        size: 'sm',
        onClick: () => { void refresh() },
        disabled: refreshing || exporting,
      }, refreshing ? '刷新中' : '重新检查'),
      React.createElement(primitives.Button, {
        variant: 'outline',
        size: 'sm',
        onClick: () => { void exportReport() },
        disabled: refreshing || exporting,
      }, exporting ? '导出中' : '导出报告'),
    ),
  )
  const checkList = checks.length > 0
    ? React.createElement('div', { className: 'dsh-cpa-summary-list' },
      checks.map((check, index) => React.createElement('div', {
        className: `dsh-cpa-summary-list-row${check.status === 'pass' ? '' : ' dsh-cpa-summary-list-warning'}`,
        key: check.id === '' ? String(index) : check.id,
      },
        React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, check.id || '检查'),
        React.createElement('span', null, check.detail),
      )),
    )
    : React.createElement('div', { className: 'dsh-cpa-summary-status' }, error || '诊断加载中')
  const modelList = models.length > 0
    ? React.createElement('div', { className: 'dsh-cpa-summary-block' },
      React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, '模型能力'),
      React.createElement('div', { className: 'dsh-cpa-summary-list' },
        models.map((model, index) => {
          const accountCount = modelAccounts[model.id]?.length ?? 0
          const context = model.contextLength
          const contextText = context !== undefined && context > 0
            ? `上下文 ${Math.round(context / 1000)}k`
            : '上下文未知'
          const reasoning = model.reasoning !== undefined
            ? `推理 ${model.reasoning.efforts.length} 档`
            : '普通模型'
          return React.createElement('div', {
            className: 'dsh-cpa-summary-list-row',
            key: model.id === '' ? String(index) : model.id,
          },
            React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, model.id || '未知模型'),
            React.createElement('span', null, contextText),
            React.createElement('span', null, reasoning),
            React.createElement('span', null, `可用账号 ${accountCount}`),
          )
        }),
      ),
    )
    : null
  const localUsageTotals = localUsage?.totals ?? null
  const localUsageBlock = localUsage !== null && localUsageTotals !== null
    ? React.createElement('div', { className: 'dsh-cpa-summary-block' },
      React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, '本地执行（近 24 小时）'),
      React.createElement('div', { className: 'dsh-cpa-summary-grid' },
        React.createElement('span', { className: 'dsh-cpa-summary-item' },
          React.createElement('span', { className: 'dsh-cpa-summary-key' }, '请求'),
          React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatNumber(localUsageTotals.totalRequests)),
        ),
        React.createElement('span', { className: 'dsh-cpa-summary-item' },
          React.createElement('span', { className: 'dsh-cpa-summary-key' }, '失败'),
          React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatNumber(localUsageTotals.failedRequests)),
        ),
        React.createElement('span', { className: 'dsh-cpa-summary-item' },
          React.createElement('span', { className: 'dsh-cpa-summary-key' }, 'tokens'),
          React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatNumber(localUsageTotals.totalTokens)),
        ),
        React.createElement('span', { className: 'dsh-cpa-summary-item' },
          React.createElement('span', { className: 'dsh-cpa-summary-key' }, '保留记录'),
          React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatNumber(localUsage.retainedRecords)),
        ),
        budget !== null && budget.dailyRequestLimit > 0
          ? React.createElement('span', { className: 'dsh-cpa-summary-item' },
            React.createElement('span', { className: 'dsh-cpa-summary-key' }, '请求提醒'),
            React.createElement('span', {
              className: `dsh-cpa-summary-value${budget.exceeded ? ' dsh-cpa-summary-list-warning' : ''}`,
            }, `${formatNumber(budget.requests)}/${formatNumber(budget.dailyRequestLimit)}`),
          )
          : null,
      ),
    )
    : null

  return React.createElement('div', { className: 'dsh-cpa-summary' },
    header,
    React.createElement('div', {
      className: `dsh-cpa-summary-status${statusWarning ? ' dsh-cpa-summary-status-warning' : ''}`,
    }, error || statusLabel),
    checkList,
    localUsageBlock,
    modelList,
  )
}
