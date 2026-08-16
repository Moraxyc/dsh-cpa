import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function simpleProjectionSchema() {
  return {
    parse(value) {
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        throw new TypeError('cpaUsage projection must be an object or null')
      }
      return value
    },
  }
}

function nonNegativeNumber(value) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function tokenCount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function emptyCpaSessionStats() {
  return {
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    byAccount: {},
  }
}

export function aggregateCpaSessionStats(state, record) {
  const base = state && typeof state === 'object' && !Array.isArray(state)
    ? state
    : emptyCpaSessionStats()
  const authIndex = typeof record?.authIndex === 'string' ? record.authIndex : ''
  const previous = base.byAccount?.[authIndex] ?? {
    authIndex,
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
  const failed = record?.outcome === 'failure' ? 1 : 0
  const baseRequests = typeof base.requests === 'number' ? base.requests : 0
  const baseFailed = typeof base.failed === 'number' ? base.failed : 0
  const previousFailed = typeof previous.failed === 'number' ? previous.failed : 0
  const inputTokens = tokenCount(record?.inputTokens)
  const outputTokens = tokenCount(record?.outputTokens)
  const nextAccount = {
    authIndex,
    requests: (typeof previous.requests === 'number' ? previous.requests : 0) + 1,
    failed: previousFailed + failed,
    inputTokens: previous.inputTokens + inputTokens,
    outputTokens: previous.outputTokens + outputTokens,
  }
  return {
    requests: baseRequests + 1,
    failed: baseFailed + failed,
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
    byAccount: {
      ...(base.byAccount || {}),
      [authIndex]: nextAccount,
    },
  }
}

export function aggregateCpaUsage(state, value) {
  const record = sanitizeExecutionRecord(value)
  if (record === undefined) return state
  return {
    ...record,
    ...aggregateCpaSessionStats(state, record),
    latest: record,
  }
}

export function sanitizeExecutionRecord(value) {
  if (value === null || typeof value !== 'object') return undefined
  const authIndex = typeof value.authIndex === 'string' && value.authIndex.length > 0
    ? value.authIndex
    : ''
  const sessionId = typeof value.sessionId === 'string' && value.sessionId.length > 0
    ? value.sessionId
    : ''
  const inputTokens = nonNegativeNumber(value.inputTokens)
  const outputTokens = nonNegativeNumber(value.outputTokens)
  if (authIndex === '' && sessionId === '') return undefined
  return {
    ...authIndex === '' ? {} : { authIndex },
    ...sessionId === '' ? {} : { sessionId },
    provider: typeof value.provider === 'string' ? value.provider : '',
    model: typeof value.model === 'string' ? value.model : '',
    purpose: typeof value.purpose === 'string' ? value.purpose : '',
    outcome: value.outcome === 'success' || value.outcome === 'failure' ? value.outcome : '',
    traceId: typeof value.traceId === 'string' ? value.traceId : '',
    requestId: typeof value.requestId === 'string' ? value.requestId : '',
    time: Number.isFinite(Number(value.time)) ? Number(value.time) : Date.now(),
    ...inputTokens === undefined ? {} : { inputTokens },
    ...outputTokens === undefined ? {} : { outputTokens },
  }
}

export class CpaExecutionStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath
    this.maxEntries = options.maxEntries ?? 200
    this.bySession = new Map()
    this.byId = new Map()
    this.loaded = false
  }

  async ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const entry of parsed) {
        const record = sanitizeExecutionRecord(entry)
        if (record === undefined) continue
        this.ingest(record)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        // A malformed host state file should not break agent execution.
      }
    }
  }

  ingest(record) {
    const id = record.traceId || `${record.sessionId}-${record.time}`
    const previous = this.byId.get(id)
    if (previous !== undefined) {
      this.bySession.delete(previous.sessionId)
    }
    this.byId.set(id, record)
    if (record.sessionId !== '') {
      this.bySession.set(record.sessionId, record)
    }
    this.trim()
  }

  trim() {
    if (this.byId.size <= this.maxEntries) return
    const sorted = [...this.byId.values()].sort((left, right) => right.time - left.time)
    for (const record of sorted.slice(this.maxEntries)) {
      this.byId.delete(record.traceId || `${record.sessionId}-${record.time}`)
      if (this.bySession.get(record.sessionId) === record) this.bySession.delete(record.sessionId)
    }
  }

  latest(sessionId) {
    if (sessionId === undefined) return undefined
    return this.bySession.get(sessionId)
  }

  async append(value) {
    const record = sanitizeExecutionRecord(value)
    if (record === undefined) return undefined
    this.ingest(record)
    await this.persist()
    return record
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true })
    const sorted = [...this.byId.values()].sort((left, right) => left.time - right.time)
    const tmpPath = `${this.filePath}.tmp`
    await writeFile(tmpPath, `${JSON.stringify(sorted, null, 2)}\n`, { mode: 0o600 })
    await chmod(tmpPath, 0o600)
    await rename(tmpPath, this.filePath)
  }
}
