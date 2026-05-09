/**
 * orb-idempotency-release.test.ts
 *
 * Regression guard for F1 from the audit. The orb chat handler's
 * `finally` block calls `releaseRequestLock` whenever a request
 * exits without going through `finalizeIdempotentResponse` (early
 * guards: attachment too large / quota limited / provider unavailable
 * / agent disabled / planner clarification / catch-block error).
 *
 * Without the release, the in-progress lock the request holds for 60 s
 * silently swallowed every retry with the same `x-request-id`,
 * returning `{status: "in-progress"}` even after the original request
 * had finished failing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  __unsafe_resetOrbIdempotencyForTests,
  checkAndLock,
  getResult,
  releaseRequestLock,
  storeResult,
} from "./services/orbIdempotency";

describe("releaseRequestLock", () => {
  beforeEach(() => {
    __unsafe_resetOrbIdempotencyForTests();
  });

  it("drops a still-in-progress lock so a retry can run normally", () => {
    expect(checkAndLock("req-1")).toBe("new");
    // Second hit while the first is still processing: see the lock.
    expect(checkAndLock("req-1")).toBe("in-progress");

    // Early-return path didn't call storeResult; finally fires releaseRequestLock.
    releaseRequestLock("req-1");

    // Retry now runs fresh instead of getting stuck.
    expect(checkAndLock("req-1")).toBe("new");
  });

  it("does not blow away a completed result that was already stored", () => {
    expect(checkAndLock("req-2")).toBe("new");
    storeResult("req-2", { reply: "real result" });

    // The handler thinks it's about to release, but the lock is no
    // longer in-progress — it's "completed" and holds the cached
    // result. release must be a no-op so the cached result survives.
    releaseRequestLock("req-2");

    expect(checkAndLock("req-2")).toBe("duplicate");
    expect(getResult("req-2")).toEqual({ reply: "real result" });
  });

  it("is safe to call when the request id has no entry at all", () => {
    expect(() => releaseRequestLock("never-seen")).not.toThrow();
    // Calling release on an unknown id must not register one.
    expect(checkAndLock("never-seen")).toBe("new");
  });
});
