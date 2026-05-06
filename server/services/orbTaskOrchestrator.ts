import type { OrbTask } from "../../shared/orb-agent-contract";
import type {
  OrbAgentTask,
  OrbTaskAuditEvent,
} from "../../shared/orb-task-state-machine";
import type { OrbApiTool, OrbToolCallResult } from "./agentToolExecutor";
import { executeOrbToolCalls } from "./agentToolExecutor";
import { resolveStepRefsInArgs } from "../../shared/orb-step-ref-resolver";
import { verifyToolResult } from "../../shared/orb-tool-result-verifier";
import {
  appendOrbAgentTaskAuditEvent,
  completeOrbAgentStep,
  failOrbAgentStep,
  getOrbAgentTask,
} from "./orbTaskStateMachine";
import { orbTaskStore as defaultOrbTaskStore } from "./orbTaskStore";
import type { OrbTaskStore } from "./orbTaskStore";
import type { AgentPreferences } from "../../shared/agent-preferences";
import { emitGenerationEvent } from "../generationEvents";
import { recordOrbMemory } from "./orbMemory";
import {
  classifyOrbStepError,
  recoveryActionFor,
  type OrbRecoveryAction,
  type OrbStepErrorCode,
} from "./orbTaskRecoveryPolicy";
import { createHash } from "crypto";

// ─── Single-step executor (existing public contract) ──────────────────────

export interface ExecuteStepToolsInput {
  task: OrbTask;
  userId: number;
  userRole: string;
  tools: OrbApiTool[];
  approved: boolean;
  requestId?: string;
  traceId?: string;
  onAuditEvent?: (event: {
    requestId: string;
    userId: number;
    userRole: string;
    taskId?: string;
    stepId?: string;
    toolName: string;
    usedTool?: string;
    ok: boolean;
    status?: number;
    error?: string;
    attempts?: number;
    startedAt: number;
    endedAt: number;
  }) => void;
  agentPreferences?: AgentPreferences;
  autoApprovedStepsInRun?: number;
  /**
   * Cumulative tool results from earlier steps in this run. The current
   * step's `toolArgs` are walked through `resolveStepRefsInArgs` so the
   * planner can chain outputs (e.g. `${step1.video_url}` for a follow-up
   * upscale or caption call).
   */
  perStepToolResults?: Array<{
    stepId: string;
    toolResults: OrbToolCallResult[];
  }>;
  onRequestReplan?: (payload: {
    taskId: string;
    stepId: string;
    toolName: string;
    observation: ToolFailureObservation;
    reason: string;
  }) => Promise<void> | void;
  stepRetryBudget?: number;
}

interface ToolFailureObservation {
  toolName: string;
  errorCode: string;
  issues: string[];
  toolArgs: unknown;
}

interface DeterministicRetryPatch {
  args: Record<string, unknown>;
  reason: string;
}

function sanitizeToolArgsForRetry(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {};
}

function buildDeterministicRetryPatch(toolArgs: unknown, issues: string[]): DeterministicRetryPatch | null {
  const args = sanitizeToolArgsForRetry(toolArgs);
  const lowerIssues = issues.map(issue => issue.toLowerCase());
  let changed = false;
  if ((args.image_size === undefined && args.resolution === undefined) && lowerIssues.some(issue => issue.includes("resolution") || issue.includes("size"))) {
    args.image_size = "1024x1024";
    changed = true;
  }
  if (args.duration === undefined && lowerIssues.some(issue => issue.includes("duration") || issue.includes("length"))) {
    args.duration = 5;
    changed = true;
  }
  if ((args.prompt === undefined || args.prompt === "") && lowerIssues.some(issue => issue.includes("prompt") || issue.includes("required"))) {
    args.prompt = "high quality output";
    changed = true;
  }
  if (!changed) return null;
  return { args, reason: "deterministic-args-normalization" };
}

function recordRetryAuditAndMemory(input: ExecuteStepToolsInput, stepId: string, kind: "tool_feedback" | "recovery_event", message: string, metadata: Record<string, unknown>): void {
  appendOrbAgentTaskAuditEvent(input.task.taskId, "step.retry_attempted", message, metadata);
  try {
    recordOrbMemory({
      userId: input.userId,
      traceId: input.requestId ?? `task_${input.task.taskId}_step_${stepId}` ,
      taskId: input.task.taskId,
      type: kind,
      summary: message,
      source: "orchestrator.retry",
      confidence: 0.9,
      tags: [kind, String(metadata.toolName ?? "unknown")],
      metadata,
    });
  } catch (err) {
    console.warn("[orchestrator] retry memory writeback failed:", err);
  }
}

