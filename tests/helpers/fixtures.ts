import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export type SessionId = NonNullable<GenerateOptions['sessionId']>

export function sessionId(value: string): SessionId {
  // SAFETY: tests use the literal only as an opaque session identifier.
  return value as SessionId
}

export const DEFAULT_ADVANCED_SETTINGS = {
  routingStrategy: 'balanced',
  dailyRequestLimit: 0,
  refreshIntervalMs: 300_000,
  port: 8317,
  configPath: '',
  settingsPath: '',
  executionsPath: '',
  authFilesTtlMs: 30_000,
  quotaTtlMs: 60_000,
  quotaConcurrency: 4,
} as const

export function makeIdToken(accountId: string): string {
  return [
    'header',
    Buffer.from(JSON.stringify({ chatgpt_account_id: accountId })).toString('base64url'),
    'signature',
  ].join('.')
}
