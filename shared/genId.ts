/**
 * genId — shared non-cryptographic ID generator.
 *
 * Format: `{prefix}_{ms}_{rand}`
 * - ms  : Date.now() timestamp (decimal)
 * - rand: Math.random().toString(36) slice of `randLen` characters
 *
 * Use only for trace IDs, task IDs, and similar non-secret identifiers.
 * Do NOT use for secrets, tokens, or security-sensitive values.
 */
export function genId(prefix: string, randLen = 8): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 2 + randLen)}`;
}
