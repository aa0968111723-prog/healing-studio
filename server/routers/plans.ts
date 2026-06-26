import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Subscription Plans ───────────────────────────────────────────────────────

export const plansRouter = router({
  list: publicProcedure.query(async () => {
    return db.getActivePlans();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getPlanById(input.id);
    }),
});
