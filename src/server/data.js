import {
  fetchApiProviders,
  fetchAuthFiles,
  managementApi,
  managementApiWithHeaders,
  publicAccount,
} from './quota.js'

const DEFAULT_DATA_TTL_MS = 30_000
const DEFAULT_MODEL_TTL_MS = 60_000
const DEFAULT_MODEL_CONCURRENCY = 4
const MAX_MODELS = 200

function optionValue(options, key) {
  return typeof options[key] === 'function' ? options[key]() : options[key]
}

function sourceValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value === undefined || value === null || value === '') continue
    return value
  }
  return undefined
}

function safeString(value, maxLength = 200) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function safeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function integerNumber(value) {
  return Math.floor(safeNumber(value))
}

function safeBoolean(value) {
  return value === true
}

function clampRatio(value) {
  return Math.min(1, Math.max(0, value))
}

function errorMessage(error) {
  const message = error?.message || String(error)
  return typeof message === 'string' ? message.slice(0, 200) : 'unknown error'
}

function sortStrings(values) {
  return values.sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

function emptyTotals() {
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

export function emptyUsage(fetchedAt = '') {
  return {
    fetchedAt,
    totals: emptyTotals(),
    models: [],
  }
}

function addTotal(total, value) {
  return total + safeNumber(value)
}

function apiKeyUsageStatistics(payload) {
  const statistics = {}
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return statistics
  for (const [provider, entries] of Object.entries(payload)) {
    const providerName = safeString(provider, 80)
    if (providerName === '' || entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue
    let success = 0
    let failed = 0
    for (const entry of Object.values(entries)) {
      if (entry === null || typeof entry !== 'object') continue
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

function emptyUsageModel(modelId) {
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

function mergeUsageEntry(usage, modelId, success, failed) {
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

function mergeAccountUsage(usage, accounts) {
  let next = usage
  for (const account of accounts) {
    if (account === null || typeof account !== 'object') continue
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

export function normalizeUsage(payload, fetchedAt = new Date()) {
  const statistics = payload?.statistics && typeof payload.statistics === 'object' && !Array.isArray(payload.statistics)
    ? payload.statistics
    : {}
  const totals = emptyTotals()
  const models = []
  for (const [modelId, entry] of Object.entries(statistics)) {
    if (modelId === '' || entry === null || typeof entry !== 'object') continue
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

export function emptyConfig() {
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

function configSource(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {}
  if (payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)) {
    return payload.config
  }
  return payload
}

function sanitizeProxyUrl(value) {
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

export function normalizeConfig(payload) {
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

export function normalizeVersion(payload) {
  return safeString(sourceValue(payload, ['latest-version', 'latestVersion']), 80)
}

function versionParts(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/)
  if (match === null) return undefined
  return match.slice(1).map(Number)
}

function hasNewerVersion(current, latest) {
  const left = versionParts(current)
  const right = versionParts(latest)
  if (left === undefined || right === undefined) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return false
    if (left[index] < right[index]) return true
  }
  return false
}

export function normalizeAuthFileModels(payload) {
  let entries = []
  if (Array.isArray(payload)) {
    entries = payload
  } else if (Array.isArray(payload?.models)) {
    entries = payload.models
  } else if (Array.isArray(payload?.data)) {
    entries = payload.data
  } else if (payload?.models && typeof payload.models === 'object') {
    entries = Object.keys(payload.models)
  }
  const models = []
  for (const entry of entries) {
    const id = typeof entry === 'string'
      ? safeString(entry, 240)
      : safeString(sourceValue(entry, ['model', 'model_id', 'modelId', 'id', 'name']), 240)
    if (id !== '' && !models.includes(id)) models.push(id)
  }
  return sortStrings(models).slice(0, MAX_MODELS)
}

export function emptyCpaSummary({ available = false, errors = [], fetchedAt = new Date() } = {}) {
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
  constructor(options = {}) {
    this.options = options
    this.usageCache = { fetchedAt: 0, value: emptyUsage(), promise: undefined }
    this.configCache = {
      fetchedAt: 0,
      value: { config: emptyConfig(), version: '' },
      promise: undefined,
    }
    this.versionCache = { fetchedAt: 0, value: '', promise: undefined }
    this.accountsCache = { fetchedAt: 0, value: { accounts: [], errors: [] }, promise: undefined }
    this.modelCache = new Map()
    this.inFlight = new Map()
  }

  async cached(store, ttlKey, now, load) {
    const ttl = optionValue(this.options, ttlKey) ?? DEFAULT_DATA_TTL_MS
    if (now - store.fetchedAt < ttl) {
      return { value: store.value, error: undefined }
    }
    if (store.promise) return store.promise
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

  async loadUsage(now) {
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const body = await managementApi(baseURL, managementKey, '/v0/management/api-key-usage')
    return normalizeUsage({ statistics: apiKeyUsageStatistics(body) }, now)
  }

  async loadConfig(now) {
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const { body, headers } = await managementApiWithHeaders(baseURL, managementKey, '/v0/management/config')
    const headerVersion = safeString(
      headers.get('x-cpa-version') || headers.get('x-server-version') || headers.get('x-cpa-home-version'),
      80,
    )
    return {
      config: normalizeConfig(body),
      version: safeString(
        sourceValue(configSource(body), ['version', 'current-version', 'current_version', 'currentVersion'])
          ?? sourceValue(body, ['version', 'current-version', 'current_version', 'currentVersion'])
          ?? headerVersion,
        80,
      ),
    }
  }

  async loadLatestVersion() {
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const body = await managementApi(baseURL, managementKey, '/v0/management/latest-version')
    return normalizeVersion(body)
  }

  async loadAccounts() {
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const [filesResult, providersResult] = await Promise.allSettled([
      fetchAuthFiles(baseURL, managementKey),
      fetchApiProviders(baseURL, managementKey),
    ])
    const accounts = []
    const errors = []
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

  async refreshCore(now) {
    const [usageResult, configResult, versionResult, accountsResult] = await Promise.allSettled([
      this.cached(this.usageCache, 'dataTtlMs', now, () => this.loadUsage(new Date(now))),
      this.cached(this.configCache, 'dataTtlMs', now, () => this.loadConfig(new Date(now))),
      this.cached(this.versionCache, 'dataTtlMs', now, () => this.loadLatestVersion()),
      this.cached(this.accountsCache, 'dataTtlMs', now, () => this.loadAccounts()),
    ])
    return { usageResult, configResult, versionResult, accountsResult }
  }

  async loadAccountModels(account, now) {
    const name = account.name
    const cached = this.modelCache.get(name)
    const ttl = optionValue(this.options, 'modelTtlMs') ?? DEFAULT_MODEL_TTL_MS
    if (cached !== undefined && now - cached.fetchedAt < ttl) {
      return cached
    }
    const inflight = this.inFlight.get(name)
    if (inflight !== undefined) return inflight
    const task = (async () => {
      try {
        const baseURL = optionValue(this.options, 'baseURL')
        const managementKey = optionValue(this.options, 'managementKey')
        const body = await managementApi(
          baseURL,
          managementKey,
          `/v0/management/auth-files/models?name=${encodeURIComponent(name)}`,
        )
        const result = { fetchedAt: now, models: normalizeAuthFileModels(body), error: undefined }
        this.modelCache.set(name, result)
        return result
      } catch (error) {
        const result = { fetchedAt: now, models: [], error }
        this.modelCache.set(name, result)
        return result
      } finally {
        this.inFlight.delete(name)
      }
    })()
    this.inFlight.set(name, task)
    return task
  }

  async refreshAccountModels(accounts, now) {
    const names = []
    for (const account of accounts) {
      if (typeof account.name === 'string' && account.name !== '' && !names.includes(account.name)) {
        names.push(account.name)
      }
    }
    const byName = new Map()
    const errors = []
    const concurrency = optionValue(this.options, 'concurrency') ?? DEFAULT_MODEL_CONCURRENCY
    const queue = [...names]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const name = queue.shift()
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

  async summary() {
    const managementKey = optionValue(this.options, 'managementKey')
    if (!managementKey) return emptyCpaSummary({ available: false })

    const now = Date.now()
    const {
      usageResult,
      configResult,
      versionResult,
      accountsResult,
    } = await this.refreshCore(now)
    const errors = []

    let usage = emptyUsage()
    if (usageResult.status === 'rejected') {
      errors.push({ source: 'usage', message: errorMessage(usageResult.reason) })
    } else {
      usage = usageResult.value.value
      if (usageResult.value.error !== undefined) {
        errors.push({ source: 'usage', message: errorMessage(usageResult.value.error) })
      }
    }

    let configValue = { config: emptyConfig(), version: '' }
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

    let accountsValue = { accounts: [], errors: [] }
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
      models: account.name !== undefined && account.name !== ''
        ? modelResult.byName.get(account.name) ?? []
        : Array.isArray(account.modelAliases)
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
