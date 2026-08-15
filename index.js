import { CpaAdapter, resolveApiKey } from './adapter.js'
import {
  fetchModels,
  randomKey,
  resolveOptions,
  spawnCpa,
  stopChild,
  waitForCpa,
  writeManagedConfig,
} from './config.js'
import { installManagementPanelWhenReady } from './management.js'

export const name = 'dsh-cpa'
export const inject = ['llm']

function modelsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function apply(ctx, config = {}) {
  const options = resolveOptions(config)
  const baseURL = options.url || `http://${options.host}:${options.port}/v1`
  const externalCpa = options.url.length > 0
  let apiKey = process.env[options.apiKeyEnv] || ''
  let managementKey = options.managementKey
  let cpaHandle
  let models = []

  await ctx.effect(async () => {
    try {
      if (!externalCpa) {
        apiKey = apiKey || randomKey('sk-dsh')
        managementKey = managementKey || randomKey('mgmt-dsh')
        await writeManagedConfig(options.configPath, {
          host: options.host,
          port: options.port,
          apiKey,
          managementKey,
        })
        cpaHandle = spawnCpa(options.bin, options.configPath, managementKey)
        process.env[options.apiKeyEnv] = apiKey
        await waitForCpa(baseURL, apiKey, options.startTimeoutMs, cpaHandle)
        ctx.logger.info(`dsh-cpa: started cli-proxy-api at ${baseURL}`)
      } else if (!apiKey) {
        ctx.logger.warn(
          `dsh-cpa: ${options.apiKeyEnv} is not set; the provider route requires it before requests succeed`,
        )
      }

      try {
        models = await fetchModels(baseURL, apiKey, options.startTimeoutMs)
      } catch (error) {
        ctx.logger.warn(`dsh-cpa: model sync failed, the route will accept unlisted models: ${error.message}`)
      }

      const adapter = new CpaAdapter({
        baseURL,
        defaultContextWindow: options.defaultContextWindow,
        defaultMaxTokens: options.defaultMaxTokens,
        getModels: () => models,
        resolveApiKey: resolveApiKey(ctx, options.apiKeyEnv),
      })
      ctx.llm.registerAdapter([options.provider], adapter)
      const disposePanel = installManagementPanelWhenReady(ctx, { baseURL, managementKey })
      let lastModels = models

      if (options.refreshIntervalMs <= 0) {
        return async () => {
          disposePanel()
          await stopChild(cpaHandle)
        }
      }

      const timer = setInterval(async () => {
        try {
          const next = await fetchModels(baseURL, process.env[options.apiKeyEnv] || apiKey, 10_000)
          if (!modelsEqual(next, lastModels)) {
            models = next
            lastModels = next
          }
        } catch (error) {
          ctx.logger.warn(`dsh-cpa: model refresh failed: ${error.message}`)
        }
      }, options.refreshIntervalMs)
      timer.unref?.()

      return async () => {
        disposePanel()
        clearInterval(timer)
        await stopChild(cpaHandle)
      }
    } catch (error) {
      await stopChild(cpaHandle)
      throw error
    }
  })
}
