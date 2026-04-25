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
    | "task.recovering"
    | "task.completed"
    | "task.failed"
    | "task.cancelled"
    | "task.blocked"
    | "claudeCode.requested"
    | "claudeCode.plan_created"
    | "claudeCode.pr_ready"
    | "claudeCode.failed";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface OrbAgentTaskStep {
  id: string;
  label: string;
  pagePath?: string;
  actionType?: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  requiresApproval?: boolean;
}

export interface OrbAgentTask {
  taskId: string;
  planId: string;
  traceId: string;
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
}
