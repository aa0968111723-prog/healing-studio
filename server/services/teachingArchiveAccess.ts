/**
 * teachingArchiveAccess — 教材庫的權限與稽核中樞
 *
 * 把「誰能讀 / 誰能改 / 誰能刪」這個 visibility × team membership 的
 * 矩陣集中在一個檔案，router 只負責 dispatch、不重複寫 if/else。
 *
 *   read   (view/download/search):
 *     - owner
 *     - visibility = team_shared AND user ∈ memberships(teamId)
 *     - visibility = public_disciples（全 workspace 可讀）
 *
 *   write  (update/delete/reingest):
 *     - owner
 *     - visibility = team_shared 且 user ∈ memberships(teamId)，任何角色皆可
 *       （這是設計選擇 — 團隊池內所有成員都能編輯彼此的素材；UI 仍有刪除確認）
 *     - public_disciples 由 teamId 託管時，須是該 team 的 owner / admin
 *
 * `assertCanRead` / `assertCanWrite` 直接 throw TRPCError，呼叫端 try 不到
 * 也沒關係 — tRPC 會把錯誤序列化回前端。
 */

import { TRPCError } from "@trpc/server";
import * as db from "../db";
import type { TeachingMaterial, TeamMembership } from "../../drizzle/schema";

export type AccessAction =
  | "view"
  | "download"
  | "search_hit"
  | "reingest"
  | "update"
  | "delete";

export interface AccessContext {
  userId: number;
}

/**
 * 抓素材並驗證讀權限。回傳 `{ material, viaTeamId | null }` —
 * viaTeamId 不是 null 表示是透過該 team membership 取得的存取，後續
 * 寫稽核日誌時會記下來。
 */
export async function loadMaterialForRead(
  materialId: number,
  ctx: AccessContext
): Promise<{
  material: TeachingMaterial;
  viaTeamId: number | null;
  membership: TeamMembership | null;
}> {
  const material = await db.getTeachingMaterial(materialId);
  if (!material) {
    throw new TRPCError({ code: "NOT_FOUND", message: "教材不存在" });
  }

  // Owner — 永遠可讀
  if (material.userId === ctx.userId) {
    return { material, viaTeamId: null, membership: null };
  }

  // public_disciples — 全 workspace
  if (material.visibility === "public_disciples") {
    return { material, viaTeamId: null, membership: null };
  }

  // team_shared — 需要驗 membership
  if (material.visibility === "team_shared" && material.teamId !== null) {
    const membership = await db.getTeamMembership(
      material.teamId,
      ctx.userId
    );
    if (membership) {
      return { material, viaTeamId: material.teamId, membership };
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "你沒有權限讀取這份教材",
  });
}

/**
 * 抓素材並驗證寫權限（update / delete / reingest）。比讀嚴格 —
 * team_shared 素材一般 member 不可改，只有 owner / admin。
 */
export async function loadMaterialForWrite(
  materialId: number,
  ctx: AccessContext
): Promise<{
  material: TeachingMaterial;
  viaTeamId: number | null;
  membership: TeamMembership | null;
}> {
  const material = await db.getTeachingMaterial(materialId);
  if (!material) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資料不存在" });
  }

  // Owner — 永遠可改
  if (material.userId === ctx.userId) {
    return { material, viaTeamId: null, membership: null };
  }

  // team_shared — 同隊任何成員都可改（含 member）
  if (material.visibility === "team_shared" && material.teamId !== null) {
    const membership = await db.getTeamMembership(
      material.teamId,
      ctx.userId
    );
    if (membership) {
      return { material, viaTeamId: material.teamId, membership };
    }
  }

  // public_disciples — 不是 owner 的話，要是 team admin / owner 才可改
  if (
    material.visibility === "public_disciples" &&
    material.teamId !== null
  ) {
    const membership = await db.getTeamMembership(
      material.teamId,
      ctx.userId
    );
    if (
      membership &&
      (membership.role === "owner" || membership.role === "admin")
    ) {
      return { material, viaTeamId: material.teamId, membership };
    }
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: "你沒有權限修改這份資料",
  });
}

/**
 * 寫稽核日誌。預設用 fire-and-forget；若呼叫端要等寫完才 return（測試/匯出
 * 場景）可以 await。
 */
export function logAccess(
  materialId: number,
  userId: number,
  action: AccessAction,
  extraMetadata?: Record<string, unknown>
): void {
  void db
    .logTeachingMaterialAccess({
      materialId,
      userId,
      action,
      metadata: extraMetadata ?? null,
    })
    .catch(err => {
      console.error(
        `[teachingArchiveAccess] logAccess failed materialId=${materialId} action=${action}:`,
        err
      );
    });
}
