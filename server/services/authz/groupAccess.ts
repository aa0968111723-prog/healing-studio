/**
 * groupAccess.ts — 組別範圍授權中樞（AIDV-297 T-1 · Wave T 地基）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 把「組別（team_groups）」落成 AIDV-121 RBAC 引擎的**強制範圍單位**：
 *
 *   • 跨組隔離（isolation ceiling）：資源歸屬某組（groupId != null）時，
 *     **非組員**即使拿到顯式共享 / team_shared 授權也一律擋（none）——
 *     組間預設隔離在 API 層生效，不只 UI。
 *   • 組內授權（grant floor）：組員以組內角色換得資源層有效角色下限——
 *     lead → editor、member → viewer（不會蓋掉更高的既有授權）。
 *   • Owner 至上：資源 owner 永不被自己資源的組別隔離鎖在門外
 *     （避免「掛組後退組＝喪失自己資源」的自鎖）。
 *   • Admin 調閱：系統角色 admin 不受隔離（AIDV-122/123 資料調閱職責）；
 *     但 admin 不因此**新增**資源授權（grant 只給組員）。
 *
 * ── 角色 × Admin 權限矩陣（T-2 管理台 / T-4 配額直接 import 引用）────────────
 *
 *   系統角色（users.role）× Admin 能力：
 *
 *     能力                        │ admin │ leader │ user
 *     ────────────────────────────┼───────┼────────┼──────
 *     skill_trust_escalation(129) │  ✅   │   ❌   │  ❌
 *     quota_adjustment      (T-4) │  ✅   │   ❌   │  ❌
 *     data_inspection   (122/123) │  ✅   │   ❌   │  ❌
 *     member_management           │  ✅   │   ❌   │  ❌
 *     group_management            │  ✅   │   ❌   │  ❌
 *     delegate_admin              │  ✅   │   ❌   │  ❌
 *
 *   小團隊先「Bruce 單一 Admin」：唯一 users.role='admin' 帳號持有全部能力；
 *   delegate_admin 保留委派路徑（admin 可把另一帳號升為 admin），矩陣不用改。
 *
 *   組內角色（team_group_memberships.role）× 組內能力（疊在 121 之上）：
 *
 *     能力                     │ lead │ member │ 非組員
 *     ─────────────────────────┼──────┼────────┼───────
 *     manage_members（加/移/改）│  ✅  │   ❌   │  ❌
 *     assign_resources（掛/摘） │  ✅  │   ❌   │  ❌
 *     組資源有效角色下限        │editor│ viewer │ none(隔離)
 *
 *   （Admin 對以上一律可，作為跨組治理者；資源 owner 對自己資源的掛/摘
 *   另由 router 以擁有權判斷放行。）
 *
 * ── 純函式邊界 ───────────────────────────────────────────────────────────
 *   本檔核心（矩陣 + applyGroupScope）不碰 DB、不 throw；I/O 由
 *   resourceAccessResolver / teamGroups router 完成，與 resourceAccess.ts
 *   的 canAccess 同一設計哲學（可單測、demo/無 DB 安全）。
 *
 * ── 旗標 ─────────────────────────────────────────────────────────────────
 *   isGroupScopeEnabled() 讀 ENABLE_GROUP_SCOPE（預設 false=OFF）。OFF 時
 *   讀取路徑完全不看 groupId，行為與現狀位元相同。group scope 疊在 AIDV-121
 *   enforcement 路徑內，故實際生效需 ENABLE_DATA_RBAC=ON 且本旗標 ON。
 */

import { serverEnv } from "../../_core/env.validated";
import type { EffectiveRole } from "./resourceAccess";

// ─── 系統角色 × Admin 能力矩陣 ───────────────────────────────────────────

/** users.role 的三個系統角色（AIDV-52 role_leader 之後的既有 enum）。 */
export type SystemRole = "user" | "leader" | "admin";

/**
 * 跨組別 Admin 能力（卡上「Admin 定義：明確誰能」的落地）：
 *   skill_trust_escalation — Skill 信任升級放行（AIDV-129）
 *   quota_adjustment       — 配額調整（T-4 / AIDV-300）
 *   data_inspection        — 資料調閱（AIDV-122/123）
 *   member_management      — 成員增刪改組（跨組）
 *   group_management       — 建立 / 刪除組別
 *   delegate_admin         — 委派：把另一帳號升為 admin（保留擴編路徑）
 */
export type AdminCapability =
  | "skill_trust_escalation"
  | "quota_adjustment"
  | "data_inspection"
  | "member_management"
  | "group_management"
  | "delegate_admin";

export const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  "skill_trust_escalation",
  "quota_adjustment",
  "data_inspection",
  "member_management",
  "group_management",
  "delegate_admin",
] as const;

/**
 * 系統角色 → Admin 能力矩陣（SSOT；T-2 管理台 / T-4 配額請 import 這個，
 * 不要各自散寫 `role === "admin"` 判斷）。目前 admin 全可、leader/user 全不可
 * —— 「Bruce 單一 Admin」由「只有一個帳號是 admin」保證，委派時矩陣不變。
 */
export const ADMIN_PERMISSION_MATRIX: Readonly<
  Record<SystemRole, Readonly<Record<AdminCapability, boolean>>>
