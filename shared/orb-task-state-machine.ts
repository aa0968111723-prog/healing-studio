export const ORB_TASK_STATES = [
  "idle",
  "planning",
  "awaiting_approval",
  "approved",
  "executing",
  "paused",
  "recovering",
  "completed",
  "failed",
  "cancelled",
  "blocked",
] as const;

export type OrbTaskState = (typeof ORB_TASK_STATES)[number];

export interface OrbTaskAuditEvent {
  eventId: string;
  taskId: string;
  traceId: string;
  timestamp: number;
  type:
    | "task.created"
    | "task.awaiting_approval"
    | "task.approved"
    | "step.started"
    | "step.completed"
    | "step.failed"
    | "step.timeout"
    | "step.retry_scheduled"
    | "step.retry_attempted"
    | "step.rollback_pending"
    | "step.rollback_completed"
    | "step.rollback_failed"
    | "task.recovering"
    | "task.replanning"
    | "task.observed"
    | "task.continuation_started"
    | "task.completed"
    | "task.failed"
    | "task.cancelled"
    | "task.blocked"
    | "task.manual_intervention"
    | "claudeCode.requested"
    | "claudeCode.plan_created"
    | "claudeCode.pr_ready"
    | "claudeCode.failed"
    | "agent.message" // formal inter-agent messaging channel
    | "moderation.flagged"
    | "modality.mismatch";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface OrbAgentTaskStep {
  id: string;
  label: string;
  pagePath?: string;
  actionType?: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "skipped";
  requiresApproval?: boolean;
  condition?: {
    field: string;
    operator: "eq" | "neq" | "contains" | "gt" | "lt";
    value: unknown;
    onFail: "skip" | "abort" | "goto";
    gotoStepId?: string;
  };
  /** Per-step timeout in ms; orchestrator should abort the tool call after this. */
  timeoutMs?: number;
  /** How many auto-retries this step has consumed. */
  attemptCount?: number;
  /** When set, scheduler should defer the next attempt until this timestamp. */
  retryAfterAt?: number;
  /**
   * Compensation / rollback action to dispatch if this step fails permanently.
   * Server stores it as opaque `unknown` so we don't import the full
   * AgentExecutableAction type into this dep-light module; consumers cast.
   */
  compensationAction?: unknown;
  /** Status of the rollback flow for this step. */
  rollbackStatus?: "pending" | "completed" | "failed" | "skipped";
}

/**
 * Default per-step timeout. Tool calls exceeding this should be aborted via
 * AbortController so the orchestrator never hangs forever on a slow provider.
 */
export const DEFAULT_STEP_TIMEOUT_MS = 60_000;

/**
 * Compute exponential backoff delay for a retry attempt. Starts at 1s, caps
 * at 30s. The same curve as standard cloud SDKs (AWS / GCP) so it's familiar.
 */
export function computeRetryBackoffMs(attempt: number): number {
  const exp = Math.min(2 ** Math.max(0, attempt), 32) * 1_000;
  // Add a small jitter (±20%) to avoid thundering herd retries.
  const jitter = exp * (0.8 + Math.random() * 0.4);
  return Math.min(Math.round(jitter), 30_000);
}

/** Typed inter-agent message — payload of the new "agent.message" audit event. */
export interface InterAgentMessage {
  /** Sending agent identifier (e.g. "orb-orchestrator", "claude-code"). */
  from: string;
  /** Receiving agent identifier; "*" for broadcast. */
  to: string;
  kind: "request" | "response" | "broadcast";
  topic: string;
  /** Free-form payload — keep small (audit events are JSON-serialised). */
  payload?: Record<string, unknown>;
}

export interface OrbAgentTask {
  taskId: string;
  planId: string;
  traceId: string;
  /** Owning user — required so per-task chain memory + page-state can
   *  be scoped per user. Optional in the shared shape for backwards
   *  compatibility with callers that pre-date user scoping; the FSM
   *  setter populates it whenever createOrbAgentTaskFromPlanner gets
   *  the userId from the brain router. */
  userId?: number;
  intent: string;
  summaryForUser: string;
  status: OrbTaskState;
  currentStepId: string | null;
  steps: OrbAgentTaskStep[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedReason: string | null;
  approvalRequired: boolean;
  preferredEngine: string | null;
  usedMultimodalPlanner: boolean;
  warnings: string[];
  auditEvents: OrbTaskAuditEvent[];
  retryBudget: number;
  retryCount: number;
  decisionMode?: string;
  riskLevel?: string;
  capabilities?: string[];
  isolation?: "ui" | "tool" | "code";
  /** When this task was generated as a continuation/recovery of a previous
   *  task, the originating task id. Lets the UI surface the chain. */
  predecessorTaskId?: string;
  /** 0 for the initial task; 1, 2, … for each continuation. Bounded by
   *  the chain runner so the planner cannot recurse forever. */
  iterationIndex?: number;
  /** Trace id of predecessor task when this task is a continuation/replan. */
  parentTraceId?: string;
}
