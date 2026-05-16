/**
 * orb-learn-hub-memoization.test.ts
 *
 * Pin the memoization on `getLearnHubOrbIndex`. The underlying `docs` array
 * in `learnHub.ts` is module-load static, so the bucketed index is stable
 * for the process lifetime — `orbUnifiedSearch` calls this on every search
 * keystroke and the bucketing showed up in CPU profiles before memoization.
 *
 * Lives in its own file so we can use the real (un-mocked) `siteKnowledge`
 * without fighting a module-level `vi.mock()` from siblings.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetLearnHubOrbIndexCacheForTests,
  getLearnHubOrbIndex,
} from "./services/siteKnowledge";

beforeEach(() => {
  __resetLearnHubOrbIndexCacheForTests();
});

describe("getLearnHubOrbIndex — memoization", () => {
  it("returns the same reference for repeat calls at the same limit", () => {
    const a = getLearnHubOrbIndex(30);
    const b = getLearnHubOrbIndex(30);
    expect(a).toBe(b);
  });

  it("computes a separate entry per limit", () => {
    const a = getLearnHubOrbIndex(30);
    const b = getLearnHubOrbIndex(60);
    expect(a).not.toBe(b);
  });

  it("default limit (omitted) collapses to a single memoized entry", () => {
    const a = getLearnHubOrbIndex();
    const b = getLearnHubOrbIndex();
    expect(a).toBe(b);
  });
});