> = {
  admin: {
    skill_trust_escalation: true,
    quota_adjustment: true,
    data_inspection: true,
    member_management: true,
    group_management: true,
    delegate_admin: true,
  },
  leader: {
    skill_trust_escalation: false,
    quota_adjustment: false,
    data_inspection: false,
    member_management: false,
    group_management: false,
    delegate_admin: false,
  },
  user: {
    skill_trust_escalation: false,
    quota_adjustment: false,
    data_inspection: false,
    member_management: false,
    group_management: false,
    delegate_admin: false,
  },
} as const;

/** 系統角色是否具某 Admin 能力（未知/缺角色 → 一律 false，預設最小權限）。 */
export function systemRoleCan(
  role: string | null | undefined,
  capability: AdminCapability
): boolean {
  if (role !== "admin" && role !== "leader" && role !== "user") return false;
  return ADMIN_PERMISSION_MATRIX[role][capability];
}

/** 是否為跨組別 Admin（矩陣任一能力等價；語意化捷徑）。 */
export function isSystemAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

// ─── 組內角色 ────────────────────────────────────────────────────────────

/** 組內角色：lead（組長）/ member（組員）。 */
export type GroupRole = "lead" | "member";

/**
 * 組內角色 → 資源層有效角色**下限**（grant floor）：
 *   lead → editor、member → viewer、非組員 → none。
 * 疊加規則見 applyGroupScope：取「既有授權 vs 組授權」較高者，且永不升到 owner。
 */
export function groupRoleToResourceRole(
  groupRole: GroupRole | null | undefined
): EffectiveRole {
  if (groupRole === "lead") return "editor";
  if (groupRole === "member") return "viewer";
  return "none";
}

/**
 * 組內管理能力：加/移組員、改組內角色、掛/摘組資源。
 * lead 或系統 Admin 可；member / 非組員不可。
 */
export function canManageGroup(
  systemRole: string | null | undefined,
  groupRole: GroupRole | null | undefined
): boolean {
  return isSystemAdmin(systemRole) || groupRole === "lead";
}

// ─── 跨組隔離 + 組內授權（核心純函式）────────────────────────────────────

/** applyGroupScope 需要的資源側事實。 */
export interface GroupScopeResourceFacts {
  /** 資源擁有者 user id */
  ownerId: number;
  /** 資源歸屬的組別 id；null＝未歸組（不受組範圍影響） */
  groupId: number | null;
}

/** applyGroupScope 需要的使用者側事實（由 resolver 從 DB 查好傳入）。 */
export interface GroupScopeSubjectFacts {
  userId: number;
  /** users.role；undefined/null 視為非 admin（最小權限） */
  systemRole?: string | null;
  /** 使用者在「資源歸屬的那個組」的組內角色；null＝非組員 */
  groupRole?: GroupRole | null;
}

const ROLE_RANK: Record<EffectiveRole, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  none: 0,
};

/** 取兩個有效角色中較高者（owner > editor > viewer > none）。 */
export function maxEffectiveRole(
  a: EffectiveRole,
  b: EffectiveRole
): EffectiveRole {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * 把「組別範圍」套在 AIDV-121 已解析的基礎有效角色上（純函式、不碰 DB）：
 *
 *   1. 未歸組（groupId==null）→ 原樣通過（與現狀相同）。
 *   2. owner → 原樣通過（owner 至上，永不被自己資源的組別鎖在門外）。
 *   3. 系統 admin → 原樣通過（資料調閱不受隔離；也不新增授權）。
 *   4. 非組員（groupRole==null）→ **none**（跨組隔離 ceiling：顯式共享 /
 *      team_shared 都壓掉）。
 *   5. 組員 → max(基礎角色, 組內角色對應下限)（lead→editor、member→viewer）。
 *
 * @example
 *   // 非組員即使被顯式共享 editor，也被組隔離擋下
 *   applyGroupScope("editor", { ownerId: 1, groupId: 9 }, { userId: 2 })
 *   // → "none"
 */
export function applyGroupScope(
  baseRole: EffectiveRole,
  resource: GroupScopeResourceFacts,
  subject: GroupScopeSubjectFacts
): EffectiveRole {
  // 1. 未歸組資源不受組範圍影響
  if (resource.groupId == null) return baseRole;
  // 2. owner 至上
  if (subject.userId === resource.ownerId) return baseRole;
  // 3. Admin 調閱不受隔離（但不新增授權）
  if (isSystemAdmin(subject.systemRole)) return baseRole;
  // 4. 跨組隔離：非組員一律 none（共享授權也壓掉）
  if (subject.groupRole == null) return "none";
  // 5. 組員：既有授權與組內授權取較高者（永不升到 owner —— grant 上限 editor）
  return maxEffectiveRole(baseRole, groupRoleToResourceRole(subject.groupRole));
}

// ─── 旗標 ────────────────────────────────────────────────────────────────

/**
 * 讀 ENABLE_GROUP_SCOPE（預設 OFF）。OFF 時呼叫端不得進入任何 group scope
 * 資料路徑，行為與現狀位元相同。接受可選 override（測試注入用）。
 * 解析規則與 isDataRbacEnabled 一致（1/true/on/yes/enabled）。
 */
export function isGroupScopeEnabled(override?: string): boolean {
  const value = override ?? serverEnv.ENABLE_GROUP_SCOPE;
  if (value === undefined || value === null || value.trim() === "") return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "on", "yes", "enabled"].includes(normalized);
}
