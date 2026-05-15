/**
 * shared/agent-codex 的 vitest — 「無遺漏」承諾的執行保證。
 *
 * 重點在 auditCodexCoverage()：把 SLASH_COMMANDS、SPIRIT_COMMANDS、
 * APP_PAGE_REGISTRY、SPIRIT_COLLAB_PROTOCOL、SPIRIT_PROACTIVE_TRIGGERS
 * 的每一條都比對是否進了大全；如果有任何遺漏，這支 test 會列出來。
 */

import { describe, expect, it } from "vitest";

import {
  CODEX_CATEGORY_LABELS,
  CODEX_CATEGORY_ORDER,
  _resetCodexCacheForTest,
  auditCodexCoverage,
  buildCodexMarkdown,
  categoryForSlashGroup,
  getAllCodexEntries,
  getCodexByCategory,
  getCodexEntry,
  getCodexStats,
  getEntriesByPage,
  getEntriesBySpirit,
  getRelatedEntries,
  getSpiritFullProfile,
  pickFeatureOfTheDay,
  searchCodex,
  searchCodexDetailed,
} from "../shared/agent-codex";
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";
import { AGENT_SKILL_REGISTRY } from "../shared/agent-skills";
import { WORKFLOW_TEMPLATES } from "../shared/cross-modality-workflows";
import { GLOBAL_AGENT_TOOL_REGISTRY } from "../shared/global-agent-tools";
import {
  SPIRIT_COLLAB_PROTOCOL,
  SPIRIT_PROACTIVE_TRIGGERS,
} from "../shared/orb-agent-roles";
import { SLASH_COMMANDS, SPIRIT_COMMANDS } from "../shared/slash-commands";

