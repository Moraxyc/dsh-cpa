import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path'
import { isError, isJsonRecord, isNonEmptyString, isNumber, isString } from './json.js'
import type { JsonRecord, JsonValue } from './json.js'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8317
export const DEFAULT_BIN = 'cli-proxy-api'
export const DEFAULT_REFRESH_MS = 300_000
export const DEFAULT_START_TIMEOUT_MS = 30_000
export const DEFAULT_CONTEXT_WINDOW = 262_144
export const DEFAULT_MAX_TOKENS = 32_768
export const DEFAULT_AUTH_FILES_TTL_MS = 30_000
export const DEFAULT_QUOTA_TTL_MS = 60_000
export const DEFAULT_QUOTA_CONCURRENCY = 4

export type CpaMode = 'internal' | 'external' | 'off'
export type ConfigScalar = string | number | boolean | null | undefined

export interface CpaSettings {
  mode: CpaMode
  externalUrl: string
  externalApiKey: string
  externalManagementKey: string
  internalBin: string
  usageStatisticsEnabled: boolean
  refreshIntervalMs: number
  port: number
  configPath: string
  settingsPath: string
  executionsPath: string
  authFilesTtlMs: number
  quotaTtlMs: number
  quotaConcurrency: number
}

export interface CpaOptions {
  provider: string
  apiKey: string
  apiKeyRef: string
  url: string
  managementKey: string
  bin: string
  configPath: string
  settingsPath: string
  executionsPath: string
  authFilesTtlMs: number
  quotaTtlMs: number
  quotaConcurrency: number
  host: string
  port: number
  refreshIntervalMs: number
  startTimeoutMs: number
  defaultContextWindow: number
  defaultMaxTokens: number
}

export interface CpaSettingsInput {
  mode?: ConfigScalar
  externalUrl?: ConfigScalar
  externalApiKey?: ConfigScalar
  externalManagementKey?: ConfigScalar
  internalBin?: ConfigScalar
  usageStatisticsEnabled?: ConfigScalar
  refreshIntervalMs?: ConfigScalar
  port?: ConfigScalar
  configPath?: ConfigScalar
  settingsPath?: ConfigScalar
  executionsPath?: ConfigScalar
  authFilesTtlMs?: ConfigScalar
  quotaTtlMs?: ConfigScalar
  quotaConcurrency?: ConfigScalar
}

export interface CpaOptionsInput {
  provider?: ConfigScalar
  apiKey?: ConfigScalar
  apiKeyRef?: ConfigScalar
  url?: ConfigScalar
  managementKey?: ConfigScalar
  bin?: ConfigScalar
  configPath?: ConfigScalar
  settingsPath?: ConfigScalar
  executionsPath?: ConfigScalar
  authFilesTtlMs?: ConfigScalar
  quotaTtlMs?: ConfigScalar
  quotaConcurrency?: ConfigScalar
  host?: ConfigScalar
  port?: ConfigScalar
  refreshIntervalMs?: ConfigScalar
  startTimeoutMs?: ConfigScalar
  defaultContextWindow?: ConfigScalar
  defaultMaxTokens?: ConfigScalar
}

export interface CpaReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface CpaReasoning {
  efforts: CpaReasoningEffort[]
  defaultEffort?: string
}

export interface CpaModel {
  id: string
  displayName?: string
  contextLength?: number
  maxCompletionTokens?: number
  reasoning?: CpaReasoning
}

export interface ModelCatalogEntry {
  id?: ConfigScalar
  slug?: ConfigScalar
  display_name?: ConfigScalar
  context_length?: ConfigScalar
  context_window?: ConfigScalar
  max_context_window?: ConfigScalar
  max_completion_tokens?: ConfigScalar
  supported_reasoning_levels?: unknown
  default_reasoning_level?: ConfigScalar
}

export interface ReasoningLevelInput {
  effort?: ConfigScalar
  description?: ConfigScalar
}

