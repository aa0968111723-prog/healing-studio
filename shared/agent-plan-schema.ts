import { z } from "zod";
import type { AgentAction, AgentActionType, RunWorkflowAction } from "./agent-actions";

export const AgentRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type AgentRiskLevel = z.infer<typeof AgentRiskLevelSchema>;

export const AgentActionTypeSchema = z.enum([
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

const optionalString = z.string().trim().min(1).optional();
const paramsRecord = z.record(z.string(), z.unknown());

export const AgentWorkflowStepSchema = z.object({
  path: optionalString,
  actionType: z.string().trim().min(1).max(64),
  payload: z.string().default(""),
  label: z.string().trim().min(1).max(180),
});

export const AgentExecutableActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fillPrompt"),
    text: z.string().min(1).max(8_000),
    append: z.boolean().optional(),
    slot: optionalString,
  }),
  z.object({
    type: z.literal("setModel"),
    modelId: z.string().trim().min(1).max(160),
  }),
  z.object({
    type: z.literal("setTab"),
    tabId: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("setMode"),
    modeId: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("setModality"),
    modality: z.enum(["image", "video", "audio", "voice"]),
  }),
  z.object({
    type: z.literal("setParam"),
    key: z.string().trim().min(1).max(120),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal("applyPreset"),
    presetId: z.string().trim().min(1).max(160),
  }),
  z.object({
    type: z.literal("submit"),
    delayMs: z.number().int().min(0).max(60_000).optional(),
  }),
  z.object({
    type: z.literal("reset"),
  }),
  z.object({
    type: z.literal("navigate"),
    path: z.string().trim().min(1).max(240),
  }),
  z.object({
    type: z.literal("focusElement"),
    elementId: z.string().trim().min(1).max(160),
    message: optionalString,
  }),
  z.object({
    type: z.literal("openDialog"),
    dialogId: z.string().trim().min(1).max(160),
    params: paramsRecord.optional(),
  }),
  z.object({
    type: z.literal("search"),
    query: z.string().trim().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("toggleSetting"),
    key: z.string().trim().min(1).max(160),
    value: z.boolean().optional(),
  }),
]);

export const AgentActionSchema = z.discriminatedUnion("type", [
  ...AgentExecutableActionSchema.options,
  z.object({
    type: z.literal("runWorkflow"),
    name: z.string().trim().min(1).max(180),
    steps: z.array(AgentWorkflowStepSchema).min(1).max(24),
  }),
]);

export type AgentExecutableAction = z.infer<typeof AgentExecutableActionSchema>;
export type AgentPlanAction = z.infer<typeof AgentActionSchema>;

export const AgentPlanStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(180),
  pagePath: z.string().trim().min(1).max(240).optional(),
  action: AgentExecutableActionSchema,
  riskLevel: AgentRiskLevelSchema.default("low"),
  requiresApproval: z.boolean().default(false),
  undoable: z.boolean().default(false),
  compensationAction: AgentExecutableActionSchema.optional(),
  rationale: z.string().trim().max(500).optional(),
});

export const AgentPlanSchema = z.object({
  schemaVersion: z.literal("agent-plan.v1").default("agent-plan.v1"),
  intent: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1).default(0.7),
  summaryForUser: z.string().trim().min(1).max(600),
  shouldAskClarification: z.boolean().default(false),
  clarificationQuestion: z.string().trim().max(300).optional(),
  steps: z.array(AgentPlanStepSchema).max(12).default([]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
}).superRefine((plan, ctx) => {
  if (!plan.shouldAskClarification && plan.steps.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["steps"],
      message: "Executable plans must include at least one step unless shouldAskClarification=true.",
    });
  }
  if (plan.shouldAskClarification && !plan.clarificationQuestion) {
    ctx.addIssue({
      code: "custom",
      path: ["clarificationQuestion"],
      message: "Clarification plans must include clarificationQuestion.",
    });
  }
});

export type AgentPlanStep = z.infer<typeof AgentPlanStepSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export interface SafeAgentPlanParseResult {
  ok: boolean;
  plan?: AgentPlan;
  reason?: string;
  issues?: string[];
}

