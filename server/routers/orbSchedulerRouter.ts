import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  listScheduledJobs,
  scheduleOrbJob,
  unscheduleOrbJob,
} from "../services/orbScheduler";

const OrbScheduleInput = z.object({
  id: z.string().min(1),
  cronExpression: z.string().min(1),
  taskDescription: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const orbSchedulerRouter = router({
  scheduleJob: protectedProcedure
    .input(OrbScheduleInput)
    .mutation(({ ctx, input }) => {
      scheduleOrbJob({ ...input, userId: ctx.user.id });
      return { success: true } as const;
    }),

  unscheduleJob: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      const owned = listScheduledJobs(ctx.user.id).some(job => job.id === input.jobId);
      if (!owned) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你沒有權限取消此排程" });
      }
      unscheduleOrbJob(input.jobId);
      return { success: true } as const;
    }),

  listJobs: protectedProcedure.query(({ ctx }) => listScheduledJobs(ctx.user.id)),
});
