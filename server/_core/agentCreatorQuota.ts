/**
 * agentCreatorQuota.ts — AIDV-348 每創作者代理並發配額
 *
 * Concurrent-slot guard that prevents a single creator from monopolising all
 * agent capacity. Mirrors the GenerationLockStore seam in generationLock.ts:
 * a pluggable `CreatorQuotaStore` backend, in-memory by default, swappable to
 * a Redis-backed store at boot when REDIS_URL is configured.
 *
 * Design: fail-open in tests (NODE_ENV==="test" → always allow) and fail-open
 * on any backend error/timeout (availability > strict quota — a Redis blip
 * must never block a user from generating).
 *
 * Backend (AIDV-923 — was process-local only; now Redis-upgradeable)
 * ─────────────────────────────────────────────────────────────────
 *   - REDIS_URL unset → `InMemoryCreatorQuotaStore` (the default). Correct
 *     single-instance semantics, but per-process: under horizontal scaling a
 *     user's quota is enforced independently on each replica.
 *   - REDIS_URL set   → `RedisCreatorQuotaStore` (see redisCreatorQuotaStore.ts),
 *     swapped in at boot by `initCreatorQuotaBackend()`. The slot count lives
 *     in one shared Redis key per user, so concurrent tasks landing on
 *     different replicas contend on the same counter — the quota is enforced
 *     cross-instance. Call sites never change.
 *   - Every Redis slot carries a TTL (`SLOT_TTL_MS`) so a crashed holder that
 *     never reaches its `release()` can't wedge a user's quota forever; the
 *     slot self-expires.
 *
 * Usage (call at the start of an agent task handler):
 *   const ok = await tryAcquireCreatorSlot(userId, maxConcurrent);
 *   if (!ok) throw new CreatorQuotaExceeded(userId, ...);
 *   try { await runTask(); } finally { await releaseCreatorSlot(userId); }
 */

import { logger } from "./logger";

export class CreatorQuotaExceeded extends Error {
  readonly userId: number;
  readonly currentCount: number;
  readonly maxConcurrent: number;

  constructor(userId: number, currentCount: number, maxConcurrent: number) {
    super(
      `Creator quota exceeded: user ${userId} has ${currentCount} concurrent tasks (max ${maxConcurrent})`
    );
    this.name = "CreatorQuotaExceeded";
    this.userId = userId;
    this.currentCount = currentCount;
    this.maxConcurrent = maxConcurrent;
  }
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/**
 * TTL safety net for the Redis-backed store: if a holder crashes mid-task and
 * never calls release(), the slot self-expires after this long. Matches
 * ORB_AUTO_DRIVER_STALE_MS (_aiHelpers.ts) — the same "assume the previous
 * driver crashed" threshold already used for the orb auto-driver in-flight
 * guard, so a leaked quota slot and a leaked driver entry self-heal together.
 */
export const SLOT_TTL_MS = 10 * 60_000;

/** Short timeout on each backend op so a slow/hung backend never blocks the hot path. */
const STORE_OP_TIMEOUT_MS = 200;

// ─── Store seam ──────────────────────────────────────────────────────────────

/**
 * Minimal quota store contract. A Redis-backed implementation can be added
 * behind this interface with zero changes to callers (see redisCreatorQuotaStore.ts).
 */
export interface CreatorQuotaStore {
  /**
   * Atomically increment `userId`'s slot count iff it is currently below
   * `maxConcurrent`. Returns the new count on success, or `null` when the
   * creator is already at their limit. `ttlMs` bounds how long a slot can be
   * held without renewal (Redis backend only; ignored in-memory).
   */
  acquire(userId: number, maxConcurrent: number, ttlMs: number): Promise<number | null>;
  /** Decrement `userId`'s slot count by 1, floored at 0. Never throws. */
  release(userId: number): Promise<void>;
  /** Current slot count for `userId` (0 if none held). */
  getCount(userId: number): Promise<number>;
}

// ─── In-memory store (active backend by default) ────────────────────────────

/**
 * In-process slot store with correct single-instance semantics. Per-process
 * only — on a single Railway instance that is exactly the scope wanted; with
 * horizontal scaling, swap in a Redis-backed store via the CreatorQuotaStore
 * seam (call sites do not change).
 */
export class InMemoryCreatorQuotaStore implements CreatorQuotaStore {
  private readonly slots = new Map<number, number>();

