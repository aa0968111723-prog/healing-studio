/**
 * apiKeyRouter.ts — AIDV-276 程式化 API 金鑰管理
 *
 * create : 產生新金鑰（raw key 僅回傳一次）
 * list   : 列出未撤銷金鑰（只回 prefix，不回 hash）
 * revoke : 撤銷指定金鑰
 *
 * 金鑰格式：aidv_<40 hex chars>（SHA-256 儲存）
 */

import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { apiKeys } from "../../drizzle/schema";

export const VALID_SCOPES = ["video:create", "video:read"] as const;
const ScopesSchema = z.array(z.enum(VALID_SCOPES)).min(1);

function generateApiKey() {
  const hex = crypto.randomBytes(20).toString("hex");
  const raw = `aidv_${hex}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const prefix = `aidv_${hex.slice(0, 6)}...`;
  return { raw, hash, prefix };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時無法使用" });
  return db;
}

export const apiKeyRouter = router({
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), scopes: ScopesSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const { raw, hash, prefix } = generateApiKey();
      await db.insert(apiKeys).values({
        userId: ctx.user.id,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: input.scopes,
      });
      return { key: raw, prefix, name: input.name, scopes: input.scopes };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
  }),

  revoke: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const result = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id), isNull(apiKeys.revokedAt)));
      const affected = (result as unknown as { affectedRows: number }).affectedRows;
      if (affected === 0) throw new TRPCError({ code: "NOT_FOUND", message: "API 金鑰不存在或已撤銷" });
      return { success: true };
    }),
});
