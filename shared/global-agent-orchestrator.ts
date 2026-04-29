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
import { expandWorkflowAction } from "./global-agent-workflows";
import { topologicalBatches, ensureStepIds } from "./orb-dag-scheduler";

export interface GlobalAgentExecutionContext {
  currentPage?: PageAgentSnapshot | null;
  navigate: (path: string) => Promise<void> | void;
  dispatch: (action: AgentAction, opts?: GlobalDispatchOptions) => Promise<AgentActionResult>;
  waitAfterNavigateMs?: number;
  source?: "ai-chat" | "orb-guide" | "manual";
  requireConfirmation?: boolean;
  intentSummary?: string;
  requireConfirmationForWorkflowSteps?: boolean;
  onWorkflowStep?: (step: GlobalWorkflowStepProgress) => void;
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
  let stepIndex = 0;

  for (const batch of batches) {
    let cursor = 0;
    while (cursor < batch.length) {
      const slice = batch.slice(cursor, cursor + concurrency);
      const batchResults: AgentActionResult[] = await Promise.all(
        slice.map(async (batchStep): Promise<AgentActionResult> => {
          const expanded = idToExpanded.get(batchStep.id);
          if (!expanded) {
            return { ok: false, reason: `scheduler: missing expanded step ${batchStep.id}` };
          }
          // Per-step navigate happens BEFORE the dispatch, exactly like the
          // sequential loop. Same-page steps already live in different
          // batches so concurrent navigates can only target different paths.
          if (expanded.path && expanded.path !== ctx.currentPage?.pagePath) {
            await ctx.navigate(expanded.path);
            await wait(ctx.waitAfterNavigateMs ?? 450);
          }
          ctx.onWorkflowStep?.({
            index: stepIndex++,
            total: ided.length,
            label: expanded.label,
            path: expanded.path,
            action: expanded.action,
          });
          // Pure navigate steps are fully satisfied by ctx.navigate() above;
          // the page-agent layer rejects dispatched navigate actions.
          if (expanded.action.type === "navigate") {
            const navOk: AgentActionResult = {
              ok: true,
              message: `navigated to ${expanded.path ?? expanded.action.path}`,
            };
            return navOk;
          }
          const targetPageId = expanded.path
            ? globalAgentRegistry.findByPath(expanded.path)?.pageId
            : globalAgentRegistry.plan(expanded.action, ctx.currentPage)?.steps[0]?.targetPageId;
          return normalizeResult(
            await ctx.dispatch(expanded.action, {
              targetPageId,
              enqueueIfNoHandler: true,
              requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
              source: ctx.source,
              intentSummary: ctx.intentSummary,
            })
          );
        })
      );
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
  return { ok: true, results: allResults, workflowName: action.name };
}

/**
 * Internal: the original sequential loop body. Extracted so the parallel
 * path can fall back to it on cycle detection without duplicating code.
 */
async function executeWorkflowSequential(
  action: RunWorkflowAction,
  steps: ReturnType<typeof expandWorkflowAction>,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
  log("workflow.start", { name: action.name, total: steps.length });
  const results: AgentActionResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    log("workflow.step", { index: i, label: s.label });
    ctx.onWorkflowStep?.({ index: i, total: steps.length, label: s.label, path: s.path, action: s.action });

    if (s.path && s.path !== ctx.currentPage?.pagePath) {
      await ctx.navigate(s.path);
      await wait(ctx.waitAfterNavigateMs ?? 450);
    }
    // Pure navigate steps are fully satisfied by ctx.navigate() above; the
    // page-agent layer intentionally rejects dispatched navigate actions
    // (orb owns navigation), so re-dispatching would surface a fake failure.
    if (s.action.type === "navigate") {
      results.push({ ok: true, message: `navigated to ${s.path ?? s.action.path}` });
      continue;
    }
    const targetPageId = s.path
      ? globalAgentRegistry.findByPath(s.path)?.pageId
      : globalAgentRegistry.plan(s.action, ctx.currentPage)?.steps[0]?.targetPageId;
    const res = normalizeResult(
      await ctx.dispatch(s.action, {
        targetPageId,
        enqueueIfNoHandler: true,
        requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
        source: ctx.source,
        intentSummary: ctx.intentSummary,
      })
    );
    results.push(res);
    if (!res.ok) {
      log("workflow.fail", { index: i, reason: res.reason });
      return { ok: false, results, reason: res.reason, workflowName: action.name };
    }
  }

  log("workflow.complete", { name: action.name });
  return { ok: true, results, workflowName: action.name };
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

  // Opt-in parallel path: when the flag is on AND at least one step declares
  // dependsOn, run the topological scheduler. Otherwise delegate to the
  // legacy sequential helper — same code path that's been in production.
  if (parallelSchedulerEnabled(action)) {
    return executeWorkflowParallel(action, steps, ctx);
  }
  return executeWorkflowSequential(action, steps, ctx);
}

export async function executeGlobalAction(action: AgentAction, ctx: GlobalAgentExecutionContext) {
  if (action.type === "runWorkflow") return executeGlobalWorkflow(action, ctx);

  const plan = globalAgentRegistry.plan(action, ctx.currentPage);
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

  for (const step of plan.steps) {
    if (step.path && step.path !== ctx.currentPage?.pagePath) {
      await ctx.navigate(step.path);
      await wait(ctx.waitAfterNavigateMs ?? 450);
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
      };
    }
  }

  log("action.complete", { actionType: action.type });
  return { ok: true, plan, results };
}

export async function executeGlobalActions(actions: AgentAction[], ctx: GlobalAgentExecutionContext) {
  const results: GlobalAgentExecutionResult[] = [];
  for (const action of actions) {
    const result = await executeGlobalAction(action, ctx);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}
