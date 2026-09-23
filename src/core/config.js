import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { isError, isJsonRecord, isNonEmptyString, isNumber, isString } from './json.js';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8317;
export const DEFAULT_BIN = 'cli-proxy-api';
export const DEFAULT_REFRESH_MS = 300_000;
export const DEFAULT_START_TIMEOUT_MS = 30_000;
export const DEFAULT_CONTEXT_WINDOW = 262_144;
export const DEFAULT_MAX_TOKENS = 32_768;
export const DEFAULT_AUTH_FILES_TTL_MS = 30_000;
export const DEFAULT_QUOTA_TTL_MS = 60_000;
export const DEFAULT_QUOTA_CONCURRENCY = 4;
export const DEFAULT_ROUTING_STRATEGY = 'balanced';
export const DEFAULT_DAILY_REQUEST_LIMIT = 0;
/** Schema consumed by the Host loader and projected into dsh configuration forms. */
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
});
const REASONING_LEVEL_NAMES = new Map([
    ['none', 'None'],
    ['auto', 'Auto'],
    ['minimal', 'Minimal'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['xhigh', 'XHigh'],
    ['max', 'Max'],
    ['ultra', 'Ultra'],
]);
export function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh');
}
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function randomKey(prefix) {
    return `${prefix}-${randomBytes(24).toString('hex')}`;
}
function stringOr(value, fallback) {
    return isNonEmptyString(value) ? value : fallback;
}
export function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function nonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function errorCode(cause) {
    if (!isJsonRecord(cause))
        return undefined;
    const code = cause.code;
    return isString(code) ? code : undefined;
}
function errorMessage(cause) {
    return isError(cause) ? cause.message : String(cause);
}
export function sanitizeCpaSettings(value) {
    const source = isJsonRecord(value) ? value : {};
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
    };
}
export async function readCpaSettings(settingsPath) {
    let raw;
    try {
        raw = await readFile(settingsPath, 'utf8');
    }
    catch (error) {
        if (errorCode(error) === 'ENOENT')
            return undefined;
        throw error;
    }
    const parsed = JSON.parse(raw);
    return sanitizeCpaSettings(parsed);
}
export async function writeCpaSettings(settingsPath, settings) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await chmod(settingsPath, 0o600);
}
export function modelsUrl(baseURL) {
    const base = baseURL.replace(/\/+$/, '');
    return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}
export function chatCompletionsUrl(baseURL) {
    const base = baseURL.replace(/\/+$/, '');
    return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}
function reasoningLevelName(effort) {
    return REASONING_LEVEL_NAMES.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}
