const CODE_5H = 5 * 60 * 60
const CODE_7D = 7 * 24 * 60 * 60

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const RETRIEVE_USER_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const FETCH_AVAILABLE_MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
const API_TIMEOUT_MS = 20_000

const PROVIDER_KEY_ENDPOINTS = Object.freeze([
  { path: '/v0/management/gemini-api-key', key: 'gemini-api-key', provider: 'gemini' },
  { path: '/v0/management/interactions-api-key', key: 'interactions-api-key', provider: 'interactions' },
  { path: '/v0/management/claude-api-key', key: 'claude-api-key', provider: 'claude' },
  { path: '/v0/management/codex-api-key', key: 'codex-api-key', provider: 'codex' },
  { path: '/v0/management/xai-api-key', key: 'xai-api-key', provider: 'xai' },
  { path: '/v0/management/vertex-api-key', key: 'vertex-api-key', provider: 'vertex' },
  { path: '/v0/management/openai-compatibility', key: 'openai-compatibility', provider: 'openai-compatibility' },
])

export function compactNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function clampPercent(value) {
  return Math.min(100, Math.max(0, value))
}

export function formatResetLabel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value * 1000)
  const pad = number => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function deriveStatus(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return 'unknown'
  const values = windows
    .map(window => window.remainingPercent)
    .filter(value => typeof value === 'number')
  if (values.length === 0) return 'unknown'
  const min = Math.min(...values)
  if (min <= 0) return 'exhausted'
  if (min <= 30) return 'low'
  if (min <= 70) return 'medium'
  if (min < 100) return 'high'
  return 'full'
}

export function normalizeCodexWindows(payload, now = new Date()) {
  const rateLimit = payload?.rate_limit ?? payload?.rateLimit
  const windows = []
  const primary = rateLimit?.primary_window ?? rateLimit?.primaryWindow
  const secondary = rateLimit?.secondary_window ?? rateLimit?.secondaryWindow
  const candidates = [primary, secondary].filter(Boolean)
  let fiveHour = candidates.find(candidate => compactNumber(candidate?.limit_window_seconds ?? candidate?.limitWindowSeconds, 0) === CODE_5H)
  let weekly = candidates.find(candidate => compactNumber(candidate?.limit_window_seconds ?? candidate?.limitWindowSeconds, 0) === CODE_7D)
  if (fiveHour === undefined && primary !== undefined) fiveHour = primary
  if (weekly === undefined && secondary !== undefined) weekly = secondary
  const exhausted = Boolean(rateLimit?.limit_reached ?? rateLimit?.limitReached) || rateLimit?.allowed === false
  for (const [id, label, window] of [
    ['code-5h', '5h', fiveHour],
    ['code-7d', '7d', weekly],
  ]) {
    if (window === undefined) continue
    windows.push(normalizeCodexWindow(id, label, window, exhausted, now))
  }
  return windows
}

function normalizeCodexWindow(id, label, window, exhausted, now) {
  const used = compactNumber(window.used_percent ?? window.usedPercent, null)
  const resetAt = compactNumber(window.reset_at ?? window.resetAt, 0)
  const resetAfter = compactNumber(window.reset_after_seconds ?? window.resetAfterSeconds, 0)
  const hasReset = resetAt > 0 || resetAfter > 0
  const reset = resetAt > 0 ? resetAt : resetAfter > 0 ? now.getTime() / 1000 + resetAfter : 0
  const remainingPercent = used === null
    ? (exhausted && hasReset ? 0 : null)
    : clampPercent(100 - used)
  return {
    id,
    label,
    remainingPercent,
    resetLabel: formatResetLabel(reset),
    exhausted: used !== null ? used >= 100 : (exhausted && hasReset),
  }
}

