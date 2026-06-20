/**
 * generationLock.ts — Duplicate-submission lock for generation entry points
 *
 * Purpose
 * ───────
 * Prevents a single user from accidentally firing the *same* generation request
 * twice concurrently (double-click, retry storms, parallel agent steps). It is a
 * convenience lock — NOT a security control — so it is **fail-open by design**:
 * if the lock backend is unavailable, slow, or errors, generation is allowed to
 * proceed and only a warning is logged. A user must never be unable to generate
 * because the lock had a problem.
 *
 * Semantics (Redis SET NX PX + Lua CAS-del, emulated faithfully in-memory)
 * ────────────────────────────────────────────────────────────────────────
 *   acquire(key, ttlMs):
 *     - Atomically sets `key → token` only if `key` is currently free
 *       (SET key token NX PX ttl). Returns the token on success, or `null`
 *       if the key is already held (someone else's generation is in progress).
 *     - Every lock carries a TTL so a crashed/abandoned holder never wedges the
 *       resource permanently — the lock auto-expires.
 *   release(key, token):
 *     - Compare-and-delete: only removes the entry if its stored value still
 *       equals `token` (Lua CAS-del). This guarantees we never delete a lock
 *       that a *subsequent* legitimate attempt acquired after our TTL lapsed.
 *
 * Backend (the active store depends on REDIS_URL — read this before relying on it)
 * ─────────────────────────────────────────────────────────────────────────────
 * The store is selected at boot via the `GenerationLockStore` seam:
 *   - REDIS_URL unset  → `InMemoryGenerationLockStore` (the default). Correct
 *     single-instance semantics (token-compare delete + TTL auto-expiry), but
 *     **per-process only**. Two identical submits landing on different replicas
 *     would BOTH acquire, and a restart drops all locks. This robustly covers
 *     the dominant case (one user, one browser, double-click / retry storm →
 *     same process) and degrades gracefully (fail-open) otherwise.
 *   - REDIS_URL set    → `RedisGenerationLockStore` (see redisGenerationLockStore.ts),
 *     swapped in at boot by `initGenerationLockBackend()`. `setNxPx` → `SET key
 *     token NX PX ttl`, `casDel` → the Lua get-compare-del script. This makes
 *     the dedup guarantee **cross-instance**: contending submits on different
 *     replicas hit the same Redis key, so only one acquires. Call sites never
 *     change — they use the `generationLock` singleton, whose store is swapped.
 *
 * Either way the lock is fail-open: if the backend is unavailable/slow/errors,
 * generation proceeds (availability > dedup). A down Redis therefore degrades
 * cross-instance dedup back to best-effort; it can never block a user.
 *
 * Late-write self-heal (Redis edge case)
 * ──────────────────────────────────────
 * A slow `setNxPx` can land on Redis *after* our op timeout already fired and we
 * failed open. That would leave a lock nobody is tracking. On every fail-open
 * acquire we therefore schedule a best-effort CAS-del on our own token to
 * neutralize such a late-landed write (see `scheduleSelfHeal`). It only ever
 * deletes a lock whose value equals our unique token, so it can never delete
 * another caller's lock.
 *
 * Hot-path safety
 * ───────────────
 * All store operations are wrapped with a short timeout (default 200ms) and a
 * try/catch. A timeout or error is treated as "lock unavailable" → fail-open.
 * The in-memory store is synchronous so the timeout never actually fires for it,
 * but the guard is in place for any future async (Redis) backend.
 *
 * Usage
 * ─────
 *   import { generationLock, buildGenerationLockKey } from "./generationLock";
 *
 *   const key = buildGenerationLockKey(userId, { segments, generationOptions });
 *   const token = await generationLock.acquire(key, 180_000);
 *   if (token === GENERATION_LOCKED) {
 *     throw new TRPCError({ code: "CONFLICT", message: "此生成正在進行中" });
 *   }
 *   try {
 *     // ... do the generation submission ...
 *   } finally {
 *     if (token) await generationLock.release(key, token);
 *   }
 */

