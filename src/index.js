import { readCpaSettings, resolveOptions } from './core/config.js';
import { isError } from './core/json.js';
import { CpaController, resolveInitialCpaSettings } from './server/runtime.js';
export const name = 'dsh-cpa';
export const inject = ['llm'];
function errorMessage(cause) {
    return isError(cause) ? cause.message : String(cause);
}
export async function apply(ctx, config = {}) {
    const options = resolveOptions(config);
    let persisted;
    try {
        persisted = await readCpaSettings(options.settingsPath);
    }
    catch (error) {
        ctx.logger?.warn?.(`dsh-cpa: failed to read runtime settings: ${errorMessage(error)}`);
    }
    const controller = new CpaController(ctx, options, resolveInitialCpaSettings(options, persisted));
    await ctx.effect(async () => {
        await controller.install();
        return () => controller.dispose();
    });
}
