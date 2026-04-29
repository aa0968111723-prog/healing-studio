/**
 * orb-dag-scheduler.test.ts
 *
 * Race-coverage tests for the parallel step scheduler. The most important
 * invariant: two steps on the same `path` are NEVER in the same batch — that
 * is the canonical UI race vector for the orb agent. Beyond that we cover:
 *
 *   - Empty / single-step inputs.
 *   - Independent cross-page steps land in one batch.
 *   - Explicit dependsOn linearises across pages.
 *   - Diamond fan-out / fan-in DAGs.
 *   - Cycle detection returns null batches + reports offending step ids.
 *   - ensureStepIds is idempotent.
 *   - runBatchesWithConcurrency caps in-flight work and surfaces the first
 *     real failure.
 */

import { describe, expect, it } from "vitest";
import {
  topologicalBatches,
  ensureStepIds,
  runBatchesWithConcurrency,
} from "../shared/orb-dag-scheduler";

function step(id: string, opts: { path?: string; dependsOn?: string[] } = {}) {
  return {
    id,
    actionType: "fillPrompt",
    payload: id,
    label: id,
    path: opts.path,
    dependsOn: opts.dependsOn,
  };
}

describe("ensureStepIds", () => {
  it("preserves existing ids and synthesises missing ones", () => {
    const result = ensureStepIds([
      { actionType: "x", payload: "", label: "a", id: "given" },
      { actionType: "x", payload: "", label: "b" },
    ]);
    expect(result.map(r => r.id)).toEqual(["given", "step_1"]);
  });
});

describe("topologicalBatches — basic shapes", () => {
  it("returns empty result for empty input", () => {
    const result = topologicalBatches([]);
    expect(result.batches).toEqual([]);
    expect(result.cycle).toBeNull();
  });

  it("returns single-batch single-step for one independent step", () => {
    const result = topologicalBatches([step("a")]);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].map(s => s.id)).toEqual(["a"]);
  });

  it("groups independent cross-page steps in one batch", () => {
    const result = topologicalBatches([
      step("a", { path: "/image-studio" }),
      step("b", { path: "/video-studio" }),
      step("c", { path: "/pro-studio" }),
    ]);
    expect(result.cycle).toBeNull();
    expect(result.batches).toHaveLength(1);
    expect(new Set(result.batches[0].map(s => s.id))).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("topologicalBatches — race protection (same-page sequencing)", () => {
  it("splits two same-page steps into two batches automatically", () => {
    const result = topologicalBatches([
      step("a", { path: "/image-studio" }),
      step("b", { path: "/image-studio" }),
    ]);
    expect(result.batches).toHaveLength(2);
    expect(result.batches[0][0].id).toBe("a");
    expect(result.batches[1][0].id).toBe("b");
    expect(result.implicitChainEdges).toContainEqual({ from: "a", to: "b", reason: "same-page" });
  });

  it("never places two same-page steps in the same batch even with mixed pages", () => {
    const result = topologicalBatches([
      step("a", { path: "/image-studio" }),
      step("b", { path: "/video-studio" }),
      step("c", { path: "/image-studio" }),
      step("d", { path: "/video-studio" }),
    ]);
    for (const batch of result.batches) {
      const paths = batch.map(s => s.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
    expect(result.cycle).toBeNull();
  });

  it("respects same-page chain even when explicit deps say otherwise", () => {
    // Even if the LLM said b depends on c (out of declared order), the
    // same-page chain forces a → b sequencing because a was declared first.
    const result = topologicalBatches([
      step("a", { path: "/x" }),
      step("b", { path: "/x", dependsOn: ["c"] }),
      step("c"),
    ]);
    const aBatch = result.batches.findIndex(batch => batch.some(s => s.id === "a"));
    const bBatch = result.batches.findIndex(batch => batch.some(s => s.id === "b"));
    expect(aBatch).toBeGreaterThanOrEqual(0);
    expect(bBatch).toBeGreaterThan(aBatch);
  });
});

describe("topologicalBatches — explicit dependsOn", () => {
  it("linearises a chain across pages", () => {
    const result = topologicalBatches([
      step("a", { path: "/x" }),
      step("b", { path: "/y", dependsOn: ["a"] }),
      step("c", { path: "/z", dependsOn: ["b"] }),
    ]);
    expect(result.batches.map(b => b.map(s => s.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("handles diamond fan-out + fan-in", () => {
    // a → b, a → c, then b + c → d
    const result = topologicalBatches([
      step("a"),
      step("b", { dependsOn: ["a"] }),
      step("c", { dependsOn: ["a"] }),
      step("d", { dependsOn: ["b", "c"] }),
    ]);
    expect(result.cycle).toBeNull();
    expect(result.batches).toHaveLength(3);
    expect(result.batches[0].map(s => s.id)).toEqual(["a"]);
    expect(new Set(result.batches[1].map(s => s.id))).toEqual(new Set(["b", "c"]));
    expect(result.batches[2].map(s => s.id)).toEqual(["d"]);
  });

  it("ignores dependsOn entries pointing at non-existent ids", () => {
    const result = topologicalBatches([
      step("a", { dependsOn: ["does-not-exist"] }),
    ]);
    expect(result.batches).toEqual([[expect.objectContaining({ id: "a" })]]);
  });
});

describe("topologicalBatches — cycle detection", () => {
  it("reports the cycle and returns empty batches", () => {
    const result = topologicalBatches([
      step("a", { dependsOn: ["b"] }),
      step("b", { dependsOn: ["a"] }),
    ]);
    expect(result.batches).toEqual([]);
    expect(result.cycle).not.toBeNull();
    expect(new Set(result.cycle!)).toEqual(new Set(["a", "b"]));
  });
});

describe("runBatchesWithConcurrency", () => {
  it("respects concurrency cap within a batch", async () => {
    const inFlight: number[] = [];
    let peak = 0;
    const batches = [
      [step("a"), step("b"), step("c"), step("d"), step("e")].map(s => ({
        ...s,
        id: s.id,
      })),
    ];
    const result = await runBatchesWithConcurrency({
      batches,
      concurrency: 2,
      runStep: async () => {
        inFlight.push(1);
        peak = Math.max(peak, inFlight.length);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight.pop();
        return "ok" as const;
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(result.failed).toBeNull();
    expect(result.results).toHaveLength(5);
  });

  it("surfaces the first failing step", async () => {
    const batches = [[step("a"), step("b"), step("c")].map(s => ({ ...s }))];
    const result = await runBatchesWithConcurrency({
      batches,
      concurrency: 3,
      runStep: async stepArg => {
        if (stepArg.id === "b") throw new Error("boom");
        return stepArg.id;
      },
    });
    expect(result.failed).not.toBeNull();
    expect(result.failed!.step.id).toBe("b");
    expect((result.failed!.error as Error).message).toBe("boom");
  });

  it("waits for batch N to finish before starting batch N+1", async () => {
    const order: string[] = [];
    const batches = [
      [step("a")],
      [step("b")],
    ].map(batch => batch.map(s => ({ ...s })));
    await runBatchesWithConcurrency({
      batches,
      concurrency: 5,
      runStep: async stepArg => {
        order.push(`start:${stepArg.id}`);
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push(`end:${stepArg.id}`);
        return stepArg.id;
      },
    });
    // 'a' must finish before 'b' starts.
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });
});
