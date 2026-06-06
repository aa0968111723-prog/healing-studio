// ============================================================================
// tests/gate-state-machine.test.ts — 確認門狀態機單元測試（node env；純邏輯）
// ----------------------------------------------------------------------------
// 放置位置（套用時）：client/src/spine/__tests__/gate.test.ts（或任何 vitest 掃描得到處）。
// 覆蓋全部具名狀態：ready / partial(部分可生) / blocked、角色未確認 / 角色缺定裝 /
// 場景缺實景 / 解鎖 / 過期重生，以及 countGate 聚合與 isShotGeneratable。
// 本檔在準備階段已用 esbuild 實跑通過（19 assertions）。
// ============================================================================
import { describe, it, expect } from "vitest";
import {
  computeGate, countGate, isShotGeneratable, isCharacterProductionReady,
} from "@/spine/gate";
import type { Character, Scene, Shot } from "@/spine/types";

const C = (over: Partial<Character> = {}): Character => ({
  id: "c", name: "角色", emoji: "x", sourceGrade: "precise", locked: true,
  locks: { face: true, hair: true, costume: true, accessory: true }, loraStatus: "已完成", refImages: 1, ...over,
});
const S = (over: Partial<Shot> = {}): Shot => ({
  id: "s", no: "S01", act: 1, title: "t", route: "ref", characterIds: [], sceneId: null,
  seed: 1, approval: "pending", stale: false, gen: { status: "idle", variant: 0 }, ...over,
});

const mila = C({ id: "c_mila", name: "密勒日巴" });
const rech = C({ id: "c_rech", name: "惹瓊巴", sourceGrade: "estimate", locked: false, locks: { face: false, hair: false, costume: false, accessory: false } });
const god = C({ id: "c_god", name: "山神", sourceGrade: "unconfirmed", locked: false, locks: { face: false, hair: false, costume: false, accessory: false } });

describe("確認門 computeGate", () => {
  it("text 空景（無具名角色、無實景場景）→ ready", () => {
    expect(computeGate(S({ route: "text" }), [], []).state).toBe("ready");
  });

  it("ref + 角色精準定版 → ready", () => {
    expect(computeGate(S({ route: "ref", characterIds: ["c_mila"] }), [mila], []).state).toBe("ready");
  });

  it("ref + 角色未確認 → blocked，原因=character-unconfirmed，可解鎖", () => {
    const g = computeGate(S({ route: "ref", characterIds: ["c_god"] }), [god], []);
    expect(g.state).toBe("blocked");
    expect(g.reasons[0]?.kind).toBe("character-unconfirmed");
    expect(g.canUnlock).toBe(true);
  });

  it("ref + 一精準一估算 → partial（部分可生）", () => {
    const g = computeGate(S({ route: "ref", characterIds: ["c_mila", "c_rech"] }), [mila, rech], []);
    expect(g.state).toBe("partial");
  });

  it("角色缺定裝（precise+locked 但 costume 未鎖）→ 非 ready，原因=character-costume", () => {
    const noCostume = C({ id: "c_nc", locks: { face: true, hair: true, costume: false, accessory: true } });
    const g = computeGate(S({ route: "ref", characterIds: ["c_nc"] }), [noCostume], []);
    expect(g.state).not.toBe("ready");
    const r = g.reasons.find((x) => x.kind === "character-costume");
    expect(r?.label).toBe("角色缺定裝");
  });

  it("場景缺實景（named-place 未鎖）→ blocked，原因=scene-missing-location", () => {
    const scene: Scene = { id: "s_v", name: "村莊", kind: "named-place", locked: false };
    const g = computeGate(S({ route: "text", sceneId: "s_v" }), [], [scene]);
    expect(g.state).toBe("blocked");
    expect(g.reasons[0]?.kind).toBe("scene-missing-location");
  });

  it("解鎖：場景鎖定後 → ready", () => {
    const scene: Scene = { id: "s_v", name: "村莊", kind: "named-place", locked: true };
    expect(computeGate(S({ route: "text", sceneId: "s_v" }), [], [scene]).state).toBe("ready");
  });

  it("過期重生：stale 旗標傳遞", () => {
    const g = computeGate(S({ route: "ref", characterIds: ["c_mila"], stale: true, gen: { status: "done", variant: 0 } }), [mila], []);
    expect(g.staleRegen).toBe(true);
  });
});

describe("countGate 聚合", () => {
  it("ready / partial / blocked 各 1", () => {
    const shots = [
      S({ route: "text" }),
      S({ route: "ref", characterIds: ["c_god"] }),
      S({ route: "ref", characterIds: ["c_mila", "c_rech"] }),
    ];
    const cg = countGate(shots, [mila, rech, god], []);
    expect(cg.ready).toBe(1);
    expect(cg.blocked).toBe(1);
    expect(cg.partial).toBe(1);
    expect(cg.total).toBe(3);
  });
});

describe("輔助判定", () => {
  it("isShotGeneratable：ready 且未過期才可生", () => {
    expect(isShotGeneratable(S({ route: "text" }), [], [])).toBe(true);
    expect(isShotGeneratable(S({ route: "text", stale: true }), [], [])).toBe(false);
  });
  it("isCharacterProductionReady：精準+四鎖全開才算定版", () => {
    expect(isCharacterProductionReady(mila)).toBe(true);
    expect(isCharacterProductionReady(god)).toBe(false);
  });
});