export interface ExecuteStepToolsResult {
  attempted: boolean;
  toolResults: OrbToolCallResult[];
  ok: boolean;
  blockedByApproval?: boolean;
}

export async function executeCurrentStepTools(
  input: ExecuteStepToolsInput
): Promise<ExecuteStepToolsResult> {
  const step = input.task.steps[input.task.currentStepIndex];
  const traceId = input.traceId ?? input.requestId ?? `trace_${input.task.taskId}`;
  if (!step || step.toolCalls.length === 0) {
    return { attempted: false, toolResults: [], ok: true };
  }

  const registryByName = new Map(input.tools.map(t => [t.name, t]));
  const stepNeedsApproval = step.toolCalls.some(call => {
    const fromStep = Boolean(call.requiresApproval);
    const fromRegistry = Boolean(registryByName.get(call.name)?.requireConfirmation);
    return fromStep || fromRegistry;
  });
  const blockedTools = new Set(input.agentPreferences?.blockedTools ?? []);
  const blockedCall = step.toolCalls.find(call => blockedTools.has(call.name));
  if (blockedCall) {
    return {
      attempted: true,
      toolResults: [{ name: blockedCall.name, ok: false, error: "tool-blocked-by-user" }],
      ok: false,
      blockedByApproval: false,
    };
  }
  const policy = input.agentPreferences?.confirmationPolicy ?? "confirm_high_risk";
  const maxAuto = Math.max(1, input.agentPreferences?.maxAutoStepsPerTask ?? 5);
  const stepRisk = (step as unknown as { riskLevel?: string }).riskLevel ?? "low";
  const autoApproveTools = new Set(input.agentPreferences?.autoApproveTools ?? []);
  const hasAutoApprovedTool = step.toolCalls.some(call => autoApproveTools.has(call.name));
  // An explicit per-call `requiresApproval: true` (or registry `requireConfirmation`)
  // is enforced under default policy — only the user's own "always_approve" (or
  // the per-tool `autoApproveTools` whitelist) opts out of step-level gates.
  const explicitlyRequiresApproval = step.toolCalls.some(
    call => Boolean(call.requiresApproval) || Boolean(registryByName.get(call.name)?.requireConfirmation)
  );
  const shouldForceApprove =
    policy === "always_approve" ||
    hasAutoApprovedTool ||
    (policy === "confirm_high_risk" &&
      !explicitlyRequiresApproval &&
      (input.agentPreferences?.allowedRiskLevels ?? ["low", "medium"]).includes(stepRisk));
  const shouldForceManual = policy === "confirm_all" || policy === "manual";
  const autoStepLimitReached = (input.autoApprovedStepsInRun ?? 0) >= maxAuto;
  const isStepApproved = input.task.approvedStepIds.includes(step.id);
  const effectiveApproved = shouldForceManual ? false : (shouldForceApprove ? true : input.approved);
  if ((stepNeedsApproval && !(effectiveApproved || isStepApproved)) || autoStepLimitReached) {
    return {
      attempted: false,
      toolResults: [
        {
          name: step.toolCalls[0]?.name ?? "unknown",
          ok: false,
          error: "step-approval-required",
        },
      ],
      ok: false,
      blockedByApproval: true,
    };
  }

  // Resolve `${stepId.path}` references in each tool call's args against
  // earlier-step outputs. Without this, a multi-step plan that needs a
  // generated video_url, request_id, or audio_url from step N to feed
  // into step N+1 cannot actually chain — the planner has no way to know
  // those values upfront. This is the single largest gap that kept the
  // orb from being a real autonomous agent (see audit, gap #1).
  const cumulativeResults = input.perStepToolResults ?? [];
  const calls = step.toolCalls.map(call => ({
    name: call.name,
    args: resolveStepRefsInArgs({
      args: call.args,
      perStepToolResults: cumulativeResults.map(entry => ({
        stepId: entry.stepId,
        toolResults: entry.toolResults.map(r => ({ ok: r.ok, data: r.data })),
      })),
    }),
  }));

  // Guard: if any `${stepN.x}` placeholder survived resolution (because the
  // referenced step never produced data, the path is misnamed, or the step
  // came earlier-than-expected in the plan), refuse to dispatch the tool —
  // calling fal.ai / Suno / ElevenLabs with the literal string
  // `"${step1.video_url}"` produces a useless 4xx hours later. Surface a
  // clear `unresolved-step-ref` error per offending call so the FSM marks
  // the step failed and the user / planner sees what's missing.
  const unresolvedToolResults: OrbToolCallResult[] = [];
  for (const call of calls) {
    const refs = collectUnresolvedStepRefs(call.args);
    if (refs.length > 0) {
      unresolvedToolResults.push({
        name: call.name,
        ok: false,
        error: `unresolved-step-ref:${refs.slice(0, 4).join(",")}`,
      });
    }
  }
  if (unresolvedToolResults.length > 0) {
    return {
      attempted: true,
      toolResults: unresolvedToolResults,
      ok: false,
      blockedByApproval: false,
    };
  }

  const stepRetryBudget = Math.min(2, Math.max(0, input.stepRetryBudget ?? 2));
  let attempt = 0;
  let callPlan = calls;
  let toolResults: OrbToolCallResult[] = [];
  while (attempt <= stepRetryBudget) {
    toolResults = await executeOrbToolCalls({
      tools: input.tools,
      calls: callPlan,
      userId: input.userId,
      userRole: input.userRole,
      approved: input.approved,
      blockedTools: Array.from(blockedTools),
      requestId: input.requestId,
      taskId: input.task.taskId,
      stepId: step.id,
      onAuditEvent: input.onAuditEvent,
    });
    if (attempt >= stepRetryBudget) break;
    const verifierFailure = toolResults.find(result => {
      if (!result.ok) return false;
      return !verifyToolResult({ toolName: result.name, data: result.data }).ok;
    });
    if (!verifierFailure) break;
    const failedCall = callPlan.find(call => call.name === verifierFailure.name);
    const verdict = verifyToolResult({ toolName: verifierFailure.name, data: verifierFailure.data });
    if (verdict.ok || !failedCall) break;
    const observation: ToolFailureObservation = {
      toolName: verifierFailure.name,
      errorCode: verdict.errorCode ?? "verifier:unknown",
      issues: verdict.issues.slice(0, 8).map(issue => issue.message),
      toolArgs: failedCall.args,
    };
    const retryPatch = buildDeterministicRetryPatch(failedCall.args, observation.issues);
    if (!retryPatch) {
      recordRetryAuditAndMemory(
        input,
        step.id,
        "recovery_event",
        `Deterministic retry unavailable for ${observation.toolName}; requesting planner replan`,
        { attempt, stepId: step.id, ...observation }
      );
      appendOrbAgentTaskAuditEvent(
        input.task.taskId,
        "task.replanning",
        `Replan requested after verifier failure on ${observation.toolName}`,
        { attempt, stepId: step.id, observation }
      );
      await input.onRequestReplan?.({
        taskId: input.task.taskId,
        stepId: step.id,
        toolName: observation.toolName,
        observation,
        reason: "deterministic-retry-unavailable",
      });
      break;
    }
    callPlan = callPlan.map(call =>
      call.name === observation.toolName ? { ...call, args: retryPatch.args } : call
    );
    recordRetryAuditAndMemory(
      input,
      step.id,
      "tool_feedback",
      `Retrying ${observation.toolName} with deterministic patch (${retryPatch.reason})`,
      { attempt, stepId: step.id, ...observation, retryReason: retryPatch.reason, patchedArgs: retryPatch.args }
    );
    attempt += 1;
  }

  // ── DEF-AG1 Step Reflection ────────────────────────────────────────────
  // After a successful tool call, run a lightweight payload verifier so
  // an all-black image / empty audio / 200-with-error response can be
  // caught here instead of being silently fed to the next step. On
  // failure we mutate the per-call result in-place so the existing
  // failure path (FSM mark-failed → retry / replan) picks it up; we
  // never throw, never alter network behaviour.
  //
  // DEF-AG1.1 also emits a `step_verifier_failed` SSE event and writes a
  // `tool_feedback` entry into orbMemory so:
  //   1. The front-end intent card can surface 「驗收失敗、自動 retry」
  //      instead of leaving the user staring at a spinner.
  //   2. Once DEF-AG4 (Memory RAG → Planner) lands, the planner can
  //      retrieve historical 「這個工具/這個 prompt 容易出黑圖」 feedback
  //      and avoid the same trap on subsequent runs.
  const verifiedResults = toolResults.map(r => {
    if (!r.ok) return r;
    const verdict = verifyToolResult({ toolName: r.name, data: r.data });
    if (verdict.ok) return r;
    const errorCode = verdict.errorCode ?? "verifier:unknown";
    // Fire-and-forget telemetry — wrapped so an emit/memory bug never
    // breaks the orchestration tick.
    try {
      emitGenerationEvent({
        type: "step_verifier_failed",
        taskId: input.task.taskId,
        stepId: step.id,
        userId: input.userId,
        toolName: r.name,
        errorCode,
        issueCount: verdict.issues.length,
        at: Date.now(),
      });
    } catch (err) {
      console.warn("[orchestrator] step_verifier_failed emit failed:", err);
    }
    try {
      recordOrbMemory({
        userId: input.userId,
        traceId,
        taskId: input.task.taskId,
        type: "tool_feedback",
        summary: `Tool ${r.name} failed verifier (${errorCode}) on step ${step.id}`,
        source: "orchestrator.verifier",
        confidence: 0.9,
        tags: ["verifier-failed", errorCode, r.name],
        metadata: {
          taskId: input.task.taskId,
          stepId: step.id,
          toolName: r.name,
          issues: verdict.issues.slice(0, 4),
        },
      });
    } catch (err) {
      console.warn("[orchestrator] verifier memory writeback failed:", err);
    }
    return {
      ...r,
      ok: false,
      error: errorCode,
    };
  });

  return {
    attempted: true,
    toolResults: verifiedResults,
    ok: verifiedResults.every(r => r.ok),
    blockedByApproval: false,
  };
}

