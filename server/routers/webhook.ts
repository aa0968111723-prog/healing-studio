/**
 * webhook.ts — AIDV-269
 *
 * tRPC router for creator-facing webhook subscription management.
 * Supports: list, create, update, delete, deliveryHistory, test.
 *
 * Max 5 subscriptions per user; URLs are SSRF-checked on create/update.
 */

import crypto from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { webhookSubscriptions, webhookDeliveryHistory } from "../../drizzle/schema";
import { assertSafeExternalUrlAsync, SsrfBlockedError } from "../_core/ssrfGuard";
import { dispatchWebhookEvent, deliverDirectToSubscription } from "../services/webhookDispatcher";

const MAX_WEBHOOKS_PER_USER = 5;
export const VALID_WEBHOOK_EVENTS = ["video.completed", "video.failed"] as const;
type ValidEvent = (typeof VALID_WEBHOOK_EVENTS)[number];

const EventsSchema = z.array(z.enum(VALID_WEBHOOK_EVENTS)).min(1).max(VALID_WEBHOOK_EVENTS.length);

async function assertSafeUrl(url: string): Promise<void> {
  try {
    await assertSafeExternalUrlAsync(url);
  } catch (err) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: err instanceof SsrfBlockedError ? `URL 被封鎖：${err.message}` : "無效的 URL",
    });
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "資料庫暫時無法使用" });
  return db;
}

export const webhookRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db
      .select({
        id: webhookSubscriptions.id,
        url: webhookSubscriptions.url,
        events: webhookSubscriptions.events,
        active: webhookSubscriptions.active,
        createdAt: webhookSubscriptions.createdAt,
      })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, ctx.user.id));
  }),

  create: protectedProcedure
    .input(
      z.object({
        url: z.string().url().max(2048),
        events: EventsSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertSafeUrl(input.url);

      const db = await requireDb();

      const existing = await db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.userId, ctx.user.id));

      if (existing.length >= MAX_WEBHOOKS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `最多可登錄 ${MAX_WEBHOOKS_PER_USER} 個 webhook`,
        });
      }

      const secret = crypto.randomBytes(32).toString("hex");

      const result = await db.insert(webhookSubscriptions).values({
        userId: ctx.user.id,
        url: input.url,
        events: input.events as ValidEvent[],
        secret,
        active: true,
      });

      return { id: (result as any)[0]?.insertId ?? null, secret };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        url: z.string().url().max(2048).optional(),
        events: EventsSchema.optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      const [existing] = await db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id))
        );

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook 不存在" });
      }

      if (input.url !== undefined) await assertSafeUrl(input.url);

      const updates: Partial<{
        url: string;
        events: string[];
        active: boolean;
      }> = {};
      if (input.url !== undefined) updates.url = input.url;
      if (input.events !== undefined) updates.events = input.events as ValidEvent[];
      if (input.active !== undefined) updates.active = input.active;

      if (Object.keys(updates).length > 0) {
        await db
          .update(webhookSubscriptions)
          .set(updates)
          .where(
            and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id))
          );
      }

      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      const [existing] = await db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id))
        );

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook 不存在" });
      }

      await db
        .delete(webhookSubscriptions)
        .where(
          and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id))
        );

      return { ok: true };
    }),

  deliveryHistory: protectedProcedure
    .input(z.object({ subscriptionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();

      const [sub] = await db
        .select({ id: webhookSubscriptions.id })
        .from(webhookSubscriptions)
        .where(
          and(
            eq(webhookSubscriptions.id, input.subscriptionId),
            eq(webhookSubscriptions.userId, ctx.user.id)
          )
        );

      if (!sub) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook 不存在" });
      }

      return db
        .select()
        .from(webhookDeliveryHistory)
        .where(eq(webhookDeliveryHistory.subscriptionId, input.subscriptionId))
        .orderBy(desc(webhookDeliveryHistory.createdAt))
        .limit(50);
    }),

  test: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();

      const [sub] = await db
        .select({
          id: webhookSubscriptions.id,
          url: webhookSubscriptions.url,
          secret: webhookSubscriptions.secret,
          events: webhookSubscriptions.events,
          active: webhookSubscriptions.active,
        })
        .from(webhookSubscriptions)
        .where(
          and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id))
        );

      if (!sub) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Webhook 不存在" });
      }

      void deliverDirectToSubscription(sub, "video.completed", {
        test: true,
        jobId: 0,
        message: "這是測試 webhook 事件，用於驗證 URL 是否可正常接收通知",
      });

      return { ok: true };
    }),
});
