import type { AgentAction } from "./agent-actions";
import {
  agentPlanToWorkflowAction,
  normalizeAgentPlanVersion,
  safeParseAgentPlan,
  safeParseAgentPlanAny,
  type AgentPlan,
  type AgentPlanV3,
  type AgentPlanV3DecisionMode,
  type AgentPlanV3PreferredEngine,
  type AgentPlanV3Step,
} from "./agent-plan-schema";
import {
  evaluateAgentPlanSafety,
  evaluateAgentPlanV3Risk,
  type AgentPlanSafetyEvaluation,
  type AgentPlanSafetyIssue,
  type AgentPlanV3RiskEvaluation,
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
  /** Question for the user when the planner sets shouldAskClarification. */
  clarificationQuestion?: string;
  /** Quick-reply options paired with clarificationQuestion. */
  clarificationOptions?: string[];
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
      clarificationQuestion: plan.clarificationQuestion,
      clarificationOptions: plan.clarificationOptions,
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

// ─── AgentPlan v3 adapter + parseAndGatePlan ──────────────────────────────

export type GatedPlanStatus =
  | "converted"          // direct execution → AgentAction[]
  | "tasked"             // tasked execution → OrbTask draft
  | "clarification"      // ask user a question first
  | "blocked"            // safety blocked, no action
  | "invalid";           // could not parse

export interface OrbTaskDraftStep {
  id: string;
  label: string;
  pagePath?: string;
  uiActions: Array<{ type: string; payload?: unknown }>;
  toolCalls: Array<{
    name: string;
    args?: Record<string, unknown>;
    requiresApproval: boolean;
  }>;
  condition?: AgentPlanV3Step["condition"];
  /** Compensation action to dispatch on permanent failure (rollback). */
  compensationAction?: unknown;
  /** Per-step timeout (ms) used by the orchestrator's AbortController. */
  timeoutMs?: number;
}

export interface OrbTaskDraft {
  taskId: string;
  intent: string;
  summaryForUser: string;
  needsApproval: boolean;
  steps: OrbTaskDraftStep[];
  isolation: "ui" | "tool" | "code";
  preferredEngine: AgentPlanV3PreferredEngine | "claudeCode";
  rollbackMode: "manual" | "auto-on-failure" | "none";
  warnings: string[];
}

export interface GatedAgentPlanResult {
  status: GatedPlanStatus;
  ok: boolean;
  version: "agent-plan.v1" | "agent-plan.v3" | "unknown";
  plan?: AgentPlan | AgentPlanV3;
  actions: AgentAction[];
  task?: OrbTaskDraft;
  askBeforeAct: boolean;
  reply?: string;
  intent?: string;
  warnings: string[];
  blockers: AgentPlanSafetyIssue[];
  safety?: AgentPlanSafetyEvaluation;
  riskEvaluation?: AgentPlanV3RiskEvaluation;
  preferredEngine?: AgentPlanV3PreferredEngine | "claudeCode";
  decisionMode?: AgentPlanV3DecisionMode;
  reason?: string;
  issues?: string[];
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

function v3StepToUiAction(step: AgentPlanV3Step): { type: string; payload?: unknown } {
  const action = step.action;
  switch (action.type) {
    case "fillPrompt":
      return { type: "fillPrompt", payload: { text: action.text, append: action.append, slot: action.slot } };
    case "setModel":
      return { type: "setModel", payload: action.modelId };
    case "setTab":
      return { type: "setTab", payload: action.tabId };
    case "setMode":
      return { type: "setMode", payload: action.modeId };
    case "setModality":
      return { type: "setModality", payload: action.modality };
    case "setParam":
      return { type: "setParam", payload: { key: action.key, value: action.value } };
    case "applyPreset":
      return { type: "applyPreset", payload: action.presetId };
    case "submit":
      return { type: "submit", payload: { delayMs: action.delayMs } };
    case "reset":
      return { type: "reset" };
    case "navigate":
      return { type: "navigate", payload: action.path };
    case "focusElement":
      return { type: "focusElement", payload: { elementId: action.elementId, message: action.message } };
    case "openDialog":
      return { type: "openDialog", payload: { dialogId: action.dialogId, params: action.params } };
    case "search":
      return { type: "search", payload: action.query };
    case "toggleSetting":
      return { type: "toggleSetting", payload: { key: action.key, value: action.value } };
    default: {
      const _exhaustive: never = action;
      return { type: (_exhaustive as { type: string }).type ?? "unknown" };
    }
  }
}

function v3StepToOrbTaskStep(step: AgentPlanV3Step): OrbTaskDraftStep {
  const uiActions = [v3StepToUiAction(step)];
  const toolCalls = step.toolName
    ? [
        {
          name: step.toolName,
          args: step.toolArgs,
          requiresApproval: step.requiresApproval,
        },
      ]
    : [];
  return {
    id: step.id,
    label: step.label,
    pagePath: step.pagePath,
    uiActions,
    toolCalls,
    condition: step.condition,
    compensationAction: step.compensationAction,
    timeoutMs: (step as { timeoutMs?: number }).timeoutMs,
  };
}

function validateStepConditions(plan: AgentPlanV3): string | null {
  const stepIds = new Set(plan.steps.map(step => step.id));
  for (const step of plan.steps) {
    const condition = step.condition;
    if (!condition) continue;
    if (condition.onFail === "goto") {
      if (!condition.gotoStepId || !stepIds.has(condition.gotoStepId)) {
        return `Step "${step.id}" has invalid condition.gotoStepId: ${condition.gotoStepId ?? "<empty>"}`;
      }
    }
  }
  return null;
}

/** Convert a v3 plan into an OrbTask draft (route-side will materialise the
 *  real DB record via orbTaskRepository.create). */
export function adaptAgentPlanV3ToOrbTaskDraft(
  plan: AgentPlanV3,
  evaluation: AgentPlanV3RiskEvaluation
): OrbTaskDraft {
  let isolation: "ui" | "tool" | "code" =
    plan.taskPolicy?.isolation ?? (evaluation.needsClaudeCode ? "code" : "ui");
  // Demote a hallucinated `taskPolicy.isolation: "code"` when the actual
  // step toolNames are all server-side media calls. Without this, plans
  // like "為使用者做普洱茶療癒影片" (steps = studio.generateImage / Video /
  // Audio) keep getting forced into claudeCode isolation by an LLM that
  // misclassifies "tasked" as "code work".
  if (isolation === "code" && !evaluation.needsClaudeCode) {
    const stepsWithToolName = plan.steps.filter(step => Boolean(step.toolName));
    const allServerMedia =
      stepsWithToolName.length > 0 &&
      stepsWithToolName.every(step =>
        ["studio.", "director.", "media.", "pro-studio."].some(prefix =>
          String(step.toolName).startsWith(prefix)
        )
      );
    if (allServerMedia) isolation = "ui";
  }
  return {
    taskId: plan.planId,
    intent: plan.intent,
    summaryForUser: plan.summaryForUser,
    needsApproval: plan.taskPolicy?.needsApproval ?? evaluation.requiresHuman ?? true,
    steps: plan.steps.map(v3StepToOrbTaskStep),
    isolation,
    preferredEngine: evaluation.preferredEngine,
    rollbackMode: plan.rollbackPolicy?.mode ?? "manual",
    warnings: plan.warnings ?? [],
  };
}

function v3PlanToWorkflowAction(plan: AgentPlanV3): AgentAction | null {
  // Re-use the v1 conversion path by projecting v3 steps onto v1 plan shape.
  const projection: AgentPlan = {
    schemaVersion: "agent-plan.v1",
    intent: plan.intent,
    confidence: 0.9,
    summaryForUser: plan.summaryForUser,
    shouldAskClarification: false,
    warnings: plan.warnings ?? [],
    steps: plan.steps.map(step => ({
      id: step.id,
      label: step.label,
      pagePath: step.pagePath,
      action: step.action,
      riskLevel: step.riskLevel,
      requiresApproval: step.requiresApproval,
      undoable: step.undoable,
      compensationAction: step.compensationAction,
      rationale: step.rationale,
    })),
  };
  return agentPlanToWorkflowAction(projection, plan.intent);
}

export function adaptAgentPlanV3ToActions(plan: AgentPlanV3): AgentAction[] {
  const workflow = v3PlanToWorkflowAction(plan);
  return workflow ? [workflow] : [];
}

function gateV3Plan(plan: AgentPlanV3): GatedAgentPlanResult {
  const conditionValidationError = validateStepConditions(plan);
  if (conditionValidationError) {
    return {
      status: "invalid",
      ok: false,
      version: "agent-plan.v3",
      plan,
      actions: [],
      askBeforeAct: false,
      warnings: plan.warnings ?? [],
      blockers: [],
      reason: conditionValidationError,
      issues: [conditionValidationError],
    };
  }
  const evaluation = evaluateAgentPlanV3Risk(plan);
  const warnings = [
    ...(plan.warnings ?? []),
    ...evaluation.reasons,
  ];

  if (plan.decision.mode === "clarification" || evaluation.decisionMode === "clarification") {
    return {
      status: "clarification",
      ok: true,
      version: "agent-plan.v3",
      plan,
      actions: [],
      askBeforeAct: false,
      reply: plan.clarificationQuestion ?? plan.summaryForUser,
      intent: plan.intent,
      warnings,
      blockers: evaluation.blockers,
      riskEvaluation: evaluation,
      preferredEngine: evaluation.preferredEngine,
      decisionMode: "clarification",
      reason: plan.decision.reason,
      clarificationQuestion: plan.clarificationQuestion,
      clarificationOptions: plan.clarificationOptions,
    };
  }

  if (evaluation.decisionMode === "blocked") {
    const firstBlocker = evaluation.blockers[0]?.message ?? evaluation.reasons.join(" / ");
    const friendlyBlockerReply = firstBlocker.includes("has no registered capability")
      ? "我目前這個頁面沒有對應能力，請先切換到正確工作室，或告訴我你希望前往哪一頁，我再幫你接續。"
      : `我已建立計畫，但因安全檢查暫停執行：${firstBlocker}`;
    return {
      status: "blocked",
      ok: false,
      version: "agent-plan.v3",
      plan,
      actions: [],
      askBeforeAct: true,
      reply: friendlyBlockerReply,
      intent: plan.intent,
      warnings,
      blockers: evaluation.blockers,
      riskEvaluation: evaluation,
      preferredEngine: evaluation.preferredEngine,
      decisionMode: "blocked",
      reason: evaluation.reasons.join(" / "),
    };
  }

  if (evaluation.decisionMode === "tasked") {
    const task = adaptAgentPlanV3ToOrbTaskDraft(plan, evaluation);
    return {
      status: "tasked",
      ok: true,
      version: "agent-plan.v3",
      plan,
      actions: [],
      task,
      askBeforeAct: true,
      reply: plan.summaryForUser,
      intent: plan.intent,
      warnings,
      blockers: evaluation.blockers,
      riskEvaluation: evaluation,
      preferredEngine: evaluation.preferredEngine,
      decisionMode: "tasked",
      reason: evaluation.reasons.join(" / "),
    };
  }

  // direct
  const actions = adaptAgentPlanV3ToActions(plan);
  if (actions.length === 0) {
    return {
      status: "invalid",
      ok: false,
      version: "agent-plan.v3",
      plan,
      actions: [],
      askBeforeAct: false,
      reply: plan.summaryForUser,
      intent: plan.intent,
      warnings,
      blockers: evaluation.blockers,
      riskEvaluation: evaluation,
      preferredEngine: evaluation.preferredEngine,
      decisionMode: "direct",
      reason: "Plan could not be converted into a workflow action.",
    };
  }
  return {
    status: "converted",
    ok: true,
    version: "agent-plan.v3",
    plan,
    actions,
    askBeforeAct: evaluation.requiresHuman || evaluation.riskLevel !== "low",
    reply: plan.summaryForUser,
    intent: plan.intent,
    warnings,
    blockers: evaluation.blockers,
    riskEvaluation: evaluation,
    preferredEngine: evaluation.preferredEngine,
    decisionMode: "direct",
  };
}

function gateV1Plan(plan: AgentPlan): GatedAgentPlanResult {
  // Re-use the existing adapter to keep behaviour identical for v1 plans.
  const adapted = adaptAgentPlanToActions(plan);
  return {
    status: adapted.status,
    ok: adapted.ok,
    version: "agent-plan.v1",
    plan: adapted.plan,
    actions: adapted.actions,
    askBeforeAct: adapted.askBeforeAct,
    reply: adapted.reply,
    intent: adapted.intent,
    warnings: adapted.warnings,
    blockers: adapted.blockers,
    safety: adapted.safety,
    reason: adapted.reason,
    issues: adapted.issues,
    clarificationQuestion: adapted.clarificationQuestion,
    clarificationOptions: adapted.clarificationOptions,
  };
}

/**
 * 統一 parser + safety gate：吃 LLM 原始輸出（字串或物件），
 * 回 v1 或 v3 gating 結果。`server/services/agentPlanner.ts` 用這支當主入口；
 * 路由層仍可 fallback 回 legacy parseOrbReply。
 */
export function parseAndGatePlan(rawPlannerOutput: unknown): GatedAgentPlanResult {
  const normalized = normalizePlannerOutput(rawPlannerOutput);
  if (!normalized) {
    return {
      status: "invalid",
      ok: false,
      version: "unknown",
      actions: [],
      askBeforeAct: false,
      warnings: [],
      blockers: [],
      reason: "Planner output did not contain a JSON object.",
      issues: [stringifyPlannerOutput(rawPlannerOutput).slice(0, 500)],
    };
  }

  const versioned = normalizeAgentPlanVersion(normalized);
  const parsed = safeParseAgentPlanAny(normalized);
  if (!parsed.ok) {
    return {
      status: "invalid",
      ok: false,
      version: versioned.version,
      actions: [],
      askBeforeAct: false,
      warnings: [],
      blockers: [],
      reason: parsed.reason ?? "Invalid AgentPlan.",
      issues: parsed.issues,
    };
  }

  if (parsed.version === "agent-plan.v3") {
    return gateV3Plan(parsed.plan);
  }
  return gateV1Plan(parsed.plan);
}

export function buildAgentPlanV3SystemPrompt(pageSnapshotSummary?: string): string {
  return [
    "You are the production planning layer (agent-plan.v3) for AI Director.",
    "Return only a JSON object matching AgentPlanV3Schema with schemaVersion='agent-plan.v3'.",
    "Always set decision.mode to one of: clarification | direct | tasked | blocked.",
    "Use 'direct' only for single-page low-risk fillPrompt-style flows.",
    "Use 'tasked' for cross-page multi-step plans, code/GitHub/deploy work, or anything that should be tracked as an OrbTask.",
    "Use 'clarification' when the request is ambiguous; populate clarificationQuestion.",
    "Use 'blocked' if you must refuse for safety, and include reasons.",
    "submit / reset / applyPreset MUST be high risk and requiresApproval=true.",
    "Multimodal generation (image/audio/video/pdf) MUST set safety.riskLevel >= medium.",
    "Never invent unsupported tools; toolName must be empty unless you know it is registered.",
    "routing.capabilities is metadata that decides downstream engine routing. Use 'code' / 'github' / 'deploy' ONLY when the actual work modifies source files, opens a PR, or triggers a deployment — NEVER for media generation. For 製作影片 / 生成圖片 / 配樂 / 配音 / 腳本規劃 use 'multimodal' plus the matching modality ('image' / 'audio' / 'video' / 'voice'); the gating layer will reject a 'code' capability when every step toolName is a studio.* / director.* / media.* call.",
    pageSnapshotSummary ? `Available page context:\n${pageSnapshotSummary}` : "",
  ].filter(Boolean).join("\n");
}
