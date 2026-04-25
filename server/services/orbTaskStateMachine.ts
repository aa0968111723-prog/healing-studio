import type { GatedAgentPlanResult } from "../../shared/agent-plan-adapter";
import type {
  OrbAgentTask,
  OrbAgentTaskStep,
  OrbTaskAuditEvent,
} from "../../shared/orb-task-state-machine";
import { parseAndGatePlan } from "../../shared/agent-plan-adapter";
import { recordOrbTaskMemory } from "./orbTaskMemory";
import { recordOrbMemory } from "./orbMemory";

const taskStore = new Map<string, OrbAgentTask>();

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function pushEvent(
  task: OrbAgentTask,
  type: OrbTaskAuditEvent["type"],
  message: string,
  metadata?: Record<string, unknown>
) {
  task.auditEvents.push({
    eventId: id("evt"),
    taskId: task.taskId,
    traceId: task.traceId,
    timestamp: Date.now(),
    type,
    message,
    metadata,
  });
}

function now() {
  return Date.now();
}

export function createOrbAgentTaskFromPlanner(result: GatedAgentPlanResult): OrbAgentTask | null {
  if (result.status !== "tasked" || !result.task) return null;
  const plan = result.plan && typeof result.plan === "object" ? (result.plan as Record<string, unknown>) : null;
  const planId =
    typeof plan?.planId === "string" && plan.planId.trim()
      ? plan.planId
      : result.task.taskId;
  const traceId =
    typeof plan?.traceId === "string" && plan.traceId.trim()
      ? plan.traceId
      : id("trace");
  const capabilities = Array.isArray((plan?.routing as { capabilities?: unknown[] } | undefined)?.capabilities)
    ? ((plan?.routing as { capabilities?: string[] }).capabilities ?? [])
    : [];
  const claudeCodeTask =
    result.task.preferredEngine === "claudeCode" ||
    capabilities.some(cap => ["code", "github", "deploy"].includes(String(cap)));
  const approvalRequired = claudeCodeTask || result.task.needsApproval;
  const steps: OrbAgentTaskStep[] = result.task.steps.map(step => ({
    id: step.id,
    label: step.label,
    pagePath: step.pagePath,
    actionType: step.uiActions[0]?.type,
    status: "pending",
    requiresApproval: step.toolCalls.some(t => t.requiresApproval),
  }));
  const createdAt = now();
  const task: OrbAgentTask = {
    taskId: id("orb_task"),
    planId,
    traceId,
    intent: result.task.intent,
    summaryForUser: result.task.summaryForUser,
    status: approvalRequired ? "awaiting_approval" : "approved",
    currentStepId: steps[0]?.id ?? null,
    steps,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    failedReason: null,
    approvalRequired,
    preferredEngine: claudeCodeTask ? "claudeCode" : result.task.preferredEngine,
    usedMultimodalPlanner: result.preferredEngine === "gemini",
    warnings: result.task.warnings ?? [],
    auditEvents: [],
    retryBudget: 2,
    retryCount: 0,
    decisionMode: result.decisionMode,
    riskLevel: result.riskEvaluation?.riskLevel,
    capabilities,
    isolation: claudeCodeTask ? "code" : result.task.isolation,
  };
  pushEvent(task, "task.created", "Task created from planner");
  if (task.status === "awaiting_approval") {
    pushEvent(task, "task.awaiting_approval", "Task requires approval");
  }
  if (claudeCodeTask) {
    pushEvent(task, "claudeCode.requested", "Claude Code task requested");
    pushEvent(task, "claudeCode.plan_created", "Claude Code plan created");
  }
  taskStore.set(task.taskId, task);
  return task;
}

export function getOrbAgentTask(taskId: string): OrbAgentTask | null {
  return taskStore.get(taskId) ?? null;
}