export interface ManagedConfigInput {
  host: string
  port: number
  apiKey: string
  managementKey: string
  usageStatisticsEnabled?: boolean
}

export interface ChildHandle {
  child: ChildProcess
  stderr: () => string
}

const REASONING_LEVEL_NAMES = new Map<string, string>([
  ['none', 'None'],
  ['auto', 'Auto'],
  ['minimal', 'Minimal'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'XHigh'],
  ['max', 'Max'],
  ['ultra', 'Ultra'],
])

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function randomKey(prefix: string): string {
  return `${prefix}-${randomBytes(24).toString('hex')}`
}

function stringOr(value: ConfigScalar, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback
}

export function positiveNumber(value: ConfigScalar, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function errorCode(cause: unknown): string | undefined {
  if (!isJsonRecord(cause)) return undefined
  const code = cause.code
  return isString(code) ? code : undefined
}

function errorMessage(cause: unknown): string {
  return isError(cause) ? cause.message : String(cause)
}

export function sanitizeCpaSettings(value: CpaSettingsInput | null | undefined): CpaSettings {
  const source: CpaSettingsInput = isJsonRecord(value) ? value : {}
  return {
    mode: source.mode === 'external' || source.mode === 'off' ? source.mode : 'internal',
    externalUrl: isString(source.externalUrl) ? source.externalUrl.trim() : '',
    externalApiKey: isString(source.externalApiKey) ? source.externalApiKey : '',
    externalManagementKey: isString(source.externalManagementKey) ? source.externalManagementKey : '',
    internalBin: isString(source.internalBin) ? source.internalBin.trim() : '',
    usageStatisticsEnabled: source.usageStatisticsEnabled !== false,
    refreshIntervalMs: positiveNumber(source.refreshIntervalMs, DEFAULT_REFRESH_MS),
    port: Number.isInteger(Number(source.port)) && Number(source.port) > 0
      ? Number(source.port)
      : DEFAULT_PORT,
    configPath: isString(source.configPath) ? source.configPath.trim() : '',
    settingsPath: isString(source.settingsPath) ? source.settingsPath.trim() : '',
    executionsPath: isString(source.executionsPath) ? source.executionsPath.trim() : '',
    authFilesTtlMs: positiveNumber(source.authFilesTtlMs, DEFAULT_AUTH_FILES_TTL_MS),
    quotaTtlMs: positiveNumber(source.quotaTtlMs, DEFAULT_QUOTA_TTL_MS),
    quotaConcurrency: Number.isInteger(Number(source.quotaConcurrency)) && Number(source.quotaConcurrency) > 0
      ? Number(source.quotaConcurrency)
      : DEFAULT_QUOTA_CONCURRENCY,
  }
}

export async function readCpaSettings(settingsPath: string): Promise<CpaSettings | undefined> {
  let raw: string
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
  const parsed: CpaSettingsInput = JSON.parse(raw)
  return sanitizeCpaSettings(parsed)
}

export async function writeCpaSettings(settingsPath: string, settings: CpaSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  await chmod(settingsPath, 0o600)
}

export function modelsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
}

export function chatCompletionsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

