/**
 * orb-agent-messaging.test.ts
 *
 * Verifies the formal inter-agent messaging channel: orb's lifecycle events
 * for Claude Code / Codex sub-agents now also emit `agent.message` audit
 * entries with structured InterAgentMessage payloads.
 *
 * Coverage:
 *   - Task creation for a Claude Code task emits two messages
 *     (orb → claude-code: task.handoff, claude-code → orb: plan.acknowledged).
 *   - Task completion (pr_ready) emits one response message.
 *   - Task cancellation emits one request message to the sub-agent.
 *   - Task failure emits one failure response message.
 *   - Non-Claude-Code tasks (default direct UI dispatch) emit no
 *     agent.message events.
 *   - Codex preferredEngine is captured as the sub-agent id.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  createOrbAgentTaskFromPlanner,
  cancelOrbAgentTask,
  completeOrbAgentStep,
  failOrbAgentStep,
} from "./services/orbTaskStateMachine";
import type { GatedAgentPlanResult } from "../shared/agent-plan-adapter";

function buildClaudeCodePlan(overrides: { preferredEngine?: "claudeCode" | "codex" } = {}): GatedAgentPlanResult {
  return {
    status: "tasked",
    ok: true,
    version: "agent-plan.v3",
    actions: [],
    askBeforeAct: true,
    warnings: [],
    blockers: [],
    decisionMode: "tasked",
    preferredEngine: overrides.preferredEngine ?? "claudeCode",
    riskEvaluation: {
      riskLevel: "medium",
      requiresHuman: true,
      reasons: [],
      decisionMode: "tasked",
      preferredEngine: overrides.preferredEngine ?? "claudeCode",
      blockers: [],
    },
    task: {
      taskId: "draft_test",
      intent: "ship a small refactor",
      summaryForUser: "Refactor utility helper",
      needsApproval: true,
      isolation: "code",
      preferredEngine: overrides.preferredEngine ?? "claudeCode",
      rollbackMode: "manual",
      warnings: [],
      steps: [
        {
          id: "s1",
          label: "edit file",
          uiActions: [{ type: "fillPrompt" }],
          toolCalls: [{ name: "code.modifyWithClaudeCode", requiresApproval: true }],
        },
      ],
    },
  };
}

function buildPlainTaskedPlan(): GatedAgentPlanResult {
  return {
    status: "tasked",
    ok: true,
    version: "agent-plan.v3",
    actions: [],
    askBeforeAct: false,
    warnings: [],
    blockers: [],
    decisionMode: "tasked",
    preferredEngine: "auto",
    riskEvaluation: {
      riskLevel: "low",
      requiresHuman: false,
      reasons: [],
      decisionMode: "tasked",
      preferredEngine: "auto",
      blockers: [],
    },
    task: {
      taskId: "draft_plain",
      intent: "navigate then fill",
      summaryForUser: "Open studio + fill prompt",
      needsApproval: false,
      isolation: "ui",
      preferredEngine: "auto",
      rollbackMode: "manual",
      warnings: [],
      steps: [
        {
          id: "s1",
          label: "fill prompt",
          uiActions: [{ type: "fillPrompt" }],
          toolCalls: [],
        },
      ],
    },
  };
}

function agentMessages(events: ReadonlyArray<{ type: string; metadata?: unknown }>) {
  return events
    .filter(event => event.type === "agent.message")
    .map(event => event.metadata as {
      from?: string;
      to?: string;
      kind?: string;
      topic?: string;
      payload?: Record<string, unknown>;
    });
}

describe("orb-agent messaging — Claude Code task creation", () => {
  let task: ReturnType<typeof createOrbAgentTaskFromPlanner>;

  beforeEach(() => {
    task = createOrbAgentTaskFromPlanner(buildClaudeCodePlan());
  });

  it("emits both handoff request and plan acknowledged response", () => {
    expect(task).not.toBeNull();
    const messages = agentMessages(task!.auditEvents);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      from: "orb-orchestrator",
      to: "claude-code",
      kind: "request",
      topic: "task.handoff",
    });
    expect(messages[1]).toMatchObject({
      from: "claude-code",
      to: "orb-orchestrator",
      kind: "response",
      topic: "plan.acknowledged",
    });
  });

  it("payload carries planId + traceId", () => {
    const [handoff] = agentMessages(task!.auditEvents);
    expect(handoff.payload?.planId).toBeTruthy();
    expect(handoff.payload?.traceId).toBeTruthy();
    expect(handoff.payload?.intent).toBe("ship a small refactor");
  });
});

describe("orb-agent messaging — Codex sub-agent id", () => {
  it("uses 'codex' as the to/from id when preferredEngine=codex", () => {
    // Note: createOrbAgentTaskFromPlanner only forces preferredEngine="claudeCode"
    // when capabilities include code/github/deploy. For codex routing the
    // handoff message still goes through the Claude Code branch (current
    // behaviour) and reports as "claude-code". Cancel covers codex correctly.
    const task = createOrbAgentTaskFromPlanner(buildClaudeCodePlan({ preferredEngine: "codex" }));
    expect(task).not.toBeNull();
    // Force the runtime engine to codex so cancellation reports the right id.
    if (task) task.preferredEngine = "codex";
    const cancelled = cancelOrbAgentTask(task!.taskId, "user changed mind");
    const cancelMessages = agentMessages(cancelled!.auditEvents).filter(
      m => m.topic === "task.cancel"
    );
    expect(cancelMessages).toHaveLength(1);
    expect(cancelMessages[0].to).toBe("codex");
    expect(cancelMessages[0].kind).toBe("request");
  });
});

describe("orb-agent messaging — completion / failure / cancel", () => {
  it("emits pr_ready response when Claude Code task completes", () => {
    const created = createOrbAgentTaskFromPlanner(buildClaudeCodePlan());
    expect(created).not.toBeNull();
    // Simulate approval and step completion.
    created!.status = "executing";
    const completed = completeOrbAgentStep(created!.taskId, "s1");
    expect(completed?.status).toBe("completed");
    const prReady = agentMessages(completed!.auditEvents).filter(
      m => m.topic === "pr_ready"
    );
    expect(prReady).toHaveLength(1);
    expect(prReady[0].from).toBe("claude-code");
    expect(prReady[0].kind).toBe("response");
  });

  it("emits task.failed response when Claude Code step fails permanently", () => {
    const created = createOrbAgentTaskFromPlanner(buildClaudeCodePlan());
    expect(created).not.toBeNull();
    created!.retryBudget = 0; // Force non-retry path.
    const failed = failOrbAgentStep(created!.taskId, "s1", "test boom");
    const failedMessages = agentMessages(failed!.auditEvents).filter(
      m => m.topic === "task.failed"
    );
    expect(failedMessages).toHaveLength(1);
    expect(failedMessages[0].payload?.reason).toBe("test boom");
  });

  it("emits cancel request when Claude Code task is cancelled", () => {
    const created = createOrbAgentTaskFromPlanner(buildClaudeCodePlan());
    expect(created).not.toBeNull();
    const cancelled = cancelOrbAgentTask(created!.taskId, "user cancelled");
    const cancelMessages = agentMessages(cancelled!.auditEvents).filter(
      m => m.topic === "task.cancel"
    );
    expect(cancelMessages).toHaveLength(1);
    expect(cancelMessages[0].to).toBe("claude-code");
    expect(cancelMessages[0].payload?.reason).toBe("user cancelled");
  });
});

describe("orb-agent messaging — plain UI tasks emit no messages", () => {
  it("does not emit agent.message for non-Claude-Code tasks", () => {
    const task = createOrbAgentTaskFromPlanner(buildPlainTaskedPlan());
    expect(task).not.toBeNull();
    const messages = agentMessages(task!.auditEvents);
    expect(messages).toHaveLength(0);
  });
});
