// ============================================================================
// shells/settings/rbac.ts — /settings 前端 RBAC 小工具（與後端 procedure 守門對齊）
// ----------------------------------------------------------------------------
// 真實角色（server/routers.ts）：user | leader | admin。後端守門：
//   adminProcedure          → admin 專屬（updateQuota / updateRole / usageLogs / systemStats / apiKeysStatus…）
//   leaderOrAdminProcedure  → leader 或 admin（updateAutoCreditPolicy / teamCostSummary / runAutoCreditNow）
// 前端 RBAC 只是「提早隱藏 / 禁用」UI（UX 用途）；真正權限仍由後端 procedure 強制。
// 前端放行 ≠ 後端放行：即使前端被繞過，adminProcedure 仍會擋下非 admin 呼叫。
// ============================================================================
import { useAuth } from "@/_core/hooks/useAuth";

export type Role = "user" | "leader" | "admin";

/** 角色高低（用於 ≥ 比較）。 */
const RANK: Record<Role, number> = { user: 0, leader: 1, admin: 2 };

/** 讀目前登入者角色（auth.me.role）；未登入 / 未知 → "user"（最低權）。 */
export function useRole(): Role {
  const { user } = useAuth();
  const r = (user as any)?.role;
  return r === "admin" || r === "leader" || r === "user" ? r : "user";
}

/** 目前角色是否 ≥ 指定門檻。 */
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** 後台分頁的最低可見角色（對齊後端 procedure 守門）。 */
export const ADMIN_TAB_MIN_ROLE: Record<string, Role> = {
  users: "leader",        // 使用者列表 leader 可看；改角色(updateRole)僅 admin（分頁內再守）
  credits: "leader",      // 成本金流 / 自動給點 = leaderOrAdmin
  content: "admin",       // 內容治理（news/learnHub/models 策展）
  flags: "admin",         // 功能開關
  "data-repair": "admin", // 資料修復
  audit: "admin",         // 稽核日誌（usageLogs / apiKeysStatus）
};

/** 某後台分頁目前角色是否可見。 */
export function canSeeAdminTab(role: Role, tab: string): boolean {
  const min = ADMIN_TAB_MIN_ROLE[tab] ?? "admin";
  return roleAtLeast(role, min);
}
