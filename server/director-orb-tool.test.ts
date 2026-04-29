import { describe, expect, it } from "vitest";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
} from "../shared/global-agent-tools";

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
    expect(directorTools.length).toBeGreaterThanOrEqual(1);
    // 沒有重名
    const intersection = studioTools.filter(s => directorTools.includes(s));
    expect(intersection).toHaveLength(0);
  });
});
