/*
 * shared/global-agent-orchestrator.ts
 */

import type {
  AgentAction,
  AgentActionResult,
  AgentWorkflowStep,
  PageAgentSnapshot,
  RunWorkflowAction,
} from "./agent-actions";
import { globalAgentRegistry, type GlobalAgentPlan } from "./global-agent-registry";
import { expandWorkflowAction, type ExpandedWorkflowStep } from "./global-agent-workflows";
import { topologicalBatches, ensureStepIds } from "./orb-dag-scheduler";
import { resolveStepRefsInArgs } from "./orb-step-ref-resolver";
import type { WorkflowRunState } from "./workflow-run-state";

export interface GlobalAgentExecutionContext {
  currentPage?: PageAgentSnapshot | null;
  /**
   * Override for "the path the SPA is currently on". When set, takes
   * precedence over `currentPage?.pagePath` for the redundant-navigate
   * check. Used internally by `executeGlobalActions` to thread the
   * just-landed path forward across a multi-action batch — without it the
   * second action would re-navigate to the same page the first action just
   * left us on, because `currentPage` is a frozen snapshot from the caller.
   */
  currentPath?: string;
  navigate: (path: string) => Promise<void> | void;
  dispatch: (action: AgentAction, opts?: GlobalDispatchOptions) => Promise<AgentActionResult>;
  /**
   * Minimum settle time after `navigate()` before the orchestrator polls for
   * handler readiness. Lets wouter / React commit the route change. Default
   * 450ms — set 0 in tests.
   */
  waitAfterNavigateMs?: number;
  /**
   * Optional readiness probe. When provided, the orchestrator awaits this
   * after `navigate()` + the settle wait, before dispatching the step's
   * action. Returns true if the destination handler registered in time,
   * false on timeout. The orchestrator continues either way (timeouts get
   * surfaced via the dispatch failure path), but a true return guarantees
   * the next dispatch lands on a live handler instead of the silent enqueue
   * path. Wire this up to `globalAgentRegistry.findByPath` polling from the
   * client to make cross-page workflows survive slow route hydration.
   */
  awaitPageReady?: (path: string, opts: { timeoutMs: number }) => Promise<boolean>;
  /**
   * Cap on the readiness poll. Default 4000ms. Tuned for "slow but precise":
   * we'd rather block here for a few seconds than dispatch into the queue
   * and lose deterministic ordering.
   */
  pageReadyTimeoutMs?: number;
  source?: "ai-chat" | "orb-guide" | "manual";
  requireConfirmation?: boolean;
  intentSummary?: string;
  requireConfirmationForWorkflowSteps?: boolean;
  onWorkflowStep?: (step: GlobalWorkflowStepProgress) => void;

  // ── Task 1: tool-call execution ────────────────────────────────────────
  /**
   * Server-side tool dispatcher. The orchestrator calls this when a workflow
   * step declares `toolName`. Implementations route to the tRPC studio
   * router (`media.transcribe`, `studio.generateImage`, …). Returning
   * `{ ok: false }` triggers the same retry / replan path as a UI dispatch
   * failure.
   */
  callTool?: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ ok: boolean; data?: unknown; reason?: string }>;
  /**
   * Cumulative tool results threaded across a workflow run. The resolver
   * substitutes `${stepId.key}` placeholders inside `toolArgs` from these
   * entries before each tool dispatch. Caller-supplied so a multi-action
   * sequence can reuse step results across adjacent runWorkflow calls.
   */
  perStepToolResults?: Array<{
    stepId: string;
    toolResults: Array<{ ok: boolean; data?: unknown }>;
  }>;

  // ── Task 2: reactive replan ────────────────────────────────────────────
  /**
   * Optional replan hook. After all retries on a failed step are exhausted
   * (and the step does not have `skipOnFail`), the orchestrator calls this
   * with the failure context. Returning a fresh AgentWorkflowStep[] swaps
   * out the remaining steps; returning null preserves the legacy
   * abort-on-fail behaviour.
   */
  replan?: (args: {
    failedStep: AgentWorkflowStep;
    failReason: string;
    remainingSteps: AgentWorkflowStep[];
    currentSnapshot?: PageAgentSnapshot | null;
  }) => Promise<AgentWorkflowStep[] | null>;

  // ── Task 3: workflow run-state persistence ─────────────────────────────
  /** Persist the workflow's progress after each step (success or fail). */
  persistRunState?: (state: WorkflowRunState) => Promise<void>;
  /** Load a previously persisted run state by id. */
  loadRunState?: (runId: string) => Promise<WorkflowRunState | null>;
  /**
   * When set, the sequential executor calls `loadRunState(resumeFromRunId)`
   * at the start of the workflow and skips already-completed steps.
   */
  resumeFromRunId?: string;
  /** Stable id used by the persistence hooks. Auto-generated when omitted. */
  runId?: string;

  // ── Task 4: step-by-step confirmation ──────────────────────────────────
  /**
   * When the workflow declares `confirmationMode: "step-by-step"` (or
   * `"high-risk-only"` for a destructive step), the orchestrator awaits
   * this hook before dispatching. "skip" mirrors `retryPolicy.skipOnFail`
   * and continues with the next step; "abort" stops the workflow with a
   * cooperative reason (no replan).
   */
  confirmStep?: (
    step: AgentWorkflowStep,
    index: number,
    total: number
  ) => Promise<"proceed" | "skip" | "abort">;

  // ── Cost governor (pre-flight estimate + budget gate) ─────────────────
  /**
   * Optional pre-flight hook called ONCE per workflow before any step
   * runs. Caller is expected to use `orb-cost-governor.estimateWorkflowCost`
   * + `shouldRequireBudgetConfirm` and either:
   *   - return `"proceed"` to run the workflow as planned;
   *   - return `"abort"` with a reason to stop before any tool fires;
   *   - return `"confirm"` to flip `confirmationMode` to "step-by-step"
   *     for THIS workflow (honoured even if the action didn't declare it).
   *
   * Implementations typically pop a confirmation card showing the
   * `formatCostEstimateForUser(estimate)` output before returning.
   */
  estimateAndConfirmBudget?: (args: {
    workflowName: string;
    steps: AgentWorkflowStep[];
  }) => Promise<{
    decision: "proceed" | "confirm" | "abort";
    reason?: string;
  }>;

  // ── Perception loop (post-step verification) ───────────────────────────
  /**
   * Optional hook called after EACH successful step. The caller is
   * responsible for capturing the post-step `PageAgentSnapshot` (or tool
   * result) and converting it into a recommendation via
   * `orb-perception-loop.evaluateStepOutcome`. Recommendations:
   *   - "proceed"  — continue to the next step (default).
   *   - "retry"    — re-run the same step once more (counts as a retry).
   *   - "replan"   — synthesise a "no-effect" failure and route through
   *                  `ctx.replan` so the planner can react.
   *   - "abort"    — stop the workflow with `reason = perception.<...>`.
   *
   * Implementations should NOT rely on this hook for hard failures —
   * those still propagate through `dispatch`'s ok=false return.
   */
  observeAfterStep?: (args: {
    step: AgentWorkflowStep;
    index: number;
    total: number;
    result: AgentActionResult;
  }) => Promise<{
    recommendation: "proceed" | "retry" | "replan" | "abort";
    reason?: string;
  } | null | undefined>;

  /**
   * Pause inserted between consecutive same-page steps when the previous
   * step changed the visible workspace (setTab / setModality / setMode /
   * applyPreset). Lets React commit + the destination child re-mount and
   * register its bridge before the next dispatch fires; without it
   * `setTab → fillPrompt` on /pro-studio races and the prompt input ends
   * up empty. Default 120ms; set 0 from tests / non-React callers.
   */
  samePageStateMutationSettleMs?: number;

  planNextStep?: (args: {
    goal: string;
    previousObservations: StepObservation[];
    context?: Record<string, unknown>;
  }) => Promise<PlanStep | null>;
  executePlanStep?: (step: PlanStep) => Promise<{
    ok: boolean;
    evidence: string;
    outputRefId?: string;
  }>;
  onObservation?: (observation: StepObservation) => Promise<void> | void;
}

