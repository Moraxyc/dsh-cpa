window.__ModuleLoader__.load({
  id: 'dsh-cpa',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const {
      Button,
      IconChevronDownOutline14,
      IconChevronUpOutline14,
      IconSettingsOutline14,
      IconStopFill16,
      Input,
      Modal,
      Pill,
      StateDot,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const SETTINGS_URL = '/dsh-cpa/settings'
    const SUMMARY_URL = '/dsh-cpa/summary'
    const DIAGNOSTICS_URL = '/dsh-cpa/diagnostics'
    const REPORT_URL = '/dsh-cpa/report'
    const PANEL_URL = '/dsh-cpa/management'
    const EXECUTION_STATUS_URL = '/dsh-cpa/execution-status'
    const STYLE_ID = 'dsh-cpa-client'
    const READOUT_REFRESH_MS = 60_000
    const SUMMARY_REFRESH_MS = 60_000
    const MAX_SUMMARY_MODELS = 8

    if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) {
      const style = document.createElement('style')
      style.dataset.pluginCss = STYLE_ID
      style.textContent = `
        [role="presentation"]:has(.dsh-cpa-management-dialog) {
          padding: 8px;
        }
        .dsh-cpa-management-dialog.dsh-cpa-management-dialog {
          box-sizing: border-box;
          width: calc(100vw - 16px);
          height: calc(100vh - 16px);
          height: calc(100dvh - 16px);
          max-height: calc(100vh - 16px);
          max-height: calc(100dvh - 16px);
          padding: 8px;
        }
        .dsh-cpa-management-content.dsh-cpa-management-content {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          min-height: 0;
          height: 100%;
          max-height: calc(100vh - 16px);
          max-height: calc(100dvh - 16px);
          padding: 0;
        }
        .dsh-cpa-management-content > div:last-child {
          flex: 1 1 auto;
          min-height: 0;
          padding: 0;
          overflow: hidden;
        }
        .dsh-cpa-management-content iframe {
          display: block;
          width: 100%;
          height: 100%;
          flex: 1 1 auto;
          min-height: 0;
          border: 0;
          border-radius: 24px;
          background: var(--dsw-alias-bg-layer-1);
        }
        .dsh-cpa-readout.dsh-cpa-readout {
          display: flex;
          align-items: center;
          gap: 4px;
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-height: 20px;
          padding: 0 4px 8px;
          border: 0;
          background: none;
          overflow: hidden;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-tertiary);
          white-space: nowrap;
          text-align: left;
          cursor: pointer;
          appearance: none;
        }
        .dsh-cpa-readout:hover {
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-readout.dsh-cpa-readout-warning {
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-cpa-readout-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-cpa-readout-toggle {
          display: inline-flex;
          flex: 0 0 auto;
        }
        .dsh-cpa-details {
          box-sizing: border-box;
          margin: 0 4px 8px;
          padding: 8px 10px;
          border: 1px solid var(--dsw-alias-border-l2);
          border-radius: 8px;
          background: var(--dsw-alias-bg-layer-1);
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-details-row {
          display: grid;
          grid-template-columns: minmax(72px, max-content) minmax(0, 1fr);
          gap: 8px;
        }
        .dsh-cpa-details-label {
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-details-value {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .dsh-cpa-details-value a {
          color: var(--dsw-alias-brand-primary);
          text-decoration: none;
        }
        .dsh-cpa-details-value a:hover {
          text-decoration: underline;
        }
        .dsh-cpa-summary {
          box-sizing: border-box;
          margin: 0 0 16px;
          padding-top: 12px;
          border-top: 1px solid var(--dsw-alias-border-l2);
        }
        .dsh-cpa-summary-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .dsh-cpa-summary-title {
          font-size: 13px;
          font-weight: 600;
          line-height: 20px;
          color: var(--dsw-alias-label-primary);
        }
        .dsh-cpa-summary-status {
          margin-top: 4px;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-status-warning {
          color: var(--dsw-alias-state-error-primary);
        }
        .dsh-cpa-summary-block {
          margin-top: 10px;
        }
        .dsh-cpa-summary-block-title {
          margin-bottom: 4px;
          font-size: 12px;
          line-height: 18px;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 14px;
        }
        .dsh-cpa-summary-item {
          display: inline-flex;
          gap: 4px;
          min-width: 0;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-summary-key {
          flex: 0 0 auto;
          color: var(--dsw-alias-label-tertiary);
        }
        .dsh-cpa-summary-value {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .dsh-cpa-summary-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .dsh-cpa-summary-list-row {
          display: flex;
          flex-wrap: wrap;
          gap: 2px 12px;
          min-width: 0;
          font-size: 12px;
          line-height: 20px;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-cpa-summary-list-main {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-cpa-summary-list-warning {
          color: var(--dsw-alias-state-error-primary);
        }
      `
      document.head.appendChild(style)
    }

    const PROVIDER_LABELS = {
      codex: 'Codex',
      'gemini-cli': 'Gemini',
      antigravity: 'Antigravity',
      claude: 'Claude',
      anthropic: 'Claude',
      openai: 'OpenAI',
      'openai-compatibility': 'OpenAI',
      'openai-compatible': 'OpenAI',
      gemini: 'Gemini',
      vertex: 'Vertex',
      aistudio: 'AI Studio',
      xai: 'xAI',
      interactions: 'Interactions',
      qwen: 'Qwen',
      kimi: 'Kimi',
      iflow: 'iFlow',
      deepseek: 'DeepSeek',
      zhipu: '智谱',
      doubao: '豆包',
      api: 'API',
    }

    function providerLabel(provider) {
      const key = String(provider || '').toLowerCase()
      if (key === '' || key === 'unknown' || key === 'cpa') return ''
      return PROVIDER_LABELS[key]
        || key.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    }

    function providerFromModel(model) {
      const value = String(model || '').toLowerCase()
      const bare = value.split('/').pop()
      if (/^(gpt|o[134]|chatgpt|codex)/.test(bare)) return 'openai'
      if (bare.startsWith('claude')) return 'claude'
      if (bare.startsWith('gemini')) return 'gemini'
      if (bare.startsWith('deepseek')) return 'deepseek'
      if (bare.startsWith('qwen')) return 'qwen'
      if (bare.startsWith('kimi')) return 'kimi'
      if (bare.startsWith('glm')) return 'zhipu'
      if (bare.startsWith('doubao')) return 'doubao'
      if (bare.startsWith('grok')) return 'xai'
      return ''
    }

    function positiveCount(value) {
      const number = Number(value)
      return Number.isFinite(number) && number > 0 ? number : 0
    }

    function accountLabel(account) {
      if (account === null || typeof account !== 'object') return ''
      const label = typeof account.label === 'string' ? account.label.trim() : ''
      if (label !== '') return label
      return typeof account.authIndex === 'string' && account.authIndex !== ''
        ? `账号 ${account.authIndex}`
        : ''
    }

    function labelMentionsProvider(label, provider) {
      if (label === '' || provider === '') return false
      return label.toLowerCase().includes(provider.toLowerCase())
    }

    function planType(account) {
      return typeof account?.planType === 'string' ? account.planType.trim() : ''
    }

    function planLabel(account) {
      const plan = planType(account)
      if (plan === '') return ''
      const labels = {
        plus: 'Plus',
        pro: 'Pro',
        free: 'Free',
        team: 'Team',
        teams: 'Teams',
        enterprise: 'Enterprise',
      }
      return labels[plan.toLowerCase()] || plan
    }

    function sourceLabel(account) {
      const source = typeof account?.source === 'string' ? account.source.toLowerCase() : ''
      if (source === 'api-key') return 'API Key'
      if (source === 'file' || source === 'auth-file') return '认证文件'
      if (source === 'memory') return '运行态'
      return source
    }

    function accountStatus(account) {
      if (account === null || typeof account !== 'object') return ''
      if (account.quotaAutoDisabled === true) return '停用'
      if (account.disabled === true) return '停用'
      if (account.unavailable === true) return '不可用'
      const status = typeof account.status === 'string' ? account.status.trim().toLowerCase() : ''
      if (status === 'disabled' || status === 'inactive' || status === 'blocked') return '停用'
      if (status === 'unavailable' || status === 'error' || status === 'failed') return '不可用'
      return ''
    }

    function resolveAccount(accounts, execution) {
      if (!Array.isArray(accounts)) return undefined
      if (execution && typeof execution.authIndex === 'string' && execution.authIndex !== '') {
        const matched = accounts.find(account => account?.authIndex === execution.authIndex)
        if (matched !== undefined) return matched
        const provider = providerFromModel(execution.model) || execution.provider
        return provider === '' ? undefined : { provider }
      }
      if (execution && typeof execution === 'object') {
        const provider = providerFromModel(execution.model)
        return provider === '' ? undefined : { provider }
      }
      return undefined
    }

    function reportWindows(quota, authIndex) {
      const report = authIndex && quota && typeof quota[authIndex] === 'object'
        ? quota[authIndex]
        : null
      return Array.isArray(report?.windows) ? report.windows : []
    }

    function windowPercent(window) {
      if (window === null || typeof window !== 'object') return null
      if (typeof window.remainingPercent === 'number' && Number.isFinite(window.remainingPercent)) {
        return window.remainingPercent
      }
      if (typeof window.percent === 'number' && Number.isFinite(window.percent)) {
        return window.percent
      }
      return null
    }

    function preferredWindow(windows) {
      const values = Array.isArray(windows) ? windows.filter(window => windowPercent(window) !== null) : []
      return values.find(window => window.id === 'code-5h')
        ?? values.find(window => window.id === 'code-7d')
        ?? values[0]
    }

    function quotaText(window) {
      const percent = windowPercent(window)
      if (!window || percent === null) return ''
      const risk = window.risk === 'critical'
        ? ' · 风险高'
        : window.risk === 'warning'
          ? ' · 额度偏低'
          : ''
      return `${window.label} ${Math.round(percent)}%${risk}`
    }

    function accountCore(account) {
      const parts = []
      const label = accountLabel(account)
      const provider = providerLabel(account?.provider)
      const plan = planLabel(account)
      if (provider !== '' && !labelMentionsProvider(label, provider)) parts.push(provider)
      if (plan !== '') parts.push(plan)
      const status = accountStatus(account)
      if (status !== '') parts.push(status)
      const success = positiveCount(account?.success)
      const failed = positiveCount(account?.failed)
      if (success > 0 || failed > 0) parts.push(`成功 ${success} · 失败 ${failed}`)
      return parts.join(' · ')
    }

    function accountQuotaText(quota, authIndex) {
      return reportWindows(quota, authIndex).map(window => {
        const text = quotaText(window)
        if (text === '') return ''
        const reset = typeof window.resetLabel === 'string' && window.resetLabel !== ''
          ? ` · 重置 ${window.resetLabel}`
          : ''
        return `${text}${reset}`
      }).filter(Boolean).join(' · ')
    }

    function routeIssueLabel(code) {
      const labels = {
        MODEL_NOT_SYNCED: '模型目录未同步',
        REASONING_UNSUPPORTED: '不支持当前推理级别',
        CONTEXT_WINDOW_EXCEEDED: '超出上下文窗口',
        MAX_COMPLETION_EXCEEDED: '超过模型输出上限',
        QUOTA_EXHAUSTED: '额度已耗尽',
        ACCOUNT_UNAVAILABLE: '账号不可用',
      }
      return labels[code] || code
    }

    function fallbackReasonLabel(code) {
      const labels = {
        QUOTA: '额度耗尽',
        RATE_LIMIT: '触发限流',
        SERVER: '服务端错误',
        TRANSPORT: '网络错误',
        EMPTY_RESPONSE: '空响应',
        STREAM_CLOSED: '流提前结束',
        HTTP_408: '请求超时',
        HTTP_502: '网关错误',
        HTTP_503: '服务不可用',
        HTTP_504: '网关超时',
      }
      return labels[code] || code || '请求失败'
    }

    function executionTimeline(executions) {
      if (!Array.isArray(executions) || executions.length === 0) return ''
      return [...executions]
        .filter(item => item && typeof item === 'object')
        .sort((left, right) => Number(left.attempt || 0) - Number(right.attempt || 0))
        .map(item => {
          const model = typeof item.model === 'string' && item.model !== '' ? item.model : '未知模型'
          if (item.outcome === 'failure') {
            return `${model} 失败${item.errorCode ? `（${fallbackReasonLabel(item.errorCode)}）` : ''}`
          }
          return `${model} 成功`
        })
        .join(' → ')
    }

    function formatReadout(accounts, quota, execution) {
      const account = resolveAccount(accounts, execution)
      const parts = ['CPA']
      if (account) {
        const label = accountLabel(account)
        const provider = providerLabel(account.provider || execution?.provider)
        const plan = planLabel(account)
        if (label !== '') {
          parts.push(label)
          if (provider !== '' && !labelMentionsProvider(label, provider)) parts.push(provider)
          if (plan !== '') parts.push(plan)
        } else {
          if (provider !== '' || plan !== '') parts.push([provider, plan].filter(Boolean).join(' '))
        }
        const status = accountStatus(account)
        if (status !== '') parts.push(status)
        const failed = Math.max(positiveCount(account.failed), execution?.outcome === 'failure' ? 1 : 0)
        if (failed > 0) parts.push(`失败 ${failed}`)
        if (execution?.fallbackFrom) parts.push(`已切换至 ${execution.model}`)
        const window = preferredWindow(reportWindows(quota, account.authIndex))
        if (window) parts.push(quotaText(window))
      } else {
        if (Array.isArray(accounts)) {
          const unavailable = accounts.filter(account => account?.unavailable === true).length
          const disabled = accounts.filter(account => account?.disabled === true).length
          if (accounts.length > 1) parts.push(`${accounts.length} 账号`)
          if (unavailable > 0) parts.push(`${unavailable} 不可用`)
          if (disabled > 0) parts.push(`${disabled} 停用`)
        }
        if (execution?.outcome === 'failure') parts.push('失败')
        if (execution?.fallbackFrom) parts.push(`已切换至 ${execution.model}`)
        if (execution && typeof execution.model === 'string' && execution.model !== '') {
          parts.push(execution.model)
        }
      }
      return parts.join(' · ')
    }

    function detailRows(accounts, quota, execution, executions) {
      const rows = []
      const account = resolveAccount(accounts, execution)
      if (account) {
        const label = accountLabel(account)
        const core = accountCore(account)
        if (label !== '' && core !== '') rows.push({ label, value: core })
        const quotaValue = accountQuotaText(quota, account.authIndex)
        if (quotaValue !== '') rows.push({ label: '额度', value: quotaValue })
        const source = sourceLabel(account)
        if (source !== '') rows.push({ label: '来源', value: source })
        if (typeof account.authIndex === 'string' && account.authIndex !== '') {
          rows.push({ label: '认证', value: account.authIndex })
        }
        if (typeof account.baseUrl === 'string' && account.baseUrl !== '') {
          rows.push({ label: 'Base URL', value: account.baseUrl })
        }
        if (typeof account.prefix === 'string' && account.prefix !== '') {
          rows.push({ label: '前缀', value: account.prefix })
        }
        if (account.priority !== undefined && account.priority !== null && account.priority !== '') {
          rows.push({ label: '优先级', value: String(account.priority) })
        }
        if (typeof account.statusMessage === 'string' && account.statusMessage !== '') {
          rows.push({ label: '状态消息', value: account.statusMessage })
        }
        if (Array.isArray(account.modelAliases) && account.modelAliases.length > 0) {
          rows.push({ label: '模型别名', value: account.modelAliases.join('、') })
        }
        if (account.websockets === true) rows.push({ label: 'WebSocket', value: '开启' })
        if (typeof account.lastRefresh === 'string' && account.lastRefresh !== '') {
          rows.push({ label: '刷新时间', value: account.lastRefresh })
        }
        if (typeof account.nextRetryAfter === 'string' && account.nextRetryAfter !== '') {
          rows.push({ label: '重试时间', value: account.nextRetryAfter })
        }
        if (typeof account.note === 'string' && account.note !== '') {
          rows.push({ label: '备注', value: account.note })
        }
      } else if (!execution && Array.isArray(accounts)) {
        for (const item of accounts) {
          const label = accountLabel(item)
          const core = accountCore(item)
          if (label === '' || core === '') continue
          rows.push({ label, value: core })
          const quotaValue = accountQuotaText(quota, item.authIndex)
          if (quotaValue !== '') rows.push({ label: '额度', value: quotaValue })
        }
      }
      const executionProvider = providerLabel(execution?.provider)
      if (executionProvider !== '' && (!account || providerLabel(account.provider) !== executionProvider)) {
        rows.push({ label: '服务商', value: executionProvider })
      }
      if (execution && typeof execution.authIndex === 'string' && execution.authIndex !== ''
        && (!account || account.authIndex !== execution.authIndex)) {
        rows.push({ label: '认证', value: execution.authIndex })
      }
      if (execution && typeof execution.model === 'string' && execution.model !== '') {
        rows.push({ label: '模型', value: execution.model })
      }
      if (execution && typeof execution.requestedModel === 'string' && execution.requestedModel !== ''
        && execution.requestedModel !== execution.model) {
        rows.push({ label: '原始模型', value: execution.requestedModel })
      }
      if (execution && typeof execution.fallbackFrom === 'string' && execution.fallbackFrom !== '') {
        rows.push({
          label: '自动切换',
          value: `${execution.fallbackFrom} → ${execution.model || '未知'} · ${fallbackReasonLabel(execution.fallbackReason)}`,
        })
      }
      const timeline = executionTimeline(executions)
      if (timeline !== '') rows.push({ label: '执行链路', value: timeline })
      if (Array.isArray(execution?.route) && execution.route.length > 1) {
        rows.push({ label: '候选路由', value: execution.route.join(' → ') })
      }
      if (execution?.preflightStatus && execution.preflightStatus !== 'ready') {
        const issues = Array.isArray(execution.preflightIssues)
          ? execution.preflightIssues.map(routeIssueLabel).join('、')
          : ''
        rows.push({
          label: '请求预检',
          value: `${execution.preflightStatus === 'blocked' ? '阻断' : '有风险'}${issues ? ` · ${issues}` : ''}`,
        })
      }
      if (execution && typeof execution.purpose === 'string' && execution.purpose !== '') {
        rows.push({ label: '用途', value: execution.purpose })
      }
      if (execution && typeof execution.outcome === 'string' && execution.outcome !== '') {
        rows.push({ label: '结果', value: execution.outcome === 'success' ? '成功' : '失败' })
      }
      if (execution && typeof execution.traceId === 'string' && execution.traceId !== '') {
        rows.push({ label: 'Trace', value: execution.traceId })
      }
      if (execution && typeof execution.requestId === 'string' && execution.requestId !== '') {
        rows.push({ label: 'Request', value: execution.requestId })
        rows.push({
          label: '日志',
          value: React.createElement('a', {
            href: `${PANEL_URL}/request-log-by-id/${encodeURIComponent(execution.requestId)}`,
            target: '_blank',
            rel: 'noreferrer',
      }, '查看'),
        })
      }
      return rows
    }

    async function fetchCpaSummary() {
      const response = await fetch(SUMMARY_URL, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('CPA 摘要不可用')
      return response.json().catch(() => { throw new Error('CPA 摘要不可用') })
    }

    async function fetchCpaDiagnostics() {
      const response = await fetch(DIAGNOSTICS_URL, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('CPA 诊断不可用')
      return response.json().catch(() => { throw new Error('CPA 诊断不可用') })
    }

    async function downloadCpaReport() {
      const response = await fetch(REPORT_URL, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('CPA 报告不可用')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dsh-cpa-report-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
    }

    function summaryNumber(value) {
      const number = Number(value)
      return Number.isFinite(number) ? number : 0
    }

    function formatSummaryNumber(value) {
      return Math.round(summaryNumber(value)).toLocaleString()
    }

    function formatSuccessRate(value) {
      const ratio = summaryNumber(value)
      return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`
    }

    function configSummaryItems(config) {
      const source = config && typeof config === 'object' ? config : {}
      const items = []
      if (source.routingStrategy !== undefined && source.routingStrategy !== null && source.routingStrategy !== '') {
        items.push({ label: '路由策略', value: String(source.routingStrategy) })
      }
      if (typeof source.proxyUrl === 'string' && source.proxyUrl !== '') {
        items.push({ label: '代理', value: source.proxyUrl })
      }
      if (summaryNumber(source.requestRetry) > 0) {
        items.push({ label: '请求重试', value: formatSummaryNumber(source.requestRetry) })
      }
      if (typeof source.requestLog === 'boolean') {
        items.push({ label: '请求日志', value: source.requestLog ? '开启' : '关闭' })
      }
      if (typeof source.forceModelPrefix === 'boolean') {
        items.push({ label: '强制模型前缀', value: source.forceModelPrefix ? '开启' : '关闭' })
      }
      if (typeof source.usageStatisticsEnabled === 'boolean') {
        items.push({ label: '使用统计', value: source.usageStatisticsEnabled ? '开启' : '关闭' })
      }
      return items
    }

    function sortSummaryModels(models) {
      if (!Array.isArray(models)) return []
      return models
        .filter(model => model !== null && typeof model === 'object')
        .sort((left, right) => {
          const leftTokens = summaryNumber(left.totalTokens)
          const rightTokens = summaryNumber(right.totalTokens)
          if (leftTokens !== rightTokens) return rightTokens - leftTokens
          const leftRequests = summaryNumber(left.totalRequests)
          const rightRequests = summaryNumber(right.totalRequests)
          if (leftRequests !== rightRequests) return rightRequests - leftRequests
          return String(left.modelId || '').localeCompare(String(right.modelId || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        })
        .slice(0, MAX_SUMMARY_MODELS)
    }

    function accountSummaryText(account) {
      if (!account || typeof account !== 'object') return ''
      const parts = []
      const provider = providerLabel(account.provider)
      const label = accountLabel(account)
      const status = accountStatus(account) || '正常'
      const source = sourceLabel(account)
      const modelCount = Array.isArray(account.models) ? account.models.length : 0
      if (provider !== '') parts.push(provider)
      if (label !== '' && !labelMentionsProvider(label, provider)) parts.push(label)
      if (source !== '') parts.push(source)
      parts.push(`${modelCount} 模型`)
      if (status !== '') parts.push(status)
      return parts.join(' · ')
    }

    function summaryAccountWarning(account) {
      return Boolean(account && typeof account === 'object'
        && (account.disabled === true || account.unavailable === true || accountStatus(account) !== ''))
    }

    function summaryErrorSources(errors) {
      const sources = []
      if (!Array.isArray(errors)) return sources
      for (const error of errors) {
        if (!error || typeof error !== 'object') continue
        const source = typeof error.source === 'string' && error.source !== '' ? error.source : 'summary'
        if (!sources.includes(source)) sources.push(source)
      }
      return sources
    }

    function accountNeedsWarning(account, quota, execution) {
      if (execution?.outcome === 'failure') return true
      if (execution?.preflightStatus === 'blocked') return true
      if (!account || account === null || typeof account !== 'object') return false
      if (account.disabled === true || account.unavailable === true) return true
      if (accountStatus(account) !== '') return true
      if (positiveCount(account.failed) > 0) return true
      const window = preferredWindow(reportWindows(quota, account.authIndex))
      return Boolean(window && (window.risk === 'critical' || windowPercent(window) <= 5))
    }

    function shouldShowReadout(readout, execution) {
      if (!readout || readout.available === false) return false
      const accounts = Array.isArray(readout?.accounts) ? readout.accounts : []
      return accounts.length > 0 || Boolean(execution)
    }

    function CpaDock(props) {
      const { sessionId, useProjection } = props
      const projection = useProjection('cpaUsage')
      const [readout, setReadout] = useState(null)
      const [expanded, setExpanded] = useState(false)

      useEffect(() => {
        setReadout(null)
        setExpanded(false)
        if (!sessionId) return undefined
        let cancelled = false
        async function refresh() {
          try {
            const response = await fetch(`${EXECUTION_STATUS_URL}?sessionId=${encodeURIComponent(sessionId)}`, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) return
            const body = await response.json().catch(() => null)
            if (!cancelled && body && typeof body === 'object') setReadout(body)
          } catch {
            // The readout is best-effort; keep the last successful snapshot.
          }
        }
        void refresh()
        const timer = setInterval(() => { void refresh() }, READOUT_REFRESH_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [sessionId])

      const execution = projection ?? readout?.execution
      const accounts = Array.isArray(readout?.accounts) ? readout.accounts : []
      if (!shouldShowReadout(readout, execution)) return null
      const line = formatReadout(accounts, readout?.quota, execution)
      if (line === 'CPA') return null
      const account = resolveAccount(accounts, execution)
      const className = [
        'dsh-cpa-readout',
        accountNeedsWarning(account, readout?.quota, execution) ? 'dsh-cpa-readout-warning' : '',
      ].filter(Boolean).join(' ')
      const details = detailRows(accounts, readout?.quota, execution, readout?.executions)
      return React.createElement('div', { className: 'dsh-cpa-dock' },
        React.createElement('button', {
          type: 'button',
          className,
          title: line,
          onClick: () => setExpanded(current => !current),
          'aria-expanded': expanded,
        },
          React.createElement('span', { className: 'dsh-cpa-readout-text' }, line),
          React.createElement('span', { className: 'dsh-cpa-readout-toggle', 'aria-hidden': true },
            React.createElement(expanded ? IconChevronUpOutline14 : IconChevronDownOutline14, { size: 12 }),
          ),
        ),
        expanded && details.length > 0 ? React.createElement('div', { className: 'dsh-cpa-details' },
          details.map((row, index) => React.createElement('div', {
            className: 'dsh-cpa-details-row',
            key: `${row.label}-${index}`,
          },
            React.createElement('span', { className: 'dsh-cpa-details-label' }, row.label),
            React.createElement('span', { className: 'dsh-cpa-details-value' }, row.value),
          )),
        ) : null,
      )
    }

    function CpaDataSummary({ active, managementAvailable }) {
      const [summary, setSummary] = useState(null)
      const [summaryError, setSummaryError] = useState('')
      const [refreshing, setRefreshing] = useState(false)

      useEffect(() => {
        let cancelled = false
        async function load() {
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
      }, [active, managementAvailable])

      async function refresh() {
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
        React.createElement(Button, {
          variant: 'outline',
          size: 'sm',
          onClick: () => { void refresh() },
          disabled: refreshing,
        }, refreshing ? '刷新中' : '刷新'),
      )

      if (!summary || summary.available !== true) {
        return React.createElement('div', { className: 'dsh-cpa-summary' },
          header,
          React.createElement('div', {
            className: 'dsh-cpa-summary-status dsh-cpa-summary-status-warning',
          }, summaryError || (summary ? 'CPA 摘要不可用' : 'CPA 摘要加载中')),
        )
      }

      const instance = summary.instance && typeof summary.instance === 'object' ? summary.instance : {}
      const config = instance.config && typeof instance.config === 'object' ? instance.config : {}
      const usage = summary.usage && typeof summary.usage === 'object' ? summary.usage : {}
      const totals = usage.totals && typeof usage.totals === 'object' ? usage.totals : {}
      const models = sortSummaryModels(usage.models)
      const accounts = Array.isArray(summary.accounts) ? summary.accounts : []
      const errorSources = summaryErrorSources(summary.errors)

      const instanceItems = [
        { label: '当前版本', value: instance.version || '未获取' },
        { label: '最新版本', value: instance.latestVersion || '未获取' },
        { label: '更新', value: instance.updateAvailable === true
          ? '可更新'
          : instance.version && instance.latestVersion
            ? '已是最新'
            : '未知' },
      ]
      const configItems = configSummaryItems(config)
      const usageItems = [
        { label: '总请求', value: formatSummaryNumber(totals.totalRequests) },
        { label: '成功', value: formatSummaryNumber(totals.successRequests) },
        { label: '失败', value: formatSummaryNumber(totals.failedRequests) },
        { label: '成功率', value: formatSuccessRate(totals.successRate) },
        { label: '输入 tokens', value: formatSummaryNumber(totals.totalPromptTokens) },
        { label: '输出 tokens', value: formatSummaryNumber(totals.totalCompletionTokens) },
        { label: '总 tokens', value: formatSummaryNumber(totals.totalTokens) },
      ]

      function summaryBlock(title, children) {
        return React.createElement('div', { className: 'dsh-cpa-summary-block' },
          React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, title),
          children,
        )
      }

      function summaryItems(items) {
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
            className: `dsh-cpa-summary-list-row${summaryNumber(model.failedRequests) > 0 ? ' dsh-cpa-summary-list-warning' : ''}`,
            key: String(model.modelId || index),
          },
            React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, model.modelId || '未知'),
            React.createElement('span', null, `请求 ${formatSummaryNumber(model.totalRequests)}`),
            summaryNumber(model.totalTokens) > 0 ? React.createElement('span', null, `tokens ${formatSummaryNumber(model.totalTokens)}`) : null,
            React.createElement('span', null, `失败 ${formatSummaryNumber(model.failedRequests)}`),
          )),
        ),
      ) : null

      const accountList = summaryBlock('账号',
        accounts.length > 0 ? React.createElement('div', { className: 'dsh-cpa-summary-list' },
          accounts.map((account, index) => React.createElement('div', {
            className: `dsh-cpa-summary-list-row${summaryAccountWarning(account) ? ' dsh-cpa-summary-list-warning' : ''}`,
            key: account?.authIndex || index,
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
        summaryError ? React.createElement('div', {
          className: 'dsh-cpa-summary-status dsh-cpa-summary-status-warning',
        }, '刷新失败') : null,
        summaryBlock('实例', summaryItems(instanceItems)),
        configItems.length > 0 ? summaryBlock('运行配置', summaryItems(configItems)) : null,
        summaryBlock('用量', summaryItems(usageItems)),
        modelList,
        accountList,
        errorBlock,
      )
    }

    function CpaSettingsSection() {
      const [state, setState] = useState(null)
      const [mode, setMode] = useState('internal')
      const [externalUrl, setExternalUrl] = useState('')
      const [externalApiKey, setExternalApiKey] = useState('')
      const [externalManagementKey, setExternalManagementKey] = useState('')
      const [internalBin, setInternalBin] = useState('')
      const [usageStatisticsEnabled, setUsageStatisticsEnabled] = useState(true)
      const [routingStrategy, setRoutingStrategy] = useState('balanced')
      const [dailyRequestLimit, setDailyRequestLimit] = useState('0')
      const [refreshIntervalMs, setRefreshIntervalMs] = useState('300000')
      const [port, setPort] = useState('8317')
      const [configPath, setConfigPath] = useState('')
      const [settingsPath, setSettingsPath] = useState('')
      const [executionsPath, setExecutionsPath] = useState('')
      const [authFilesTtlMs, setAuthFilesTtlMs] = useState('30000')
      const [quotaTtlMs, setQuotaTtlMs] = useState('60000')
      const [quotaConcurrency, setQuotaConcurrency] = useState('4')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)
      const [panelOpen, setPanelOpen] = useState(false)

      useEffect(() => {
        let cancelled = false
        async function load() {
          try {
            const response = await fetch(SETTINGS_URL, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) throw new Error('CPA 不可用')
            const body = await response.json().catch(() => null)
            if (!cancelled && body && typeof body.mode === 'string') {
              setState(body)
              setMode(body.mode === 'off' ? 'internal' : body.mode)
              setExternalUrl(body.external?.url || '')
              setInternalBin(body.bin || '')
              setUsageStatisticsEnabled(body.usageStatisticsEnabled !== false)
              setRoutingStrategy(body.routingStrategy || 'balanced')
              setDailyRequestLimit(String(body.dailyRequestLimit ?? 0))
              setRefreshIntervalMs(String(body.refreshIntervalMs ?? 300000))
              setPort(String(body.port ?? 8317))
              setConfigPath(body.configPath || '')
              setSettingsPath(body.settingsPath || '')
              setExecutionsPath(body.executionsPath || '')
              setAuthFilesTtlMs(String(body.authFilesTtlMs ?? 30000))
              setQuotaTtlMs(String(body.quotaTtlMs ?? 60000))
              setQuotaConcurrency(String(body.quotaConcurrency ?? 4))
              setError(body.error || '')
            }
          } catch {
            if (!cancelled) setError('CPA 不可用')
          }
        }
        void load()
        return () => { cancelled = true }
      }, [])

      if (state === null) {
        return React.createElement('div', {
          style: { padding: '20px', color: 'var(--dsw-alias-label-tertiary)' },
        }, error || 'CPA')
      }

      const rowStyle = {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
      }
      const labelStyle = {
        display: 'block',
        marginBottom: '6px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary)',
      }
      const fieldStyle = {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        minWidth: '220px',
        flex: '1 1 280px',
      }
      const selectStyle = {
        boxSizing: 'border-box',
        minHeight: '32px',
        padding: '0 8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      }
      function textField(label, value, onChange, placeholder = '') {
        return React.createElement('div', { style: fieldStyle },
          React.createElement('label', { style: labelStyle }, label),
          React.createElement(Input, {
            type: 'text',
            value,
            onChange,
            disabled: busy,
            placeholder,
            spellCheck: false,
          }),
        )
      }
      function numberField(label, value, onChange, min = '1') {
        return React.createElement('div', { style: fieldStyle },
          React.createElement('label', { style: labelStyle }, label),
          React.createElement(Input, {
            type: 'number',
            min,
            step: '1',
            value,
            onChange,
            disabled: busy,
          }),
        )
      }
      const statusText = state.internalRunning
        ? '内部 CPA 运行中'
        : state.externalRunning
          ? '外部 CPA 运行中'
          : 'CPA 已停止'
      const statusState = state.active ? 'done' : 'warning'

      return React.createElement('div', { style: { padding: '20px' } },
        React.createElement('div', {
          style: {
            ...rowStyle,
            justifyContent: 'space-between',
            marginBottom: '16px',
          },
        },
          React.createElement('span', {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: '600',
              color: 'var(--dsw-alias-label-primary)',
            },
          },
            React.createElement(StateDot, { state: statusState }),
            statusText,
          ),
          state.managementAvailable ? React.createElement(Button, {
            variant: 'outline',
            size: 'sm',
            icon: React.createElement(IconSettingsOutline14),
            onClick: () => setPanelOpen(true),
          }, '管理面板') : null,
        ),
        React.createElement(CpaDataSummary, {
          active: state.active,
          managementAvailable: state.managementAvailable,
        }),
        React.createElement(CpaDiagnostics, {
          active: state.active,
          managementAvailable: state.managementAvailable,
        }),
        React.createElement('div', { style: rowStyle },
          React.createElement(Pill, {
            active: mode === 'internal',
            'aria-pressed': mode === 'internal',
            onClick: () => setMode('internal'),
            disabled: busy,
          }, '内部 CPA'),
          React.createElement(Pill, {
            active: mode === 'external',
            'aria-pressed': mode === 'external',
            onClick: () => setMode('external'),
            disabled: busy,
          }, '外部 CPA'),
        ),
        mode === 'internal' ? React.createElement('div', {
          style: { ...rowStyle, alignItems: 'flex-start', marginTop: '12px' },
        },
          React.createElement('div', { style: fieldStyle },
            React.createElement('label', { style: labelStyle }, 'CPA 路径'),
            React.createElement(Input, {
              type: 'text',
              value: internalBin,
              onChange: event => setInternalBin(event.target.value),
              disabled: busy,
              placeholder: 'cli-proxy-api',
              spellCheck: false,
            }),
          ),
          React.createElement('div', { style: { ...rowStyle, gap: '8px' } },
            React.createElement('input', {
              type: 'checkbox',
              id: 'cpa-usage-stats',
              checked: usageStatisticsEnabled,
              onChange: event => setUsageStatisticsEnabled(event.target.checked),
              disabled: busy,
            }),
            React.createElement('label', {
              htmlFor: 'cpa-usage-stats',
              style: { ...labelStyle, marginBottom: 0 },
            }, '使用统计'),
          ),
        ) : null,
        mode === 'external' ? React.createElement('div', {
          style: { ...rowStyle, alignItems: 'flex-start', marginTop: '12px' },
        },
          React.createElement('div', { style: fieldStyle },
            React.createElement('label', { style: labelStyle }, 'URL'),
            React.createElement(Input, {
              type: 'text',
              value: externalUrl,
              onChange: event => setExternalUrl(event.target.value),
              disabled: busy,
              placeholder: 'https://127.0.0.1:8317/v1',
              spellCheck: false,
            }),
          ),
          React.createElement('div', { style: fieldStyle },
            React.createElement('label', { style: labelStyle }, 'API Key'),
            React.createElement(Input, {
              type: 'password',
              value: externalApiKey,
              onChange: event => setExternalApiKey(event.target.value),
              disabled: busy,
              placeholder: state.external?.apiKeySet ? '已保存' : 'API Key',
            }),
          ),
          React.createElement('div', { style: fieldStyle },
            React.createElement('label', { style: labelStyle }, '管理密钥'),
            React.createElement(Input, {
              type: 'password',
              value: externalManagementKey,
              onChange: event => setExternalManagementKey(event.target.value),
              disabled: busy,
              placeholder: state.external?.managementKeySet ? '已保存' : '管理密钥',
            }),
          ),
        ) : null,
        mode === 'internal' ? React.createElement('div', {
          style: { ...rowStyle, alignItems: 'flex-start', marginTop: '16px' },
        },
          numberField('端口', port, event => setPort(event.target.value)),
          textField('配置路径', configPath, event => setConfigPath(event.target.value), '默认 $DSH_HOME/cpa/config.yaml'),
        ) : null,
        React.createElement('div', {
          style: {
            ...rowStyle,
            alignItems: 'flex-start',
            marginTop: mode === 'internal' ? '8px' : '16px',
            paddingTop: '12px',
            borderTop: '1px solid var(--dsw-alias-border-l2)',
          },
        },
          React.createElement('span', {
            style: {
              width: '100%',
              fontWeight: '600',
              color: 'var(--dsw-alias-label-primary)',
            },
          }, '高级设置'),
          React.createElement('div', { style: fieldStyle },
            React.createElement('label', { style: labelStyle }, '路由策略'),
            React.createElement('select', {
              value: routingStrategy,
              onChange: event => setRoutingStrategy(event.target.value),
              disabled: busy,
              style: selectStyle,
            },
              React.createElement('option', { value: 'balanced' }, '平衡：健康度优先'),
              React.createElement('option', { value: 'quality' }, '质量：健康度和优先级'),
              React.createElement('option', { value: 'availability' }, '可用性：优先稳定账号'),
              React.createElement('option', { value: 'quota' }, '额度：优先剩余额度'),
            ),
          ),
          numberField('每日请求提醒（0=关闭）', dailyRequestLimit, event => setDailyRequestLimit(event.target.value), '0'),
          numberField('模型刷新间隔 (ms)', refreshIntervalMs, event => setRefreshIntervalMs(event.target.value)),
          numberField('auth-files 缓存 (ms)', authFilesTtlMs, event => setAuthFilesTtlMs(event.target.value)),
          numberField('quota 缓存 (ms)', quotaTtlMs, event => setQuotaTtlMs(event.target.value)),
          numberField('quota 并发', quotaConcurrency, event => setQuotaConcurrency(event.target.value)),
          textField('设置路径', settingsPath, event => setSettingsPath(event.target.value), '默认 $DSH_HOME/cpa/settings.json'),
          textField('执行记录路径', executionsPath, event => setExecutionsPath(event.target.value), '默认 $DSH_HOME/cpa/executions.json'),
        ),
        React.createElement('div', {
          style: { ...rowStyle, marginTop: '16px' },
        },
          React.createElement(Button, {
            variant: 'primary',
            onClick: () => { void apply() },
            disabled: busy,
          }, busy ? '处理中' : mode === 'internal' ? '启动' : '应用'),
          state.internalRunning ? React.createElement(Button, {
            variant: 'outline',
            icon: React.createElement(IconStopFill16),
            onClick: () => { void apply({ mode: 'off' }) },
            disabled: busy,
          }, '停止') : null,
        ),
        error ? React.createElement('div', {
          role: 'alert',
          style: {
            marginTop: '12px',
            fontSize: '13px',
            color: 'var(--dsw-alias-state-error-primary)',
          },
        }, error) : null,
        React.createElement(Modal, {
          open: panelOpen,
          onClose: () => setPanelOpen(false),
          title: 'CPA 管理面板',
          closeLabel: '关闭',
          className: 'dsh-cpa-management-dialog',
          contentClassName: 'dsh-cpa-management-content',
        },
          React.createElement('iframe', {
            src: PANEL_URL,
            title: 'CPA 管理面板',
          }),
        ),
      )

      async function apply(patch) {
        setBusy(true)
        setError('')
        const payload = patch || { mode }
        if (mode === 'external') {
          payload.externalUrl = externalUrl.trim()
          if (externalApiKey) payload.externalApiKey = externalApiKey
          if (externalManagementKey) payload.externalManagementKey = externalManagementKey
        } else if (mode === 'internal') {
          payload.internalBin = internalBin.trim()
          payload.usageStatisticsEnabled = usageStatisticsEnabled
        }
        payload.refreshIntervalMs = Number(refreshIntervalMs)
        payload.routingStrategy = routingStrategy
        payload.dailyRequestLimit = Number(dailyRequestLimit)
        if (mode === 'internal') {
          payload.port = Number(port)
          if (configPath.trim() !== '') payload.configPath = configPath.trim()
        }
        payload.authFilesTtlMs = Number(authFilesTtlMs)
        payload.quotaTtlMs = Number(quotaTtlMs)
        payload.quotaConcurrency = Number(quotaConcurrency)
        if (settingsPath.trim() !== '') payload.settingsPath = settingsPath.trim()
        if (executionsPath.trim() !== '') payload.executionsPath = executionsPath.trim()
        try {
          const response = await fetch(SETTINGS_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
          setState(body)
          setMode(body.mode === 'off' ? 'internal' : body.mode)
          setExternalUrl(body.external?.url || '')
          setInternalBin(body.bin || '')
          setUsageStatisticsEnabled(body.usageStatisticsEnabled !== false)
          setRoutingStrategy(body.routingStrategy || 'balanced')
          setDailyRequestLimit(String(body.dailyRequestLimit ?? dailyRequestLimit))
          setRefreshIntervalMs(String(body.refreshIntervalMs ?? refreshIntervalMs))
          setPort(String(body.port ?? port))
          setConfigPath(body.configPath || configPath)
          setSettingsPath(body.settingsPath || settingsPath)
          setExecutionsPath(body.executionsPath || executionsPath)
          setAuthFilesTtlMs(String(body.authFilesTtlMs ?? authFilesTtlMs))
          setQuotaTtlMs(String(body.quotaTtlMs ?? quotaTtlMs))
          setQuotaConcurrency(String(body.quotaConcurrency ?? quotaConcurrency))
          setExternalApiKey('')
          setExternalManagementKey('')
          setError(body.error || '')
        } catch (applyError) {
          setError(applyError.message)
        } finally {
          setBusy(false)
        }
      }
    }

    function CpaDiagnostics({ active, managementAvailable }) {
      const [diagnostics, setDiagnostics] = useState(null)
      const [error, setError] = useState('')
      const [refreshing, setRefreshing] = useState(false)
      const [exporting, setExporting] = useState(false)

      useEffect(() => {
        let cancelled = false
        async function load() {
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
      }, [active, managementAvailable])

      async function refresh() {
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

      async function exportReport() {
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

      const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : []
      const models = Array.isArray(diagnostics?.models) ? diagnostics.models.slice(0, 12) : []
      const modelAccounts = diagnostics?.modelAccounts && typeof diagnostics.modelAccounts === 'object'
        ? diagnostics.modelAccounts
        : {}
      const localUsage = diagnostics?.localUsage && typeof diagnostics.localUsage === 'object'
        ? diagnostics.localUsage
        : null
      const budget = diagnostics?.budget && typeof diagnostics.budget === 'object'
        ? diagnostics.budget
        : null
      const statusLabel = diagnostics?.status === 'healthy'
        ? '正常'
        : diagnostics?.status === 'warning'
          ? '需注意'
          : '不可用'
      const statusWarning = diagnostics?.status !== 'healthy'
      const header = React.createElement('div', { className: 'dsh-cpa-summary-header' },
        React.createElement('span', { className: 'dsh-cpa-summary-title' }, 'CPA 连接诊断'),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement(Button, {
            variant: 'outline',
            size: 'sm',
            onClick: () => { void refresh() },
            disabled: refreshing || exporting,
          }, refreshing ? '刷新中' : '重新检查'),
          React.createElement(Button, {
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
            className: `dsh-cpa-summary-list-row${check?.status === 'pass' ? '' : ' dsh-cpa-summary-list-warning'}`,
            key: check?.id || index,
          },
            React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, check?.id || '检查'),
            React.createElement('span', null, check?.detail || ''),
          )),
        )
        : React.createElement('div', { className: 'dsh-cpa-summary-status' }, error || '诊断加载中')
      const modelList = models.length > 0
        ? React.createElement('div', { className: 'dsh-cpa-summary-block' },
          React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, '模型能力'),
          React.createElement('div', { className: 'dsh-cpa-summary-list' },
            models.map((model, index) => {
              const accountCount = Array.isArray(modelAccounts[model?.id])
                ? modelAccounts[model.id].length
                : 0
              const context = Number(model?.contextLength)
              const contextText = Number.isFinite(context) && context > 0
                ? `上下文 ${Math.round(context / 1000)}k`
                : '上下文未知'
              const reasoning = Array.isArray(model?.reasoning?.efforts)
                ? `推理 ${model.reasoning.efforts.length} 档`
                : '普通模型'
              return React.createElement('div', {
                className: 'dsh-cpa-summary-list-row',
                key: model?.id || index,
              },
                React.createElement('span', { className: 'dsh-cpa-summary-list-main' }, model?.id || '未知模型'),
                React.createElement('span', null, contextText),
                React.createElement('span', null, reasoning),
                React.createElement('span', null, `可用账号 ${accountCount}`),
              )
            }),
          ),
        )
        : null
      const localUsageTotals = localUsage?.totals && typeof localUsage.totals === 'object'
        ? localUsage.totals
        : {}
      const localUsageBlock = localUsage
        ? React.createElement('div', { className: 'dsh-cpa-summary-block' },
          React.createElement('div', { className: 'dsh-cpa-summary-block-title' }, '本地执行（近 24 小时）'),
          React.createElement('div', { className: 'dsh-cpa-summary-grid' },
            React.createElement('span', { className: 'dsh-cpa-summary-item' },
              React.createElement('span', { className: 'dsh-cpa-summary-key' }, '请求'),
              React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatSummaryNumber(localUsageTotals.totalRequests)),
            ),
            React.createElement('span', { className: 'dsh-cpa-summary-item' },
              React.createElement('span', { className: 'dsh-cpa-summary-key' }, '失败'),
              React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatSummaryNumber(localUsageTotals.failedRequests)),
            ),
            React.createElement('span', { className: 'dsh-cpa-summary-item' },
              React.createElement('span', { className: 'dsh-cpa-summary-key' }, 'tokens'),
              React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatSummaryNumber(localUsageTotals.totalTokens)),
            ),
            React.createElement('span', { className: 'dsh-cpa-summary-item' },
              React.createElement('span', { className: 'dsh-cpa-summary-key' }, '保留记录'),
              React.createElement('span', { className: 'dsh-cpa-summary-value' }, formatSummaryNumber(localUsage.retainedRecords)),
            ),
            budget && summaryNumber(budget.dailyRequestLimit) > 0
              ? React.createElement('span', { className: 'dsh-cpa-summary-item' },
                React.createElement('span', { className: 'dsh-cpa-summary-key' }, '请求提醒'),
                React.createElement('span', {
                  className: `dsh-cpa-summary-value${budget.exceeded === true ? ' dsh-cpa-summary-list-warning' : ''}`,
                }, `${formatSummaryNumber(budget.requests)}/${formatSummaryNumber(budget.dailyRequestLimit)}`),
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

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'cpa',
        order: 25,
        label: 'CPA',
      }, CpaSettingsSection))
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cpa',
        order: 1,
      }, CpaDock))
    }

    return {
      name: 'dsh-cpa',
      inject: ['slots'],
      apply,
    }
  },
})