const UNRESOLVED_STEP_REF_RE = /\$\{[^}]+\}/g;

/**
 * Walk a resolved toolArgs object and return every leftover `${...}` string.
 * Used to fail fast when the planner referenced a step.path that doesn't
 * exist instead of forwarding the literal placeholder to a remote tool.
 */
function collectUnresolvedStepRefs(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    const matches = value.match(UNRESOLVED_STEP_REF_RE);
    if (matches) acc.push(...matches);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUnresolvedStepRefs(item, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectUnresolvedStepRefs(v, acc);
    }
  }
  return acc;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}

// ─── Multi-step coordinator ────────────────────────────────────────────────
//
// Real orchestration that walks the entire OrbTask, advancing both the
// persistent OrbTaskStore (legacy, per-step persistence) and the in-memory
// OrbAgentTask FSM (memory + claudeCode lifecycle hooks) on every transition.
//
// Why two state holders?
//   - OrbTaskStore is the long-lived per-step report store that the front-end
//     polls/SSE-streams via routers.ts; it owns step approvals + timeline.
//   - OrbAgentTask FSM (orbTaskStateMachine.ts) is the rich audit-event +
//     memory layer that records `task.completed` / `task.failed` and pushes
//     entries into orbTaskMemory / orbMemory.
// Previously these two were never linked; the orchestrator now keeps them
// in lock-step so multi-step flows (subtitles → dubbing → render) actually
// advance from one step to the next instead of stalling on step 0.

