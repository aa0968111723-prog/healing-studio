/**
 * resourceAccessResolver.ts — 把 DB 事實餵進 canAccess 純函式的橋接層
 * ──────────────────────────────────────────────────────────────────────────
 *
 * resourceAccess.ts 的 canAccess() 是純函式（不碰 DB）。本檔負責 I/O：
 * 從 DB 查使用者所屬團隊、查顯式共享，組成 AccessSubjectFacts，再呼叫純函式。
 *
 * AIDV-297（組別範圍）：解析完 AIDV-121 基礎有效角色後，若
 * ENABLE_GROUP_SCOPE=ON 且資源已歸組（groupId != null），再查「使用者的
 * 系統角色 + 在該組的組內角色」，交給 groupAccess.applyGroupScope 套：
 *   • 跨組隔離：非組員即使有顯式共享 / team_shared 也壓成 none（API 層擋）。
 *   • 組內授權：lead→editor、member→viewer 作為下限（取較高者）。
 *   • owner / 系統 admin 不受隔離。
 * 旗標 OFF（預設）完全不進組別資料路徑，行為與 AIDV-121 現狀位元相同。
 *
 * 全部 demo / 無 DB 安全：getDb()===null 時各 db helper 回空集合，
 * 等同「除了 owner 外無任何授權」（預設最小可見），不會 throw。
 *
 * **重要**：本檔只有在 ENABLE_DATA_RBAC=ON 時才該被呼叫。旗標 OFF 時，
 * router 完全不進入這裡，行為與現狀位元相同（HARD SAFETY ①）。
 */

import * as db from "../../db";
import {
  canAccess,
  resolveEffectiveRole,
  roleCan,
  type AccessAction,
  type AccessSubjectFacts,
  type EffectiveRole,
  type ResourceFacts,
  type ResourceType,
  type ShareRole,
} from "./resourceAccess";
import { applyGroupScope, isGroupScopeEnabled } from "./groupAccess";

/** 把 user 直接共享 + team 共享的多筆記錄合併取「最高權限」。 */
function mergeShareRole(roles: ShareRole[]): ShareRole | null {
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return null;
}

/**
 * 從 DB 組裝某 user 對某資源的 AccessSubjectFacts（團隊 + 顯式共享）。
 */
export async function buildSubjectFacts(
  resourceType: ResourceType,
  resourceId: number,
  userId: number
): Promise<AccessSubjectFacts> {
  const memberTeamIds = await db.listTeamIdsForUser(userId);
  const shares = await db.getSharesForUserOnResource(
    resourceType,
    resourceId,
    userId,
    memberTeamIds
  );
  return {
    userId,
    memberTeamIds,
    explicitShareRole: mergeShareRole(shares.map(s => s.role)),
  };
}

/**
 * AIDV-297：把「組別範圍」套在已解析的基礎有效角色上（DB 版）。
 *
 * 旗標 OFF、資源未歸組、或已是 owner（owner 至上，免查 DB）→ 原樣通過。
 * 否則查「系統角色（admin 調閱不受隔離）＋ 該組會員紀錄」再交純函式
 * applyGroupScope 判定。demo/無 DB：查不到＝非 admin、非組員 → 隔離擋下
 * （預設最小可見，失敗安全）。
 */
async function applyGroupScopeFromDb(
  baseRole: EffectiveRole,
  resource: ResourceFacts,
  userId: number
): Promise<EffectiveRole> {
  const groupId = resource.groupId ?? null;
  if (!isGroupScopeEnabled() || groupId == null) return baseRole;
  // owner 至上：applyGroupScope 對 owner 必回原樣，免掉兩次 DB 查詢。
  if (userId === resource.ownerId) return baseRole;
  const [users, membership] = await Promise.all([
    db.getUsersByIds([userId]),
    db.getTeamGroupMembership(groupId, userId),
  ]);
  return applyGroupScope(
    baseRole,
    { ownerId: resource.ownerId, groupId },
    {
      userId,
      systemRole: users[0]?.role ?? null,
      groupRole: membership?.role ?? null,
    }
  );
}

/**
 * 解析使用者對某資源（以 facts 形式給）的有效角色（DB 版）。
 * ENABLE_GROUP_SCOPE=ON 且資源已歸組時，含跨組隔離／組內授權。
 */
export async function resolveRoleForResource(
  resourceType: ResourceType,
  resourceId: number,
  resource: ResourceFacts,
  userId: number
): Promise<EffectiveRole> {
  const subject = await buildSubjectFacts(resourceType, resourceId, userId);
  const baseRole = resolveEffectiveRole(resource, subject);
  return applyGroupScopeFromDb(baseRole, resource, userId);
}

/**
 * 端到端授權判斷（DB 版）：查事實 → canAccess。旗標 ON 時 router 用這個。
 * ENABLE_GROUP_SCOPE=ON 且 facts 帶 groupId 時，跨組隔離在此生效
 * （API 層擋，不只 UI）。
 *
 * @param resource  已從資源表讀出的 owner facts（ownerId/visibility/teamId/groupId）
 */
export async function canAccessResource(
  resourceType: ResourceType,
  resourceId: number,
  resource: ResourceFacts,
  userId: number,
  action: AccessAction
): Promise<boolean> {
  // 快路徑：組別範圍 OFF 或未歸組 → 與 AIDV-121 原始判斷位元相同。
  if (!isGroupScopeEnabled() || resource.groupId == null) {
    const subject = await buildSubjectFacts(resourceType, resourceId, userId);
    return canAccess(resource, subject, action);
  }
  const role = await resolveRoleForResource(
    resourceType,
    resourceId,
    resource,
    userId
  );
  return roleCan(role, action);
}
