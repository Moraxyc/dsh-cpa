import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export type SessionId = NonNullable<GenerateOptions['sessionId']>

/** Branded session ids are minted by the host; a test fixture brands a literal for one request. */
export function sessionId(value: string): SessionId {
  // SAFETY: stands in for the host's session minting; the brand is never inspected by these tests.
  return value as SessionId
}

/** Advanced settings every field of which takes its documented default. */
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

/** Unsigned ID token whose payload carries the ChatGPT account id, as CPA credentials do. */
export function makeIdToken(accountId: string): string {
  return [
    'header',
    Buffer.from(JSON.stringify({ chatgpt_account_id: accountId })).toString('base64url'),
    'signature',
  ].join('.')
}
