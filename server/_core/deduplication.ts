/**
 * deduplication.ts — In-flight request deduplication for LLM calls
 *
 * Prevents duplicate LLM invocations when identical requests arrive
 * concurrently (e.g. double-click, retry storms, parallel agent steps).
 *
 * Mechanism:
 *   1. Caller computes a request fingerprint (same key as cache.buildLlmKey).
 *   2. If a request with that key is already in-flight, the new caller
 *      receives a Promise that resolves when the original completes.
 *   3. If the original fails, all waiting callers receive the same error.
 *   4. Completed entries are removed immediately after resolution.
 *
 * Usage:
 *   import { dedup } from "./_core/deduplication";
 *
 *   const result = await dedup.deduplicate(
 *     cacheKey,
 *     () => invokeLLM(params),
 *   );
 */

import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DeduplicationStats {
  /** Total number of deduplicated (coalesced) calls saved */
  savedCalls: number;
  /** Number of requests currently in-flight */
  inFlightCount: number;
  /** Total unique requests that have been executed */
  executedRequests: number;
}

interface InFlightEntry<T> {
  promise: Promise<T>;
  startedAt: number;
  waiters: number;
}

// ─── Deduplication Service ─────────────────────────────────────────────────

class DeduplicationService {
  /** Map from request fingerprint → in-flight Promise */
  private readonly inFlight = new Map<string, InFlightEntry<unknown>>();

  private savedCalls = 0;
  private executedRequests = 0;

  /**
   * Execute `fn` exactly once for a given `key`, even if called concurrently.
   *
   * - If no request with `key` is in-flight, `fn` is called immediately.
   * - If a request with `key` is already in-flight, the caller waits for
   *   the existing Promise and receives the same result (or error).
   *
   * @param key       Unique fingerprint for this request (e.g. from cache.buildLlmKey)
   * @param fn        Async factory that produces the result
   * @param timeoutMs Optional per-request timeout in ms (default: 120 000)
   */
  async deduplicate<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs: number = 120_000
  ): Promise<T> {
    const existing = this.inFlight.get(key) as InFlightEntry<T> | undefined;

    if (existing) {
      existing.waiters++;
      this.savedCalls++;
      logger.debug("[Dedup] Coalescing duplicate request", {
        key,
        waiters: existing.waiters,
        ageMs: Date.now() - existing.startedAt,
      });
      return existing.promise;
    }

    // No in-flight entry — start a new execution
    this.executedRequests++;

    const entry: InFlightEntry<T> = {
      promise: null as unknown as Promise<T>,
      startedAt: Date.now(),
      waiters: 0,
    };

    const promise = this.executeWithTimeout(key, fn, timeoutMs, entry);
    entry.promise = promise;
    this.inFlight.set(key, entry as InFlightEntry<unknown>);

    return promise;
  }

  private async executeWithTimeout<T>(
    key: string,
    fn: () => Promise<T>,
    timeoutMs: number,
    entry: InFlightEntry<T>
  ): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`[Dedup] Request timed out after ${timeoutMs}ms (key: ${key})`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      return result;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      this.inFlight.delete(key);

      const durationMs = Date.now() - entry.startedAt;
      if (entry.waiters > 0) {
        logger.debug("[Dedup] Request completed, releasing waiters", {
          key,
          waiters: entry.waiters,
          durationMs,
        });
      }
    }
  }

  /**
   * Check whether a request with the given key is currently in-flight.
   * Useful for pre-flight checks without triggering deduplication.
   */
  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Return the number of callers currently waiting on a given key.
   * Returns 0 if no request is in-flight.
   */
  getWaiterCount(key: string): number {
    return this.inFlight.get(key)?.waiters ?? 0;
  }

  /** Return current deduplication statistics. */
  getStats(): DeduplicationStats {
    return {
      savedCalls: this.savedCalls,
      inFlightCount: this.inFlight.size,
      executedRequests: this.executedRequests,
    };
  }

  /** Cancel all in-flight entries (for testing / graceful shutdown). */
  clear(): void {
    this.inFlight.clear();
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const dedup = new DeduplicationService();

export { DeduplicationService };