import { createHash, randomUUID } from "node:crypto";
import { logger } from "./logger";
import { serverEnv } from "./env.validated";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Sentinel returned by acquire() when the lock is already held by another
 * in-progress generation. Distinct from `null` (which we never return) so call
 * sites can branch unambiguously. A real token is always a uuid string.
 */
export const GENERATION_LOCKED = Symbol("GENERATION_LOCKED");

/** Result of acquire(): a token string (got the lock), or GENERATION_LOCKED. */
export type AcquireResult = string | typeof GENERATION_LOCKED;

/**
 * Default TTL for the *planning* lock (ms) on autoGenerateFromSegments.
 *
 * The planning call only builds task descriptors + checks the point balance
 * (a few fast DB reads); it does NOT deduct points or dispatch. So this TTL
 * just needs to debounce a concurrent identical *plan*. 180s is far more than
 * planning ever takes — it is deliberately generous so a crashed planner never
 * wedges the resource (the lock auto-expires either way).
 */
export const DEFAULT_LOCK_TTL_MS = 180_000;

/**
 * TTL for the *per-task* execution lock (ms) on executeGenerationTask.
 *
 * THIS is the lock that actually prevents duplicate *paid* generation: it is
 * held across the point deduction + fal queue submit (the money + dispatch
 * path). The held critical section is short — a couple of DB writes plus one
 * fal `submit` HTTP round-trip that returns a request_id quickly (the long
 * generation itself happens later via separate polling, NOT under this lock).
 *
 * 60s bounds a hung submit with comfortable margin while keeping the dedup
 * window tight: a genuine retry of a *failed* task (which released its lock in
 * finally) is never blocked, but a true concurrent double-fire of the same task
 * is. As with every lock here it auto-expires, so a crash mid-submit cannot
 * wedge the user out of re-running that task.
 */
export const DEFAULT_TASK_LOCK_TTL_MS = 60_000;

/** Short timeout on each backend op so a slow/hung backend never blocks the hot path. */
const STORE_OP_TIMEOUT_MS = 200;

/**
 * Self-heal of a *late-landed* lock (see the doc block). After a fail-open
 * acquire we re-attempt CAS-del on our own token a few times, spaced out, to
 * catch a `setNxPx` that lands shortly after the op timeout fired. Bounded and
 * best-effort: a handful of attempts over <1s, all errors swallowed.
 */
const DEFAULT_SELF_HEAL_ATTEMPTS = 3;
const DEFAULT_SELF_HEAL_INTERVAL_MS = 150;

/** Key namespace prefix (the Redis backend further prepends REDIS_KEY_PREFIX). */
const KEY_PREFIX = "gen-lock";

// ─── Store seam ──────────────────────────────────────────────────────────────

/**
 * Minimal lock store contract. Maps 1:1 onto Redis primitives:
 *   setNxPx → `SET key token NX PX ttl`
 *   casDel  → Lua `if redis.call('get',k)==token then return redis.call('del',k) end`
 *
 * A Redis-backed implementation can be added later behind this interface with
 * zero changes to callers.
 */
export interface GenerationLockStore {
  /**
   * Set `key`→`token` with a `ttlMs` expiry **only if** `key` is currently
   * unset (NX). Returns true if the lock was taken, false if already held.
   */
  setNxPx(key: string, token: string, ttlMs: number): Promise<boolean>;
  /**
   * Delete `key` **only if** its current value equals `token` (compare-and-delete).
   * Returns true if a matching entry was removed, false otherwise.
   */
  casDel(key: string, token: string): Promise<boolean>;
}

// ─── In-memory store (active backend) ────────────────────────────────────────

interface MemEntry {
  token: string;
  expiresAt: number; // Unix ms
}

/**
 * In-process lock store with correct single-instance semantics:
 *   - NX honoured against non-expired entries (expired entries are treated as free)
 *   - TTL auto-expiry (lazy on access; a periodic sweep reclaims memory)
 *   - token compare-and-delete (never deletes another holder's lock)
 *
 * Note: this is per-process. On a single Railway instance that is exactly the
 * dedup scope we want. With horizontal scaling, swap in a Redis-backed store via
 * the GenerationLockStore seam — call sites do not change.
 */
