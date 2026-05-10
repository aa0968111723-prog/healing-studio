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
  "execute_task",
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
  z.object({
    type: z.literal("execute_task"),
    task: z.object({
      type: z.enum(["generate_image", "generate_music", "generate_video"]),
      params: paramsRecord.default({}),
    }),
    resultUrl: z.string().trim().url().optional(),
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
  clarificationOptions: z
    .array(z.string().trim().min(1).max(48))
    .max(4)
    .optional(),
  steps: z.array(AgentPlanStepSchema).max(12).default([]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  /**
   * Citations the planner relied on (memoryId / page / tool / web). Lets the
   * UI render "based on these sources" — and lets us audit which memories
   * drove a given decision. Defaults to empty.
   */
  citations: z
    .array(
      z.object({
        kind: z.enum(["memory", "page", "tool", "web"]).default("memory"),
        id: z.string().trim().min(1).max(160),
        label: z.string().trim().min(1).max(120).optional(),
      })
    )
    .max(8)
    .optional(),
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
    case "execute_task":
      return {
        path,
        label,
        actionType: "execute_task",
        payload: JSON.stringify({ task: action.task }),
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
      clarificationOptions: {
        type: "array",
        maxItems: 4,
        items: { type: "string", minLength: 1, maxLength: 48 },
      },
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

// ─── AgentPlan v3 ─────────────────────────────────────────────────────────
//
// agent-plan.v3 是 production-grade 升級版：除了 v1 的 steps + clarification
// 外，明確表達 decision.mode（clarification / direct / tasked / blocked）、
// routing（preferredEngine / capabilities / pageScope）、attachments、safety
// 與 taskPolicy / rollbackPolicy / telemetry。v1 schema 保留不動以維持相容；
// 路由層拿到 LLM 原始輸出時以 `normalizeAgentPlanVersion()` 偵測版本，
// `parseAndGatePlan()` 統一吐 gating 結果，舊 parseOrbReply 路徑保留為
// 第三層 fallback。

export const AgentPlanVersionSchema = z.enum(["agent-plan.v1", "agent-plan.v3"]);

export const AgentPlanV3DecisionModeSchema = z.enum([
  "clarification",
  "direct",
  "tasked",
  "blocked",
]);
export type AgentPlanV3DecisionMode = z.infer<typeof AgentPlanV3DecisionModeSchema>;

export const AgentPlanV3PreferredEngineSchema = z.enum([
  "auto",
  "gemini",
  "minimax",
  "claudeCode",
]);
export type AgentPlanV3PreferredEngine = z.infer<typeof AgentPlanV3PreferredEngineSchema>;

export const AGENT_PLAN_V3_KNOWN_CAPABILITIES = [
  "chat",
  "ui-automation",
  "multimodal",
  "code",
  "github",
  "deploy",
  "tooling",
  "research",
] as const;
export type AgentPlanV3Capability = (typeof AGENT_PLAN_V3_KNOWN_CAPABILITIES)[number];

export const AgentPlanV3RoutingSchema = z.object({
  preferredEngine: AgentPlanV3PreferredEngineSchema.default("auto"),
  capabilities: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  pageScope: z.enum(["single", "cross-page"]).default("single"),
});
export type AgentPlanV3Routing = z.infer<typeof AgentPlanV3RoutingSchema>;

export const AgentPlanV3AttachmentSchema = z.object({
  kind: z.enum(["image", "video", "audio", "pdf", "file"]),
  mimeType: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2_048),
  name: z.string().trim().max(120).optional(),
});
export type AgentPlanV3Attachment = z.infer<typeof AgentPlanV3AttachmentSchema>;

export const AgentPlanV3SafetySchema = z.object({
  riskLevel: AgentRiskLevelSchema.default("low"),
  requiresHuman: z.boolean().default(false),
  reasons: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
});
export type AgentPlanV3Safety = z.infer<typeof AgentPlanV3SafetySchema>;

export const AgentPlanV3StepSchema = AgentPlanStepSchema.extend({
  confidenceScore: z.number().min(0).max(1).default(0.75),
  approvalGate: z.boolean().default(false),
  toolName: z.string().trim().min(1).max(80).optional(),
  toolArgs: z.record(z.string(), z.unknown()).optional(),
  condition: z.object({
    field: z.string().trim().min(1).max(160),
    operator: z.enum(["eq", "neq", "contains", "gt", "lt"]),
    value: z.unknown(),
    onFail: z.enum(["skip", "abort", "goto"]),
    gotoStepId: z.string().trim().min(1).max(80).optional(),
  }).optional(),
  /** Optional per-step timeout (ms). Falls back to DEFAULT_STEP_TIMEOUT_MS. */
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  /**
   * Optional list of step ids this step depends on. Future parallel
   * scheduler reads this field to build a DAG; today the orchestrator
   * still runs steps sequentially regardless.
   */
  dependsOn: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
});
export type AgentPlanV3Step = z.infer<typeof AgentPlanV3StepSchema>;

export const AgentPlanV3TaskPolicySchema = z.object({
  needsApproval: z.boolean().default(true),
  isolation: z.enum(["ui", "tool", "code"]).default("ui"),
  autoStart: z.boolean().default(false),
});
export type AgentPlanV3TaskPolicy = z.infer<typeof AgentPlanV3TaskPolicySchema>;

export const AgentPlanV3RollbackPolicySchema = z.object({
  mode: z.enum(["manual", "auto-on-failure", "none"]).default("manual"),
  compensationSteps: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
});
export type AgentPlanV3RollbackPolicy = z.infer<typeof AgentPlanV3RollbackPolicySchema>;

export const AgentPlanV3TelemetrySchema = z.object({
  runName: z.string().trim().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
});
export type AgentPlanV3Telemetry = z.infer<typeof AgentPlanV3TelemetrySchema>;

export const AgentPlanV3DecisionSchema = z.object({
  mode: AgentPlanV3DecisionModeSchema,
  reason: z.string().trim().max(300).optional(),
});
export type AgentPlanV3Decision = z.infer<typeof AgentPlanV3DecisionSchema>;

export const AgentPlanV3Schema = z.object({
  schemaVersion: z.literal("agent-plan.v3"),
  planId: z.string().trim().min(1).max(80),
  traceId: z.string().trim().min(1).max(120).optional(),
  intent: z.string().trim().min(1).max(240),
  summaryForUser: z.string().trim().min(1).max(600),
  clarificationQuestion: z.string().trim().max(300).optional(),
  clarificationOptions: z
    .array(z.string().trim().min(1).max(48))
    .max(4)
    .optional(),
  /** Citations behind this plan — see AgentPlanSchema.citations for shape. */
  citations: z
    .array(
      z.object({
        kind: z.enum(["memory", "page", "tool", "web"]).default("memory"),
        id: z.string().trim().min(1).max(160),
        label: z.string().trim().min(1).max(120).optional(),
      })
    )
    .max(8)
    .optional(),
  decision: AgentPlanV3DecisionSchema,
  routing: AgentPlanV3RoutingSchema.default({
    preferredEngine: "auto",
    capabilities: [],
    pageScope: "single",
  }),
  attachments: z.array(AgentPlanV3AttachmentSchema).max(12).default([]),
  safety: AgentPlanV3SafetySchema.default({
    riskLevel: "low",
    requiresHuman: false,
    reasons: [],
  }),
  steps: z.array(AgentPlanV3StepSchema).max(12).default([]),
  taskPolicy: AgentPlanV3TaskPolicySchema.optional(),
  rollbackPolicy: AgentPlanV3RollbackPolicySchema.optional(),
  telemetry: AgentPlanV3TelemetrySchema.optional(),
  warnings: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
}).superRefine((plan, ctx) => {
  if (plan.decision.mode === "clarification" && !plan.clarificationQuestion) {
    ctx.addIssue({
      code: "custom",
      path: ["clarificationQuestion"],
      message: "Clarification plans must include clarificationQuestion.",
    });
  }
  if (plan.decision.mode === "direct" && plan.steps.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["steps"],
      message: "Direct execution plans must include at least one step.",
    });
  }
  if (plan.decision.mode === "tasked" && plan.steps.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["steps"],
      message: "Tasked plans must include at least one step.",
    });
  }
  for (const step of plan.steps) {
    const highRiskAction = ["submit", "reset"].includes(step.action.type)
      || /publish|覆寫|overwrite|扣點|deduct/i.test(step.label);
    if (highRiskAction && !step.approvalGate) {
      step.approvalGate = true;
    }
  }
});
export type AgentPlanV3 = z.infer<typeof AgentPlanV3Schema>;