export function safeParseAgentPlan(input: unknown): SafeAgentPlanParseResult {
  const parsed = AgentPlanSchema.safeParse(input);
  if (parsed.success) return { ok: true, plan: parsed.data };
  const issues = parsed.error.issues.map(issue => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
  return {
    ok: false,
    reason: issues[0] ?? "Invalid agent plan",
    issues,
  };
}

export function parseAgentPlan(input: unknown): AgentPlan {
  return AgentPlanSchema.parse(input);
}

export function inferRiskLevelForAction(action: Pick<AgentAction, "type">): AgentRiskLevel {
  switch (action.type) {
    case "submit":
    case "reset":
      return "high";
    case "applyPreset":
    case "setModality":
    case "toggleSetting":
      return "medium";
    default:
      return "low";
  }
}

export function actionRequiresApproval(action: Pick<AgentAction, "type">): boolean {
  return inferRiskLevelForAction(action) !== "low";
}

export function actionToWorkflowStep(
  step: AgentPlanStep,
  fallbackIndex: number
): RunWorkflowAction["steps"][number] | null {
  const label = step.label || `Step ${fallbackIndex + 1}`;
  const path = step.pagePath;
  const action = step.action;

  switch (action.type) {
    case "fillPrompt":
      return {
        path,
        label,
        actionType: action.slot === "negativePrompt"
          ? "fillNegativePrompt"
          : action.slot === "lyrics"
          ? "fillLyrics"
          : action.append
          ? "appendPrompt"
          : "fillPrompt",
        payload: action.text,
      };
    case "setModel":
      return { path, label, actionType: "setModel", payload: action.modelId };
    case "setTab":
      return { path, label, actionType: "setTab", payload: action.tabId };
    case "setMode":
      return { path, label, actionType: "setMode", payload: String(action.modeId) };
    case "setModality":
      return { path, label, actionType: "setModality", payload: action.modality };
    case "setParam":
      return { path, label, actionType: "setParam", payload: `${action.key}:${JSON.stringify(action.value)}` };
    case "applyPreset":
      return { path, label, actionType: "applyPreset", payload: action.presetId };
    case "submit":
      return { path, label, actionType: "submit", payload: "" };
    case "reset":
      return { path, label, actionType: "reset", payload: "" };
    case "navigate":
      return { path: action.path, label, actionType: "navigate", payload: action.path };
    case "focusElement":
      return { path, label, actionType: "focusElement", payload: action.elementId };
    case "openDialog":
      return { path, label, actionType: "openDialog", payload: action.dialogId };
    case "search":
      return { path, label, actionType: "search", payload: action.query };
    case "toggleSetting":
      return {
        path,
        label,
        actionType: "toggleSetting",
        payload: action.value === undefined ? action.key : `${action.key}:${action.value}`,
      };
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function agentPlanToWorkflowAction(plan: AgentPlan, name = plan.intent): RunWorkflowAction | null {
  if (plan.steps.length === 0) return null;
  const steps = plan.steps
    .map((step, index) => actionToWorkflowStep(step, index))
    .filter((step): step is RunWorkflowAction["steps"][number] => Boolean(step));
  if (steps.length === 0) return null;
  return { type: "runWorkflow", name, steps };
}

export const AGENT_PLAN_JSON_SCHEMA = {
  name: "agent_plan_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "intent",
      "confidence",
      "summaryForUser",
      "shouldAskClarification",
      "steps",
      "warnings",
    ],
    properties: {
      schemaVersion: { const: "agent-plan.v1" },
      intent: { type: "string", minLength: 1, maxLength: 240 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summaryForUser: { type: "string", minLength: 1, maxLength: 600 },
      shouldAskClarification: { type: "boolean" },
      clarificationQuestion: { type: "string", maxLength: 300 },
      warnings: {
        type: "array",
        maxItems: 8,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
      steps: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "action", "riskLevel", "requiresApproval", "undoable"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 80 },
            label: { type: "string", minLength: 1, maxLength: 180 },
            pagePath: { type: "string", minLength: 1, maxLength: 240 },
            riskLevel: { enum: ["low", "medium", "high"] },
            requiresApproval: { type: "boolean" },
            undoable: { type: "boolean" },
            rationale: { type: "string", maxLength: 500 },
            compensationAction: { type: "object" },
            action: {
              oneOf: [
                { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { const: "fillPrompt" }, text: { type: "string" }, append: { type: "boolean" }, slot: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "modelId"], properties: { type: { const: "setModel" }, modelId: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "tabId"], properties: { type: { const: "setTab" }, tabId: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "modeId"], properties: { type: { const: "setMode" }, modeId: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "modality"], properties: { type: { const: "setModality" }, modality: { enum: ["image", "video", "audio", "voice"] } } },
                { type: "object", additionalProperties: false, required: ["type", "key", "value"], properties: { type: { const: "setParam" }, key: { type: "string" }, value: {} } },
                { type: "object", additionalProperties: false, required: ["type", "presetId"], properties: { type: { const: "applyPreset" }, presetId: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "submit" }, delayMs: { type: "number" } } },
                { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "reset" } } },
                { type: "object", additionalProperties: false, required: ["type", "path"], properties: { type: { const: "navigate" }, path: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "elementId"], properties: { type: { const: "focusElement" }, elementId: { type: "string" }, message: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "dialogId"], properties: { type: { const: "openDialog" }, dialogId: { type: "string" }, params: { type: "object" } } },
                { type: "object", additionalProperties: false, required: ["type", "query"], properties: { type: { const: "search" }, query: { type: "string" } } },
                { type: "object", additionalProperties: false, required: ["type", "key"], properties: { type: { const: "toggleSetting" }, key: { type: "string" }, value: { type: "boolean" } } }
              ]
            }
          }
        }
      }
    }
  }
} as const;

export function isKnownAgentActionType(value: string): value is AgentActionType {
  return AgentActionTypeSchema.safeParse(value).success;
}
