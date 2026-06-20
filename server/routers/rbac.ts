/**
 * rbac.ts — 資料層 RBAC 共享 / 撤銷 / 移轉 Router（AIDV-121 基礎版）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 提供「顯式共享」生命週期的 mutation，與唯讀的共享清單查詢：
 *
 *   share            — 把資源（project/asset/prompt/material）顯式共享給某
 *                      成員或某團隊，授 viewer / editor 角色。僅資源 owner 可。
 *   revokeShare      — 撤銷一筆共享。僅資源 owner 可。
 *   listShares       — 列出某資源被分享給誰（owner 的共享管理面板用）。
 *   transferOwnership— 移轉資源擁有權給另一 user（成員離開時把素材交接，
 *                      避免孤兒）。僅現任 owner 可；移轉後清掉新 owner 自己
 *                      的共享記錄（他已是 owner，不需再被「共享」）。
 *
 * ── 與旗標的關係 ─────────────────────────────────────────────────────────
 *   這些 mutation **不受 ENABLE_DATA_RBAC 旗標 gate**：建立共享記錄本身是
 *   純加法、不改任何既有讀取行為（旗標 OFF 時沒有任何讀取端會去查
 *   resource_shares）。把「資料寫入」與「enforcement」解耦，讓 Bruce 可以
 *   先讓使用者建立共享關係、累積資料，待拍板後再開 enforcement 旗標。
 *
 *   transferOwnership 直接改 owner 欄位 → 會立即生效（這是刻意的：移轉本就
 *   該無條件改變擁有權，與「能不能看到」的 enforcement 旗標無關）。
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
   * 僅現任 owner 可；移轉後清掉「新 owner 對此資源的舊共享記錄」（他已是
   * owner，不需再被列為被共享者）。
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
      await requireOwner(input.resourceType, input.resourceId, ctx.user.id);

      if (input.newOwnerUserId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新擁有者不可與現任擁有者相同",
        });
      }

      await db.transferResourceOwnership(
        input.resourceType,
        input.resourceId,
        input.newOwnerUserId
      );

      // 新 owner 若先前被共享過，清掉那筆 user 共享（避免「owner 又是被共享者」）
      await db.revokeResourceShare(
        input.resourceType,
        input.resourceId,
        "user",
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
