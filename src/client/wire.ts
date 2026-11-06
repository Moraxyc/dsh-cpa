/** Wire contracts owned by the matching Host routes in this package. */

export type CpaMode = 'internal' | 'external' | 'off'
export type CpaRoutingStrategy = 'balanced' | 'quality' | 'availability' | 'quota'
export type QuotaRisk = 'unknown' | 'critical' | 'warning' | 'normal'
export type QuotaStatus = 'unknown' | 'exhausted' | 'low' | 'medium' | 'high' | 'full'

export interface QuotaWindow {
  id: string
  label: string
  remainingPercent: number | null
  resetLabel: string
  exhausted: boolean
  risk: QuotaRisk
}

export interface CpaQuotaReport {
  provider: string
  authIndex: string
  label: string
  planType: string
  status: QuotaStatus
  risk: QuotaRisk
  windows: QuotaWindow[]
  refreshedAt?: string
}

export interface CpaAccountPublic {
  authIndex: string
  label: string
  name?: string
  provider: string
  status: string
  source: string
  statusMessage?: string
  disabled: boolean
  unavailable: boolean
  success: number
  failed: number
  recentRequests: number
  planType: string
  priority?: number
  note?: string
  lastRefresh?: string
  nextRetryAfter?: string
  websockets?: boolean
  runtimeOnly?: boolean
  quotaAutoDisabled?: boolean
  baseUrl?: string
  prefix?: string
  modelAliases?: string[]
  disableCooling?: boolean
}

export interface CpaAccountSummary extends CpaAccountPublic {
  models: string[]
}

export interface CpaConfig {
  routingStrategy: string
  proxyUrl: string
  requestRetry: number
  maxRetryInterval: number
  debug: boolean
  requestLog: boolean
  loggingToFile: boolean
  usageStatisticsEnabled: boolean
  websocketAuth: boolean
  forceModelPrefix: boolean
  logsMaxTotalSizeMb: number
  errorLogsMaxFiles: number
}

export interface UsageTotals {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  successRate: number
}

export interface UsageModel extends UsageTotals {
  modelId: string
  firstRequestAt: string
  lastRequestAt: string
}

export interface CpaUsage {
  fetchedAt: string
  totals: UsageTotals
  models: UsageModel[]
}

export interface CpaSummaryError {
  source: string
  message: string
}

export interface CpaSummary {
  available: boolean
  fetchedAt: string
  instance: {
    version: string
    latestVersion: string
    updateAvailable: boolean
    config: CpaConfig
  }
  usage: CpaUsage
  accounts: CpaAccountSummary[]
  models: string[]
  errors: CpaSummaryError[]
}

export interface CpaReasoning {
  efforts: string[]
  defaultEffort?: string
}

export interface CpaModel {
  id: string
  displayName?: string
  contextLength?: number
  maxCompletionTokens?: number
  reasoning?: CpaReasoning
  inputModalities?: string[]
}

export interface QuotaObservationWindow {
  id: string
  label: string
  remainingPercent: number
  resetAt?: number
}

export interface QuotaObservation {
  provider: string
  windows: QuotaObservationWindow[]
  observedAt: number
}

export interface ExecutionRecord {
  authIndex?: string
  sessionId?: string
  provider: string
  model: string
  purpose: string
  outcome: string
  traceId: string
  requestId: string
  time: number
  inputTokens?: number
  outputTokens?: number
  requestedModel?: string
  attempt?: number
  route?: string[]
  preflightStatus?: 'ready' | 'warning' | 'blocked'
  preflightIssues?: string[]
  fallbackFrom?: string
  fallbackReason?: string
  errorCode?: string
  quota?: QuotaObservation
}

export interface CpaDiagnosticCheck {
  id: string
  status: 'pass' | 'warn' | 'fail' | 'unknown'
  detail: string
}

export interface LocalUsageTotals {
  totalRequests: number
  successRequests: number
  failedRequests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  successRate: number
}

export interface LocalUsageSummary {
  since: string
  fetchedAt: string
  retainedRecords: number
  totals: LocalUsageTotals
}

export interface CpaDiagnostics {
  available: boolean
  status: 'healthy' | 'warning' | 'unavailable'
  fetchedAt: string
  checks: CpaDiagnosticCheck[]
  models: CpaModel[]
  accounts: CpaAccountPublic[]
  quota: Record<string, CpaQuotaReport>
  modelAccounts: Record<string, string[]>
  localUsage: LocalUsageSummary
  budget: {
    dailyRequestLimit: number
    requests: number
    exceeded: boolean
  }
  errors: string[]
}

export interface CpaControllerState {
  mode: CpaMode
  active: boolean
  activeUrl: string
  internalRunning: boolean
  externalRunning: boolean
  managementAvailable: boolean
  external: {
    url: string
    apiKeySet: boolean
    managementKeySet: boolean
  }
  bin: string
  usageStatisticsEnabled: boolean
  routingStrategy: CpaRoutingStrategy
  dailyRequestLimit: number
  refreshIntervalMs: number
  port: number
  configPath: string
  settingsPath: string
  executionsPath: string
  authFilesTtlMs: number
  quotaTtlMs: number
  quotaConcurrency: number
  error: string
}
