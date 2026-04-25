/*
 * shared/global-agent-orchestrator.ts
 */

import type {
  AgentAction,
  AgentActionResult,
  PageAgentSnapshot,
  RunWorkflowAction,
} from "./agent-actions";
import { globalAgentRegistry, type GlobalAgentPlan } from "./global-agent-registry";
import { expandWorkflowAction } from "./global-agent-workflows";

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

export function shouldAskBeforeAct(actions: AgentAction[]): boolean {
  return actions.some(action => {
    if (action.type === "runWorkflow") {
      return action.steps.length > 1 || findDangerousWorkflowSteps(action).length > 0;
    }
    return isDangerousAction(action);
  });
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

    const targetPageId = s.path
      ? globalAgentRegistry.findByPath(s.path)?.pageId
      : globalAgentRegistry.plan(s.action, ctx.currentPage)?.steps[0]?.targetPageId;

    const res = normalizeResult(await ctx.dispatch(s.action, {
      targetPageId,
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
      source: ctx.source,
      intentSummary: ctx.intentSummary,
    }));

    results.push(res);

    if (!res.ok) {
      log("workflow.fail", { index: i, reason: res.reason });
      return { ok: false, results, reason: res.reason, workflowName: action.name };
    }
  }

  log("workflow.complete", { name: action.name });

  return { ok: true, results, workflowName: action.name };
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