export class InMemoryGenerationLockStore implements GenerationLockStore {
  private readonly store = new Map<string, MemEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  setNxPx(key: string, token: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      // Held by a live lock → NX fails.
      return Promise.resolve(false);
    }
    // Free or expired → take it.
    this.store.set(key, { token, expiresAt: now + ttlMs });
    return Promise.resolve(true);
  }

  casDel(key: string, token: string): Promise<boolean> {
    const existing = this.store.get(key);
    if (existing && existing.token === token) {
      this.store.delete(key);
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  /** Test/diagnostic helper: is a (non-expired) lock currently held for `key`? */
  isHeld(key: string): boolean {
    const e = this.store.get(key);
    return Boolean(e && e.expiresAt > Date.now());
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, e] of Array.from(this.store.entries())) {
      if (e.expiresAt <= now) this.store.delete(k);
    }
  }

  /** Stop the sweep timer and clear state (tests / graceful shutdown). */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.store.clear();
  }
}

// ─── Key builder ─────────────────────────────────────────────────────────────

/**
 * Deterministically hash an arbitrary generation payload to a short hex digest.
 * Uses sha256 (collision-resistant; we slice to 16 hex chars = 64 bits, ample
 * for a per-user dedup window). Stable JSON key ordering is NOT enforced here —
 * callers pass a structurally stable object (the validated tRPC input), so the
 * field order is already deterministic.
 */
export function hashGenerationPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

/**
 * Build a lock key that precisely represents "the same generation request".
 *
 * Granularity: `gen-lock:{userId}:{payloadHash}`
 *   - Same user + same payload  → same key → second concurrent submit is blocked
 *     (this is exactly "don't run the same generation twice").
 *   - Same user + different payload (different segments/options/project)
 *     → different hash → different key → parallel generations are allowed.
 *   - Different users → different userId → always independent.
 *
 * This is intentionally scoped per-user: two different users submitting an
 * identical payload still get independent locks (their generations are
 * legitimately separate jobs).
 */
export function buildGenerationLockKey(
  userId: number | string,
  payload: unknown
): string {
  return `${KEY_PREFIX}:${userId}:${hashGenerationPayload(payload)}`;
}

/** Stable identity of a single generation task (the unit that spends points). */
export interface GenerationTaskIdentity {
  segmentId: string;
  modality: string;
  modelId: string;
  prompt: string;
  params: Record<string, unknown>;
}

/**
 * Build a lock key for a single *execution* task (executeGenerationTask).
 *
 * This is the dedup boundary that matters for money: executeGenerationTask is
 * the procedure that deducts points + dispatches to fal, and the client calls
 * it once PER TASK (and again on per-task retry / from a second tab). Keying on
 * the stable per-task identity means:
 *   - The exact same task fired twice concurrently (double-fire of the retry
 *     button, two tabs, or the autoGenerate fan-out racing a manual retry)
 *     → same key → the second is rejected BEFORE any points are deducted.
 *   - A retry of a task that already *finished* its submit (lock released in
 *     finally) → free key → allowed (legitimate retry of a failed task).
 *   - Different segment/modality/model/prompt/params → different key → parallel.
 *
 * A separate `:task:` segment namespaces these apart from the planning-lock
 * keys so the two locks can never collide on the same string.
 */
export function buildGenerationTaskLockKey(
  userId: number | string,
  task: GenerationTaskIdentity
): string {
  const hash = hashGenerationPayload({
    segmentId: task.segmentId,
    modality: task.modality,
    modelId: task.modelId,
    prompt: task.prompt,
    params: task.params,
  });
  return `${KEY_PREFIX}:task:${userId}:${hash}`;
}

// ─── Timeout guard ───────────────────────────────────────────────────────────

/**
 * Race a store op against a short timeout. On timeout the op's own outcome is
 * discarded and we surface a timeout error to the caller, which fail-opens.
 */
async function withOpTimeout<T>(op: Promise<T>, label: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`[GenerationLock] ${label} timed out after ${STORE_OP_TIMEOUT_MS}ms`)),
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

