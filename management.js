import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

export const STATUS_PATH = '/dsh-cpa/status'
export const SETTINGS_PATH = '/dsh-cpa/settings'
export const PANEL_PATH = '/dsh-cpa/management'
export const EXECUTION_STATUS_PATH = '/dsh-cpa/execution-status'

const COOKIE_NAME = 'dsh_cpa_mgmt'
const PANEL_TIMEOUT_MS = 5_000
const PROXY_TIMEOUT_MS = 30_000
const HOP_BY_HOP_HEADERS = new Set([
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

export function cpaRoot(baseURL) {
  return String(baseURL).replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function managementCookieValue(managementKey) {
  return createHash('sha256').update(`dsh-cpa:${managementKey}`).digest('hex')
}

function cookieValue(header, name) {
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

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function panelScript() {
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

export function injectPanelScript(html) {
  const script = panelScript()
  const headEnd = html.indexOf('</head>')
  if (headEnd !== -1) return `${html.slice(0, headEnd)}${script}\n${html.slice(headEnd)}`
  const bodyEnd = html.indexOf('</body>')
  if (bodyEnd !== -1) return `${html.slice(0, bodyEnd)}${script}\n${html.slice(bodyEnd)}`
  return `${script}\n${html}`
}

function setManagementCookie(res, managementKey) {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${managementCookieValue(managementKey)}`,
    'HttpOnly',
    'SameSite=Strict',
    `Path=${PANEL_PATH}`,
    'Max-Age=604800',
  ].join('; '))
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

function requestHeaders(req, managementKey) {
  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name) || name === 'authorization' || name === 'cookie') continue
    headers[name] = value
  }
  headers.authorization = `Bearer ${managementKey}`
  return headers
}

function responseHeaders(response) {
  const headers = {}
  for (const [name, value] of response.headers) {
    const lower = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'set-cookie') continue
    headers[lower] = value
  }
  return headers
}

function optionValue(options, key) {
  return typeof options[key] === 'function' ? options[key]() : options[key]
}

async function servePanel(options, res) {
  const baseURL = optionValue(options, 'baseURL')
  const managementKey = optionValue(options, 'managementKey')
  if (!managementKey) {
    sendJson(res, 503, { available: false })
    return
  }
  let response
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

async function proxyManagement(options, url, req, res) {
  const baseURL = optionValue(options, 'baseURL')
  const managementKey = optionValue(options, 'managementKey')
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
  let response
  try {
    response = await fetch(target, {
      method: req.method,
      headers,
      ...body.length === 0 ? {} : { body },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
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
  stream.on('error', () => { res.destroy() })
  stream.pipe(res)
}

function statusHandler(options) {
  return async (_req, res) => {
    const managementKey = optionValue(options, 'managementKey')
    sendJson(res, 200, {
      available: Boolean(managementKey),
      ...options.getState ? { state: options.getState() } : {},
    })
  }
}

function executionStatusHandler(options) {
  return async (req, res) => {
    const managementKey = optionValue(options, 'managementKey')
    if (!managementKey) {
      sendJson(res, 200, { available: false, accounts: [], quota: {}, execution: null })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    let quota = { accounts: [], quota: {} }
    try {
      if (options.quotaService) {
        quota = await options.quotaService.status()
      }
    } catch {
      // Quota is best-effort; keep the execution readout available.
    }
    let execution
    try {
      const executionStore = typeof options.executionStore === 'function'
        ? options.executionStore()
        : options.executionStore
      execution = executionStore?.latest(sessionId) ?? null
    } catch {
      execution = null
    }
    sendJson(res, 200, {
      available: true,
      accounts: quota.accounts,
      quota: quota.quota,
      execution: execution ?? null,
    })
  }
}

function settingsHandler(options) {
  return async (req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, options.getState ? options.getState() : { available: false })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    let patch
    let body
    try {
      body = await readRequestBody(req)
    } catch {
      sendJson(res, 400, { error: 'invalid body' })
      return
    }
    try {
      patch = body.length === 0 ? {} : JSON.parse(body.toString())
    } catch {
      sendJson(res, 400, { error: 'invalid JSON' })
      return
    }
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
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
      sendJson(res, 400, { error: error?.message || String(error) })
    }
  }
}

function panelHandler(options) {
  return async (req, res) => {
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

export function installManagementPanelWhenReady(ctx, options) {
  const disposers = []
  let timer
  let installed = false

  const register = () => {
    if (installed) return
    const server = ctx.get('webServer')
    if (server === undefined) return
    installed = true
    disposers.push(server.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: statusHandler(options),
    }))
    disposers.push(server.register({
      kind: 'exact',
      path: EXECUTION_STATUS_PATH,
      handler: executionStatusHandler(options),
    }))
    disposers.push(server.register({
      kind: 'exact',
      path: SETTINGS_PATH,
      handler: settingsHandler(options),
    }))
    disposers.push(server.register({
      kind: 'prefix',
      path: PANEL_PATH,
      handler: panelHandler(options),
    }))
    if (timer !== undefined) clearInterval(timer)
  }

  try {
    register()
  } catch (error) {
    ctx.logger?.warn?.(error)
  }
  if (!installed) {
    timer = setInterval(() => {
      try {
        register()
      } catch (error) {
        ctx.logger?.warn?.(error)
        if (timer !== undefined) clearInterval(timer)
      }
    }, 250)
    timer.unref?.()
    disposers.push(() => { if (timer !== undefined) clearInterval(timer) })
  }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose?.()
  }
}
