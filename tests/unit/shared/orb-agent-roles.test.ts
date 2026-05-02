/**
 * tests/unit/shared/orb-agent-roles.test.ts
 *
 * Module — multi-agent role routing.
 */
import { describe, expect, it } from "vitest";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import {
  composeRoleChain,
  getRoleSystemPromptSlice,
  selectRoleForIntent,
  summarizeRoleChainForPrompt,
} from "../../../shared/orb-agent-roles";

const studioSnap = (path = "/studio"): PageAgentSnapshot => ({
  pageId: "studio",
  pageLabel: "Studio",
  pagePath: path,
  capabilities: [],
});

describe("selectRoleForIntent", () => {
  it("routes multi-step requests to director", () => {
    const r = selectRoleForIntent({ text: "幫我把整個流程拼起來，從腳本到影片到配樂" });
    expect(r.role).toBe("director");
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("routes lookup intents to researcher", () => {
    const r = selectRoleForIntent({ text: "幫我比較 Flux 和 SDXL 的差別" });
    expect(r.role).toBe("researcher");
  });

  it("routes review intents to critic", () => {
    const r = selectRoleForIntent({ text: "這個提示詞幫我改一下，再好一點" });
    expect(r.role).toBe("critic");
  });

  it("routes navigate intents to navigator", () => {
    const r = selectRoleForIntent({ text: "帶我去訓練模型那邊" });
    expect(r.role).toBe("navigator");
  });

  it("routes short imperative on a studio page to composer", () => {
    const r = selectRoleForIntent({
      text: "再來一張",
      snapshot: studioSnap("/image-studio"),
    });
    expect(r.role).toBe("composer");
  });

  it("routes empty text to companion", () => {
    const r = selectRoleForIntent({ text: "" });
    expect(r.role).toBe("companion");
  });

  it("routes ambiguous off-studio text to companion", () => {
    const r = selectRoleForIntent({ text: "嗨，今天天氣不錯" });
    expect(r.role).toBe("companion");
  });
});

describe("composeRoleChain", () => {
  it("director chain ends with critic", () => {
    const chain = composeRoleChain({ text: "幫我規劃一個跨頁工作流" });
    expect(chain).toEqual(["director", "composer", "critic"]);
  });
  it("navigator chain is single-role", () => {
    const chain = composeRoleChain({ text: "帶我去學習中心" });
    expect(chain).toEqual(["navigator"]);
  });
  it("researcher chain leads with researcher then planning", () => {
    const chain = composeRoleChain({ text: "請查 SDXL vs Flux 差別" });
    expect(chain[0]).toBe("researcher");
    expect(chain).toContain("director");
  });
});

describe("getRoleSystemPromptSlice", () => {
  it("emits a non-empty prompt for every role", () => {
    const roles = ["director", "composer", "critic", "researcher", "navigator", "companion"] as const;
    for (const r of roles) {
      const slice = getRoleSystemPromptSlice(r);
      expect(slice.length).toBeGreaterThan(20);
    }
  });

  it("director prompt mentions runWorkflow and cross-page planning", () => {
    expect(getRoleSystemPromptSlice("director")).toMatch(/runWorkflow/);
  });
});

describe("summarizeRoleChainForPrompt", () => {
  it("returns Chinese chain summary for multi-role chains", () => {
    expect(summarizeRoleChainForPrompt(["director", "composer"])).toMatch(/角色鏈/);
  });
  it("returns single-role label for length-1 chains", () => {
    expect(summarizeRoleChainForPrompt(["navigator"])).toMatch(/角色/);
    expect(summarizeRoleChainForPrompt(["navigator"])).not.toMatch(/角色鏈/);
  });
  it("returns empty string for empty chain", () => {
    expect(summarizeRoleChainForPrompt([])).toBe("");
  });
});
