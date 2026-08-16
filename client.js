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
    const PANEL_URL = '/dsh-cpa/management'
    const EXECUTION_STATUS_URL = '/dsh-cpa/execution-status'
    const STYLE_ID = 'dsh-cpa-client'
    const READOUT_REFRESH_MS = 60_000

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
      return window && percent !== null ? `${window.label} ${Math.round(percent)}%` : ''
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
        if (execution && typeof execution.model === 'string' && execution.model !== '') {
          parts.push(execution.model)
        }
      }
      return parts.join(' · ')
    }

    function detailRows(accounts, quota, execution) {
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
      }
      return rows
    }

    function accountNeedsWarning(account, quota, execution) {
      if (execution?.outcome === 'failure') return true
      if (!account || account === null || typeof account !== 'object') return false
      if (account.disabled === true || account.unavailable === true) return true
      if (accountStatus(account) !== '') return true
      if (positiveCount(account.failed) > 0) return true
      const window = preferredWindow(reportWindows(quota, account.authIndex))
      return Boolean(window && windowPercent(window) <= 5)
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
      const details = detailRows(accounts, readout?.quota, execution)
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

    function CpaSettingsSection() {
      const [state, setState] = useState(null)
      const [mode, setMode] = useState('internal')
      const [externalUrl, setExternalUrl] = useState('')
      const [externalApiKey, setExternalApiKey] = useState('')
      const [externalManagementKey, setExternalManagementKey] = useState('')
      const [internalBin, setInternalBin] = useState('')
      const [usageStatisticsEnabled, setUsageStatisticsEnabled] = useState(true)
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
      function numberField(label, value, onChange) {
        return React.createElement('div', { style: fieldStyle },
          React.createElement('label', { style: labelStyle }, label),
          React.createElement(Input, {
            type: 'number',
            min: '1',
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