export type OrbOrchestratorOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export interface RunOrbTaskInput {
  taskId: string;
  userId: number;
  userRole: string;
  tools: OrbApiTool[];
  /**
   * Per-step approval token map. When a step requires approval, the caller
   * supplies the token previously issued by `orbTaskStore.approveStep`. Steps
   * absent from the map but already in `task.approvedStepIds` are accepted.
   */
  approvalTokensByStepId?: Record<string, string>;
  /**
   * Hard ceiling on total steps run by this driver invocation. Defaults to
   * `task.steps.length` so a runaway plan can't loop forever.
   */
  maxSteps?: number;
  requestId?: string;
  traceId?: string;
  /** Streamed for every state-machine audit event (for SSE). */
  onStateMachineEvent?: (event: OrbTaskAuditEvent) => void;
  /** Streamed for every tool-level audit event (forwarded from agentToolExecutor). */
  onToolAuditEvent?: ExecuteStepToolsInput["onAuditEvent"];
  /** Pluggable store for tests; defaults to the singleton. */
  store?: OrbTaskStore;
  /** Pluggable clock for tests. */
  now?: () => number;
  agentPreferences?: AgentPreferences;
}

export interface RunOrbTaskResult {
  taskId: string;
  outcome: OrbOrchestratorOutcome;
  stepsRun: number;
  /** Tool results indexed by step id, in execution order. */
  perStepToolResults: Array<{
    stepId: string;
    toolResults: OrbToolCallResult[];
    ok: boolean;
    blockedByApproval?: boolean;
    error_code?: OrbStepErrorCode;
    recovery_action?: OrbRecoveryAction;
  }>;
  /** Final task snapshot after the run (may be null if store dropped it). */
  finalTask: OrbTask | null;
  /** Final FSM snapshot (only present when the FSM has a matching record). */
  finalAgentTask: OrbAgentTask | null;
  /** Reason for non-completed outcomes. */
  reason?: string;
}

