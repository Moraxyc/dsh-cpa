/**
 * Boundary vocabulary for values that arrive from JSON payloads, query
 * parameters, or host state files. `JsonRecord` and `JsonValue` name the
 * recursive JSON shape so parsers can decode a payload once into a known
 * structure; callers never index raw `unknown`.
 */
export function isJsonRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isString(value) {
    return typeof value === 'string';
}
export function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
export function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
export function isBoolean(value) {
    return typeof value === 'boolean';
}
export function isArray(value) {
    return Array.isArray(value);
}
export function asJsonRecord(value) {
    return isJsonRecord(value) ? value : null;
}
export function isFunction(value) {
    return typeof value === 'function';
}
export function isError(cause) {
    return cause instanceof Error;
}
