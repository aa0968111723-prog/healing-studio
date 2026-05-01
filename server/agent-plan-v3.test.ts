/**
 * agent-plan-v3.test.ts
 *
 * Production-grade gating contract for agent-plan.v3.
 *
 * Required scenarios (matching the implementation brief):
 *  - v1 plan still converts (legacy path).
 *  - v3 direct plan converts to AgentAction[].
 *  - v3 tasked plan materialises an OrbTask draft.
 *  - v3 clarification plan returns no actions.
 *  - v3 blocked plan returns no actions and asks for confirmation.
 *  - invalid JSON fails safely (status="invalid", no crash).
 *  - unknown action is blocked.
 *  - submit action requires approval (high risk + requiresHuman).
 *  - code task routes to ClaudeCode + tasked.
 *  - multimodal task forces preferredEngine=gemini and risk >= medium.
 */

import { describe, expect, it } from "vitest";
import {
  AgentPlanSchema,
  AgentPlanV3Schema,
  AGENT_PLAN_V3_JSON_SCHEMA,
  normalizeAgentPlanVersion,
  safeParseAgentPlan,
  safeParseAgentPlanAny,
  safeParseAgentPlanV3,
  type AgentPlanV3,
} from "../shared/agent-plan-schema";
import {
  evaluateAgentPlanV3Risk,
  isKnownAgentTool,
} from "../shared/agent-plan-safety";
import {
  adaptAgentPlanV3ToActions,
  adaptAgentPlanV3ToOrbTaskDraft,
  parseAndGatePlan,
} from "../shared/agent-plan-adapter";

function buildV3Plan(overrides: Partial<AgentPlanV3> = {}): AgentPlanV3 {
  return AgentPlanV3Schema.parse({
    schemaVersion: "agent-plan.v3",
    planId: "plan_001",
    intent: "fill prompt for poster",
    summaryForUser: "我會把提示詞填好。",
    decision: { mode: "direct" },
    routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
    attachments: [],
    safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
    steps: [
      {
        id: "fill",
        label: "填入提示詞",
        pagePath: "/studio",
        riskLevel: "low",
        requiresApproval: false,
        undoable: true,
        action: { type: "fillPrompt", text: "電影感海報" },
      },
    ],
    warnings: [],
    ...overrides,
  });
}