export function listRecentOrbAgentTasks(limit = 20): OrbAgentTask[] {
  return Array.from(taskStore.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export function approveOrbAgentTask(taskId: string): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task || task.status === "cancelled" || task.status === "completed") return task ?? null;
  task.status = "approved";
  task.updatedAt = now();
  pushEvent(task, "task.approved", "Task approved by user");
  if (task.steps.length > 0) {
    task.status = "executing";
    task.steps[0].status = "running";
    task.currentStepId = task.steps[0].id;
    pushEvent(task, "step.started", `Step started: ${task.steps[0].label}`, {
      stepId: task.steps[0].id,
    });
  }
  return task;
}

export function cancelOrbAgentTask(taskId: string, reason = "cancelled by user"): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  task.status = "cancelled";
  task.failedReason = reason;
  task.completedAt = now();
  task.updatedAt = task.completedAt;
  pushEvent(task, "task.cancelled", reason);
  recordOrbTaskMemory({
    taskId: task.taskId,
    planId: task.planId,
    traceId: task.traceId,
    userIntent: task.intent,
    outcome: "cancelled",
    failedReason: reason,
    usedEngine: task.preferredEngine,
    usedMultimodalPlanner: task.usedMultimodalPlanner,
    actionTypes: task.steps.map(s => s.actionType ?? "unknown"),
    createdAt: task.updatedAt,
  });
  return task;
}

export function completeOrbAgentStep(taskId: string, stepId: string): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task || task.status === "cancelled") return task ?? null;
  const index = task.steps.findIndex(step => step.id === stepId);
  if (index < 0) return task;
  task.steps[index].status = "completed";
  pushEvent(task, "step.completed", `Step completed: ${task.steps[index].label}`, { stepId });
  const next = task.steps[index + 1];
  if (next) {
    next.status = "running";
    task.currentStepId = next.id;
    task.status = "executing";
    pushEvent(task, "step.started", `Step started: ${next.label}`, { stepId: next.id });
  } else {
    task.currentStepId = null;
    task.status = "completed";
    task.completedAt = now();
    pushEvent(task, "task.completed", "Task completed");
    if (task.preferredEngine === "claudeCode") {
      pushEvent(task, "claudeCode.pr_ready", "Claude Code result ready");
    }
    recordOrbTaskMemory({
      taskId: task.taskId,
      planId: task.planId,
      traceId: task.traceId,
      userIntent: task.intent,
      outcome: "success",
      usedEngine: task.preferredEngine,
      usedMultimodalPlanner: task.usedMultimodalPlanner,
      actionTypes: task.steps.map(s => s.actionType ?? "unknown"),
      createdAt: task.completedAt ?? now(),
    });
    recordOrbMemory({
      traceId: task.traceId,
      planId: task.planId,
      taskId: task.taskId,
      type: "successful_workflow",
      summary: `Workflow completed: ${task.summaryForUser}`,
      source: "orb-task-state-machine",
      confidence: 0.9,
      tags: ["workflow", "success", ...(task.capabilities ?? [])],
      metadata: {
        actionTypes: task.steps.map(s => s.actionType ?? "unknown"),
        usedEngine: task.preferredEngine,
        usedMultimodalPlanner: task.usedMultimodalPlanner,
        finalOutcome: "success",
        durationMs: Math.max(0, (task.completedAt ?? now()) - task.createdAt),
      },
    });
    if (task.preferredEngine === "claudeCode") {
      recordOrbMemory({
        traceId: task.traceId,
        planId: task.planId,
        taskId: task.taskId,
        type: "claude_code_task",
        summary: "Claude Code task completed",
        source: "orb-task-state-machine",
        confidence: 0.92,
        tags: ["claudeCode", "task-history"],
        metadata: {
          filesChanged: task.steps.length,
          prUrl: task.auditEvents.find(event => event.type === "claudeCode.pr_ready")?.metadata?.prUrl,
          riskLevel: task.riskLevel ?? "unknown",
          rollbackSummary: "Use revert + redeploy if regression appears.",
        },
      });
    }
  }
  task.updatedAt = now();
  return task;
}

