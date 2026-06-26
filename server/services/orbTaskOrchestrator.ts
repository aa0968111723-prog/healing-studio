/**
 * server/services/orbTaskOrchestrator.ts
 *
 * SCOPE: **server** only — orchestrates a server-side LLM tool plan
 * (planner output) by calling registered API tools (`OrbApiTool`),
 * tracking per-step audit events, and driving retry / replan when a
 * tool call fails or its result fails verification.
 *
 * This is one half of a deliberate two-orchestrator split. The other
 * half (`shared/global-agent-orchestrator.ts`) runs on the **client**
 * and orchestrates DOM/page-level workflow steps (navigate, fillPrompt,
 * setModel, …) via `PageAgentContext`. The two share concept names
 * ("step", "retry", "audit") but operate on completely different units
 * of work: server steps invoke tRPC tool endpoints; client steps drive
 * a React SPA. They are intentionally NOT merged.
 *
 * Hard rule: this file must never be imported from `client/**`.
 * Conversely, `shared/global-agent-orchestrator.ts` must never import
 * `server/**`. The boundary is enforced by
 * `tests/unit/shared/orchestrator-boundary.test.ts`.
 */
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
  reflectOnStepResult,
  shouldReplanFromReflection,
} from "../../shared/orb-self-reflection";
import {
  appendOrbAgentTaskAuditEvent,
  completeOrbAgentStep,
  failOrbAgentStep,
  getOrbAgentTask,
} from "./orbTaskStateMachine";
import { orbTaskStore as defaultOrbTaskStore } from "./orbTaskStore";
import type { OrbTaskStore } from "./orbTaskStore";
import type { AgentPreferences } from "../../shared/agent-preferences";
import { dualEmitForUser } from "../generationEvents";
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
  /**
   * True when the replan integration successfully replaced the failing step
   * with revised steps in the store mid-iteration. The outer driver should
   * skip the usual `reportStep(ok:false)` failure path and re-iterate the
   * outer loop so the newly injected steps execute, otherwise the task
   * would be force-marked failed even though recovery succeeded.
   */
  replanApplied?: boolean;
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
  // F4 修復:不能直接看 approvedStepIds — 那是 legacy 永久陣列,沒 TTL。
  // 必須對應 stepApprovals 的 expiresAt 才不會讓「6 分鐘前同意,5 分鐘
  // 後重連」這種情境誤觸發昂貴工具呼叫。沒在 stepApprovals 內或已過期
  // 都視為未授權。
  const nowForApprovalCheck = Date.now();
  const cachedApproval = input.task.stepApprovals.find(x => x.stepId === step.id);
  const isStepApproved = !!(cachedApproval && cachedApproval.expiresAt >= nowForApprovalCheck);
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
      const stepIdBeforeReplan = step.id;
      await input.onRequestReplan?.({
        taskId: input.task.taskId,
        stepId: step.id,
        toolName: observation.toolName,
        observation,
        reason: "deterministic-retry-unavailable",
      });
      // The replan callback uses the OrbTaskStore which holds the same task
      // object reference we received in `input.task` (Map<id, task>), so a
      // successful `injectRevisedSteps` mutates `task.steps` in place. If the
      // step at the current index now has a different id, recovery succeeded
      // and the outer driver should re-iterate instead of force-failing.
      const currentStepAfterReplan =
        input.task.steps[input.task.currentStepIndex];
      const replanApplied =
        Boolean(currentStepAfterReplan) &&
        currentStepAfterReplan.id !== stepIdBeforeReplan;
      if (replanApplied) {
        return {
          attempted: true,
          toolResults: [],
          ok: true,
          blockedByApproval: false,
          replanApplied: true,
        };
      }
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
  // After a successful tool call, run a structured self-reflection pass
  // (shared/orb-self-reflection.ts) so an all-black image / empty audio /
  // empty-success / sluggish latency can be caught here instead of being
  // silently fed to the next step. On hard failure we mutate the per-call
  // result in-place so the existing failure path (FSM mark-failed → retry
  // / replan) picks it up; warnings only emit telemetry + memory and let
  // the result pass through. We never throw, never alter network behaviour.
  //
  // DEF-AG1.1 also emits a `step_verifier_failed` SSE event and writes a
  // `tool_feedback` entry into orbMemory so:
  //   1. The front-end intent card can surface 「驗收失敗、自動 retry」
  //      instead of leaving the user staring at a spinner.
  //   2. The planner's next pass (via buildOrbMemorySummaryForPlanner)
  //      retrieves these reflections through RAG and avoids the same
  //      trap on subsequent runs.
  const verifiedResults = toolResults.map(r => {
    if (!r.ok) return r;
    const anyR = r as unknown as Record<string, unknown>;
    const reflection = reflectOnStepResult({
      toolName: r.name,
      data: r.data,
      latencyMs: typeof anyR.latencyMs === "number" ? Number(anyR.latencyMs) : undefined,
      retryCount: typeof anyR.retryCount === "number" ? Number(anyR.retryCount) : undefined,
    });
    if (reflection.severity === "info") return r;

    // Fire-and-forget telemetry — wrapped so an emit/memory bug never
    // breaks the orchestration tick.
    if (!reflection.ok) {
      try {
        dualEmitForUser(input.userId, {
          type: "step_verifier_failed",
          taskId: input.task.taskId,
          stepId: step.id,
          userId: input.userId,
          toolName: r.name,
          errorCode: reflection.code,
          issueCount: reflection.verifier.issues.length,
          at: Date.now(),
        });
      } catch (err) {
        console.warn("[orchestrator] step_verifier_failed emit failed:", err);
      }
    }
    try {
      recordOrbMemory({
        userId: input.userId,
        traceId,
        taskId: input.task.taskId,
        type: "tool_feedback",
        summary: reflection.summary,
        source: "orchestrator.reflection",
        confidence: 0.9,
        tags: [...reflection.tags, reflection.severity],
        metadata: {
          taskId: input.task.taskId,
          stepId: step.id,
          toolName: r.name,
          severity: reflection.severity,
          advice: reflection.advice,
          issues: reflection.verifier.issues.slice(0, 4),
        },
      });
    } catch (err) {
      console.warn("[orchestrator] reflection memory writeback failed:", err);
    }

    if (shouldReplanFromReflection(reflection)) {
      return {
        ...r,
        ok: false,
        error: reflection.code,
      };
    }
    // warn-severity reflections are advisory only — leave the result usable
    // but the audit / memory trail now contains the advice for the next pass.
    return r;
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
  /**
   * Callback fired when the orchestrator decides a step should be
   * re-planned (e.g. permanent retry exhaustion). Already invoked
   * inside the orchestrator; the type just needs to surface here so
   * callers (chat router) can wire `createReplanCallback`'s return
   * value through without a `as` cast.
   */
  onRequestReplan?: (payload: {
    taskId: string;
    stepId: string;
    toolName: string;
    observation: ToolFailureObservation;
    reason: string;
  }) => Promise<void> | void;
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

// L8 修復:防禦性 counter cap。實務上 +1 per operation 超過 Number.
// MAX_SAFE_INTEGER 需要 9 × 10^15 次 — 永遠不會到。但 Map.get / set 是
// 永久的,長 uptime 服務不應依賴重啟才能讀統計。export read + reset。
const COUNTER_CAP = Number.MAX_SAFE_INTEGER;

function recordRecoveryMetric(action: OrbRecoveryAction, ok: boolean): void {
  const cur = recoveryMetrics.get(action) ?? { attempts: 0, successes: 0 };
  // 用 Math.min 把 cap 寫進 increment,避免 floating-point 計數失真。
  cur.attempts = Math.min(cur.attempts + 1, COUNTER_CAP);
  if (ok) cur.successes = Math.min(cur.successes + 1, COUNTER_CAP);
  recoveryMetrics.set(action, cur);
}

/** 給監控 / dashboard / cron 讀目前 recovery 統計快照。 */
export function getRecoveryMetricsSnapshot(): Record<
  string,
  { attempts: number; successes: number; successRate: number }
> {
  const out: Record<string, { attempts: number; successes: number; successRate: number }> = {};
  for (const [action, stats] of recoveryMetrics.entries()) {
    out[action] = {
      attempts: stats.attempts,
      successes: stats.successes,
      successRate: stats.attempts > 0 ? stats.successes / stats.attempts : 0,
    };
  }
  return out;
}

/** 給 daily cron / test cleanup 用,清空累計統計。 */
export function resetRecoveryMetrics(): void {
  recoveryMetrics.clear();
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

  // Initial iteration ceiling. Increases dynamically when the replan
  // integration injects revised steps (capped at MAX_DYNAMIC_ITERATIONS so
  // a runaway recovery loop can still terminate).
  const MAX_DYNAMIC_ITERATIONS = 32;
  let maxIterations = Math.max(
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
      dualEmitForUser(input.userId, {
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
      dualEmitForUser(input.userId, {
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
    // F4 修復:用 store.hasUnexpiredStepApproval 才會檢查 expiresAt。
    // 原本 task.approvedStepIds.includes 完全繞過 TTL,使用者過期同意
    // 仍會觸發昂貴工具呼叫。
    const stepAlreadyApproved = store.hasUnexpiredStepApproval(
      input.taskId,
      input.userId,
      step.id,
      clock()
    );
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
      onRequestReplan: input.onRequestReplan,
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

    // Replan rescued the step: the store now has a different step at the
    // current index. Skip this iteration's failure bookkeeping, give the
    // loop a few extra ticks (capped) so the freshly injected steps can
    // run, then re-iterate.
    if (stepRun.replanApplied) {
      flushNewFsmEvents();
      maxIterations = Math.min(
        MAX_DYNAMIC_ITERATIONS,
        maxIterations + 4
      );
      continue;
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
      // F5 修復:circuit-breaker 算「連續同錯」必須真連續,不能 filter
      // 掉 ok 步驟。原本 [reverse].filter(!ok).map(code).findIndex(!==code)
      // 會把「A-成功-A-成功-A」算成 3 連續同錯而誤觸發 replan/handoff_to_
      // human。實際是 33% 間歇性失敗,不該跳閘。改成直接 reverse 後找第
      // 一個「ok 為 true 或 error_code 不同」的位置,真連續才計入。
      let sameErrorCount = 0;
      if (error_code) {
        for (let i = perStepToolResults.length - 1; i >= 0; i--) {
          const r = perStepToolResults[i];
          // 一遇到「ok 成功」或「不同 error_code」就 break 中斷 streak
          if (r.ok || r.error_code !== error_code) break;
          sameErrorCount += 1;
        }
      }
      const trippedCircuit = Boolean(error_code) && sameErrorCount >= MAX_SAME_ERROR_STREAK;

      // Circuit-breaker rescue：原本 trippedCircuit 直接回 handoff_to_human
      // 等同死路（站內沒有真人客服在另一端接）。改成先讓 planner 試一次
      // replan — 它可以改參數、換工具、或切割成更小步驟。replan 真的
      // 注入了新步驟（current step id 換掉）就 continue；replan 也救不
      // 起來再走原本的 failed 路徑。
      let circuitReplanApplied = false;
      if (trippedCircuit && input.onRequestReplan) {
        const stepIdBeforeReplan = step.id;
        const replanObservation: ToolFailureObservation = {
          toolName: stepRun.toolResults.find(r => !r.ok)?.name ?? step.toolCalls[0]?.name ?? "unknown",
          errorCode: error_code ?? "circuit_breaker_tripped",
          issues: [
            `Same error code "${error_code}" repeated ${sameErrorCount} times`,
            failureReason,
          ].filter((x): x is string => Boolean(x)),
          toolArgs: step.toolCalls[0]?.args ?? {},
        };
        appendOrbAgentTaskAuditEvent(
          input.taskId,
          "task.replanning",
          `Circuit-breaker tripped (${sameErrorCount}× ${error_code}); requesting replan before failing`,
          { stepId: step.id, observation: replanObservation }
        );
        try {
          await input.onRequestReplan({
            taskId: input.taskId,
            stepId: step.id,
            toolName: replanObservation.toolName,
            observation: replanObservation,
            reason: "circuit-breaker-tripped",
          });
        } catch (replanError) {
          console.warn(
            `[Orb] circuit-breaker replan callback threw for taskId=${input.taskId}:`,
            replanError instanceof Error ? replanError.message : String(replanError)
          );
        }
        const refetched = store.get(input.taskId, input.userId, clock());
        const currentStepAfterReplan = refetched?.steps[refetched.currentStepIndex];
        circuitReplanApplied =
          Boolean(currentStepAfterReplan) &&
          currentStepAfterReplan!.id !== stepIdBeforeReplan;
        if (circuitReplanApplied) {
          // Give the loop room to run the freshly injected steps.
          maxIterations = Math.min(MAX_DYNAMIC_ITERATIONS, maxIterations + 4);
          flushNewFsmEvents();
          continue;
        }
      }

      // No rescue path worked — mark step failed and exit. handoff_to_human
      // is now only emitted as a metric/recovery_action label so dashboards
      // can spot circuits that even replan couldn't save; the chat layer
      // surfaces this with a structured user-decision card (retry / cancel /
      // user-takeover) rather than a silent dead end.
      const finalRecoveryAction = trippedCircuit ? "handoff_to_human" : recovery_action;
      if (finalRecoveryAction) recordRecoveryMetric(finalRecoveryAction, false);
      const updatedTask = store.reportStep(
        {
          taskId: input.taskId,
          stepId: step.id,
          ok: false,
          errorCode: error_code ?? failureReason,
          detail: [stepRun.toolResults.find(r => !r.ok)?.error, `recovery_action=${finalRecoveryAction ?? "none"}`, trippedCircuit ? "replan_attempted=true" : null]
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
        reason: trippedCircuit ? "circuit-broken-replan-failed" : failureReason,
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
    dualEmitForUser(input.userId, {
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
    dualEmitForUser(input.userId, {
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
    dualEmitForUser(input.userId, {
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
