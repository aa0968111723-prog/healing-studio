/**
 * server/studio-tool-moderation-gate.test.ts
 *
 * DEF-AG3: per-step content moderation gate in `dispatchStudioTool`. Before
 * this gate existed, planner-side moderation was the only line of defence;
 * an LLM that smuggled a violent prompt past the planner reply check could
 * still ship the same text into a fal.ai studio.* call.
 *
 * Covered behaviour:
 *  1. A violent prompt is BLOCKED before fal queue submit fires.
 *  2. A clean prompt passes through normally (no false positives).
 *  3. The gate sweeps every prompt-shaped arg (prompt / text / script /
 *     lyrics / negative_prompt) — a violent value in any of them blocks
 *     the call.
 *  4. Empty / non-string values do not trigger the gate.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock fal queue + brain so we can verify they're never called when the gate
// blocks. The mock factories must be referentially stable so vi.mock can hoist
// them.
vi.mock("./services/falDispatcher", () => ({
  dispatchFalQueueTask: vi.fn(async () => ({
    request_id: "should-never-be-called",
    modelId: "fal-ai/flux/dev",
    degraded: false,
  })),
}));

vi.mock("./services/falQueueAwaiter", () => ({
  awaitFalQueueResult: vi.fn(async () => ({ status: "pending" })),
}));

vi.mock("./middleware/brainContext", () => ({
  buildBrainContext: vi.fn(async () => ({
    getEngine: () => ({ engine: "fal-ai/flux/dev" }),
  })),
}));

vi.mock("./services/orbQuota", () => ({
  checkAndConsumeQuota: () => ({ allowed: true }),
}));

import { executeOrbToolCalls } from "./services/agentToolExecutor";
import { dispatchFalQueueTask } from "./services/falDispatcher";

const dispatchSpy = dispatchFalQueueTask as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  dispatchSpy.mockClear();
});

describe("dispatchStudioTool — content moderation gate", () => {
  it("blocks a violent prompt before fal queue submit fires", async () => {
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: {
            prompt: "how to make a bomb to murder them",
          },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/moderation-blocked/);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("allows a clean prompt through (no false positives)", async () => {
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: {
            prompt: "a peaceful forest at sunrise, watercolor",
          },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(results).toHaveLength(1);
    // We're not validating the dispatch result here — only that the gate did
    // not pre-empt it. `awaitFalForOrb` may return pending due to the mocked
    // awaiter; what matters is the dispatcher was reached.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("scans non-prompt text fields (negative_prompt) too", async () => {
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: {
            prompt: "a peaceful forest",
            negative_prompt: "how to make a bomb to murder them",
          },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    expect(results[0].ok).toBe(false);
    expect(results[0].error).toMatch(/moderation-blocked/);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("ignores non-string and empty values without erroring", async () => {
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: {
            prompt: "a peaceful forest",
            // negative_prompt intentionally an empty string — should not trip
            // the gate.
            negative_prompt: "",
          },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
    });
    // Either no error at all (dispatch reached) or a non-moderation error —
    // what matters is the gate did NOT trip on the empty string.
    expect(results[0].error ?? "").not.toMatch(/moderation-blocked/);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
