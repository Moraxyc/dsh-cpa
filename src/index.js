import { readCpaSettings, resolveCpaSettingsFromConfig, resolveOptionsFromConfig, } from './core/config.js';
import { isError, isJsonRecord } from './core/json.js';
import { CpaController, resolveInitialCpaSettings } from './server/runtime.js';
export { Config } from './core/config.js';
export const name = 'dsh-cpa';
export const inject = ['llm'];
function errorMessage(cause) {
    return isError(cause) ? cause.message : String(cause);
}
const PROFILE_FIELDS = [
    'mode',
    'externalUrl',
    'externalApiKey',
    'externalManagementKey',
    'internalBin',
    'usageStatisticsEnabled',
    'routingStrategy',
    'dailyRequestLimit',
    'refreshIntervalMs',
    'port',
    'configPath',
    'settingsPath',
    'executionsPath',
    'authFilesTtlMs',
    'quotaTtlMs',
    'quotaConcurrency',
];
/**
 * Import the pre-0.1.7 settings file into the active profile once. The
 * profile's existing user layer wins field by field, so a user who already
 * edited the new form is never overwritten by the compatibility import.
 *
 * @returns the fields written to the profile, an empty object when the
 * profile was available but no write was needed, or undefined when migration
 * could not run and the caller should keep the legacy fallback.
 */
export async function migrateLegacySettings(ctx, persisted) {
    if (persisted === undefined)
        return undefined;
    const settings = ctx.get('settings');
    if (settings === undefined)
        return undefined;
    let descriptor;
    try {
        descriptor = settings.describe().find(row => row.ns === 'dsh-cpa');
    }
    catch (error) {
        ctx.logger?.warn?.(`dsh-cpa: failed to inspect profile settings: ${errorMessage(error)}`);
        return undefined;
    }
    if (descriptor === undefined)
        return undefined;
    const user = isJsonRecord(descriptor.user) ? descriptor.user : {};
    const patch = {};
    for (const field of PROFILE_FIELDS) {
        if (Object.hasOwn(user, field))
            continue;
        if (descriptor.secrets?.some(secret => secret.set
            && secret.path.length === 1
            && secret.path[0] === field))
            continue;
        const value = persisted[field];
        if (value !== undefined)
            Object.assign(patch, { [field]: value });
    }
    if (Object.keys(patch).length === 0)
        return {};
    try {
        await settings.update('dsh-cpa', patch, descriptor.revision);
        return patch;
    }
    catch (error) {
        ctx.logger?.warn?.(`dsh-cpa: failed to migrate legacy settings: ${errorMessage(error)}`);
        return undefined;
    }
}
/** Start the CPA runtime and bind live profile configuration to it. */
export async function apply(ctx, config) {
    const options = resolveOptionsFromConfig(config);
    let persisted;
    try {
        persisted = await readCpaSettings(options.settingsPath);
    }
    catch (error) {
        ctx.logger?.warn?.(`dsh-cpa: failed to read runtime settings: ${errorMessage(error)}`);
    }
    const migrated = await migrateLegacySettings(ctx, persisted);
    const configured = resolveCpaSettingsFromConfig(config, options);
    if (migrated !== undefined)
        Object.assign(configured, migrated);
    const controller = new CpaController(ctx, options, resolveInitialCpaSettings(options, persisted, configured, migrated !== undefined));
    await ctx.effect(async () => {
        const disposeConfigListener = ctx.on?.('loader/volatile-update', () => {
            const patch = resolveCpaSettingsFromConfig(config, options);
            const jsonPatch = {
                mode: patch.mode,
                externalUrl: patch.externalUrl,
                externalApiKey: patch.externalApiKey,
                externalManagementKey: patch.externalManagementKey,
                internalBin: patch.internalBin,
                usageStatisticsEnabled: patch.usageStatisticsEnabled,
                routingStrategy: patch.routingStrategy,
                dailyRequestLimit: patch.dailyRequestLimit,
                refreshIntervalMs: patch.refreshIntervalMs,
                port: patch.port,
                configPath: patch.configPath,
                settingsPath: patch.settingsPath,
                executionsPath: patch.executionsPath,
                authFilesTtlMs: patch.authFilesTtlMs,
                quotaTtlMs: patch.quotaTtlMs,
                quotaConcurrency: patch.quotaConcurrency,
            };
            void controller.update(jsonPatch, false).catch(error => {
                ctx.logger?.warn?.(`dsh-cpa: failed to apply profile settings: ${errorMessage(error)}`);
            });
        });
        await controller.install();
        return async () => {
            disposeConfigListener?.();
            await controller.dispose();
        };
    });
}
