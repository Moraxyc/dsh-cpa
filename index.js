import { readCpaSettings, resolveOptions } from './config.js'
import { CpaController, resolveInitialCpaSettings } from './runtime.js'

export const name = 'dsh-cpa'
export const inject = ['llm']

export async function apply(ctx, config = {}) {
  const options = resolveOptions(config)
  let persisted
  try {
    persisted = await readCpaSettings(options.settingsPath)
  } catch (error) {
    ctx.logger?.warn?.(`dsh-cpa: failed to read runtime settings: ${error.message}`)
  }
  const controller = new CpaController(
    ctx,
    options,
    resolveInitialCpaSettings(options, persisted),
  )

  await ctx.effect(async () => {
    await controller.install()
    return () => controller.dispose()
  })
}
