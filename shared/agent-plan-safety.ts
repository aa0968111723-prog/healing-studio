import type { AgentAction, AgentActionType, RunWorkflowAction } from "./agent-actions";
import type { AgentPlan, AgentPlanStep, AgentRiskLevel } from "./agent-plan-schema";
import { actionRequiresApproval, inferRiskLevelForAction } from "./agent-plan-schema";

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

  for (const [index, step] of plan.steps.entries()) {
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
      addIssue(issues, {
        reason: "high_risk_without_approval",
        severity: "blocker",
        message: "High-risk step must set requiresApproval=true.",
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

export function evaluateWorkflowSafety(action: RunWorkflowAction): AgentPlanSafetyEvaluation {
  const syntheticPlan: AgentPlan = {
    schemaVersion: "agent-plan.v1",
    intent: action.name,
    confidence: 1,
    summaryForUser: action.name,
    shouldAskClarification: false,
    warnings: [],
    steps: action.steps.map((step, index) => {
      const actionType = step.actionType as AgentActionType;
      const isSubmit = actionType === "submit" || actionType === "generate";
      const normalizedAction: AgentAction = isSubmit
        ? { type: "submit" }
        : actionType === "navigate"
          ? { type: "navigate", path: step.payload || step.path || "/" }
          : { type: "fillPrompt", text: step.payload || step.label };
      return {
        id: `workflow-step-${index + 1}`,
        label: step.label,
        pagePath: step.path,
        riskLevel: isSubmit ? "high" : "low",
        requiresApproval: isSubmit,
        undoable: !isSubmit,
        action: normalizedAction,
      };
    }),
  };
  return evaluateAgentPlanSafety(syntheticPlan);
}
