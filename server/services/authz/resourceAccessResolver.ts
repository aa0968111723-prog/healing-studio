/**
 * resourceAccessResolver.ts — 把 DB 事實餵進 canAccess 純函式的橋接層
 * ──────────────────────────────────────────────────────────────────────────
 *
 * resourceAccess.ts 的 canAccess() 是純函式（不碰 DB）。本檔負責 I/O：
 * 從 DB 查使用者所屬團隊、查顯式共享，組成 AccessSubjectFacts，再呼叫純函式。
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
  type AccessAction,
  type AccessSubjectFacts,
  type EffectiveRole,
  type ResourceFacts,
  type ResourceType,
  type ShareRole,
} from "./resourceAccess";

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
 * 解析使用者對某資源（以 facts 形式給）的有效角色（DB 版）。
 */
export async function resolveRoleForResource(
  resourceType: ResourceType,
  resourceId: number,
  resource: ResourceFacts,
  userId: number
): Promise<EffectiveRole> {
  const subject = await buildSubjectFacts(resourceType, resourceId, userId);
  return resolveEffectiveRole(resource, subject);
}

/**
 * 端到端授權判斷（DB 版）：查事實 → canAccess。旗標 ON 時 router 用這個。
 *
 * @param resource  已從資源表讀出的 owner facts（ownerId/visibility/teamId）
 */
export async function canAccessResource(
  resourceType: ResourceType,
  resourceId: number,
  resource: ResourceFacts,
  userId: number,
  action: AccessAction
): Promise<boolean> {
  const subject = await buildSubjectFacts(resourceType, resourceId, userId);
  return canAccess(resource, subject, action);
}
