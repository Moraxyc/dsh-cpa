import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { CpaAdapter, resolveApiKey } from '../core/adapter.js'
import type { CpaExecutionEvent } from '../core/adapter.js'
import {
  assertCpaBinary,
  DEFAULT_AUTH_FILES_TTL_MS,
  DEFAULT_PORT,
  DEFAULT_QUOTA_CONCURRENCY,
  DEFAULT_QUOTA_TTL_MS,
  DEFAULT_REFRESH_MS,
  fetchModels,
  positiveNumber,
  randomKey,
  spawnCpa,
  stopChild,
  waitForCpa,
  writeCpaSettings,
  writeManagedConfig,
} from '../core/config.js'
import type {
  ChildHandle,
  ConfigScalar,
  CpaMode,
  CpaModel,
  CpaOptions,
  CpaSettings,
} from '../core/config.js'
import { isBoolean, isError, isNumber, isString } from '../core/json.js'
import type { JsonRecord, JsonValue } from '../core/json.js'
import {
  aggregateCpaUsage,
  CpaExecutionStore,
  sanitizeExecutionRecord,
  simpleProjectionSchema,
} from '../core/services.js'
import type {
  CpaUsageProjection,
  ExecutionInput,
  ExecutionRecord,
  ProjectionSchema,
} from '../core/services.js'
import { CpaDataService } from './data.js'
import { installManagementPanelWhenReady } from './management.js'
import type { CpaControllerState } from './management.js'
import { CpaQuotaService } from './quota.js'
import { selectCpaModels } from '../core/router.js'

export interface CpaRuntimeContext {
  get<T>(key: string): T | undefined
  logger?: { warn?: (message: string | Error) => void }
  sessions?: {
    get(sessionId: string): { append(type: string, data: ExecutionRecord): void } | undefined
  }
  inject?: (
    deps: readonly string[],
    factory: (ctx: SessionProjectionContext) => void,
  ) => { dispose(): void } | undefined
  llm: {
    registerAdapter(providers: readonly string[], adapter: LlmAdapter): () => void
  }
  effect(task: () => void | Promise<void> | Disposer | Promise<Disposer>): void | Promise<void>
}

type Disposer = () => void | Promise<void>

interface SessionProjectionContext {
  sessionProjections: {
    register(projection: SessionProjection): void
  }
}

interface SessionProjection {
  key: string
  schema: ProjectionSchema<unknown>
  init(): CpaUsageProjection | null
  apply(state: CpaUsageProjection | null, event: CpaUsageEvent): CpaUsageProjection | null
  view(state: CpaUsageProjection | null): CpaUsageProjection | null
  stateVersion: number
}

interface CpaUsageEvent {
  type: string
  data: ExecutionInput | null | undefined
}

function internalBaseURL(options: CpaOptions, port = options.port): string {
  return `http://${options.host}:${port}/v1`
}

