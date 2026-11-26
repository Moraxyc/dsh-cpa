import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, sep } from 'node:path'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  ConfigScalar,
  CpaInputModality,
  CpaModel,
  CpaReasoning,
  CpaReasoningEffort,
} from '../core/config.js'
import { isError, isJsonRecord, isNonEmptyString, isNumber, isString } from '../core/json.js'
import type { JsonRecord, JsonValue } from '../core/json.js'

export interface ModelCatalogEntry {
  id?: ConfigScalar
  slug?: ConfigScalar
  display_name?: ConfigScalar
  context_length?: ConfigScalar
  context_window?: ConfigScalar
  max_context_window?: ConfigScalar
  max_completion_tokens?: ConfigScalar
  supported_reasoning_levels?: unknown
  default_reasoning_level?: ConfigScalar
}

export interface ReasoningLevelInput {
  effort?: ConfigScalar
  description?: ConfigScalar
}

export interface ManagedConfigInput {
  host: string
  port: number
  apiKey: string
  managementKey: string
  usageStatisticsEnabled?: boolean
}

export interface ChildHandle {
  child: ChildProcess
  stderr: () => string
}

const REASONING_LEVEL_NAMES = new Map<string, string>([
  ['none', 'None'],
  ['auto', 'Auto'],
  ['minimal', 'Minimal'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'XHigh'],
  ['max', 'Max'],
  ['ultra', 'Ultra'],
])

const MAX_MODEL_CATALOG_BYTES = 4 * 1024 * 1024

function errorMessage(cause: unknown): string {
  return isError(cause) ? cause.message : String(cause)
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function randomKey(prefix: string): string {
  return `${prefix}-${randomBytes(24).toString('hex')}`
}

export function modelsUrl(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
}

function normalizeInputModalities(value: JsonValue | undefined): CpaInputModality[] | undefined {
  if (!Array.isArray(value)) return undefined
  const modalities = new Set<CpaInputModality>()
  for (const raw of value) {
    const modality = isString(raw) ? raw.trim().toLowerCase() : ''
    if (modality === 'text' || modality === 'image') modalities.add(modality)
  }
  return modalities.size > 0 ? [...modalities] : undefined
}

function reasoningLevelName(effort: string): string {
  return REASONING_LEVEL_NAMES.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}

function normalizeReasoning(entry: JsonRecord): CpaReasoning | undefined {
  const supported = entry.supported_reasoning_levels
  if (!Array.isArray(supported)) return undefined
  const levels = supported.filter((value): value is JsonRecord => isJsonRecord(value))
  const seen = new Set<string>()
  const efforts: CpaReasoningEffort[] = []
  for (const item of levels) {
    const id = isString(item.effort) ? item.effort.trim().toLowerCase() : ''
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    const effort: CpaReasoningEffort = { id, name: reasoningLevelName(id) }
    if (isString(item.description) && item.description.length > 0) {
      effort.description = item.description
    }
    efforts.push(effort)
  }
  if (efforts.length === 0) return undefined
  const defaultEffort = isString(entry.default_reasoning_level)
    ? entry.default_reasoning_level.trim().toLowerCase()
    : ''
  const reasoning: CpaReasoning = { efforts }
  if (defaultEffort.length > 0 && seen.has(defaultEffort)) {
    reasoning.defaultEffort = defaultEffort
  }
  return reasoning
}

function sortModels(models: CpaModel[]): CpaModel[] {
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

function positiveIntegerField(...values: (JsonValue | undefined)[]): number | undefined {
  return values.find((value): value is number => isNumber(value) && Number.isInteger(value) && value > 0)
}

export function normalizeModels(data: readonly JsonValue[]): CpaModel[] {
  const models: CpaModel[] = []
  const seen = new Set<string>()
  for (const entry of data) {
    if (!isJsonRecord(entry)) continue
    if (entry.visibility === 'hide') continue
    const id = isNonEmptyString(entry.id)
      ? entry.id
      : isNonEmptyString(entry.slug)
        ? entry.slug
        : undefined
    if (!isNonEmptyString(id) || seen.has(id)) continue
    seen.add(id)
    const model: CpaModel = { id }
    const displayName = isNonEmptyString(entry.display_name)
      ? entry.display_name
      : isNonEmptyString(entry.name) ? entry.name : undefined
    if (displayName !== undefined) model.displayName = displayName
    const contextLength = entry.context_length ?? entry.context_window ?? entry.max_context_window
    if (isNumber(contextLength) && Number.isInteger(contextLength) && contextLength > 0) {
      model.contextLength = contextLength
    }
    const maxCompletionTokens = positiveIntegerField(
      entry.max_completion_tokens,
      entry.max_output_tokens,
      entry.max_tokens,
    )
    if (maxCompletionTokens !== undefined) model.maxCompletionTokens = maxCompletionTokens
    const reasoning = normalizeReasoning(entry)
    if (reasoning !== undefined) model.reasoning = reasoning
    const inputModalities = normalizeInputModalities(
      entry.input_modalities ?? entry.supported_input_modalities ?? entry.supportedInputModalities,
    )
    if (inputModalities !== undefined) model.inputModalities = inputModalities
    models.push(model)
  }
  return sortModels(models)
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<JsonValue> {
  const tooLarge = () => new Error(`response exceeds ${maxBytes} bytes`)
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel()
    throw tooLarge()
  }
  if (!response.body) return JSON.parse(await response.text())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > maxBytes) throw tooLarge()
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function fetchModels(
  baseURL: string,
  apiKey: string,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<CpaModel[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('model sync timed out'))
  }, timeoutMs)
  const forwardAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) forwardAbort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    const headers = new Headers(attributionHeaders())
    headers.set('accept', 'application/json')
    if (apiKey) headers.set('authorization', `Bearer ${apiKey}`)
    const url = new URL(modelsUrl(baseURL))
    url.searchParams.set('client_version', 'dsh-cpa')
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      const hint = response.status === 401 || response.status === 403
        ? '; check the CPA API key'
        : ''
      throw new Error(`models returned ${response.status}${hint}`)
    }
    const body = await readBoundedJson(response, MAX_MODEL_CATALOG_BYTES)
    const record = isJsonRecord(body) ? body : null
    const entries = Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
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
    signal?.removeEventListener('abort', forwardAbort)
  }
}

