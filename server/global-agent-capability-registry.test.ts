import { describe, expect, it } from "vitest";
import {
  GLOBAL_AGENT_CAPABILITY_REGISTRY,
  hasCapabilityForPage,
  summarizeGlobalCapabilityRegistry,
  validateCapabilityRegistry,
} from "../shared/global-agent-capabilities";
import {
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
  summarizeGlobalToolRegistry,
} from "../shared/global-agent-tools";
import { evaluateAgentPlanV3Risk } from "../shared/agent-plan-safety";
import { AgentPlanV3Schema } from "../shared/agent-plan-schema";
import { buildAgentPlannerMessages } from "./services/agentPlanner";
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";

describe("global capability/tool registry", () => {
  it("every capability has pageId/pagePath/actionType and registry has no duplicate ids", () => {
    expect(GLOBAL_AGENT_CAPABILITY_REGISTRY.length).toBeGreaterThan(0);
    for (const capability of GLOBAL_AGENT_CAPABILITY_REGISTRY) {
      expect(capability.pageId).toBeTruthy();
      expect(capability.pagePath).toMatch(/^\//);
      expect(capability.actionType).toBeTruthy();
    }
    const validation = validateCapabilityRegistry();
    expect(validation.ok).toBe(true);
    expect(validation.duplicates).toEqual([]);
  });

  it("every PageAgent-enabled page has registered capabilities", () => {
    const pages = APP_PAGE_REGISTRY.filter(page => page.supportsPageAgent);
    for (const page of pages) {
      const byPage = GLOBAL_AGENT_CAPABILITY_REGISTRY.filter(cap => cap.pageId === page.id);
      expect(byPage.length).toBeGreaterThan(0);
      expect(byPage.every(cap => cap.pagePath === page.path)).toBe(true);
    }
  });

  it("tool registry knows allowed tools and rejects unknown tools", () => {
    expect(isKnownGlobalAgentTool("media.transcribe")).toBe(true);
    expect(isKnownGlobalAgentTool("unknown.tool")).toBe(false);
    expect(getGlobalAgentTool("github.pr.create")?.requiresHuman).toBe(true);
  });

  it("planner prompt includes capability and tool registry summary", () => {
    const messages = buildAgentPlannerMessages({
      messages: [{ role: "user", content: "幫我做短片" }],
      recentTaskMemorySummary: "recent-task-memory",
    });
    const system = String(messages[0]?.content ?? "");
    expect(system).toContain("Global capability registry summary");
    expect(system).toContain("Global tool registry summary");
    expect(system).toContain("recent-task-memory");
  });

  it("risk gate blocks unregistered page capability", () => {
    const plan = AgentPlanV3Schema.parse({
      schemaVersion: "agent-plan.v3",
      planId: "p1",
      intent: "unsupported page action",
      summaryForUser: "try action",
      decision: { mode: "direct" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
      steps: [
        {
          id: "s1",
          label: "fill",
          pagePath: "/not-registered-page",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: { type: "setModel", modelId: "x" },
        },
      ],
      warnings: [],
    });
    const risk = evaluateAgentPlanV3Risk(plan);
    expect(risk.decisionMode).toBe("blocked");
  });

  it("ClaudeCode tool is high risk and requires human", () => {
    const tool = getGlobalAgentTool("code.modifyWithClaudeCode");
    expect(tool?.requiresHuman).toBe(true);
    expect(tool?.riskLevel).toBe("high");
  });

  it("registry summaries are compact JSON", () => {
    expect(() => JSON.parse(summarizeGlobalCapabilityRegistry())).not.toThrow();
    expect(() => JSON.parse(summarizeGlobalToolRegistry())).not.toThrow();
  });

  it("hasCapabilityForPage returns false when page/action is unavailable", () => {
    expect(hasCapabilityForPage("/studio", "setModel")).toBe(true);
    expect(hasCapabilityForPage("/unknown", "setModel")).toBe(false);
  });
});
