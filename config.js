import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8317
export const DEFAULT_BIN = 'cli-proxy-api'
export const DEFAULT_REFRESH_MS = 300_000
export const DEFAULT_START_TIMEOUT_MS = 30_000
export const DEFAULT_CONTEXT_WINDOW = 262_144
export const DEFAULT_MAX_TOKENS = 32_768

const REASONING_LEVEL_NAMES = {
  none: 'None',
  auto: 'Auto',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra',
}

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function randomKey(prefix) {
  return `${prefix}-${randomBytes(24).toString('hex')}`
}

export function sanitizeCpaSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    mode: source.mode === 'external' || source.mode === 'off' ? source.mode : 'internal',
    externalUrl: typeof source.externalUrl === 'string' ? source.externalUrl.trim() : '',
    externalApiKey: typeof source.externalApiKey === 'string' ? source.externalApiKey : '',
    externalManagementKey: typeof source.externalManagementKey === 'string' ? source.externalManagementKey : '',
    internalBin: typeof source.internalBin === 'string' ? source.internalBin.trim() : '',
  }
}

export async function readCpaSettings(settingsPath) {
  let raw
  try {
    raw = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
  const parsed = JSON.parse(raw)
  return sanitizeCpaSettings(parsed)
}

export async function writeCpaSettings(settingsPath, settings) {
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
  await chmod(settingsPath, 0o600)
}

export function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function yamlString(value) {
  return JSON.stringify(value)
}

export function modelsUrl(baseURL) {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
}

export function chatCompletionsUrl(baseURL) {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`
}

function reasoningLevelName(effort) {
  return REASONING_LEVEL_NAMES[effort] ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

function normalizeReasoning(entry) {
  if (!Array.isArray(entry?.supported_reasoning_levels)) return undefined
  const seen = new Set()
  const efforts = []
  for (const item of entry.supported_reasoning_levels) {
    if (item === null || typeof item !== 'object') continue
    const id = typeof item.effort === 'string' ? item.effort.trim().toLowerCase() : ''
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    efforts.push({
      id,
      name: reasoningLevelName(id),
      ...typeof item.description === 'string' && item.description.length > 0
        ? { description: item.description }
        : {},
    })
  }
  if (efforts.length === 0) return undefined
  const defaultEffort = typeof entry.default_reasoning_level === 'string'
    ? entry.default_reasoning_level.trim().toLowerCase()
    : ''
  return {
    efforts,
    ...defaultEffort.length > 0 && seen.has(defaultEffort) ? { defaultEffort } : {},
  }
}

function sortModels(models) {
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

export function normalizeModels(data) {
  const models = data
    .map(entry => {
      if (entry === null || typeof entry !== 'object') return undefined
      const id = typeof entry.id === 'string' && entry.id.length > 0
        ? entry.id
        : typeof entry.slug === 'string' && entry.slug.length > 0
          ? entry.slug
          : undefined
      if (typeof id !== 'string' || id.length === 0) return undefined
      const model = { id }
      if (typeof entry.display_name === 'string' && entry.display_name.length > 0) {
        model.displayName = entry.display_name
      }
      const contextLength = entry.context_length ?? entry.context_window ?? entry.max_context_window
      if (typeof contextLength === 'number' && Number.isInteger(contextLength) && contextLength > 0) {
        model.contextLength = contextLength
      }
      if (typeof entry.max_completion_tokens === 'number' && Number.isInteger(entry.max_completion_tokens) && entry.max_completion_tokens > 0) {
        model.maxCompletionTokens = entry.max_completion_tokens
      }
      const reasoning = normalizeReasoning(entry)
      if (reasoning !== undefined) model.reasoning = reasoning
      return model
    })
    .filter(Boolean)
  return sortModels(models)
}

export async function fetchModels(baseURL, apiKey, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('model sync timed out'))
  }, timeoutMs)
  try {
    const headers = { accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const url = new URL(modelsUrl(baseURL))
    url.searchParams.set('client_version', 'dsh-cpa')
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`models returned ${response.status}`)
    }
    const body = await response.json()
    const entries = Array.isArray(body?.data)
      ? body.data
      : Array.isArray(body?.models)
        ? body.models
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

export function buildManagedConfig({ host, port, apiKey, managementKey }) {
  return [
    '# Managed by dsh-cpa. Overwritten on managed start.',
    `host: ${yamlString(host)}`,
    `port: ${port}`,
    'remote-management:',
    '  allow-remote: false',
    `  secret-key: ${yamlString(managementKey)}`,
    'auth-dir: "~/.cli-proxy-api"',
    'api-keys:',
    `  - ${yamlString(apiKey)}`,
    'debug: false',
    'usage-statistics-enabled: false',
    '',
  ].join('\n')
}

function executableNames(bin) {
  if (process.platform !== 'win32') return [bin]
  if (/\.(exe|cmd|bat)$/i.test(bin)) return [bin]
  return [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`]
}

function executableCandidates(bin) {
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) {
    return executableNames(bin)
  }
  return (process.env.PATH || '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)
    .flatMap(dir => executableNames(bin).map(name => join(dir, name)))
}

export async function resolveCpaBinary(bin) {
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

export async function assertCpaBinary(bin) {
  const resolved = await resolveCpaBinary(bin)
  if (!resolved) {
    const looksLikePath = isAbsolute(bin) || bin.includes('/') || bin.includes('\\')
    throw new Error(looksLikePath
      ? `CPA binary not found: ${bin}`
      : `CPA binary not found in PATH: ${bin}`)
  }
  return resolved
}

export async function writeManagedConfig(configPath, config) {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, buildManagedConfig(config), { mode: 0o600 })
  await chmod(configPath, 0o600)
}

export function spawnCpa(bin, configPath, managementKey) {
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

export async function waitForCpa(baseURL, apiKey, timeoutMs, handle) {
  const deadline = Date.now() + timeoutMs
  let lastError
  const exited = new Promise((_, reject) => {
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
    throw new Error(`cli-proxy-api not ready: ${lastError?.message}`)
  })()
  return Promise.race([ready, exited])
}

export async function stopChild(handle) {
  if (!handle) return
  const { child } = handle
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
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

export function resolveOptions(config = {}) {
  const env = process.env
  return {
    provider: config.provider || 'cpa',
    url: config.url || env.CPA_URL || '',
    apiKeyEnv: config.apiKeyEnv || 'CPA_API_KEY',
    managementKey: config.managementKey || env.CPA_MANAGEMENT_KEY || '',
    bin: config.bin || env.CPA_BIN || DEFAULT_BIN,
    configPath: config.configPath || env.CPA_CONFIG || join(dshHome(), 'cpa', 'config.yaml'),
    settingsPath: config.settingsPath || env.CPA_SETTINGS || join(dshHome(), 'cpa', 'settings.json'),
    host: config.host || DEFAULT_HOST,
    port: Number(config.port ?? DEFAULT_PORT),
    refreshIntervalMs: positiveNumber(
      config.refreshIntervalMs ?? env.CPA_REFRESH_INTERVAL_MS,
      DEFAULT_REFRESH_MS,
    ),
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
