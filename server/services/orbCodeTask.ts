import {
  GitHubPrUrlSchema,
  OrbCodeTaskSchema,
  type OrbCodeTask,
  type OrbCodeTaskProvider,
  type OrbCodeTaskStatus,
} from "../../shared/orb-code-task";
import { recordOrbMemory } from "./orbMemory";

const codeTaskStore = new Map<string, OrbCodeTask>();
const codeTaskTelemetry: Array<Record<string, unknown>> = [];

function id(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return Date.now();
}

function isCodeCollaborationEnabled(provider: OrbCodeTaskProvider): boolean {
  const collab = String(process.env.ENABLE_ORB_CODE_COLLABORATION ?? "true").toLowerCase();
  if (!["1", "true", "yes", "on", "enabled"].includes(collab)) return false;
  if (provider === "claudeCode") {
    const enabled = String(process.env.ENABLE_CLAUDE_CODE_TASKS ?? "true").toLowerCase();
    return ["1", "true", "yes", "on", "enabled"].includes(enabled);
  }
  if (provider === "codex") {
    const enabled = String(process.env.ENABLE_CODEX_TASKS ?? "true").toLowerCase();
    return ["1", "true", "yes", "on", "enabled"].includes(enabled);
  }
  return true;
}

function sanitizeTelemetry(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    const lower = key.toLowerCase();
    if (lower.includes("secret") || lower.includes("token") || lower.includes("apikey") || lower.includes("password")) continue;
    if (typeof value === "string" && /^data:[^;]+;base64,/i.test(value)) continue;
    out[key] = value;
  }
  return out;
}

function emitTelemetry(event: string, meta: Record<string, unknown>) {
  codeTaskTelemetry.push({ event, timestamp: now(), ...sanitizeTelemetry(meta) });
  if (codeTaskTelemetry.length > 1_000) codeTaskTelemetry.shift();
}

function canMutateStatus(task: OrbCodeTask): boolean {
  return !["merged", "cancelled", "blocked"].includes(task.status);
}

export function createOrbCodeTask(input: {
  taskId: string;
  planId: string;
  traceId: string;
  provider: OrbCodeTaskProvider;
  repository: string;
  baseBranch?: string;
  title: string;
  objective: string;
  filesAllowed?: string[];
  filesForbidden?: string[];
  acceptanceCriteria: string[];
  testCommands?: string[];
  riskLevel: "low" | "medium" | "high";
  summary: string;
  rollbackPlan: string;
}): OrbCodeTask {
  const provider = input.provider;
  const enabled = isCodeCollaborationEnabled(provider);
  const createdAt = now();
  const task = OrbCodeTaskSchema.parse({
    codeTaskId: id("code_task"),
    taskId: input.taskId,
    planId: input.planId,
    traceId: input.traceId,
    provider,
    repository: input.repository,
    branchName: `orb/${provider}/${createdAt}`,
    baseBranch: input.baseBranch ?? "main",
    status: enabled ? "awaiting_approval" : "blocked",
    title: input.title,
    objective: input.objective,
    filesAllowed: input.filesAllowed ?? [],
    filesForbidden: [
      ".env",
      ".env.local",
      "**/secrets/**",
      ...(input.filesForbidden ?? []),
    ],
    acceptanceCriteria: input.acceptanceCriteria,
    testCommands: input.testCommands ?? [],
    riskLevel: input.riskLevel,
    requiresHuman: true,
    summary: input.summary,
    rollbackPlan: input.rollbackPlan,
    createdAt,
    updatedAt: createdAt,
  });

  codeTaskStore.set(task.codeTaskId, task);
  emitTelemetry("codeTask.created", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    riskLevel: task.riskLevel,
    outcome: task.status,
  });
  return task;
}

export function getCodeTask(codeTaskId: string): OrbCodeTask | null {
  return codeTaskStore.get(codeTaskId) ?? null;
}

export function listRecentCodeTasks(limit = 20): OrbCodeTask[] {
  return Array.from(codeTaskStore.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export function approveCodeTask(codeTaskId: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || task.status !== "awaiting_approval") return task ?? null;
  task.status = "approved";
  task.updatedAt = now();
  emitTelemetry("codeTask.approved", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    riskLevel: task.riskLevel,
    outcome: "approved",
  });
  return task;
}

export function markCodeTaskRunning(codeTaskId: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || task.status !== "approved") return task ?? null;
  task.status = "running";
  task.updatedAt = now();
  emitTelemetry("codeTask.running", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    riskLevel: task.riskLevel,
    outcome: "running",
  });
  return task;
}