export interface GlobalDispatchOptions {
  targetPageId?: string;
  enqueueIfNoHandler?: boolean;
  requireConfirmation?: boolean;
  source?: "ai-chat" | "orb-guide" | "manual";
  intentSummary?: string;
}

export interface GlobalWorkflowStepProgress {
  index: number;
  total: number;
  label: string;
  path?: string;
  action: AgentAction;
}

export interface GlobalAgentExecutionResult {
  ok: boolean;
  plan?: GlobalAgentPlan;
  results: AgentActionResult[];
  reason?: string;
  workflowName?: string;
  /**
   * The path the orchestrator believes the SPA ended on after this run.
   * Threaded by `executeGlobalActions` into the next iteration's `currentPath`
   * so consecutive actions targeting the same page skip the redundant
   * navigate + settle wait. Undefined when no step had a path.
   */
  endingPath?: string;
}

export interface PlanStep {
  goal: string;
  action: string;
  target?: string;
  inputs?: Record<string, unknown>;
  success_criteria: string;
  fallback?: string;
}

export interface StepObservation {
  step: PlanStep;
  success: boolean;
  evidence: string;
  outputRefId?: string;
}

const DANGEROUS_ACTION_TYPES = new Set<AgentAction["type"]>([
  "submit",
  "reset",
  "applyPreset",
  "runWorkflow",
]);

export function isDangerousAction(action: AgentAction): boolean {
  return DANGEROUS_ACTION_TYPES.has(action.type);
}

export function findDangerousWorkflowSteps(action: Extract<AgentAction, { type: "runWorkflow" }>): number[] {
  return action.steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => ["submit", "reset", "applyPreset"].includes(step.actionType))
    .map(({ index }) => index);
}

/**
 * Subset of `AgentPreferences` consumable by the orchestrator. We re-declare it
 * here (rather than importing) to keep this module dependency-light and usable
 * from both client and server bundles.
 */
export interface OrchestratorPreferences {
  confirmationPolicy?: "always_approve" | "confirm_high_risk" | "confirm_all" | "manual";
  autoApproveTools?: string[];
  blockedTools?: string[];
}

export function shouldAskBeforeAct(
  actions: AgentAction[],
  preferences?: OrchestratorPreferences | null
): boolean {
  const policy = preferences?.confirmationPolicy ?? "confirm_high_risk";

  // confirm_all → every action goes through confirmation, full stop.
  if (policy === "confirm_all") return actions.length > 0;

  // manual → caller should not be dispatching at all; if it does (kill-switch
  // bypassed) treat every action as needing confirmation as a safety net.
  if (policy === "manual") return actions.length > 0;

  return actions.some(action => {
    if (action.type === "runWorkflow") {
      const dangerousSteps = findDangerousWorkflowSteps(action);
      const hasMultiple = action.steps.length > 1;
      // always_approve still confirms multi-step workflows because even the
      // intermediate UI dispatches can mutate persistent state.
      return hasMultiple || dangerousSteps.length > 0;
    }
    if (policy === "always_approve") {
      // Safe single-step actions auto-pass; submit/reset/applyPreset still gate.
      return isDangerousAction(action);
    }
    return isDangerousAction(action);
  });
}

/**
 * Returns true if a tool name is on the user's auto-approve list. Allows
 * `*` as a wildcard. Used by orb router-side dispatchers to skip individual
 * confirmation cards for trusted tools.
 */
export function isToolAutoApproved(
  toolName: string,
  preferences?: OrchestratorPreferences | null
): boolean {
  const list = preferences?.autoApproveTools ?? [];
  return list.includes("*") || list.includes(toolName);
}

/** Returns true if the tool name is explicitly blocked by the user. */
export function isToolBlocked(
  toolName: string,
  preferences?: OrchestratorPreferences | null
): boolean {
  return (preferences?.blockedTools ?? []).includes(toolName);
}

function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeResult(r?: AgentActionResult): AgentActionResult {
  return r ?? { ok: true };
}

