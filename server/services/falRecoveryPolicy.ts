/**
 * ADP-2 Exception/Recovery policy for fal.ai generation failures.
 *
 * Three failure categories:
 *   - transient: timeout, queue overload, 5xx from fal → bounded retry with backoff
 *   - content:   moderation/policy violation from fal provider → fail-fast, no retry
 *   - hard:      invalid model ID, bad input, unsupported format → fail-fast, no retry
 *
 * Feature flag: ADP2_RETRY_ENABLED (default "1", set to "0" to disable retries)
 * Max retries:  ADP2_MAX_RETRIES   (default 2, capped at 5)
 */

export type FalFailureCategory = "transient" | "content" | "hard";

// Patterns that indicate a content-policy rejection from fal or the underlying model.
const CONTENT_PATTERNS: RegExp[] = [
  /content[_\s-]?policy/i,
  /policy[_\s-]?violation/i,
  /moderat/i,
  /\bnsfw\b/i,
  /inappropriate/i,
  /\bsafety\b/i,
  /blocked\s+by/i,
  /prohibited/i,
];

// Patterns that indicate a hard failure (bad input / unknown model / format mismatch).
const HARD_PATTERNS: RegExp[] = [
  /model\s+not\s+found/i,
  /unknown\s+model/i,
  /invalid\s+model/i,
  /model\s+unavailable/i,
  /no\s+such\s+model/i,
  /invalid\s+input/i,
  /bad\s+request/i,
  /validation[\s_-]*error/i,
  /unprocessable\s+entity/i,
  /not\s+supported/i,
  /\b422\b/,
  /\b400\b/,
];

/**
 * Classify a fal failure to decide whether to retry.
 *
 * Returns:
 *   "content"   → policy/moderation violation; do NOT retry
 *   "hard"      → structural error (bad model/input); do NOT retry
 *   "transient" → infra error (timeout, 5xx, queue overload); safe to retry
 */
export function classifyFalFailure(
  error: string | undefined,
  raw: unknown
): FalFailureCategory {
  const rawStr = (() => {
    try {
      return typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
    } catch {
      return "";
    }
  })();
  const haystack = `${error ?? ""} ${rawStr}`;

  if (CONTENT_PATTERNS.some(p => p.test(haystack))) return "content";
  if (HARD_PATTERNS.some(p => p.test(haystack))) return "hard";
  return "transient";
}

/**
 * Whether ADP-2 retry is enabled.
 * Default ON; set env ADP2_RETRY_ENABLED=0 to disable.
 */
export function isAdp2RetryEnabled(): boolean {
  return process.env.ADP2_RETRY_ENABLED !== "0";
}

/**
 * Maximum number of retry attempts (excluding the initial attempt).
 * Env ADP2_MAX_RETRIES overrides; capped at 5 to prevent runaway retries.
 */
export function getAdp2MaxRetries(): number {
  const v = parseInt(process.env.ADP2_MAX_RETRIES ?? "", 10);
  if (!Number.isFinite(v) || v < 0) return 2;
  return Math.min(v, 5);
}

/**
 * Sleep seam — replaced in tests to avoid real delays.
 * @internal
 */
export let _adp2SleepFn: (ms: number) => Promise<void> = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

/** @internal — test hook only */
export function _setAdp2SleepFnForTest(fn: (ms: number) => Promise<void>): void {
  _adp2SleepFn = fn;
}

/** @internal — restore default sleep after test */
export function _resetAdp2SleepFn(): void {
  _adp2SleepFn = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff delay for retry attempt N (1-indexed).
 * 1s → 2s → 4s → … capped at 8s.
 */
export function adp2BackoffMs(attempt: number): number {
  return Math.min(1_000 * Math.pow(2, attempt - 1), 8_000);
}
