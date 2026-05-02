/**
 * tests/unit/shared/global-agent-tool-call.test.ts
 *
 * Task 1 — verify the orchestrator's tool-call execution path:
 *   1. A workflow step with `toolName` routes to ctx.callTool, NOT ctx.dispatch.
 *   2. `${stepN.key}` placeholders in toolArgs resolve against
 *      perStepToolResults captured from prior tool calls.
 *   3. UI dispatch path remains untouched for steps without toolName
 *      (backward compatibility).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentAction,
  AgentActionResult,
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

describe("tool-call execution path", () => {
  it("routes a step with toolName through ctx.callTool", async () => {
    const callTool = vi.fn(async () => ({
      ok: true,
      data: { request_id: "fal-1", video_url: "https://cdn/video.mp4" },
    }));
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ callTool, dispatch });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "tool-call test",
      steps: [
        {
          id: "gen",
          path: "/studio",
          actionType: "",
          payload: "",
          label: "generate video",
          toolName: "studio.generateVideo",
          toolArgs: { prompt: "a cat" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(callTool).toHaveBeenCalledOnce();
    expect(callTool).toHaveBeenCalledWith("studio.generateVideo", { prompt: "a cat" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("substitutes ${stepN.key} placeholders against prior tool results", async () => {
    const callTool = vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === "studio.generateVideo") {
        return { ok: true, data: { video_url: "https://cdn/video.mp4", duration: 30 } };
      }
      // enhance step — assert resolver gave us the real video_url
      expect(args).toEqual({
        video_url: "https://cdn/video.mp4",
        operation: "upscale",
      });
      return { ok: true, data: { upscaled_url: "https://cdn/video-4k.mp4" } };
    });

    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "step-ref test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "generate",
          toolName: "studio.generateVideo",
          toolArgs: { prompt: "scene" },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "enhance",
          toolName: "studio.enhanceVideo",
          toolArgs: {
            video_url: "${step1.video_url}",
            operation: "upscale",
          },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("falls back to UI dispatch when step has no toolName (backward compat)", async () => {
    const callTool = vi.fn();
    const dispatch = vi.fn(async (action: AgentAction): Promise<AgentActionResult> => {
      expect(action.type).toBe("fillPrompt");
      return { ok: true };
    });
    const ctx = makeCtx({ callTool, dispatch });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "dispatch test",
      steps: [
        {
          path: "/studio",
          actionType: "fillPrompt",
          payload: "hello",
          label: "fill",
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(callTool).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("surfaces a typed failure when callTool is missing but step needs it", async () => {
    const ctx = makeCtx({ callTool: undefined });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "missing-hook test",
      steps: [
        {
          id: "x",
          actionType: "",
          payload: "",
          label: "no hook",
          toolName: "studio.generateImage",
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/callTool/);
  });

  it("propagates callTool throwing errors as a failure result", async () => {
    const callTool = vi.fn(async () => {
      throw new Error("boom");
    });
    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "throw test",
      steps: [
        {
          id: "x",
          actionType: "",
          payload: "",
          label: "throws",
          toolName: "studio.generateImage",
          toolArgs: { prompt: "test" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/boom/);
  });

  it("uses toolResultBinding as the perStepToolResults key when provided", async () => {
    const captured: Record<string, unknown>[] = [];
    const callTool = vi.fn(async (_name, args: Record<string, unknown>) => {
      captured.push(args);
      return { ok: true, data: { value: "abc" } };
    });
    const ctx = makeCtx({ callTool });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "binding test",
      steps: [
        {
          id: "raw_id",
          actionType: "",
          payload: "",
          label: "first",
          toolName: "media.transcribe",
          toolArgs: { url: "https://cdn/a" },
          toolResultBinding: "voice",
        },
        {
          id: "follow",
          actionType: "",
          payload: "",
          label: "second",
          toolName: "media.caption",
          toolArgs: { transcript: "${voice.value}" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(captured[1]).toEqual({ transcript: "abc" });
  });
});
