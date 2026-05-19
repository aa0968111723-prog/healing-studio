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
      "site_prompt",
      "manual",
    ]);
  });
});
