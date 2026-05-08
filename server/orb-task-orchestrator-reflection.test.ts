/**
 * orb-task-orchestrator-reflection.test.ts — Phase 1 step reflection.
 *
 * Wires the existing pieces together as a single orchestrator-level path:
 *   tool dispatch  →  verifyToolResult fail  →  deterministic retry  →
 *   final verifier still fails  →  tool_feedback memory + result mutated
 *   to ok=false so the FSM can mark the step failed.
 *
 * Counterpart to orb-tool-result-verifier.test.ts (which only tests the
 * verifier in isolation): this test pins the integration so a future
 * refactor to the orchestrator can't silently drop reflection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCurrentStepTools } from "./services/orbTaskOrchestrator";
import {
  __unsafe_clearAllOrbMemoryForTests,
  getRecentOrbMemories,
} from "./services/orbMemory";
import type { OrbTask } from "../shared/orb-agent-contract";

// We use a non-`studio.*` tool name so the executor takes the normal HTTP
// dispatch path (which we can stub via global fetch). The verifier routes by
// name regex, so any name containing "video" / "image" still gets the right
// family check applied — that's what this test is actually pinning.
const VIDEO_TOOL_NAME = "ext.videoTool.generate";
const IMAGE_TOOL_NAME = "ext.imageTool.generate";

function makeReflectionTask(overrides: Partial<OrbTask["steps"][number]> = {}): OrbTask {
  return {
    taskId: "t_reflect",
    userId: 42,
    intent: "video reflect",
    status: "running",
    steps: [
      {
        id: "s_reflect",
        label: "video step",
        toolCalls: [
          {
            name: VIDEO_TOOL_NAME,
            args: { prompt: "a healing scene" },
            requiresApproval: false,
          },
        ],
        uiActions: [],
        ...overrides,
      },
    ],
    currentStepIndex: 0,
    needsApproval: false,
    approvedStepIds: [],
    stepApprovals: [],
    stepReports: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("Phase 1 — orchestrator step reflection", () => {
  beforeEach(() => {
    __unsafe_clearAllOrbMemoryForTests();
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
  });

  it("zero-duration video → retry with deterministic patch → still fails → tool_feedback memory written and result flipped to ok=false", async () => {
    // Provider returns a 200 with a real-looking URL but duration=0, which is
    // exactly the silent-fail mode verifyVideoFamily catches.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, url: "https://example.com/output.mp4", duration: 0 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const out = await executeCurrentStepTools({
      task: makeReflectionTask(),
      userId: 42,
      userRole: "user",
      tools: [
        {
          name: VIDEO_TOOL_NAME,
          description: "video",
          method: "POST",
          endpoint: "https://api.example.com/video",
        },
      ],
      approved: true,
    });

    // The verifier ran post-execution and flipped a 200-with-duration-0 into
    // a failure surfaced through the public ExecuteStepToolsResult.
    expect(out.attempted).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.toolResults[0]?.ok).toBe(false);
    expect(out.toolResults[0]?.error).toContain("verifier:");

    // Deterministic retry happened (initial call + at least one retry with
    // patched args), then the loop bailed out when the same payload kept
    // failing.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Memory channel: at least one `tool_feedback` row tagged with the
    // failing tool name. This is what unblocks Phase 3 (Memory RAG → Planner)
    // — without it the planner has nothing to learn from.
    const feedback = getRecentOrbMemories({
      userId: 42,
      limit: 50,
      types: ["tool_feedback"],
    });
    expect(feedback.length).toBeGreaterThan(0);
    expect(
      feedback.some(m => m.tags.includes(VIDEO_TOOL_NAME)) ||
        feedback.some(m => m.summary.includes(VIDEO_TOOL_NAME))
    ).toBe(true);
  });

  it("missing asset URL on image tool → no deterministic patch path → recovery_event + tool_feedback memories written", async () => {
    // verifyImageFamily flags this as missing-asset-url. The deterministic
    // retry patch only knows how to fix size/resolution/duration/prompt —
    // a missing URL has no auto-fix, so the loop records a recovery_event
    // and breaks out instead of retrying.
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const out = await executeCurrentStepTools({
      task: {
        ...makeReflectionTask(),
        steps: [
          {
            id: "s_reflect_img",
            label: "image step",
            toolCalls: [
              {
                name: IMAGE_TOOL_NAME,
                args: { prompt: "a calm forest" },
                requiresApproval: false,
              },
            ],
            uiActions: [],
          },
        ],
      },
      userId: 43,
      userRole: "user",
      tools: [
        {
          name: IMAGE_TOOL_NAME,
          description: "image",
          method: "POST",
          endpoint: "https://api.example.com/image",
        },
      ],
      approved: true,
    });

    expect(out.ok).toBe(false);
    expect(out.toolResults[0]?.error).toContain("verifier:missing-asset-url");

    // No deterministic retry possible → only one HTTP call.
    expect(fetchSpy.mock.calls.length).toBe(1);

    const recovery = getRecentOrbMemories({
      userId: 43,
      limit: 50,
      types: ["recovery_event"],
    });
    expect(recovery.length).toBeGreaterThan(0);

    const feedback = getRecentOrbMemories({
      userId: 43,
      limit: 50,
      types: ["tool_feedback"],
    });
    expect(feedback.length).toBeGreaterThan(0);
  });
});
