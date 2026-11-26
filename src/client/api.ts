import {
  DIAGNOSTICS_PATH,
  EXECUTION_STATUS_PATH,
  PANEL_PATH,
  REPORT_PATH,
  SETTINGS_PATH,
  SUMMARY_PATH,
} from '../core/wire.js'
import type {
  CpaControllerState,
  CpaDiagnostics,
  CpaExecutionStatusResponse,
  CpaSummary,
} from './wire.js'

export const SETTINGS_URL = SETTINGS_PATH
export const SUMMARY_URL = SUMMARY_PATH
export const DIAGNOSTICS_URL = DIAGNOSTICS_PATH
export const REPORT_URL = REPORT_PATH
export const PANEL_URL = PANEL_PATH
export const EXECUTION_STATUS_URL = EXECUTION_STATUS_PATH
export const READOUT_REFRESH_MS = 60_000
export const SUMMARY_REFRESH_MS = 60_000
export const MAX_SUMMARY_MODELS = 8

export type ExecutionStatusResponse = CpaExecutionStatusResponse
export type RuntimeStateResponse = CpaControllerState | { available: false }

async function requestJson<T>(url: string, unavailable: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(unavailable)
  // SAFETY: every caller names a Host route in this package, and that route owns the JSON shape.
  return (await response.json()) as T
}

export function fetchCpaSummary(): Promise<CpaSummary> {
  return requestJson<CpaSummary>(SUMMARY_URL, 'CPA 摘要不可用')
}

export function fetchCpaDiagnostics(): Promise<CpaDiagnostics> {
  return requestJson<CpaDiagnostics>(DIAGNOSTICS_URL, 'CPA 诊断不可用')
}

export function fetchCpaRuntimeState(): Promise<RuntimeStateResponse> {
  return requestJson<RuntimeStateResponse>(SETTINGS_URL, 'CPA 不可用')
}

export function fetchExecutionStatus(sessionId: string): Promise<ExecutionStatusResponse> {
  return requestJson<ExecutionStatusResponse>(
    `${EXECUTION_STATUS_URL}?sessionId=${encodeURIComponent(sessionId)}`,
    'CPA 状态不可用',
  )
}

export async function downloadCpaReport(): Promise<void> {
  const response = await fetch(REPORT_URL, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('CPA 报告不可用')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dsh-cpa-report-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