export type AgentPlanAny = AgentPlan | AgentPlanV3;

export interface SafeAgentPlanV3ParseResult {
  ok: boolean;
  plan?: AgentPlanV3;
  reason?: string;
  issues?: string[];
}

export function safeParseAgentPlanV3(input: unknown): SafeAgentPlanV3ParseResult {
  const parsed = AgentPlanV3Schema.safeParse(input);
  if (parsed.success) return { ok: true, plan: parsed.data };
  const issues = parsed.error.issues.map(issue => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });
  return {
    ok: false,
    reason: issues[0] ?? "Invalid agent plan v3",
    issues,
  };
}

export type AgentPlanVersion = "agent-plan.v1" | "agent-plan.v3" | "unknown";

export interface NormalizedAgentPlanInput {
  version: AgentPlanVersion;
  raw: unknown;
}

/** 從 LLM 原始輸出中辨識 schemaVersion，預設視為 v1 以維持向後相容。 */
export function normalizeAgentPlanVersion(input: unknown): NormalizedAgentPlanInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { version: "unknown", raw: input };
  }
  const declared = (input as Record<string, unknown>).schemaVersion;
  if (declared === "agent-plan.v3") return { version: "agent-plan.v3", raw: input };
  if (declared === "agent-plan.v1" || declared === undefined) {
    return { version: "agent-plan.v1", raw: input };
  }
  return { version: "unknown", raw: input };
}

export type SafeAgentPlanAnyParseResult =
  | { ok: true; version: "agent-plan.v1"; plan: AgentPlan }
  | { ok: true; version: "agent-plan.v3"; plan: AgentPlanV3 }
  | { ok: false; version: AgentPlanVersion; reason: string; issues?: string[] };

