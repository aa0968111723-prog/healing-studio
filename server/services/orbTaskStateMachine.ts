import type { GatedAgentPlanResult } from "../../shared/agent-plan-adapter";
import type {
  OrbAgentTask,
  OrbAgentTaskStep,
  OrbTaskAuditEvent,
  InterAgentMessage,
} from "../../shared/orb-task-state-machine";
import {
  computeRetryBackoffMs,
  DEFAULT_STEP_TIMEOUT_MS,
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
  const structuredMetadata = {
    trace_id: task.traceId,
    step_id: typeof metadata?.stepId === "string" ? metadata.stepId : null,
    action:
      typeof metadata?.action === "string"
        ? metadata.action
        : type.startsWith("step.")
          ? type
          : `task.${type.split(".").at(-1) ?? "event"}`,
    input_hash: typeof metadata?.input_hash === "string" ? metadata.input_hash : null,
    latency_ms: typeof metadata?.latency_ms === "number" ? metadata.latency_ms : null,
    error_code:
      typeof metadata?.error_code === "string"
        ? metadata.error_code
        : type.includes("failed")
          ? "step_failed"
          : null,
    retry_count: typeof metadata?.retry_count === "number" ? metadata.retry_count : task.retryCount,
  };
  task.auditEvents.push({
    eventId: id("evt"),
    taskId: task.taskId,
    traceId: task.traceId,
    timestamp: Date.now(),
    type,
    message,
    metadata: { ...structuredMetadata, ...(metadata ?? {}) },
  });
}

function now() {
  return Date.now();
}

