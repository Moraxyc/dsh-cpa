import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isBoolean, isJsonRecord, isNonEmptyString, isNumber, isString } from './json.js'
import type { JsonRecord, JsonValue } from './json.js'
import type {
  CpaMode,
  CpaRoutingStrategy,
} from './wire.js'

export type {
  CpaInputModality,
  CpaMode,
  CpaModel,
  CpaReasoning,
  CpaReasoningEffort,
  CpaRoutingStrategy,
} from './wire.js'

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
export const DEFAULT_ROUTING_STRATEGY = 'balanced'
export const DEFAULT_DAILY_REQUEST_LIMIT = 0

export type ConfigScalar = string | number | boolean | null | undefined

export interface CpaSettings {
  mode: CpaMode
  externalUrl: string
  externalApiKey: string
  externalManagementKey: string
  internalBin: string
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
  routingStrategy?: ConfigScalar
  dailyRequestLimit?: ConfigScalar
  refreshIntervalMs?: ConfigScalar
  port?: ConfigScalar
  configPath?: ConfigScalar
  settingsPath?: ConfigScalar
  executionsPath?: ConfigScalar
  authFilesTtlMs?: ConfigScalar
  quotaTtlMs?: ConfigScalar
  quotaConcurrency?: ConfigScalar
}

export interface Config {
  provider: string
  apiKey?: string
  apiKeyRef: string
  url?: string
  managementKey?: string
  bin: string
  host: string
  startTimeoutMs: number
  defaultContextWindow: number
  defaultMaxTokens: number
  mode: Volatile<CpaMode | undefined>
  externalUrl: Volatile<string | undefined>
  externalApiKey: Volatile<string | undefined>
  externalManagementKey: Volatile<string | undefined>
  internalBin: Volatile<string | undefined>
  usageStatisticsEnabled: Volatile<boolean>
  routingStrategy: Volatile<CpaRoutingStrategy>
  dailyRequestLimit: Volatile<number>
  refreshIntervalMs: Volatile<number>
  port: Volatile<number>
  configPath: Volatile<string | undefined>
  settingsPath: Volatile<string | undefined>
  executionsPath: Volatile<string | undefined>
  authFilesTtlMs: Volatile<number>
  quotaTtlMs: Volatile<number>
  quotaConcurrency: Volatile<number>
}