export function normalizeGeminiWindows(payload) {
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : []
  const groups = new Map()
  const extras = []
  for (const bucket of buckets) {
    if (bucket === null || typeof bucket !== 'object') continue
    const modelId = String(bucket.modelId ?? bucket.model_id ?? '').replace(/_vertex$/, '')
    if (modelId === '') continue
    const remaining = compactNumber(bucket.remainingFraction ?? bucket.remaining_fraction ?? bucket.remaining, null)
    const remainingPercent = remaining === null ? null : clampPercent(remaining * 100)
    const reset = formatResetLabel(compactNumber(bucket.resetTime ?? bucket.reset_time, 0))
    const group = geminiGroup(modelId)
    if (group === undefined) {
      extras.push({
        id: modelId,
        label: modelId,
        remainingPercent,
        resetLabel: reset,
        exhausted: remaining !== null && remaining <= 0,
      })
      continue
    }
    const current = groups.get(group.id) ?? { remainingPercent: null, resetLabel: '', exhausted: false }
    current.remainingPercent = remainingPercent === null
      ? current.remainingPercent
      : current.remainingPercent === null
        ? remainingPercent
        : Math.min(current.remainingPercent, remainingPercent)
    current.resetLabel = current.resetLabel || reset
    current.exhausted = current.exhausted || (remaining !== null && remaining <= 0)
    groups.set(group.id, current)
  }
  const windows = []
  for (const group of GEMINI_GROUPS) {
    const current = groups.get(group.id)
    if (current === undefined) continue
    windows.push({ id: group.id, label: group.label, ...current })
  }
  extras.sort((left, right) => left.label.localeCompare(right.label))
  windows.push(...extras)
  return windows
}