export interface GenerationLockStats {
  acquired: number;
  blocked: number;
  released: number;
  /** Times acquire() failed open (backend error/timeout) and allowed generation. */
  failOpen: number;
  /** Times the late-write self-heal CAS-deleted an orphaned lock after a fail-open. */
  selfHealed: number;
}

/** Tunables for the service (self-heal cadence). All optional with safe defaults. */
export interface GenerationLockServiceOptions {
  selfHealAttempts?: number;
  selfHealIntervalMs?: number;
}

class GenerationLockService {
  private store: GenerationLockStore;
  private memStore: InMemoryGenerationLockStore | null;

  private acquired = 0;
  private blocked = 0;
  private released = 0;
  private failOpen = 0;
  private selfHealed = 0;

  private readonly selfHealAttempts: number;
  private readonly selfHealIntervalMs: number;
  /**
   * In-flight self-heal sleeps. destroy() clears each timer AND resolves its
   * promise so the awaiting runSelfHeal unblocks, observes `destroyed`, and
   * returns (otherwise a cleared timer would leave the promise pending forever).
   */
  private readonly healWaiters = new Set<{
    handle: ReturnType<typeof setTimeout>;
    resolve: () => void;
  }>();
  /** In-flight self-heal promises (so tests can await completion). */
  private readonly healPromises = new Set<Promise<void>>();
  private destroyed = false;

  constructor(store?: GenerationLockStore, opts?: GenerationLockServiceOptions) {
    if (store) {
      this.store = store;
      this.memStore = store instanceof InMemoryGenerationLockStore ? store : null;
    } else {
      const mem = new InMemoryGenerationLockStore();
      this.store = mem;
      this.memStore = mem;
    }
    this.selfHealAttempts = opts?.selfHealAttempts ?? DEFAULT_SELF_HEAL_ATTEMPTS;
    this.selfHealIntervalMs =
      opts?.selfHealIntervalMs ?? DEFAULT_SELF_HEAL_INTERVAL_MS;
  }

  /**
   * Swap the backing store (used at boot to upgrade the singleton from the
   * in-memory default to the Redis-backed store once REDIS_URL is known). Tears
   * down the previous auto-created in-memory store's sweep timer if we're
   * replacing it. Call sites are unaffected — they hold the service, not the store.
   */
  setStore(store: GenerationLockStore): void {
    if (store === this.store) return;
    if (this.memStore && this.memStore !== store) {
      this.memStore.destroy();
    }
    this.store = store;
    this.memStore = store instanceof InMemoryGenerationLockStore ? store : null;
  }

  /**
   * Whether the generation lock is enabled. Flag ENABLE_GENERATION_LOCK
   * (default ON). When OFF, acquire() always returns a token without touching
   * the store (no locking; behaviour identical to fail-open) and release() is a
   * no-op. The flag never changes the fail-open guarantee.
   */
  isEnabled(): boolean {
    const raw = serverEnv.ENABLE_GENERATION_LOCK;
    // Default ON: only "false"/"0" disable it.
    return raw !== "false" && raw !== "0";
  }