const MAX_SAME_ERROR_STREAK = 3;
const recoveryMetrics = new Map<string, { attempts: number; successes: number }>();

function recordRecoveryMetric(action: OrbRecoveryAction, ok: boolean): void {
  const cur = recoveryMetrics.get(action) ?? { attempts: 0, successes: 0 };
  cur.attempts += 1;
  if (ok) cur.successes += 1;
  recoveryMetrics.set(action, cur);
}

/**
 * Drive a multi-step OrbTask to completion (or first failure / approval gate).
 *
 * Loop invariant per iteration:
 *   1. Re-fetch latest persisted task from the store.
 *   2. If terminal (done/failed/cancelled) → exit with matching outcome.
 *   3. If `waiting_human` and current step lacks an approval token → exit
 *      with `awaiting_approval` (caller must approve, then re-invoke).
 *   4. Run current step's tools via `executeCurrentStepTools`.
 *   5. On `blockedByApproval` → exit `awaiting_approval`.
 *   6. On tool failure → `store.reportStep(ok=false)` + FSM `failOrbAgentStep`,
 *      exit `failed`.
 *   7. On success → `store.reportStep(ok=true)` (advances currentStepIndex)
 *      + FSM `completeOrbAgentStep` (advances currentStepId / completes task),
 *      then loop.
 */
