/**
 * resourceAccess.ts — 資料層 RBAC 統一授權中樞（AIDV-121 基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 把「誰能 view / edit / delete 哪個資源」的判斷收斂成一個**純函式**
 * `canAccess()`，以及一組「把 DB 事實（團隊成員、顯式共享）餵進純函式」的
 * resolver。仿 server/services/teachingArchiveAccess.ts 的集中式授權矩陣，
 * 但泛化到 project / asset / prompt / material 四類資源。
 *
 * ── 角色與可見性模型 ─────────────────────────────────────────────────────
 *   資源層角色（對「單一資源」而言，與全站系統角色 admin/leader 正交）：
 *     • owner   — resource.userId === user.id。view/edit/delete/share/transfer 全可。
 *     • editor  — 經顯式共享（resource_shares.role='editor'）或 team_shared 池
 *                 成員。可 view + edit；不可 delete、不可 share、不可 transfer。
 *     • viewer  — 經顯式共享（role='viewer'）。只能 view。
 *     • none    — 以上皆非 → 預設最小可見，view 也擋（NOT_FOUND/FORBIDDEN）。
 *
 *   可見性來源（兩條，OR）：
 *     1. 既有 visibility 欄位：visibility='team_shared' 且 user ∈ team 成員
 *        （沿用 teaching_materials / prompt_collection 的 team_shared 語意）。
 *     2. 顯式共享表 resource_shares：把資源分享給單一 user 或整個 team。
 *
 * ── 純函式邊界 ───────────────────────────────────────────────────────────
 *   canAccess() 不碰 DB、不讀 env、不 throw — 只吃「已解析好的事實」回 boolean。
 *   所有 I/O（查成員、查共享、讀旗標）在 resolver / router 端完成。這讓核心
 *   判斷可單測、可在 demo/無 DB 環境安全呼叫（事實給空集合即可）。
 *
 * ── 旗標 ─────────────────────────────────────────────────────────────────
 *   isDataRbacEnabled() 讀 ENABLE_DATA_RBAC（預設 false=OFF）。旗標 OFF 時
 *   呼叫端**完全不進**本服務的資料路徑，行為與現狀位元相同。
 */

import { serverEnv } from "../../_core/env.validated";

// ─── 型別 ────────────────────────────────────────────────────────────────

export type ResourceType = "project" | "asset" | "prompt" | "material";
export type AccessAction = "view" | "edit" | "delete";
export type ShareRole = "viewer" | "editor";
/** 對單一資源解析出來的有效角色（含 owner 與「無權」）。 */
export type EffectiveRole = "owner" | "editor" | "viewer" | "none";

/**
 * 授權判斷所需的「資源側事實」。刻意只取最小欄位，讓任何資源表都能投影成此形。
 * visibility / teamId 對應既有欄位（沒有的資源型別給 null 即可）。
 */
export interface ResourceFacts {
  /** 資源擁有者 user id */
  ownerId: number;
  /** 既有 visibility 欄位（'team_shared' 才有意義；無此概念的資源給 null） */
  visibility?: string | null;
  /** 既有 team 綁定（team_shared 對應的 team；無則 null） */
  teamId?: number | null;
  /**
   * AIDV-297：資源歸屬的組別（team_groups.id；null/undefined＝未歸組）。
   * 本檔的純函式**不讀**此欄位（AIDV-121 基礎語意不變）；它由
   * resourceAccessResolver 在 ENABLE_GROUP_SCOPE=ON 時交給
   * groupAccess.applyGroupScope 套跨組隔離。
   */
  groupId?: number | null;
}

/**
 * 授權判斷所需的「使用者側事實」。由 resolver 從 DB 查好後傳入。
 */
export interface AccessSubjectFacts {
  /** 使用者 user id */
  userId: number;
  /** 使用者所屬的 team id 集合（listTeamIdsForUser 結果） */
  memberTeamIds: ReadonlySet<number> | number[];
  /**
   * 針對「這個資源」命中的顯式共享角色（resource_shares）。
   * 由 resolver 把 user 直接共享 + user 所屬 team 共享合併取「較高權限」後傳入；
   * 沒有任何共享則為 null。
   */
  explicitShareRole?: ShareRole | null;
}

// ─── 核心純函式 ──────────────────────────────────────────────────────────

function toTeamSet(ids: ReadonlySet<number> | number[]): ReadonlySet<number> {
  return ids instanceof Set ? ids : new Set(ids);
}

/**
 * 解析使用者對單一資源的**有效角色**（純函式、不碰 DB）。
 *
 * 取所有來源中**權限最高**者：
 *   owner（ownerId===userId）
 *     > editor（explicitShareRole='editor' 或 team_shared 成員）
 *     > viewer（explicitShareRole='viewer'）
 *     > none
 */
export function resolveEffectiveRole(
  resource: ResourceFacts,
  subject: AccessSubjectFacts
): EffectiveRole {
  // 1. Owner — 最高
  if (resource.ownerId === subject.userId) return "owner";

  let best: EffectiveRole = "none";

  // 2. 顯式共享（resource_shares）
  if (subject.explicitShareRole === "editor") best = "editor";
  else if (subject.explicitShareRole === "viewer") best = "viewer";

  // 3. team_shared 池成員 → 視為 editor（沿用教材庫/收集的「池內成員可讀寫」語意）
  if (
    resource.visibility === "team_shared" &&
    resource.teamId != null &&
    toTeamSet(subject.memberTeamIds).has(resource.teamId)
  ) {
    best = "editor"; // editor ≥ viewer，直接覆蓋
  }

  return best;
}

/**
 * 該角色是否可執行該 action（純函式）。
 *
 *   action  │ owner │ editor │ viewer │ none
 *   ────────┼───────┼────────┼────────┼─────
 *   view    │  ✅   │   ✅   │   ✅   │  ❌
 *   edit    │  ✅   │   ✅   │   ❌   │  ❌
 *   delete  │  ✅   │   ❌   │   ❌   │  ❌
 *
 * delete 永遠只屬 owner（共享對象再高也不能刪別人的資源）。
 */
export function roleCan(role: EffectiveRole, action: AccessAction): boolean {
  switch (action) {
    case "view":
      return role === "owner" || role === "editor" || role === "viewer";
    case "edit":
      return role === "owner" || role === "editor";
    case "delete":
      return role === "owner";
    default:
      return false;
  }
}

/**
 * 統一授權判斷（純函式）。預設最小可見：任何來源都沒命中 → false。
 *
 * @example
 *   canAccess(
 *     { ownerId: 2, visibility: "team_shared", teamId: 7 },
 *     { userId: 5, memberTeamIds: [7], explicitShareRole: null },
 *     "view"
 *   ) // → true（team_shared 池成員）
 */
export function canAccess(
  resource: ResourceFacts,
  subject: AccessSubjectFacts,
  action: AccessAction
): boolean {
  const role = resolveEffectiveRole(resource, subject);
  return roleCan(role, action);
}

// ─── 旗標 ────────────────────────────────────────────────────────────────

/**
 * 讀 ENABLE_DATA_RBAC（預設 OFF）。OFF 時呼叫端不得進入任何 canAccess 資料
 * 路徑，行為與現狀位元相同。接受可選 override（測試注入用）。
 */
export function isDataRbacEnabled(override?: string): boolean {
  const value = override ?? serverEnv.ENABLE_DATA_RBAC;
  if (value === undefined || value === null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "on", "yes", "enabled"].includes(normalized);
}
