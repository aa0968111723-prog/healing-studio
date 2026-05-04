import type { AgentAction, AgentActionType, RunWorkflowAction } from "./agent-actions";
import type {
  AgentPlan,
  AgentPlanStep,
  AgentPlanV3,
  AgentPlanV3DecisionMode,
  AgentRiskLevel,
} from "./agent-plan-schema";
import { actionRequiresApproval, inferRiskLevelForAction } from "./agent-plan-schema";
import { hasCapabilityForPage } from "./global-agent-capabilities";
import { getGlobalAgentTool } from "./global-agent-tools";

export type AgentPlanSafetyBlockReason =
  | "schema_requires_clarification"
  | "empty_plan"
  | "too_many_steps"
  | "too_many_submits"
  | "missing_page_path"
  | "unknown_action"
  | "unsafe_navigation_path"
  | "high_risk_without_approval"
  | "destructive_without_approval";

export interface AgentPlanSafetyIssue {
  reason: AgentPlanSafetyBlockReason;
  severity: "warning" | "blocker";
  message: string;
  stepId?: string;
  stepIndex?: number;
  actionType?: AgentActionType | string;
}

export interface AgentPlanSafetyEvaluation {
  okToPresent: boolean;
  okToExecute: boolean;
  askBeforeAct: boolean;
  maxRiskLevel: AgentRiskLevel;
  destructiveActionCount: number;
  submitCount: number;
  issues: AgentPlanSafetyIssue[];
  summary: string;
}

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_MAX_SUBMITS = 6;

const KNOWN_ACTION_TYPES = new Set<AgentActionType>([
  "fillPrompt",
  "setModel",
  "setTab",
  "setMode",
  "setModality",
  "setParam",
  "applyPreset",
  "submit",
  "reset",
  "navigate",
  "focusElement",
  "openDialog",
  "search",
  "toggleSetting",
  "runWorkflow",
]);

function riskRank(risk: AgentRiskLevel): number {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function maxRisk(a: AgentRiskLevel, b: AgentRiskLevel): AgentRiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}

export function isKnownActionType(value: string): value is AgentActionType {
  return KNOWN_ACTION_TYPES.has(value as AgentActionType);
}

export function isSafeInternalPath(path: string | undefined): boolean {
  if (!path) return true;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.includes("\\")) return false;
  return true;
}

export function isDestructiveAgentAction(action: Pick<AgentAction, "type">): boolean {
  switch (action.type) {
    case "submit":
    case "reset":
    case "applyPreset":
    case "setModality":
    case "runWorkflow":
      return true;
    default:
      return false;
  }
}

function stepRisk(step: AgentPlanStep): AgentRiskLevel {
  return maxRisk(step.riskLevel, inferRiskLevelForAction(step.action));
}

function addIssue(
  issues: AgentPlanSafetyIssue[],
  issue: AgentPlanSafetyIssue
): void {
  issues.push(issue);
}