function positiveInteger(value: ConfigScalar, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function scalar(value: JsonValue | undefined): ConfigScalar {
  return isString(value) || isNumber(value) || isBoolean(value) || value === null ? value : undefined
}

function errorMessage(cause: unknown): string {
  return isError(cause) ? cause.message : String(cause)
}

function isConnectionError(cause: unknown): boolean {
  const message = String(isError(cause) ? cause.message : cause)
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|timed out|aborted/i.test(message)
}

export function resolveInitialCpaSettings(
  options: CpaOptions,
  persisted: CpaSettings | undefined,
): CpaSettings {
  const initial: CpaSettings = {
    mode: options.url ? 'external' : 'internal',
    externalUrl: options.url || '',
    externalApiKey: options.apiKey || '',
    externalManagementKey: options.managementKey,
    internalBin: options.bin || '',
    usageStatisticsEnabled: true,
    refreshIntervalMs: options.refreshIntervalMs ?? DEFAULT_REFRESH_MS,
    port: options.port ?? DEFAULT_PORT,
    configPath: options.configPath || '',
    settingsPath: options.settingsPath || '',
    executionsPath: options.executionsPath || '',
    authFilesTtlMs: options.authFilesTtlMs ?? DEFAULT_AUTH_FILES_TTL_MS,
    quotaTtlMs: options.quotaTtlMs ?? DEFAULT_QUOTA_TTL_MS,
    quotaConcurrency: options.quotaConcurrency ?? DEFAULT_QUOTA_CONCURRENCY,
  }
  if (persisted === undefined) return initial

  const settings: CpaSettings = {
    mode: persisted.mode,
    externalUrl: persisted.externalUrl || options.url || '',
    externalApiKey: persisted.externalApiKey || initial.externalApiKey || '',
    externalManagementKey: persisted.externalManagementKey || initial.externalManagementKey || '',
    internalBin: persisted.internalBin || initial.internalBin || '',
    usageStatisticsEnabled: persisted.usageStatisticsEnabled !== false,
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
    && left.refreshIntervalMs === right.refreshIntervalMs
    && left.port === right.port
    && left.configPath === right.configPath
    && left.settingsPath === right.settingsPath
    && left.executionsPath === right.executionsPath
    && left.authFilesTtlMs === right.authFilesTtlMs
    && left.quotaTtlMs === right.quotaTtlMs
    && left.quotaConcurrency === right.quotaConcurrency
}

export class CpaController {
  private readonly ctx: CpaRuntimeContext
  private readonly options: CpaOptions
  private settings: CpaSettings
  private apiKey = ''
  private registration: (() => void) | undefined
  private handle: ChildHandle | undefined
  private models: CpaModel[] = []
  private active = false
  private activeMode: CpaMode | undefined
  private managementKey: string | undefined
  private lastError = ''
  private timer: ReturnType<typeof setInterval> | undefined
  private disposePanel: (() => void) | undefined
  private queue: Promise<void> = Promise.resolve()
  private readonly adapter: CpaAdapter
  private executionStore: CpaExecutionStore
  private readonly quotaService: CpaQuotaService
  private readonly dataService: CpaDataService
  private disposeProjection: (() => void) | undefined

  constructor(ctx: CpaRuntimeContext, options: CpaOptions, settings: CpaSettings) {
    this.ctx = ctx
    this.options = options
    this.settings = settings
    this.adapter = new CpaAdapter({
      baseURL: '',
      provider: options.provider,
      defaultContextWindow: options.defaultContextWindow,
      defaultMaxTokens: options.defaultMaxTokens,
      getModels: () => this.models,
      resolveApiKey: resolveApiKey(ctx, options.apiKeyRef, () => this.currentApiKey()),
      resolveRoute: options => this.resolveRoute(options),
      onExecution: execution => this.recordExecution(execution),
    })
    this.executionStore = new CpaExecutionStore(settings.executionsPath || options.executionsPath)
    this.quotaService = new CpaQuotaService({
      baseURL: () => this.currentBaseURL(),
      managementKey: () => this.managementKey ?? '',
      authFilesTtlMs: () => this.settings.authFilesTtlMs,
      quotaTtlMs: () => this.settings.quotaTtlMs,
      concurrency: () => this.settings.quotaConcurrency,
    })
    this.dataService = new CpaDataService({
      baseURL: () => this.currentBaseURL(),
      managementKey: () => this.managementKey ?? '',
      dataTtlMs: () => 30_000,
      modelTtlMs: () => 60_000,
      concurrency: () => 4,
    })
  }

  currentBaseURL(): string {
    return this.activeMode === 'external'
      ? this.settings.externalUrl
      : internalBaseURL(this.options, this.settings.port)
  }

  currentApiKey(): string {
    return this.apiKey || ''
  }

  async resolveRoute(options: Parameters<typeof selectCpaModels>[0]): Promise<readonly string[]> {
    const status = this.managementKey
      ? await this.quotaService.status()
      : this.quotaService.snapshot()
    return selectCpaModels(options, {
      models: this.models,
      accounts: status.accounts,
      quota: status.quota,
      defaultContextWindow: this.options.defaultContextWindow,
      defaultMaxTokens: this.options.defaultMaxTokens,
    })
  }

  getState(): CpaControllerState {
    return {
      mode: this.settings.mode,
      active: this.active,
      activeUrl: this.active ? this.currentBaseURL() : '',
      internalRunning: this.active && this.activeMode === 'internal',
      externalRunning: this.active && this.activeMode === 'external',
      managementAvailable: Boolean(this.managementKey),
      external: {
        url: this.settings.externalUrl,
        apiKeySet: Boolean(this.settings.externalApiKey),
        managementKeySet: Boolean(this.settings.externalManagementKey),
      },
      bin: this.settings.internalBin || this.options.bin,
      usageStatisticsEnabled: this.settings.usageStatisticsEnabled,
      refreshIntervalMs: this.settings.refreshIntervalMs,
      port: this.settings.port,
      configPath: this.settings.configPath,
      settingsPath: this.settings.settingsPath,
      executionsPath: this.settings.executionsPath,
      authFilesTtlMs: this.settings.authFilesTtlMs,
      quotaTtlMs: this.settings.quotaTtlMs,
      quotaConcurrency: this.settings.quotaConcurrency,
      error: this.lastError || '',
    }
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  update(patch: JsonRecord): Promise<CpaControllerState> {
    return this.enqueue(async () => {
      const next = mergeCpaSettings(this.settings, patch)
      if (cpaSettingsEqual(next, this.settings) && this.active) return this.getState()
      try {
        if (this.active && next.mode === this.settings.mode) await this.stopRuntime()
        await this.applySettings(next)
        this.settings = next
        this.lastError = ''
        try {
          const settingsPath = next.settingsPath || this.options.settingsPath
          await writeCpaSettings(settingsPath, next)
          if (settingsPath !== this.options.settingsPath) {
            await writeCpaSettings(this.options.settingsPath, next)
          }
        } catch (error) {
          this.lastError = `save failed: ${errorMessage(error)}`
          this.ctx.logger?.warn?.(`dsh-cpa: failed to save settings: ${this.lastError}`)
        }
        const executionsPath = next.executionsPath || this.options.executionsPath
        if (executionsPath !== this.executionStore.filePath) {
          const nextStore = new CpaExecutionStore(executionsPath)
          await nextStore.ensureLoaded()
          this.executionStore = nextStore
        }
        this.startTimer()
      } catch (error) {
        this.lastError = errorMessage(error)
        throw error
      }
      return this.getState()
    })
  }

  async install(): Promise<void> {
    await this.executionStore.ensureLoaded()
    try {
      await this.applySettings(this.settings)
    } catch (error) {
      this.lastError = errorMessage(error)
      this.ctx.logger?.warn?.(`dsh-cpa: initial start failed: ${this.lastError}`)
    }
    this.disposePanel = installManagementPanelWhenReady(this.ctx, {
      baseURL: () => this.currentBaseURL(),
      managementKey: () => this.managementKey ?? '',
      getState: () => this.getState(),
      update: patch => this.update(patch),
      executionStore: () => this.executionStore,
      quotaService: this.quotaService,
      dataService: this.dataService,
    })
    this.installProjection()
    this.startTimer()
  }

  async dispose(): Promise<void> {
    this.stopTimer()
    this.disposePanel?.()
    const disposeProjection = this.disposeProjection
    this.disposeProjection = undefined
    await disposeProjection?.()
    await this.queue
    await this.stopRuntime()
  }

  async recordExecution(value: CpaExecutionEvent): Promise<void> {
    try {
      const record = sanitizeExecutionRecord(value)
      if (record === undefined) return
      const sessionId = record.sessionId
      if (sessionId !== undefined && sessionId !== '') {
        try {
          this.ctx.sessions?.get(sessionId)?.append('cpa/execution', record)
        } catch (error) {
          this.ctx.logger?.warn?.(`dsh-cpa: session execution append failed: ${errorMessage(error)}`)
        }
      }
      await this.executionStore.append(record)
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: execution record failed: ${errorMessage(error)}`)
    }
  }

  installProjection(): void {
    if (this.disposeProjection !== undefined) return
    try {
      const fiber = this.ctx.inject?.(['sessionProjections'], projectionCtx => {
        projectionCtx.sessionProjections.register({
          key: 'cpaUsage',
          schema: simpleProjectionSchema(),
          init: () => null,
          apply: (state, event) => event.type === 'cpa/execution'
            ? aggregateCpaUsage(state, event.data) ?? null
            : state,
          view: state => state,
          stateVersion: 1,
        })
      })
      if (fiber !== undefined) {
        this.disposeProjection = () => fiber.dispose()
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: projection registration failed: ${errorMessage(error)}`)
      this.disposeProjection = undefined
    }
  }

  setApiKey(value: string): void {
    this.apiKey = value || ''
  }

  async stopRuntime(): Promise<void> {
    this.stopTimer()
    if (this.registration !== undefined) {
      this.registration()
      this.registration = undefined
    }
    await stopChild(this.handle)
    this.handle = undefined
    this.models = []
    this.active = false
    this.activeMode = undefined
    this.managementKey = undefined
    this.setApiKey('')
  }

  ensureRegistration(): void {
    if (this.registration !== undefined) return
    this.registration = this.ctx.llm.registerAdapter([this.options.provider], this.adapter)
  }

  async syncModels(baseURL = this.currentBaseURL(), apiKey = this.currentApiKey()): Promise<void> {
    try {
      this.models = await fetchModels(baseURL, apiKey, this.options.startTimeoutMs)
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: model sync failed: ${errorMessage(error)}`)
      this.models = []
    }
  }

  startTimer(): void {
    this.stopTimer()
    if (!this.active || this.settings.refreshIntervalMs <= 0) return
    this.timer = setInterval(() => {
      if (!this.active) return
      void this.syncModels()
    }, this.settings.refreshIntervalMs)
    this.timer.unref?.()
  }

  stopTimer(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async applySettings(next: CpaSettings): Promise<void> {
    if (next.mode === 'off') {
      await this.stopRuntime()
      return
    }
    if (next.mode === 'external') {
      await this.startExternal(next)
      return
    }
    await this.startInternal(next)
  }

  async startInternal(next: CpaSettings): Promise<void> {
    if (this.active && this.activeMode === 'internal') return

    const apiKey = randomKey('sk-dsh')
    const managementKey = randomKey('mgmt-dsh')
    const baseURL = internalBaseURL(this.options, next.port)
    const bin = next.internalBin || this.options.bin
    let resolvedBin: string
    try {
      resolvedBin = await assertCpaBinary(bin)
    } catch (error) {
      throw new Error(`start failed: ${errorMessage(error)}`)
    }
    await writeManagedConfig(next.configPath || this.options.configPath, {
      host: this.options.host,
      port: next.port,
      apiKey,
      managementKey,
      usageStatisticsEnabled: next.usageStatisticsEnabled,
    })
    const configPath = next.configPath || this.options.configPath
    const handle = spawnCpa(resolvedBin, configPath, managementKey)
    try {
      await waitForCpa(baseURL, apiKey, this.options.startTimeoutMs, handle)
    } catch (error) {
      await stopChild(handle)
      throw new Error(`start failed: ${errorMessage(error)}`)
    }

    const oldHandle = this.handle
    try {
      this.handle = handle
      handle.child.once('exit', () => {
        if (this.handle !== handle) return
        this.handle = undefined
        this.active = false
        this.activeMode = undefined
        this.managementKey = undefined
        this.models = []
        if (this.registration !== undefined) {
          this.registration()
          this.registration = undefined
        }
        this.setApiKey('')
        this.lastError = 'CPA exited'
      })
      this.adapter.options.baseURL = baseURL
      this.setApiKey(apiKey)
      this.ensureRegistration()
    } catch (error) {
      await stopChild(handle)
      if (this.handle === handle) this.handle = undefined
      this.setApiKey('')
      throw error
    }
    await this.syncModels(baseURL, apiKey)

    this.managementKey = managementKey
    this.activeMode = 'internal'
    this.active = true
    if (oldHandle !== undefined && oldHandle !== handle) await stopChild(oldHandle)
  }

  async startExternal(next: CpaSettings): Promise<void> {
    if (this.active && this.activeMode === 'external' && cpaSettingsEqual(next, this.settings)) return

    const baseURL = next.externalUrl
    if (!baseURL) throw new Error('URL required')
    let parsed: URL
    try {
      parsed = new URL(baseURL)
    } catch {
      throw new Error('invalid URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('URL must be http(s)')
    }

    const apiKey = next.externalApiKey
    try {
      await fetchModels(baseURL, apiKey, 5_000)
    } catch (error) {
      if (isConnectionError(error)) {
        throw new Error(`CPA unreachable: ${errorMessage(error)}`)
      }
    }

    const oldHandle = this.handle
    this.ensureRegistration()
    this.adapter.options.baseURL = baseURL
    this.setApiKey(apiKey)
    await this.syncModels(baseURL, apiKey)

    this.handle = undefined
    this.managementKey = next.externalManagementKey
    this.activeMode = 'external'
    this.active = true
    if (oldHandle !== undefined) await stopChild(oldHandle)
  }
}
