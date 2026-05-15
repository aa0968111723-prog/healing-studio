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
  getSpiritFullProfile,
  searchCodex,
} from "../shared/agent-codex";
import { APP_PAGE_REGISTRY } from "../shared/appRegistry";
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
