import type { CpaAccountPublic, CpaQuotaReport, ExecutionRecord, QuotaWindow } from './wire.js'

const PROVIDER_LABELS = new Map<string, string>([
  ['codex', 'Codex'],
  ['gemini-cli', 'Gemini'],
  ['antigravity', 'Antigravity'],
  ['claude', 'Claude'],
  ['anthropic', 'Claude'],
  ['openai', 'OpenAI'],
  ['openai-compatibility', 'OpenAI'],
  ['openai-compatible', 'OpenAI'],
  ['gemini', 'Gemini'],
  ['vertex', 'Vertex'],
  ['aistudio', 'AI Studio'],
  ['xai', 'xAI'],
  ['interactions', 'Interactions'],
  ['qwen', 'Qwen'],
  ['kimi', 'Kimi'],
  ['iflow', 'iFlow'],
  ['deepseek', 'DeepSeek'],
  ['zhipu', '智谱'],
  ['doubao', '豆包'],
  ['api', 'API'],
])

export type AccountView = Partial<CpaAccountPublic>
export type QuotaMap = Readonly<Record<string, CpaQuotaReport>>

export function providerLabel(provider: string | undefined): string {
  const key = String(provider ?? '').toLowerCase()
  if (key === '' || key === 'unknown' || key === 'cpa') return ''
  return PROVIDER_LABELS.get(key)
    ?? key.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

export function providerFromModel(model: string | undefined): string {
  const value = String(model ?? '').toLowerCase()
  const bare = value.split('/').pop() ?? ''
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

export function positiveCount(value: number | null | undefined): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function accountLabel(account: AccountView | undefined): string {
  if (account === undefined) return ''
  const label = account.label?.trim() ?? ''
  if (label !== '') return label
  return account.authIndex !== undefined && account.authIndex !== ''
    ? `账号 ${account.authIndex}`
    : ''
}

export function labelMentionsProvider(label: string, provider: string): boolean {
  if (label === '' || provider === '') return false
  return label.toLowerCase().includes(provider.toLowerCase())
}

export function planType(account: AccountView | undefined): string {
  return account?.planType?.trim() ?? ''
}

export function planLabel(account: AccountView | undefined): string {
  const plan = planType(account)
  if (plan === '') return ''
  const labels = new Map<string, string>([
    ['plus', 'Plus'],
    ['pro', 'Pro'],
    ['free', 'Free'],
    ['team', 'Team'],
    ['teams', 'Teams'],
    ['enterprise', 'Enterprise'],
  ])
  return labels.get(plan.toLowerCase()) ?? plan
}

export function sourceLabel(account: AccountView | undefined): string {
  const source = account?.source?.toLowerCase() ?? ''
  if (source === 'api-key') return 'API Key'
  if (source === 'file' || source === 'auth-file') return '认证文件'
  if (source === 'memory') return '运行态'
  return source
}

export function accountStatus(account: AccountView | undefined): string {
  if (account === undefined) return ''
  if (account.quotaAutoDisabled === true) return '停用'
  if (account.disabled === true) return '停用'
  if (account.unavailable === true) return '不可用'
  const status = account.status?.trim().toLowerCase() ?? ''
  if (status === 'disabled' || status === 'inactive' || status === 'blocked') return '停用'
  if (status === 'unavailable' || status === 'error' || status === 'failed') return '不可用'
  return ''
}

export function resolveAccount(
  accounts: readonly CpaAccountPublic[],
  execution: ExecutionRecord | null | undefined,
): AccountView | undefined {
  if (execution === null || execution === undefined) return undefined
  const authIndex = execution.authIndex
  if (authIndex !== undefined && authIndex !== '') {
    const matched = accounts.find(account => account.authIndex === authIndex)
    if (matched !== undefined) return matched
    const provider = providerFromModel(execution.model) || execution.provider
    return provider === '' ? undefined : { provider }
  }
  const provider = providerFromModel(execution.model)
  return provider === '' ? undefined : { provider }
}

export function reportWindows(
  quota: QuotaMap | undefined,
  authIndex: string | undefined,
): readonly QuotaWindow[] {
  if (authIndex === undefined || authIndex === '') return []
  return quota?.[authIndex]?.windows ?? []
}

export function windowPercent(window: QuotaWindow | undefined): number | null {
  if (window === undefined) return null
  return window.remainingPercent
}

export function preferredWindow(windows: readonly QuotaWindow[]): QuotaWindow | undefined {
  const values = windows.filter(window => windowPercent(window) !== null)
  return values.find(window => window.id === 'code-5h')
    ?? values.find(window => window.id === 'code-7d')
    ?? values[0]
}

export function accountCore(account: AccountView): string {
  const parts: string[] = []
  const label = accountLabel(account)
  const provider = providerLabel(account.provider)
  const plan = planLabel(account)
  if (provider !== '' && !labelMentionsProvider(label, provider)) parts.push(provider)
  if (plan !== '') parts.push(plan)
  const status = accountStatus(account)
  if (status !== '') parts.push(status)
  const success = positiveCount(account.success)
  const failed = positiveCount(account.failed)
  if (success > 0 || failed > 0) parts.push(`成功 ${success} · 失败 ${failed}`)
  return parts.join(' · ')
}

export function routeIssueLabel(code: string): string {
  const labels = new Map<string, string>([
    ['MODEL_NOT_SYNCED', '模型目录未同步'],
    ['REASONING_UNSUPPORTED', '不支持当前推理级别'],
    ['CONTEXT_WINDOW_EXCEEDED', '超出上下文窗口'],
    ['MAX_COMPLETION_EXCEEDED', '超过模型输出上限'],
    ['QUOTA_EXHAUSTED', '额度已耗尽'],
    ['ACCOUNT_UNAVAILABLE', '账号不可用'],
  ])
  return labels.get(code) ?? code
}

export function fallbackReasonLabel(code: string | undefined): string {
  const labels = new Map<string, string>([
    ['QUOTA', '额度耗尽'],
    ['RATE_LIMIT', '触发限流'],
    ['SERVER', '服务端错误'],
    ['TRANSPORT', '网络错误'],
    ['EMPTY_RESPONSE', '空响应'],
    ['STREAM_CLOSED', '流提前结束'],
    ['HTTP_408', '请求超时'],
    ['HTTP_502', '网关错误'],
    ['HTTP_503', '服务不可用'],
    ['HTTP_504', '网关超时'],
  ])
  if (code === undefined || code === '') return '请求失败'
  return labels.get(code) ?? code
}

export function executionTimeline(executions: readonly ExecutionRecord[] | undefined): string {
  if (executions === undefined || executions.length === 0) return ''
  return [...executions]
    .sort((left, right) => Number(left.attempt ?? 0) - Number(right.attempt ?? 0))
    .map(item => {
      const model = item.model === '' ? '未知模型' : item.model
      if (item.outcome === 'failure') {
        return `${model} 失败${item.errorCode === undefined ? '' : `（${fallbackReasonLabel(item.errorCode)}）`}`
      }
      return `${model} 成功`
    })
    .join(' → ')
}
