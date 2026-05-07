/**
 * orb-memory-dashboard.test.ts
 *
 * Pure-function tests for the new memory-dashboard backend:
 *   - clearOrbMemoryByType — surgical wipe by type set
 *   - removeMetadataValue — single-chip removal preserves the rest
 *   - aggregatePreferenceProfile end-to-end through recordOrbMemory
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __unsafe_clearAllOrbMemoryForTests,
  clearOrbMemoryByType,
  getRecentOrbMemories,
  recordOrbMemory,
  removeMetadataValue,
} from "./services/orbMemory";
import { aggregatePreferenceProfile } from "../shared/orb-memory";
import { buildClarificationPickMemory } from "../shared/orb-clarification-memory";

const USER_ID = 9001;

beforeEach(() => {
  __unsafe_clearAllOrbMemoryForTests();
  process.env.ENABLE_ORB_LONG_TERM_MEMORY = "true";
});

afterEach(() => {
  __unsafe_clearAllOrbMemoryForTests();
});

describe("clearOrbMemoryByType", () => {
  it("removes only memories of the given types", () => {
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t1",
      type: "user_preference",
      summary: "user pref",
      source: "test",
    });
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t2",
      type: "successful_workflow",
      summary: "workflow",
      source: "test",
    });
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t3",
      type: "style_preference",
      summary: "style",
      source: "test",
    });

    const removed = clearOrbMemoryByType({ userId: USER_ID }, [
      "user_preference",
      "style_preference",
    ]);
    expect(removed).toBe(2);

    const remaining = getRecentOrbMemories({ userId: USER_ID, limit: 20 });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe("successful_workflow");
  });

  it("returns 0 when no types match", () => {
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t1",
      type: "successful_workflow",
      summary: "wf",
      source: "test",
    });
    expect(clearOrbMemoryByType({ userId: USER_ID }, ["user_preference"])).toBe(0);
  });

  it("returns 0 for empty type set", () => {
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t1",
      type: "user_preference",
      summary: "pref",
      source: "test",
    });
    expect(clearOrbMemoryByType({ userId: USER_ID }, [])).toBe(0);
  });

  it("does not touch another user's memories", () => {
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t1",
      type: "user_preference",
      summary: "mine",
      source: "test",
    });
    recordOrbMemory({
      userId: 9999,
      traceId: "t2",
      type: "user_preference",
      summary: "theirs",
      source: "test",
    });
    clearOrbMemoryByType({ userId: USER_ID }, ["user_preference"]);
    const others = getRecentOrbMemories({ userId: 9999, limit: 20 });
    expect(others).toHaveLength(1);
    expect(others[0].summary).toBe("theirs");
  });
});

describe("removeMetadataValue", () => {
  it("removes a single chip without dropping the memory row", () => {
    const draft = buildClarificationPickMemory([
      { dimension: "style", value: "電影感" },
      { dimension: "style", value: "極簡" },
      { dimension: "platform", value: "IG Reel" },
    ]);
    expect(draft).not.toBeNull();
    recordOrbMemory({
      userId: USER_ID,
      traceId: "wizard1",
      type: "user_preference",
      summary: draft!.summary,
      source: "orb-multi-dim-clarification",
      tags: draft!.tags,
      metadata: draft!.metadata,
    });

    const removed = removeMetadataValue({ userId: USER_ID }, "styles", "電影感");
    expect(removed).toBe(1);

    const remaining = getRecentOrbMemories({ userId: USER_ID, limit: 5 });
    expect(remaining).toHaveLength(1);
    const meta = remaining[0].metadata as Record<string, string[]>;
    expect(meta.styles).not.toContain("電影感");
    expect(meta.styles).toContain("極簡");
    expect(meta.platforms).toContain("IG Reel");
    expect(remaining[0].tags).not.toContain("style:電影感");
    expect(remaining[0].tags).toContain("style:極簡");
  });

  it("returns 0 when the value does not exist", () => {
    recordOrbMemory({
      userId: USER_ID,
      traceId: "t",
      type: "user_preference",
      summary: "x",
      source: "test",
      metadata: { styles: ["電影感"] },
      tags: ["style:電影感"],
    });
    expect(removeMetadataValue({ userId: USER_ID }, "styles", "不存在")).toBe(0);
  });
});

describe("end-to-end: clarification picks → aggregated profile", () => {
  it("builds a profile that surfaces what the dashboard renders", () => {
    const draft = buildClarificationPickMemory([
      { dimension: "style", value: "電影感運鏡" },
      { dimension: "platform", value: "IG Reel（9:16）" },
      { dimension: "purpose", value: "品牌行銷／業績轉換" },
    ]);
    expect(draft).not.toBeNull();
    recordOrbMemory({
      userId: USER_ID,
      traceId: "e2e",
      type: "user_preference",
      summary: draft!.summary,
      source: "orb-multi-dim-clarification",
      tags: draft!.tags,
      metadata: draft!.metadata,
    });

    const memories = getRecentOrbMemories({
      userId: USER_ID,
      limit: 50,
      types: ["user_preference", "style_preference", "model_preference"],
    });
    const profile = aggregatePreferenceProfile(memories);
    expect(profile.styles).toContain("電影感運鏡");
    expect(profile.platforms).toContain("IG Reel");
    expect(profile.outputs).toContain("品牌行銷");
    expect(profile.evidenceCount).toBeGreaterThanOrEqual(1);
  });
});