export function createOrbAgentTaskFromPlanner(
  result: GatedAgentPlanResult,
  /**
   * Owning user. Optional for backwards compatibility with the small
   * number of test/scaffold call sites that don't have a user; real
   * brain-router callers MUST pass it so chain memory + per-user
   * observer queries stay scoped.
   */
  userId?: number
): OrbAgentTask | null {
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
  // Trust the safety evaluator's verdict (already accounts for actual step
  // toolNames vs hallucinated capability strings). Re-deriving from raw
  // capabilities here was forcing media plans whose planner LLM declared
  // routing.capabilities=["code"] back into claudeCode handoff even after
  // agent-plan-safety demoted them — exactly the 全站光球代理 misroute
  // that stalled the Pu'er-tea video flow.
  const claudeCodeTask =
    result.task.preferredEngine === "claudeCode" ||
    result.task.isolation === "code";
  const approvalRequired = claudeCodeTask || result.task.needsApproval;
  const steps: OrbAgentTaskStep[] = result.task.steps.map(step => ({
    id: step.id,
    label: step.label,
    pagePath: step.pagePath,
    actionType: step.uiActions[0]?.type,
    status: "pending",
    requiresApproval: step.toolCalls.some(t => t.requiresApproval),
    condition: step.condition,
    // Propagate rollback + timeout hints from the plan into the task so
    // failOrbAgentStep + runStepWithTimeout can act on them at runtime.
    compensationAction: step.compensationAction,
    timeoutMs: step.timeoutMs,
  }));
  const createdAt = now();
  const task: OrbAgentTask = {
    taskId: id("orb_task"),
    planId,
    traceId,
    userId,
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
    const subAgentId =
      task.preferredEngine === "claudeCode" ? "claude-code" : String(task.preferredEngine ?? "claude-code");
    pushEvent(task, "claudeCode.requested", "Claude Code task requested");
    // Inter-agent channel: orb formally hands the task off to the sub-agent.
    pushEvent(task, "agent.message", `orb-orchestrator → ${subAgentId} :: request/task.handoff`, {
      from: "orb-orchestrator",
      to: subAgentId,
      kind: "request",
      topic: "task.handoff",
      payload: {
        planId: task.planId,
        traceId: task.traceId,
        intent: task.intent,
        riskLevel: task.riskLevel,
        capabilities: task.capabilities,
      },
    });
    pushEvent(task, "claudeCode.plan_created", "Claude Code plan created");
    pushEvent(task, "agent.message", `${subAgentId} → orb-orchestrator :: response/plan.acknowledged`, {
      from: subAgentId,
      to: "orb-orchestrator",
      kind: "response",
      topic: "plan.acknowledged",
      payload: { planId: task.planId, traceId: task.traceId },
    });
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
  if (task.preferredEngine === "claudeCode" || task.preferredEngine === "codex") {
    const subAgentId = task.preferredEngine === "codex" ? "codex" : "claude-code";
    pushEvent(task, "agent.message", `orb-orchestrator → ${subAgentId} :: request/task.cancel`, {
      from: "orb-orchestrator",
      to: subAgentId,
      kind: "request",
      topic: "task.cancel",
      payload: { taskId: task.taskId, reason },
    });
  }
  recordOrbTaskMemory({
    taskId: task.taskId,
    planId: task.planId,
    traceId: task.traceId,
    userId: task.userId,
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
    const previousOutput = task.auditEvents
      .filter(event => event.type === "step.completed")
      .map(event => event.metadata?.output)
      .at(-1);
    const condition = next.condition;
    const readField = (obj: unknown, path: string): unknown =>
      path.split(".").reduce<unknown>((acc, key) => {
        if (!acc || typeof acc !== "object") return undefined;
        return (acc as Record<string, unknown>)[key];
      }, obj);
    const evaluate = (): boolean => {
      if (!condition) return true;
      const left = readField({ previousStep: { output: previousOutput } }, condition.field);
      const right = condition.value;
      switch (condition.operator) {
        case "eq": return left === right;
        case "neq": return left !== right;
        case "contains": return typeof left === "string" && String(left).includes(String(right));
        case "gt": return Number(left) > Number(right);
        case "lt": return Number(left) < Number(right);
        default: return false;
      }
    };
    const passed = evaluate();
    if (!passed && condition) {
      if (condition.onFail === "abort") {
        return failOrbAgentStep(taskId, next.id, "condition-failed");
      }
      if (condition.onFail === "skip") {
        next.status = "skipped";
        pushEvent(task, "step.completed", `Step skipped by condition: ${next.label}`, { stepId: next.id, skipped: true });
        const afterSkipped = task.steps[index + 2];
        if (afterSkipped) {
          afterSkipped.status = "running";
          task.currentStepId = afterSkipped.id;
          task.status = "executing";
          pushEvent(task, "step.started", `Step started: ${afterSkipped.label}`, { stepId: afterSkipped.id });
        } else {
          task.currentStepId = null;
          task.status = "completed";
          task.completedAt = now();
          pushEvent(task, "task.completed", "Task completed");
        }
      } else if (condition.onFail === "goto" && condition.gotoStepId) {
        const goto = task.steps.find(step => step.id === condition.gotoStepId);
        if (!goto) return failOrbAgentStep(taskId, next.id, "condition-failed");
        goto.status = "running";
        task.currentStepId = goto.id;
        task.status = "executing";
        pushEvent(task, "step.started", `Step started: ${goto.label}`, { stepId: goto.id, via: "condition-goto" });
      }
    } else {
      next.status = "running";
      task.currentStepId = next.id;
      task.status = "executing";
      pushEvent(task, "step.started", `Step started: ${next.label}`, { stepId: next.id });
    }
  } else {
    task.currentStepId = null;
    task.status = "completed";
    task.completedAt = now();
    pushEvent(task, "task.completed", "Task completed");
    if (task.preferredEngine === "claudeCode") {
      pushEvent(task, "claudeCode.pr_ready", "Claude Code result ready");
      // Sub-agent reports completion back to orb-orchestrator.
      pushEvent(task, "agent.message", "claude-code → orb-orchestrator :: response/pr_ready", {
        from: "claude-code",
        to: "orb-orchestrator",
        kind: "response",
        topic: "pr_ready",
        payload: { taskId: task.taskId, planId: task.planId, traceId: task.traceId },
      });
    }
    recordOrbTaskMemory({
      taskId: task.taskId,
      planId: task.planId,
      traceId: task.traceId,
      userId: task.userId,
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

export function failOrbAgentStep(
  taskId: string,
  stepId: string,
  reason: string,
  opts: { allowAutoRetry?: boolean; isTimeout?: boolean } = {}
): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  const step = task.steps.find(s => s.id === stepId);
  if (opts.isTimeout) {
    pushEvent(task, "step.timeout", `Step timed out: ${step?.label ?? stepId}`, {
      stepId,
      reason,
    });
  }

  // Gap 19 + Gap 6: try automatic retry with exponential backoff before
  // declaring the whole task failed. Caller opts in via `allowAutoRetry` so
  // legacy code paths that explicitly want a hard failure still work.
  if (opts.allowAutoRetry && step && task.retryBudget > 0) {
    const attempt = (step.attemptCount ?? 0) + 1;
    const delayMs = computeRetryBackoffMs(attempt);
    step.attemptCount = attempt;
    step.retryAfterAt = now() + delayMs;
    step.status = "pending";
    task.retryBudget -= 1;
    task.retryCount += 1;
    task.updatedAt = now();
    pushEvent(
      task,
      "step.retry_scheduled",
      `Retry scheduled for ${step.label ?? stepId}`,
      { stepId, reason, attempt, delayMs, retryBudgetRemaining: task.retryBudget }
    );
    return task;
  }

  if (step) step.status = "failed";
  task.status = "failed";
  task.failedReason = reason;
  task.updatedAt = now();
  pushEvent(task, "step.failed", `Step failed: ${step?.label ?? stepId}`, { stepId, reason });
  // Gap 14: emit a rollback_pending event so the client orchestrator can
  // dispatch the compensation action. We never auto-execute it here because
  // compensation actions touch UI state — that work belongs on the client.
  if (step && step.compensationAction) {
    step.rollbackStatus = "pending";
    pushEvent(
      task,
      "step.rollback_pending",
      `Rollback queued for ${step.label ?? stepId}`,
      {
        stepId,
        compensationAction: step.compensationAction,
        reason,
      }
    );
  }
  pushEvent(task, "task.failed", reason);
  if (task.preferredEngine === "claudeCode") {
    pushEvent(task, "claudeCode.failed", reason);
    // Sub-agent reports failure on the formal channel; downstream
    // observability tooling can react to agent.message instead of having to
    // know the legacy claudeCode.* event types.
    pushEvent(task, "agent.message", "claude-code → orb-orchestrator :: response/task.failed", {
      from: "claude-code",
      to: "orb-orchestrator",
      kind: "response",
      topic: "task.failed",
      payload: { taskId: task.taskId, planId: task.planId, traceId: task.traceId, reason },
    });
  }
  recordOrbTaskMemory({
    taskId: task.taskId,
    planId: task.planId,
    traceId: task.traceId,
    userId: task.userId,
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

/**
 * Run an async step body under a timeout. The orchestrator passes its own
 * AbortController so the underlying tool call can hard-cancel; this helper
 * resolves the race against `setTimeout` and reports timeouts via
 * `failOrbAgentStep(..., { isTimeout: true, allowAutoRetry: true })`.
 */
export async function runStepWithTimeout<T>(args: {
  taskId: string;
  stepId: string;
  timeoutMs?: number;
  body: (signal: AbortSignal) => Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; reason: string; timedOut: boolean }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const value = await args.body(controller.signal);
    clearTimeout(timer);
    return { ok: true, value };
  } catch (err) {
    clearTimeout(timer);
    const reason = err instanceof Error ? err.message : String(err);
    if (timedOut) {
      failOrbAgentStep(args.taskId, args.stepId, `step timeout (${timeoutMs}ms)`, {
        isTimeout: true,
        allowAutoRetry: true,
      });
      return { ok: false, reason: `timeout after ${timeoutMs}ms`, timedOut: true };
    }
    return { ok: false, reason, timedOut: false };
  }
}

/**
 * Mark the rollback flow for a failed step as completed / failed / skipped.
 * Called by the front-end orchestrator after it dispatches the compensation
 * action defined on the step. Safe to call even if no rollback was queued —
 * just no-ops in that case.
 */
export function markStepRollback(
  taskId: string,
  stepId: string,
  status: "completed" | "failed" | "skipped",
  reason?: string
): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  const step = task.steps.find(s => s.id === stepId);
  if (!step) return task;
  step.rollbackStatus = status;
  task.updatedAt = now();
  const eventType =
    status === "completed"
      ? "step.rollback_completed"
      : status === "failed"
      ? "step.rollback_failed"
      : "step.rollback_completed";
  pushEvent(task, eventType, `Rollback ${status} for ${step.label ?? stepId}`, {
    stepId,
    rollbackStatus: status,
    reason,
  });
  return task;
}

/**
 * Record an inter-agent message in the task's audit log. Messages between the
 * orb orchestrator and sub-agents (Claude Code, Codex, future tool agents) go
 * through this single channel so the audit trail captures every cross-agent
 * exchange.
 */
export function recordAgentMessage(
  taskId: string,
  message: InterAgentMessage
): OrbAgentTask | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  const summary = `${message.from} → ${message.to} :: ${message.kind}/${message.topic}`;
  pushEvent(task, "agent.message", summary, {
    from: message.from,
    to: message.to,
    kind: message.kind,
    topic: message.topic,
    payload: message.payload,
  });
  task.updatedAt = now();
  return task;
}

export function getOrbAgentTaskEvents(taskId: string): OrbTaskAuditEvent[] {
  return taskStore.get(taskId)?.auditEvents ?? [];
}

/**
 * Append a single audit event to an existing FSM task. Returns the new event
 * (with generated `eventId` / `timestamp`) or null if the task is unknown.
 *
 * Use this for cross-cutting layers (e.g. orbTaskObserver) that need to add
 * structured events without owning the full pushEvent / lifecycle machinery.
 * Caller chooses the event `type` from the existing audit-event union.
 */
export function appendOrbAgentTaskAuditEvent(
  taskId: string,
  type: OrbTaskAuditEvent["type"],
  message: string,
  metadata?: Record<string, unknown>
): OrbTaskAuditEvent | null {
  const task = taskStore.get(taskId);
  if (!task) return null;
  pushEvent(task, type, message, metadata);
  task.updatedAt = now();
  return task.auditEvents[task.auditEvents.length - 1] ?? null;
}

/**
 * Mark a task as a continuation of another task. Used by the chain runner
 * when the post-mortem observer says "continue" and the planner produces
 * a recovery plan; the new task gets linked back to its predecessor so the
 * UI can render the chain and metrics can group runs by root task id.
 *
 * Idempotent — calling twice with the same predecessor is a no-op.
 */
export function linkOrbAgentTaskPredecessor(
  newTaskId: string,
  predecessorTaskId: string,
  iterationIndex: number,
  parentTraceId?: string
): OrbAgentTask | null {
  const task = taskStore.get(newTaskId);
  if (!task) return null;
  task.predecessorTaskId = predecessorTaskId;
  task.iterationIndex = iterationIndex;
  task.parentTraceId = parentTraceId;
  task.updatedAt = now();
  return task;
}