  /**
   * Try to acquire the lock for `key`.
   *   - Returns a token string  → caller holds the lock; MUST release() it.
   *   - Returns GENERATION_LOCKED → another submission is in progress; caller
   *     should reject with a clear "in progress" response (NOT start a dup).
   *
   * Fail-open: if the flag is OFF, or the backend errors/times out, a fresh
   * token is returned (caller proceeds). A warning is logged on backend failure.
   * Never throws.
   */
  async acquire(key: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<AcquireResult> {
    if (!this.isEnabled()) {
      // Disabled → behave as if always free (no locking). Token lets the caller
      // run a release() that is a safe no-op (CAS-del won't match anything).
      return randomUUID();
    }

    const token = randomUUID();
    try {
      const got = await withOpTimeout(this.store.setNxPx(key, token, ttlMs), "acquire");
      if (got) {
        this.acquired++;
        return token;
      }
      this.blocked++;
      return GENERATION_LOCKED;
    } catch (err) {
      // Backend unavailable/slow/errored → FAIL OPEN. Availability over dedup.
      this.failOpen++;
      // The setNxPx may still land on the backend after this race gave up (slow
      // ack). Schedule a best-effort CAS-del on our own token to neutralize such
      // a late-landed lock so it can't wrongly block a later legitimate attempt.
      this.scheduleSelfHeal(key, token);
      logger.warn("[GenerationLock] acquire failed, proceeding without lock (fail-open)", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
      return token;
    }
  }

  /**
   * Best-effort neutralization of a late-landed lock (see the doc block). Runs
   * detached: a few CAS-del attempts on our token, spaced by selfHealIntervalMs,
   * stopping as soon as one removes the orphan. CAS-del only matches our unique
   * token, so this can never delete another caller's lock. All errors swallowed.
   */
  private scheduleSelfHeal(key: string, token: string): void {
    if (this.destroyed || this.selfHealAttempts <= 0) return;
    const p = this.runSelfHeal(key, token).finally(() => {
      this.healPromises.delete(p);
    });
    this.healPromises.add(p);
  }

  private async runSelfHeal(key: string, token: string): Promise<void> {
    for (let i = 0; i < this.selfHealAttempts && !this.destroyed; i++) {
      await this.sleep(this.selfHealIntervalMs);
      if (this.destroyed) return;
      try {
        const removed = await withOpTimeout(this.store.casDel(key, token), "selfHeal");
        if (removed) {
          this.selfHealed++;
          return;
        }
      } catch {
        // Backend still unavailable — try again on the next tick (best-effort).
      }
    }
  }

  /** Cancelable sleep whose timer is tracked so destroy() can clear + resolve it. */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const waiter = {
        handle: setTimeout(() => {
          this.healWaiters.delete(waiter);
          resolve();
        }, ms),
        resolve,
      };
      if (typeof waiter.handle.unref === "function") waiter.handle.unref();
      this.healWaiters.add(waiter);
    });
  }

  /**
   * Release a lock previously taken by acquire(). Compare-and-delete: only the
   * holder of `token` can release, so a lock re-acquired by a later attempt
   * (after TTL expiry) is never deleted by a late releaser. Never throws.
   *
   * Safe to call with any token even when the flag is OFF or after a fail-open
   * acquire — CAS-del simply matches nothing and returns false.
   */
  async release(key: string, token: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      const removed = await withOpTimeout(this.store.casDel(key, token), "release");
      if (removed) this.released++;
      return removed;
    } catch (err) {
      // A failed release just lets the TTL reclaim the lock — never block.
      logger.warn("[GenerationLock] release failed (lock will expire via TTL)", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Convenience wrapper: acquire → run `fn` → always release in finally.
   * If the lock is already held, `onLocked` is invoked and its result returned
   * (typically throws a TRPCError CONFLICT). Fail-open acquire still runs `fn`.
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    onLocked: () => T | Promise<T>,
    ttlMs: number = DEFAULT_LOCK_TTL_MS
  ): Promise<T> {
    const token = await this.acquire(key, ttlMs);
    if (token === GENERATION_LOCKED) {
      return onLocked();
    }
    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }

  getStats(): GenerationLockStats {
    return {
      acquired: this.acquired,
      blocked: this.blocked,
      released: this.released,
      failOpen: this.failOpen,
      selfHealed: this.selfHealed,
    };
  }

  /** Test-only: is this key currently locked in the in-memory backend? */
  _isHeld(key: string): boolean {
    return this.memStore?.isHeld(key) ?? false;
  }

  /** Test-only: await all in-flight self-heal attempts to settle. */
  async _drainSelfHeals(): Promise<void> {
    await Promise.allSettled(Array.from(this.healPromises));
  }

  /** Graceful shutdown / test teardown. Cancels pending self-heal timers. */
  destroy(): void {
    this.destroyed = true;
    for (const w of this.healWaiters) {
      clearTimeout(w.handle);
      // Unblock the awaiting runSelfHeal so it can observe `destroyed` and exit.
      w.resolve();
    }
    this.healWaiters.clear();
    this.memStore?.destroy();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const generationLock = new GenerationLockService();

export { GenerationLockService };
