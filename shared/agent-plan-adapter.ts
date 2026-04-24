import type { AgentAction } from "./agent-actions";
import {
  agentPlanToWorkflowAction,
  safeParseAgentPlan,
  type AgentPlan,
} from "./agent-plan-schema";
import {
  evaluateAgentPlanSafety,
  type AgentPlanSafetyEvaluation,
  type AgentPlanSafetyIssue,
} from "./agent-plan-safety";

export type AgentPlanAdapterStatus =
  | "converted"
  | "clarification"
  | "blocked"
  | "invalid";

export interface AgentPlanAdapterResult {
  status: AgentPlanAdapterStatus;
  ok: boolean;
  plan?: AgentPlan;
  actions: AgentAction[];
  askBeforeAct: boolean;
  reply?: string;
  intent?: string;
  warnings: string[];
  blockers: AgentPlanSafetyIssue[];
  safety?: AgentPlanSafetyEvaluation;
  reason?: string;
  issues?: string[];
}

function stringifyPlannerOutput(raw: unknown): string {
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export function extractJsonObjectFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with fenced / embedded object extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // Continue with brace extraction.
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }

  return null;
}

export function normalizePlannerOutput(raw: unknown): unknown {
  if (typeof raw === "string") return extractJsonObjectFromText(raw);
  return raw;
}

export function adaptAgentPlanToActions(rawPlannerOutput: unknown): AgentPlanAdapterResult {
  const normalized = normalizePlannerOutput(rawPlannerOutput);

  if (!normalized) {
    return {
      status: "invalid",
      ok: false,
      actions: [],
      askBeforeAct: false,
      warnings: [],
      blockers: [],
      reason: "Planner output did not contain a JSON object.",
      issues: [stringifyPlannerOutput(rawPlannerOutput).slice(0, 500)],
    };
  }

  const parsed = safeParseAgentPlan(normalized);
  if (!parsed.ok || !parsed.plan) {
    return {
      status: "invalid",
      ok: false,
      actions: [],
      askBeforeAct: false,
      warnings: [],
      blockers: [],
      reason: parsed.reason ?? "Invalid AgentPlan.",
      issues: parsed.issues,
    };
  }

  const plan = parsed.plan;
  const safety = evaluateAgentPlanSafety(plan);
  const warnings = [
    ...plan.warnings,
    ...safety.issues
      .filter(issue => issue.severity === "warning")
      .map(issue => issue.message),
  ];
  const blockers = safety.issues.filter(issue => issue.severity === "blocker");

  if (plan.shouldAskClarification) {
    return {
      status: "clarification",
      ok: true,
      plan,
      actions: [],
      askBeforeAct: false,
      reply: plan.clarificationQuestion ?? plan.summaryForUser,
      intent: plan.intent,
      warnings,
      blockers,
      safety,
      reason: safety.summary,
    };
  }

  if (blockers.length > 0) {
    return {
      status: "blocked",
      ok: false,
      plan,
      actions: [],
      askBeforeAct: true,
      reply: `我已建立計畫，但因安全檢查暫停執行：${blockers[0]?.message ?? safety.summary}`,
      intent: plan.intent,
      warnings,
      blockers,
      safety,
      reason: safety.summary,
    };
  }

  const workflow = agentPlanToWorkflowAction(plan);
  if (!workflow) {
    return {
      status: "invalid",
      ok: false,
      plan,
      actions: [],
      askBeforeAct: false,
      reply: plan.summaryForUser,
      intent: plan.intent,
      warnings,
      blockers,
      safety,
      reason: "Plan could not be converted into a workflow action.",
    };
  }

  return {
    status: "converted",
    ok: true,
    plan,
    actions: [workflow],
    askBeforeAct: safety.askBeforeAct,
    reply: plan.summaryForUser,
    intent: plan.intent,
    warnings,
    blockers,
    safety,
    reason: safety.summary,
  };
}

export function buildAgentPlanSystemPrompt(pageSnapshotSummary?: string): string {
  return [
    "You are the schema-first planning layer for AI Director.",
    "Return only a JSON object matching AgentPlanSchema schemaVersion=agent-plan.v1.",
    "Use low-risk actions for typing, navigation and focus. Use high risk for submit/reset.",
    "If the user request is ambiguous, set shouldAskClarification=true and steps=[].",
    "Do not invent unsupported tools. Keep steps short and auditable.",
    "Every executable step should include pagePath unless it is navigate or focusElement.",
    pageSnapshotSummary ? `Available page context:\n${pageSnapshotSummary}` : "",
  ].filter(Boolean).join("\n");
}
