/**
 * server/orb-prompt-skill-injection.test.ts
 *
 * Regression — until now the 12 agent roles + 6 specialists existed only
 * as type definitions; `buildOrbSystemPrompt` never consulted them, so
 * the LLM always saw the same single-personality prompt regardless of
 * what the user said. These tests lock in the new wiring: when a
 * userMessage is supplied, the system prompt MUST contain a
 * `【本回合 Agent Skill】` block whose selected skill matches the
 * intent.
 */
import { describe, expect, it } from "vitest";
import { buildOrbSystemPrompt } from "./services/siteKnowledge";

describe("buildOrbSystemPrompt — Agent Skill injection", () => {
  it("omits the skill block entirely when no userMessage is provided", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {});
    expect(prompt).not.toMatch(/【本回合 Agent Skill】/);
  });

  it("emits the skill block when userMessage is provided", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      userMessage: "畫一張賽博龐克風格的圖片",
    });
    expect(prompt).toMatch(/【本回合 Agent Skill】/);
    expect(prompt).toMatch(/圖像精靈/);
    // The role-specific slice for image-specialist should also appear.
    expect(prompt).toMatch(/圖像精靈|image specialist/i);
  });

  it("picks director for cross-page planning intents", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      userMessage: "幫我規劃一個從腳本到影片到配樂的完整工作流",
    });
    expect(prompt).toMatch(/【本回合 Agent Skill】/);
    expect(prompt).toMatch(/導演/);
  });

  it("picks navigator for explicit \"take me to X\" intents", () => {
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      userMessage: "帶我去個人設定頁面",
    });
    expect(prompt).toMatch(/【本回合 Agent Skill】/);
    expect(prompt).toMatch(/導航/);
  });

  it("uses recentTools as a tiebreaker", () => {
    // Latest message is ambiguous, but recentTools=studio.generateImage
    // should pull the skill toward image-specialist.
    const prompt = buildOrbSystemPrompt("creative", undefined, {
      userMessage: "再來一張",
      recentTools: ["studio.generateImage"],
    });
    expect(prompt).toMatch(/【本回合 Agent Skill】/);
    expect(prompt).toMatch(/圖像精靈/);
  });
});
