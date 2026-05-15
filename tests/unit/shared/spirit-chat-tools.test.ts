/**
 * Unit tests for SPIRIT_CHAT_TOOLS — the 25-spirit chat-tool registry.
 *
 * Guards:
 *   - 全 25 位都被覆蓋（type-level + runtime size）
 *   - 5 位生成型 + 體體共 6 位走 fal-generation；最少字數一致
 *   - 路路 intentBased / 學學 toPath 對應正確
 *   - 查查 / 靈靈 走 search；其餘走 llm-persona / navigate
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
  it("covers every one of the 23 spirits exactly once", () => {
    const toolKeys = Object.keys(SPIRIT_CHAT_TOOLS).sort();
    const spiritKeys = Object.keys(SPIRIT_FAMILY).sort();
    expect(toolKeys).toEqual(spiritKeys);
    expect(toolKeys).toHaveLength(25);
  });

  it("classifies the 5 generators as fal-generation with consistent minimum length", () => {
    const generators: AgentRole[] = [
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
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

  it("reasoning + companion + proactive spirits are llm-persona (14 of the 23)", () => {
    const llmRoles: AgentRole[] = [
      "director",
      "composer",
      "critic",
      "companion",
      "accountant",
      "quality-coach",
      "inspector",
      // 7 位新增精靈中走 llm-persona 的 5 位（記記走 navigate）
      "legal-advisor",
      "security-guard",
      "onboarding-coach",
      "community-manager",
      "chief-orchestrator",
      // 步步：llm-persona 做計畫預演
      "plan-executor",
      // 細細：升級成 AI agent 後改走 llm-persona，靠 settingsDetail.* 工具
      "settings-detail",
    ];
    for (const role of llmRoles) {
      expect(getChatToolForSpirit(role).kind).toBe("llm-persona");
    }
  });

  it("記記 (notes-curator) navigates to /notes", () => {
    const notes = getChatToolForSpirit("notes-curator");
    expect(notes.kind).toBe("navigate");
    if (notes.kind === "navigate") expect(notes.toPath).toBe("/notes");
  });

  it("細細 (settings-detail) is an llm-persona agent (calls settingsDetail.* tools, not just navigate)", () => {
    const settings = getChatToolForSpirit("settings-detail");
    expect(settings.kind).toBe("llm-persona");
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
