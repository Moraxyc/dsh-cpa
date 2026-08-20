import { asJsonRecord, isArray, isBoolean, isJsonRecord, isNonEmptyString, isNumber, isString } from '../core/json.js'
import type { JsonRecord, JsonValue } from '../core/json.js'

const CODE_5H = 5 * 60 * 60
const CODE_7D = 7 * 24 * 60 * 60

const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const LOAD_CODE_ASSIST_URL = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist'
const RETRIEVE_USER_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const FETCH_AVAILABLE_MODELS_URL = 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
const API_TIMEOUT_MS = 20_000

const PROVIDER_KEY_ENDPOINTS = [
  { path: '/v0/management/gemini-api-key', key: 'gemini-api-key', provider: 'gemini' },
  { path: '/v0/management/interactions-api-key', key: 'interactions-api-key', provider: 'interactions' },
  { path: '/v0/management/claude-api-key', key: 'claude-api-key', provider: 'claude' },
  { path: '/v0/management/codex-api-key', key: 'codex-api-key', provider: 'codex' },
  { path: '/v0/management/xai-api-key', key: 'xai-api-key', provider: 'xai' },
  { path: '/v0/management/vertex-api-key', key: 'vertex-api-key', provider: 'vertex' },
  { path: '/v0/management/openai-compatibility', key: 'openai-compatibility', provider: 'openai-compatibility' },
] as const satisfies readonly ProviderEndpointSpec[]

export type OptionSource<T> = T | (() => T)

function isResolver<T>(value: OptionSource<T>): value is () => T {
  return typeof value === 'function'
}

export function optionValue<T>(value: OptionSource<T> | undefined): T | undefined {
  return value === undefined ? undefined : isResolver(value) ? value() : value
}

export function resolvedOption<T>(value: OptionSource<T>): T {
  return isResolver(value) ? value() : value
}

export interface QuotaWindow {
  id: string
  label: string
  remainingPercent: number | null
  resetLabel: string
  exhausted: boolean
}

export type QuotaStatus = 'unknown' | 'exhausted' | 'low' | 'medium' | 'high' | 'full'

interface QuotaGroupState {
  remainingPercent: number | null
  resetLabel: string
  exhausted: boolean
}

export interface CpaQuotaReport {
  provider: string
  authIndex: string
  label: string
  planType: string
  status: QuotaStatus
  windows: QuotaWindow[]
  refreshedAt?: string
}

