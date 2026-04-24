/*
 * shared/global-agent-orchestrator.ts
 * ───────────────────────────────────────────────────────────────
 * Executes site-wide AI agent plans.
 */

import type { AgentAction, AgentActionResult, PageAgentSnapshot } from "./agent-actions";
import { globalAgentRegistry, type GlobalAgentPlan } from "./global-agent-registry";

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
}

export interface GlobalAgentExecutionResult {
  ok: boolean;
  plan?: GlobalAgentPlan;
  results: AgentActionResult[];
  reason?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function executeGlobalAction(
  action: AgentAction,
  ctx: GlobalAgentExecutionContext
): Promise<GlobalAgentExecutionResult> {
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

    // Navigation is consumed by the orchestrator itself.
    if (step.action.type === "navigate") {
      results.push({ ok: true, message: `navigated:${step.action.path}` });
      continue;
    }

    const result = await ctx.dispatch(step.action, {
      targetPageId: step.targetPageId,
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmation,
      intentSummary: ctx.intentSummary,
      source: ctx.source ?? "ai-chat",
    });

    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        plan,
        results,
        reason: result.reason,
      };
    }
  }

  return { ok: true, plan, results };
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
