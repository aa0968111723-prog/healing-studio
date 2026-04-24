/*
 * shared/global-agent-orchestrator.ts
 * ───────────────────────────────────────────────────────────────
 * Executes site-wide AI agent plans and multi-page workflows.
 */

import type { AgentAction, AgentActionResult, PageAgentSnapshot } from "./agent-actions";
import { globalAgentRegistry, type GlobalAgentPlan } from "./global-agent-registry";
import { expandWorkflowAction } from "./global-agent-workflows";

export interface GlobalAgentExecutionContext {
  currentPage?: PageAgentSnapshot | null;
  navigate: (path: string) => Promise<void> | void;
  dispatch: (
    action: AgentAction,
    opts?: {
      targetPageId?: string;
      enqueueIfNoHandler?: boolean;
      requireConfirmation?: boolean;
      intentSummary?: string;
      source?: "ai-chat" | "orb-guide" | "manual";
    }
  ) => Promise<AgentActionResult>;
  waitAfterNavigateMs?: number;
  source?: "ai-chat" | "orb-guide" | "manual";
  requireConfirmation?: boolean;
  intentSummary?: string;
  /** Workflow 內部 submit 是否也要確認；預設 false，避免每步都跳卡片 */
  requireConfirmationForWorkflowSteps?: boolean;
  onWorkflowStep?: (step: {
    index: number;
    total: number;
    label: string;
    path?: string;
    action: AgentAction;
  }) => void;
}

export interface GlobalAgentExecutionResult {
  ok: boolean;
  plan?: GlobalAgentPlan;
  results: AgentActionResult[];
  reason?: string;
  workflowName?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeResult(result: AgentActionResult | undefined): AgentActionResult {
  return result ?? { ok: true };
}

export async function executeGlobalAction(
  action: AgentAction,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
  if (action.type === "runWorkflow") {
    return executeGlobalWorkflow(action, ctx);
  }

  const plan = globalAgentRegistry.plan(action, ctx.currentPage);

  if (!plan) {
    return {
      ok: false,
      results: [],
      reason: `No registered page can handle action: ${action.type}`,
    };
  }

  const results: AgentActionResult[] = [];

  for (const step of plan.steps) {
    if (step.path && step.path !== ctx.currentPage?.pagePath) {
      await ctx.navigate(step.path);
      await wait(ctx.waitAfterNavigateMs ?? 350);
    }

    if (step.action.type === "navigate") {
      results.push({ ok: true, message: `navigated:${step.action.path}` });
      continue;
    }

    const result = normalizeResult(await ctx.dispatch(step.action, {
      targetPageId: step.targetPageId,
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmation,
      intentSummary: ctx.intentSummary,
      source: ctx.source ?? "ai-chat",
    }));

    results.push(result);
    if (!result.ok) {
      return { ok: false, plan, results, reason: result.reason };
    }
  }

  return { ok: true, plan, results };
}

export async function executeGlobalWorkflow(
  action: Extract<AgentAction, { type: "runWorkflow" }>,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
  const expanded = expandWorkflowAction(action);
  if (expanded.length === 0) {
    return {
      ok: false,
      workflowName: action.name,
      results: [],
      reason: `Workflow has no executable steps: ${action.name}`,
    };
  }

  const results: AgentActionResult[] = [];
  const total = expanded.length;

  for (let index = 0; index < expanded.length; index += 1) {
    const step = expanded[index];
    ctx.onWorkflowStep?.({
      index,
      total,
      label: step.label,
      path: step.path,
      action: step.action,
    });

    if (step.path && step.path !== ctx.currentPage?.pagePath) {
      await ctx.navigate(step.path);
      await wait(ctx.waitAfterNavigateMs ?? 450);
    }

    if (step.action.type === "navigate") {
      await ctx.navigate(step.action.path);
      await wait(ctx.waitAfterNavigateMs ?? 450);
      results.push({ ok: true, message: `workflow navigated:${step.action.path}` });
      continue;
    }

    const plan = globalAgentRegistry.plan(step.action, ctx.currentPage);
    const targetPageId = plan?.steps[0]?.targetPageId;
    const result = normalizeResult(await ctx.dispatch(step.action, {
      targetPageId,
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
      intentSummary: ctx.intentSummary ?? action.name,
      source: ctx.source ?? "ai-chat",
    }));

    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        workflowName: action.name,
        results,
        reason: `${step.label}: ${result.reason}`,
      };
    }
  }

  return {
    ok: true,
    workflowName: action.name,
    results,
    plan: {
      reason: `Executed workflow: ${action.name}`,
      steps: expanded.map(step => ({ path: step.path, action: step.action, label: step.label })),
    },
  };
}

export async function executeGlobalActions(
  actions: AgentAction[],
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult[]> {
  const all: GlobalAgentExecutionResult[] = [];
  for (const action of actions) {
    all.push(await executeGlobalAction(action, ctx));
  }
  return all;
}
