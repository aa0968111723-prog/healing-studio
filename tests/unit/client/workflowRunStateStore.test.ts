/**
 * Tests the localStorage-backed workflow run-state adapter that lets the
 * orchestrator's `persistRunState` / `loadRunState` callbacks survive across
 * tab reloads. The adapter is pure — it only touches `localStorage`, so we
 * fake it once for the whole file and assert behaviour around persist /
 * load / TTL / capacity.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  persistRunState,
  loadRunState,
  listRecentRuns,
  clearRun,
} from "../../../client/src/lib/workflowRunStateStore";
import type { WorkflowRunState } from "../../../shared/workflow-run-state";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function buildState(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  // Default to "now" so the 24h TTL inside loadRunState doesn't prune
  // freshly-persisted entries the test just wrote.
  const now = Date.now();
  return {
    runId: "run_a",
    workflowName: "短片生成",
    totalSteps: 5,
    completedStepIds: [],
    perStepToolResults: [],
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("workflowRunStateStore", () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      new MemoryStorage();
  });

  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it("round-trips a single run state via persist + load", async () => {
    const state = buildState({
      completedStepIds: ["step_a", "step_b"],
      perStepToolResults: [
        { stepId: "step_a", toolResults: [{ ok: true, data: { id: 42 } }] },
      ],
    });
    await persistRunState(state);
    const loaded = await loadRunState("run_a");
    expect(loaded).not.toBeNull();
    expect(loaded?.completedStepIds).toEqual(["step_a", "step_b"]);
    expect(loaded?.perStepToolResults[0].toolResults[0].data).toEqual({ id: 42 });
  });

  it("returns null for unknown runId", async () => {
    expect(await loadRunState("never_persisted")).toBeNull();
  });

  it("treats entries older than TTL as gone", async () => {
    const state = buildState({
      runId: "stale",
      // 25 hours ago — past the 24h TTL
      updatedAt: Date.now() - 25 * 60 * 60 * 1000,
    });
    await persistRunState(state);
    expect(await loadRunState("stale")).toBeNull();
  });

  it("caps the index at 5 most-recent runs and drops the oldest blobs", async () => {
    const now = Date.now();
    for (let i = 0; i < 8; i += 1) {
      await persistRunState(
        buildState({ runId: `run_${i}`, updatedAt: now + i })
      );
    }
    const recent = listRecentRuns();
    expect(recent.length).toBe(5);
    // Newest first — run_7 is the most recent.
    expect(recent[0].runId).toBe("run_7");
    expect(recent.map(e => e.runId)).not.toContain("run_0");
    expect(recent.map(e => e.runId)).not.toContain("run_1");
    expect(recent.map(e => e.runId)).not.toContain("run_2");
    // The dropped runs' blobs must be removed too — not just their index entry.
    expect(await loadRunState("run_0")).toBeNull();
  });

  it("clearRun removes both the blob and the index entry", async () => {
    await persistRunState(buildState({ runId: "alpha" }));
    await persistRunState(buildState({ runId: "beta" }));
    clearRun("alpha");
    expect(await loadRunState("alpha")).toBeNull();
    expect((await loadRunState("beta"))?.runId).toBe("beta");
    expect(listRecentRuns().map(e => e.runId)).toEqual(["beta"]);
  });

  it("repeated persist of the same runId updates without duplicating index entries", async () => {
    await persistRunState(
      buildState({ runId: "stable", completedStepIds: ["s1"] })
    );
    await persistRunState(
      buildState({
        runId: "stable",
        completedStepIds: ["s1", "s2"],
        updatedAt: Date.now() + 1,
      })
    );
    const recent = listRecentRuns();
    expect(recent.filter(e => e.runId === "stable")).toHaveLength(1);
    const loaded = await loadRunState("stable");
    expect(loaded?.completedStepIds).toEqual(["s1", "s2"]);
  });
});
