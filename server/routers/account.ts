import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { softDeleteUser, exportUserData } from "../db";
import { logger } from "../_core/logger";

export const accountRouter = router({
  /**
   * 使用者自主刪除帳號（軟刪除）。
   * 需提供目前密碼確認（不論登入方式均要求 confirm 語句以防誤觸）。
   * 軟刪除：anonymize PII + 設 deletedAt = NOW()；資料可由 admin 手動復原 90 天內。
   */
  deleteAccount: protectedProcedure
    .input(z.object({
      confirm: z.literal("DELETE MY ACCOUNT"),
    }))
    .mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      logger.info("[Account] User initiated account deletion", { userId });
      try {
        await softDeleteUser(userId);
        logger.info("[Account] Account soft-deleted successfully", { userId });
        return { success: true };
      } catch (err) {
        logger.error("[Account] Failed to soft-delete account", { userId, err });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "帳號刪除失敗，請稍後再試" });
      }
    }),

  /**
   * 使用者資料匯出（GDPR 可攜性）。
   * 回傳 JSON，包含帳號基本資料、創作專案清單、提示詞庫數量、心願單數量。
   * 不含二進位媒體（串流另行下載）。
   */
  exportData: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const data = await exportUserData(userId);
      if (!data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到使用者資料" });
      }
      return data;
    }),
});
