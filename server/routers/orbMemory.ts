import { z } from "zod";
import { router, brainProcedure, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Orb Memory (orb_feedback events) ────────────────────────────────────────

export const orbMemoryRouter = router({
  append: brainProcedure
    .input(
      z.object({
        status: z.enum([
          "accepted",
          "edited",
          "cancelled",
          "completed",
          "failed",
        ]),
        actionType: z.string().max(32),
        pageId: z.string().max(64).optional(),
        note: z.string().max(512).optional(),
        actionSummary: z.string().max(256).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await db.appendOrbFeedback({
        userId: ctx.user.id,
        status: input.status,
        actionType: input.actionType,
        pageId: input.pageId ?? null,
        note: input.note ?? null,
        actionSummary: input.actionSummary ?? null,
      });
      return { ok: true as const };
    }),

  recent: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const rows = await db.getRecentOrbFeedback(
        ctx.user.id,
        input?.limit ?? 20
      );
      return rows.map(r => ({
        id: r.id,
        at: r.createdAt.getTime(),
        status: r.status,
        actionType: r.actionType,
        note: r.note ?? undefined,
        pageId: r.pageId ?? undefined,
        actionSummary: r.actionSummary ?? undefined,
      }));
    }),

  delete: brainProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const deleted = await db.deleteOrbFeedbackEvent(ctx.user.id, input.id);
      return { ok: deleted > 0, deleted };
    }),

  clear: brainProcedure
    .input(
      z
        .object({
          pageId: z.string().max(64).optional(),
          actionType: z.string().max(32).optional(),
          beforeAt: z.number().int().optional(),
        })
        .optional()
    )
    .mutation(async ({ input, ctx }) => {
      const deleted = await db.clearOrbFeedbackEvents(ctx.user.id, {
        pageId: input?.pageId,
        actionType: input?.actionType,
        beforeAt: input?.beforeAt ? new Date(input.beforeAt) : undefined,
      });
      return { ok: true as const, deleted };
    }),
});