function reasoningLevelName(effort: string): string {
  return REASONING_LEVEL_NAMES.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

function normalizeReasoning(entry: JsonRecord): CpaReasoning | undefined {
  const supported = entry.supported_reasoning_levels
  if (!Array.isArray(supported)) return undefined
  const levels = supported.filter((value): value is JsonRecord => isJsonRecord(value))
  const seen = new Set<string>()
  const efforts: CpaReasoningEffort[] = []
  for (const item of levels) {
    const id = isString(item.effort) ? item.effort.trim().toLowerCase() : ''
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const effort: CpaReasoningEffort = { id, name: reasoningLevelName(id) }
    if (isString(item.description) && item.description.length > 0) {
      effort.description = item.description
    }
    efforts.push(effort)
  }
  if (efforts.length === 0) return undefined
  const defaultEffort = isString(entry.default_reasoning_level)
    ? entry.default_reasoning_level.trim().toLowerCase()
    : ''
  const reasoning: CpaReasoning = { efforts }
  if (defaultEffort.length > 0 && seen.has(defaultEffort)) {
    reasoning.defaultEffort = defaultEffort
  }
  return reasoning
}

function sortModels(models: CpaModel[]): CpaModel[] {
  return models.sort((left, right) => {
    const leftName = left.displayName ?? left.id
    const rightName = right.displayName ?? right.id
    const byName = leftName.localeCompare(rightName, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
    if (byName !== 0) return byName
    return left.id.localeCompare(right.id, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })
}

export function normalizeModels(data: readonly JsonValue[]): CpaModel[] {
  const models: CpaModel[] = []
  for (const entry of data) {
    if (!isJsonRecord(entry)) continue
    const id = isNonEmptyString(entry.id)
      ? entry.id
      : isNonEmptyString(entry.slug)
        ? entry.slug
        : undefined
    if (!isNonEmptyString(id)) continue
    const model: CpaModel = { id }
    if (isNonEmptyString(entry.display_name)) {
      model.displayName = entry.display_name
    }
    const contextLength = entry.context_length ?? entry.context_window ?? entry.max_context_window
    if (isNumber(contextLength) && Number.isInteger(contextLength) && contextLength > 0) {
      model.contextLength = contextLength
    }
    if (isNumber(entry.max_completion_tokens) && Number.isInteger(entry.max_completion_tokens) && entry.max_completion_tokens > 0) {
      model.maxCompletionTokens = entry.max_completion_tokens
    }
    const reasoning = normalizeReasoning(entry)
    if (reasoning !== undefined) model.reasoning = reasoning
    models.push(model)
  }
  return sortModels(models)
}

export async function fetchModels(baseURL: string, apiKey: string, timeoutMs = 10_000): Promise<CpaModel[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('model sync timed out'))
  }, timeoutMs)
  try {
    const headers: Record<string, string> = apiKey
      ? { accept: 'application/json', authorization: `Bearer ${apiKey}` }
      : { accept: 'application/json' }
    const url = new URL(modelsUrl(baseURL))
    url.searchParams.set('client_version', 'dsh-cpa')
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`models returned ${response.status}`)
    }
    const body: unknown = await response.json()
    const record = isJsonRecord(body) ? body : null
    const entries = Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : undefined
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('no models')
    }
    const models = normalizeModels(entries)
    if (models.length === 0) {
      throw new Error('no usable models')
    }
    return models
  } finally {
    clearTimeout(timer)
  }
}

export function buildManagedConfig({ host, port, apiKey, managementKey, usageStatisticsEnabled = true }: ManagedConfigInput): string {
  return [
    '# Managed by dsh-cpa. Overwritten on managed start.',
    `host: ${JSON.stringify(host)}`,
    `port: ${port}`,
    'remote-management:',
    '  allow-remote: false',
    `  secret-key: ${JSON.stringify(managementKey)}`,
    'auth-dir: "~/.cli-proxy-api"',
    'api-keys:',
    `  - ${JSON.stringify(apiKey)}`,
    'debug: false',
    `usage-statistics-enabled: ${usageStatisticsEnabled ? 'true' : 'false'}`,
    '',
  ].join('\n')
}

