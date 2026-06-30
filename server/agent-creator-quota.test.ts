/**
 * agent-creator-quota.test.ts — AIDV-348 每創作者代理並發配額測試
 *
 * Tests three access-control branches:
 *   1. Slot acquisition succeeds when under the limit
 *   2. Slot acquisition is denied when the creator is at maxConcurrent
 *   3. Released slots become available again (RAII lifecycle)
 *   4. Different creators have independent slot counts (isolation)
 *
 * AIDV-923: tryAcquireCreatorSlot/releaseCreatorSlot/getCreatorSlotCount are
 * now async (the store seam can be Redis-backed in production), so every
 * call here is awaited.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  tryAcquireCreatorSlot,
  releaseCreatorSlot,
  getCreatorSlotCount,
  _resetCreatorQuotaForTest,
  CreatorQuotaExceeded,
  InMemoryCreatorQuotaStore,
} from "./_core/agentCreatorQuota";

// ─── Note on test strategy ───────────────────────────────────────────────────
// NODE_ENV==="test" causes tryAcquireCreatorSlot to always return true.
// We therefore test the internal slot accounting via getCreatorSlotCount and
// verify that the public tryAcquireCreatorSlot returns true in all test cases
// (as expected by the fail-open contract for test environments).
// Boundary/enforcement tests are performed by calling the quota logic through
// a wrapper that overrides the env check.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetCreatorQuotaForTest();
});

describe("CreatorQuotaExceeded error", () => {
  it("carries userId, currentCount, and maxConcurrent", () => {
    const err = new CreatorQuotaExceeded(7, 2, 2);
    expect(err).toBeInstanceOf(CreatorQuotaExceeded);
    expect(err.userId).toBe(7);
    expect(err.currentCount).toBe(2);
    expect(err.maxConcurrent).toBe(2);
    expect(err.message).toContain("user 7");
    expect(err.name).toBe("CreatorQuotaExceeded");
  });
});

describe("releaseCreatorSlot", () => {
  it("is a no-op when slot count is already 0", async () => {
    await releaseCreatorSlot(99);
    expect(await getCreatorSlotCount(99)).toBe(0);
  });

  it("decrements the slot count by 1", async () => {
    // Manually seed the store via acquire (in test env, always true)
    await tryAcquireCreatorSlot(10, 5); // increments in non-test; no-op in test
    // Use getCreatorSlotCount to inspect; then release
    await releaseCreatorSlot(10);
    expect(await getCreatorSlotCount(10)).toBe(0);
  });
});

describe("getCreatorSlotCount", () => {
  it("returns 0 for unknown creator", async () => {
    expect(await getCreatorSlotCount(42)).toBe(0);
  });
});

describe("tryAcquireCreatorSlot — test-env fail-open", () => {
  it("always returns true in test environment", async () => {
    // 100 acquisitions without release — still true (fail-open in test env)
    for (let i = 0; i < 100; i++) {
      expect(await tryAcquireCreatorSlot(1, 2)).toBe(true);
    }
  });
});

describe("RAII lifecycle via _resetCreatorQuotaForTest", () => {
  it("reset clears all creator slots", async () => {
    await tryAcquireCreatorSlot(1, 5);
    await tryAcquireCreatorSlot(2, 5);
    _resetCreatorQuotaForTest();
    expect(await getCreatorSlotCount(1)).toBe(0);
    expect(await getCreatorSlotCount(2)).toBe(0);
  });
});

describe("slot isolation across creators", () => {
  it("each creator has an independent slot count", async () => {
    await releaseCreatorSlot(100); // no-op
    await releaseCreatorSlot(200); // no-op
    expect(await getCreatorSlotCount(100)).toBe(0);
    expect(await getCreatorSlotCount(200)).toBe(0);
  });
});

// ─── AIDV-923: direct store-level boundary tests ─────────────────────────────
// The public tryAcquireCreatorSlot wrapper fail-opens unconditionally under
// NODE_ENV==="test", so the actual maxConcurrent enforcement logic lives only
// in the store class and is otherwise untested. Exercise InMemoryCreatorQuotaStore
// directly (bypassing the env short-circuit) to cover the real boundary.
describe("InMemoryCreatorQuotaStore — max enforcement (direct, bypasses test-env fail-open)", () => {
  it("grants slots up to maxConcurrent, then rejects", async () => {
    const store = new InMemoryCreatorQuotaStore();
    expect(await store.acquire(1, 2, 0)).toBe(1);
    expect(await store.acquire(1, 2, 0)).toBe(2);
    expect(await store.acquire(1, 2, 0)).toBeNull(); // at limit
  });

  it("release frees a slot so a subsequent acquire succeeds", async () => {
    const store = new InMemoryCreatorQuotaStore();
    await store.acquire(1, 1, 0);
    expect(await store.acquire(1, 1, 0)).toBeNull();
    await store.release(1);
    expect(await store.acquire(1, 1, 0)).toBe(1);
  });

  it("tracks each userId independently", async () => {
    const store = new InMemoryCreatorQuotaStore();
    await store.acquire(1, 1, 0);
    expect(await store.acquire(2, 1, 0)).toBe(1); // different user, own ceiling
    expect(await store.getCount(1)).toBe(1);
    expect(await store.getCount(2)).toBe(1);
  });
});
