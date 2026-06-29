/**
 * rbac.ts — 資料層 RBAC 共享 / 撤銷 / 移轉 Router（AIDV-121 基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 提供「顯式共享」生命週期的 mutation，與唯讀的共享清單查詢：
 *
 *   share            — 把資源（project/asset/prompt/material）顯式共享給某
 *                      成員或某團隊，授 viewer / editor 角色。僅資源 owner 可。
 *                      共享前驗證對象（user/team）確實存在，避免打進不存在或
 *                      無關係的 id 變成「幽靈授權」。
 *   revokeShare      — 撤銷一筆共享。僅資源 owner 可。
 *   listShares       — 列出某資源被分享給誰（owner 的共享管理面板用）。
 *   transferOwnership— 移轉資源擁有權給另一 user（成員離開時把素材交接，
 *                      避免孤兒）。僅現任 owner 可。**受 ENABLE_DATA_RBAC
 *                      旗標 gate**（OFF 時回 FORBIDDEN），移轉時把該資源的
 *                      全部共享一併清掉，給新 owner 乾淨的共享圖、舊 owner
 *                      不留殘餘存取。
 *
 * ── 與旗標的關係 ─────────────────────────────────────────────────────────
 *   **純加法的 share / revokeShare / listShares 不受旗標 gate**：建立或讀取
 *   共享記錄本身是純加法、不改任何既有讀取行為（旗標 OFF 時沒有任何讀取端
 *   會去查 resource_shares）。把「資料寫入」與「enforcement」解耦，讓 Bruce
 *   可以先讓使用者建立共享關係、累積資料，待拍板後再開 enforcement 旗標。
 *
 *   **transferOwnership 例外，受旗標 gate**：它直接改既有資源表的 owner
 *   欄位 → 會「立即改變既有讀取結果」（原 owner 對自己資源變 NOT_FOUND、
 *   新 owner 取得存取）。為嚴守「旗標 OFF＝與現狀位元完全相同」（HARD
 *   SAFETY ①），旗標 OFF 時直接回 FORBIDDEN，不執行任何擁有權變更；旗標
 *   ON 時才放行。這把「會改變既有讀取結果的能力」全部收進旗標之後。
 *
 * ── 擁有權守門 ───────────────────────────────────────────────────────────
 *   所有 mutation 都先 getResourceOwnerFacts 驗 `ownerId === ctx.user.id`，
 *   非 owner 一律 FORBIDDEN（資源不存在回 NOT_FOUND）。這是純擁有權判斷，
 *   不依賴旗標，永遠生效。
 *
 *   稽核：share / revokeShare / transferOwnership 皆 recordAuditEvent
 *   （沿用 AIDV-123 best-effort append-only 稽核，不阻塞）。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  recordAuditEvent,
  extractRequestSource,
} from "../services/audit/auditLog";
import { isDataRbacEnabled } from "../services/authz/resourceAccess";

const resourceTypeSchema = z.enum(["project", "asset", "prompt", "material"]);
const shareRoleSchema = z.enum(["viewer", "editor"]);

/**
 * 驗證 ctx.user 是資源 owner，回傳 owner facts。非 owner → FORBIDDEN，
 * 不存在 → NOT_FOUND。共享 / 撤銷 / 移轉的共用守門。
 */
async function requireOwner(
  resourceType: z.infer<typeof resourceTypeSchema>,
  resourceId: number,
  userId: number
) {
  const facts = await db.getResourceOwnerFacts(resourceType, resourceId);
  if (!facts) {
    throw new TRPCError({ code: "NOT_FOUND", message: "資源不存在" });
  }
  if (facts.ownerId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有資源擁有者可以執行此操作",
    });
  }
  return facts;
}

/**
 * 驗證共享對象（user / team）確實存在，且 team 共享時分享者與該 team 有關係
 * （成員或 owner）。避免把資源共享給打錯 / 猜測的 id：因為 resource_shares
 * 是旗標 ON 時 canAccess 讀取的 SSOT，一筆指向不存在或無關係 id 的共享，一旦
 * 開 enforcement 就會變成活的授權（例如 teamId=7 會讓 team 7 全員拿到存取，
 * 即使分享者與 team 7 毫無關係）。對象不存在 → NOT_FOUND；分享者與目標 team
 * 無關係 → FORBIDDEN。
 */
async function validateShareTarget(
  sharedWithType: "user" | "team",
  sharedWithId: number,
  actorUserId: number
): Promise<void> {
  if (sharedWithType === "user") {
    const found = await db.getUsersByIds([sharedWithId]);
    if (found.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "共享對象（使用者）不存在",
      });
    }
    return;
  }
  // team：團隊必須存在，且分享者須為該團隊成員 / owner（不可把資源塞進無關團隊）
  const team = await db.getTeam(sharedWithId);
  if (!team) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "共享對象（團隊）不存在",
    });
  }
  const membership = await db.getTeamMembership(sharedWithId, actorUserId);
  if (!membership && team.ownerId !== actorUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "你不是此團隊的成員，無法把資源共享給該團隊",
    });
  }
}