/** Parse v1 or v3 plan input safely. v1 is the default for unversioned input. */
export function safeParseAgentPlanAny(input: unknown): SafeAgentPlanAnyParseResult {
  const normalized = normalizeAgentPlanVersion(input);
  if (normalized.version === "agent-plan.v3") {
    const result = safeParseAgentPlanV3(normalized.raw);
    if (result.ok && result.plan) {
      return { ok: true, version: "agent-plan.v3", plan: result.plan };
    }
    return {
      ok: false,
      version: "agent-plan.v3",
      reason: result.reason ?? "Invalid AgentPlan v3.",
      issues: result.issues,
    };
  }
  if (normalized.version === "agent-plan.v1") {
    const result = safeParseAgentPlan(normalized.raw);
    if (result.ok && result.plan) {
      return { ok: true, version: "agent-plan.v1", plan: result.plan };
    }
    return {
      ok: false,
      version: "agent-plan.v1",
      reason: result.reason ?? "Invalid AgentPlan v1.",
      issues: result.issues,
    };
  }
  return {
    ok: false,
    version: "unknown",
    reason: "Planner output is not an object.",
  };
}

export const AGENT_PLAN_V3_JSON_SCHEMA = {
  name: "agent_plan_v3",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "planId",
      "intent",
      "summaryForUser",
      "decision",
      "routing",
      "attachments",
      "safety",
      "steps",
      "warnings",
    ],
    properties: {
      schemaVersion: { const: "agent-plan.v3" },
      planId: { type: "string", minLength: 1, maxLength: 80 },
      traceId: { type: "string", minLength: 1, maxLength: 120 },
      intent: { type: "string", minLength: 1, maxLength: 240 },
      summaryForUser: { type: "string", minLength: 1, maxLength: 600 },
      clarificationQuestion: { type: "string", maxLength: 300 },
      clarificationOptions: {
        type: "array",
        maxItems: 4,
        items: { type: "string", minLength: 1, maxLength: 48 },
      },
      decision: {
        type: "object",
        additionalProperties: false,
        required: ["mode"],
        properties: {
          mode: { enum: ["clarification", "direct", "tasked", "blocked"] },
          reason: { type: "string", maxLength: 300 },
        },
      },
      routing: {
        type: "object",
        additionalProperties: false,
        required: ["preferredEngine", "capabilities", "pageScope"],
        properties: {
          preferredEngine: { enum: ["auto", "gemini", "minimax", "claudeCode"] },
          capabilities: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 40 },
          },
          pageScope: { enum: ["single", "cross-page"] },
        },
      },
      attachments: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "mimeType", "url"],
          properties: {
            kind: { enum: ["image", "video", "audio", "pdf", "file"] },
            mimeType: { type: "string", minLength: 1, maxLength: 120 },
            url: { type: "string", minLength: 1, maxLength: 2048 },
            name: { type: "string", maxLength: 120 },
          },
        },
      },
      safety: {
        type: "object",
        additionalProperties: false,
        required: ["riskLevel", "requiresHuman", "reasons"],
        properties: {
          riskLevel: { enum: ["low", "medium", "high"] },
          requiresHuman: { type: "boolean" },
          reasons: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
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
            action: AGENT_PLAN_JSON_SCHEMA.schema.properties.steps.items.properties.action,
            riskLevel: { enum: ["low", "medium", "high"] },
            requiresApproval: { type: "boolean" },
            undoable: { type: "boolean" },
            compensationAction: AGENT_PLAN_JSON_SCHEMA.schema.properties.steps.items.properties.compensationAction,
            rationale: { type: "string", maxLength: 500 },
            toolName: { type: "string", minLength: 1, maxLength: 80 },
            toolArgs: { type: "object", additionalProperties: true },
            condition: {
              type: "object",
              additionalProperties: false,
              required: ["field", "operator", "value", "onFail"],
              properties: {
                field: { type: "string", minLength: 1, maxLength: 160 },
                operator: { enum: ["eq", "neq", "contains", "gt", "lt"] },
                value: {},
                onFail: { enum: ["skip", "abort", "goto"] },
                gotoStepId: { type: "string", minLength: 1, maxLength: 80 },
              },
            },
          },
        },
      },
      taskPolicy: {
        type: "object",
        additionalProperties: false,
        required: ["needsApproval", "isolation", "autoStart"],
        properties: {
          needsApproval: { type: "boolean" },
          isolation: { enum: ["ui", "tool", "code"] },
          autoStart: { type: "boolean" },
        },
      },
      rollbackPolicy: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "compensationSteps"],
        properties: {
          mode: { enum: ["manual", "auto-on-failure", "none"] },
          compensationSteps: {
            type: "array",
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
      },
      telemetry: {
        type: "object",
        additionalProperties: false,
        properties: {
          runName: { type: "string", maxLength: 80 },
          tags: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 60 },
          },
        },
      },
      warnings: AGENT_PLAN_JSON_SCHEMA.schema.properties.warnings,
    },
  },
} as const;
