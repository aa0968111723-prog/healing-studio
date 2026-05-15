import { describe, expect, it } from "vitest";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
} from "../../../shared/global-agent-tools";

describe("director.suggestPlan tool registration", () => {
  it("registers director.suggestPlan in the global agent registry", () => {
    const names = GLOBAL_AGENT_TOOL_REGISTRY.map(t => t.name);
    expect(names).toContain("director.suggestPlan");
  });

  it("director.suggestPlan does NOT require human approval", () => {
    // 規劃工具是讀取/建議性質，無實際副作用，不必每次彈確認
    const tool = getGlobalAgentTool("director.suggestPlan");
    expect(tool).not.toBeNull();
    expect(tool!.requiresHuman).toBe(false);
    expect(tool!.executionTarget).toBe("server-side");
    expect(tool!.riskLevel).toBe("low");
  });

  it("isKnownGlobalAgentTool recognises director.suggestPlan", () => {
    expect(isKnownGlobalAgentTool("director.suggestPlan")).toBe(true);
  });

  it("studio.* and director.* tools are independently registered", () => {
    const names = GLOBAL_AGENT_TOOL_REGISTRY.map(t => t.name);
    const studioTools = names.filter(n => n.startsWith("studio."));
    const directorTools = names.filter(n => n.startsWith("director."));
    expect(studioTools.length).toBeGreaterThanOrEqual(4);
    // 升級後導導從 1 個工具擴張到 5 個（suggestPlan + composeWorkflow +
    // estimateBudget + suggestHandoff + refineWorkflow），這個下限避免
    // 未來有人不小心移掉某個 agent 能力。
    expect(directorTools.length).toBeGreaterThanOrEqual(5);
    // 沒有重名
    const intersection = studioTools.filter(s => directorTools.includes(s));
    expect(intersection).toHaveLength(0);
  });

  // ─── 新增 agent 能力：4 個 director.* 工具 ──────────────────────────
  it.each([
    "director.composeWorkflow",
    "director.estimateBudget",
    "director.suggestHandoff",
    "director.refineWorkflow",
  ])("registers %s as a low-risk, no-confirmation server-side tool", toolName => {
    const tool = getGlobalAgentTool(toolName);
    expect(tool).not.toBeNull();
    expect(tool!.riskLevel).toBe("low");
    expect(tool!.requiresHuman).toBe(false);
    expect(tool!.executionTarget).toBe("server-side");
    expect(isKnownGlobalAgentTool(toolName)).toBe(true);
  });
});
