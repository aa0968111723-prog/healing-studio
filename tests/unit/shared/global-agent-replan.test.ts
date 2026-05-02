/**
 * tests/unit/shared/global-agent-replan.test.ts
 *
 * Task 2 — verify retry policy + reactive replan:
 *   1. retryPolicy.maxAttempts retries on failure before giving up.
 *   2. retryPolicy.skipOnFail continues the workflow after a step fails.
 *   3. ctx.replan replaces remaining steps with a fresh list.
 *   4. ctx.replan returning null preserves legacy abort-on-fail behaviour.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionResult,
  AgentWorkflowStep,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import { executeGlobalWorkflow } from "../../../shared/global-agent-orchestrator";

function makeCtx(overrides: Partial<GlobalAgentExecutionContext> = {}): GlobalAgentExecutionContext {
  return {
    navigate: vi.fn(),
    dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
    waitAfterNavigateMs: 0,
    ...overrides,
  };
}

describe("retry policy", () => {
  it("retries failing steps up to maxAttempts before giving up", async () => {
    let attempts = 0;
    const callTool = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) return { ok: false, reason: "transient" };
      return { ok: true, data: { ok: true } };
    });
    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "retry test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "retry me",
          toolName: "media.transcribe",
          toolArgs: { url: "x" },
          retryPolicy: { maxAttempts: 3, backoffMs: 0 },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(3);
  });

  it("returns failure once maxAttempts is exceeded", async () => {
    const callTool = vi.fn(async () => ({ ok: false, reason: "always fails" }));
    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "exhausted retries",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "fails",
          toolName: "media.transcribe",
          toolArgs: { url: "x" },
          retryPolicy: { maxAttempts: 2, backoffMs: 0 },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(res.reason).toMatch(/always fails/);
  });

  it("skipOnFail continues the workflow with the next step", async () => {
    const callTool = vi.fn(async (toolName: string) => {
      if (toolName === "media.transcribe") return { ok: false, reason: "skip me" };
      return { ok: true, data: { ok: true } };
    });
    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "skip test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "fail",
          toolName: "media.transcribe",
          toolArgs: { url: "x" },
          retryPolicy: { maxAttempts: 1, skipOnFail: true },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "still runs",
          toolName: "media.caption",
          toolArgs: { transcript: "x" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(2);
    // First result should report a skip, not a failure.
    expect(res.results[0]).toEqual(
      expect.objectContaining({ ok: true, message: expect.stringMatching(/skipped/i) })
    );
  });
});

describe("reactive replan", () => {
  it("replaces remaining steps with the replanner's output", async () => {
    const callTool = vi.fn(async (toolName: string) => {
      if (toolName === "studio.generateImage") {
        return { ok: false, reason: "image gen failed" };
      }
      return { ok: true, data: { ok: true } };
    });
    const replan = vi.fn(async (_args): Promise<AgentWorkflowStep[]> => {
      return [
        {
          id: "fallback",
          actionType: "",
          payload: "",
          label: "fallback step",
          toolName: "media.transcribe",
          toolArgs: { url: "fallback" },
        },
      ];
    });
    const ctx = makeCtx({ callTool, replan });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "replan test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "fail this",
          toolName: "studio.generateImage",
          toolArgs: { prompt: "x" },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "would have run",
          toolName: "media.caption",
          toolArgs: { transcript: "x" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(replan).toHaveBeenCalledOnce();
    // replan was given the failed step and the remaining steps.
    expect(replan).toHaveBeenCalledWith(
      expect.objectContaining({
        failedStep: expect.objectContaining({ id: "step1" }),
        failReason: expect.stringMatching(/image gen failed/),
        remainingSteps: expect.arrayContaining([
          expect.objectContaining({ id: "step2" }),
        ]),
      })
    );
    // We expected exactly the replan steps to run after step1's failure.
    const calls = callTool.mock.calls.map(c => c[0]);
    expect(calls).toEqual(["studio.generateImage", "media.transcribe"]);
  });

  it("preserves legacy abort behaviour when replan returns null", async () => {
    const callTool = vi.fn(async () => ({ ok: false, reason: "fatal" }));
    const replan = vi.fn(async () => null);
    const ctx = makeCtx({ callTool, replan });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "abort test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "no recovery",
          toolName: "studio.generateImage",
          toolArgs: { prompt: "x" },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "never runs",
          toolName: "media.caption",
          toolArgs: { transcript: "x" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(replan).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
