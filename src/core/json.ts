/**
 * Boundary vocabulary for values that arrive from JSON payloads, query
 * parameters, or host state files. `JsonRecord` and `JsonValue` name the
 * recursive JSON shape so parsers can decode a payload once into a known
 * structure; callers never index raw `unknown`.
 */

export interface JsonRecord {
  [key: string]: JsonValue
}

export type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[]

export function isJsonRecord<T>(value: T): value is T & JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isString<T>(value: T): value is Extract<T, string> {
  return typeof value === 'string'
}

export function isNonEmptyString<T>(value: T): value is Extract<T, string> {
  return typeof value === 'string' && value.length > 0
}

export function isNumber<T>(value: T): value is Extract<T, number> {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBoolean<T>(value: T): value is Extract<T, boolean> {
  return typeof value === 'boolean'
}

export function isArray<T>(value: T): value is Extract<T, readonly unknown[]> {
  return Array.isArray(value)
}

export function asJsonRecord(value: JsonValue | undefined): JsonRecord | null {
  return isJsonRecord(value) ? value : null
}

export function isFunction<T>(value: T): value is Extract<T, (...args: never[]) => void> {
  return typeof value === 'function'
}

export function isError(cause: unknown): cause is Error {
  return cause instanceof Error
}
