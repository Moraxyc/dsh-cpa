import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { CpaMode } from '../core/config.js'
import { isFunction, isJsonRecord, isNumber, isString } from '../core/json.js'
import type { JsonRecord, JsonValue } from '../core/json.js'
import type { ExecutionRecord, LocalUsageSummary } from '../core/services.js'
import { emptyCpaSummary } from './data.js'
import type { CpaSummary } from './data.js'
import { optionValue } from './quota.js'
import type { CpaQuotaStatus, OptionSource } from './quota.js'
import type { CpaModel, CpaRoutingStrategy } from '../core/config.js'
import type { CpaRouteOptions, CpaRoutePlan } from '../core/router.js'

export const STATUS_PATH = '/dsh-cpa/status'
export const SUMMARY_PATH = '/dsh-cpa/summary'
export const DIAGNOSTICS_PATH = '/dsh-cpa/diagnostics'
export const PREFLIGHT_PATH = '/dsh-cpa/preflight'
export const REPORT_PATH = '/dsh-cpa/report'
export const SETTINGS_PATH = '/dsh-cpa/settings'
export const PANEL_PATH = '/dsh-cpa/management'
export const EXECUTION_STATUS_PATH = '/dsh-cpa/execution-status'

const COOKIE_NAME = 'dsh_cpa_mgmt'
const PANEL_TIMEOUT_MS = 5_000
const PROXY_TIMEOUT_MS = 30_000
const HOP_BY_HOP_HEADERS = new Set<string>([
  'connection',
  'content-length',
  'content-encoding',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface CpaControllerState {
  mode: CpaMode
  active: boolean
  activeUrl: string
  internalRunning: boolean
  externalRunning: boolean
  managementAvailable: boolean
  external: {
    url: string
    apiKeySet: boolean
    managementKeySet: boolean
  }
  bin: string
  usageStatisticsEnabled: boolean
  routingStrategy: CpaRoutingStrategy
  dailyRequestLimit: number
  refreshIntervalMs: number
  port: number
  configPath: string
  settingsPath: string
  executionsPath: string
  authFilesTtlMs: number
  quotaTtlMs: number
  quotaConcurrency: number
  error: string
}

export interface CpaDiagnosticCheck {
  id: string
  status: 'pass' | 'warn' | 'fail' | 'unknown'
  detail: string
}

export interface CpaDiagnostics {
  available: boolean
  status: 'healthy' | 'warning' | 'unavailable'
  fetchedAt: string
  checks: CpaDiagnosticCheck[]
  models: CpaModel[]
  accounts: CpaQuotaStatus['accounts']
  quota: CpaQuotaStatus['quota']
  modelAccounts: Record<string, string[]>
  localUsage: LocalUsageSummary
  budget: {
    dailyRequestLimit: number
    requests: number
    exceeded: boolean
  }
  errors: string[]
}

export interface CpaReport {
  generatedAt: string
  diagnostics: CpaDiagnostics
  executions: ExecutionRecord[]
}

export interface ManagementExecutionStore {
  latest(sessionId: string | undefined): ExecutionRecord | undefined
  recent?(sessionId: string | undefined, limit?: number): ExecutionRecord[]
}

export interface ManagementPanelOptions {
  baseURL: OptionSource<string>
  managementKey: OptionSource<string>
  getState?: () => CpaControllerState
  update?: (patch: JsonRecord) => Promise<CpaControllerState>
  executionStore?: ManagementExecutionStore | (() => ManagementExecutionStore)
  quotaService?: { status(): Promise<CpaQuotaStatus> }
  dataService?: { summary(): Promise<CpaSummary> }
  diagnostics?: () => Promise<CpaDiagnostics>
  preflight?: (input: CpaRouteOptions) => Promise<CpaRoutePlan>
  report?: () => Promise<CpaReport>
}

/** Web carrier surface an injected scope exposes to the management routes. */
export interface ManagementWebScope {
  webServer: WebServer
  effect(task: () => () => void, label?: string): void
}

export interface ManagementContext {
  inject?: (
    deps: readonly string[],
    factory: (scope: ManagementWebScope) => void,
  ) => { dispose(): void } | undefined
  logger?: { warn?: (message: string | Error) => void }
}

interface StatusBody {
  available: boolean
  state?: CpaControllerState
}

interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

interface WebServer {
  register(route: WebRoute): () => void
}

export function cpaRoot(baseURL: string): string {
  return String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function managementCookieValue(managementKey: string): string {
  return createHash('sha256').update(`dsh-cpa:${managementKey}`).digest('hex')
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return undefined
}

function sendJson<T>(res: ServerResponse, status: number, value: T): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function panelScript(): string {
  return [
    '<script>',
    'try {',
    '  localStorage.removeItem("cli-proxy-auth")',
    '  localStorage.setItem("isLoggedIn", "true")',
    '  localStorage.setItem("apiBase", location.origin + "/dsh-cpa/management")',
    '  localStorage.setItem("managementKey", "dsh-cpa")',
    '} catch (_) {}',
    '</script>',
  ].join('\n')
}

export function injectPanelScript(html: string): string {
  const script = panelScript()
  const headEnd = html.indexOf('</head>')
  if (headEnd !== -1) return `${html.slice(0, headEnd)}${script}\n${html.slice(headEnd)}`
  const bodyEnd = html.indexOf('</body>')
  if (bodyEnd !== -1) return `${html.slice(0, bodyEnd)}${script}\n${html.slice(bodyEnd)}`
  return `${script}\n${html}`
}

function setManagementCookie(res: ServerResponse, managementKey: string): void {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${managementCookieValue(managementKey)}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=${PANEL_PATH}`,
    'Max-Age=604800',
  ].join('; '))
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function requestHeaders(req: IncomingMessage, managementKey: string) {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name) || name === 'authorization' || name === 'cookie') continue
    if (isString(value)) headers[name] = value
  }
  headers.authorization = `Bearer ${managementKey}`
  return headers
}

function responseHeaders(response: Response) {
  const headers: Record<string, string> = {}
  for (const [name, value] of response.headers) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'set-cookie') continue
    headers[lower] = value
  }
  return headers
}

async function servePanel(options: ManagementPanelOptions, res: ServerResponse): Promise<void> {
  const baseURL = optionValue(options.baseURL) ?? ''
  const managementKey = optionValue(options.managementKey)
  if (!managementKey) {
    sendJson(res, 503, { available: false })
    return
  }
  let response: Response
  try {
    response = await fetch(`${cpaRoot(baseURL)}/management.html`, {
      headers: { accept: 'text/html' },
      signal: AbortSignal.timeout(PANEL_TIMEOUT_MS),
    })
  } catch {
    sendJson(res, 502, { error: 'unavailable' })
    return
  }
  if (!response.ok) {
    sendJson(res, 502, { error: `HTTP ${response.status}` })
    return
  }
  const html = await response.text()
  setManagementCookie(res, managementKey)
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'SAMEORIGIN',
  })
  res.end(injectPanelScript(html))
}

async function proxyManagement(
  options: ManagementPanelOptions,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const baseURL = optionValue(options.baseURL) ?? ''
  const managementKey = optionValue(options.managementKey)
  if (!managementKey) {
    sendJson(res, 503, { available: false })
    return
  }
  if (cookieValue(req.headers.cookie, COOKIE_NAME) !== managementCookieValue(managementKey)) {
    sendJson(res, 403, { error: 'unauthorized' })
    return
  }

  const targetPath = url.pathname.slice(PANEL_PATH.length)
  if (targetPath === '/v0/management/api-call' || targetPath === '/v0/management/api-call/') {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  const target = `${cpaRoot(baseURL)}${targetPath}${url.search}`
  const body = await readRequestBody(req)
  const headers = requestHeaders(req, managementKey)
  const requestOptions: RequestInit = {
    method: req.method,
    headers,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  }
  if (body.length > 0) requestOptions.body = body
  let response: Response
  try {
    response = await fetch(target, requestOptions)
  } catch {
    sendJson(res, 502, { error: 'unavailable' })
    return
  }

  res.writeHead(response.status, responseHeaders(response))
  if (req.method === 'HEAD' || response.body === null) {
    res.end()
    return
  }
  const stream = Readable.fromWeb(response.body)
  stream.on('error', () => {
    res.destroy()
  })
  stream.pipe(res)
}

function statusHandler(options: ManagementPanelOptions) {
  return async (_req: IncomingMessage, res: ServerResponse) => {
    const managementKey = optionValue(options.managementKey)
    const body: StatusBody = {
      available: Boolean(managementKey),
    }
    if (options.getState !== undefined) body.state = options.getState()
    sendJson(res, 200, body)
  }
}

function executionStatusHandler(options: ManagementPanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const managementKey = optionValue(options.managementKey)
    if (!managementKey) {
      sendJson(res, 200, { available: false, accounts: [], quota: {}, execution: null })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    let quota: CpaQuotaStatus = { accounts: [], quota: {} }
    try {
      if (options.quotaService) {
        quota = await options.quotaService.status()
      }
    } catch {
      // Quota is best-effort; keep the execution readout available.
    }
    let execution: ExecutionRecord | null = null
    let executions: ExecutionRecord[] = []
    try {
      const executionStore = isFunction(options.executionStore)
        ? options.executionStore()
        : options.executionStore
      execution = executionStore?.latest(sessionId) ?? null
      executions = executionStore?.recent?.(sessionId) ?? (execution === null ? [] : [execution])
    } catch {
      execution = null
      executions = []
    }
    sendJson(res, 200, {
      available: true,
      accounts: quota.accounts,
      quota: quota.quota,
      execution,
      executions,
    })
  }
}

function summaryHandler(options: ManagementPanelOptions) {
  return async (_req: IncomingMessage, res: ServerResponse) => {
    if (!optionValue(options.managementKey)) {
      sendJson(res, 200, emptyCpaSummary({ available: false }))
      return
    }
    try {
      const summary = options.dataService
        ? await options.dataService.summary()
        : emptyCpaSummary({ available: true })
      sendJson(res, 200, summary)
    } catch (error) {
      sendJson(res, 200, emptyCpaSummary({
        available: true,
        errors: [{
          source: 'summary',
          message: error instanceof Error ? error.message : String(error),
        }],
      }))
    }
  }
}

function emptyDiagnostics(): CpaDiagnostics {
  return {
    available: false,
    status: 'unavailable',
    fetchedAt: new Date().toISOString(),
    checks: [],
    models: [],
    accounts: [],
    quota: {},
    modelAccounts: {},
    localUsage: {
      since: new Date(0).toISOString(),
      fetchedAt: new Date().toISOString(),
      retainedRecords: 0,
      totals: {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        successRate: 0,
      },
      models: [],
    },
    budget: {
      dailyRequestLimit: 0,
      requests: 0,
      exceeded: false,
    },
    errors: [],
  }
}

function diagnosticsHandler(options: ManagementPanelOptions) {
  return async (_req: IncomingMessage, res: ServerResponse) => {
    if (!options.diagnostics) {
      sendJson(res, 200, emptyDiagnostics())
      return
    }
    try {
      sendJson(res, 200, await options.diagnostics())
    } catch (error) {
      const body = emptyDiagnostics()
      body.available = true
      body.status = 'warning'
      body.errors = [error instanceof Error ? error.message : String(error)]
      sendJson(res, 200, body)
    }
  }
}

function preflightHandler(options: ManagementPanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    if (!options.preflight) {
      sendJson(res, 503, { error: 'unavailable' })
      return
    }
    let body: Buffer
    try {
      body = await readRequestBody(req)
    } catch {
      sendJson(res, 400, { error: 'invalid body' })
      return
    }
    let value: JsonValue
    try {
      value = body.length === 0 ? {} : JSON.parse(body.toString())
    } catch {
      sendJson(res, 400, { error: 'invalid JSON' })
      return
    }
    if (!isJsonRecord(value) || !isString(value.model) || value.model.trim() === '') {
      sendJson(res, 400, { error: 'model required' })
      return
    }
    const input: CpaRouteOptions = {
      model: value.model.trim(),
      messages: [],
    }
    if (isNumber(value.inputTokens) && value.inputTokens >= 0) input.inputTokens = value.inputTokens
    if (isNumber(value.maxTokens) && value.maxTokens > 0) input.maxTokens = value.maxTokens
    if (isString(value.reasoningEffort) && value.reasoningEffort.trim() !== '') {
      input.reasoningEffort = value.reasoningEffort.trim()
    }
    try {
      sendJson(res, 200, await options.preflight(input))
    } catch {
      sendJson(res, 503, { error: 'preflight unavailable' })
    }
  }
}

function reportHandler(options: ManagementPanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    if (!options.report) {
      sendJson(res, 503, { error: 'unavailable' })
      return
    }
    try {
      sendJson(res, 200, await options.report())
    } catch {
      sendJson(res, 503, { error: 'report unavailable' })
    }
  }
}

function settingsHandler(options: ManagementPanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      sendJson(res, 200, options.getState ? options.getState() : { available: false })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    let body: Buffer
    try {
      body = await readRequestBody(req)
    } catch {
      sendJson(res, 400, { error: 'invalid body' })
      return
    }
    let patch: JsonValue
    try {
      patch = body.length === 0 ? {} : JSON.parse(body.toString())
    } catch {
      sendJson(res, 400, { error: 'invalid JSON' })
      return
    }
    if (!isJsonRecord(patch)) {
      sendJson(res, 400, { error: 'invalid body' })
      return
    }
    if (!options.update) {
      sendJson(res, 503, { error: 'unavailable' })
      return
    }
    try {
      sendJson(res, 200, await options.update(patch))
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

function panelHandler(options: ManagementPanelOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === PANEL_PATH) {
      await servePanel(options, res)
      return
    }
    if (url.pathname === `${PANEL_PATH}/`) {
      res.writeHead(302, { location: PANEL_PATH })
      res.end()
      return
    }
    await proxyManagement(options, url, req, res)
  }
}

function managementRoutes(options: ManagementPanelOptions): WebRoute[] {
  return [
    { kind: 'exact', path: STATUS_PATH, handler: statusHandler(options) },
    { kind: 'exact', path: EXECUTION_STATUS_PATH, handler: executionStatusHandler(options) },
    { kind: 'exact', path: SUMMARY_PATH, handler: summaryHandler(options) },
    { kind: 'exact', path: DIAGNOSTICS_PATH, handler: diagnosticsHandler(options) },
    { kind: 'exact', path: PREFLIGHT_PATH, handler: preflightHandler(options) },
    { kind: 'exact', path: REPORT_PATH, handler: reportHandler(options) },
    { kind: 'exact', path: SETTINGS_PATH, handler: settingsHandler(options) },
    { kind: 'prefix', path: PANEL_PATH, handler: panelHandler(options) },
  ]
}

/**
 * Serve the management routes on the Web carrier that currently holds them.
 * The injected fiber owns the routes: its callback runs when `webServer`
 * arrives and again on every replacement, so the routes always belong to the
 * server that is listening instead of a carrier instance captured once.
 * @param ctx - context that owns the injected fiber.
 * @param options - management panel dependencies.
 * @returns disposer releasing the injected fiber, settling once the routes are gone.
 */
export function installManagementPanel(
  ctx: ManagementContext,
  options: ManagementPanelOptions,
): () => Promise<void> {
  if (ctx.inject === undefined) {
    ctx.logger?.warn?.('dsh-cpa: context has no service injection; management routes are not registered')
    return async () => {}
  }
  const fiber = ctx.inject(['webServer'], scope => {
    for (const route of managementRoutes(options)) {
      scope.effect(() => scope.webServer.register(route), `dsh-cpa: ${route.path}`)
    }
  })
  return async () => {
    await fiber?.dispose()
  }
}
