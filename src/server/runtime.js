import { CpaAdapter, resolveApiKey } from '../core/adapter.js'
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
import { installManagementPanelWhenReady } from './management.js'
import { CpaQuotaService } from './quota.js'
import {
  aggregateCpaUsage,
  CpaExecutionStore,
  sanitizeExecutionRecord,
  simpleProjectionSchema,
} from '../core/services.js'

function internalBaseURL(options, port = options.port) {
  return `http://${options.host}:${port}/v1`
}

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function resolveInitialCpaSettings(options, persisted) {
  const initial = {
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

  const settings = {
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

export function mergeCpaSettings(current, patch) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = { ...current }
  if (source.mode !== undefined) {
    if (source.mode !== 'internal' && source.mode !== 'external' && source.mode !== 'off') {
      throw new Error('invalid mode')
    }
    next.mode = source.mode
  }
  if (typeof source.externalUrl === 'string') next.externalUrl = source.externalUrl.trim()
  if (typeof source.externalApiKey === 'string') next.externalApiKey = source.externalApiKey
  if (typeof source.externalManagementKey === 'string') next.externalManagementKey = source.externalManagementKey
  if (typeof source.internalBin === 'string') next.internalBin = source.internalBin.trim()
  if (typeof source.usageStatisticsEnabled === 'boolean') next.usageStatisticsEnabled = source.usageStatisticsEnabled
  if (source.refreshIntervalMs !== undefined) next.refreshIntervalMs = positiveNumber(source.refreshIntervalMs, next.refreshIntervalMs)
  if (source.port !== undefined) next.port = positiveInteger(source.port, next.port)
  if (source.authFilesTtlMs !== undefined) next.authFilesTtlMs = positiveNumber(source.authFilesTtlMs, next.authFilesTtlMs)
  if (source.quotaTtlMs !== undefined) next.quotaTtlMs = positiveNumber(source.quotaTtlMs, next.quotaTtlMs)
  if (source.quotaConcurrency !== undefined) next.quotaConcurrency = positiveInteger(source.quotaConcurrency, next.quotaConcurrency)
  for (const key of ['configPath', 'settingsPath', 'executionsPath']) {
    if (typeof source[key] === 'string' && source[key].trim() !== '') next[key] = source[key].trim()
  }
  return next
}

export function cpaSettingsEqual(left, right) {
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

function isConnectionError(error) {
  const message = String(error?.message || error)
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|timed out|aborted/i.test(message)
}

export class CpaController {
  constructor(ctx, options, settings) {
    this.ctx = ctx
    this.options = options
    this.settings = settings
    this.apiKey = ''
    this.registration
    this.handle
    this.models = []
    this.active = false
    this.activeMode
    this.managementKey
    this.lastError = ''
    this.timer
    this.disposePanel
    this.queue = Promise.resolve()
    this.adapter = new CpaAdapter({
      baseURL: '',
      provider: options.provider,
      defaultContextWindow: options.defaultContextWindow,
      defaultMaxTokens: options.defaultMaxTokens,
      getModels: () => this.models,
      resolveApiKey: resolveApiKey(ctx, options.apiKeyRef, () => this.currentApiKey()),
      onExecution: execution => this.recordExecution(execution),
    })
    this.executionStore = new CpaExecutionStore(settings.executionsPath || options.executionsPath)
    this.quotaService = new CpaQuotaService({
      baseURL: () => this.currentBaseURL(),
      managementKey: () => this.managementKey,
      authFilesTtlMs: () => this.settings.authFilesTtlMs,
      quotaTtlMs: () => this.settings.quotaTtlMs,
      concurrency: () => this.settings.quotaConcurrency,
    })
    this.disposeProjection
  }

  currentBaseURL() {
    return this.activeMode === 'external'
      ? this.settings.externalUrl
      : internalBaseURL(this.options, this.settings.port)
  }

  currentApiKey() {
    return this.apiKey || ''
  }

  getState() {
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

  enqueue(task) {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  update(patch) {
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
          this.lastError = `save failed: ${error?.message || String(error)}`
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
        this.lastError = error?.message || String(error)
        throw error
      }
      return this.getState()
    })
  }

  async install() {
    await this.executionStore.ensureLoaded()
    try {
      await this.applySettings(this.settings)
    } catch (error) {
      this.lastError = error?.message || String(error)
      this.ctx.logger?.warn?.(`dsh-cpa: initial start failed: ${this.lastError}`)
    }
    this.disposePanel = installManagementPanelWhenReady(this.ctx, {
      baseURL: () => this.currentBaseURL(),
      managementKey: () => this.managementKey,
      getState: () => this.getState(),
      update: patch => this.update(patch),
      executionStore: () => this.executionStore,
      quotaService: this.quotaService,
    })
    this.installProjection()
    this.startTimer()
  }

  async dispose() {
    this.stopTimer()
    this.disposePanel?.()
    const disposeProjection = this.disposeProjection
    this.disposeProjection = undefined
    await disposeProjection?.()
    await this.queue
    await this.stopRuntime()
  }

  async recordExecution(value) {
    try {
      const record = sanitizeExecutionRecord(value)
      if (record === undefined) return
      if (record.sessionId !== '') {
        try {
          this.ctx.sessions?.get(record.sessionId)?.append('cpa/execution', record)
        } catch (error) {
          this.ctx.logger?.warn?.(`dsh-cpa: session execution append failed: ${error?.message || String(error)}`)
        }
      }
      await this.executionStore.append(record)
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: execution record failed: ${error?.message || String(error)}`)
    }
  }

  installProjection() {
    if (this.disposeProjection) return
    try {
      const fiber = this.ctx.inject?.(['sessionProjections'], projectionCtx => {
        projectionCtx.sessionProjections.register({
          key: 'cpaUsage',
          schema: simpleProjectionSchema(),
          init: () => null,
          apply: (state, event) => event.type === 'cpa/execution'
            ? aggregateCpaUsage(state, event.data)
            : state,
          view: state => state,
          stateVersion: 1,
        })
      })
      if (fiber !== undefined) {
        this.disposeProjection = () => fiber.dispose()
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: projection registration failed: ${error?.message || String(error)}`)
      this.disposeProjection = undefined
    }
  }

  setApiKey(value) {
    this.apiKey = value || ''
  }

  async stopRuntime() {
    this.stopTimer()
    if (this.registration) {
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

  ensureRegistration() {
    if (this.registration) return
    this.registration = this.ctx.llm.registerAdapter([this.options.provider], this.adapter)
  }

  async syncModels(baseURL = this.currentBaseURL(), apiKey = this.currentApiKey()) {
    try {
      this.models = await fetchModels(baseURL, apiKey, this.options.startTimeoutMs)
    } catch (error) {
      this.ctx.logger?.warn?.(`dsh-cpa: model sync failed: ${error.message}`)
      this.models = []
    }
  }

  startTimer() {
    this.stopTimer()
    if (!this.active || this.settings.refreshIntervalMs <= 0) return
    this.timer = setInterval(() => {
      if (!this.active) return
      void this.syncModels()
    }, this.settings.refreshIntervalMs)
    this.timer.unref?.()
  }

  stopTimer() {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  async applySettings(next) {
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

  async startInternal(next) {
    if (this.active && this.activeMode === 'internal') return

    const apiKey = randomKey('sk-dsh')
    const managementKey = randomKey('mgmt-dsh')
    const baseURL = internalBaseURL(this.options, next.port)
    const bin = next.internalBin || this.options.bin
    let resolvedBin
    try {
      resolvedBin = await assertCpaBinary(bin)
    } catch (error) {
      throw new Error(`start failed: ${error.message}`)
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
      throw new Error(`start failed: ${error.message}`)
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
        if (this.registration) {
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

  async startExternal(next) {
    if (this.active && this.activeMode === 'external' && cpaSettingsEqual(next, this.settings)) return

    const baseURL = next.externalUrl
    if (!baseURL) throw new Error('URL required')
    let parsed
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
        throw new Error(`CPA unreachable: ${error.message}`)
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
