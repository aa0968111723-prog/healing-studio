import { describe, expect, it, vi } from "vitest";
import { executeClosedLoopPlan, type ClosedLoopContext, type PlanStep } from "../../../shared/closed-loop-plan";

function step(goal: string, action: string, inputs: Record<string, unknown> = {}): PlanStep {
  return { goal, action, target: "/pro-studio", inputs, success_criteria: "step success", fallback: "ask user" };
}

describe("cross-page golden path (closed loop)", () => {
  it("success path: planner replans each step from fresh observations", async () => {
    const planNextStep = vi
      .fn<ClosedLoopContext["planNextStep"]>()
      .mockImplementation(async ({ previousObservations }) => {
        if (previousObservations.length === 0) return step("make video", "navigate");
        if (previousObservations.length === 1) return step("make video", "submit", { prompt: "calm tea" });
        return null;
      });
    const executePlanStep = vi
      .fn<ClosedLoopContext["executePlanStep"]>()
      .mockResolvedValueOnce({ ok: true, evidence: "navigated", outputRefId: "nav-1" })
      .mockResolvedValueOnce({ ok: true, evidence: "submitted", outputRefId: "gen-1" });

    const out = await executeClosedLoopPlan({ goal: "make video", ctx: { planNextStep, executePlanStep } });
    expect(out.ok).toBe(true);
    expect(out.observations).toHaveLength(2);
    expect(planNextStep).toHaveBeenCalledTimes(3);
    expect(planNextStep.mock.calls[1][0].previousObservations[0].outputRefId).toBe("nav-1");
  });

  it("missing required field: executor rejects and returns failed observation", async () => {
    const out = await executeClosedLoopPlan({
      goal: "make video",
      ctx: {
        planNextStep: async () => step("make video", "submit", { prompt: "" }),
        executePlanStep: async (s) => ({ ok: Boolean(String(s.inputs?.prompt ?? "").trim()), evidence: "missing prompt" }),
      },
      maxSteps: 3,
    });
    expect(out.ok).toBe(false);
    expect(out.observations[0].success).toBe(false);
  });

  it("slow external api: observation carries evidence + ref id for planner context", async () => {
    const onObservation = vi.fn();
    const out = await executeClosedLoopPlan({
      goal: "call external api",
      ctx: {
        planNextStep: async ({ previousObservations }) => previousObservations.length ? null : step("call external api", "studio.generateVideo"),
        executePlanStep: async () => ({ ok: false, evidence: "external api timeout after 30s", outputRefId: "api-timeout-1" }),
        onObservation,
      },
    });
    expect(out.ok).toBe(false);
    expect(out.observations[0]).toEqual(expect.objectContaining({ outputRefId: "api-timeout-1" }));
    expect(onObservation).toHaveBeenCalledOnce();
  });
});