export function evaluateAgentPlanSafety(
  plan: AgentPlan,
  opts: {
    maxSteps?: number;
    maxSubmits?: number;
  } = {}
): AgentPlanSafetyEvaluation {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxSubmits = opts.maxSubmits ?? DEFAULT_MAX_SUBMITS;
  const issues: AgentPlanSafetyIssue[] = [];
  let maxRiskLevel: AgentRiskLevel = "low";
  let destructiveActionCount = 0;
  let submitCount = 0;
  let askBeforeAct = false;

  if (plan.shouldAskClarification) {
    addIssue(issues, {
      reason: "schema_requires_clarification",
      severity: "warning",
      message: "Plan requests clarification before execution.",
    });
    return {
      okToPresent: true,
      okToExecute: false,
      askBeforeAct: false,
      maxRiskLevel: "low",
      destructiveActionCount: 0,
      submitCount: 0,
      issues,
      summary: plan.clarificationQuestion ?? plan.summaryForUser,
    };
  }

  if (plan.steps.length === 0) {
    addIssue(issues, {
      reason: "empty_plan",
      severity: "blocker",
      message: "Executable plan has no steps.",
    });
  }

  if (plan.steps.length > maxSteps) {
    addIssue(issues, {
      reason: "too_many_steps",
      severity: "blocker",
      message: `Plan has ${plan.steps.length} steps; limit is ${maxSteps}.`,
    });
  }

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const actionType = step.action.type;
    const risk = stepRisk(step);
    maxRiskLevel = maxRisk(maxRiskLevel, risk);

    if (!isKnownActionType(actionType)) {
      addIssue(issues, {
        reason: "unknown_action",
        severity: "blocker",
        message: `Unknown action type: ${actionType}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    }

    if (!isSafeInternalPath(step.pagePath)) {
      addIssue(issues, {
        reason: "unsafe_navigation_path",
        severity: "blocker",
        message: `Unsafe pagePath: ${step.pagePath}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    }

    if (step.action.type === "navigate" && !isSafeInternalPath(step.action.path)) {
      addIssue(issues, {
        reason: "unsafe_navigation_path",
        severity: "blocker",
        message: `Unsafe navigate path: ${step.action.path}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    }

    if (!step.pagePath && step.action.type !== "navigate" && step.action.type !== "focusElement") {
      addIssue(issues, {
        reason: "missing_page_path",
        severity: "warning",
        message: "Step has no pagePath; it will execute on the current or routed page.",
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    }

    if (step.action.type === "submit") submitCount += 1;
    if (isDestructiveAgentAction(step.action)) destructiveActionCount += 1;

    const requiresApproval = step.requiresApproval || actionRequiresApproval(step.action) || risk !== "low";
    if (requiresApproval) askBeforeAct = true;

    if (risk === "high" && !step.requiresApproval) {
      // Auto-fix: silently coerce requiresApproval=true on high-risk steps and
      // emit a warning instead of blocking. Runtime gates (orbTaskOrchestrator
      // + WorkflowConfirmationCard + user agent preferences) still enforce
      // approval at execution time, so the policy is preserved — but the
      // planner forgetting one boolean no longer kills an otherwise-valid
      // multi-step workflow (regression caught by the cat-war video case).
      step.requiresApproval = true;
      addIssue(issues, {
        reason: "high_risk_without_approval",
        severity: "warning",
        message: "High-risk step missing requiresApproval=true; auto-corrected to true. Runtime approval gate still applies.",
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    } else if (isDestructiveAgentAction(step.action) && !step.requiresApproval) {
      addIssue(issues, {
        reason: "destructive_without_approval",
        severity: "warning",
        message: "Destructive step should be confirmed before execution.",
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
    }
  }

  if (submitCount > maxSubmits) {
    addIssue(issues, {
      reason: "too_many_submits",
      severity: "blocker",
      message: `Plan has ${submitCount} submit steps; limit is ${maxSubmits}.`,
    });
  }

  const hasBlocker = issues.some(issue => issue.severity === "blocker");
  const summary = hasBlocker
    ? `Plan blocked by ${issues.filter(issue => issue.severity === "blocker").length} safety issue(s).`
    : askBeforeAct
      ? "Plan is safe to present but requires user approval before execution."
      : "Plan is safe to execute after normal UI confirmation flow.";

  return {
    okToPresent: true,
    okToExecute: !hasBlocker && !askBeforeAct,
    askBeforeAct,
    maxRiskLevel,
    destructiveActionCount,
    submitCount,
    issues,
    summary,
  };
}

export function shouldAskBeforeExecutingAgentPlan(plan: AgentPlan): boolean {
  return evaluateAgentPlanSafety(plan).askBeforeAct;
}

export function getAgentPlanBlockers(plan: AgentPlan): AgentPlanSafetyIssue[] {
  return evaluateAgentPlanSafety(plan).issues.filter(issue => issue.severity === "blocker");
}

function workflowStepToSyntheticAction(step: RunWorkflowAction["steps"][number]): AgentPlanStep["action"] {
  const payload = step.payload ?? "";

  switch (step.actionType) {
    case "submit":
    case "generate":
      return { type: "submit" };
    case "reset":
      return { type: "reset" };
    case "navigate":
      return { type: "navigate", path: payload || step.path || "/" };
    case "setModality":
      return {
        type: "setModality",
        modality: payload === "video" || payload === "audio" || payload === "voice" ? payload : "image",
      };
    case "applyPreset":
      return { type: "applyPreset", presetId: payload || "workflow-preset" };
    case "setModel":
      return { type: "setModel", modelId: payload || "workflow-model" };
    case "setTab":
      return { type: "setTab", tabId: payload || "workflow-tab" };
    case "setMode":
      return { type: "setMode", modeId: payload || "workflow-mode" };
    case "setParam": {
      const [key, ...rest] = payload.split(":");
      return { type: "setParam", key: key || "workflow-param", value: rest.join(":") };
    }
    case "search":
      return { type: "search", query: payload || step.label };
    case "focusElement":
      return { type: "focusElement", elementId: payload || "workflow-target", message: step.label };
    case "openDialog":
      return { type: "openDialog", dialogId: payload || "workflow-dialog" };
    case "toggleSetting":
      return { type: "toggleSetting", key: payload || "workflow-setting" };
    case "appendPrompt":
    case "fillNegativePrompt":
    case "fillLyrics":
    case "fillPrompt":
    default:
      return { type: "fillPrompt", text: payload || step.label };
  }
}

// ─── AgentPlan v3 risk evaluation ──────────────────────────────────────────
//
// 規則：
//   - unknown action  → blocked
//   - unknown tool    → blocked
//   - submit / reset / applyPreset → high + requiresHuman
//   - cross-page multi-step       → tasked
//   - code / github / deploy      → tasked + claudeCode
//   - multimodal generation       → medium 起跳
//   - fillPrompt only (single)    → low / direct OK

const HIGH_RISK_ACTION_TYPES = new Set<AgentActionType>([
  "submit",
  "reset",
  "applyPreset",
]);

const TASKED_CAPABILITY_KEYWORDS = ["code", "github", "deploy"] as const;
const MULTIMODAL_CAPABILITY_KEYWORDS = ["multimodal", "vision", "audio", "video", "pdf"] as const;
const EXTERNAL_HIGH_RISK_TOOL_KEYWORDS = ["github.", "deploy.", "code."] as const;
// Tool namespaces that run server-side via the orb tool executor and never
// require a Claude Code handoff. When every non-empty step toolName falls in
// this set, the planner's "code" capability hint is metadata noise and must
// not override the actual work — see the 全站光球代理 misroute that blocked
// the Pu'er-tea video plan with "claude code handoff required" even though
// every step was a studio.* media call.
const SERVER_SIDE_MEDIA_TOOL_PREFIXES = [
  "studio.",
  "director.",
  "media.",
  "pro-studio.",
  "research.",
  "inspiration.",
  "resource.",
  "insight.",
] as const;

export type AgentPlanV3GateMode = AgentPlanV3DecisionMode;

export interface AgentPlanV3RiskEvaluation {
  riskLevel: AgentRiskLevel;
  requiresHuman: boolean;
  reasons: string[];
  decisionMode: AgentPlanV3DecisionMode;
  preferredEngine: "auto" | "gemini" | "minimax" | "claudeCode";
  blockers: AgentPlanSafetyIssue[];
  warnings: AgentPlanSafetyIssue[];
  isCrossPage: boolean;
  isMultimodal: boolean;
  needsClaudeCode: boolean;
  taskedRequired: boolean;
}

function bumpRisk(current: AgentRiskLevel, candidate: AgentRiskLevel): AgentRiskLevel {
  return maxRisk(current, candidate);
}

function isMultimodalAttachmentMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return (
    lower.startsWith("image/") ||
    lower.startsWith("audio/") ||
    lower.startsWith("video/") ||
    lower === "application/pdf"
  );
}

export function isKnownAgentTool(name: string): boolean {
  return Boolean(getGlobalAgentTool(name));
}

export function evaluateAgentPlanV3Risk(plan: AgentPlanV3): AgentPlanV3RiskEvaluation {
  const blockers: AgentPlanSafetyIssue[] = [];
  const warnings: AgentPlanSafetyIssue[] = [];
  let riskLevel: AgentRiskLevel = plan.safety?.riskLevel ?? "low";
  let requiresHuman = plan.safety?.requiresHuman ?? false;
  const reasonsSet = new Set<string>(plan.safety?.reasons ?? []);

  // 1) Unknown actions block immediately.
  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const actionType = step.action.type;
    if (!isKnownActionType(actionType)) {
      blockers.push({
        reason: "unknown_action",
        severity: "blocker",
        message: `Unknown action type: ${actionType}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
      reasonsSet.add(`未知動作 ${actionType}`);
    }
    if (step.toolName) {
      const tool = getGlobalAgentTool(step.toolName);
      if (!tool) {
        blockers.push({
          reason: "unknown_action",
          severity: "blocker",
          message: `Unknown tool: ${step.toolName}`,
          stepId: step.id,
          stepIndex: index,
          actionType: step.toolName,
        });
        reasonsSet.add(`未知工具 ${step.toolName}`);
      } else if (tool.requiresHuman || tool.riskLevel === "high") {
        requiresHuman = true;
        riskLevel = bumpRisk(riskLevel, "high");
        reasonsSet.add(`工具需要人工確認：${tool.name}`);
      }
    }

    if (!hasCapabilityForPage(step.pagePath, actionType)) {
      blockers.push({
        reason: "unknown_action",
        severity: "blocker",
        message: `Page ${step.pagePath ?? "<unknown>"} has no registered capability for ${actionType}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
      reasonsSet.add(`頁面能力未註冊：${actionType}`);
    }

    // 2) Destructive UI actions force high + human approval.
    if (HIGH_RISK_ACTION_TYPES.has(actionType)) {
      riskLevel = bumpRisk(riskLevel, "high");
      requiresHuman = true;
      reasonsSet.add(`高風險動作：${actionType}`);
      if (!step.requiresApproval) {
        // Auto-fix instead of block: the planner forgetting this boolean was
        // a frequent reason multi-step plans (e.g., the cat-war video flow)
        // got rejected with "must set requiresApproval=true" and the user
        // could not proceed. Runtime gates (orbTaskOrchestrator policy +
        // user agent preferences + workflow confirmation card) still enforce
        // human approval at execution time, so security is preserved while
        // the plan can actually reach the UI.
        step.requiresApproval = true;
        warnings.push({
          reason: "high_risk_without_approval",
          severity: "warning",
          message: `Step ${step.id} (${actionType}) missing requiresApproval=true; auto-corrected. Runtime approval gate still applies.`,
          stepId: step.id,
          stepIndex: index,
          actionType,
        });
        reasonsSet.add(`高風險動作自動補上人工確認：${actionType}`);
      }
    }

    if (!isSafeInternalPath(step.pagePath)) {
      blockers.push({
        reason: "unsafe_navigation_path",
        severity: "blocker",
        message: `Unsafe pagePath: ${step.pagePath}`,
        stepId: step.id,
        stepIndex: index,
        actionType,
      });
      reasonsSet.add("頁面路徑不安全");
    }
  }

  // 3) Multimodal → at least medium risk.
  const hasMultimodalAttachment = (plan.attachments ?? []).some(att =>
    isMultimodalAttachmentMime(att.mimeType)
  );
  const hasMultimodalCapability = (plan.routing?.capabilities ?? []).some(cap =>
    (MULTIMODAL_CAPABILITY_KEYWORDS as readonly string[]).includes(cap)
  );
  const isMultimodal = hasMultimodalAttachment || hasMultimodalCapability;
  if (isMultimodal) {
    riskLevel = bumpRisk(riskLevel, "medium");
    reasonsSet.add("多模態輸入需要更高風險評估");
  }

  // 4) Cross-page multi-step → tasked.
  const distinctPages = new Set(
    plan.steps.map(step => step.pagePath?.trim()).filter((path): path is string => Boolean(path))
  );
  const isCrossPage =
    plan.routing?.pageScope === "cross-page" ||
    distinctPages.size > 1 ||
    plan.steps.some(step => step.action.type === "navigate");
  if (isCrossPage && plan.steps.length > 1) {
    reasonsSet.add("跨頁多步驟動作建議轉成 task");
  }

  // 5) Code / GitHub / Deploy capability → tasked + ClaudeCode.
  const declaresCodeCapability = (plan.routing?.capabilities ?? []).some(cap =>
    (TASKED_CAPABILITY_KEYWORDS as readonly string[]).includes(cap)
  );
  const usesExternalHighRiskTool = plan.steps.some(step =>
    Boolean(step.toolName) &&
    (EXTERNAL_HIGH_RISK_TOOL_KEYWORDS as readonly string[]).some(keyword =>
      String(step.toolName).startsWith(keyword)
    )
  );
  const stepsWithToolName = plan.steps.filter(step => Boolean(step.toolName));
  const allToolStepsAreServerMedia =
    stepsWithToolName.length > 0 &&
    stepsWithToolName.every(step =>
      (SERVER_SIDE_MEDIA_TOOL_PREFIXES as readonly string[]).some(prefix =>
        String(step.toolName).startsWith(prefix)
      )
    );
  // The planner LLM sometimes hallucinates routing.capabilities=["code"] for
  // a multi-step media plan (e.g., "為使用者製作普洱茶療癒影片"). When that
  // happens but every actual tool call is a server-side media tool, demote
  // the claudeCode routing — there is no code to hand off, and blocking the
  // task with "claude code handoff required" stalls every studio.* step.
  const needsClaudeCode =
    usesExternalHighRiskTool ||
    (declaresCodeCapability && !allToolStepsAreServerMedia);
  if (needsClaudeCode) {
    riskLevel = bumpRisk(riskLevel, "medium");
    requiresHuman = true;
    reasonsSet.add("程式碼／GitHub／部署任務需要 Claude Code");
  } else if (declaresCodeCapability && allToolStepsAreServerMedia) {
    reasonsSet.add(
      "已忽略 routing.capabilities=code 旗標：所有步驟皆為 studio/director/media 工具，伺服器端可直接執行。"
    );
  }
  if (usesExternalHighRiskTool) {
    riskLevel = bumpRisk(riskLevel, "high");
    requiresHuman = true;
    reasonsSet.add("外部部署/GitHub/Code 工具需要人工確認");
  }

  // 6) Decide effective decision mode.
  let decisionMode: AgentPlanV3DecisionMode = plan.decision.mode;
  if (blockers.length > 0) {
    decisionMode = "blocked";
  } else if (decisionMode !== "clarification") {
    if (needsClaudeCode || (isCrossPage && plan.steps.length > 1)) {
      decisionMode = "tasked";
    }
  }

  if (decisionMode === "blocked" || decisionMode === "tasked") {
    requiresHuman = true;
  }

  // 7) Preferred engine routing.
  const declaredEngine = plan.routing?.preferredEngine ?? "auto";
  let preferredEngine: AgentPlanV3RiskEvaluation["preferredEngine"] = declaredEngine;
  if (needsClaudeCode) preferredEngine = "claudeCode";
  else if (isMultimodal && (declaredEngine === "auto" || declaredEngine === "minimax")) {
    preferredEngine = "gemini";
  }

  return {
    riskLevel,
    requiresHuman,
    reasons: Array.from(reasonsSet),
    decisionMode,
    preferredEngine,
    blockers,
    warnings,
    isCrossPage,
    isMultimodal,
    needsClaudeCode,
    taskedRequired:
      decisionMode === "tasked" || needsClaudeCode || (isCrossPage && plan.steps.length > 1),
  };
}

export function evaluateWorkflowSafety(action: RunWorkflowAction): AgentPlanSafetyEvaluation {
  const syntheticPlan: AgentPlan = {
    schemaVersion: "agent-plan.v1",
    intent: action.name,
    confidence: 1,
    summaryForUser: action.name,
    shouldAskClarification: false,
    warnings: [],
    steps: action.steps.map((step, index) => {
      const normalizedAction = workflowStepToSyntheticAction(step);
      const riskLevel = inferRiskLevelForAction(normalizedAction);
      const requiresApproval = actionRequiresApproval(normalizedAction);
      return {
        id: `workflow-step-${index + 1}`,
        label: step.label,
        pagePath: step.path,
        riskLevel,
        requiresApproval,
        undoable: !requiresApproval,
        action: normalizedAction,
      };
    }),
  };
  return evaluateAgentPlanSafety(syntheticPlan);
}