export interface CpaAccount {
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
  accountId: string
  planType: string
  projectId: string
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

export type CpaAccountPublic = Omit<CpaAccount, 'accountId' | 'projectId'>

export interface PayloadSource {
  [key: string]: JsonValue | undefined
}

export interface QuotaApiPayload extends PayloadSource {
  rate_limit?: JsonValue
  rateLimit?: JsonValue
  buckets?: JsonValue
  models?: JsonValue
  plan_type?: JsonValue
}

interface ProviderEndpointSpec {
  path: string
  key: string
  provider: string
}

interface ProviderAccountMeta {
  source?: string
  baseUrl?: string
  prefix?: string
  priority?: number
  note?: string
  statusMessage?: string
  modelAliases?: string[]
  disableCooling?: boolean
}

interface CodeAssistRequestBody {
  metadata: Record<string, string>
  cloudaicompanionProject?: string
}

interface ApiCallPayload {
  auth_index: string
  method: 'GET' | 'POST'
  url: string
  header: GoogleApiHeaders
  data: string
}

interface GoogleApiHeaders {
  authorization: string
  'content-type': string
  'user-agent': string
  'x-goog-api-client'?: string
  'client-metadata'?: string
  'chatgpt-account-id'?: string
}

export interface CpaQuotaServiceOptions {
  baseURL: OptionSource<string>
  managementKey: OptionSource<string>
  authFilesTtlMs?: OptionSource<number>
  quotaTtlMs?: OptionSource<number>
  concurrency?: OptionSource<number>
}

export interface CpaQuotaStatus {
  accounts: CpaAccountPublic[]
  quota: Record<string, CpaQuotaReport>
}

export function compactNumber(value: JsonValue | undefined, fallback: number | null): number | null {
  if (value === null || value === undefined || value === '') return fallback
  if (isNumber(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

export function formatResetLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value * 1000)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function deriveStatus(windows: QuotaWindow[]): QuotaStatus {
  if (windows.length === 0) return 'unknown'
  const values = windows
    .map(window => window.remainingPercent)
    .filter((value): value is number => value !== null)
  if (values.length === 0) return 'unknown'
  const min = Math.min(...values)
  if (min <= 0) return 'exhausted'
  if (min <= 30) return 'low'
  if (min <= 70) return 'medium'
  if (min < 100) return 'high'
  return 'full'
}

function firstScalar(source: PayloadSource | null | undefined, keys: readonly string[]): JsonValue | undefined {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== null && value !== undefined && value !== '') return value
  }
  return undefined
}

function firstRecord(source: PayloadSource | null | undefined, keys: readonly string[]): JsonRecord | null {
  for (const key of keys) {
    const value = source?.[key]
    if (isJsonRecord(value)) return value
  }
  return null
}

export function normalizeCodexWindows(payload: QuotaApiPayload | null | undefined, now = new Date()): QuotaWindow[] {
  const rateLimit = firstRecord(payload, ['rate_limit', 'rateLimit'])
  const windows: QuotaWindow[] = []
  const primary = firstRecord(rateLimit, ['primary_window', 'primaryWindow'])
  const secondary = firstRecord(rateLimit, ['secondary_window', 'secondaryWindow'])
  const candidates = [primary, secondary].filter((candidate): candidate is JsonRecord => candidate !== null)
  let fiveHour = candidates.find(candidate =>
    compactNumber(firstScalar(candidate, ['limit_window_seconds', 'limitWindowSeconds']), 0) === CODE_5H,
  )
  let weekly = candidates.find(candidate =>
    compactNumber(firstScalar(candidate, ['limit_window_seconds', 'limitWindowSeconds']), 0) === CODE_7D,
  )
  if (fiveHour === undefined && primary !== null) fiveHour = primary
  if (weekly === undefined && secondary !== null) weekly = secondary
  const exhausted = Boolean(firstScalar(rateLimit, ['limit_reached', 'limitReached']))
    || firstScalar(rateLimit, ['allowed']) === false
  for (const [id, label, window] of [
    ['code-5h', '5h', fiveHour],
    ['code-7d', '7d', weekly],
  ] as const) {
    if (window === undefined) continue
    windows.push(normalizeCodexWindow(id, label, window, exhausted, now))
  }
  return windows
}

function normalizeCodexWindow(id: string, label: string, window: JsonRecord, exhausted: boolean, now: Date): QuotaWindow {
  const used = compactNumber(firstScalar(window, ['used_percent', 'usedPercent']), null)
  const resetAt = compactNumber(firstScalar(window, ['reset_at', 'resetAt']), 0) ?? 0
  const resetAfter = compactNumber(firstScalar(window, ['reset_after_seconds', 'resetAfterSeconds']), 0) ?? 0
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

export function normalizeGeminiWindows(payload: QuotaApiPayload | null | undefined): QuotaWindow[] {
  const buckets = isArray(payload?.buckets) ? payload.buckets : []
  const groups = new Map<string, QuotaGroupState>()
  const extras: QuotaWindow[] = []
  for (const bucket of buckets) {
    if (!isJsonRecord(bucket)) continue
    const modelId = String(firstScalar(bucket, ['modelId', 'model_id']) ?? '').replace(/_vertex$/, '')
    if (modelId === '') continue
    const remaining = compactNumber(firstScalar(bucket, ['remainingFraction', 'remaining_fraction', 'remaining']), null)
    const remainingPercent = remaining === null ? null : clampPercent(remaining * 100)
    const reset = formatResetLabel(compactNumber(firstScalar(bucket, ['resetTime', 'reset_time']), 0) ?? 0)
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
  const windows: QuotaWindow[] = []
  for (const group of GEMINI_GROUPS) {
    const current = groups.get(group.id)
    if (current === undefined) continue
    windows.push({ id: group.id, label: group.label, ...current })
  }
  extras.sort((left, right) => left.label.localeCompare(right.label))
  windows.push(...extras)
  return windows
}

interface GeminiGroup {
  id: string
  label: string
  models: readonly string[]
}

const GEMINI_GROUPS: readonly GeminiGroup[] = [
  { id: 'gemini-flash-lite-series', label: 'Gemini Flash Lite Series', models: ['gemini-2.5-flash-lite'] },
  { id: 'gemini-flash-series', label: 'Gemini Flash Series', models: ['gemini-3-flash-preview', 'gemini-2.5-flash'] },
  { id: 'gemini-pro-series', label: 'Gemini Pro Series', models: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-2.5-pro'] },
]

function geminiGroup(modelId: string): GeminiGroup | undefined {
  return GEMINI_GROUPS.find(group => group.models.includes(modelId))
}

export function normalizeAntigravityWindows(payload: QuotaApiPayload | null | undefined): QuotaWindow[] {
  const models = payload?.models
  if (!isJsonRecord(models)) return []
  const windows: QuotaWindow[] = []
  for (const [modelId, entry] of Object.entries(models)) {
    if (!isJsonRecord(entry)) continue
    const quota: JsonRecord = isJsonRecord(entry.quotaInfo)
      ? entry.quotaInfo
      : isJsonRecord(entry.quota_info)
        ? entry.quota_info
        : {}
    const remaining = compactNumber(firstScalar(quota, ['remainingFraction', 'remaining_fraction', 'remaining']), null)
    const remainingPercent = remaining === null ? null : clampPercent(remaining * 100)
    const reset = formatResetLabel(compactNumber(firstScalar(quota, ['resetTime', 'reset_time']), 0) ?? 0)
    windows.push({
      id: modelId,
      label: isString(entry.displayName) ? entry.displayName : modelId,
      remainingPercent,
      resetLabel: reset,
      exhausted: remaining !== null && remaining <= 0,
    })
  }
  return windows
}

export function normalizeQuotaReport(
  provider: string,
  label: string,
  authIndex: string,
  planType: string,
  payload: QuotaApiPayload | null,
  now = new Date(),
): CpaQuotaReport {
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
    refreshedAt: now.toISOString(),
  }
}

function parseBody(body: JsonValue | undefined): QuotaApiPayload | null {
  if (body === null || body === undefined || body === '') return null
  if (isJsonRecord(body)) return body
  try {
    const parsed: unknown = JSON.parse(String(body))
    return isJsonRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseJwtPayload(value: JsonValue | undefined): JsonRecord | null {
  if (value === null || value === undefined || value === '') return null
  if (isJsonRecord(value)) return value
  const text = String(value)
  if (text.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      return isJsonRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  const payload = text.split('.')[1]
  if (payload === undefined) return null
  try {
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(decoded)
    return isJsonRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stringOrEmpty(value: JsonValue | undefined): string {
  return isString(value) ? value.trim() : ''
}

function firstNumber(entry: JsonRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = firstScalar(entry, [key])
    if (value === undefined) continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function modelAliases(entry: JsonRecord): string[] {
  const models = isArray(entry.models)
    ? entry.models
    : isArray(entry.model_aliases)
      ? entry.model_aliases
      : []
  const aliases: string[] = []
  for (const model of models) {
    if (!isJsonRecord(model)) continue
    const alias = stringOrEmpty(firstScalar(model, ['alias', 'name']))
    if (alias !== '' && !aliases.includes(alias)) aliases.push(alias)
  }
  return aliases.slice(0, 20)
}

function nestedValue(entry: JsonRecord, keys: readonly string[]): JsonValue | undefined {
  return firstScalar(firstRecord(entry, ['metadata', 'attributes']), keys)
}

function accountId(entry: JsonRecord): string {
  const token = firstScalar(entry, ['id_token']) ?? nestedValue(entry, ['id_token'])
  const claims = parseJwtPayload(token)
  if (claims === null) return ''
  const direct = stringOrEmpty(firstScalar(claims, ['chatgpt_account_id']))
  const auth = firstRecord(claims, ['https://api.openai.com/auth'])
  const nested = stringOrEmpty(firstScalar(auth, ['chatgpt_account_id']))
  return direct || nested
}

function planType(entry: JsonRecord): string {
  return stringOrEmpty(firstScalar(entry, ['plan_type', 'planType'])
    ?? nestedValue(entry, ['plan_type', 'planType']))
}

function projectId(entry: JsonRecord): string {
  return stringOrEmpty(firstScalar(entry, ['project_id'])
    ?? nestedValue(entry, ['project_id']))
}

export function cpaManagementRoot(baseURL: string): string {
  return String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function sanitizeAuthFile(entry: JsonValue | null | undefined): CpaAccount | undefined {
  if (!isJsonRecord(entry)) return undefined
  const authIndex = stringOrEmpty(firstScalar(entry, ['auth_index', 'authIndex']))
  if (authIndex === '') return undefined
  const label = stringOrEmpty(firstScalar(entry, ['label', 'name', 'id'])) || authIndex
  const name = stringOrEmpty(firstScalar(entry, ['name', 'id']))
  const provider = (stringOrEmpty(firstScalar(entry, ['provider', 'type'])) || 'unknown').toLowerCase()
  const priority = firstNumber(entry, ['priority'])
  const lastRefresh = stringOrEmpty(firstScalar(entry, ['last_refresh', 'lastRefresh']))
  const nextRetryAfter = stringOrEmpty(firstScalar(entry, ['next_retry_after', 'nextRetryAfter']))
  const statusMessage = stringOrEmpty(firstScalar(entry, ['status_message', 'statusMessage']))
  const source = stringOrEmpty(firstScalar(entry, ['source'])) || 'auth-file'
  const note = stringOrEmpty(firstScalar(entry, ['note']))
  const recentRequestBuckets = isArray(entry.recent_requests)
    ? entry.recent_requests
    : isArray(entry.recentRequests)
      ? entry.recentRequests
      : []
  const recentRequests = recentRequestBuckets.reduce<number>((total, bucket) => {
    if (!isJsonRecord(bucket)) return total
    return total + Math.max(0, Number(bucket.success) || 0) + Math.max(0, Number(bucket.failed) || 0)
  }, 0)
  const account: CpaAccount = {
    authIndex,
    label: label.slice(0, 120),
    provider,
    status: stringOrEmpty(firstScalar(entry, ['status'])),
    source,
    disabled: entry.disabled === true,
    unavailable: entry.unavailable === true,
    success: Number.isFinite(Number(entry.success)) ? Number(entry.success) : 0,
    failed: Number.isFinite(Number(entry.failed)) ? Number(entry.failed) : 0,
    recentRequests,
    accountId: accountId(entry),
    planType: planType(entry),
    projectId: projectId(entry),
  }
  if (name !== '') account.name = name.slice(0, 240)
  if (statusMessage !== '') account.statusMessage = statusMessage
  if (priority !== undefined) account.priority = priority
  if (note !== '') account.note = note
  if (lastRefresh !== '') account.lastRefresh = lastRefresh
  if (nextRetryAfter !== '') account.nextRetryAfter = nextRetryAfter
  if (entry.websockets === true) account.websockets = true
  if (entry.runtime_only === true || entry.runtimeOnly === true) account.runtimeOnly = true
  if (entry.quota_auto_disabled === true || entry.quotaAutoDisabled === true) account.quotaAutoDisabled = true
  return account
}

export function sanitizeAuthFiles(files: JsonValue | undefined): CpaAccount[] {
  if (!isArray(files)) return []
  return files
    .map(sanitizeAuthFile)
    .filter((account): account is CpaAccount => account !== undefined)
}

function sanitizeProviderAccount(
  entry: JsonRecord,
  provider: string,
  fallbackLabel: string,
  meta: ProviderAccountMeta = {},
): CpaAccount | undefined {
  const authIndex = stringOrEmpty(firstScalar(entry, ['auth-index', 'authIndex']))
  if (authIndex === '') return undefined
  const label = stringOrEmpty(firstScalar(entry, ['name', 'label', 'prefix', 'base-url', 'baseUrl']))
    || fallbackLabel
    || authIndex
  const baseUrl = stringOrEmpty(firstScalar(entry, ['base-url', 'baseUrl', 'base_url'])) || meta.baseUrl || ''
  const prefix = stringOrEmpty(firstScalar(entry, ['prefix'])) || meta.prefix || ''
  const priority = firstNumber(entry, ['priority']) ?? meta.priority
  const note = stringOrEmpty(firstScalar(entry, ['note'])) || meta.note || ''
  const statusMessage = stringOrEmpty(firstScalar(entry, ['status_message', 'statusMessage'])) || meta.statusMessage || ''
  const aliases = modelAliases(entry).length > 0 ? modelAliases(entry) : meta.modelAliases || []
  const disableCooling = entry.disable_cooling === true || entry['disable-cooling'] === true || entry.disableCooling === true
    || meta.disableCooling === true
  const account: CpaAccount = {
    authIndex,
    label: label.slice(0, 120),
    provider,
    source: meta.source || 'api-key',
    status: '',
    disabled: entry.disabled === true,
    unavailable: false,
    success: 0,
    failed: 0,
    recentRequests: 0,
    planType: '',
    accountId: '',
    projectId: '',
  }
  if (statusMessage !== '') account.statusMessage = statusMessage
  if (baseUrl !== '') account.baseUrl = baseUrl
  if (prefix !== '') account.prefix = prefix
  if (priority !== undefined) account.priority = priority
  if (note !== '') account.note = note
  if (aliases.length > 0) account.modelAliases = aliases
  if (disableCooling) account.disableCooling = true
  return account
}

const OPENAI_COMPAT_PROVIDER_PREFIXES = [
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
] as const

function openAIProviderName(entry: JsonRecord): string {
  const rawName = stringOrEmpty(firstScalar(entry, ['name']))
  if (rawName === '') return 'openai-compatibility'
  const normalized = rawName.toLowerCase().replace(/[_\s-]+/g, ' ').trim()
  for (const [prefix, provider] of OPENAI_COMPAT_PROVIDER_PREFIXES) {
    if (normalized.startsWith(prefix)) return provider
  }
  return normalized.replace(/\s+/g, '-')
}

function providerMeta(entry: JsonRecord): ProviderAccountMeta {
  return {
    source: 'api-key',
    baseUrl: stringOrEmpty(firstScalar(entry, ['base-url', 'baseUrl', 'base_url'])),
    prefix: stringOrEmpty(firstScalar(entry, ['prefix'])),
    priority: firstNumber(entry, ['priority']),
    note: stringOrEmpty(firstScalar(entry, ['note'])),
    statusMessage: stringOrEmpty(firstScalar(entry, ['status_message', 'statusMessage'])),
    modelAliases: modelAliases(entry),
    disableCooling: entry.disable_cooling === true || entry['disable-cooling'] === true || entry.disableCooling === true,
  }
}

function sanitizeProviderAccounts(body: JsonValue | undefined, spec: ProviderEndpointSpec): CpaAccount[] {
  const record = asJsonRecord(body)
  let entries: JsonValue[] = []
  if (isArray(body)) {
    entries = body
  } else if (record !== null) {
    const keyed = record[spec.key]
    if (isArray(keyed)) {
      entries = keyed
    } else {
      const items = record.items
      if (isArray(items)) entries = items
    }
  }
  const accounts: CpaAccount[] = []
  for (const entry of entries) {
    if (!isJsonRecord(entry)) continue
    if (spec.key === 'openai-compatibility') {
      const provider = openAIProviderName(entry)
      const label = stringOrEmpty(firstScalar(entry, ['name', 'prefix', 'base-url', 'baseUrl']))
        || 'OpenAI Compatible'
      const meta = providerMeta(entry)
      const top = sanitizeProviderAccount(entry, provider, label, meta)
      if (top !== undefined) accounts.push(top)
      const keys = isArray(entry['api-key-entries'])
        ? entry['api-key-entries']
        : isArray(entry.api_key_entries)
          ? entry.api_key_entries
          : isArray(entry.apiKeyEntries)
            ? entry.apiKeyEntries
            : []
      for (let index = 0; index < keys.length; index += 1) {
        const keyRecord = asJsonRecord(keys[index])
        if (keyRecord === null) continue
        const merged: JsonRecord = { ...keyRecord }
        merged.disabled = entry.disabled === true || keyRecord.disabled === true
        const account = sanitizeProviderAccount(
          merged,
          provider,
          keys.length > 1 ? `${label} ${index + 1}` : label,
          meta,
        )
        if (account !== undefined) accounts.push(account)
      }
      continue
    }
    const account = sanitizeProviderAccount(entry, spec.provider, `${spec.provider} API`, providerMeta(entry))
    if (account !== undefined) accounts.push(account)
  }
  return accounts
}

export async function fetchApiProviders(baseURL: string, managementKey: string): Promise<CpaAccount[]> {
  const settled = await Promise.allSettled(PROVIDER_KEY_ENDPOINTS.map(async spec => {
    const body = await managementApi(baseURL, managementKey, spec.path)
    return sanitizeProviderAccounts(body, spec)
  }))
  return settled.flatMap(result => result.status === 'fulfilled' ? result.value : [])
}

export function publicAccount(account: CpaAccount): CpaAccountPublic {
  const { accountId: _accountId, projectId: _projectId, ...rest } = account
  void _accountId
  void _projectId
  return rest
}

export async function managementApiWithHeaders(
  baseURL: string,
  managementKey: string,
  path: string,
): Promise<{ body: JsonValue; headers: Headers }> {
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
  const raw: unknown = await response.json().catch(() => null)
  const body: JsonValue = isJsonRecord(raw) || isString(raw) || isNumber(raw) || isBoolean(raw) || raw === null || Array.isArray(raw)
    ? raw
    : {}
  return { body, headers: response.headers }
}

export async function managementApi(baseURL: string, managementKey: string, path: string): Promise<JsonValue> {
  const { body } = await managementApiWithHeaders(baseURL, managementKey, path)
  return body
}

export async function fetchAuthFiles(baseURL: string, managementKey: string): Promise<CpaAccount[]> {
  const body = await managementApi(baseURL, managementKey, '/v0/management/auth-files')
  return sanitizeAuthFiles(isJsonRecord(body) ? body.files : undefined)
}

async function apiCall(baseURL: string, managementKey: string, payload: ApiCallPayload): Promise<QuotaApiPayload | null> {
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
  const raw: unknown = await response.json().catch(() => null)
  const body: JsonValue = isJsonRecord(raw) || isString(raw) || isNumber(raw) || isBoolean(raw) || raw === null || Array.isArray(raw)
    ? raw
    : {}
  const root = isJsonRecord(body) ? body : null
  const statusCode = compactNumber(firstScalar(root, ['status_code', 'statusCode']), 0) ?? 0
  const parsed = parseBody(firstScalar(root, ['body']))
  if (statusCode < 200 || statusCode >= 300) {
    const error = firstScalar(parsed, ['error'])
    const detail = firstScalar(isJsonRecord(error) ? error : null, ['message'])
    throw new Error(isNonEmptyString(detail) ? detail : `upstream HTTP ${statusCode}`)
  }
  return parsed
}

const WHAM_HEADERS = {
  authorization: 'Bearer $TOKEN$',
  'content-type': 'application/json',
  'user-agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
}

function googleHeaders(metadata: Record<string, string> = {}): GoogleApiHeaders {
  const headers = {
    authorization: 'Bearer $TOKEN$',
    'content-type': 'application/json',
    'user-agent': 'google-api-nodejs-client/9.15.1',
    'x-goog-api-client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  }
  return Object.keys(metadata).length > 0
    ? { ...headers, 'client-metadata': JSON.stringify(metadata) }
    : headers
}

type QuotaQuery = (baseURL: string, managementKey: string, account: CpaAccount, now: Date) => Promise<CpaQuotaReport>

async function queryCodex(baseURL: string, managementKey: string, account: CpaAccount, now: Date): Promise<CpaQuotaReport> {
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
  return normalizeQuotaReport('codex', account.label, account.authIndex, account.planType, payload, now)
}

async function loadCodeAssist(
  baseURL: string,
  managementKey: string,
  authIndex: string,
  metadata: Record<string, string>,
  projectID = '',
): Promise<QuotaApiPayload | null> {
  const body: CodeAssistRequestBody = { metadata }
  if (projectID !== '') body.cloudaicompanionProject = projectID
  return apiCall(baseURL, managementKey, {
    auth_index: authIndex,
    method: 'POST',
    url: LOAD_CODE_ASSIST_URL,
    header: googleHeaders(metadata),
    data: JSON.stringify(body),
  })
}

async function queryGemini(baseURL: string, managementKey: string, account: CpaAccount, now: Date): Promise<CpaQuotaReport> {
  const metadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  let project = account.projectId
  if (project === '') {
    const loaded = await loadCodeAssist(baseURL, managementKey, account.authIndex, metadata)
    project = stringOrEmpty(firstScalar(loaded, ['cloudaicompanionProject'])
      ?? firstScalar(firstRecord(loaded, ['cloudaicompanionProject']), ['id']))
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

async function queryAntigravity(baseURL: string, managementKey: string, account: CpaAccount, now: Date): Promise<CpaQuotaReport> {
  const metadata = {
    ideType: 'ANTIGRAVITY',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  }
  let project = account.projectId
  if (project === '') {
    const loaded = await loadCodeAssist(baseURL, managementKey, account.authIndex, metadata)
    project = stringOrEmpty(firstScalar(loaded, ['cloudaicompanionProject'])
      ?? firstScalar(firstRecord(loaded, ['cloudaicompanionProject']), ['id']))
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

function quotaForProvider(provider: string): QuotaQuery | undefined {
  if (provider === 'codex') return queryCodex
  if (provider === 'gemini-cli') return queryGemini
  if (provider === 'antigravity') return queryAntigravity
  return undefined
}

function refreshedAtMs(report: CpaQuotaReport): number {
  const value = report.refreshedAt
  if (value === undefined) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class CpaQuotaService {
  readonly options: CpaQuotaServiceOptions
  accounts: CpaAccount[] = []
  accountsFetchedAt = 0
  accountsPromise: Promise<CpaAccount[]> | undefined
  readonly quota = new Map<string, CpaQuotaReport>()
  readonly inFlight = new Map<string, Promise<CpaQuotaReport | undefined>>()

  constructor(options: CpaQuotaServiceOptions) {
    this.options = options
  }

  snapshot(): CpaQuotaStatus {
    return {
      accounts: this.accounts.map(publicAccount),
      quota: Object.fromEntries(this.quota),
    }
  }

  async ensureAccounts(now = Date.now()): Promise<CpaAccount[]> {
    const ttl = optionValue(this.options.authFilesTtlMs) ?? 30_000
    if (now - this.accountsFetchedAt < ttl) return this.accounts
    if (this.accountsPromise !== undefined) return this.accountsPromise
    this.accountsPromise = this.refreshAccounts(now)
    try {
      return await this.accountsPromise
    } finally {
      this.accountsPromise = undefined
    }
  }

  async refreshAccounts(now = Date.now()): Promise<CpaAccount[]> {
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const [files, apiProviders] = await Promise.all([
      fetchAuthFiles(baseURL, managementKey),
      fetchApiProviders(baseURL, managementKey),
    ])
    this.accounts = [...files, ...apiProviders]
    this.accountsFetchedAt = now
    return this.accounts
  }

  async refreshQuota(now = Date.now()): Promise<Map<string, CpaQuotaReport>> {
    const accounts = await this.ensureAccounts(now)
    const tasks = accounts.filter(account => quotaForProvider(account.provider) !== undefined)
    if (tasks.length === 0) return this.quota
    const concurrency = optionValue(this.options.concurrency) ?? 4
    const queue = [...tasks]
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const account = queue.shift()
        if (account === undefined) continue
        await this.refreshOne(account, now)
      }
    })
    await Promise.allSettled(workers)
    return this.quota
  }

  async refreshOne(account: CpaAccount, now = Date.now()): Promise<CpaQuotaReport | undefined> {
    const existing = this.quota.get(account.authIndex)
    const refreshedAt = existing === undefined ? 0 : refreshedAtMs(existing)
    const ttl = optionValue(this.options.quotaTtlMs) ?? 60_000
    if (existing !== undefined && refreshedAt > 0 && now - refreshedAt < ttl) {
      return existing
    }
    const inflight = this.inFlight.get(account.authIndex)
    if (inflight !== undefined) return inflight
    const query = quotaForProvider(account.provider)
    if (query === undefined) return existing
    const baseURL = resolvedOption(this.options.baseURL)
    const managementKey = resolvedOption(this.options.managementKey)
    const task = (async () => {
      try {
        const report = await query(baseURL, managementKey, account, new Date(now))
        this.quota.set(account.authIndex, report)
        return report
      } catch {
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

  async status(): Promise<CpaQuotaStatus> {
    const now = Date.now()
    await this.ensureAccounts(now)
    try {
      await this.refreshQuota(now)
    } catch {
      // Quota is best-effort; keep cached account data available.
    }
    return this.snapshot()
  }
}
