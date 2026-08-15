import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8317
export const DEFAULT_BIN = 'cli-proxy-api'
export const DEFAULT_REFRESH_MS = 300_000
export const DEFAULT_START_TIMEOUT_MS = 30_000
export const DEFAULT_CONTEXT_WINDOW = 262_144
export const DEFAULT_MAX_TOKENS = 32_768

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function randomKey(prefix) {
  return `${prefix}-${randomBytes(24).toString('hex')}`
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

export function normalizeModels(data) {
  return data
    .map(entry => {
      if (entry === null || typeof entry !== 'object') return undefined
      const id = entry.id
      if (typeof id !== 'string' || id.length === 0) return undefined
      const model = { id }
      if (typeof entry.display_name === 'string' && entry.display_name.length > 0) {
        model.displayName = entry.display_name
      }
      if (typeof entry.description === 'string' && entry.description.length > 0) {
        model.description = entry.description
      }
      if (typeof entry.context_length === 'number' && Number.isInteger(entry.context_length) && entry.context_length > 0) {
        model.contextLength = entry.context_length
      }
      if (typeof entry.max_completion_tokens === 'number' && Number.isInteger(entry.max_completion_tokens) && entry.max_completion_tokens > 0) {
        model.maxCompletionTokens = entry.max_completion_tokens
      }
      return model
    })
    .filter(Boolean)
}

export async function fetchModels(baseURL, apiKey, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`model sync timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  try {
    const headers = { accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const response = await fetch(modelsUrl(baseURL), {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`GET ${modelsUrl(baseURL)} returned ${response.status}`)
    }
    const body = await response.json()
    if (!Array.isArray(body?.data) || body.data.length === 0) {
      throw new Error(`GET ${modelsUrl(baseURL)} returned no models`)
    }
    const models = normalizeModels(body.data)
    if (models.length === 0) {
      throw new Error(`GET ${modelsUrl(baseURL)} returned no usable model ids`)
    }
    return models
  } finally {
    clearTimeout(timer)
  }
}

export function buildManagedConfig({ host, port, apiKey, managementKey }) {
  return [
    '# Managed by dsh-cpa. This file is overwritten on the next managed start.',
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
        `cli-proxy-api exited before becoming ready (${code ?? signal})\n${handle.stderr()}`,
      ))
    })
  })
  const ready = (async () => {
    while (Date.now() < deadline) {
      if (handle.child.exitCode !== null) {
        throw new Error(
          `cli-proxy-api exited before becoming ready (code ${handle.child.exitCode})\n${handle.stderr()}`,
        )
      }
      try {
        return await fetchModels(baseURL, apiKey, Math.min(2000, deadline - Date.now()))
      } catch (error) {
        lastError = error
      }
      await delay(250)
    }
    throw new Error(`cli-proxy-api did not become ready at ${baseURL}: ${lastError?.message}`)
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
