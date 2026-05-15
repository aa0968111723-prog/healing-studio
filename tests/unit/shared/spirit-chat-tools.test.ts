/**
 * Unit tests for SPIRIT_CHAT_TOOLS — the 25-spirit chat-tool registry.
 *
 * Guards:
 *   - 全 25 位都被覆蓋（type-level + runtime size）
 *   - 6 位生成型走 fal-generation（含體體）；最少字數一致
 *   - 路路 intentBased / 學學 toPath 對應正確
 *   - 查查 + 靈靈 走 search；編編 走 page-execution；其餘走 llm-persona / navigate
 *   - SPIRIT_COLLAB_PROTOCOL 對 25 位都有條目（協作機制覆蓋一致）
 */
import { describe, expect, it } from "vitest";
import {
  SPIRIT_CHAT_TOOLS,
  getChatToolForSpirit,
} from "../../../shared/spirit-chat-tools";
import {
  SPIRIT_FAMILY,
  SPIRIT_COLLAB_PROTOCOL,
  type AgentRole,
} from "../../../shared/orb-agent-roles";

describe("SPIRIT_CHAT_TOOLS", () => {
  it("covers every one of the 25 spirits exactly once", () => {
    const toolKeys = Object.keys(SPIRIT_CHAT_TOOLS).sort();
    const spiritKeys = Object.keys(SPIRIT_FAMILY).sort();
    expect(toolKeys).toEqual(spiritKeys);
    // 25 = 6 generic role + 9 specialists (含 community-manager / 靈靈 / 體體)
    //     + 3 proactive + 7 new spirits
    expect(toolKeys).toHaveLength(25);
  });

  it("classifies the 6 generators as fal-generation with consistent minimum length", () => {
    const generators: AgentRole[] = [
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
      // 體體 — 解剖圖也走 fal.ai 生成
      "anatomy-specialist",
    ];
    for (const role of generators) {
      const tool = getChatToolForSpirit(role);
      expect(tool.kind).toBe("fal-generation");
      if (tool.kind === "fal-generation") {
        expect(tool.minPromptChars).toBe(6);
      }
    }
  });

  it("學學 (learning-specialist) navigates to /learn-hub", () => {
    const tool = getChatToolForSpirit("learning-specialist");
    expect(tool.kind).toBe("navigate");
    if (tool.kind === "navigate") {
      expect(tool.toPath).toBe("/learn-hub");
      expect(tool.intentBased).toBeFalsy();
    }
  });

  it("路路 (navigator) navigates intent-based, no fixed path", () => {
    const tool = getChatToolForSpirit("navigator");
    expect(tool.kind).toBe("navigate");
    if (tool.kind === "navigate") {
      expect(tool.intentBased).toBe(true);
      expect(tool.toPath).toBeUndefined();
    }
  });

  it("查查 (researcher) is a search tool", () => {
    const tool = getChatToolForSpirit("researcher");
    expect(tool.kind).toBe("search");
  });

  it("reasoning + companion + proactive spirits are llm-persona (11 of the 25)", () => {
    const llmRoles: AgentRole[] = [
      "director",
      // 編編 (composer) 改走 page-execution — 不再是 llm-persona
      "critic",
      "companion",
      "accountant",
      "quality-coach",
      "inspector",
      // 7 位新增精靈中走 llm-persona 的 5 位（記記 / 細細走 navigate）
      "legal-advisor",
      "security-guard",
      "onboarding-coach",
      "community-manager",
      "chief-orchestrator",
    ];
    for (const role of llmRoles) {
      expect(getChatToolForSpirit(role).kind).toBe("llm-persona");
    }
  });

  it("步步 (plan-executor) is upgraded from llm-persona to agent-plan", () => {
    const tool = getChatToolForSpirit("plan-executor");
    expect(tool.kind).toBe("agent-plan");
    if (tool.kind === "agent-plan") {
      expect(tool.minPromptChars).toBe(6);
    }
  });

  it("編編 (composer) is page-execution — parses user imperatives into AgentActions and dispatches", () => {
    const tool = getChatToolForSpirit("composer");
    expect(tool.kind).toBe("page-execution");
    if (tool.kind === "page-execution") {
      // Short threshold: even one word commands like "送出" should trigger parsing.
      expect(tool.minPromptChars).toBeLessThanOrEqual(6);
      expect(tool.minPromptChars).toBeGreaterThan(0);
    }
  });

  it("記記 (notes-curator) navigates to /notes; 細細 (settings-detail) navigates to /settings", () => {
    const notes = getChatToolForSpirit("notes-curator");
    expect(notes.kind).toBe("navigate");
    if (notes.kind === "navigate") expect(notes.toPath).toBe("/notes");

    const settings = getChatToolForSpirit("settings-detail");
    expect(settings.kind).toBe("navigate");
    if (settings.kind === "navigate") expect(settings.toPath).toBe("/settings");
  });
});

describe("SPIRIT_COLLAB_PROTOCOL coverage (25-spirit collab mechanism)", () => {
  it("has a collab spec for every one of the 25 spirits", () => {
    const collabKeys = Object.keys(SPIRIT_COLLAB_PROTOCOL).sort();
    const spiritKeys = Object.keys(SPIRIT_FAMILY).sort();
    expect(collabKeys).toEqual(spiritKeys);
    expect(collabKeys).toHaveLength(25);
  });

  it("every spirit hands off to at least one other spirit (no dead-ends)", () => {
    for (const role of Object.keys(SPIRIT_COLLAB_PROTOCOL) as AgentRole[]) {
      const spec = SPIRIT_COLLAB_PROTOCOL[role];
      expect(spec.handoffs.length).toBeGreaterThan(0);
      // 不能交棒給自己
      for (const h of spec.handoffs) {
        expect(h.to).not.toBe(role);
      }
    }
  });
});
