import { isArray, asJsonRecord, isError, isJsonRecord, isNonEmptyString, isString } from '../core/json.js'
import type { JsonRecord, JsonValue } from '../core/json.js'
import {
  fetchApiProviders,
  fetchAuthFiles,
  managementApi,
  managementApiWithHeaders,
  optionValue,
  publicAccount,
  resolvedOption,
} from './quota.js'
import type { CpaAccountPublic, OptionSource } from './quota.js'

const DEFAULT_DATA_TTL_MS = 30_000
const DEFAULT_MODEL_TTL_MS = 60_000
const DEFAULT_MODEL_CONCURRENCY = 4
const MAX_MODELS = 200

export interface UsageTotals {
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  successRate: number
}

export interface UsageModel {
  modelId: string
  totalRequests: number
  successRequests: number
  failedRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  successRate: number
  firstRequestAt: string
  lastRequestAt: string
}

export interface CpaUsage {
  fetchedAt: string
  totals: UsageTotals
  models: UsageModel[]
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

export interface CpaSummaryError {
  source: string
  message: string
}

export interface CpaAccountSummary extends CpaAccountPublic {
  models: string[]
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

export interface CpaDataServiceOptions {
  baseURL: OptionSource<string>
  managementKey: OptionSource<string>
  dataTtlMs?: OptionSource<number>
  modelTtlMs?: OptionSource<number>
  concurrency?: OptionSource<number>
}

interface CacheResult<T> {
  value: T
  error: unknown
}

interface CacheStore<T> {
  fetchedAt: number
  value: T
  promise: Promise<CacheResult<T>> | undefined
}

interface ModelCacheEntry {
  fetchedAt: number
  models: string[]
  error: unknown
}

interface AccountsValue {
  accounts: CpaAccountPublic[]
  errors: CpaSummaryError[]
}

interface ConfigValue {
  config: CpaConfig
  version: string
}

interface ModelError extends CpaSummaryError {
  name: string
}

interface ModelRefreshResult {
  byName: Map<string, string[]>
  errors: ModelError[]
}

export interface UsagePayload {
  statistics?: JsonValue
}

function sourceValue(source: JsonRecord | null | undefined, keys: readonly string[]): JsonValue | undefined {
  for (const key of keys) {
    const value = source?.[key]
    if (value === undefined || value === null || value === '') continue
    return value
  }
  return undefined
}

function safeString(value: JsonValue | undefined, maxLength = 200): string {
  return isString(value) ? value.trim().slice(0, maxLength) : ''
}

function safeNumber(value: JsonValue | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function integerNumber(value: JsonValue | undefined): number {
  return Math.floor(safeNumber(value))
}

function safeBoolean(value: JsonValue | undefined): boolean {
  return value === true
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function errorMessage(cause: unknown): string {
  const message = isError(cause) ? cause.message : String(cause)
  return message.slice(0, 200)
}

function sortStrings(values: string[]): string[] {
  return values.sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

function emptyTotals(): UsageTotals {
  return {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    successRate: 0,
  }
}

export function emptyUsage(fetchedAt = ''): CpaUsage {
  return {
    fetchedAt,
    totals: emptyTotals(),
    models: [],
  }
}

function addTotal(total: number, value: JsonValue | undefined): number {
  return total + safeNumber(value)
}

function apiKeyUsageStatistics(payload: JsonValue | undefined): JsonRecord {
  const statistics: JsonRecord = {}
  const source = asJsonRecord(payload)
  if (source === null) return statistics
  for (const [provider, entries] of Object.entries(source)) {
    const providerName = safeString(provider, 80)
    if (providerName === '' || !isJsonRecord(entries)) continue
    let success = 0
    let failed = 0
    for (const entry of Object.values(entries)) {
      if (!isJsonRecord(entry)) continue
      success += safeNumber(sourceValue(entry, ['success_requests', 'successRequests', 'success']))
      failed += safeNumber(sourceValue(entry, ['failed_requests', 'failedRequests', 'failed']))
    }
    if (success + failed === 0) continue
    statistics[`${providerName} API`] = {
      total_requests: success + failed,
      success_requests: success,
      failed_requests: failed,
    }
  }
  return statistics
}

function emptyUsageModel(modelId: string): UsageModel {
  return {
    modelId,
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    successRate: 0,
    firstRequestAt: '',
    lastRequestAt: '',
  }
}

function mergeUsageEntry(usage: CpaUsage, modelId: string, success: number, failed: number): CpaUsage {
  const totals = { ...usage.totals }
  const models = usage.models.map(entry => ({ ...entry }))
  let current = models.find(entry => entry.modelId === modelId)
  if (current === undefined) {
    current = emptyUsageModel(modelId)
    models.push(current)
  }
  current.successRequests += safeNumber(success)
  current.failedRequests += safeNumber(failed)
  current.totalRequests = current.successRequests + current.failedRequests
  current.successRate = current.totalRequests > 0
    ? clampRatio(current.successRequests / current.totalRequests)
    : 0
  totals.successRequests = addTotal(totals.successRequests, success)
  totals.failedRequests = addTotal(totals.failedRequests, failed)
  totals.totalRequests = addTotal(totals.totalRequests, success + failed)
  totals.successRate = totals.totalRequests > 0
    ? clampRatio(totals.successRequests / totals.totalRequests)
    : 0
  return { fetchedAt: usage.fetchedAt, totals, models }
}

function mergeAccountUsage(usage: CpaUsage, accounts: CpaAccountPublic[]): CpaUsage {
  let next = usage
  for (const account of accounts) {
    const success = safeNumber(account.success)
    const failed = safeNumber(account.failed)
    if (success + failed === 0) continue
    const modelId = [account.provider, account.label].filter(Boolean).join(' / ') || account.authIndex || 'unknown'
    next = mergeUsageEntry(next, modelId, success, failed)
  }
  if (next === usage) return usage
  next.models.sort((left, right) => left.modelId.localeCompare(right.modelId, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
  return next
}

export function normalizeUsage(payload: UsagePayload | undefined, fetchedAt = new Date()): CpaUsage {
  const statisticsValue = payload?.statistics
  const statistics = isJsonRecord(statisticsValue) ? statisticsValue : {}
  const totals = emptyTotals()
  const models: UsageModel[] = []
  for (const [modelId, entry] of Object.entries(statistics)) {
    if (modelId === '' || !isJsonRecord(entry)) continue
    const totalRequests = safeNumber(sourceValue(entry, ['total_requests', 'totalRequests']))
    const successRequests = safeNumber(sourceValue(entry, ['success_requests', 'successRequests']))
    const failedRequests = safeNumber(sourceValue(entry, ['failed_requests', 'failedRequests']))
    const totalPromptTokens = safeNumber(sourceValue(entry, ['total_prompt_tokens', 'totalPromptTokens']))
    const totalCompletionTokens = safeNumber(sourceValue(entry, ['total_completion_tokens', 'totalCompletionTokens']))
    const totalTokens = safeNumber(sourceValue(entry, ['total_tokens', 'totalTokens']))
    models.push({
      modelId,
      totalRequests,
      successRequests,
      failedRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      successRate: totalRequests > 0 ? clampRatio(successRequests / totalRequests) : 0,
      firstRequestAt: safeString(sourceValue(entry, ['first_request_at', 'firstRequestAt']), 80),
      lastRequestAt: safeString(sourceValue(entry, ['last_request_at', 'lastRequestAt']), 80),
    })
    totals.totalRequests = addTotal(totals.totalRequests, totalRequests)
    totals.successRequests = addTotal(totals.successRequests, successRequests)
    totals.failedRequests = addTotal(totals.failedRequests, failedRequests)
    totals.totalPromptTokens = addTotal(totals.totalPromptTokens, totalPromptTokens)
    totals.totalCompletionTokens = addTotal(totals.totalCompletionTokens, totalCompletionTokens)
    totals.totalTokens = addTotal(totals.totalTokens, totalTokens)
  }
  models.sort((left, right) => left.modelId.localeCompare(right.modelId, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
  totals.successRate = totals.totalRequests > 0
    ? clampRatio(totals.successRequests / totals.totalRequests)
    : 0
  return {
    fetchedAt: fetchedAt.toISOString(),
    totals,
    models,
  }
}

export function emptyConfig(): CpaConfig {
  return {
    routingStrategy: '',
    proxyUrl: '',
    requestRetry: 0,
    maxRetryInterval: 0,
    debug: false,
    requestLog: false,
    loggingToFile: false,
    usageStatisticsEnabled: false,
    websocketAuth: false,
    forceModelPrefix: false,
    logsMaxTotalSizeMb: 0,
    errorLogsMaxFiles: 0,
  }
}

function configSource(payload: JsonValue | undefined): JsonRecord | null {
  const record = asJsonRecord(payload)
  if (record === null) return null
  return isJsonRecord(record.config) ? record.config : record
}

function sanitizeProxyUrl(value: JsonValue | undefined): string {
  const text = safeString(value, 1000)
  if (text === '') return ''
  try {
    const parsed = new URL(text)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return text
  }
}

export function normalizeConfig(payload: JsonValue | undefined): CpaConfig {
  const source = configSource(payload)
  return {
    routingStrategy: safeString(sourceValue(source, ['routing-strategy', 'routing_strategy', 'routingStrategy']), 100),
    proxyUrl: sanitizeProxyUrl(sourceValue(source, ['proxy-url', 'proxy_url', 'proxyUrl'])),
    requestRetry: integerNumber(sourceValue(source, ['request-retry', 'request_retry', 'requestRetry'])),
    maxRetryInterval: integerNumber(sourceValue(source, ['max-retry-interval', 'max_retry_interval', 'maxRetryInterval'])),
    debug: safeBoolean(sourceValue(source, ['debug'])),
    requestLog: safeBoolean(sourceValue(source, ['request-log', 'request_log', 'requestLog'])),
    loggingToFile: safeBoolean(sourceValue(source, ['logging-to-file', 'logging_to_file', 'loggingToFile'])),
    usageStatisticsEnabled: safeBoolean(sourceValue(source, [
      'usage-statistics-enabled',
      'usage_statistics_enabled',
      'usageStatisticsEnabled',
    ])),
    websocketAuth: safeBoolean(sourceValue(source, ['websocket-auth', 'websocket_auth', 'websocketAuth'])),
    forceModelPrefix: safeBoolean(sourceValue(source, ['force-model-prefix', 'force_model_prefix', 'forceModelPrefix'])),
    logsMaxTotalSizeMb: integerNumber(sourceValue(source, [
      'logs-max-total-size-mb',
      'logs_max_total_size_mb',
      'logsMaxTotalSizeMb',
    ])),
    errorLogsMaxFiles: integerNumber(sourceValue(source, [
      'error-logs-max-files',
      'error_logs_max_files',
      'errorLogsMaxFiles',
    ])),
  }
}

export function normalizeVersion(payload: JsonValue | undefined): string {
  return safeString(sourceValue(asJsonRecord(payload), ['latest-version', 'latestVersion']), 80)
}

function versionParts(value: string): [number, number, number] | undefined {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (match === null) return undefined
  const parts = match.slice(1).map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function hasNewerVersion(current: string, latest: string): boolean {
  const left = versionParts(current)
  const right = versionParts(latest)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined || rightPart === undefined) return false
    if (leftPart > rightPart) return false
    if (leftPart < rightPart) return true
  }
  return false
}

export function normalizeAuthFileModels(payload: JsonValue | undefined): string[] {
  let entries: JsonValue[] = []
  if (isArray(payload)) {
    entries = payload
  } else if (isJsonRecord(payload)) {
    if (isArray(payload.models)) {
      entries = payload.models
    } else if (isArray(payload.data)) {
      entries = payload.data
    } else if (isJsonRecord(payload.models)) {
      entries = Object.keys(payload.models)
    }
  }
  const models: string[] = []
  for (const entry of entries) {
    const id = isString(entry)
      ? safeString(entry, 240)
      : safeString(sourceValue(asJsonRecord(entry), ['model', 'model_id', 'modelId', 'id', 'name']), 240)
    if (id !== '' && !models.includes(id)) models.push(id)
  }
  return sortStrings(models).slice(0, MAX_MODELS)
}

export interface CpaSummaryInput {
  available?: boolean
  errors?: CpaSummaryError[]
  fetchedAt?: Date | string
}

export function emptyCpaSummary(input: CpaSummaryInput = {}): CpaSummary {
  const { available = false, errors = [], fetchedAt = new Date() } = input
  return {
    available,
    fetchedAt: fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt || new Date().toISOString()),
    instance: {
      version: '',
      latestVersion: '',
      updateAvailable: false,
      config: emptyConfig(),
    },
    usage: emptyUsage(),
    accounts: [],
    models: [],
    errors: [...errors],
  }
}

export class CpaDataService {
  readonly options: CpaDataServiceOptions
  readonly usageCache: CacheStore<CpaUsage>
  readonly configCache: CacheStore<ConfigValue>
  readonly versionCache: CacheStore<string>
  readonly accountsCache: CacheStore<AccountsValue>
  readonly modelCache = new Map<string, ModelCacheEntry>()
  readonly inFlight = new Map<string, Promise<ModelCacheEntry>>()

  constructor(options: CpaDataServiceOptions) {
    this.options = options
    this.usageCache = { fetchedAt: 0, value: emptyUsage(), promise: undefined }
    this.configCache = {
      fetchedAt: 0,
      value: { config: emptyConfig(), version: '' },
      promise: undefined,
    }
    this.versionCache = { fetchedAt: 0, value: '', promise: undefined }
    this.accountsCache = { fetchedAt: 0, value: { accounts: [], errors: [] }, promise: undefined }
  }

  async cached<T>(
    store: CacheStore<T>,
    ttlKey: 'dataTtlMs',
    now: number,
    load: () => Promise<T>,
  ): Promise<CacheResult<T>> {
    const ttl = optionValue(this.options[ttlKey]) ?? DEFAULT_DATA_TTL_MS
    if (now - store.fetchedAt < ttl) {
      return { value: store.value, error: undefined }
    }
    if (store.promise !== undefined) return store.promise
    const promise = (async () => {
      try {
        const value = await load()
        store.fetchedAt = now
        store.value = value
        return { value, error: undefined }
      } catch (error) {
        return { value: store.value, error }
      }
    })()
    store.promise = promise
    try {
      return await promise
    } finally {
      if (store.promise === promise) store.promise = undefined
    }
  }

  async loadUsage(now: Date): Promise<CpaUsage> {
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const body = await managementApi(baseURL, managementKey, '/v0/management/api-key-usage')
    return normalizeUsage({ statistics: apiKeyUsageStatistics(body) }, now)
  }

  async loadConfig(_now: Date): Promise<ConfigValue> {
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const { body, headers } = await managementApiWithHeaders(baseURL, managementKey, '/v0/management/config')
    const headerVersion = safeString(
      headers.get('x-cpa-version') || headers.get('x-server-version') || headers.get('x-cpa-home-version'),
      80,
    )
    return {
      config: normalizeConfig(body),
      version: safeString(
        sourceValue(configSource(body), ['version', 'current-version', 'current_version', 'currentVersion'])
          ?? sourceValue(asJsonRecord(body), ['version', 'current-version', 'current_version', 'currentVersion'])
          ?? headerVersion,
        80,
      ),
    }
  }

  async loadLatestVersion(): Promise<string> {
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const body = await managementApi(baseURL, managementKey, '/v0/management/latest-version')
    return normalizeVersion(body)
  }

  async loadAccounts(): Promise<AccountsValue> {
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const [filesResult, providersResult] = await Promise.allSettled([
      fetchAuthFiles(baseURL, managementKey),
      fetchApiProviders(baseURL, managementKey),
    ])
    const accounts: CpaAccountPublic[] = []
    const errors: CpaSummaryError[] = []
    if (filesResult.status === 'fulfilled') {
      accounts.push(...filesResult.value.map(publicAccount))
    } else {
      errors.push({ source: 'auth-files', message: errorMessage(filesResult.reason) })
    }
    if (providersResult.status === 'fulfilled') {
      accounts.push(...providersResult.value)
    } else {
      errors.push({ source: 'api-providers', message: errorMessage(providersResult.reason) })
    }
    if (accounts.length === 0 && errors.length > 0) {
      throw new Error(errors.map(error => error.message).join('; '))
    }
    return { accounts, errors }
  }

  async refreshCore(now: number): Promise<{
    usageResult: PromiseSettledResult<CacheResult<CpaUsage>>
    configResult: PromiseSettledResult<CacheResult<ConfigValue>>
    versionResult: PromiseSettledResult<CacheResult<string>>
    accountsResult: PromiseSettledResult<CacheResult<AccountsValue>>
  }> {
    const [usageResult, configResult, versionResult, accountsResult] = await Promise.allSettled([
      this.cached(this.usageCache, 'dataTtlMs', now, () => this.loadUsage(new Date(now))),
      this.cached(this.configCache, 'dataTtlMs', now, () => this.loadConfig(new Date(now))),
      this.cached(this.versionCache, 'dataTtlMs', now, () => this.loadLatestVersion()),
      this.cached(this.accountsCache, 'dataTtlMs', now, () => this.loadAccounts()),
    ])
    return { usageResult, configResult, versionResult, accountsResult }
  }

  async loadAccountModels(account: { name: string }, now: number): Promise<ModelCacheEntry> {
    const name = account.name
    const cached = this.modelCache.get(name)
    const ttl = optionValue(this.options.modelTtlMs) ?? DEFAULT_MODEL_TTL_MS
    if (cached !== undefined && now - cached.fetchedAt < ttl) {
      return cached
    }
    const inflight = this.inFlight.get(name)
    if (inflight !== undefined) return inflight
    const task = (async () => {
      try {
        const baseURL = resolvedOption(this.options.baseURL)
        const managementKey = resolvedOption(this.options.managementKey)
        const body = await managementApi(
          baseURL,
          managementKey,
          `/v0/management/auth-files/models?name=${encodeURIComponent(name)}`,
        )
        const result: ModelCacheEntry = { fetchedAt: now, models: normalizeAuthFileModels(body), error: undefined }
        this.modelCache.set(name, result)
        return result
      } catch (error) {
        const result: ModelCacheEntry = { fetchedAt: now, models: [], error }
        this.modelCache.set(name, result)
        return result
      } finally {
        this.inFlight.delete(name)
      }
    })()
    this.inFlight.set(name, task)
    return task
  }

  async refreshAccountModels(accounts: CpaAccountPublic[], now: number): Promise<ModelRefreshResult> {
    const names: string[] = []
    for (const account of accounts) {
      if (isNonEmptyString(account.name) && !names.includes(account.name)) {
        names.push(account.name)
      }
    }
    const byName = new Map<string, string[]>()
    const errors: ModelError[] = []
    const concurrency = optionValue(this.options.concurrency) ?? DEFAULT_MODEL_CONCURRENCY
    const queue = [...names]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const name = queue.shift()
        if (name === undefined) continue
        const result = await this.loadAccountModels({ name }, now)
        byName.set(name, result.models)
        if (result.error !== undefined) {
          errors.push({ source: 'models', name, message: errorMessage(result.error) })
        }
      }
    })
    await Promise.allSettled(workers)
    return { byName, errors }
  }

  async summary(): Promise<CpaSummary> {
    const managementKey = optionValue(this.options.managementKey)
    if (managementKey === undefined) return emptyCpaSummary({ available: false })

    const now = Date.now()
    const {
      usageResult,
      configResult,
      versionResult,
      accountsResult,
    } = await this.refreshCore(now)
    const errors: CpaSummaryError[] = []

    let usage = emptyUsage()
    if (usageResult.status === 'rejected') {
      errors.push({ source: 'usage', message: errorMessage(usageResult.reason) })
    } else {
      usage = usageResult.value.value
      if (usageResult.value.error !== undefined) {
        errors.push({ source: 'usage', message: errorMessage(usageResult.value.error) })
      }
    }

    let configValue: ConfigValue = { config: emptyConfig(), version: '' }
    if (configResult.status === 'rejected') {
      errors.push({ source: 'config', message: errorMessage(configResult.reason) })
    } else {
      configValue = configResult.value.value
      if (configResult.value.error !== undefined) {
        errors.push({ source: 'config', message: errorMessage(configResult.value.error) })
      }
    }

    let latestVersion = ''
    if (versionResult.status === 'rejected') {
      errors.push({ source: 'latest-version', message: errorMessage(versionResult.reason) })
    } else {
      latestVersion = versionResult.value.value
      if (versionResult.value.error !== undefined) {
        errors.push({ source: 'latest-version', message: errorMessage(versionResult.value.error) })
      }
    }

    let accountsValue: AccountsValue = { accounts: [], errors: [] }
    if (accountsResult.status === 'rejected') {
      errors.push({ source: 'accounts', message: errorMessage(accountsResult.reason) })
    } else {
      accountsValue = accountsResult.value.value
      if (accountsResult.value.error !== undefined) {
        errors.push({ source: 'accounts', message: errorMessage(accountsResult.value.error) })
      }
      errors.push(...accountsValue.errors)
    }
    usage = mergeAccountUsage(usage, accountsValue.accounts)

    const modelResult = await this.refreshAccountModels(accountsValue.accounts, now)
    errors.push(...modelResult.errors)

    const accounts = accountsValue.accounts.map(account => ({
      ...account,
      models: isNonEmptyString(account.name)
        ? modelResult.byName.get(account.name) ?? []
        : isArray(account.modelAliases)
          ? account.modelAliases
          : [],
    }))
    const models = sortStrings([...new Set(accounts.flatMap(account => account.models))])

    return {
      available: true,
      fetchedAt: new Date(now).toISOString(),
      instance: {
        version: configValue.version,
        latestVersion,
        updateAvailable: hasNewerVersion(configValue.version, latestVersion),
        config: configValue.config,
      },
      usage,
      accounts,
      models,
      errors,
    }
  }
}