export async function runOrbTaskToCompletion(
  input: RunOrbTaskInput
): Promise<RunOrbTaskResult> {
  const store = input.store ?? defaultOrbTaskStore;
  const clock = input.now ?? Date.now;
  const perStepToolResults: RunOrbTaskResult["perStepToolResults"] = [];
  const traceId = input.traceId ?? input.requestId ?? `trace_${input.taskId}`;
  let totalTokenCost = 0;
  let totalExternalApiCost = 0;
  let totalRetryCount = 0;

  // Snapshot existing FSM events so we only forward NEW ones to onStateMachineEvent.
  const seenEventIds = new Set<string>();
  const initialAgent = getOrbAgentTask(input.taskId);
  if (initialAgent) {
    for (const evt of initialAgent.auditEvents) seenEventIds.add(evt.eventId);
  }
  const flushNewFsmEvents = () => {
    if (!input.onStateMachineEvent) return;
    const agent = getOrbAgentTask(input.taskId);
    if (!agent) return;
    for (const evt of agent.auditEvents) {
      if (seenEventIds.has(evt.eventId)) continue;
      seenEventIds.add(evt.eventId);
      input.onStateMachineEvent(evt);
    }
  };

  const maxIterations = Math.max(
    1,
    input.maxSteps ?? store.get(input.taskId, input.userId, clock())?.steps.length ?? 1
  );
  let autoApprovedStepsInRun = 0;

  for (let i = 0; i < maxIterations; i += 1) {
    const task = store.get(input.taskId, input.userId, clock());
    if (!task) {
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: null,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "task-not-found",
      };
    }

    if (task.status === "done") {
      emitGenerationEvent({
        type: "task_done",
        taskId: input.taskId,
        userId: input.userId,
        at: clock(),
        orbTraceId: traceId,
      });
      console.info("[orb.task_cost_aggregate]", { traceId, taskId: input.taskId, tokenCost: totalTokenCost, externalApiCost: totalExternalApiCost, retryCount: totalRetryCount });
      return {
        taskId: input.taskId,
        outcome: "completed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
      };
    }
    if (task.status === "failed") {
      emitGenerationEvent({
        type: "task_failed",
        taskId: input.taskId,
        userId: input.userId,
        at: clock(),
        orbTraceId: traceId,
      });
      console.info("[orb.task_cost_aggregate]", { traceId, taskId: input.taskId, tokenCost: totalTokenCost, externalApiCost: totalExternalApiCost, retryCount: totalRetryCount });
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason:
          task.stepReports.find(r => !r.ok)?.errorCode ??
          task.stepReports.find(r => !r.ok)?.detail ??
          "task-failed",
      };
    }
    if (task.status === "cancelled") {
      return {
        taskId: input.taskId,
        outcome: "cancelled",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "cancelled",
      };
    }

    if (task.status === "waiting_human") {
      return {
        taskId: input.taskId,
        outcome: "awaiting_approval",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "task-awaiting-human-approval",
      };
    }

    const step = task.steps[task.currentStepIndex];
    if (!step) {
      // No more steps and not yet `done`: defensive — mark failed via store
      // so callers see a deterministic result.
      const failed = store.reportStep(
        {
          taskId: input.taskId,
          stepId: `synthetic_${task.currentStepIndex}`,
          ok: false,
          errorCode: "no-current-step",
          source: "system",
          actor: "system",
          at: clock(),
        },
        input.userId,
        clock()
      );
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: failed,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "no-current-step",
      };
    }

    // Pre-flight: if this step requires approval and no token is supplied
    // (and it's not already in approvedStepIds), exit early so the caller
    // can ask the user before any tool side-effects fire.
    const stepRequiresApproval =
      step.toolCalls.some(c => c.requiresApproval) ||
      input.tools.some(
        t =>
          t.requireConfirmation &&
          step.toolCalls.some(c => c.name === t.name)
      );
    const stepAlreadyApproved = task.approvedStepIds.includes(step.id);
    const stepToken = input.approvalTokensByStepId?.[step.id];
    const stepTokenValid =
      stepToken !== undefined &&
      store.isStepApproved(input.taskId, input.userId, step.id, stepToken, clock());
    const approvedForStep = stepAlreadyApproved || stepTokenValid;

    const stepRun = await executeCurrentStepTools({
      task,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      approved: approvedForStep,
      requestId: input.requestId
        ? `${input.requestId}_step_${step.id}`
        : `task_${input.taskId}_step_${step.id}_${clock()}`,
      traceId,
      onAuditEvent: input.onToolAuditEvent,
      agentPreferences: input.agentPreferences,
      autoApprovedStepsInRun,
      perStepToolResults,
    });
    if (!stepRun.blockedByApproval && stepRun.attempted) autoApprovedStepsInRun += 1;
    for (const r of stepRun.toolResults) {
      const anyR = r as unknown as Record<string, unknown>;
      totalTokenCost += typeof anyR.tokenCost === "number" ? Number(anyR.tokenCost) : 0;
      totalExternalApiCost += typeof anyR.externalApiCost === "number" ? Number(anyR.externalApiCost) : 0;
      totalRetryCount += typeof anyR.retryCount === "number" ? Number(anyR.retryCount) : 0;
      console.info("[orb.tool_call]", {
        traceId,
        taskId: input.taskId,
        stepId: step.id,
        toolName: r.name,
        latencyMs: typeof anyR.latencyMs === "number" ? Number(anyR.latencyMs) : null,
        inputHash: hashPayload(step.toolCalls.find(c => c.name === r.name)?.args ?? null),
        outputHash: hashPayload(r.data ?? r.error ?? null),
        errorCode: r.ok ? null : (r.error ?? "tool_failed"),
      });
    }

    const failureReason = stepRun.toolResults.find(r => !r.ok)?.error;
    const error_code = stepRun.ok ? undefined : classifyOrbStepError(failureReason);
    const recovery_action = error_code ? recoveryActionFor(error_code) : undefined;
    perStepToolResults.push({
      stepId: step.id,
      toolResults: stepRun.toolResults,
      ok: stepRun.ok,
      blockedByApproval: stepRun.blockedByApproval,
      error_code,
      recovery_action,
    });

    if (stepRun.blockedByApproval) {
      // Don't mark the step failed — let the caller surface an approval
      // prompt and re-invoke once the user approves.
      return {
        taskId: input.taskId,
        outcome: "awaiting_approval",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: store.get(input.taskId, input.userId, clock()),
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "step-approval-required",
        ...(stepRequiresApproval ? {} : {}),
      };
    }

    if (!stepRun.ok) {
      const failureReason = stepRun.toolResults.find(r => !r.ok)?.error ?? "step-failed";
      const streak = [...perStepToolResults]
        .reverse()
        .filter(x => !x.ok)
        .map(x => x.error_code)
        .findIndex(code => code !== error_code);
      const sameErrorCount = streak === -1 ? perStepToolResults.filter(x => x.error_code === error_code).length : streak;
      const trippedCircuit = Boolean(error_code) && sameErrorCount >= MAX_SAME_ERROR_STREAK;
      const finalRecoveryAction = trippedCircuit ? "handoff_to_human" : recovery_action;
      if (finalRecoveryAction) recordRecoveryMetric(finalRecoveryAction, false);
      const updatedTask = store.reportStep(
        {
          taskId: input.taskId,
          stepId: step.id,
          ok: false,
          errorCode: error_code ?? failureReason,
          detail: [stepRun.toolResults.find(r => !r.ok)?.error, `recovery_action=${finalRecoveryAction ?? "none"}`]
            .filter(Boolean)
            .join("; "),
          source: "tool",
          actor: "agent",
          at: clock(),
        },
        input.userId,
        clock()
      );
      // Keep FSM in sync — only if the FSM tracks this task.
      if (getOrbAgentTask(input.taskId)) {
        failOrbAgentStep(input.taskId, step.id, failureReason);
        flushNewFsmEvents();
      }
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: updatedTask,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: trippedCircuit ? "handoff_to_human" : failureReason,
      };
    }

    // Step succeeded → advance both stores in lock-step.
    store.reportStep(
      {
        taskId: input.taskId,
        stepId: step.id,
        ok: true,
        source: "tool",
        actor: "agent",
        at: clock(),
      },
      input.userId,
      clock()
    );
    if (getOrbAgentTask(input.taskId)) {
      completeOrbAgentStep(input.taskId, step.id);
      flushNewFsmEvents();
    }
    if (recovery_action) recordRecoveryMetric(recovery_action, true);
    emitGenerationEvent({
      type: "step_complete",
      taskId: input.taskId,
      stepId: step.id,
      userId: input.userId,
      at: clock(),
    });
  }

  // Loop fell out of maxIterations without reaching a terminal state.
  const finalTask = store.get(input.taskId, input.userId, clock());
  if (finalTask?.status === "done") {
    emitGenerationEvent({
      type: "task_done",
      taskId: input.taskId,
      userId: input.userId,
      at: clock(),
      orbTraceId: traceId,
    });
    console.info("[orb.task_cost_aggregate]", { traceId, taskId: input.taskId, tokenCost: totalTokenCost, externalApiCost: totalExternalApiCost, retryCount: totalRetryCount });
    return {
      taskId: input.taskId,
      outcome: "completed",
      stepsRun: perStepToolResults.length,
      perStepToolResults,
      finalTask,
      finalAgentTask: getOrbAgentTask(input.taskId),
    };
  }
  if (finalTask?.status === "failed") {
    emitGenerationEvent({
      type: "task_failed",
      taskId: input.taskId,
      userId: input.userId,
      at: clock(),
      orbTraceId: traceId,
    });
    console.info("[orb.task_cost_aggregate]", { traceId, taskId: input.taskId, tokenCost: totalTokenCost, externalApiCost: totalExternalApiCost, retryCount: totalRetryCount });
  }
  return {
    taskId: input.taskId,
    outcome: "failed",
    stepsRun: perStepToolResults.length,
    perStepToolResults,
    finalTask,
    finalAgentTask: getOrbAgentTask(input.taskId),
    reason: "max-steps-exceeded",
  };
}
