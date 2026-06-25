import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getUserWorkflow, upsertUserWorkflow } from "../db";

const workflowStepSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(128),
  required: z.boolean(),
  enabled: z.boolean(),
  canvasMode: z.string().max(64).optional(),
  pending: z.boolean().optional(),
});

export const workflowRouter = router({
  /** 取得使用者已儲存的工作流步驟；無記錄回 null（前端 fallback 到 freshDefaultWorkflow）。 */
  getDefault: protectedProcedure.query(async ({ ctx }) => {
    const row = await getUserWorkflow(ctx.user.id);
    return { stepsJson: row?.stepsJson ?? null };
  }),

  /** 整批覆寫使用者工作流步驟（upsert）。 */
  save: protectedProcedure
    .input(z.object({ steps: z.array(workflowStepSchema).max(20) }))
    .mutation(async ({ ctx, input }) => {
      await upsertUserWorkflow(ctx.user.id, input.steps);
      return { success: true };
    }),
});