describe("shared/agent-codex 覆蓋率審計", () => {
  it("auditCodexCoverage 沒有任何遺漏", () => {
    _resetCodexCacheForTest();
    const gaps = auditCodexCoverage();
    if (gaps.length > 0) {
      // 把缺項條列印出來，方便 fix 而不只是看到 length > 0。
      const lines = gaps.map(g => `[${g.source}] ${g.id}: ${g.reason}`);
      throw new Error(`大全有 ${gaps.length} 項遺漏：\n${lines.join("\n")}`);
    }
    expect(gaps).toEqual([]);
  });

  it("每個 SLASH_COMMANDS 條目都進了大全", () => {
    const all = getAllCodexEntries();
    const slashNames = new Set(all.map(e => e.refs.slashCommand).filter(Boolean));
    for (const cmd of SLASH_COMMANDS) {
      expect(slashNames.has(cmd.name)).toBe(true);
    }
  });

  it("25 位精靈全部有 spirit 條目", () => {
    const spiritEntries = getCodexByCategory("spirit");
    expect(spiritEntries.length).toBe(SPIRIT_COMMANDS.length);
    expect(spiritEntries.length).toBe(25);
    for (const spirit of SPIRIT_COMMANDS) {
      const match = spiritEntries.find(e => e.refs.spirit === spirit.spiritId);
      expect(match, `精靈 ${spirit.nickname}(${spirit.spiritId}) 缺項`).toBeDefined();
    }
  });

  it("36 頁面全部有 page 條目", () => {
    const pageEntries = getCodexByCategory("page");
    expect(pageEntries.length).toBe(APP_PAGE_REGISTRY.length);
    for (const page of APP_PAGE_REGISTRY) {
      const match = pageEntries.find(e => e.refs.pagePath === page.path);
      expect(match, `頁面 ${page.label}(${page.path}) 缺項`).toBeDefined();
    }
  });

  it("接棒網絡的條目數＝SPIRIT_COLLAB_PROTOCOL.handoffs 總數", () => {
    const handoffEntries = getCodexByCategory("handoff");
    const expected = Object.values(SPIRIT_COLLAB_PROTOCOL).reduce(
      (sum, spec) => sum + spec.handoffs.length,
      0
    );
    expect(handoffEntries.length).toBe(expected);
  });

  it("主動觸發條目數＝SPIRIT_PROACTIVE_TRIGGERS.length", () => {
    const triggerEntries = getCodexByCategory("trigger");
    expect(triggerEntries.length).toBe(SPIRIT_PROACTIVE_TRIGGERS.length);
  });

  it("精靈家族條目數＝3", () => {
    const families = getCodexByCategory("spirit-family");
    expect(families.length).toBe(3);
    expect(families.map(f => f.refs.family).sort()).toEqual([
      "proactive",
      "role",
      "specialist",
    ]);
  });

  it("每個分類都有對應的中文標籤", () => {
    for (const cat of CODEX_CATEGORY_ORDER) {
      expect(CODEX_CATEGORY_LABELS[cat]).toBeTruthy();
    }
  });

  it("條目 id 全域唯一", () => {
    const ids = getAllCodexEntries().map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("searchCodex", () => {
  it("空字串回傳所有條目", () => {
    const all = getAllCodexEntries();
    const result = searchCodex("", 9999);
    expect(result.length).toBe(all.length);
  });

  it("關鍵字「影片」能找到影影 / VideoStudio 相關條目", () => {
    const result = searchCodex("影片");
    expect(result.length).toBeGreaterThan(0);
    // 影影精靈一定要在結果裡（暱稱出現在 title）
    const hasVideoSpirit = result.some(e => e.refs.spirit === "video-specialist");
    expect(hasVideoSpirit).toBe(true);
  });

  it("關鍵字「預算」能找到財財相關條目", () => {
    const result = searchCodex("預算");
    expect(result.some(e => e.refs.spirit === "accountant")).toBe(true);
  });

  it("關鍵字「auto」能找到 /auto 模式", () => {
    const result = searchCodex("auto");
    expect(result.some(e => e.refs.slashCommand === "/auto")).toBe(true);
  });

  it("title 命中分數高於 alias 命中", () => {
    // 「導導」這個 title 命中的條目應該排在「director」alias 命中前
    const result = searchCodex("導導");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.title).toContain("導導");
  });

  it("多 token 需要全部命中", () => {
    // 「光球 不存在的字 」應該無結果
    const result = searchCodex("光球 zzzzzzzzz");
    expect(result.length).toBe(0);
  });

  it("limit 參數受尊重", () => {
    const result = searchCodex("", 5);
    expect(result.length).toBe(5);
  });
});

describe("getCodexEntry / getSpiritFullProfile", () => {
  it("exact id 能拿到條目", () => {
    const all = getAllCodexEntries();
    const first = all[0]!;
    expect(getCodexEntry(first.id)?.id).toBe(first.id);
  });

  it("不存在的 id 回 null", () => {
    expect(getCodexEntry("nope")).toBeNull();
  });

  it("getSpiritFullProfile('director') 回傳精靈 + 接棒 + 觸發", () => {
    const profile = getSpiritFullProfile("director");
    expect(profile.spirit).not.toBeNull();
    expect(profile.spirit?.refs.spirit).toBe("director");
    // 導導 handoffs 在 SPIRIT_COLLAB_PROTOCOL 裡 >= 10 個
    expect(profile.handoffsOut.length).toBeGreaterThan(5);
  });

  it("getSpiritFullProfile('accountant') 至少 1 個主動觸發", () => {
    const profile = getSpiritFullProfile("accountant");
    expect(profile.triggers.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getCodexStats", () => {
  it("回 25 位精靈活動統計", () => {
    const stats = getCodexStats();
    expect(stats.spiritActivity.length).toBe(25);
    expect(stats.total).toBeGreaterThan(50);
  });

  it("byCategory 加總＝total", () => {
    const stats = getCodexStats();
    const sum = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
    expect(sum).toBe(stats.total);
  });
});

describe("buildCodexMarkdown", () => {
  it("匯出包含標題與所有分類段落", () => {
    const md = buildCodexMarkdown();
    expect(md).toContain("# 光球 AI 代理代碼大全");
    expect(md).toContain("## 代理模式");
    expect(md).toContain("## 精靈個人檔");
    expect(md).toContain("## 站內頁面");
  });

  it("可只匯出某些分類", () => {
    const md = buildCodexMarkdown({ categories: ["mode"] });
    expect(md).toContain("代理模式");
    expect(md).not.toContain("## 站內頁面");
  });

  it("自訂 entries 會覆蓋 categories", () => {
    const all = getAllCodexEntries();
    const subset = all.slice(0, 2);
    const md = buildCodexMarkdown({ entries: subset });
    expect(md).toContain(`共 2 條目`);
  });
});

describe("categoryForSlashGroup 對映", () => {
  it("mode → mode", () => {
    expect(categoryForSlashGroup("mode")).toBe("mode");
  });
  it("spirit → spirit", () => {
    expect(categoryForSlashGroup("spirit")).toBe("spirit");
  });
  it("help → help", () => {
    expect(categoryForSlashGroup("help")).toBe("help");
  });
});

// ─── 深度優化新增覆蓋 ────────────────────────────────────────────────────

describe("深度優化：新增分類條目", () => {
  it("workflow 條目數＝WORKFLOW_TEMPLATES 數", () => {
    const workflows = getCodexByCategory("workflow");
    expect(workflows.length).toBe(Object.keys(WORKFLOW_TEMPLATES).length);
    expect(workflows.length).toBeGreaterThanOrEqual(6);
  });

  it("skill 條目數＝AGENT_SKILL_REGISTRY 數", () => {
    const skills = getCodexByCategory("skill");
    expect(skills.length).toBe(AGENT_SKILL_REGISTRY.length);
  });

  it("tool 條目數＝GLOBAL_AGENT_TOOL_REGISTRY 數", () => {
    const tools = getCodexByCategory("tool");
    expect(tools.length).toBe(GLOBAL_AGENT_TOOL_REGISTRY.length);
    expect(tools.length).toBeGreaterThan(100);
  });

  it("quick-action 條目數＝APP_PAGE_REGISTRY 中所有 quickActions 加總", () => {
    const qa = getCodexByCategory("quick-action");
    const expected = APP_PAGE_REGISTRY.reduce(
      (sum, p) => sum + p.quickActions.length,
      0
    );
    expect(qa.length).toBe(expected);
  });

  it("整本大全條目數 ≥ 400（深度版的下限）", () => {
    expect(getAllCodexEntries().length).toBeGreaterThanOrEqual(400);
  });
});

describe("深度優化：related 跨條目連結", () => {
  it("精靈 director 的 related 至少包含一條 handoff 與 skill", () => {
    const entry = getCodexEntry("spirit#director");
    expect(entry).not.toBeNull();
    const hasHandoff = entry!.related.some(id => id.startsWith("handoff#director->"));
    const hasSkill = entry!.related.some(id => id === "skill#director");
    expect(hasHandoff).toBe(true);
    expect(hasSkill).toBe(true);
  });

  it("handoff director->image-specialist 雙向連結到兩個精靈", () => {
    const entry = getCodexEntry("handoff#director->image-specialist");
    expect(entry).not.toBeNull();
    expect(entry!.related).toContain("spirit#director");
    expect(entry!.related).toContain("spirit#image-specialist");
  });

  it("workflow 條目 related 含步驟中所有精靈", () => {
    const wf = getCodexByCategory("workflow")[0]!;
    expect(wf.related.some(id => id.startsWith("spirit#"))).toBe(true);
  });

  it("page 條目 related 包含它的 quickActions", () => {
    // home page 至少有 1 個 quickAction（explore-home）
    const homeEntry = getCodexEntry("page#home");
    expect(homeEntry).not.toBeNull();
    expect(homeEntry!.related.some(id => id.startsWith("qa#"))).toBe(true);
  });

  it("trigger 條目 related 至少包含對應精靈", () => {
    const trigger = getCodexByCategory("trigger")[0]!;
    expect(trigger.related.some(id => id.startsWith("spirit#"))).toBe(true);
  });

  it("entry.related 不會包含自己", () => {
    for (const entry of getAllCodexEntries()) {
      expect(entry.related, `${entry.id} related 不該包含自己`).not.toContain(entry.id);
    }
  });

  it("entry.related 全部都對應到真實 entry", () => {
    const allIds = new Set(getAllCodexEntries().map(e => e.id));
    for (const entry of getAllCodexEntries()) {
      for (const rel of entry.related) {
        expect(allIds.has(rel), `${entry.id} 的 related ${rel} 不存在`).toBe(true);
      }
    }
  });
});

describe("深度優化：同義詞展開搜尋", () => {
  it("「video」能命中影影精靈（synonym expand 到 video → 影片 / 影像）", () => {
    const hits = searchCodex("video");
    expect(hits.some(e => e.refs.spirit === "video-specialist")).toBe(true);
  });

  it("「影片」也能命中 video-related 工作流（synonym 雙向）", () => {
    const hits = searchCodex("影片");
    expect(hits.some(e => e.category === "workflow")).toBe(true);
  });

  it("「budget」能透過同義詞展開命中財財（budget → 預算）", () => {
    const hits = searchCodex("budget");
    expect(hits.some(e => e.refs.spirit === "accountant")).toBe(true);
  });

  it("「codex」命中大全本身的入口指令", () => {
    const hits = searchCodex("codex");
    expect(hits.some(e => e.refs.slashCommand === "/codex")).toBe(true);
  });
});

describe("深度優化：searchCodexDetailed 命中欄位", () => {
  it("回傳 score + matchedFields 結構", () => {
    const hits = searchCodexDetailed("director", 5);
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0]!;
    expect(typeof first.score).toBe("number");
    expect(Array.isArray(first.matchedFields)).toBe(true);
    expect(first.matchedFields.length).toBeGreaterThan(0);
  });

  it("title 命中得分大於僅 details 命中", () => {
    // 「導導」幾乎只會出現在 title／alias，不在 details
    const titleHits = searchCodexDetailed("導導", 3);
    expect(titleHits.length).toBeGreaterThan(0);
    expect(titleHits[0]!.matchedFields).toContain("title");
  });
});

describe("深度優化：新增查詢 API", () => {
  it("getRelatedEntries('spirit#director') 至少回幾條 handoff", () => {
    const related = getRelatedEntries("spirit#director", 30);
    expect(related.length).toBeGreaterThan(5);
    expect(related.some(e => e.category === "handoff")).toBe(true);
  });

  it("getRelatedEntries 不存在的 id → 空陣列", () => {
    expect(getRelatedEntries("not-an-id")).toEqual([]);
  });

  it("getEntriesBySpirit('director') 同時涵蓋 spirit / handoff / skill", () => {
    const entries = getEntriesBySpirit("director");
    expect(entries.some(e => e.category === "spirit")).toBe(true);
    expect(entries.some(e => e.category === "handoff")).toBe(true);
    expect(entries.some(e => e.category === "skill")).toBe(true);
  });

  it("getEntriesByPage('/image-studio') 至少回頁面本身 + 一些 quickActions", () => {
    const entries = getEntriesByPage("/image-studio");
    expect(entries.some(e => e.category === "page")).toBe(true);
    expect(entries.some(e => e.category === "quick-action")).toBe(true);
  });

  it("pickFeatureOfTheDay(seed) 對同一 seed 返回相同條目", () => {
    const a = pickFeatureOfTheDay(123);
    const b = pickFeatureOfTheDay(123);
    expect(a?.id).toBe(b?.id);
  });

  it("pickFeatureOfTheDay() 無 seed 也能回非 null", () => {
    expect(pickFeatureOfTheDay()).not.toBeNull();
  });

  it("getSpiritFullProfile 現在包含 skill 與 recommendedPages", () => {
    const profile = getSpiritFullProfile("director");
    expect(profile.skill).not.toBeNull();
    expect(Array.isArray(profile.recommendedPages)).toBe(true);
  });
});

describe("深度優化：審計覆蓋率新來源", () => {
  it("auditCodexCoverage 涵蓋 workflow / skill / tool / quickAction，無遺漏", () => {
    _resetCodexCacheForTest();
    const gaps = auditCodexCoverage();
    if (gaps.length > 0) {
      const lines = gaps.map(g => `[${g.source}] ${g.id}: ${g.reason}`);
      throw new Error(`大全有 ${gaps.length} 項遺漏：\n${lines.slice(0, 20).join("\n")}`);
    }
    expect(gaps).toEqual([]);
  });
});