  async acquire(userId: number, maxConcurrent: number): Promise<number | null> {
    const current = this.slots.get(userId) ?? 0;
    if (current >= maxConcurrent) return null;
    const next = current + 1;
    this.slots.set(userId, next);
    return next;
  }

  async release(userId: number): Promise<void> {
    const current = this.slots.get(userId) ?? 0;
    if (current <= 1) {
      this.slots.delete(userId);
    } else {
      this.slots.set(userId, current - 1);
    }
  }

  async getCount(userId: number): Promise<number> {
    return this.slots.get(userId) ?? 0;
  }

  /** Test/diagnostic helper. */
  clear(): void {
    this.slots.clear();
  }
}

// ─── Timeout guard ───────────────────────────────────────────────────────────

async function withOpTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`[CreatorQuota] ${label} timed out after ${STORE_OP_TIMEOUT_MS}ms`)),
      STORE_OP_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([op, timeout]);
  } finally {
    if (handle !== null) clearTimeout(handle);
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

class CreatorQuotaService {
  private store: CreatorQuotaStore;
  private memStore: InMemoryCreatorQuotaStore | null;

  constructor(store?: CreatorQuotaStore) {
    if (store) {
      this.store = store;
      this.memStore = store instanceof InMemoryCreatorQuotaStore ? store : null;
    } else {
      const mem = new InMemoryCreatorQuotaStore();
      this.store = mem;
      this.memStore = mem;
    }
  }

  /**
   * Swap the backing store (used at boot to upgrade the singleton from the
   * in-memory default to the Redis-backed store once REDIS_URL is known).
   * Call sites are unaffected — they hold the service, not the store.
   */
  setStore(store: CreatorQuotaStore): void {
    if (store === this.store) return;
    this.store = store;
    this.memStore = store instanceof InMemoryCreatorQuotaStore ? store : null;
  }

  async tryAcquire(userId: number, maxConcurrent: number): Promise<boolean> {
    if (process.env.NODE_ENV === "test") return true;
    if (process.env.ENABLE_AGENT_QUOTA === "false") return true;
    try {
      const result = await withOpTimeout(
        this.store.acquire(userId, maxConcurrent, SLOT_TTL_MS),
        "acquire"
      );
      return result !== null;
    } catch (err) {
      // Backend unavailable/slow/errored → FAIL OPEN. Availability over quota
      // strictness — a Redis blip must never block a user from generating.
      logger.warn("[CreatorQuota] acquire failed, failing open", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  async release(userId: number): Promise<void> {
    try {
      await withOpTimeout(this.store.release(userId), "release");
    } catch (err) {
      // A failed release just lets the TTL reclaim the slot — never throw.
      logger.warn("[CreatorQuota] release failed (slot will expire via TTL)", {
        userId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getCount(userId: number): Promise<number> {
    try {
      return await withOpTimeout(this.store.getCount(userId), "getCount");
    } catch {
      return 0;
    }
  }

  /** Test-only: clear all in-memory slot state. No-op when a non-memory store is active. */
  _resetForTest(): void {
    this.memStore?.clear();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const creatorQuota = new CreatorQuotaService();

export { CreatorQuotaService };

// ─── Public API (back-compat function wrappers) ─────────────────────────────

/**
 * Attempt to acquire one concurrent task slot for the given creator.
 * Resolves true when the slot is granted; false when the creator is at
 * their `maxConcurrent` limit. Always resolves true in test environments.
 */
export function tryAcquireCreatorSlot(userId: number, maxConcurrent: number): Promise<boolean> {
  return creatorQuota.tryAcquire(userId, maxConcurrent);
}

/**
 * Release one concurrent task slot for the given creator.
 * Safe to call even if the slot count is already 0 (no-op).
 */
export function releaseCreatorSlot(userId: number): Promise<void> {
  return creatorQuota.release(userId);
}

/**
 * Return the number of active concurrent slots for a creator.
 * Intended for monitoring and queue-depth endpoints.
 */
export function getCreatorSlotCount(userId: number): Promise<number> {
  return creatorQuota.getCount(userId);
}

/** Reset all slot state — for test isolation only. */
export function _resetCreatorQuotaForTest(): void {
  creatorQuota._resetForTest();
}