export const rbacRouter = router({
  /** 列出某資源被分享給誰（僅 owner 可看完整共享清單）。 */
  listShares: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireOwner(input.resourceType, input.resourceId, ctx.user.id);
      return db.listSharesForResource(input.resourceType, input.resourceId);
    }),

  /**
   * 顯式共享：把資源分享給某 user（member）或某 team，授 viewer/editor 角色。
   * 重複對同一對象 share = 更新角色（upsert）。
   */
  share: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.number().int().positive(),
        sharedWithType: z.enum(["user", "team"]),
        sharedWithId: z.number().int().positive(),
        role: shareRoleSchema.default("viewer"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwner(input.resourceType, input.resourceId, ctx.user.id);

      // 不能把資源「共享給自己」（owner 本來就全權）
      if (
        input.sharedWithType === "user" &&
        input.sharedWithId === ctx.user.id
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不需要把資源共享給自己",
        });
      }

      // 對象（user/team）必須存在；team 共享須與分享者有關係。
      // 防「打錯/猜測 id 變幽靈授權」（旗標 ON 時 resource_shares 即 SSOT）。
      await validateShareTarget(
        input.sharedWithType,
        input.sharedWithId,
        ctx.user.id
      );

      await db.upsertResourceShare({
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        sharedWithType: input.sharedWithType,
        sharedWithId: input.sharedWithId,
        role: input.role,
        sharedByUserId: ctx.user.id,
      });

      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "rbac.share",
        targetType: input.resourceType,
        targetId: input.resourceId,
        ...extractRequestSource(ctx.req),
        metadata: {
          sharedWithType: input.sharedWithType,
          sharedWithId: input.sharedWithId,
          role: input.role,
        },
      });

      return { success: true };
    }),

  /** 撤銷一筆共享（依資源 + 對象）。 */
  revokeShare: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.number().int().positive(),
        sharedWithType: z.enum(["user", "team"]),
        sharedWithId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireOwner(input.resourceType, input.resourceId, ctx.user.id);

      await db.revokeResourceShare(
        input.resourceType,
        input.resourceId,
        input.sharedWithType,
        input.sharedWithId
      );

      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "rbac.revokeShare",
        targetType: input.resourceType,
        targetId: input.resourceId,
        ...extractRequestSource(ctx.req),
        metadata: {
          sharedWithType: input.sharedWithType,
          sharedWithId: input.sharedWithId,
        },
      });

      return { success: true };
    }),

  /**
   * 移轉資源擁有權給另一 user（成員離開時把素材交接，避免孤兒）。
   * 僅現任 owner 可。
   *
   * **受 ENABLE_DATA_RBAC 旗標 gate**：移轉會直接改既有資源表的 owner 欄位，
   * 立即改變既有讀取結果（原 owner 變 NOT_FOUND、新 owner 取得存取）。為嚴守
   * 「旗標 OFF＝與現狀位元完全相同」（HARD SAFETY ①），OFF 時回 FORBIDDEN、
   * 不執行任何變更。
   *
   * 移轉時把該資源的**全部共享一併清掉**，且與 owner 變更在**同一 DB 交易**內
   * 原子完成（transferResourceOwnershipAndWipeShares）：
   *   • 新 owner 拿到乾淨的共享圖（不會「owner 又是被共享者」）。
   *   • 舊 owner 不留任何殘餘共享存取（他建立的、或他被共享進來的都清掉）。
   *   • 任一步失敗→整筆 rollback，不會留下「擁有權已轉、舊共享殘留」的不一致
   *     狀態（AIDV-186）。
   * 對象使用者必須存在。
   */
  transferOwnership: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.number().int().positive(),
        newOwnerUserId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 旗標 OFF＝零行為變化：不開放任何會改變既有讀取結果的擁有權變更。
      if (!isDataRbacEnabled()) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "擁有權移轉功能尚未啟用（ENABLE_DATA_RBAC OFF）",
        });
      }

      await requireOwner(input.resourceType, input.resourceId, ctx.user.id);

      if (input.newOwnerUserId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新擁有者不可與現任擁有者相同",
        });
      }

      // 新 owner 必須存在
      const newOwner = await db.getUsersByIds([input.newOwnerUserId]);
      if (newOwner.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "新擁有者（使用者）不存在",
        });
      }

      // 原子化：移轉擁有權＋清掉此資源的全部共享在**同一 DB 交易**內完成。
      // 任一步失敗→整筆 rollback，不會出現「擁有權已轉、舊 owner 共享殘留」的
      // 部分失敗（舊 owner 對已不屬於他的資源仍有殘餘存取）。給新 owner 乾淨的
      // 共享圖，舊 owner 不留殘餘存取（含舊 owner 建立的、與被共享進來的）。AIDV-186。
      await db.transferResourceOwnershipAndWipeShares(
        input.resourceType,
        input.resourceId,
        input.newOwnerUserId
      );

      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "rbac.transferOwnership",
        targetType: input.resourceType,
        targetId: input.resourceId,
        ...extractRequestSource(ctx.req),
        metadata: {
          fromUserId: ctx.user.id,
          toUserId: input.newOwnerUserId,
        },
      });

      return { success: true };
    }),
});
