import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { CpaModel } from './config.js'

export interface CpaRouteAccount {
  authIndex: string
  modelAliases?: readonly string[]
  disabled?: boolean
  unavailable?: boolean
  quotaAutoDisabled?: boolean
  priority?: number
}

export interface CpaRouteWindow {
  id: string
  label: string
  remainingPercent: number | null
  exhausted: boolean
}

export interface CpaRouteQuota {
  status: string
  windows: readonly CpaRouteWindow[]
}

export interface CpaRouteSnapshot {
  models: readonly CpaModel[]
  accounts: readonly CpaRouteAccount[]
  quota: Readonly<Record<string, CpaRouteQuota>>
  defaultContextWindow: number
  defaultMaxTokens: number
}

interface ModelQuotaScore {
  remaining: number | null
  exhausted: boolean
  priority: number
}

const DEFAULT_MAX_ATTEMPTS = 3

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function supportsReasoning(model: CpaModel, effort: string | undefined): boolean {
  if (effort === undefined || model.reasoning === undefined) return true
  return model.reasoning.efforts.some(candidate => normalized(candidate.id) === normalized(effort))
}

function estimateInputTokens(options: Pick<GenerateOptions, 'messages' | 'system'>): number {
  const systemLength = options.system?.length ?? 0
  const messageLength = options.messages.reduce((total, message) => total + JSON.stringify(message.content).length, 0)
  return Math.ceil((systemLength + messageLength) / 4)
}

function fitsContext(
  model: CpaModel,
  inputTokens: number,
  maxTokens: number,
  defaultContextWindow: number,
): boolean {
  const contextWindow = model.contextLength ?? defaultContextWindow
  return inputTokens + maxTokens <= contextWindow
}

function accountSupportsModel(account: CpaRouteAccount, model: string): boolean {
  return account.modelAliases?.some(alias => normalized(alias) === normalized(model)) ?? false
}

function scoreWindows(windows: readonly CpaRouteWindow[]): Pick<ModelQuotaScore, 'remaining' | 'exhausted'> {
  if (windows.length === 0) return { remaining: null, exhausted: false }
  const values = windows
    .map(window => window.remainingPercent)
    .filter((value): value is number => value !== null)
  return {
    remaining: values.length === 0 ? null : Math.min(...values),
    exhausted: windows.some(window => window.exhausted),
  }
}

function quotaForModel(
  model: string,
  snapshot: CpaRouteSnapshot,
): ModelQuotaScore {
  const accounts = snapshot.accounts.filter(account =>
    !account.disabled
    && !account.unavailable
    && !account.quotaAutoDisabled
    && (account.modelAliases === undefined || accountSupportsModel(account, model)),
  )
  if (accounts.length === 0 && snapshot.accounts.length > 0) {
    return { remaining: null, exhausted: true, priority: 0 }
  }

  const scores: ModelQuotaScore[] = []
  for (const account of accounts) {
    const report = snapshot.quota[account.authIndex]
    if (report === undefined) {
      scores.push({ remaining: null, exhausted: false, priority: account.priority ?? 0 })
      continue
    }
    const modelWindows = report.windows.filter(window =>
      normalized(window.id) === normalized(model) || normalized(window.label).includes(normalized(model)),
    )
    const windows = modelWindows.length > 0 ? modelWindows : report.windows
    scores.push({ ...scoreWindows(windows), priority: account.priority ?? 0 })
  }

  if (accounts.length === 0) {
    for (const report of Object.values(snapshot.quota)) {
      const modelWindows = report.windows.filter(window =>
        normalized(window.id) === normalized(model) || normalized(window.label).includes(normalized(model)),
      )
      scores.push({ ...scoreWindows(modelWindows.length > 0 ? modelWindows : report.windows), priority: 0 })
    }
  }

  const healthy = scores.filter(score => !score.exhausted)
  if (healthy.length === 0) {
    return scores[0] ?? { remaining: null, exhausted: false, priority: 0 }
  }
  return healthy.sort((left, right) => {
    const leftRemaining = left.remaining ?? -1
    const rightRemaining = right.remaining ?? -1
    if (rightRemaining !== leftRemaining) return rightRemaining - leftRemaining
    return right.priority - left.priority
  })[0] ?? { remaining: null, exhausted: false, priority: 0 }
}

export function selectCpaModels(
  options: Pick<GenerateOptions, 'model' | 'messages' | 'system' | 'maxTokens' | 'reasoningEffort'>,
  snapshot: CpaRouteSnapshot,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): string[] {
  const requested = options.model
  const inputTokens = estimateInputTokens(options)
  const maxTokens = options.maxTokens ?? snapshot.defaultMaxTokens
  const effort = options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort)
  const candidates = snapshot.models
    .filter(model => model.id !== requested)
    .filter(model => supportsReasoning(model, effort))
    .filter(model => fitsContext(model, inputTokens, maxTokens, snapshot.defaultContextWindow))
    .map(model => {
      const quota = quotaForModel(model.id, snapshot)
      return {
        id: model.id,
        exhausted: quota.exhausted,
        remaining: quota.remaining ?? -1,
        priority: quota.priority,
      }
    })
    .filter(model => !model.exhausted)
    .sort((left, right) => {
      if (right.remaining !== left.remaining) return right.remaining - left.remaining
      if (right.priority !== left.priority) return right.priority - left.priority
      return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: 'base' })
    })

  return [requested, ...candidates.map(candidate => candidate.id)].slice(0, Math.max(1, maxAttempts))
}