const GEMINI_GROUPS = [
  { id: 'gemini-flash-lite-series', label: 'Gemini Flash Lite Series', models: ['gemini-2.5-flash-lite'] },
  { id: 'gemini-flash-series', label: 'Gemini Flash Series', models: ['gemini-3-flash-preview', 'gemini-2.5-flash'] },
  { id: 'gemini-pro-series', label: 'Gemini Pro Series', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'] },
]

function geminiGroup(modelId) {
  return GEMINI_GROUPS.find(group => group.models.includes(modelId))
}

export function normalizeAntigravityWindows(payload) {
  const models = payload?.models
  if (models === null || typeof models !== 'object') return []
  const windows = []
  for (const [modelId, entry] of Object.entries(models)) {
    if (entry === null || typeof entry !== 'object') continue
    const quota = entry.quotaInfo ?? entry.quota_info ?? {}
    const remaining = compactNumber(quota.remainingFraction ?? quota.remaining_fraction ?? quota.remaining, null)
    const remainingPercent = remaining === null ? null : clampPercent(remaining * 100)
    const reset = formatResetLabel(compactNumber(quota.resetTime ?? quota.reset_time, 0))
    windows.push({
      id: modelId,
      label: String(entry.displayName ?? modelId),
      remainingPercent,
      resetLabel: reset,
      exhausted: remaining !== null && remaining <= 0,
    })
  }
  return windows
}

export function normalizeQuotaReport(provider, label, authIndex, planType, payload, now = new Date()) {
  const windows = provider === 'codex'
    ? normalizeCodexWindows(payload, now)
    : provider === 'gemini-cli'
      ? normalizeGeminiWindows(payload)
      : provider === 'antigravity'
        ? normalizeAntigravityWindows(payload)
        : []
  const status = deriveStatus(windows)
  return {
    provider,
    authIndex,
    label,
    planType: planType || '',
    status,
    windows,
    ...now === undefined ? {} : { refreshedAt: now.toISOString() },
  }
}

function parseBody(body) {
  if (body === null || body === undefined || body === '') return null
  if (typeof body === 'object') return body
  try {
    return JSON.parse(String(body))
  } catch {
    return null
  }
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNumber(entry, keys) {
  for (const key of keys) {
    const value = entry?.[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function modelAliases(entry) {
  const models = Array.isArray(entry.models)
    ? entry.models
    : Array.isArray(entry.model_aliases)
      ? entry.model_aliases
      : []
  const aliases = []
  for (const model of models) {
    if (model === null || typeof model !== 'object') continue
    const alias = stringOrEmpty(firstValue(model, ['alias', 'name']))
    if (alias !== '' && !aliases.includes(alias)) aliases.push(alias)
  }
  return aliases.slice(0, 20)
}

function firstValue(entry, keys) {
  for (const key of keys) {
    const value = entry?.[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return undefined
}

function optionValue(options, key) {
  return typeof options[key] === 'function' ? options[key]() : options[key]
}

function refreshedAtMs(report) {
  const value = report?.refreshedAt
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function parseJwtPayload(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return value
  const text = String(value)
  if (text.startsWith('{')) {
    try { return JSON.parse(text) } catch { return null }
  }
  const payload = text.split('.')[1]
  if (payload === undefined) return null
  try {
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function nestedValue(entry, keys) {
  return firstValue(entry?.metadata, keys) ?? firstValue(entry?.attributes, keys)
}

function accountId(entry) {
  const token = firstValue(entry, ['id_token']) ?? nestedValue(entry, ['id_token'])
  const claims = parseJwtPayload(token)
  if (claims === null) return ''
  const direct = stringOrEmpty(claims.chatgpt_account_id)
  const nested = claims['https://api.openai.com/auth']?.chatgpt_account_id
  return direct || (typeof nested === 'string' ? nested.trim() : '')
}

function planType(entry) {
  return stringOrEmpty(firstValue(entry, ['plan_type', 'planType'])
    ?? nestedValue(entry, ['plan_type', 'planType']))
}

function projectId(entry) {
  return stringOrEmpty(firstValue(entry, ['project_id'])
    ?? nestedValue(entry, ['project_id']))
}

export function cpaManagementRoot(baseURL) {
  return String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function sanitizeAuthFile(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const authIndex = stringOrEmpty(firstValue(entry, ['auth_index', 'authIndex']))
  if (authIndex === '') return undefined
  const label = stringOrEmpty(firstValue(entry, ['label', 'name', 'id'])) || authIndex
  const name = stringOrEmpty(firstValue(entry, ['name', 'id']))
  const provider = (stringOrEmpty(firstValue(entry, ['provider', 'type'])) || 'unknown').toLowerCase()
  const priority = firstNumber(entry, ['priority'])
  const lastRefresh = stringOrEmpty(firstValue(entry, ['last_refresh', 'lastRefresh']))
  const nextRetryAfter = stringOrEmpty(firstValue(entry, ['next_retry_after', 'nextRetryAfter']))
  const statusMessage = stringOrEmpty(firstValue(entry, ['status_message', 'statusMessage']))
  const source = stringOrEmpty(firstValue(entry, ['source'])) || 'auth-file'
  const note = stringOrEmpty(firstValue(entry, ['note']))
  const recentRequestBuckets = Array.isArray(entry.recent_requests)
    ? entry.recent_requests
    : Array.isArray(entry.recentRequests)
      ? entry.recentRequests
      : []
  const recentRequests = recentRequestBuckets.reduce((total, bucket) => {
    if (bucket === null || typeof bucket !== 'object') return total
    return total + Math.max(0, Number(bucket.success) || 0) + Math.max(0, Number(bucket.failed) || 0)
  }, 0)
  return {
    authIndex,
    label: label.slice(0, 120),
    ...name === '' ? {} : { name: name.slice(0, 240) },
    provider,
    status: stringOrEmpty(firstValue(entry, ['status'])),
    source,
    ...statusMessage === '' ? {} : { statusMessage },
    disabled: entry.disabled === true,
    unavailable: entry.unavailable === true,
    success: Number.isFinite(Number(entry.success)) ? Number(entry.success) : 0,
    failed: Number.isFinite(Number(entry.failed)) ? Number(entry.failed) : 0,
    recentRequests,
    accountId: accountId(entry),
    planType: planType(entry),
    projectId: projectId(entry),
    ...priority === undefined ? {} : { priority },
    ...note === '' ? {} : { note },
    ...lastRefresh === '' ? {} : { lastRefresh },
    ...nextRetryAfter === '' ? {} : { nextRetryAfter },
    ...entry.websockets === true ? { websockets: true } : {},
    ...entry.runtime_only === true || entry.runtimeOnly === true ? { runtimeOnly: true } : {},
    ...entry.quota_auto_disabled === true || entry.quotaAutoDisabled === true ? { quotaAutoDisabled: true } : {},
  }
}

export function sanitizeAuthFiles(files) {
  if (!Array.isArray(files)) return []
  return files.map(sanitizeAuthFile).filter(Boolean)
}

function sanitizeProviderAccount(entry, provider, fallbackLabel, meta = {}) {
  if (entry === null || typeof entry !== 'object') return undefined
  const authIndex = stringOrEmpty(firstValue(entry, ['auth-index', 'authIndex']))
  if (authIndex === '') return undefined
  const label = stringOrEmpty(firstValue(entry, ['name', 'label', 'prefix', 'base-url', 'baseUrl']))
    || fallbackLabel
    || authIndex
  const baseUrl = stringOrEmpty(firstValue(entry, ['base-url', 'baseUrl', 'base_url'])) || meta.baseUrl || ''
  const prefix = stringOrEmpty(firstValue(entry, ['prefix'])) || meta.prefix || ''
  const priority = firstNumber(entry, ['priority']) ?? meta.priority
  const note = stringOrEmpty(firstValue(entry, ['note'])) || meta.note || ''
  const statusMessage = stringOrEmpty(firstValue(entry, ['status_message', 'statusMessage'])) || meta.statusMessage || ''
  const aliases = modelAliases(entry).length > 0 ? modelAliases(entry) : meta.modelAliases || []
  const disableCooling = entry.disable_cooling === true || entry['disable-cooling'] === true || entry.disableCooling === true
    || meta.disableCooling === true
  return {
    authIndex,
    label: label.slice(0, 120),
    provider,
    source: meta.source || 'api-key',
    status: '',
    ...statusMessage === '' ? {} : { statusMessage },
    disabled: entry.disabled === true,
    unavailable: false,
    success: 0,
    failed: 0,
    recentRequests: 0,
    planType: '',
    ...baseUrl === '' ? {} : { baseUrl },
    ...prefix === '' ? {} : { prefix },
    ...priority === undefined ? {} : { priority },
    ...note === '' ? {} : { note },
    ...aliases.length > 0 ? { modelAliases: aliases } : {},
    ...disableCooling ? { disableCooling: true } : {},
  }
}

const OPENAI_COMPAT_PROVIDER_PREFIXES = Object.freeze([
  ['deepseek', 'deepseek'],
  ['openai', 'openai'],
  ['chatgpt', 'openai'],
  ['codex', 'openai'],
  ['claude', 'claude'],
  ['anthropic', 'claude'],
  ['gemini', 'gemini'],
  ['vertex', 'vertex'],
  ['xai', 'xai'],
  ['grok', 'xai'],
  ['qwen', 'qwen'],
  ['kimi', 'kimi'],
  ['glm', 'zhipu'],
  ['doubao', 'doubao'],
  ['iflow', 'iflow'],
  ['interactions', 'interactions'],
])

function openAIProviderName(entry) {
  const rawName = stringOrEmpty(firstValue(entry, ['name']))
  if (rawName === '') return 'openai-compatibility'
  const normalized = rawName.toLowerCase().replace(/[_\s-]+/g, ' ').trim()
  for (const [prefix, provider] of OPENAI_COMPAT_PROVIDER_PREFIXES) {
    if (normalized.startsWith(prefix)) return provider
  }
  return normalized.replace(/\s+/g, '-')
}

function sanitizeProviderAccounts(body, spec) {
  const entries = Array.isArray(body)
    ? body
    : Array.isArray(body?.[spec.key])
      ? body[spec.key]
      : Array.isArray(body?.items)
        ? body.items
        : []
  const accounts = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (spec.key === 'openai-compatibility') {
      const provider = openAIProviderName(entry)
      const label = stringOrEmpty(firstValue(entry, ['name', 'prefix', 'base-url', 'baseUrl']))
        || 'OpenAI Compatible'
      const meta = {
        source: 'api-key',
        baseUrl: stringOrEmpty(firstValue(entry, ['base-url', 'baseUrl', 'base_url'])),
        prefix: stringOrEmpty(firstValue(entry, ['prefix'])),
        priority: firstNumber(entry, ['priority']),
        note: stringOrEmpty(firstValue(entry, ['note'])),
        statusMessage: stringOrEmpty(firstValue(entry, ['status_message', 'statusMessage'])),
        modelAliases: modelAliases(entry),
        disableCooling: entry.disable_cooling === true || entry['disable-cooling'] === true || entry.disableCooling === true,
      }
      const top = sanitizeProviderAccount(entry, provider, label, meta)
      if (top !== undefined) accounts.push(top)
      const keys = Array.isArray(entry['api-key-entries'])
        ? entry['api-key-entries']
        : Array.isArray(entry.api_key_entries)
          ? entry.api_key_entries
          : Array.isArray(entry.apiKeyEntries)
            ? entry.apiKeyEntries
            : []
      for (let index = 0; index < keys.length; index += 1) {
        const keyEntry = keys[index]
        const account = sanitizeProviderAccount(
          { ...keyEntry, disabled: entry.disabled === true || keyEntry?.disabled === true },
          provider,
          keys.length > 1 ? `${label} ${index + 1}` : label,
          meta,
        )
        if (account !== undefined) accounts.push(account)
      }
      continue
    }
    const meta = {
      source: 'api-key',
      baseUrl: stringOrEmpty(firstValue(entry, ['base-url', 'baseUrl', 'base_url'])),
      prefix: stringOrEmpty(firstValue(entry, ['prefix'])),
      priority: firstNumber(entry, ['priority']),
      note: stringOrEmpty(firstValue(entry, ['note'])),
      statusMessage: stringOrEmpty(firstValue(entry, ['status_message', 'statusMessage'])),
      modelAliases: modelAliases(entry),
      disableCooling: entry.disable_cooling === true || entry['disable-cooling'] === true || entry.disableCooling === true,
    }
    const account = sanitizeProviderAccount(entry, spec.provider, `${spec.provider} API`, meta)
    if (account !== undefined) accounts.push(account)
  }
  return accounts
}

export async function fetchApiProviders(baseURL, managementKey) {
  const settled = await Promise.allSettled(PROVIDER_KEY_ENDPOINTS.map(async spec => {
    const body = await managementApi(baseURL, managementKey, spec.path)
    return sanitizeProviderAccounts(body, spec)
  }))
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
}

export function publicAccount(account) {
  if (account === null || typeof account !== 'object') return account
  const { accountId, projectId, ...rest } = account
  return rest
}

export async function managementApiWithHeaders(baseURL, managementKey, path) {
  const url = `${cpaManagementRoot(baseURL)}${path}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${managementKey}`,
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`management API ${response.status}`)
  const body = await response.json().catch(() => null)
  return { body: body ?? {}, headers: response.headers }
}

export async function managementApi(baseURL, managementKey, path) {
  const { body } = await managementApiWithHeaders(baseURL, managementKey, path)
  return body
}

export async function fetchAuthFiles(baseURL, managementKey) {
  const body = await managementApi(baseURL, managementKey, '/v0/management/auth-files')
  return sanitizeAuthFiles(body.files)
}

async function apiCall(baseURL, managementKey, payload) {
  const response = await fetch(`${cpaManagementRoot(baseURL)}/v0/management/api-call`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${managementKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`api-call ${response.status}`)
  const body = await response.json().catch(() => null)
  const statusCode = body?.status_code ?? body?.statusCode ?? 0
  const parsed = parseBody(body?.body)
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(parsed?.error?.message || `upstream HTTP ${statusCode}`)
  }
  return parsed
}

const WHAM_HEADERS = {
  authorization: 'Bearer $TOKEN$',
  'content-type': 'application/json',
  'user-agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
}

function googleHeaders(metadata = {}) {
  return {
    authorization: 'Bearer $TOKEN$',
    'content-type': 'application/json',
    'user-agent': 'google-api-nodejs-client/9.15.1',
    'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
    ...Object.keys(metadata).length > 0 ? { 'client-metadata': JSON.stringify(metadata) } : {},
  }
}

async function queryCodex(baseURL, managementKey, account, now) {
  if (account.accountId === '') {
    return normalizeQuotaReport('codex', account.label, account.authIndex, account.planType, null, now)
  }
  const payload = await apiCall(baseURL, managementKey, {
    auth_index: account.authIndex,
    method: 'GET',
    url: WHAM_USAGE_URL,
    header: { ...WHAM_HEADERS, 'chatgpt-account-id': account.accountId },
    data: '',
  })
  return normalizeQuotaReport('codex', account.label, account.authIndex, account.planType ?? payload?.plan_type, payload, now)
}

async function loadCodeAssist(baseURL, managementKey, authIndex, metadata, projectID = '') {
  const body = {
    metadata,
    ...projectID === '' ? {} : { cloudaicompanionProject: projectID },
  }
  return apiCall(baseURL, managementKey, {
    auth_index: authIndex,
    method: 'POST',
    url: LOAD_CODE_ASSIST_URL,
    header: googleHeaders(metadata),
    data: JSON.stringify(body),
  })
}

async function queryGemini(baseURL, managementKey, account, now) {
  const metadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  let project = account.projectId
  if (project === '') {
    const loaded = await loadCodeAssist(baseURL, managementKey, account.authIndex, metadata)
    project = stringOrEmpty(firstValue(loaded, ['cloudaicompanionProject']) ?? loaded?.cloudaicompanionProject?.id)
  }
  if (project === '') return normalizeQuotaReport('gemini-cli', account.label, account.authIndex, account.planType, null, now)
  const payload = await apiCall(baseURL, managementKey, {
    auth_index: account.authIndex,
    method: 'POST',
    url: RETRIEVE_USER_QUOTA_URL,
    header: googleHeaders(metadata),
    data: JSON.stringify({ project }),
  })
  return normalizeQuotaReport('gemini-cli', account.label, account.authIndex, account.planType, payload, now)
}

async function queryAntigravity(baseURL, managementKey, account, now) {
  const metadata = {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  let project = account.projectId
  if (project === '') {
    const loaded = await loadCodeAssist(baseURL, managementKey, account.authIndex, metadata)
    project = stringOrEmpty(firstValue(loaded, ['cloudaicompanionProject']) ?? loaded?.cloudaicompanionProject?.id)
  }
  if (project === '') return normalizeQuotaReport('antigravity', account.label, account.authIndex, account.planType, null, now)
  const payload = await apiCall(baseURL, managementKey, {
    auth_index: account.authIndex,
    method: 'POST',
    url: FETCH_AVAILABLE_MODELS_URL,
    header: googleHeaders(metadata),
    data: JSON.stringify({ project }),
  })
  return normalizeQuotaReport('antigravity', account.label, account.authIndex, account.planType, payload, now)
}

function quotaForProvider(provider) {
  if (provider === 'codex') return queryCodex
  if (provider === 'gemini-cli') return queryGemini
  if (provider === 'antigravity') return queryAntigravity
  return undefined
}

export class CpaQuotaService {
  constructor(options) {
    this.options = options
    this.accounts = []
    this.accountsFetchedAt = 0
    this.accountsPromise
    this.quota = new Map()
    this.inFlight = new Map()
  }

  async ensureAccounts(now = Date.now()) {
    if (now - this.accountsFetchedAt < (optionValue(this.options, 'authFilesTtlMs') ?? 30_000)) return this.accounts
    if (this.accountsPromise) return this.accountsPromise
    this.accountsPromise = this.refreshAccounts(now)
    try {
      return await this.accountsPromise
    } finally {
      this.accountsPromise = undefined
    }
  }

  async refreshAccounts(now = Date.now()) {
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const [files, apiProviders] = await Promise.all([
      fetchAuthFiles(baseURL, managementKey),
      fetchApiProviders(baseURL, managementKey),
    ])
    this.accounts = [...files, ...apiProviders]
    this.accountsFetchedAt = now
    return this.accounts
  }

  async refreshQuota(now = Date.now()) {
    const accounts = await this.ensureAccounts(now)
    const tasks = accounts.filter(account => quotaForProvider(account.provider) !== undefined)
    if (tasks.length === 0) return this.quota
    const concurrency = optionValue(this.options, 'concurrency') ?? 4
    const queue = [...tasks]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const account = queue.shift()
        await this.refreshOne(account, now)
      }
    })
    await Promise.allSettled(workers)
    return this.quota
  }

  async refreshOne(account, now = Date.now()) {
    const existing = this.quota.get(account.authIndex)
    const refreshedAt = existing === undefined ? 0 : refreshedAtMs(existing)
    if (existing !== undefined && refreshedAt > 0 && now - refreshedAt < (optionValue(this.options, 'quotaTtlMs') ?? 60_000)) {
      return existing
    }
    const inflight = this.inFlight.get(account.authIndex)
    if (inflight !== undefined) return inflight
    const query = quotaForProvider(account.provider)
    if (query === undefined) return existing
    const baseURL = optionValue(this.options, 'baseURL')
    const managementKey = optionValue(this.options, 'managementKey')
    const task = (async () => {
      try {
        const report = await query(baseURL, managementKey, account, new Date(now))
        this.quota.set(account.authIndex, report)
        return report
      } catch (error) {
        this.quota.set(account.authIndex, normalizeQuotaReport(
          account.provider,
          account.label,
          account.authIndex,
          account.planType,
          null,
          new Date(now),
        ))
        return this.quota.get(account.authIndex)
      } finally {
        this.inFlight.delete(account.authIndex)
      }
    })()
    this.inFlight.set(account.authIndex, task)
    return task
  }

  async status() {
    const now = Date.now()
    const accounts = await this.ensureAccounts(now)
    try {
      await this.refreshQuota(now)
    } catch {
      // Quota is best-effort; keep cached account data available.
    }
    return {
      accounts: accounts.map(publicAccount),
      quota: Object.fromEntries(this.quota),
    }
  }
}
