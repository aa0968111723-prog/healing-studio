/**
 * agent-task-priority.test.ts — AIDV-324 代理任務優先佇列測試
 *
 * Validates that createOrbAgentTaskFromPlanner correctly stores the
 * scheduling priority declared by the submitting agent and that the
 * default is "normal" when no priority is supplied.
 *
 * The Redis priority queue itself is a fire-and-forget no-op in test
 * environments (getRedisClient() returns null), so these tests focus
 * solely on the in-process OrbAgentTask.priority field.
 */

import { describe, it, expect } from "vitest";
import { createOrbAgentTaskFromPlanner } from "./services/orbTaskStateMachine";
import { parseAndGatePlan } from "../shared/agent-plan-adapter";

function buildTaskedPlan() {
  return parseAndGatePlan({
    schemaVersion: "agent-plan.v3",
    planId: "plan_priority_test",
    traceId: "trace_priority_test",
    intent: "render priority test video",
    summaryForUser: "priority test",
    decision: { mode: "tasked" },
    routing: { preferredEngine: "gemini", capabilities: ["tooling"], pageScope: "single" },
    attachments: [],
    safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
    taskPolicy: { needsApproval: false, isolation: "tool", autoStart: true },
    steps: [
      {
        id: "s1",
        label: "render",
        riskLevel: "low",
        requiresApproval: false,
        undoable: false,
        action: { type: "fillPrompt", text: "render" },
      },
    ],
    warnings: [],
  });
}

describe("createOrbAgentTaskFromPlanner — priority field (AIDV-324)", () => {
  it("defaults to 'normal' when no priority argument supplied", () => {
    const result = buildTaskedPlan();
    const task = createOrbAgentTaskFromPlanner(result);
    expect(task).not.toBeNull();
    expect(task!.priority).toBe("normal");
  });

  it("stores 'urgent' when specified", () => {
    const result = buildTaskedPlan();
    const task = createOrbAgentTaskFromPlanner(result, undefined, "urgent");
    expect(task!.priority).toBe("urgent");
  });

  it("stores 'background' when specified", () => {
    const result = buildTaskedPlan();
    const task = createOrbAgentTaskFromPlanner(result, undefined, "background");
    expect(task!.priority).toBe("background");
  });

  it("stores 'normal' when explicitly specified", () => {
    const result = buildTaskedPlan();
    const task = createOrbAgentTaskFromPlanner(result, 42, "normal");
    expect(task!.priority).toBe("normal");
    expect(task!.userId).toBe(42);
  });

  it("returns null for non-tasked plan regardless of priority", () => {
    const blockedPlan = parseAndGatePlan({
      schemaVersion: "agent-plan.v3",
      planId: "plan_blocked",
      traceId: "trace_blocked",
      intent: "something risky",
      summaryForUser: "blocked",
      decision: { mode: "blocked" },
      routing: { preferredEngine: "gemini", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "critical", requiresHuman: true, reasons: ["unsafe"] },
      taskPolicy: { needsApproval: true, isolation: "tool", autoStart: false },
      steps: [],
      warnings: [],
    });
    const task = createOrbAgentTaskFromPlanner(blockedPlan, undefined, "urgent");
    expect(task).toBeNull();
  });
});
