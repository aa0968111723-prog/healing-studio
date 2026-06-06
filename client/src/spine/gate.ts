// ============================================================================
// spine/gate.ts — 確認門（GATE）狀態機（P2 旗艦的鐵則引擎）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬 lib/util.ts 的 computeGate / countGate，**升級為完整狀態機**：
//   模擬版只看角色（precise+locked）。本版是其嚴格超集，額外納入：
//     • 角色缺定裝（locked 但裝/臉/髮/配飾未鎖全 → 來源未達 precise）
//     • 場景缺實景（ref 鏡引用 named-place 場景但場景未鎖定）
//     • 部分可生（部分角色就緒、部分待補）
//     • 解鎖（上傳參考照 → grade=precise+鎖全 → 重算為 ready 的轉移；以 canUnlock 表示）
//     • 過期重生（角色改設定後 shot.stale=true）
//
// 純函式、無副作用、type-only 依賴 → 可單元測試、可在元件外呼叫（脊椎 action 也用它判生成資格）。
// 對映 healing-studio：consistency_vault（角色定版/鎖臉）、worldbuilding_frameworks（場景）、
//                      world_storyboards（鏡 stale 級聯）。
// ============================================================================
import type { Character, Scene, Shot, GateState, SourceGrade } from "@/spine/types";

/** 阻擋/待補原因的具名種類（驅動 UI 顯示哪一種「缺」）。 */
export type GateReasonKind =
  | "character-unconfirmed" // 角色未確認（來源 unconfirmed，連估算都不到）
  | "character-estimate"    // 角色僅估算（未上傳參考、未定版）
  | "character-costume"     // 角色缺定裝（已定版但臉/髮/裝/配飾未鎖全）
  | "scene-missing-location"; // 場景缺實景（named-place 場景未鎖定）

export interface GateReason {
  kind: GateReasonKind;
  /** 中文短標（給徽章/列表）。 */
  label: string;
  /** 受影響的角色或場景 id（供「上傳參考照 / 鎖定場景」動作定位）。 */
  refId: string;
  refName: string;
  /** 此原因是否可由「上傳參考照」單鍵解鎖（角色類 = true；場景類 = 需鎖定場景）。 */
  unlockable: boolean;
}

export interface GateResult {
  /** 三態總結：ready 可量產 / partial 部分待補 / blocked 全待補。 */
  state: GateState;
  /** 具名待補原因清單（ready 時為空）。 */
  reasons: GateReason[];
  /** 角色改設定後既有成圖過期 → 需同 seed 重生。 */
  staleRegen: boolean;
  /** 是否存在「上傳參考照即可解鎖」的角色待補（給確認門主動作）。 */
  canUnlock: boolean;
}

export const GRADE_LABEL: Record<SourceGrade, string> = {
  precise: "✅ 精準",
  estimate: "⚠ 估算",
  unconfirmed: "⚠ 未確認",
};

/** 三態中文標（徽章用）。 */
export const GATE_STATE_LABEL: Record<GateState, string> = {
  ready: "可量產",
  partial: "部分待補",
  blocked: "全待補",
};

/** 一個角色是否「定版到可量產」：來源精準且四鎖全開。 */
export function isCharacterProductionReady(c: Character): boolean {
  return c.sourceGrade === "precise" && c.locked && c.locks.face && c.locks.hair && c.locks.costume && c.locks.accessory;
}

function characterReason(c: Character): GateReason | null {
  if (isCharacterProductionReady(c)) return null;
  if (c.sourceGrade === "unconfirmed") {
    return { kind: "character-unconfirmed", label: "角色未確認", refId: c.id, refName: c.name, unlockable: true };
  }
  // 已 precise/已定版，但鎖未開全 → 缺定裝（臉/髮/裝/配飾其一未鎖）
  if (c.sourceGrade === "precise" || c.locked) {
    return { kind: "character-costume", label: "角色缺定裝", refId: c.id, refName: c.name, unlockable: true };
  }
  return { kind: "character-estimate", label: "角色僅估算", refId: c.id, refName: c.name, unlockable: true };
}

function sceneReason(scene: Scene | undefined): GateReason | null {
  if (!scene) return null;
  // 具名實景（named-place）必須鎖定才算「實景到位」；exterior/interior 空景不擋。
  if (scene.kind === "named-place" && !scene.locked) {
    return { kind: "scene-missing-location", label: "場景缺實景", refId: scene.id, refName: scene.name, unlockable: false };
  }
  return null;
}

/**
 * 確認門核心：一個鏡頭能否量產。
 *   - text 路徑（純空景、無具名角色）只受「場景缺實景」約束（named-place 場景仍需鎖）。
 *   - ref 路徑：逐一檢查引用角色是否定版 + 引用場景是否實景到位。
 */
export function computeGate(shot: Shot, characters: Character[], scenes: Scene[] = []): GateResult {
  const reasons: GateReason[] = [];
  const staleRegen = shot.stale === true;

  const scene = shot.sceneId ? scenes.find((s) => s.id === shot.sceneId) : undefined;
  const sr = sceneReason(scene);

  // 解析引用角色（過濾掉找不到的 id）。
  const refs = shot.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter(Boolean) as Character[];

  // text 路徑或無具名角色：只看場景。
  if (shot.route === "text" || refs.length === 0) {
    if (sr) reasons.push(sr);
    const state: GateState = reasons.length === 0 ? "ready" : "blocked";
    return { state, reasons, staleRegen, canUnlock: false };
  }

  // ref 路徑：逐角色判定。
  let okCount = 0;
  for (const c of refs) {
    const r = characterReason(c);
    if (r) reasons.push(r);
    else okCount++;
  }
  if (sr) reasons.push(sr);

  const canUnlock = reasons.some((r) => r.unlockable);

  // 三態：全部角色就緒且場景到位 → ready；完全沒有就緒角色 → blocked；其餘 → partial。
  let state: GateState;
  if (reasons.length === 0) state = "ready";
  else if (okCount === 0) state = "blocked";
  else state = "partial";

  return { state, reasons, staleRegen, canUnlock };
}

/** 聚合整個專案的確認門計數（階段條/確認門卡用）。 */
export function countGate(shots: Shot[], characters: Character[], scenes: Scene[] = []) {
  let ready = 0, partial = 0, blocked = 0, stale = 0;
  for (const s of shots) {
    const g = computeGate(s, characters, scenes);
    if (g.state === "ready") ready++;
    else if (g.state === "partial") partial++;
    else blocked++;
    if (g.staleRegen) stale++;
  }
  return { ready, partial, blocked, stale, total: shots.length };
}

/** 一個鏡頭是否「就緒可送生成」：ready 且未過期（過期需先重生而非新生）。 */
export function isShotGeneratable(shot: Shot, characters: Character[], scenes: Scene[] = []): boolean {
  const g = computeGate(shot, characters, scenes);
  return g.state === "ready" && !g.staleRegen;
}