function executableNames(bin: string): string[] {
  if (process.platform !== 'win32') return [bin]
  if (/\.(exe|cmd|bat)$/i.test(bin)) return [bin]
  return [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`]
}

function executableCandidates(bin: string): string[] {
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) {
    return executableNames(bin)
  }
  return (process.env.PATH || '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)
    .flatMap(dir => executableNames(bin).map(name => join(dir, name)))
}

export async function resolveCpaBinary(bin: string): Promise<string | undefined> {
  if (!bin) return undefined
  for (const candidate of executableCandidates(bin)) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next PATH entry.
    }
  }
  return undefined
}

export async function assertCpaBinary(bin: string): Promise<string> {
  const resolved = await resolveCpaBinary(bin)
  if (!resolved) {
    const looksLikePath = isAbsolute(bin) || bin.includes('/') || bin.includes('\\')
    throw new Error(looksLikePath
      ? `CPA binary not found: ${bin}`
      : `CPA binary not found in PATH: ${bin}`)
  }
  return resolved
}

export async function writeManagedConfig(configPath: string, config: ManagedConfigInput): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, buildManagedConfig(config), { mode: 0o600 })
  await chmod(configPath, 0o600)
}

export function spawnCpa(bin: string, configPath: string, managementKey: string): ChildHandle {
  let stderr = ''
  const child = spawn(bin, ['--config', configPath], {
    env: { ...process.env, MANAGEMENT_PASSWORD: managementKey },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.resume()
  child.stderr?.on('data', chunk => {
    stderr = `${stderr}${chunk}`.slice(-4000)
  })
  return {
    child,
    stderr: () => stderr,
  }
}

export async function waitForCpa(baseURL: string, apiKey: string, timeoutMs: number, handle: ChildHandle): Promise<CpaModel[]> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  const exited = new Promise<never>((_, reject) => {
    handle.child.once('error', reject)
    handle.child.once('exit', (code, signal) => {
      reject(new Error(
        `cli-proxy-api exited (${code ?? signal})\n${handle.stderr()}`,
      ))
    })
  })
  const ready = (async () => {
    while (Date.now() < deadline) {
      if (handle.child.exitCode !== null) {
        throw new Error(
          `cli-proxy-api exited (code ${handle.child.exitCode})\n${handle.stderr()}`,
        )
      }
      try {
        return await fetchModels(baseURL, apiKey, Math.min(2000, deadline - Date.now()))
      } catch (error) {
        lastError = error
      }
      await delay(250)
    }
    throw new Error(`cli-proxy-api not ready: ${errorMessage(lastError)}`)
  })()
  return Promise.race([ready, exited])
}

export async function stopChild(handle: ChildHandle | undefined): Promise<void> {
  if (!handle) return
  const { child } = handle
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const killer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
  try {
    await exited
  } finally {
    clearTimeout(killer)
  }
}

export function resolveOptions(config: CpaOptionsInput = {}): CpaOptions {
  return {
    provider: stringOr(config.provider, 'cpa'),
    apiKey: stringOr(config.apiKey, ''),
    apiKeyRef: stringOr(config.apiKeyRef, 'CPA_API_KEY'),
    url: stringOr(config.url, ''),
    managementKey: stringOr(config.managementKey, ''),
    bin: stringOr(config.bin, DEFAULT_BIN),
    configPath: stringOr(config.configPath, join(dshHome(), 'cpa', 'config.yaml')),
    settingsPath: stringOr(config.settingsPath, join(dshHome(), 'cpa', 'settings.json')),
    executionsPath: stringOr(config.executionsPath, join(dshHome(), 'cpa', 'executions.json')),
    authFilesTtlMs: positiveNumber(config.authFilesTtlMs, DEFAULT_AUTH_FILES_TTL_MS),
    quotaTtlMs: positiveNumber(config.quotaTtlMs, DEFAULT_QUOTA_TTL_MS),
    quotaConcurrency: positiveNumber(config.quotaConcurrency, DEFAULT_QUOTA_CONCURRENCY),
    host: stringOr(config.host, DEFAULT_HOST),
    port: Number(config.port ?? DEFAULT_PORT),
    refreshIntervalMs: positiveNumber(config.refreshIntervalMs, DEFAULT_REFRESH_MS),
    startTimeoutMs: positiveNumber(config.startTimeoutMs, DEFAULT_START_TIMEOUT_MS),
    defaultContextWindow: positiveNumber(
      config.defaultContextWindow,
      DEFAULT_CONTEXT_WINDOW,
    ),
    defaultMaxTokens: positiveNumber(
      config.defaultMaxTokens,
      DEFAULT_MAX_TOKENS,
    ),
  }
}
