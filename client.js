window.__ModuleLoader__.load({
  id: 'dsh-cpa',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const {
      Button,
      IconSettingsOutline14,
      IconStopFill16,
      Input,
      Modal,
      Pill,
      StateDot,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const SETTINGS_URL = '/dsh-cpa/settings'
    const PANEL_URL = '/dsh-cpa/management'
    const STYLE_ID = 'dsh-cpa-client'

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
      `
      document.head.appendChild(style)
    }

    function CpaSettingsSection() {
      const [state, setState] = useState(null)
      const [mode, setMode] = useState('internal')
      const [externalUrl, setExternalUrl] = useState('')
      const [externalApiKey, setExternalApiKey] = useState('')
      const [externalManagementKey, setExternalManagementKey] = useState('')
      const [internalBin, setInternalBin] = useState('')
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
        }
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
    }

    return {
      name: 'dsh-cpa',
      inject: ['slots'],
      apply,
    }
  },
})
