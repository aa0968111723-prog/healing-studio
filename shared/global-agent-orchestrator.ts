/*
 * shared/global-agent-orchestrator.ts
 */

import type { AgentAction, AgentActionResult, PageAgentSnapshot } from "./agent-actions";
import { globalAgentRegistry, type GlobalAgentPlan } from "./global-agent-registry";
import { expandWorkflowAction } from "./global-agent-workflows";

export interface GlobalAgentExecutionContext {
  currentPage?: PageAgentSnapshot | null;
  navigate: (path: string) => Promise<void> | void;
  dispatch: (action: AgentAction, opts?: any) => Promise<AgentActionResult>;
  waitAfterNavigateMs?: number;
  source?: "ai-chat" | "orb-guide" | "manual";
  requireConfirmation?: boolean;
  intentSummary?: string;
  requireConfirmationForWorkflowSteps?: boolean;
  onWorkflowStep?: (step: any) => void;
}

export interface GlobalAgentExecutionResult {
  ok: boolean;
  plan?: GlobalAgentPlan;
  results: AgentActionResult[];
  reason?: string;
  workflowName?: string;
}

function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeResult(r?: AgentActionResult): AgentActionResult {
  return r ?? { ok: true };
}

function flag(key: string) {
  try { return String((import.meta as any).env?.[key] ?? ""); } catch {}
  try { return String((globalThis as any).process?.env?.[key] ?? ""); } catch {}
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

export async function executeGlobalWorkflow(action: any, ctx: GlobalAgentExecutionContext): Promise<GlobalAgentExecutionResult> {
  if (!workflowsEnabled()) {
    log("workflow.disabled", { name: action.name });
    return { ok: false, results: [], reason: "workflow disabled", workflowName: action.name };
  }

  const steps = expandWorkflowAction(action);
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

    const res = normalizeResult(await ctx.dispatch(s.action, {
      enqueueIfNoHandler: true,
      requireConfirmation: ctx.requireConfirmationForWorkflowSteps ?? false,
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
  return { ok: true, results: [] };
}

export async function executeGlobalActions(actions: AgentAction[], ctx: GlobalAgentExecutionContext) {
  return Promise.all(actions.map(a => executeGlobalAction(a, ctx)));
}
