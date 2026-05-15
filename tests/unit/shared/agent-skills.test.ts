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
  it("contains all 25 known skills (6 generic + 9 specialists + 3 proactive + 7 new)", () => {
    expect(AGENT_SKILL_REGISTRY.length).toBe(25);
    const ids = new Set(AGENT_SKILL_REGISTRY.map(s => s.id));
    for (const id of [
      // 6 generic workflow
      "director",
      "composer",
      "critic",
      "researcher",
      "navigator",
      "companion",
      // 3 proactive
      "accountant",
      "quality-coach",
      "inspector",
      // 9 specialists（含新增的 community-manager / inspiration / anatomy）
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "training-specialist",
      "learning-specialist",
      "community-manager",
      "inspiration-specialist",
      "anatomy-specialist",
      // 7 new spirits（規劃 / 執行 / 法律 / 資安 / 總管 / 輔導 / 筆記 / 設定）
      "legal-advisor",
      "security-guard",
      "chief-orchestrator",
      "onboarding-coach",
      "notes-curator",
      "settings-detail",
      "plan-executor",
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

  it("maps cross-cutting advisory tools to the right generic skill", () => {
    // 之前 learning-specialist.primaryTools 把 director.suggestPlan 和
    // research.deepSearch 也包進去，造成 findSkillForTool 抓到錯的擁有者；
    // 現在這兩個 tool 由 director / researcher 認領。
    expect(findSkillForTool("director.suggestPlan")?.id).toBe("director");
    expect(findSkillForTool("research.deepSearch")?.id).toBe("researcher");
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

describe("regression — keyword conflicts surfaced by deep-audit", () => {
  it("voice cloning request routes to voice-specialist, not music-specialist", () => {
    // 「我要 voice cloning 我的聲音」之前因為 music-specialist 也含 「聲音」
    // 而誤路由；現已從 music-specialist 移除。
    const r = selectSkillForIntent({ text: "我要 voice cloning 我的聲音" });
    expect(r.skill.id).toBe("voice-specialist");
  });

  it("teaching intent on a domain topic routes to learning-specialist", () => {
    // 「教我怎麼開始做影片」之前因為 video-specialist 的「影片」搶先；
    // LEARNING_OVERRIDE_HINTS 現會優先處理「教我」「新手」這類教學訊號。
    const r = selectSkillForIntent({ text: "教我怎麼開始做影片" });
    expect(r.skill.id).toBe("learning-specialist");
  });

  it("but a director plan that happens to mention 教學 still routes to director", () => {
    // 反訊號：「幫我做一支教學影片，從規劃到輸出」是規劃語氣，必須給
    // director；不能被 LEARNING_OVERRIDE_HINTS 搶。
    const r = selectSkillForIntent({ text: "幫我做一支教學影片，從規劃到輸出" });
    expect(r.skill.id).toBe("director");
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