export function buildManagedConfig({ host, port, apiKey, managementKey, usageStatisticsEnabled = true }: ManagedConfigInput): string {
  return [
    '# Managed by dsh-cpa. Overwritten on managed start.',
    'config-version: 8',
    'server:',
    `  host: ${JSON.stringify(host)}`,
    `  port: ${port}`,
    'management:',
    '  allow-remote: false',
    `  secret-key: ${JSON.stringify(managementKey)}`,
    'access:',
    '  api-keys:',
    `    - ${JSON.stringify(apiKey)}`,
    'oauth:',
    '  auth-dir: "~/.cli-proxy-api"',
    'requests:',
    '  passthrough-headers: true',
    'observability:',
    '  logs:',
    '    debug: false',
    '  usage:',
    `    usage-statistics-enabled: ${usageStatisticsEnabled ? 'true' : 'false'}`,
    '',
  ].join('\n')
}

function executableNames(bin: string): string[] {
  if (process.platform !== 'win32') return [bin]
  if (/\.(exe|cmd|bat)$/i.test(bin)) return [bin]
  return [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`]
}

function executableCandidates(bin: string): string[] {
  if (isAbsolute(bin) || bin.includes(sep) || bin.includes('/')) {
    return executableNames(bin)
  }
  return (process.env.PATH || '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)
    .flatMap(dir => executableNames(bin).map(name => join(dir, name)))
}

export async function resolveCpaBinary(bin: string): Promise<string | undefined> {
  if (!bin) return undefined
  for (const candidate of executableCandidates(bin)) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
    }
  }
  return undefined
}

export async function assertCpaBinary(bin: string): Promise<string> {
  const resolved = await resolveCpaBinary(bin)
  if (!resolved) {
    const looksLikePath = isAbsolute(bin) || bin.includes('/') || bin.includes('\\')
    throw new Error(looksLikePath
      ? `CPA binary not found: ${bin}`
      : `CPA binary not found in PATH: ${bin}`)
  }
  return resolved
}

export async function writeManagedConfig(configPath: string, config: ManagedConfigInput): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, buildManagedConfig(config), { mode: 0o600 })
  await chmod(configPath, 0o600)
}

export function spawnCpa(bin: string, configPath: string, managementKey: string): ChildHandle {
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

export async function waitForCpa(baseURL: string, apiKey: string, timeoutMs: number, handle: ChildHandle): Promise<CpaModel[]> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  const exited = new Promise<never>((_, reject) => {
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
    throw new Error(`cli-proxy-api not ready: ${errorMessage(lastError)}`)
  })()
  return Promise.race([ready, exited])
}

export async function stopChild(handle: ChildHandle | undefined): Promise<void> {
  if (!handle) return
  const { child } = handle
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
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
