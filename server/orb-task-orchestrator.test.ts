import { afterEach, describe, expect, it, vi } from "vitest";
import { executeCurrentStepTools } from "./services/orbTaskOrchestrator";
import type { OrbTask } from "../shared/orb-agent-contract";

const baseTask: OrbTask = {
  taskId: "t1",
  userId: 7,
  intent: "build",
  status: "running",
  steps: [
    {
      id: "s1",
      label: "tool step",
      toolCalls: [{ name: "crm.lookup", args: { id: "u_1" }, requiresApproval: false }],
      uiActions: [],
    },
  ],
  currentStepIndex: 0,
  needsApproval: false,
  approvedStepIds: [],
  createdAt: 1,
  updatedAt: 1,
};

describe("executeCurrentStepTools", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
  });

  it("returns attempted=false when no tools on current step", async () => {
    const out = await executeCurrentStepTools({
      task: { ...baseTask, steps: [{ ...baseTask.steps[0], toolCalls: [] }] },
      userId: 7,
      tools: [],
      approved: true,
    });
    expect(out).toEqual({ attempted: false, toolResults: [], ok: true });
  });

  it("runs tools and returns ok=true when all calls succeed", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const out = await executeCurrentStepTools({
      task: baseTask,
      userId: 7,
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
        },
      ],
      approved: true,
    });

    expect(out.attempted).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.toolResults[0]?.ok).toBe(true);
  });

  it("blocks execution when step requires approval and step not approved", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const out = await executeCurrentStepTools({
      task: {
        ...baseTask,
        steps: [
          {
            ...baseTask.steps[0],
            toolCalls: [
              { name: "crm.lookup", args: { id: "u_1" }, requiresApproval: true },
            ],
          },
        ],
      },
      userId: 7,
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          requireConfirmation: true,
        },
      ],
      approved: false,
    });
    expect(out.ok).toBe(false);
    expect(out.blockedByApproval).toBe(true);
    expect(out.attempted).toBe(false);
    expect(out.toolResults[0]?.error).toBe("step-approval-required");
  });
});