describe("agent-plan-schema v3 ↔ v1 compatibility", () => {
  it("normalizeAgentPlanVersion detects v3, v1 and unknown", () => {
    expect(normalizeAgentPlanVersion({ schemaVersion: "agent-plan.v3" }).version).toBe(
      "agent-plan.v3"
    );
    expect(normalizeAgentPlanVersion({ schemaVersion: "agent-plan.v1" }).version).toBe(
      "agent-plan.v1"
    );
    // unversioned input defaults to v1 for backwards compat
    expect(normalizeAgentPlanVersion({ intent: "x" }).version).toBe("agent-plan.v1");
    expect(normalizeAgentPlanVersion("not an object").version).toBe("unknown");
    expect(normalizeAgentPlanVersion({ schemaVersion: "agent-plan.vX" }).version).toBe(
      "unknown"
    );
  });

  it("safeParseAgentPlan still parses a valid v1 plan unchanged", () => {
    const result = safeParseAgentPlan({
      schemaVersion: "agent-plan.v1",
      intent: "make poster",
      confidence: 0.9,
      summaryForUser: "我會幫你填入提示詞。",
      shouldAskClarification: false,
      warnings: [],
      steps: [
        {
          id: "fill",
          label: "填入提示詞",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "電影感海報" },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.schemaVersion).toBe("agent-plan.v1");
  });

  it("safeParseAgentPlanV3 accepts a minimal valid v3 plan", () => {
    const result = safeParseAgentPlanV3({
      schemaVersion: "agent-plan.v3",
      planId: "plan_42",
      intent: "fill prompt",
      summaryForUser: "ok",
      decision: { mode: "direct" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
      steps: [
        {
          id: "s1",
          label: "fill",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "hello" },
        },
      ],
      warnings: [],
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.planId).toBe("plan_42");
  });

  it("safeParseAgentPlanAny dispatches by schemaVersion", () => {
    const v3 = safeParseAgentPlanAny({
      schemaVersion: "agent-plan.v3",
      planId: "p",
      intent: "i",
      summaryForUser: "s",
      decision: { mode: "clarification" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
      steps: [],
      warnings: [],
      clarificationQuestion: "你想做什麼？",
    });
    expect(v3.ok).toBe(true);
    if (v3.ok) expect(v3.version).toBe("agent-plan.v3");

    const v1 = safeParseAgentPlanAny({
      schemaVersion: "agent-plan.v1",
      intent: "noop",
      summaryForUser: "noop",
      shouldAskClarification: true,
      clarificationQuestion: "你想做什麼？",
      steps: [],
      warnings: [],
    });
    expect(v1.ok).toBe(true);
    if (v1.ok) expect(v1.version).toBe("agent-plan.v1");
  });

  it("AGENT_PLAN_V3_JSON_SCHEMA shape is exported for structured-output LLM calls", () => {
    expect(AGENT_PLAN_V3_JSON_SCHEMA.name).toBe("agent_plan_v3");
    expect(AGENT_PLAN_V3_JSON_SCHEMA.strict).toBe(true);
    expect(AGENT_PLAN_V3_JSON_SCHEMA.schema.required).toContain("decision");
    expect(AGENT_PLAN_V3_JSON_SCHEMA.schema.required).toContain("safety");
  });
});

describe("evaluateAgentPlanV3Risk — risk rules", () => {
  it("treats fillPrompt-only single-page plan as low-risk direct", () => {
    const plan = buildV3Plan();
    const evaluation = evaluateAgentPlanV3Risk(plan);
    expect(evaluation.riskLevel).toBe("low");
    expect(evaluation.requiresHuman).toBe(false);
    expect(evaluation.decisionMode).toBe("direct");
    expect(evaluation.blockers).toHaveLength(0);
  });

  it("flags submit/reset/applyPreset as high-risk and requires human", () => {
    for (const actionType of ["submit", "reset", "applyPreset"] as const) {
      const action =
        actionType === "applyPreset"
          ? { type: "applyPreset" as const, presetId: "x" }
          : { type: actionType };
      const plan = buildV3Plan({
        steps: [
          {
            id: actionType,
            label: actionType,
            pagePath: "/studio",
            riskLevel: "high",
            requiresApproval: true,
            undoable: false,
            action,
          },
        ],
      });
      const evaluation = evaluateAgentPlanV3Risk(plan);
      expect(evaluation.riskLevel).toBe("high");
      expect(evaluation.requiresHuman).toBe(true);
    }
  });

  it("auto-corrects submit step missing requiresApproval=true instead of blocking", () => {
    const plan = buildV3Plan({
      steps: [
        {
          id: "submit",
          label: "送出",
          pagePath: "/studio",
          riskLevel: "high",
          requiresApproval: false,
          undoable: false,
          action: { type: "submit" },
        },
      ],
    });
    const evaluation = evaluateAgentPlanV3Risk(plan);
    // Plan is no longer blocked just because the planner forgot one boolean —
    // we coerce requiresApproval=true and emit a warning. Runtime gates still
    // enforce human approval at execution time.
    expect(evaluation.decisionMode).not.toBe("blocked");
    expect(evaluation.requiresHuman).toBe(true);
    expect(plan.steps[0].requiresApproval).toBe(true);
    expect(evaluation.warnings.map(b => b.reason)).toContain("high_risk_without_approval");
  });

  it("upgrades cross-page multi-step plan to tasked", () => {
    const plan = buildV3Plan({
      routing: {
        preferredEngine: "auto",
        capabilities: [],
        pageScope: "cross-page",
      },
      steps: [
        {
          id: "s1",
          label: "fill on /director",
          pagePath: "/director",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "腳本" },
        },
        {
          id: "s2",
          label: "fill on /image-studio",
          pagePath: "/image-studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "封面" },
        },
      ],
    });
    const evaluation = evaluateAgentPlanV3Risk(plan);
    expect(evaluation.taskedRequired).toBe(true);
    expect(evaluation.decisionMode).toBe("tasked");
  });

  it("forces tasked + claudeCode for code/github/deploy capabilities", () => {
    for (const capability of ["code", "github", "deploy"]) {
      const plan = buildV3Plan({
        routing: { preferredEngine: "auto", capabilities: [capability], pageScope: "single" },
        steps: [
          {
            id: "s1",
            label: "run code",
            pagePath: "/director",
            riskLevel: "medium",
            requiresApproval: true,
            undoable: false,
            action: { type: "fillPrompt", text: "執行某段程式" },
          },
        ],
      });
      const evaluation = evaluateAgentPlanV3Risk(plan);
      expect(evaluation.needsClaudeCode).toBe(true);
      expect(evaluation.preferredEngine).toBe("claudeCode");
      expect(evaluation.decisionMode).toBe("tasked");
      expect(evaluation.requiresHuman).toBe(true);
    }
  });

  it("multimodal generation forces risk >= medium and prefers gemini", () => {
    const plan = buildV3Plan({
      attachments: [
        { kind: "image", mimeType: "image/png", url: "https://cdn.test/photo.png" },
      ],
      routing: { preferredEngine: "auto", capabilities: ["multimodal"], pageScope: "single" },
    });
    const evaluation = evaluateAgentPlanV3Risk(plan);
    expect(evaluation.isMultimodal).toBe(true);
    expect(evaluation.riskLevel === "medium" || evaluation.riskLevel === "high").toBe(true);
    expect(evaluation.preferredEngine).toBe("gemini");
  });

  it("blocks unknown tool names", () => {
    const plan = buildV3Plan({
      steps: [
        {
          id: "tool",
          label: "use unknown tool",
          pagePath: "/studio",
          riskLevel: "medium",
          requiresApproval: true,
          undoable: false,
          action: { type: "fillPrompt", text: "tool" },
          toolName: "unregistered.delete-everything",
        },
      ],
    });
    const evaluation = evaluateAgentPlanV3Risk(plan);
    expect(evaluation.blockers.some(b => b.message.includes("Unknown tool"))).toBe(true);
    expect(evaluation.decisionMode).toBe("blocked");
  });

  it("isKnownAgentTool returns false for an obviously bogus name", () => {
    expect(isKnownAgentTool("not.a.real.tool")).toBe(false);
    expect(isKnownAgentTool("github.review")).toBe(true);
  });
});

describe("parseAndGatePlan — gating across versions", () => {
  it("v1 plan still converts via parseAndGatePlan", () => {
    const result = parseAndGatePlan({
      schemaVersion: "agent-plan.v1",
      intent: "make poster",
      confidence: 0.9,
      summaryForUser: "我會幫你填入提示詞。",
      shouldAskClarification: false,
      warnings: [],
      steps: [
        {
          id: "fill",
          label: "填入提示詞",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "電影感海報" },
        },
      ],
    });
    expect(result.status).toBe("converted");
    expect(result.version).toBe("agent-plan.v1");
    expect(result.actions[0]?.type).toBe("runWorkflow");
  });

  it("v3 direct plan converts to AgentAction[]", () => {
    const plan = buildV3Plan();
    const result = parseAndGatePlan(plan);
    expect(result.status).toBe("converted");
    expect(result.version).toBe("agent-plan.v3");
    expect(result.decisionMode).toBe("direct");
    expect(result.actions[0]?.type).toBe("runWorkflow");
    expect(result.askBeforeAct).toBe(false);
  });

  it("v3 tasked plan materialises an OrbTask draft", () => {
    const plan = buildV3Plan({
      decision: { mode: "tasked" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "cross-page" },
      taskPolicy: { needsApproval: true, isolation: "ui", autoStart: false },
      steps: [
        {
          id: "s1",
          label: "go to /director",
          pagePath: "/director",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "腳本" },
        },
        {
          id: "s2",
          label: "swap to /image-studio",
          pagePath: "/image-studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "封面" },
        },
      ],
    });
    const result = parseAndGatePlan(plan);
    expect(result.status).toBe("tasked");
    expect(result.task).toBeDefined();
    expect(result.task?.steps.map(s => s.id)).toEqual(["s1", "s2"]);
    expect(result.task?.needsApproval).toBe(true);
    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(true);
  });

  it("v3 clarification plan returns no actions", () => {
    const plan = buildV3Plan({
      decision: { mode: "clarification" },
      clarificationQuestion: "你想做圖片還是影片？",
      steps: [],
    });
    const result = parseAndGatePlan(plan);
    expect(result.status).toBe("clarification");
    expect(result.actions).toEqual([]);
    expect(result.task).toBeUndefined();
    expect(result.reply).toContain("圖片還是影片");
  });

  it("v3 high-risk submit without approval auto-corrects and converts (askBeforeAct stays on)", () => {
    const plan = buildV3Plan({
      decision: { mode: "direct" },
      steps: [
        {
          id: "submit",
          label: "送出",
          pagePath: "/studio",
          riskLevel: "high",
          requiresApproval: false,
          undoable: false,
          action: { type: "submit" },
        },
      ],
    });
    const result = parseAndGatePlan(plan);
    // Auto-fix: instead of blocking, the plan converts to a runnable
    // workflow with the approval gate still on. This unblocks the
    // multi-step wizard flow when the planner forgets the boolean.
    expect(result.status).toBe("converted");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.askBeforeAct).toBe(true);
  });

  it("invalid JSON fails safely with status='invalid' and no crash", () => {
    const result = parseAndGatePlan("this is not JSON, just rambling text");
    expect(result.status).toBe("invalid");
    expect(result.ok).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it("malformed v3 (missing decision) is reported as invalid", () => {
    const result = parseAndGatePlan({
      schemaVersion: "agent-plan.v3",
      planId: "p",
      intent: "x",
      summaryForUser: "x",
      // decision missing
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
      steps: [],
      warnings: [],
    });
    expect(result.status).toBe("invalid");
    expect(result.version).toBe("agent-plan.v3");
  });

  it("unknown action smuggled into a valid v3 envelope is blocked at the safety layer", () => {
    // Build a structurally-valid v3 plan, then mutate the action type after
    // parsing to simulate an upstream bug bypassing zod. The safety layer must
    // still mark it as a blocker (unknown_action).
    const plan = buildV3Plan();
    (plan.steps[0].action as { type: string }).type = "deleteAccount";
    const evaluation = evaluateAgentPlanV3Risk(plan);
    expect(evaluation.blockers.map(b => b.reason)).toContain("unknown_action");
    expect(evaluation.decisionMode).toBe("blocked");
  });

  it("unknown action submitted as raw planner JSON is rejected as invalid (no execution)", () => {
    // Schema-level rejection is also a safe outcome: actions don't execute.
    const result = parseAndGatePlan({
      schemaVersion: "agent-plan.v3",
      planId: "p",
      intent: "i",
      summaryForUser: "s",
      decision: { mode: "direct" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
      steps: [
        {
          id: "bad",
          label: "Bad",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "deleteAccount" },
        },
      ],
      warnings: [],
    });
    expect(["invalid", "blocked"]).toContain(result.status);
    expect(result.actions).toEqual([]);
  });

  it("submit action requires approval (high risk + requiresHuman)", () => {
    const plan = buildV3Plan({
      steps: [
        {
          id: "submit",
          label: "送出生成",
          pagePath: "/studio",
          riskLevel: "high",
          requiresApproval: true,
          undoable: false,
          action: { type: "submit" },
        },
      ],
    });
    const result = parseAndGatePlan(plan);
    // approved → still askBeforeAct because risk is high
    expect(result.askBeforeAct).toBe(true);
    expect(result.riskEvaluation?.requiresHuman).toBe(true);
    expect(result.riskEvaluation?.riskLevel).toBe("high");
  });

  it("code task routes to ClaudeCode + tasked mode", () => {
    const plan = buildV3Plan({
      routing: { preferredEngine: "auto", capabilities: ["code"], pageScope: "single" },
      decision: { mode: "direct" },
      steps: [
        {
          id: "scaffold",
          label: "scaffold backend route",
          pagePath: "/director",
          riskLevel: "medium",
          requiresApproval: true,
          undoable: false,
          action: { type: "fillPrompt", text: "scaffold a tRPC router" },
        },
      ],
    });
    const result = parseAndGatePlan(plan);
    expect(result.status).toBe("tasked");
    expect(result.preferredEngine).toBe("claudeCode");
    expect(result.task?.preferredEngine).toBe("claudeCode");
    expect(result.task?.isolation).toBe("code");
  });

  it("multimodal task forces preferredEngine=gemini and risk >= medium", () => {
    const plan = buildV3Plan({
      attachments: [
        { kind: "audio", mimeType: "audio/mpeg", url: "https://cdn.test/voice.mp3" },
      ],
      routing: { preferredEngine: "auto", capabilities: ["multimodal"], pageScope: "single" },
    });
    const result = parseAndGatePlan(plan);
    expect(result.preferredEngine).toBe("gemini");
    expect(["medium", "high"]).toContain(result.riskEvaluation?.riskLevel);
  });

  it("adaptAgentPlanV3ToActions returns a runWorkflow for direct plans", () => {
    const actions = adaptAgentPlanV3ToActions(buildV3Plan());
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe("runWorkflow");
  });

  it("adaptAgentPlanV3ToOrbTaskDraft preserves planId, intent and steps", () => {
    const plan = buildV3Plan({
      planId: "task_xyz",
      decision: { mode: "tasked" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "cross-page" },
      steps: [
        {
          id: "a",
          label: "do A",
          pagePath: "/director",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "a" },
        },
        {
          id: "b",
          label: "do B",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "b" },
        },
      ],
    });
    const evaluation = evaluateAgentPlanV3Risk(plan);
    const draft = adaptAgentPlanV3ToOrbTaskDraft(plan, evaluation);
    expect(draft.taskId).toBe("task_xyz");
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[0].uiActions[0]?.type).toBe("fillPrompt");
  });
});

describe("AgentPlanSchema (v1) is preserved unchanged", () => {
  it("rejects v3 schemaVersion", () => {
    const result = AgentPlanSchema.safeParse({
      schemaVersion: "agent-plan.v3",
      intent: "x",
      summaryForUser: "x",
      shouldAskClarification: false,
      warnings: [],
      steps: [
        {
          id: "x",
          label: "x",
          pagePath: "/studio",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "x" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