function normalizeReasoning(entry) {
    const supported = entry.supported_reasoning_levels;
    if (!Array.isArray(supported))
        return undefined;
    const levels = supported.filter((value) => isJsonRecord(value));
    const seen = new Set();
    const efforts = [];
    for (const item of levels) {
        const id = isString(item.effort) ? item.effort.trim().toLowerCase() : '';
        if (id.length === 0 || seen.has(id))
            continue;
        seen.add(id);
        const effort = { id, name: reasoningLevelName(id) };
        if (isString(item.description) && item.description.length > 0) {
            effort.description = item.description;
        }
        efforts.push(effort);
    }
    if (efforts.length === 0)
        return undefined;
    const defaultEffort = isString(entry.default_reasoning_level)
        ? entry.default_reasoning_level.trim().toLowerCase()
        : '';
    const reasoning = { efforts };
    if (defaultEffort.length > 0 && seen.has(defaultEffort)) {
        reasoning.defaultEffort = defaultEffort;
    }
    return reasoning;
}
function sortModels(models) {
    return models.sort((left, right) => {
        const leftName = left.displayName ?? left.id;
        const rightName = right.displayName ?? right.id;
        const byName = leftName.localeCompare(rightName, undefined, {
            numeric: true,
            sensitivity: 'base',
        });
        if (byName !== 0)
            return byName;
        return left.id.localeCompare(right.id, undefined, {
            numeric: true,
            sensitivity: 'base',
        });
    });
}
export function normalizeModels(data) {
    const models = [];
    for (const entry of data) {
        if (!isJsonRecord(entry))
            continue;
        const id = isNonEmptyString(entry.id)
            ? entry.id
            : isNonEmptyString(entry.slug)
                ? entry.slug
                : undefined;
        if (!isNonEmptyString(id))
            continue;
        const model = { id };
        if (isNonEmptyString(entry.display_name)) {
            model.displayName = entry.display_name;
        }
        const contextLength = entry.context_length ?? entry.context_window ?? entry.max_context_window;
        if (isNumber(contextLength) && Number.isInteger(contextLength) && contextLength > 0) {
            model.contextLength = contextLength;
        }
        if (isNumber(entry.max_completion_tokens) && Number.isInteger(entry.max_completion_tokens) && entry.max_completion_tokens > 0) {
            model.maxCompletionTokens = entry.max_completion_tokens;
        }
        const reasoning = normalizeReasoning(entry);
        if (reasoning !== undefined)
            model.reasoning = reasoning;
        models.push(model);
    }
    return sortModels(models);
}
export async function fetchModels(baseURL, apiKey, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new Error('model sync timed out'));
    }, timeoutMs);
    try {
        const headers = apiKey
            ? { accept: 'application/json', authorization: `Bearer ${apiKey}` }
            : { accept: 'application/json' };
        const url = new URL(modelsUrl(baseURL));
        url.searchParams.set('client_version', 'dsh-cpa');
        const response = await fetch(url, {
            headers,
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`models returned ${response.status}`);
        }
        const body = await response.json();
        const record = isJsonRecord(body) ? body : null;
        const entries = Array.isArray(record?.data)
            ? record.data
            : Array.isArray(record?.models)
                ? record.models
                : undefined;
        if (!Array.isArray(entries) || entries.length === 0) {
            throw new Error('no models');
        }
        const models = normalizeModels(entries);
        if (models.length === 0) {
            throw new Error('no usable models');
        }
        return models;
    }
    finally {
        clearTimeout(timer);
    }
}
export function buildManagedConfig({ host, port, apiKey, managementKey, usageStatisticsEnabled = true }) {
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
    ].join('\n');
}
function executableNames(bin) {
    if (process.platform !== 'win32')
        return [bin];
    if (/\.(exe|cmd|bat)$/i.test(bin))
        return [bin];
    return [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`];
}
function executableCandidates(bin) {
    if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) {
        return executableNames(bin);
    }
    return (process.env.PATH || '')
        .split(delimiter)
        .map(dir => dir.trim())
        .filter(Boolean)
        .flatMap(dir => executableNames(bin).map(name => join(dir, name)));
}
export async function resolveCpaBinary(bin) {
    if (!bin)
        return undefined;
    for (const candidate of executableCandidates(bin)) {
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        }
        catch {
            // Try the next PATH entry.
        }
    }
    return undefined;
}
export async function assertCpaBinary(bin) {
    const resolved = await resolveCpaBinary(bin);
    if (!resolved) {
        const looksLikePath = isAbsolute(bin) || bin.includes('/') || bin.includes('\\');
        throw new Error(looksLikePath
            ? `CPA binary not found: ${bin}`
            : `CPA binary not found in PATH: ${bin}`);
    }
    return resolved;
}
export async function writeManagedConfig(configPath, config) {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, buildManagedConfig(config), { mode: 0o600 });
    await chmod(configPath, 0o600);
}
export function spawnCpa(bin, configPath, managementKey) {
    let stderr = '';
    const child = spawn(bin, ['--config', configPath], {
        env: { ...process.env, MANAGEMENT_PASSWORD: managementKey },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.resume();
    child.stderr?.on('data', chunk => {
        stderr = `${stderr}${chunk}`.slice(-4000);
    });
    return {
        child,
        stderr: () => stderr,
    };
}
export async function waitForCpa(baseURL, apiKey, timeoutMs, handle) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    const exited = new Promise((_, reject) => {
        handle.child.once('error', reject);
        handle.child.once('exit', (code, signal) => {
            reject(new Error(`cli-proxy-api exited (${code ?? signal})\n${handle.stderr()}`));
        });
    });
    const ready = (async () => {
        while (Date.now() < deadline) {
            if (handle.child.exitCode !== null) {
                throw new Error(`cli-proxy-api exited (code ${handle.child.exitCode})\n${handle.stderr()}`);
            }
            try {
                return await fetchModels(baseURL, apiKey, Math.min(2000, deadline - Date.now()));
            }
            catch (error) {
                lastError = error;
            }
            await delay(250);
        }
        throw new Error(`cli-proxy-api not ready: ${errorMessage(lastError)}`);
    })();
    return Promise.race([ready, exited]);
}
export async function stopChild(handle) {
    if (!handle)
        return;
    const { child } = handle;
    if (child.exitCode !== null || child.signalCode !== null)
        return;
    const exited = new Promise(resolve => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const killer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
    }, 3000);
    try {
        await exited;
    }
    finally {
        clearTimeout(killer);
    }
}
function volatileValue(value, fallback) {
    // SAFETY: Config marks these Volatile values as scalar fields, so their snapshots preserve T.
    return value.get() ?? fallback;
}
/** Resolve the ordinary runtime options from the Host Config object. */
export function resolveOptionsFromConfig(config) {
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
    });
}
/**
 * Read the user-editable part of Config with the same fallbacks used by the
 * runtime. This keeps a profile reset equivalent to the old deployment
 * defaults and gives volatile-update consumers a complete settings snapshot.
 */
export function resolveCpaSettingsFromConfig(config, options) {
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
    };
}
export function resolveOptions(config = {}) {
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
        defaultContextWindow: positiveNumber(config.defaultContextWindow, DEFAULT_CONTEXT_WINDOW),
        defaultMaxTokens: positiveNumber(config.defaultMaxTokens, DEFAULT_MAX_TOKENS),
    };
}
