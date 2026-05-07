/**
 * tests/unit/shared/agent-skills.test.ts
 *
 * Module — unified agent skill registry. Mirrors the orb-agent-roles
 * test layout (intent → role) but focuses on the additional bindings
 * the skill registry brings in: recommended pages, tools, and the
 * selectSkillForIntent priority order (tool > intent > page > fallback).
 */
import { describe, expect, it } from "vitest";
import type { PageAgentSnapshot } from "../../../shared/agent-actions";
import {
  AGENT_SKILL_REGISTRY,
  buildSkillTurnPromptSlice,
  composeSkillChain,
  findSkillForPage,
  findSkillForTool,
  getSkill,
  getSkillRecommendedPages,
  selectSkillForIntent,
  serializeSkillsForPrompt,
  validateSkillRegistry,
} from "../../../shared/agent-skills";

const studioSnap = (path = "/image-studio"): PageAgentSnapshot => ({
  pageId: "image-studio",
  pageLabel: "Image Studio",
  pagePath: path,
  capabilities: [],
});

describe("AGENT_SKILL_REGISTRY", () => {
  it("contains all 12 known skills (6 generic + 6 specialists)", () => {
    expect(AGENT_SKILL_REGISTRY.length).toBe(12);
    const ids = new Set(AGENT_SKILL_REGISTRY.map(s => s.id));
    for (const id of [
      "director",
      "composer",
      "critic",
      "researcher",
      "navigator",
      "companion",
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
      "learning-specialist",
    ] as const) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("validates clean — every recommended page exists in APP_PAGE_REGISTRY", () => {
    const result = validateSkillRegistry();
    expect(result.ok).toBe(true);
    expect(result.unknownPages).toEqual([]);
    expect(result.duplicateIds).toEqual([]);
  });
});

describe("getSkill / getSkillRecommendedPages", () => {
  it("returns the skill record by id", () => {
    const skill = getSkill("image-specialist");
    expect(skill).not.toBeNull();
    expect(skill?.modality).toBe("image");
    expect(skill?.recommendedPages).toContain("/image-studio");
  });

  it("returns empty array for unknown skill id (cast to satisfy types)", () => {
    expect(getSkillRecommendedPages("not-a-real-skill" as never)).toEqual([]);
  });
});

describe("findSkillForTool", () => {
  it("maps known tools to the right specialist", () => {
    expect(findSkillForTool("studio.generateImage")?.id).toBe("image-specialist");
    expect(findSkillForTool("studio.generateVoice")?.id).toBe("voice-specialist");
    expect(findSkillForTool("studio.trainLora")?.id).toBe("training-specialist");
  });

  it("returns null for unknown tools", () => {
    expect(findSkillForTool("totally.fake.tool")).toBeNull();
  });
});

describe("findSkillForPage", () => {
  it("prefers specialists over generic skills for studio paths", () => {
    expect(findSkillForPage("/image-studio")?.id).toBe("image-specialist");
    expect(findSkillForPage("/video-studio")?.id).toBe("video-specialist");
    expect(findSkillForPage("/pro-studio")?.id).toBe("music-specialist");
    expect(findSkillForPage("/models")?.id).toBe("training-specialist");
  });

  it("falls through to a generic skill when no specialist owns the path", () => {
    const hit = findSkillForPage("/agent");
    expect(hit).not.toBeNull();
    // Director / navigator / companion / researcher all advertise /agent;
    // any of them is acceptable as long as it's a generic skill.
    expect(["director", "navigator", "companion", "researcher", "learning-specialist"])
      .toContain(hit?.id);
  });

  it("returns null for unknown paths", () => {
    expect(findSkillForPage("/this/does/not/exist")).toBeNull();
    expect(findSkillForPage(null)).toBeNull();
    expect(findSkillForPage(undefined)).toBeNull();
  });
});

describe("selectSkillForIntent — priority order", () => {
  it("recent tool wins over keywords", () => {
    const r = selectSkillForIntent({
      text: "幫我比較 SDXL 和 Flux 差別",
      recentTools: ["studio.generateImage"],
    });
    expect(r.source).toBe("tool");
    expect(r.skill.id).toBe("image-specialist");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("keywords route image requests to image-specialist", () => {
    // 避開 director 的「幫我做一張」keyword；用「畫」「圖片」兩個
    // image-specialist 專屬詞觸發。
    const r = selectSkillForIntent({ text: "畫一張賽博龐克風格的圖片" });
    expect(r.skill.id).toBe("image-specialist");
    expect(r.source).toBe("intent");
  });

  it("keywords route video requests to video-specialist", () => {
    // 避開 image-specialist 的「畫」「圖片」與 director 的「幫我做一支」；
    // 只用「視頻」「影片」兩個 video-specialist 專屬詞觸發。
    const r = selectSkillForIntent({ text: "做一段短視頻給我" });
    expect(r.skill.id).toBe("video-specialist");
  });

  it("on-page short imperative falls back to that page's specialist", () => {
    const r = selectSkillForIntent({
      text: "再來一張",
      currentPagePath: "/image-studio",
      snapshot: studioSnap("/image-studio"),
    });
    // Short imperative on /image-studio: either composer (existing rule)
    // or image-specialist (new page-fallback rule). Both are acceptable
    // — what matters is we don't fall through to companion.
    expect(["composer", "image-specialist"]).toContain(r.skill.id);
    expect(r.source).not.toBe("fallback");
  });

  it("empty text falls back to companion", () => {
    const r = selectSkillForIntent({ text: "" });
    expect(r.skill.id).toBe("companion");
  });
});

describe("composeSkillChain", () => {
  it("specialist heads use the skill's curated chain", () => {
    const chain = composeSkillChain({ text: "畫一張圖片" });
    expect(chain[0]).toBe("image-specialist");
    expect(chain).toContain("composer");
    expect(chain).toContain("critic");
  });

  it("director chain stays the same as composeRoleChain", () => {
    const chain = composeSkillChain({ text: "幫我規劃一個跨頁工作流" });
    expect(chain).toEqual(["director", "composer", "critic"]);
  });

  it("navigator stays single-role", () => {
    const chain = composeSkillChain({ text: "帶我去儀表板" });
    expect(chain).toEqual(["navigator"]);
  });

  it("learning specialist routes through navigator (no critic)", () => {
    // 避免「lora」這類 training-specialist 關鍵字；只用 learning-specialist
    // 專屬詞（新手 / 入門 / 教學）觸發。
    const chain = composeSkillChain({ text: "新手入門教學" });
    expect(chain[0]).toBe("learning-specialist");
    expect(chain).toContain("navigator");
    expect(chain).not.toContain("critic");
  });
});

describe("serializeSkillsForPrompt / buildSkillTurnPromptSlice", () => {
  it("serializeSkillsForPrompt covers every modality section", () => {
    const out = serializeSkillsForPrompt();
    expect(out).toMatch(/通用角色/);
    expect(out).toMatch(/圖像/);
    expect(out).toMatch(/影片/);
    expect(out).toMatch(/音樂/);
    expect(out).toMatch(/語音/);
    expect(out).toMatch(/模型訓練/);
    expect(out).toMatch(/學習/);
  });

  it("buildSkillTurnPromptSlice returns the selected skill plus its role slice", () => {
    const out = buildSkillTurnPromptSlice({ text: "畫一張圖片" });
    expect(out.skill.id).toBe("image-specialist");
    expect(out.slice).toMatch(/圖像精靈/);
    // The role-prompt slice for image-specialist mentions studio tools.
    expect(out.slice).toMatch(/studio\.generateImage/);
  });
});
