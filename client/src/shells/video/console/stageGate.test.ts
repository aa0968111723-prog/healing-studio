/**
 * stageGate.ts（S2 非線性跳階補齊驗證 · AIDV-95 / U-5）純函式窮盡測試。
 * 守住四條規格驗證（無分鏡 / 無就緒鏡 / 無已生成 / 無已核准）＋入口畫布永遠可進 ＋ ⚠N 計數。
 * 純函式、零 DOM，不需 jsdom。
 */
import { describe, it, expect } from "vitest";
import { stageGaps, stageWarnCount, needsStageWizard } from "./stageGate";
import type { Character, Scene, Shot, CreativeProject } from "@/spine/types";

// ── 工廠 ──────────────────────────────────────────────────────────────────
function char(over: Partial<Character> = {}): Character {
  return {
    id: "c1", name: "密勒日巴", emoji: "🧘", sourceGrade: "precise", locked: true,
    locks: { face: true, hair: true, costume: true, accessory: true },
    loraStatus: "已完成", refImages: 3, ...over,
  };
}
function unreadyChar(over: Partial<Character> = {}): Character {
  return char({ id: "c2", name: "惹瓊巴", sourceGrade: "estimate", locked: false,
    locks: { face: false, hair: false, costume: false, accessory: false }, loraStatus: "未訓練", refImages: 0, ...over });
}
function scene(over: Partial<Scene> = {}): Scene {
  return { id: "sc1", name: "雪山道", kind: "exterior", locked: true, ...over };
}
function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: "s1", no: "S01", act: 1, title: "晨光", route: "text", characterIds: [], sceneId: null,
    seed: 1, approval: "pending", stale: false, gen: { status: "idle", variant: 0 }, ...over,
  };
}
function project(over: Partial<CreativeProject> = {}): CreativeProject {
  return {
    id: "p1", name: "禪修短片", emoji: "🎬", type: "影片", logline: "", styleBible: "", stageIndex: 2,
    characters: [], scenes: [], shots: [], notes: [], assets: [], promptBlocks: [],
    packet: { summaryMarkdown: "", sourceRefs: [], tokenEstimate: 0, ttlSec: 0, permissions: "" },
    updatedAt: 0, ...over,
  };
}

// ── 入口/輔助畫布：永遠可進 ─────────────────────────────────────────────────
describe("stageGaps — 入口/輔助畫布永遠無前置", () => {
  for (const mode of ["chat", "script", "voice", "music"] as const) {
    it(`「${mode}」即使空專案也回 []`, () => {
      expect(stageGaps(project(), mode)).toEqual([]);
    });
  }
  it("null 專案一律回 []（防呆）", () => {
    expect(stageGaps(null, "asset")).toEqual([]);
    expect(stageGaps(undefined, "complete")).toEqual([]);
    expect(stageWarnCount(null, "asset")).toBe(0);
  });
});

// ── shot（分鏡確認）：需先有分鏡 ───────────────────────────────────────────
describe("stageGaps — 分鏡確認（shot）", () => {
  it("無分鏡 → no-script，回頭引導指向 script", () => {
    const g = stageGaps(project({ shots: [] }), "shot");
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("no-script");
    expect(g[0].backTo).toBe("script");
  });
  it("有分鏡 → 無缺料", () => {
    expect(stageGaps(project({ shots: [shot()] }), "shot")).toEqual([]);
  });
});

