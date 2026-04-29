import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  isValidCronExpression,
  listScheduledJobs,
  scheduleOrbJob,
  unscheduleOrbJob,
} from "../services/orbScheduler";

const OrbScheduleInput = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    // Restrict to a safe id alphabet so accidental whitespace / control chars
    // can't break cron lookups or scheduler logs.
    .regex(/^[A-Za-z0-9._:-]+$/, "ID 只能包含英數、'.'、'_'、':'、'-'"),
  cronExpression: z.string().min(1).max(128),
  taskDescription: z.string().min(1).max(1024),
  enabled: z.boolean().default(true),
});

export const orbSchedulerRouter = router({
  scheduleJob: protectedProcedure
    .input(OrbScheduleInput)
    .mutation(async ({ ctx, input }) => {
      if (!isValidCronExpression(input.cronExpression)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `無效的 cron 表達式：${input.cronExpression}`,
        });
      }
      try {
        await scheduleOrbJob({ ...input, userId: ctx.user.id });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "建立排程失敗，請稍後再試",
        });
      }
      return { success: true } as const;
    }),

  unscheduleJob: protectedProcedure
    .input(z.object({ jobId: z.string().min(1).max(128) }))
    .mutation(({ ctx, input }) => {
      const owned = listScheduledJobs(ctx.user.id).some(
        job => job.id === input.jobId
      );
      if (!owned) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你沒有權限取消此排程",
        });
      }
      unscheduleOrbJob(input.jobId);
      return { success: true } as const;
    }),

  listJobs: protectedProcedure.query(({ ctx }) => listScheduledJobs(ctx.user.id)),
});
