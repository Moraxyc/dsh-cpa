import type * as React from 'react'
import type { CpaControllerState } from '../wire.js'
import { fetchCpaRuntimeState, PANEL_URL } from '../api.js'
import type { FormActions } from '../primitives.js'
import { clientRuntime } from '../runtime.js'
import { CpaDiagnosticsPanel } from './diagnostics.js'
import type { CpaFieldName, CpaFormProjection, CpaTextFieldName } from './form.js'
import { CpaDataSummary } from './summary.js'

export interface CpaPluginItemProps extends FormActions {
  useCpaCard<T>(selector: (snapshot: CpaFormProjection) => T): T
  view?: string
}

export function CpaPluginItem(props: CpaPluginItemProps): React.ReactNode {
  const { React, primitives } = clientRuntime()
  const form = props.useCpaCard(snapshot => snapshot)
  const [runtimeState, setRuntimeState] = React.useState<CpaControllerState | null>(null)
  const [runtimeError, setRuntimeError] = React.useState('')
  const [panelOpen, setPanelOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const body = await fetchCpaRuntimeState()
        if (!cancelled && 'mode' in body) {
          setRuntimeState(body)
          setRuntimeError('')
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : 'CPA 不可用')
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [form.saving])

  if (props.view === 'summary') {
    return '配置 CPA 运行方式、路由策略和缓存参数。'
  }

  const disabled = !form.writable || form.saving
  const mode = form.mode.text || runtimeState?.mode || 'internal'
  const statusText = runtimeState?.internalRunning
    ? '内部 CPA 运行中'
    : runtimeState?.externalRunning
      ? '外部 CPA 运行中'
      : 'CPA 已停止'
  const statusState = runtimeState?.active ? 'done' : 'warning'
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap',
  }
  const fieldStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '220px',
    flex: '1 1 280px',
  }
  const selectStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    minHeight: '32px',
    padding: '0 8px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: '8px',
    background: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
  }
  const edit = (name: CpaFieldName, text: string): void => { props.edit(name, text) }
  const field = (
    name: CpaTextFieldName,
    label: string,
    hint: string,
    numeric = false,
    placeholder = '',
  ): React.ReactElement => React.createElement(primitives.SettingsValueField, {
    id: `dsh-cpa-${name}`,
    label,
    hint,
    overriddenLabel: '已覆盖',
    resetLabel: '恢复默认',
    invalidLabel: '请输入有效值',
    numeric,
    placeholder,
    disabled,
    ...form[name],
    onEdit: text => edit(name, text),
    onReset: () => props.resetField(name),
  })
  const usageText = form.usageStatisticsEnabled.text
  const usageChecked = usageText === 'true'
    || (usageText === '' && runtimeState?.usageStatisticsEnabled !== false)

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
        React.createElement(primitives.StateDot, { state: statusState }),
        statusText,
      ),
      React.createElement('div', { style: rowStyle },
        runtimeState?.managementAvailable ? React.createElement(primitives.Button, {
          variant: 'outline',
          size: 'sm',
          icon: React.createElement(primitives.IconSettingsOutlineRegular ?? primitives.IconSettingsOutline14 ?? (() => null)),
          onClick: () => setPanelOpen(true),
        }, '管理面板') : null,
        runtimeState?.internalRunning ? React.createElement(primitives.Button, {
          variant: 'outline',
          size: 'sm',
          icon: React.createElement(primitives.IconStopFillRegular ?? primitives.IconStopFill16 ?? (() => null)),
          onClick: () => {
            edit('mode', 'off')
            props.save()
          },
          disabled,
        }, '停止') : null,
      ),
    ),
    React.createElement(CpaDataSummary, {
      active: runtimeState?.active === true,
      managementAvailable: runtimeState?.managementAvailable === true,
    }),
    React.createElement(CpaDiagnosticsPanel, {
      active: runtimeState?.active === true,
      managementAvailable: runtimeState?.managementAvailable === true,
    }),
    React.createElement(primitives.SettingsForm, {
      labels: {
        unavailable: 'CPA 配置暂不可用。',
        readOnly: '当前部署的 profile 配置为只读。',
        saveFailed: '保存失败，修改仍保留在当前表单中。',
        save: '保存',
        saving: '保存中…',
      },
      state: form,
      onSave: props.save,
      onDiscard: props.discard,
    },
      React.createElement('div', { style: rowStyle },
        React.createElement(primitives.Pill, {
          active: mode === 'internal',
          'aria-pressed': mode === 'internal',
          onClick: () => edit('mode', 'internal'),
          disabled,
        }, '内部 CPA'),
        React.createElement(primitives.Pill, {
          active: mode === 'external',
          'aria-pressed': mode === 'external',
          onClick: () => edit('mode', 'external'),
          disabled,
        }, '外部 CPA'),
      ),
      mode === 'internal' ? React.createElement('div', {
        style: { ...rowStyle, alignItems: 'flex-start', marginTop: '12px' },
      },
        React.createElement('div', { style: fieldStyle },
          field('internalBin', 'CPA 路径', '留空使用部署默认的 cli-proxy-api。', false, 'cli-proxy-api'),
          React.createElement('label', {
            style: { display: 'inline-flex', gap: '8px', alignItems: 'center', marginTop: '8px' },
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: usageChecked,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit('usageStatisticsEnabled', event.target.checked ? 'true' : 'false'),
              disabled,
            }),
            '使用统计',
          ),
        ),
        React.createElement('div', { style: { ...rowStyle, flex: '1 1 280px' } },
          field('port', '端口', '内部 CPA 使用的监听端口。', true, '8317'),
          field('configPath', '配置路径', '留空使用默认 $DSH_HOME/cpa/config.yaml。', false, '$DSH_HOME/cpa/config.yaml'),
        ),
      ) : null,
      mode === 'external' ? React.createElement('div', {
        style: { ...rowStyle, alignItems: 'flex-start', marginTop: '12px' },
      },
        React.createElement('div', { style: fieldStyle },
          field('externalUrl', 'URL', '外部 CPA 的 OpenAI-compatible base URL。', false, 'https://127.0.0.1:8317/v1'),
        ),
        React.createElement('div', { style: fieldStyle },
          React.createElement(primitives.SettingsSecretField, {
            id: 'dsh-cpa-external-api-key',
            label: 'API Key',
            hint: '密钥只写入 profile，不会在设置响应中返回。',
            text: form.externalApiKey.text,
            configured: form.externalApiKeyConfigured || runtimeState?.external?.apiKeySet === true,
            stateLabel: form.externalApiKeyConfigured || runtimeState?.external?.apiKeySet === true ? '已配置' : '未配置',
            disabled,
            onEdit: text => edit('externalApiKey', text),
          }),
        ),
        React.createElement('div', { style: fieldStyle },
          React.createElement(primitives.SettingsSecretField, {
            id: 'dsh-cpa-external-management-key',
            label: '管理密钥',
            hint: '用于读取 CPA 管理摘要和额度数据。',
            text: form.externalManagementKey.text,
            configured: form.externalManagementKeyConfigured || runtimeState?.external?.managementKeySet === true,
            stateLabel: form.externalManagementKeyConfigured || runtimeState?.external?.managementKeySet === true ? '已配置' : '未配置',
            disabled,
            onEdit: text => edit('externalManagementKey', text),
          }),
        ),
      ) : null,
      React.createElement('div', {
        style: {
          ...rowStyle,
          alignItems: 'flex-start',
          marginTop: '16px',
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
          React.createElement('label', { style: { display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } }, '路由策略'),
          React.createElement('select', {
            value: form.routingStrategy.text || 'balanced',
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) => edit('routingStrategy', event.target.value),
            disabled,
            style: selectStyle,
          },
            React.createElement('option', { value: 'balanced' }, '平衡：健康度优先'),
            React.createElement('option', { value: 'quality' }, '质量：健康度和优先级'),
            React.createElement('option', { value: 'availability' }, '可用性：优先稳定账号'),
            React.createElement('option', { value: 'quota' }, '额度：优先剩余额度'),
          ),
        ),
        field('dailyRequestLimit', '每日请求提醒（0=关闭）', '软阈值，只在诊断中提示，不会阻断请求。', true, '0'),
        field('refreshIntervalMs', '模型刷新间隔 (ms)', '定期重新读取 CPA 模型目录。', true, '300000'),
        field('authFilesTtlMs', 'auth-files 缓存 (ms)', '认证文件读取缓存时长。', true, '30000'),
        field('quotaTtlMs', 'quota 缓存 (ms)', 'quota 管理数据缓存时长。', true, '60000'),
        field('quotaConcurrency', 'quota 并发', '同时读取的 quota 请求数。', true, '4'),
        field('settingsPath', '旧设置路径', '仅用于兼容读取旧版 settings.json；profile 设置为主。', false, '$DSH_HOME/cpa/settings.json'),
        field('executionsPath', '执行记录路径', '留空使用默认 $DSH_HOME/cpa/executions.json。', false, '$DSH_HOME/cpa/executions.json'),
      ),
    ),
    runtimeError !== '' || (runtimeState?.error !== undefined && runtimeState.error !== '')
      ? React.createElement('div', {
        role: 'alert',
        style: {
          marginTop: '12px',
          fontSize: '13px',
          color: 'var(--dsw-alias-state-error-primary)',
        },
      }, runtimeError || runtimeState?.error)
      : null,
    React.createElement(primitives.Modal, {
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
}
