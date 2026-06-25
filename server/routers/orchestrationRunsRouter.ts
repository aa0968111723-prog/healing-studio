import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { orchestrationRuns } from "../../drizzle/schema";

const LIST_LIMIT = 20;

export const orchestrationRunsRouter = router({
  /**
   * Recent runs for the current user, newest first.
   * Read-only — no mutations in Phase 1 (唯讀版起步 AIDV-49).
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const limit = input?.limit ?? LIST_LIMIT;
      const conditions = [eq(orchestrationRuns.userId, ctx.user.id)];
      if (input?.projectId != null) {
        conditions.push(eq(orchestrationRuns.projectId, input.projectId));
      }
      const rows = await db
        .select()
        .from(orchestrationRuns)
        .where(and(...conditions))
        .orderBy(desc(orchestrationRuns.createdAt))
        .limit(limit);
      return { runs: rows };
    }),

  /**
   * Single run by ID — user-scoped (IDOR-safe).
   */
  get: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db
        .select()
        .from(orchestrationRuns)
        .where(
          and(
            eq(orchestrationRuns.id, input.id),
            eq(orchestrationRuns.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      return row;
    }),
});

export type OrchestrationRunsRouter = typeof orchestrationRunsRouter;