export function failOrbAgentStep(taskId: string, stepId: string, reason: string): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  const step = task.steps.find(s => s.id === stepId);
  if (step) step.status = "failed";
  task.status = "failed";
  task.failedReason = reason;
  task.updatedAt = now();
  pushEvent(task, "step.failed", `Step failed: ${step?.label ?? stepId}`, { stepId, reason });
  pushEvent(task, "task.failed", reason);
  if (task.preferredEngine === "claudeCode") {
    pushEvent(task, "claudeCode.failed", reason);
  }
  recordOrbTaskMemory({
    taskId: task.taskId,
    planId: task.planId,
    traceId: task.traceId,
    userIntent: task.intent,
    outcome: "failure",
    failedReason: reason,
    usedEngine: task.preferredEngine,
    usedMultimodalPlanner: task.usedMultimodalPlanner,
    actionTypes: task.steps.map(s => s.actionType ?? "unknown"),
    createdAt: task.updatedAt,
  });
  recordOrbMemory({
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    type: "failed_workflow",
    summary: `Workflow failed: ${reason}`,
    source: "orb-task-state-machine",
    confidence: 0.9,
    tags: ["workflow", "failed"],
    metadata: {
      failedStepId: stepId,
      failedReason: reason,
      usedEngine: task.preferredEngine,
      recoveryAttempted: task.retryCount > 0,
    },
  });
  if (task.preferredEngine === "claudeCode") {
    recordOrbMemory({
      traceId: task.traceId,
      planId: task.planId,
      taskId: task.taskId,
      type: "claude_code_task",
      summary: "Claude Code task failed",
      source: "orb-task-state-machine",
      confidence: 0.88,
      tags: ["claudeCode", "failed"],
      metadata: {
        riskLevel: task.riskLevel ?? "unknown",
        rollbackSummary: "Fallback to previous known-good branch.",
      },
    });
  }
  return task;
}

export function retryOrbAgentTask(
  taskId: string,
  opts: { enableRecovery?: boolean } = {}
): { task: OrbAgentTask | null; recoveryPlan?: GatedAgentPlanResult | null } {
  const task = taskStore.get(taskId);
  if (!task) return { task: null, recoveryPlan: null };
  if (task.status === "blocked" || task.status === "cancelled") {
    return { task, recoveryPlan: null };
  }
  if (task.retryBudget <= 0) {
    task.status = "recovering";
    task.updatedAt = now();
    pushEvent(task, "task.recovering", "Retry budget exhausted, entering recovery");
    if (opts.enableRecovery) {
      const recoveryPlan = parseAndGatePlan({
        schemaVersion: "agent-plan.v3",
        planId: id("recovery_plan"),
        traceId: task.traceId,
        intent: `${task.intent}（recovery）`,
        summaryForUser: "我需要你確認修復方案後再繼續。",
        decision: { mode: "clarification", reason: "retry exhausted" },
        clarificationQuestion: `上一個步驟失敗（${task.failedReason ?? "unknown"}），是否改用保守修復策略？`,
        routing: {
          preferredEngine: task.preferredEngine === "claudeCode" ? "claudeCode" : "auto",
          capabilities: task.capabilities ?? [],
          pageScope: "single",
        },
        attachments: [],
        safety: {
          riskLevel: "medium",
          requiresHuman: true,
          reasons: ["retry_budget_exhausted"],
        },
        steps: [],
        warnings: [`failedStep=${task.currentStepId ?? "unknown"}`],
      });
      return { task, recoveryPlan };
    }
    return { task, recoveryPlan: null };
  }
  task.retryBudget -= 1;
  task.retryCount += 1;
  task.status = task.approvalRequired ? "awaiting_approval" : "approved";
  task.updatedAt = now();
  pushEvent(task, "task.approved", "Task retried");
  return { task, recoveryPlan: null };
}

export function getOrbAgentTaskEvents(taskId: string): OrbTaskAuditEvent[] {
  return taskStore.get(taskId)?.auditEvents ?? [];
}
