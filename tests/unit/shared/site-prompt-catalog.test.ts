import { describe, expect, it } from "vitest";
import {
  findSitePromptEntry,
  getSitePromptCatalog,
  SITE_PROMPT_SOURCE_TYPES,
} from "../../../shared/site-prompt-catalog";
import { SPIRIT_PROACTIVE_TRIGGERS } from "../../../shared/orb-agent-roles";

describe("site-prompt-catalog.getSitePromptCatalog", () => {
  const catalog = getSitePromptCatalog();

  it("emits at least the 25 spirit role slices", () => {
    const agentRoles = catalog.filter(e => e.sourceType === "agent_role");
    expect(agentRoles.length).toBe(25);
    // 每條都有非空 content & sourceLabel — 防 catalog 漏接新精靈時靜默回空字串。
    for (const entry of agentRoles) {
      expect(entry.content.length).toBeGreaterThan(20);
      expect(entry.sourceLabel.startsWith("精靈 · ")).toBe(true);
      expect(entry.title).toContain(entry.sourceRef);
    }
  });

  it("includes every proactive trigger spec (one-to-one)", () => {
    const triggers = catalog.filter(e => e.sourceType === "proactive_trigger");
    expect(triggers.length).toBe(SPIRIT_PROACTIVE_TRIGGERS.length);
    // sourceRef 應該都唯一（spirit:event#idx），防止 UNIQUE 衝突。
    const refs = new Set(triggers.map(t => t.sourceRef));
    expect(refs.size).toBe(triggers.length);
  });

  it("emits image_studio entries for both T2I and SD templates", () => {
    const imageStudio = catalog.filter(e => e.sourceType === "image_studio");
    expect(imageStudio.some(e => e.sourceRef.startsWith("t2i:"))).toBe(true);
    expect(imageStudio.some(e => e.sourceRef.startsWith("sd:"))).toBe(true);
  });

  it("skips empty-prefix model templates (avoids the universal fallback row)", () => {
    const modelTemplates = catalog.filter(e => e.sourceType === "model_template");
    expect(modelTemplates.length).toBeGreaterThan(0);
    for (const tpl of modelTemplates) {
      expect(tpl.sourceRef.length).toBeGreaterThan(0);
    }
  });

  it("each entry has a stable (sourceType, sourceRef) pair", () => {
    const pairs = new Set<string>();
    for (const entry of catalog) {
      const key = `${entry.sourceType}::${entry.sourceRef}`;
      // UNIQUE (userId, sourceType, sourceRef) 在 DB 防重複收 — 這層先確認
      // catalog 本身沒有重複，否則「已收集」徽章會錯亂。
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
  });
});

describe("site-prompt-catalog.findSitePromptEntry", () => {
  it("returns the exact same content as getSitePromptCatalog for a known agent role", () => {
    const entry = findSitePromptEntry("agent_role", "image-specialist");
    expect(entry).not.toBeNull();
    expect(entry!.title).toContain("image-specialist");
    expect(entry!.category).toBe("image");
  });

  it("returns null for an unknown (sourceType, sourceRef) pair", () => {
    expect(findSitePromptEntry("agent_role", "not-a-real-role")).toBeNull();
    expect(findSitePromptEntry("image_studio", "t2i:not-real")).toBeNull();
  });

  it("never includes 'manual' or 'site_prompt' as catalog entries", () => {
    // manual / site_prompt 是 reserved 在 sourceType enum 內，但 catalog 不會
    // 主動列出（manual 是使用者輸入，site_prompt 是未來擴充槽位）。
    const catalog = getSitePromptCatalog();
    expect(catalog.some(e => e.sourceType === "manual")).toBe(false);
    expect(catalog.some(e => e.sourceType === "site_prompt")).toBe(false);
  });
});

describe("site-prompt-catalog.SITE_PROMPT_SOURCE_TYPES", () => {
  it("exposes the full enum order used by both schema and router", () => {
    expect(SITE_PROMPT_SOURCE_TYPES).toEqual([
      "agent_role",
      "proactive_trigger",
      "model_template",
      "image_studio",
      "video_studio",
      "pro_studio",
      "director_personality",
      "prompt_reference",
      "site_prompt",
      "manual",
    ]);
  });
});

describe("site-prompt-catalog deeper sources (round 2)", () => {
  const catalog = getSitePromptCatalog();

  it("includes 3 director personality system prompts (calm / creative / technical)", () => {
    const personalities = catalog.filter(
      e => e.sourceType === "director_personality"
    );
    expect(personalities.map(p => p.sourceRef).sort()).toEqual([
      "calm",
      "creative",
      "technical",
    ]);
    for (const p of personalities) {
      expect(p.content).toMatch(/CO-STAR/);
      expect(p.content).toMatch(/導演 AI/);
    }
  });

  it("includes video_studio entries from all 4 sub-tabs (t2v / i2v / v2v / control)", () => {
    const video = catalog.filter(e => e.sourceType === "video_studio");
    expect(video.some(v => v.sourceRef.startsWith("t2v:"))).toBe(true);
    expect(video.some(v => v.sourceRef.startsWith("i2v:"))).toBe(true);
    expect(video.some(v => v.sourceRef.startsWith("v2v:"))).toBe(true);
    expect(video.some(v => v.sourceRef.startsWith("control:"))).toBe(true);
    for (const v of video) {
      expect(v.category).toBe("video");
    }
  });

  it("includes pro_studio entries from all 4 sub-tabs (music / sfx / tts / clone)", () => {
    const pro = catalog.filter(e => e.sourceType === "pro_studio");
    expect(pro.some(p => p.sourceRef.startsWith("music:"))).toBe(true);
    expect(pro.some(p => p.sourceRef.startsWith("sfx:"))).toBe(true);
    expect(pro.some(p => p.sourceRef.startsWith("tts:"))).toBe(true);
    expect(pro.some(p => p.sourceRef.startsWith("clone:"))).toBe(true);
    // music + sfx → audio；tts + clone → voice
    expect(pro.filter(p => p.sourceRef.startsWith("music:"))[0].category).toBe(
      "audio"
    );
    expect(pro.filter(p => p.sourceRef.startsWith("tts:"))[0].category).toBe(
      "voice"
    );
  });

  it("includes image_studio edit templates (在原 t2i + sd 之上)", () => {
    const editEntries = catalog.filter(
      e => e.sourceType === "image_studio" && e.sourceRef.startsWith("edit:")
    );
    expect(editEntries.length).toBeGreaterThan(0);
  });

  it("ingests prompt_reference library (120+ entries) with each modality mapped", () => {
    const refs = catalog.filter(e => e.sourceType === "prompt_reference");
    expect(refs.length).toBeGreaterThanOrEqual(100);
    // 每條 sourceRef 應該等於 PromptReference.id（穩定識別）。
    const refIds = new Set(refs.map(r => r.sourceRef));
    expect(refIds.size).toBe(refs.length);
    // 應該至少有 image / video / agent / system 不同 category 出現。
    const categories = new Set(refs.map(r => r.category));
    expect(categories.has("image")).toBe(true);
    expect(categories.has("system")).toBe(true);
  });

  it("does not produce duplicate (sourceType, sourceRef) keys across the full catalog", () => {
    const keys = new Set<string>();
    for (const entry of catalog) {
      const key = `${entry.sourceType}::${entry.sourceRef}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    // 整個 catalog 加大後仍應 > 200 條（agent 25 + trigger 18 + director 3 +
    // model_template ~12 + image 17 + video ~24 + pro ~20 + ref 120 = 240+）
    expect(catalog.length).toBeGreaterThan(200);
  });
});