export const Config = z.object({
  provider: z.string().default('cpa'),
  apiKey: z.string().role('secret'),
  apiKeyRef: z.string().default('CPA_API_KEY'),
  url: z.string(),
  managementKey: z.string().role('secret'),
  bin: z.string().default(DEFAULT_BIN),
  host: z.string().default(DEFAULT_HOST),
  startTimeoutMs: z.number().step(1).min(1).default(DEFAULT_START_TIMEOUT_MS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  defaultMaxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  mode: z.union(['internal', 'external', 'off']).volatile(),
  externalUrl: z.string().volatile(),
  externalApiKey: z.string().role('secret').volatile(),
  externalManagementKey: z.string().role('secret').volatile(),
  internalBin: z.string().volatile(),
  usageStatisticsEnabled: z.boolean().default(true).volatile(),
  routingStrategy: z.union(['balanced', 'quality', 'availability', 'quota'])
    .default(DEFAULT_ROUTING_STRATEGY)
    .volatile(),
  dailyRequestLimit: z.number().step(1).min(0).default(DEFAULT_DAILY_REQUEST_LIMIT).volatile(),
  refreshIntervalMs: z.number().step(1).min(1).default(DEFAULT_REFRESH_MS).volatile(),
  port: z.number().step(1).min(1).default(DEFAULT_PORT).volatile(),
  configPath: z.string().volatile(),
  settingsPath: z.string().volatile(),
  executionsPath: z.string().volatile(),
  authFilesTtlMs: z.number().step(1).min(1).default(DEFAULT_AUTH_FILES_TTL_MS).volatile(),
  quotaTtlMs: z.number().step(1).min(1).default(DEFAULT_QUOTA_TTL_MS).volatile(),
  quotaConcurrency: z.number().step(1).min(1).default(DEFAULT_QUOTA_CONCURRENCY).volatile(),
})

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

export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function stringOr(value: ConfigScalar, fallback: string): string {
  return isNonEmptyString(value) ? value : fallback
}

export function positiveNumber(value: ConfigScalar, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function positiveInteger(value: ConfigScalar, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeNumber(value: ConfigScalar, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function routingStrategy(value: JsonValue | undefined, fallback: CpaRoutingStrategy): CpaRoutingStrategy {
  return value === 'quality' || value === 'availability' || value === 'quota' || value === 'balanced'
    ? value
    : fallback
}

function scalar(value: JsonValue | undefined): ConfigScalar {
  return isString(value) || isNumber(value) || isBoolean(value) || value === null ? value : undefined
}

function errorCode(cause: unknown): string | undefined {
  if (!isJsonRecord(cause)) return undefined
  const code = cause.code
  return isString(code) ? code : undefined
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
    routingStrategy: source.routingStrategy === 'quality'
      || source.routingStrategy === 'availability'
      || source.routingStrategy === 'quota'
      ? source.routingStrategy
      : DEFAULT_ROUTING_STRATEGY,
    dailyRequestLimit: nonNegativeNumber(source.dailyRequestLimit, DEFAULT_DAILY_REQUEST_LIMIT),
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

export function resolveInitialCpaSettings(
  options: CpaOptions,
  persisted: CpaSettings | undefined,
  configured?: Partial<CpaSettings>,
  preferConfigured = false,
): CpaSettings {
  const initial: CpaSettings = {
    mode: options.url ? 'external' : 'internal',
    externalUrl: options.url || '',
    externalApiKey: options.apiKey || '',
    externalManagementKey: options.managementKey,
    internalBin: options.bin || '',
    usageStatisticsEnabled: true,
    routingStrategy: DEFAULT_ROUTING_STRATEGY,
    dailyRequestLimit: DEFAULT_DAILY_REQUEST_LIMIT,
    refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_MS,
    port: options.port ?? DEFAULT_PORT,
    configPath: options.configPath || '',
    settingsPath: options.settingsPath || '',
    executionsPath: options.executionsPath || '',
    authFilesTtlMs: options.authFilesTtlMs ?? DEFAULT_AUTH_FILES_TTL_MS,
    quotaTtlMs: options.quotaTtlMs ?? DEFAULT_QUOTA_TTL_MS,
    quotaConcurrency: options.quotaConcurrency ?? DEFAULT_QUOTA_CONCURRENCY,
  }
  if (persisted === undefined && configured === undefined) return initial

  if (preferConfigured && configured !== undefined) {
    const settings = {
      ...initial,
      ...configured,
    }
    if (settings.mode === 'external' && !settings.externalUrl) {
      settings.mode = options.url ? 'external' : 'internal'
      settings.externalUrl = options.url || ''
    }
    return settings
  }

  if (persisted === undefined) {
    return {
      ...initial,
      ...configured,
    }
  }

  const settings: CpaSettings = {
    mode: persisted.mode,
    externalUrl: persisted.externalUrl || options.url || '',
    externalApiKey: persisted.externalApiKey || initial.externalApiKey || '',
    externalManagementKey: persisted.externalManagementKey || initial.externalManagementKey || '',
    internalBin: persisted.internalBin || initial.internalBin || '',
    usageStatisticsEnabled: persisted.usageStatisticsEnabled !== false,
    routingStrategy: routingStrategy(persisted.routingStrategy, initial.routingStrategy),
    dailyRequestLimit: persisted.dailyRequestLimit ?? initial.dailyRequestLimit,
    refreshIntervalMs: persisted.refreshIntervalMs || initial.refreshIntervalMs,
    port: persisted.port || initial.port,
    configPath: persisted.configPath || initial.configPath,
    settingsPath: persisted.settingsPath || initial.settingsPath,
    executionsPath: persisted.executionsPath || initial.executionsPath,
    authFilesTtlMs: persisted.authFilesTtlMs || initial.authFilesTtlMs,
    quotaTtlMs: persisted.quotaTtlMs || initial.quotaTtlMs,
    quotaConcurrency: persisted.quotaConcurrency || initial.quotaConcurrency,
  }
  if (settings.mode === 'external' && !settings.externalUrl) {
    settings.mode = options.url ? 'external' : 'internal'
    settings.externalUrl = options.url || ''
  }
  return settings
}

export function mergeCpaSettings(current: CpaSettings, patch: JsonRecord): CpaSettings {
  const next = { ...current }
  const mode = patch.mode
  if (mode === 'internal' || mode === 'external' || mode === 'off') {
    next.mode = mode
  } else if (mode !== undefined) {
    throw new Error('invalid mode')
  }
  if (isString(patch.externalUrl)) next.externalUrl = patch.externalUrl.trim()
  if (isString(patch.externalApiKey)) next.externalApiKey = patch.externalApiKey
  if (isString(patch.externalManagementKey)) next.externalManagementKey = patch.externalManagementKey
  if (isString(patch.internalBin)) next.internalBin = patch.internalBin.trim()
  if (isBoolean(patch.usageStatisticsEnabled)) next.usageStatisticsEnabled = patch.usageStatisticsEnabled
  if (patch.routingStrategy !== undefined) {
    if (patch.routingStrategy === 'balanced' || patch.routingStrategy === 'quality'
      || patch.routingStrategy === 'availability' || patch.routingStrategy === 'quota') {
      next.routingStrategy = patch.routingStrategy
    } else {
      throw new Error('invalid routing strategy')
    }
  }
  if (patch.dailyRequestLimit !== undefined) {
    next.dailyRequestLimit = nonNegativeNumber(scalar(patch.dailyRequestLimit), next.dailyRequestLimit)
  }
  if (patch.refreshIntervalMs !== undefined) next.refreshIntervalMs = positiveNumber(scalar(patch.refreshIntervalMs), next.refreshIntervalMs)
  if (patch.port !== undefined) next.port = positiveInteger(scalar(patch.port), next.port)
  if (patch.authFilesTtlMs !== undefined) next.authFilesTtlMs = positiveNumber(scalar(patch.authFilesTtlMs), next.authFilesTtlMs)
  if (patch.quotaTtlMs !== undefined) next.quotaTtlMs = positiveNumber(scalar(patch.quotaTtlMs), next.quotaTtlMs)
  if (patch.quotaConcurrency !== undefined) next.quotaConcurrency = positiveInteger(scalar(patch.quotaConcurrency), next.quotaConcurrency)
  for (const key of ['configPath', 'settingsPath', 'executionsPath'] as const) {
    const value = patch[key]
    if (isString(value) && value.trim() !== '') next[key] = value.trim()
  }
  return next
}

export function cpaSettingsEqual(left: CpaSettings, right: CpaSettings): boolean {
  return left.mode === right.mode
    && left.externalUrl === right.externalUrl
    && left.externalApiKey === right.externalApiKey
    && left.externalManagementKey === right.externalManagementKey
    && left.internalBin === right.internalBin
    && left.usageStatisticsEnabled === right.usageStatisticsEnabled
    && left.routingStrategy === right.routingStrategy
    && left.dailyRequestLimit === right.dailyRequestLimit
    && left.refreshIntervalMs === right.refreshIntervalMs
    && left.port === right.port
    && left.configPath === right.configPath
    && left.settingsPath === right.settingsPath
    && left.executionsPath === right.executionsPath
    && left.authFilesTtlMs === right.authFilesTtlMs
    && left.quotaTtlMs === right.quotaTtlMs
    && left.quotaConcurrency === right.quotaConcurrency
}

function volatileValue<T extends string | number | boolean>(value: Volatile<T | undefined>, fallback: T): T {
  // SAFETY: Config marks these Volatile values as scalar fields, so their snapshots preserve T.
  return (value.get() as T | undefined) ?? fallback
}

export function resolveOptionsFromConfig(config: Config): CpaOptions {
  return resolveOptions({
    provider: config.provider,
    apiKey: config.apiKey,
    apiKeyRef: config.apiKeyRef,
    url: config.url,
    managementKey: config.managementKey,
    bin: config.bin,
    configPath: config.configPath.get(),
    settingsPath: config.settingsPath.get(),
    executionsPath: config.executionsPath.get(),
    authFilesTtlMs: config.authFilesTtlMs.get(),
    quotaTtlMs: config.quotaTtlMs.get(),
    quotaConcurrency: config.quotaConcurrency.get(),
    host: config.host,
    port: config.port.get(),
    refreshIntervalMs: config.refreshIntervalMs.get(),
    startTimeoutMs: config.startTimeoutMs,
    defaultContextWindow: config.defaultContextWindow,
    defaultMaxTokens: config.defaultMaxTokens,
  })
}

export function resolveCpaSettingsFromConfig(config: Config, options: CpaOptions): CpaSettings {
  return {
    mode: volatileValue(config.mode, options.url ? 'external' : 'internal'),
    externalUrl: volatileValue(config.externalUrl, options.url),
    externalApiKey: volatileValue(config.externalApiKey, options.apiKey),
    externalManagementKey: volatileValue(config.externalManagementKey, options.managementKey),
    internalBin: volatileValue(config.internalBin, options.bin),
    usageStatisticsEnabled: volatileValue(config.usageStatisticsEnabled, true),
    routingStrategy: volatileValue(config.routingStrategy, DEFAULT_ROUTING_STRATEGY),
    dailyRequestLimit: volatileValue(config.dailyRequestLimit, DEFAULT_DAILY_REQUEST_LIMIT),
    refreshIntervalMs: volatileValue(config.refreshIntervalMs, options.refreshIntervalMs),
    port: volatileValue(config.port, options.port),
    configPath: volatileValue(config.configPath, options.configPath),
    settingsPath: volatileValue(config.settingsPath, options.settingsPath),
    executionsPath: volatileValue(config.executionsPath, options.executionsPath),
    authFilesTtlMs: volatileValue(config.authFilesTtlMs, options.authFilesTtlMs),
    quotaTtlMs: volatileValue(config.quotaTtlMs, options.quotaTtlMs),
    quotaConcurrency: volatileValue(config.quotaConcurrency, options.quotaConcurrency),
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
