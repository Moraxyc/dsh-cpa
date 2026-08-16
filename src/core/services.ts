import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConfigScalar } from './config.js'
import { isJsonRecord, isNonEmptyString, isNumber, isString } from './json.js'

export interface ExecutionInput {
  authIndex?: ConfigScalar
  sessionId?: ConfigScalar
  provider?: ConfigScalar
  model?: ConfigScalar
  purpose?: ConfigScalar
  outcome?: ConfigScalar
  traceId?: ConfigScalar
  requestId?: ConfigScalar
  time?: ConfigScalar
  inputTokens?: ConfigScalar
  outputTokens?: ConfigScalar
}

export interface ExecutionRecord {
  authIndex?: string
  sessionId?: string
  provider: string
  model: string
  purpose: string
  outcome: string
  traceId: string
  requestId: string
  time: number
  inputTokens?: number
  outputTokens?: number
}

export interface AccountStats {
  authIndex: string
  requests: number
  failed: number
  inputTokens: number
  outputTokens: number
}

export interface CpaSessionStats {
  requests: number
  failed: number
  inputTokens: number
  outputTokens: number
  byAccount: Record<string, AccountStats>
}

export interface CpaUsageProjection extends CpaSessionStats {
  latest: ExecutionRecord
}

export interface ProjectionSchema<T> {
  parse(value: T): T
}

export interface ExecutionStoreOptions {
  maxEntries?: number
}

export function simpleProjectionSchema<T>(): ProjectionSchema<T> {
  return {
    parse(value: T): T {
      if (value !== null && !isJsonRecord(value)) {
        throw new TypeError('cpaUsage projection must be an object or null')
      }
      return value
    },
  }
}

function nonNegativeNumber(value: ConfigScalar): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function tokenCount(value: ConfigScalar): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function emptyCpaSessionStats(): CpaSessionStats {
  return {
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    byAccount: {},
  }
}

export function aggregateCpaSessionStats(
  state: CpaSessionStats | null | undefined,
  record: ExecutionInput | null | undefined,
): CpaSessionStats {
  const base = isJsonRecord(state) ? state : emptyCpaSessionStats()
  const authIndex = isString(record?.authIndex) ? record.authIndex : ''
  const previous = base.byAccount?.[authIndex] ?? {
    authIndex,
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
  }
  const failed = record?.outcome === 'failure' ? 1 : 0
  const baseRequests = isNumber(base.requests) ? base.requests : 0
  const baseFailed = isNumber(base.failed) ? base.failed : 0
  const previousFailed = isNumber(previous.failed) ? previous.failed : 0
  const inputTokens = tokenCount(record?.inputTokens)
  const outputTokens = tokenCount(record?.outputTokens)
  const nextAccount: AccountStats = {
    authIndex,
    requests: (isNumber(previous.requests) ? previous.requests : 0) + 1,
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
      ...(base.byAccount),
      [authIndex]: nextAccount,
    },
  }
}

export function sanitizeExecutionRecord(value: ExecutionInput | null | undefined): ExecutionRecord | undefined {
  if (!isJsonRecord(value)) return undefined
  const authIndex = isNonEmptyString(value.authIndex)
    ? value.authIndex
    : ''
  const sessionId = isNonEmptyString(value.sessionId)
    ? value.sessionId
    : ''
  const inputTokens = nonNegativeNumber(value.inputTokens)
  const outputTokens = nonNegativeNumber(value.outputTokens)
  if (authIndex === '' && sessionId === '') return undefined
  const record: ExecutionRecord = {
    provider: isString(value.provider) ? value.provider : '',
    model: isString(value.model) ? value.model : '',
    purpose: isString(value.purpose) ? value.purpose : '',
    outcome: value.outcome === 'success' || value.outcome === 'failure' ? value.outcome : '',
    traceId: isString(value.traceId) ? value.traceId : '',
    requestId: isString(value.requestId) ? value.requestId : '',
    time: Number.isFinite(Number(value.time)) ? Number(value.time) : Date.now(),
  }
  if (authIndex !== '') record.authIndex = authIndex
  if (sessionId !== '') record.sessionId = sessionId
  if (inputTokens !== undefined) record.inputTokens = inputTokens
  if (outputTokens !== undefined) record.outputTokens = outputTokens
  return record
}

export function aggregateCpaUsage(
  state: CpaUsageProjection | null | undefined,
  value: ExecutionInput | null | undefined,
): CpaUsageProjection | null | undefined {
  const record = sanitizeExecutionRecord(value)
  if (record === undefined) return state
  return {
    ...record,
    ...aggregateCpaSessionStats(state, record),
    latest: record,
  }
}

export class CpaExecutionStore {
  readonly filePath: string
  private readonly maxEntries: number
  private readonly bySession: Map<string, ExecutionRecord>
  private readonly byId: Map<string, ExecutionRecord>
  private loaded: boolean

  constructor(filePath: string, options: ExecutionStoreOptions = {}) {
    this.filePath = filePath
    this.maxEntries = options.maxEntries ?? 200
    this.bySession = new Map()
    this.byId = new Map()
    this.loaded = false
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const entry of parsed) {
        const record = sanitizeExecutionRecord(entry)
        if (record === undefined) continue
        this.ingest(record)
      }
    } catch {
      // A missing or malformed host state file must not break agent execution.
    }
  }

  ingest(record: ExecutionRecord): void {
    const id = record.traceId || `${record.sessionId}-${record.time}`
    const previous = this.byId.get(id)
    if (previous !== undefined) {
      if (previous.sessionId !== undefined) this.bySession.delete(previous.sessionId)
    }
    this.byId.set(id, record)
    if (record.sessionId !== '') {
      if (record.sessionId !== undefined) this.bySession.set(record.sessionId, record)
    }
    this.trim()
  }

  private trim(): void {
    if (this.byId.size <= this.maxEntries) return
    const sorted = [...this.byId.values()].sort((left, right) => right.time - left.time)
    for (const record of sorted.slice(this.maxEntries)) {
      this.byId.delete(record.traceId || `${record.sessionId}-${record.time}`)
      if (record.sessionId !== undefined && this.bySession.get(record.sessionId) === record) {
        this.bySession.delete(record.sessionId)
      }
    }
  }

  latest(sessionId: string | undefined): ExecutionRecord | undefined {
    if (sessionId === undefined) return undefined
    return this.bySession.get(sessionId)
  }

  async append(value: ExecutionInput | null | undefined): Promise<ExecutionRecord | undefined> {
    const record = sanitizeExecutionRecord(value)
    if (record === undefined) return undefined
    this.ingest(record)
    await this.persist()
    return record
  }

  async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const sorted = [...this.byId.values()].sort((left, right) => left.time - right.time)
    const tmpPath = `${this.filePath}.tmp`
    await writeFile(tmpPath, `${JSON.stringify(sorted, null, 2)}\n`, { mode: 0o600 })
    await chmod(tmpPath, 0o600)
    await rename(tmpPath, this.filePath)
  }
}
