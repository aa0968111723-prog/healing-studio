import { describe, expect, it, vi } from "vitest";
import {
  observeOrbTaskOutcome,
  observationToAuditMessage,
  observationToAuditMetadata,
  type TaskObservation,
} from "../orbTaskObserver";
import type { RunOrbTaskResult } from "../orbTaskOrchestrator";
import type { OrbAgentTask } from "../../../shared/orb-task-state-machine";

function makeRunResult(
  partial: Partial<RunOrbTaskResult> = {}
): RunOrbTaskResult {
  return {
    taskId: "t1",
    outcome: "completed",
    stepsRun: 1,
    perStepToolResults: [],
    finalTask: null,
    finalAgentTask: null,
    ...partial,
  };
}

function makeAgentTask(partial: Partial<OrbAgentTask> = {}): OrbAgentTask {
  return {
    taskId: "t1",
    planId: "p1",
    traceId: "tr1",
    intent: "幫我做一支貓咪短片",
    summaryForUser: "做短片",
    status: "completed",
    currentStepId: null,
    steps: [],
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    failedReason: null,
    approvalRequired: false,
    preferredEngine: null,
    usedMultimodalPlanner: false,
    warnings: [],
    auditEvents: [],
    retryBudget: 2,
    retryCount: 0,
    ...partial,
  };
}

function stubLLM(payload: TaskObservation) {
  return vi.fn(async () => ({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  })) as unknown as Parameters<typeof observeOrbTaskOutcome>[0]["invoke"];
}

describe("orbTaskObserver", () => {
  it("returns LLM-classified complete observation", async () => {
    const observation = await observeOrbTaskOutcome({
      intent: "幫我生成一張圖",
      runResult: makeRunResult({ outcome: "completed" }),
      agentTask: makeAgentTask(),
      invoke: stubLLM({ kind: "complete", userMessage: "幫你做完了，我把成品放在右側" }),
    });
    expect(observation.kind).toBe("complete");
    if (observation.kind === "complete") {
      expect(observation.userMessage).toContain("做完");
    }
  });

  it("parses needs_user with optional suggestions", async () => {
    const observation = await observeOrbTaskOutcome({
      intent: "幫我做配音",
      runResult: makeRunResult({ outcome: "awaiting_approval" }),
      agentTask: makeAgentTask({ status: "awaiting_approval" }),
      invoke: stubLLM({
        kind: "needs_user",
        question: "你想要哪一種聲線？",
        suggestions: ["溫暖男聲", "活潑女聲"],
      }),
    });
    expect(observation.kind).toBe("needs_user");
    if (observation.kind === "needs_user") {
      expect(observation.suggestions).toEqual(["溫暖男聲", "活潑女聲"]);
    }
  });

  it("parses continue with reason + next action", async () => {
    const observation = await observeOrbTaskOutcome({
      intent: "做一支影片",
      runResult: makeRunResult({
        outcome: "failed",
        reason: "model-timeout",
        perStepToolResults: [
          { stepId: "s1", toolResults: [{ name: "video.gen", ok: false, error: "timeout" }], ok: false },
        ],
      }),
      agentTask: makeAgentTask({ status: "failed" }),
      invoke: stubLLM({
        kind: "continue",
        suggestedNextAction: "換成 Veo 重試",
        reason: "預設模型卡住超過 60 秒",
      }),
    });
    expect(observation.kind).toBe("continue");
    if (observation.kind === "continue") {
      expect(observation.suggestedNextAction).toBe("換成 Veo 重試");
    }
  });

  it("parses abort and clamps unknown failureCategory to 'unknown'", async () => {
    const observation = await observeOrbTaskOutcome({
      intent: "做圖",
      runResult: makeRunResult({ outcome: "failed", reason: "policy-blocked" }),
      agentTask: makeAgentTask({ status: "failed", failedReason: "policy-blocked" }),
      invoke: stubLLM({
        kind: "abort",
        userMessage: "這次沒辦法做完，先暫停在這裡",
        // intentionally invalid value to test the clamp
        failureCategory: "weird-thing-not-in-enum" as unknown as TaskObservation extends {
          kind: "abort";
          failureCategory: infer F;
        }
          ? F
          : never,
      }),
    });
    expect(observation.kind).toBe("abort");
    if (observation.kind === "abort") {
      expect(observation.failureCategory).toBe("unknown");
    }
  });

  it("falls back when LLM returns invalid JSON", async () => {
    const badLLM = vi.fn(async () => ({
      choices: [{ message: { content: "not-a-json" } }],
    })) as unknown as Parameters<typeof observeOrbTaskOutcome>[0]["invoke"];
    const observation = await observeOrbTaskOutcome({
      intent: "anything",
      runResult: makeRunResult({ outcome: "failed", reason: "x" }),
      agentTask: makeAgentTask({ status: "failed" }),
      invoke: badLLM,
    });
    expect(observation.kind).toBe("abort");
  });

  it("falls back when LLM throws", async () => {
    const throwingLLM = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as Parameters<typeof observeOrbTaskOutcome>[0]["invoke"];
    const observation = await observeOrbTaskOutcome({
      intent: "anything",
      runResult: makeRunResult({ outcome: "completed" }),
      agentTask: makeAgentTask({ status: "completed" }),
      invoke: throwingLLM,
    });
    expect(observation.kind).toBe("complete");
  });

  it("uses deterministic shortcut for cancelled-with-zero-steps without invoking LLM", async () => {
    const llm = vi.fn(async () => ({ choices: [{ message: { content: "{}" } }] }));
    const observation = await observeOrbTaskOutcome({
      intent: "x",
      runResult: makeRunResult({ outcome: "cancelled", stepsRun: 0 }),
      agentTask: makeAgentTask({ status: "cancelled" }),
      invoke: llm as unknown as Parameters<typeof observeOrbTaskOutcome>[0]["invoke"],
    });
    expect(observation.kind).toBe("abort");
    expect(llm).not.toHaveBeenCalled();
  });

  it("audit helpers produce stable shape", () => {
    const observation: TaskObservation = {
      kind: "complete",
      userMessage: "好了",
    };
    expect(observationToAuditMessage(observation)).toContain("complete");
    expect(observationToAuditMetadata(observation)).toEqual({ observation });
  });
});
