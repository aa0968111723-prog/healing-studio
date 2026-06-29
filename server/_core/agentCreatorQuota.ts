/**
 * agentCreatorQuota.ts — AIDV-348 每創作者代理並發配額
 *
 * Pure in-memory concurrent-slot guard that prevents a single creator
 * from monopolising all agent capacity. Mirrors the tryConsumeChatToken
 * pattern in rateLimiter.ts but tracks concurrent *slots* (acquired on
 * task start, released on task end) rather than a rolling request count.
 *
 * Design: fail-open in tests (NODE_ENV==="test" → always allow).
 * No DB / Redis dependency — single-process Railway works correctly.
 *
 * Usage (call at the start of an agent task handler):
 *   const ok = tryAcquireCreatorSlot(userId, maxConcurrent);
 *   if (!ok) throw new CreatorQuotaExceeded(userId);
 *   try { await runTask(); } finally { releaseCreatorSlot(userId); }
 */

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

// ─── In-process slot store ──────────────────────────────────────────────────

const _slotStore = new Map<number, number>(); // userId → active task count

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Attempt to acquire one concurrent task slot for the given creator.
 * Returns true when the slot is granted; false when the creator is at
 * their `maxConcurrent` limit. Always returns true in test environments.
 */
export function tryAcquireCreatorSlot(userId: number, maxConcurrent: number): boolean {
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.ENABLE_AGENT_QUOTA === "false") return true;
  const current = _slotStore.get(userId) ?? 0;
  if (current >= maxConcurrent) return false;
  _slotStore.set(userId, current + 1);
  return true;
}

/**
 * Release one concurrent task slot for the given creator.
 * Safe to call even if the slot count is already 0 (no-op).
 */
export function releaseCreatorSlot(userId: number): void {
  const current = _slotStore.get(userId) ?? 0;
  if (current <= 1) {
    _slotStore.delete(userId);
  } else {
    _slotStore.set(userId, current - 1);
  }
}

/**
 * Return the number of active concurrent slots for a creator.
 * Intended for monitoring and queue-depth endpoints.
 */
export function getCreatorSlotCount(userId: number): number {
  return _slotStore.get(userId) ?? 0;
}

/** Reset all slot state — for test isolation only. */
export function _resetCreatorQuotaForTest(): void {
  _slotStore.clear();
}