// ── asset（多模態生成）：需有分鏡 + 至少一就緒鏡 ────────────────────────────
describe("stageGaps — 多模態生成（asset）", () => {
  it("無分鏡 → no-script", () => {
    const g = stageGaps(project({ shots: [] }), "asset");
    expect(g[0].kind).toBe("no-script");
    expect(g[0].backTo).toBe("script");
  });

  it("有分鏡且至少一鏡就緒（text 路徑空景）→ 無缺料", () => {
    const g = stageGaps(project({ shots: [shot({ route: "text" })] }), "asset");
    expect(g).toEqual([]);
  });

  it("有分鏡但全部不就緒（ref 引未定版角色）→ no-ready-shot + 列待補角色，回頭引導指向 shot", () => {
    const c = unreadyChar();
    const g = stageGaps(project({
      characters: [c],
      shots: [shot({ id: "s1", route: "ref", characterIds: ["c2"] })],
    }), "asset");
    expect(g).toHaveLength(1);
    expect(g[0].kind).toBe("no-ready-shot");
    expect(g[0].backTo).toBe("shot");
    expect(g[0].refs).toEqual([{ id: "c2", name: "惹瓊巴" }]);
  });

  it("待補角色跨多鏡去重（同角色只列一次）", () => {
    const c = unreadyChar();
    const g = stageGaps(project({
      characters: [c],
      shots: [
        shot({ id: "s1", route: "ref", characterIds: ["c2"] }),
        shot({ id: "s2", no: "S02", route: "ref", characterIds: ["c2"] }),
      ],
    }), "asset");
    expect(g[0].refs).toHaveLength(1);
  });

  it("部分鏡就緒（混 text 與 ref-未定版）→ 視為可生成，無缺料", () => {
    const c = unreadyChar();
    const g = stageGaps(project({
      characters: [c],
      shots: [
        shot({ id: "s1", route: "text" }), // 就緒
        shot({ id: "s2", no: "S02", route: "ref", characterIds: ["c2"] }), // 不就緒
      ],
    }), "asset");
    expect(g).toEqual([]);
  });
});

// ── rough-cut（打包初剪）：需至少一已生成素材 ──────────────────────────────
describe("stageGaps — 打包初剪（rough-cut）", () => {
  it("無任何已生成 → no-generated，回頭引導指向 asset", () => {
    const g = stageGaps(project({ shots: [shot({ gen: { status: "idle", variant: 0 } })] }), "rough-cut");
    expect(g[0].kind).toBe("no-generated");
    expect(g[0].backTo).toBe("asset");
  });
  it("至少一鏡 gen.status=done → 無缺料", () => {
    const g = stageGaps(project({ shots: [shot({ gen: { status: "done", variant: 0, assetUrl: "/a.mp4" } })] }), "rough-cut");
    expect(g).toEqual([]);
  });
});

// ── complete（成片交付）：需至少一已核准 ───────────────────────────────────
describe("stageGaps — 成片交付（complete）", () => {
  it("無任何已核准 → no-approved，回頭引導指向 shot", () => {
    const g = stageGaps(project({ shots: [shot({ approval: "pending" })] }), "complete");
    expect(g[0].kind).toBe("no-approved");
    expect(g[0].backTo).toBe("shot");
  });
  it("至少一鏡 approval=approved → 無缺料", () => {
    const g = stageGaps(project({ shots: [shot({ approval: "approved" })] }), "complete");
    expect(g).toEqual([]);
  });
});

// ── ⚠N 計數 + needsStageWizard ────────────────────────────────────────────
describe("stageWarnCount / needsStageWizard", () => {
  it("單一缺料計 1 項", () => {
    expect(stageWarnCount(project({ shots: [] }), "shot")).toBe(1);
  });
  it("no-ready-shot 以待補角色數計（2 角色 → 2 項）", () => {
    const g = stageWarnCount(project({
      characters: [unreadyChar({ id: "c2", name: "惹瓊巴" }), unreadyChar({ id: "c3", name: "山神" })],
      shots: [shot({ route: "ref", characterIds: ["c2", "c3"] })],
    }), "asset");
    expect(g).toBe(2);
  });
  it("前置齊備 → 0 項、不需精靈", () => {
    const p = project({ shots: [shot({ route: "text" })] });
    expect(stageWarnCount(p, "asset")).toBe(0);
    expect(needsStageWizard(p, "asset")).toBe(false);
  });
  it("缺料 → 需精靈", () => {
    expect(needsStageWizard(project({ shots: [] }), "complete")).toBe(true);
  });
});