/**
 * UI actions that swap the visible workspace inside a single page (tab,
 * modality, mode, preset). React commits the new state asynchronously, and
 * the destination child only registers its bridge / agentBus subscription
 * after re-mount. A follow-up `fillPrompt` dispatched on the SAME page would
 * race against that re-mount and either no-op or land on the previous
 * child's state — exactly the empty-prompt symptom users see when the
 * multi-step orb runs `setTab → fillPrompt` against /pro-studio.
 *
 * The orchestrator pauses briefly between same-page steps when the
 * previous action belongs to this set, giving React + the page-level bridge
 * registration enough time to settle before the next dispatch fires.
 */
const STATE_MUTATING_ACTION_TYPES = new Set<AgentAction["type"]>([
  "setTab",
  "setModality",
  "setMode",
  "applyPreset",
]);

const SAME_PAGE_STATE_MUTATION_SETTLE_MS = 120;

function shouldAwaitSamePageStateMutation(
  prev: ExpandedWorkflowStep | undefined,
  next: ExpandedWorkflowStep | undefined
): boolean {
  if (!prev || !next) return false;
  const prevType = prev.action?.type;
  if (!prevType || !STATE_MUTATING_ACTION_TYPES.has(prevType)) return false;
  const prevPath = prev.path;
  const nextPath = next.path;
  if (!prevPath || !nextPath) return false;
  return prevPath === nextPath;
}

/** Stable id for an expanded step, falling back to its position in the list. */
function stepIdOrIndex(step: ExpandedWorkflowStep, index: number): string {
  return step.id ?? step.original?.id ?? `step_${index}`;
}

/** Logical key under which `perStepToolResults` stores this step's data. */
function toolResultBindingKey(step: ExpandedWorkflowStep, index: number): string {
  return step.toolResultBinding ?? stepIdOrIndex(step, index);
}

/**
 * High-risk action types — used for `confirmationMode: "high-risk-only"` and
 * for the legacy dangerous-step set the parallel scheduler uses.
 */
const HIGH_RISK_ACTION_TYPES = new Set<AgentAction["type"]>([
  "submit",
  "reset",
  "applyPreset",
  "runWorkflow",
]);

function isHighRiskExpandedStep(step: ExpandedWorkflowStep): boolean {
  if (step.toolName) {
    // Tool calls are always at least medium risk; treat trainLora /
    // generate* as high so confirmStep gets a chance to gate them.
    return true;
  }
  return !!step.action && HIGH_RISK_ACTION_TYPES.has(step.action.type);
}

function reconstructAgentWorkflowStep(step: ExpandedWorkflowStep, index: number): AgentWorkflowStep {
  if (step.original) return step.original;
  // Best-effort reconstruction for replan/persist when the expansion path
  // didn't preserve the original (older code paths). We synthesise a
  // minimum AgentWorkflowStep that round-trips through `expandWorkflowAction`.
  if (step.toolName) {
    return {
      path: step.path,
      actionType: "",
      payload: "",
      label: step.label,
      id: stepIdOrIndex(step, index),
      toolName: step.toolName,
      ...(step.toolArgs ? { toolArgs: step.toolArgs } : {}),
      ...(step.toolResultBinding ? { toolResultBinding: step.toolResultBinding } : {}),
      ...(step.dependsOn?.length ? { dependsOn: step.dependsOn } : {}),
      ...(step.retryPolicy ? { retryPolicy: step.retryPolicy } : {}),
    };
  }
  return {
    path: step.path,
    actionType: step.action?.type ?? "",
    payload: "",
    label: step.label,
    id: stepIdOrIndex(step, index),
    ...(step.dependsOn?.length ? { dependsOn: step.dependsOn } : {}),
    ...(step.retryPolicy ? { retryPolicy: step.retryPolicy } : {}),
  };
}

let _runIdCounter = 0;
function generateRunId(): string {
  _runIdCounter += 1;
  return `run_${Date.now().toString(36)}_${_runIdCounter}`;
}

/** True when this step needs an interactive confirmation before dispatch. */
function shouldRequestStepConfirm(
  mode: RunWorkflowAction["confirmationMode"],
  step: ExpandedWorkflowStep
): boolean {
  if (mode === "step-by-step") return true;
  if (mode === "high-risk-only") return isHighRiskExpandedStep(step);
  return false;
}

/**
 * Navigate + settle + (optionally) wait for the destination page handler to
 * register. Centralised so sequential and parallel paths apply the exact same
 * precision policy. Returns the readiness signal so callers can log /
 * surface telemetry — the orchestrator does NOT abort on a false return
 * because the dispatch layer's silent-enqueue + retry-on-register path will
 * still satisfy the action; we just wanted to give it the best chance to run
 * synchronously.
 */
