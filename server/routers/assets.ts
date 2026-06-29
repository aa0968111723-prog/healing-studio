import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { serverEnv } from "../_core/env.validated";
import { isFlagEnabled } from "../_core/flags";
import { isDemoMode } from "../_core/googleAuth";
import * as db from "../db";
import { storageDelete } from "../storage";
import { recordAuditEvent, extractRequestSource } from "../services/audit/auditLog";
import { isDataRbacEnabled } from "../services/authz/resourceAccess";
import { canAccessResource } from "../services/authz/resourceAccessResolver";

// ─── Assets ──────────────────────────────────────────────────────────────

export const assetsRouter = router({
  myAssets: protectedProcedure
    .input(
      z
        .object({
          assetType: z
            .enum([
              "image",
              "video",
              "audio",
              "voice",
              "script",
              "zip_bundle",
              "all",
            ])
            .default("all"),
          // 來源工作室過濾 — 對應 digital_asset_library.sourceStudio
          // （0047 migration 新增）。"all" 顯示全部；"unknown" 顯示舊資料
          // 與手動上傳（NULL 值）。
          sourceStudio: z
            .enum([
              "all",
              "creative",
              "director",
              "image",
              "video",
              "pro",
              "background",
              "webhook",
              "suno",
              "replicate",
              "unknown",
            ])
            .default("all"),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return db.getDigitalAssetsByUserFiltered({
        userId: ctx.user.id,
        assetType: input?.assetType,
        sourceStudio: input?.sourceStudio,
        search: input?.search,
      });
    }),

  // ── 此資產用過哪些 prompt（prompt_assets junction, migration 0075）──────
  // 讀取不掛 ENABLE_PROMPT_ASSET_LINKS 旗標 — 旗標只管生成鏈的寫入端；
  // 表空（旗標未開、尚未 backfill）時回空陣列，前端相容。
  linkedPrompts: protectedProcedure
    .input(z.object({ assetId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      // 確認資產是本人的（與 myAssets 同 userId 範圍）
      const asset = await db.getDigitalAsset(input.assetId);
      if (!asset || asset.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此資產" });
      }
      return db.getLinkedPromptsForAsset(ctx.user.id, input.assetId);
    }),

  // ── 最近 N 個資產的 prompt 血統（W3-F AIDV-51，一次 join）─────────────────
  // 旗標：無（讀取不掛旗標；表空時回空陣列，前端相容）
  recentLineage: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(10) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getRecentAssetLineage(ctx.user.id, input?.limit ?? 5);
    }),

  teamAssets: protectedProcedure
    .input(
      z
        .object({
          assetType: z
            .enum([
              "image",
              "video",
              "audio",
              "voice",
              "script",
              "zip_bundle",
              "all",
            ])
            .default("all"),
          sourceStudio: z
            .enum([
              "all",
              "creative",
              "director",
              "image",
              "video",
              "pro",
              "background",
              "webhook",
              "suno",
              "replicate",
              "unknown",
            ])
            .default("all"),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      try {
        const all = await db.getTeamSharedAssets();
        let result = all;

        // ── AIDV-121 enforcement（旗標 gate）──────────────────────────
        // 旗標 OFF（預設）= 完全保持現狀：回全站 team_shared 資產（既有
        //   行為，含已知 cross-tenant 洩漏；本 PR 刻意不在 OFF 時改它）。
        // 旗標 ON = 經 canAccess 過濾，只留 ctx.user 真正能看到的（owner /
        //   被顯式共享 / team_shared 池成員），A 看不到 B 未共享的資產。
        if (isDataRbacEnabled()) {
          const visible: typeof result = [];
          for (const asset of result) {
            const ok = await canAccessResource(
              "asset",
              asset.id,
              {
                ownerId: asset.userId,
                visibility: asset.visibility,
                teamId: null, // digital_asset_library 尚無 teamId 欄；靠顯式共享授權
              },
              ctx.user.id,
              "view"
            );
            if (ok) visible.push(asset);
          }
          result = visible;
        }

        if (input?.assetType && input.assetType !== "all") {
          result = result.filter(a => a.assetType === input.assetType);
        }
        if (input?.sourceStudio && input.sourceStudio !== "all") {
          if (input.sourceStudio === "unknown") {
            result = result.filter(a => !a.sourceStudio);
          } else {
            result = result.filter(a => a.sourceStudio === input.sourceStudio);
          }
        }
        if (input?.search) {
          const q = input.search.toLowerCase();
          result = result.filter(
            a =>
              a.title.toLowerCase().includes(q) ||
              (a.description || "").toLowerCase().includes(q) ||
              (a.promptUsed || "").toLowerCase().includes(q)
          );
        }
        return result;
      } catch {
        return [];
      }
    }),

  // ── 手動上傳資產（已上傳至 S3 後呼叫此端點登記）──────────────────────
  upload: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(500).optional(),
        assetType: z.enum([
          "image",
          "video",
          "audio",
          "voice",
          "script",
          "zip_bundle",
        ]),
        fileUrl: z.string().url(),
        fileKey: z.string(),
        mimeType: z.string().optional(),
        fileSizeBytes: z.number().optional(),
        thumbnailUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createDigitalAsset({
        userId: ctx.user.id,
        title: input.title,
        description: input.description,
        assetType: input.assetType,
        fileUrl: input.fileUrl,
        fileKey: input.fileKey,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        thumbnailUrl: input.thumbnailUrl,
      });
      return { id };
    }),

  // ── 更新資產資訊 ──────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await db.getDigitalAsset(input.id);
      if (!asset || asset.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
      }
      const updates: Record<string, unknown> = {};
      if (input.title) updates.title = input.title;
      if (input.description !== undefined)
        updates.description = input.description;
      await db.updateDigitalAsset(
        input.id,
        updates as Parameters<typeof db.updateDigitalAsset>[1]
      );
      return { success: true };
    }),

  toggleVisibility: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        visibility: z.enum(["private", "team_shared"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await db.getDigitalAsset(input.id);
      if (!asset || asset.userId !== ctx.user.id) {
        // 失敗/越權探測也要留痕（NOT_FOUND 涵蓋「不存在」與「非本人」）。
        recordAuditEvent({
          actorUserId: ctx.user.id,
          actorRole: ctx.user.role,
          action:
            input.visibility === "team_shared"
              ? "asset.share"
              : "asset.unshare",
          targetType: "asset",
          targetId: input.id,
          result: "failure",
          metadata: { reason: "not_found_or_forbidden" },
          ...extractRequestSource(ctx.req),
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
      }
      await db.updateDigitalAsset(input.id, { visibility: input.visibility });
      // Reward credits for sharing (only on first share — prevent toggle exploit)
      // Skip in demo mode: demo users don't have real quota
      if (
        !isDemoMode() &&
        input.visibility === "team_shared" &&
        asset.visibility !== "team_shared"
      ) {
        const alreadyRewarded = (asset.rewardCredits ?? 0) > 0;
        if (!alreadyRewarded) {
          await db.refundUserQuota(ctx.user.id, 2);
          await db.updateDigitalAsset(input.id, { rewardCredits: 2 });
          console.log(
            `[Reward] User ${ctx.user.id} earned 2 pts for sharing asset ${input.id}`
          );
        }
      }
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action:
          input.visibility === "team_shared" ? "asset.share" : "asset.unshare",
        targetType: "asset",
        targetId: input.id,
        metadata: {
          from: asset.visibility,
          to: input.visibility,
        },
        ...extractRequestSource(ctx.req),
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const asset = await db.getDigitalAsset(input.id);
      if (!asset || asset.userId !== ctx.user.id) {
        // 失敗/越權刪除嘗試也要留痕（攻擊者探測不屬於自己的資產）。
        recordAuditEvent({
          actorUserId: ctx.user.id,
          actorRole: ctx.user.role,
          action: "asset.delete",
          targetType: "asset",
          targetId: input.id,
          result: "failure",
          metadata: { reason: "not_found_or_forbidden" },
          ...extractRequestSource(ctx.req),
        });
        throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
      }
      await db.deleteDigitalAsset(input.id);
      // AIDV-67：刪資產時連動刪掉 R2/儲存物件，避免孤兒物件長期占用空間。
      //   - 旗標 ENABLE_ASSET_R2_CASCADE_DELETE 預設 ON，可即時關（無需重部署）。
      //   - 僅當此資產有 fileKey 且「沒有其他資產列共用同一 key」（公開回收 /
      //     團隊共享複製）才刪物件，免得刪一列害其他列壞圖。
      //   - 全程 best-effort：刪物件失敗只吞掉，不 throw、不阻塞刪除主流程
      //     （最壞退回今日「DB 列已刪、留下孤兒物件」的行為，零退步）。
      if (
        isFlagEnabled(serverEnv.ENABLE_ASSET_R2_CASCADE_DELETE, true) &&
        asset.fileKey
      ) {
        try {
          const sharedCount = await db.countOtherDigitalAssetsByFileKey(
            asset.fileKey,
            input.id
          );
          if (sharedCount === 0) {
            await storageDelete(asset.fileKey);
          }
        } catch {
          /* 刪儲存物件失敗不擋刪除——留孤兒可由 TTL 清理 job 後續處理 */
        }
      }
      // AIDV-121：清掉此資源的孤兒共享記錄（resource_shares 無 FK，刪資源
      // 不會 cascade）。best-effort，不阻塞刪除主流程（與 audit 同模式）。
      try {
        await db.deleteAllSharesForResource("asset", input.id);
      } catch {
        /* 清孤兒失敗不應擋刪除 */
      }
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "asset.delete",
        targetType: "asset",
        targetId: input.id,
        metadata: { title: asset.title },
        ...extractRequestSource(ctx.req),
      });
      return { success: true };
    }),
});
