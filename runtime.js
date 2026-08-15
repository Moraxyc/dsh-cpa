import { CpaAdapter, resolveApiKey } from './adapter.js'
import {
  assertCpaBinary,
  fetchModels,
  randomKey,
  spawnCpa,
  stopChild,
  waitForCpa,
  writeCpaSettings,
  writeManagedConfig,
} from './config.js'
import { installManagementPanelWhenReady } from './management.js'

function internalBaseURL(options) {
  return `http://${options.host}:${options.port}/v1`
}

export function resolveInitialCpaSettings(options, persisted) {
  const envSettings = {
    mode: options.url ? 'external' : 'internal',
    externalUrl: options.url || '',
    externalApiKey: process.env[options.apiKeyEnv] || '',
    externalManagementKey: options.managementKey,
    internalBin: options.bin || '',
  }
  if (persisted === undefined) return envSettings

  const settings = {
    mode: persisted.mode,
    externalUrl: persisted.externalUrl || options.url || '',
    externalApiKey: persisted.externalApiKey || envSettings.externalApiKey || '',
    externalManagementKey: persisted.externalManagementKey || envSettings.externalManagementKey || '',
    internalBin: persisted.internalBin || envSettings.internalBin || '',
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
  return next
}

export function cpaSettingsEqual(left, right) {
  return left.mode === right.mode
    && left.externalUrl === right.externalUrl
    && left.externalApiKey === right.externalApiKey
    && left.externalManagementKey === right.externalManagementKey
    && left.internalBin === right.internalBin
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
    this.initialApiKey = process.env[options.apiKeyEnv]
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
      defaultContextWindow: options.defaultContextWindow,
      defaultMaxTokens: options.defaultMaxTokens,
      getModels: () => this.models,
      resolveApiKey: resolveApiKey(ctx, options.apiKeyEnv),
    })
  }

  currentBaseURL() {
    return this.activeMode === 'external'
      ? this.settings.externalUrl
      : internalBaseURL(this.options)
  }

  currentApiKey() {
    return process.env[this.options.apiKeyEnv] || ''
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
        await this.applySettings(next)
        this.settings = next
        this.lastError = ''
        try {
          await writeCpaSettings(this.options.settingsPath, next)
        } catch (error) {
          this.lastError = `save failed: ${error?.message || String(error)}`
          this.ctx.logger?.warn?.(`dsh-cpa: failed to save settings: ${this.lastError}`)
        }
      } catch (error) {
        this.lastError = error?.message || String(error)
        throw error
      }
      return this.getState()
    })
  }

  async install() {
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
    })
    this.startTimer()
  }

  async dispose() {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.disposePanel?.()
    await this.queue
    await this.stopRuntime()
    if (this.initialApiKey === undefined) {
      delete process.env[this.options.apiKeyEnv]
    } else {
      process.env[this.options.apiKeyEnv] = this.initialApiKey
    }
  }

  setApiKey(value) {
    if (value) {
      process.env[this.options.apiKeyEnv] = value
    } else {
      delete process.env[this.options.apiKeyEnv]
    }
  }

  async stopRuntime() {
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
    if (this.timer !== undefined || this.options.refreshIntervalMs <= 0) return
    this.timer = setInterval(() => {
      if (!this.active) return
      void this.syncModels()
    }, this.options.refreshIntervalMs)
    this.timer.unref?.()
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
    const baseURL = internalBaseURL(this.options)
    const bin = next.internalBin || this.options.bin
    let resolvedBin
    try {
      resolvedBin = await assertCpaBinary(bin)
    } catch (error) {
      throw new Error(`start failed: ${error.message}`)
    }
    await writeManagedConfig(this.options.configPath, {
      host: this.options.host,
      port: this.options.port,
      apiKey,
      managementKey,
    })
    const handle = spawnCpa(resolvedBin, this.options.configPath, managementKey)
    try {
      await waitForCpa(baseURL, apiKey, this.options.startTimeoutMs, handle)
    } catch (error) {
      await stopChild(handle)
      throw new Error(`start failed: ${error.message}`)
    }

    const previousApiKey = this.currentApiKey()
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
      if (previousApiKey) {
        process.env[this.options.apiKeyEnv] = previousApiKey
      } else {
        delete process.env[this.options.apiKeyEnv]
      }
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