async function navigateAndSettle(
  path: string,
  ctx: GlobalAgentExecutionContext
): Promise<{ ready: boolean }> {
  await ctx.navigate(path);
  const settle = ctx.waitAfterNavigateMs ?? 450;
  if (settle > 0) await wait(settle);
  if (!ctx.awaitPageReady) return { ready: true };
  const timeoutMs = ctx.pageReadyTimeoutMs ?? 4000;
  try {
    const ready = await ctx.awaitPageReady(path, { timeoutMs });
    log("navigate.ready", { path, ready, timeoutMs });
    return { ready };
  } catch (err) {
    log("navigate.ready_error", {
      path,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { ready: false };
  }
}

function flag(key: string) {
  try {
    const v = (import.meta as any).env?.[key];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  } catch {}
  try {
    const v = (globalThis as any).process?.env?.[key];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  } catch {}
  return "";
}

function disabled(v: string) {
  return ["0","false","off","no"].includes(v.toLowerCase());
}

function telemetryEnabled() {
  return ["1","true","on"].includes(flag("VITE_ENABLE_GLOBAL_AGENT_TELEMETRY").toLowerCase());
}

function log(event: string, data: any = {}) {
  if (!telemetryEnabled()) return;
  console.groupCollapsed(`[GlobalAgent] ${event}`);
  console.info({ event, ...data, at: Date.now() });
  console.groupEnd();
}

export function workflowsEnabled() {
  return !disabled(flag("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS"));
}

/**
 * Returns true when the parallel scheduler should be used. Two conditions
 * must BOTH hold:
 *
 *   1. The `VITE_ENABLE_ORB_PARALLEL_SCHEDULER` env flag is on. This is the
 *      kill-switch that lets ops disable parallel UI dispatch instantly if a
 *      regression is detected — defaults off until browser e2e runs against
 *      production.
 *   2. The workflow declares at least one step with explicit `dependsOn`.
 *      Without explicit deps the planner just gave us declared order, and
 *      our same-page sequencing would already serialise everything, so
 *      parallelism saves nothing.
 *
 * Same-page steps are always sequenced regardless (race protection lives in
 * the topo sort itself), so even when parallel mode is on, two UI dispatches
 * never hit the same page concurrently.
 */
/**
 * Internal: execute a workflow using the DAG scheduler. Same-page steps are
 * automatically sequenced; cross-page independent steps run in batches with
 * concurrency capped at 3 (configurable via VITE_ORB_PARALLEL_CONCURRENCY).
 *
 * Failure semantics:
 *   - First failure aborts subsequent batches (matches sequential behaviour).
 *   - Cycle in the DAG → fall back to sequential, log telemetry.
 */
async function executeWorkflowParallel(
  action: RunWorkflowAction,
  expandedSteps: ReturnType<typeof expandWorkflowAction>,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
  // Build AgentWorkflowStep[] with stable ids from the original action.steps so
  // explicit dependsOn entries (which reference declared step ids) resolve.
  const sourceSteps: AgentWorkflowStep[] = action.steps.map((step, index) => ({
    ...step,
    id: step.id ?? `step_${index}`,
  }));
  const ided = ensureStepIds(sourceSteps);
  const idToExpanded = new Map<string, typeof expandedSteps[number]>();
  ided.forEach((step, index) => idToExpanded.set(step.id, expandedSteps[index]));

  const { batches, cycle, implicitChainEdges } = topologicalBatches(ided);

  if (cycle) {
    log("workflow.scheduler_cycle", { name: action.name, cycle });
    // Fall back to sequential — never enter parallel mode with a cycle.
    // Sequential will re-run the budget hook; that's fine (idempotent).
    return executeWorkflowSequential(action, expandedSteps, ctx);
  }

  log("workflow.parallel_start", {
    name: action.name,
    batches: batches.length,
    implicitChainEdges: implicitChainEdges.length,
  });

  const concurrencyRaw = parseInt(flag("VITE_ORB_PARALLEL_CONCURRENCY"), 10);
  const concurrency =
    Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.min(concurrencyRaw, 8) : 3;

  const allResults: AgentActionResult[] = [];
  const declaredIndex = new Map<string, number>();
  ided.forEach((step, index) => declaredIndex.set(step.id, index));
  // Track the path we believe the SPA is currently on. Within a single batch
  // the DAG scheduler guarantees no two steps share a path (same-page chains
  // are forced sequential), so updating this from concurrent slice tasks is
  // safe — no two writers ever race for the same destination.
  let currentPath: string | undefined = ctx.currentPath ?? ctx.currentPage?.pagePath;

  // Tool results threaded across batches. Concurrent writes within a batch
  // are funneled through a "deferred entry" pattern so we never race-push
  // duplicate stepIds: each Promise.all task returns a typed entry, then
  // the outer for-loop merges them in deterministic order.
  const perStepToolResults: NonNullable<GlobalAgentExecutionContext["perStepToolResults"]> =
    ctx.perStepToolResults ? [...ctx.perStepToolResults] : [];

  for (const batch of batches) {
    let cursor = 0;
    while (cursor < batch.length) {
      const slice = batch.slice(cursor, cursor + concurrency);

      type SliceTaskResult = {
        result: AgentActionResult;
        currentPath: string | undefined;
        toolEntry?: { stepId: string; entry: { ok: boolean; data?: unknown } };
      };

      const sliceResults: SliceTaskResult[] = await Promise.all(
        slice.map(async (batchStep): Promise<SliceTaskResult> => {
          const expanded = idToExpanded.get(batchStep.id);
          if (!expanded) {
            return {
              result: { ok: false, reason: `scheduler: missing expanded step ${batchStep.id}` },
              currentPath,
            };
          }
          // Snapshot perStepToolResults once at task entry so concurrent
          // slice tasks see a stable view of upstream results. Within a
          // single batch the topology guarantees no cross-batch deps so
          // concurrent tasks never need to read each other's tool data.
          const snapshotResults = [...perStepToolResults];
          const declared = declaredIndex.get(batchStep.id) ?? 0;
          const outcome = await runStepWithRetry(expanded, declared, {
            ctx,
            perStepToolResults: snapshotResults,
            currentPath,
            currentPageContext: ctx.currentPage,
            total: ided.length,
          });
          // The snapshot may have gained a tool entry for THIS step. Pluck
          // it out and surface to the caller for deterministic merge.
          const ourBinding = toolResultBindingKey(expanded, declared);
          let toolEntry: SliceTaskResult["toolEntry"];
          for (const e of snapshotResults) {
            if (e.stepId !== ourBinding) continue;
            const last = e.toolResults[e.toolResults.length - 1];
            if (last) toolEntry = { stepId: ourBinding, entry: last };
            break;
          }
          return { result: outcome.result, currentPath: outcome.currentPath, toolEntry };
        })
      );

      // Deterministic merge: walk slice in declared order so re-runs are stable.
      for (const r of sliceResults) {
        if (r.currentPath) currentPath = r.currentPath;
        if (r.toolEntry) {
          const existing = perStepToolResults.find(e => e.stepId === r.toolEntry!.stepId);
          if (existing) {
            existing.toolResults.push(r.toolEntry.entry);
          } else {
            perStepToolResults.push({
              stepId: r.toolEntry.stepId,
              toolResults: [r.toolEntry.entry],
            });
          }
        }
      }
      const batchResults = sliceResults.map(r => r.result);
      allResults.push(...batchResults);
      const failed = batchResults.find(r => !r.ok);
      if (failed) {
        log("workflow.parallel_fail", { name: action.name, reason: failed.reason });
        return {
          ok: false,
          results: allResults,
          reason: failed.reason,
          workflowName: action.name,
        };
      }
      cursor += concurrency;
    }
  }

  log("workflow.parallel_complete", { name: action.name });
  return { ok: true, results: allResults, workflowName: action.name, endingPath: currentPath };
}

/**
 * Internal: the original sequential loop body. Extracted so the parallel
 * path can fall back to it on cycle detection without duplicating code.
 *
 * Wires Tasks 1-4: tool-call dispatch (`toolName`), retry / replan, run-state
 * persistence + resume, and step-by-step confirmation. All four are opt-in via
 * either a workflow field or a `ctx` hook — without those, the loop reduces
 * to the legacy navigate + dispatch behaviour.
 */
async function executeWorkflowSequential(
  action: RunWorkflowAction,
  initialSteps: ReturnType<typeof expandWorkflowAction>,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
  log("workflow.start", { name: action.name, total: initialSteps.length });

  // The budget gate already ran in `executeGlobalWorkflow` (single entry
  // point) — the workflow's `confirmationMode` may have been upgraded
  // before we got here. Trust whatever the action says.
  const confirmationMode = action.confirmationMode;

  // ── Task 3: resume from persisted run state ──────────────────────────
  const runId = ctx.runId ?? ctx.resumeFromRunId ?? generateRunId();
  let runState: WorkflowRunState | null = null;
  if (ctx.resumeFromRunId && ctx.loadRunState) {
    runState = await ctx.loadRunState(ctx.resumeFromRunId);
    if (runState) {
      log("workflow.resume", {
        runId: runState.runId,
        completed: runState.completedStepIds.length,
      });
    }
  }
  if (!runState && ctx.persistRunState) {
    runState = {
      runId,
      workflowName: action.name,
      totalSteps: initialSteps.length,
      completedStepIds: [],
      perStepToolResults: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // Tool results carry across the run so `${stepId.key}` references resolve.
  // Seeded from ctx (caller may pre-populate from a parent workflow) and
  // from a resumed run-state (`completedStepIds` may have tool data).
  const perStepToolResults: NonNullable<GlobalAgentExecutionContext["perStepToolResults"]> =
    ctx.perStepToolResults
      ? [...ctx.perStepToolResults]
      : [];
  if (runState) {
    for (const entry of runState.perStepToolResults) {
      if (!perStepToolResults.find(e => e.stepId === entry.stepId)) {
        perStepToolResults.push(entry);
      }
    }
  }

  const results: AgentActionResult[] = [];
  // Track the SPA's current path locally so consecutive same-page steps
  // skip both the redundant navigate() call AND the settle/readiness wait.
  let currentPath: string | undefined = ctx.currentPath ?? ctx.currentPage?.pagePath;

  // Steps may be replaced mid-run by the replan hook; keep the list mutable.
  let steps: ExpandedWorkflowStep[] = [...initialSteps];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepId = stepIdOrIndex(s, i);
    log("workflow.step", { index: i, label: s.label, stepId });

    // Same-page state-mutation settle: when the previous step changed the
    // visible workspace (setTab / setModality / setMode / applyPreset) and
    // this step targets the same page, give React a chance to commit the
    // re-mount before we dispatch — otherwise fillPrompt lands on the old
    // child's bridge and the prompt input ends up empty.
    const settleMs = ctx.samePageStateMutationSettleMs ?? SAME_PAGE_STATE_MUTATION_SETTLE_MS;
    if (settleMs > 0 && i > 0 && shouldAwaitSamePageStateMutation(steps[i - 1], s)) {
      await wait(settleMs);
    }

    // ── Task 3: skip already-completed steps when resuming ──────────────
    if (runState && runState.completedStepIds.includes(stepId)) {
      log("workflow.skip_completed", { stepId, index: i });
      results.push({ ok: true, message: `skipped (already completed): ${s.label}` });
      continue;
    }

    // ── Task 4: per-step confirmation ───────────────────────────────────
    if (ctx.confirmStep && shouldRequestStepConfirm(confirmationMode, s)) {
      const decision = await ctx.confirmStep(
        reconstructAgentWorkflowStep(s, i),
        i,
        steps.length
      );
      if (decision === "abort") {
        log("workflow.confirm_abort", { stepId, index: i });
        return {
          ok: false,
          results,
          reason: `aborted at step "${s.label}"`,
          workflowName: action.name,
          endingPath: currentPath,
        };
      }
      if (decision === "skip") {
        log("workflow.confirm_skip", { stepId, index: i });
        results.push({ ok: true, message: `skipped by user: ${s.label}` });
        if (runState) {
          runState = {
            ...runState,
            completedStepIds: [...runState.completedStepIds, stepId],
            updatedAt: Date.now(),
          };
          if (ctx.persistRunState) await ctx.persistRunState(runState);
        }
        continue;
      }
      // "proceed" falls through to dispatch below.
    }

    // Dispatch the step — branches to tool-call vs UI dispatch internally.
    const dispatchOutcome = await runStepWithRetry(s, i, {
      ctx,
      perStepToolResults,
      currentPath,
      currentPageContext: ctx.currentPage,
      total: steps.length,
    });
    currentPath = dispatchOutcome.currentPath;
    results.push(dispatchOutcome.result);

    if (dispatchOutcome.result.ok) {
      // ── Perception loop: optional post-step verification ────────────
      // The hook returns a verdict drawn from the post-step snapshot via
      // orb-perception-loop.evaluateStepOutcome. We translate the verdict
      // into the orchestrator's existing primitives (retry / replan / abort)
      // so the perception layer doesn't need its own control flow.
      if (ctx.observeAfterStep) {
        const observation = await ctx.observeAfterStep({
          step: reconstructAgentWorkflowStep(s, i),
          index: i,
          total: steps.length,
          result: dispatchOutcome.result,
        });
        const recommendation = observation?.recommendation ?? "proceed";
        if (recommendation === "abort") {
          log("workflow.perception_abort", {
            stepId,
            reason: observation?.reason,
          });
          if (runState) {
            runState = {
              ...runState,
              failedAt: stepId,
              failReason: observation?.reason ?? "perception abort",
              updatedAt: Date.now(),
            };
            if (ctx.persistRunState) await ctx.persistRunState(runState);
          }
          return {
            ok: false,
            results,
            reason: `perception: ${observation?.reason ?? "verdict=abort"}`,
            workflowName: action.name,
            endingPath: currentPath,
          };
        }
        if (recommendation === "retry") {
          // Retry consumes one slot of the policy budget — but if the policy
          // is the default (1 attempt) we still allow a single perception
          // retry, capped to one extra attempt to prevent loops.
          log("workflow.perception_retry", { stepId });
          const retryOutcome = await runStepWithRetry(s, i, {
            ctx,
            perStepToolResults,
            currentPath,
            currentPageContext: ctx.currentPage,
            total: steps.length,
          });
          currentPath = retryOutcome.currentPath;
          results[results.length - 1] = retryOutcome.result;
          if (retryOutcome.result.ok) {
            if (runState) {
              runState = {
                ...runState,
                completedStepIds: runState.completedStepIds.includes(stepId)
                  ? runState.completedStepIds
                  : [...runState.completedStepIds, stepId],
                perStepToolResults: [...perStepToolResults],
                updatedAt: Date.now(),
              };
              if (ctx.persistRunState) await ctx.persistRunState(runState);
            }
            continue;
          }
          // Retry failed — fall through into the regular fail branch by
          // synthesising a `dispatchOutcome` so the replan / skipOnFail
          // logic still runs against the perception-driven failure.
          dispatchOutcome.result = retryOutcome.result;
        } else if (recommendation === "replan") {
          log("workflow.perception_replan", {
            stepId,
            reason: observation?.reason,
          });
          // Synthesise a typed failure result so the existing replan path
          // (Task 2) takes over without duplicating logic.
          const synthetic: AgentActionResult = {
            ok: false,
            reason: `perception: ${observation?.reason ?? "no-effect"}`,
          };
          results[results.length - 1] = synthetic;
          dispatchOutcome.result = synthetic;
          // Fall through into the fail branch below.
        } else {
          // recommendation === "proceed"  → record completion as usual.
          if (runState) {
            runState = {
              ...runState,
              completedStepIds: runState.completedStepIds.includes(stepId)
                ? runState.completedStepIds
                : [...runState.completedStepIds, stepId],
              perStepToolResults: [...perStepToolResults],
              updatedAt: Date.now(),
            };
            if (ctx.persistRunState) await ctx.persistRunState(runState);
          }
          continue;
        }
      } else {
        if (runState) {
          runState = {
            ...runState,
            completedStepIds: runState.completedStepIds.includes(stepId)
              ? runState.completedStepIds
              : [...runState.completedStepIds, stepId],
            perStepToolResults: [...perStepToolResults],
            updatedAt: Date.now(),
          };
          if (ctx.persistRunState) await ctx.persistRunState(runState);
        }
        continue;
      }
    }

    // ── Task 2 fail branch ──────────────────────────────────────────────
    log("workflow.fail", { index: i, reason: dispatchOutcome.result.reason });

    if (s.retryPolicy?.skipOnFail) {
      log("workflow.skip_on_fail", { stepId, index: i });
      // Override the recorded result so callers see it as skipped.
      results[results.length - 1] = {
        ok: true,
        message: `skipped on failure: ${s.label}`,
      };
      if (runState) {
        runState = {
          ...runState,
          completedStepIds: [...runState.completedStepIds, stepId],
          updatedAt: Date.now(),
        };
        if (ctx.persistRunState) await ctx.persistRunState(runState);
      }
      continue;
    }

    if (ctx.replan) {
      const remainingOriginalSteps = steps
        .slice(i + 1)
        .map((step, idx) => reconstructAgentWorkflowStep(step, i + 1 + idx));
      const replanResult = await ctx.replan({
        failedStep: reconstructAgentWorkflowStep(s, i),
        failReason: dispatchOutcome.result.reason ?? "unknown failure",
        remainingSteps: remainingOriginalSteps,
        currentSnapshot: ctx.currentPage,
      });
      if (replanResult && replanResult.length > 0) {
        log("workflow.replan", {
          stepId,
          replacedCount: replanResult.length,
        });
        const replanWorkflow: RunWorkflowAction = {
          type: "runWorkflow",
          name: `${action.name} (replanned)`,
          steps: replanResult,
        };
        const replanExpanded = expandWorkflowAction(replanWorkflow);
        // Replace from the current position onwards, drop the failure result
        // since replan chose to recover from it.
        steps = [...steps.slice(0, i), ...replanExpanded];
        results.pop();
        // Re-run this index against the freshly inserted step.
        i -= 1;
        continue;
      }
    }

    if (runState) {
      runState = {
        ...runState,
        failedAt: stepId,
        failReason: dispatchOutcome.result.reason,
        updatedAt: Date.now(),
      };
      if (ctx.persistRunState) await ctx.persistRunState(runState);
    }

    return {
      ok: false,
      results,
      reason: dispatchOutcome.result.reason,
      workflowName: action.name,
      endingPath: currentPath,
    };
  }

  log("workflow.complete", { name: action.name });
  return { ok: true, results, workflowName: action.name, endingPath: currentPath };
}

interface RunStepContext {
  ctx: GlobalAgentExecutionContext;
  perStepToolResults: NonNullable<GlobalAgentExecutionContext["perStepToolResults"]>;
  currentPath: string | undefined;
  currentPageContext: PageAgentSnapshot | null | undefined;
  /** Total step count for the onWorkflowStep callback. */
  total: number;
  /** True for the first attempt of a step — gates onWorkflowStep firing. */
  isFirstAttempt: boolean;
}

interface RunStepOutcome {
  result: AgentActionResult;
  currentPath: string | undefined;
}

/**
 * Execute a single expanded step with `retryPolicy`-aware retries.
 * Branches on `step.toolName` to either invoke `ctx.callTool` (tool-call
 * path) or `ctx.dispatch` (UI dispatch path). Updates `perStepToolResults`
 * after every successful tool call so subsequent steps can resolve
 * `${stepId.key}` placeholders.
 */
async function runStepWithRetry(
  step: ExpandedWorkflowStep,
  index: number,
  rsCtx: Omit<RunStepContext, "isFirstAttempt">
): Promise<RunStepOutcome> {
  const policy = step.retryPolicy;
  const maxAttempts = Math.max(1, policy?.maxAttempts ?? 1);
  const backoffMs = Math.max(0, policy?.backoffMs ?? 0);

  let lastResult: AgentActionResult = { ok: false, reason: "no attempt made" };
  let pathAfter = rsCtx.currentPath;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptOutcome = await executeStepOnce(step, index, {
      ...rsCtx,
      currentPath: pathAfter,
      isFirstAttempt: attempt === 1,
    });
    pathAfter = attemptOutcome.currentPath;
    lastResult = attemptOutcome.result;
    if (attemptOutcome.result.ok) return { result: attemptOutcome.result, currentPath: pathAfter };
    if (attempt < maxAttempts && backoffMs > 0) await wait(backoffMs);
  }
  return { result: lastResult, currentPath: pathAfter };
}

/**
 * One attempt at executing a step. Resolves `${stepId.key}` refs in
 * toolArgs, navigates if the step targets a new path, then invokes either
 * `ctx.callTool` or `ctx.dispatch`. Returns the AgentActionResult plus the
 * (possibly updated) currentPath.
 */
async function executeStepOnce(
  step: ExpandedWorkflowStep,
  index: number,
  rsCtx: RunStepContext
): Promise<RunStepOutcome> {
  const { ctx, perStepToolResults } = rsCtx;
  let currentPath = rsCtx.currentPath;

  // Tool-call path — when the planner declared `toolName`, the orchestrator
  // routes through ctx.callTool instead of dispatch. The step may still
  // declare a `path` so subsequent UI steps land on the right page; navigate
  // first so a follow-up UI step doesn't pay for the page load.
  if (step.toolName) {
    if (!ctx.callTool) {
      return {
        result: { ok: false, reason: `callTool hook missing for tool ${step.toolName}` },
        currentPath,
      };
    }
    if (step.path && step.path !== currentPath) {
      await navigateAndSettle(step.path, ctx);
      currentPath = step.path;
    }
    if (rsCtx.isFirstAttempt) {
      ctx.onWorkflowStep?.({
        index,
        total: rsCtx.total,
        label: step.label,
        path: step.path,
        // Synthetic action for telemetry — tool-call steps don't have a real
        // AgentAction; the consumer treats `search.query` as the tool name.
        action: { type: "search", query: step.toolName },
      });
    }
    const resolvedArgs = resolveStepRefsInArgs({
      args: step.toolArgs ?? {},
      perStepToolResults,
    }) ?? {};
    let toolRes: { ok: boolean; data?: unknown; reason?: string };
    try {
      toolRes = await ctx.callTool(step.toolName, resolvedArgs);
    } catch (err) {
      toolRes = {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    const bindingKey = toolResultBindingKey(step, index);
    const existingEntry = perStepToolResults.find(e => e.stepId === bindingKey);
    if (existingEntry) {
      existingEntry.toolResults.push({ ok: toolRes.ok, data: toolRes.data });
    } else {
      perStepToolResults.push({
        stepId: bindingKey,
        toolResults: [{ ok: toolRes.ok, data: toolRes.data }],
      });
    }
    return {
      result: toolRes.ok
        ? { ok: true, message: `tool ${step.toolName} ok` }
        : { ok: false, reason: toolRes.reason ?? `tool ${step.toolName} failed` },
      currentPath,
    };
  }

  // UI dispatch path (legacy behaviour).
  if (!step.action) {
    return {
      result: { ok: false, reason: `step "${step.label}" has neither toolName nor action` },
      currentPath,
    };
  }

  const fallbackForStep = step.path
    ? null
    : globalAgentRegistry.planWithFallback(step.action, rsCtx.currentPageContext)?.steps[0] ?? null;
  const effectivePath = step.path ?? fallbackForStep?.path;
  if (effectivePath && effectivePath !== currentPath) {
    await navigateAndSettle(effectivePath, ctx);
    currentPath = effectivePath;
  }
  if (rsCtx.isFirstAttempt) {
    ctx.onWorkflowStep?.({
      index,
      total: rsCtx.total,
      label: step.label,
      path: effectivePath,
      action: step.action,
    });
  }
  if (step.action.type === "navigate") {
    return {
      result: { ok: true, message: `navigated to ${effectivePath ?? step.action.path}` },
      currentPath,
    };
  }
  const targetPageId = effectivePath
    ? globalAgentRegistry.findByPath(effectivePath)?.pageId ?? fallbackForStep?.targetPageId
    : globalAgentRegistry.planWithFallback(step.action, rsCtx.currentPageContext)?.steps[0]?.targetPageId;
  const res = normalizeResult(
    await ctx.dispatch(step.action, {
      targetPageId,
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
      source: ctx.source,
      intentSummary: ctx.intentSummary,
    })
  );
  return { result: res, currentPath };
}

export function parallelSchedulerEnabled(action: RunWorkflowAction): boolean {
  const envOn = ["1", "true", "on"].includes(
    flag("VITE_ENABLE_ORB_PARALLEL_SCHEDULER").toLowerCase()
  );
  if (!envOn) return false;
  return action.steps.some(step => Array.isArray(step.dependsOn) && step.dependsOn.length > 0);
}

export async function executeGlobalWorkflow(action: RunWorkflowAction, ctx: GlobalAgentExecutionContext): Promise<GlobalAgentExecutionResult> {
  if (!workflowsEnabled()) {
    log("workflow.disabled", { name: action.name });
    return { ok: false, results: [], reason: "workflow disabled", workflowName: action.name };
  }

  const steps = expandWorkflowAction(action);
  if (steps.length === 0) {
    log("workflow.validation_failed", { name: action.name, reason: "no executable steps" });
    return {
      ok: false,
      results: [{ ok: false, reason: "workflow has no executable steps" }],
      reason: "workflow has no executable steps",
      workflowName: action.name,
    };
  }

  // Cost governor pre-flight runs ONCE at this entry, BEFORE either the
  // parallel or sequential branch. Caller-owned estimate + budget gate.
  // - "abort"   → typed failure with no side effects
  // - "confirm" → upgrade `confirmationMode` to "step-by-step" + force the
  //               sequential branch so confirmStep can fire per step (the
  //               parallel scheduler doesn't expose per-step confirms).
  let workflowAction: RunWorkflowAction = action;
  if (ctx.estimateAndConfirmBudget) {
    const decision = await ctx.estimateAndConfirmBudget({
      workflowName: action.name,
      steps: action.steps,
    });
    if (decision.decision === "abort") {
      log("workflow.budget_abort", {
        name: action.name,
        reason: decision.reason,
      });
      return {
        ok: false,
        results: [],
        reason: `budget abort: ${decision.reason ?? "user cancelled"}`,
        workflowName: action.name,
      };
    }
    if (decision.decision === "confirm") {
      log("workflow.budget_upgrade_confirm", { name: action.name });
      workflowAction =
        action.confirmationMode === "step-by-step"
          ? action
          : { ...action, confirmationMode: "step-by-step" };
      return executeWorkflowSequential(workflowAction, steps, ctx);
    }
  }

  // Opt-in parallel path: when the flag is on AND at least one step declares
  // dependsOn, run the topological scheduler. Otherwise delegate to the
  // legacy sequential helper — same code path that's been in production.
  if (parallelSchedulerEnabled(workflowAction)) {
    return executeWorkflowParallel(workflowAction, steps, ctx);
  }
  return executeWorkflowSequential(workflowAction, steps, ctx);
}

export async function executeGlobalAction(action: AgentAction, ctx: GlobalAgentExecutionContext) {
  if (action.type === "runWorkflow") return executeGlobalWorkflow(action, ctx);

  // planWithFallback: when no live page is registered for this action (the
  // common case from the /agent host where only the orb chat page itself is
  // mounted), resolve a destination from the static capability registry so
  // we navigate to a known-good page instead of failing with "no route found".
  // The page-agent layer's enqueue+drain takes care of dispatching the action
  // once the destination page mounts and registers.
  const plan = globalAgentRegistry.planWithFallback(action, ctx.currentPage);
  if (!plan) {
    log("action.no-plan", { actionType: action.type });
    return {
      ok: false,
      plan: undefined,
      results: [{ ok: false, reason: `no route found for action:${action.type}` }],
      reason: "no route found",
    };
  }

  log("action.plan", {
    actionType: action.type,
    reason: plan.reason,
    steps: plan.steps.length,
  });

  const results: AgentActionResult[] = [];
  let currentPath: string | undefined = ctx.currentPath ?? ctx.currentPage?.pagePath;

  for (const step of plan.steps) {
    if (step.path && step.path !== currentPath) {
      await navigateAndSettle(step.path, ctx);
      currentPath = step.path;
    }

    // Pure navigate plans are fully satisfied by ctx.navigate() above; the
    // page-agent layer rejects dispatched navigate actions (orb owns nav),
    // so re-dispatching would surface a fake failure.
    if (step.action.type === "navigate") {
      results.push({ ok: true, message: `navigated to ${step.path ?? step.action.path}` });
      continue;
    }

    const res = normalizeResult(
      await ctx.dispatch(step.action, {
        targetPageId: step.targetPageId,
        enqueueIfNoHandler: true,
        requireConfirmation: ctx.requireConfirmation ?? false,
        source: ctx.source,
        intentSummary: ctx.intentSummary,
      })
    );

    results.push(res);

    if (!res.ok) {
      log("action.fail", { actionType: step.action.type, reason: res.reason });
      return {
        ok: false,
        plan,
        results,
        reason: res.reason ?? "action execution failed",
        endingPath: currentPath,
      };
    }
  }

  log("action.complete", { actionType: action.type });
  return { ok: true, plan, results, endingPath: currentPath };
}

export async function executeGlobalActions(actions: AgentAction[], ctx: GlobalAgentExecutionContext) {
  const results: GlobalAgentExecutionResult[] = [];
  // Thread the inferred path forward across actions. After each action lands
  // on a page, the next action treats that page as "current" — same precision
  // policy as same-page steps inside a workflow: no redundant navigate, no
  // redundant settle wait, no readiness re-poll.
  let runningPath: string | undefined = ctx.currentPath ?? ctx.currentPage?.pagePath;
  const settleMs = ctx.samePageStateMutationSettleMs ?? SAME_PAGE_STATE_MUTATION_SETTLE_MS;
  for (let idx = 0; idx < actions.length; idx += 1) {
    const action = actions[idx];
    const prevAction = idx > 0 ? actions[idx - 1] : undefined;
    // Same-page settle when the previous action mutated tab / modality / mode
    // / preset on the page we're still sitting on. Mirrors the in-workflow
    // settle so chained top-level dispatches don't race against the React
    // re-mount and end up filling the wrong child's prompt.
    if (
      settleMs > 0 &&
      prevAction &&
      STATE_MUTATING_ACTION_TYPES.has(prevAction.type)
    ) {
      await wait(settleMs);
    }
    const localCtx: GlobalAgentExecutionContext =
      runningPath === (ctx.currentPath ?? ctx.currentPage?.pagePath)
        ? ctx
        : { ...ctx, currentPath: runningPath };
    const result = await executeGlobalAction(action, localCtx);
    results.push(result);
    if (!result.ok) break;
    if (result.endingPath) runningPath = result.endingPath;
  }
  return results;
}

export async function executeClosedLoopPlan(args: {
  goal: string;
  ctx: GlobalAgentExecutionContext;
  context?: Record<string, unknown>;
  maxSteps?: number;
}): Promise<{ ok: boolean; observations: StepObservation[]; reason?: string }> {
  const { goal, ctx } = args;
  if (!ctx.planNextStep || !ctx.executePlanStep) {
    return { ok: false, observations: [], reason: "closed-loop hooks missing" };
  }
  const observations: StepObservation[] = [];
  const maxSteps = Math.max(1, Math.min(args.maxSteps ?? 14, 50));

  for (let i = 0; i < maxSteps; i += 1) {
    const next = await ctx.planNextStep({
      goal,
      previousObservations: observations,
      context: args.context,
    });
    if (!next) return { ok: true, observations };

    const executed = await ctx.executePlanStep(next);
    const observation: StepObservation = {
      step: next,
      success: executed.ok,
      evidence: executed.evidence,
      outputRefId: executed.outputRefId,
    };
    observations.push(observation);
    if (ctx.onObservation) await ctx.onObservation(observation);
    if (!executed.ok) return { ok: false, observations, reason: executed.evidence };
  }
  return { ok: false, observations, reason: "max_steps_reached" };
}