export function cancelCodeTask(codeTaskId: string, reason = "cancelled by user"): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || !canMutateStatus(task)) return task ?? null;
  task.status = "cancelled";
  task.updatedAt = now();
  task.summary = `${task.summary}\nCancelled: ${reason}`.slice(0, 1000);
  emitTelemetry("codeTask.cancelled", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    riskLevel: task.riskLevel,
    outcome: "cancelled",
  });
  return task;
}

export function attachCodeTaskPr(codeTaskId: string, prUrl: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || !canMutateStatus(task)) return task ?? null;
  const validUrl = GitHubPrUrlSchema.parse(prUrl);
  task.prUrl = validUrl;
  const prNumberMatch = validUrl.match(/\/pull\/(\d+)/i);
  task.prNumber = prNumberMatch ? Number(prNumberMatch[1]) : undefined;
  task.status = "pr_created";
  task.updatedAt = now();
  emitTelemetry("codeTask.pr_created", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    prNumber: task.prNumber,
    riskLevel: task.riskLevel,
    outcome: "pr_created",
  });
  return task;
}

export function markCodeTaskReviewRequired(codeTaskId: string, testStatusSummary?: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || !canMutateStatus(task)) return task ?? null;
  task.status = "review_required";
  task.testStatusSummary = testStatusSummary?.slice(0, 500);
  task.updatedAt = now();
  emitTelemetry("codeTask.review_required", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    prNumber: task.prNumber,
    riskLevel: task.riskLevel,
    outcome: "review_required",
  });
  return task;
}

export function markCodeTaskMerged(codeTaskId: string, commitSha?: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || !canMutateStatus(task)) return task ?? null;
  task.status = "merged";
  task.commitSha = commitSha?.slice(0, 64);
  task.updatedAt = now();
  emitTelemetry("codeTask.merged", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    prNumber: task.prNumber,
    riskLevel: task.riskLevel,
    outcome: "merged",
    durationMs: task.updatedAt - task.createdAt,
  });
  recordOrbMemory({
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    type: task.provider === "codex" ? "codex_task" : "claude_code_task",
    summary: `Code task merged: ${task.objective}`,
    source: "orb-code-task",
    confidence: 0.9,
    tags: [task.provider, "merged", task.riskLevel],
    metadata: {
      objective: task.objective,
      filesChanged: task.filesAllowed.slice(0, 20),
      prUrl: task.prUrl,
      outcome: "merged",
      rollbackSummary: task.rollbackPlan,
      testsRun: task.testCommands,
      riskLevel: task.riskLevel,
    },
  });
  return task;
}

export function markCodeTaskFailed(codeTaskId: string, reason: string): OrbCodeTask | null {
  const task = codeTaskStore.get(codeTaskId);
  if (!task || !canMutateStatus(task)) return task ?? null;
  task.status = "failed";
  task.updatedAt = now();
  task.summary = `${task.summary}\nFailed: ${reason}`.slice(0, 1000);
  task.traceId = `${task.traceId}_retry_${Date.now()}`;
  emitTelemetry("codeTask.failed", {
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    codeTaskId: task.codeTaskId,
    provider: task.provider,
    repo: task.repository,
    branch: task.branchName,
    prNumber: task.prNumber,
    riskLevel: task.riskLevel,
    outcome: "failed",
    durationMs: task.updatedAt - task.createdAt,
  });
  recordOrbMemory({
    traceId: task.traceId,
    planId: task.planId,
    taskId: task.taskId,
    type: task.provider === "codex" ? "codex_task" : "claude_code_task",
    summary: `Code task failed: ${reason}`,
    source: "orb-code-task",
    confidence: 0.85,
    tags: [task.provider, "failed", task.riskLevel],
    metadata: {
      objective: task.objective,
      filesChanged: task.filesAllowed.slice(0, 20),
      prUrl: task.prUrl,
      outcome: "failed",
      rollbackSummary: task.rollbackPlan,
      testsRun: task.testCommands,
      riskLevel: task.riskLevel,
    },
  });
  return task;
}

export function getCodeTaskTelemetry(limit = 200): Array<Record<string, unknown>> {
  return codeTaskTelemetry.slice(-Math.max(1, Math.min(limit, 1000)));
}

export function __unsafe_clearCodeTaskStoreForTests() {
  codeTaskStore.clear();
  codeTaskTelemetry.splice(0, codeTaskTelemetry.length);
}
