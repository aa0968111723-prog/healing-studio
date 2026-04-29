import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getScheduledJob,
  isValidCronExpression,
  listScheduledJobs,
  runScheduledOrbJob,
  scheduleOrbJob,
  setOrbJobEnabled,
  unscheduleOrbJob,
} from "../services/orbScheduler";
import { nextFireTimes } from "../services/cronPreview";

const OrbScheduleInput = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
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
      // Block id collisions across users so user A can't update user B's job
      // by reusing their id.
      const existing = getScheduledJob(input.id);
      if (existing && existing.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "此 ID 已被其他使用者使用，請換一個",
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

  /**
   * Pause / resume a schedule without deleting the row. Useful when the user
   * wants to mute a job during a holiday but keep its config.
   */
  setEnabled: protectedProcedure
    .input(
      z.object({
        jobId: z.string().min(1).max(128),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = getScheduledJob(input.jobId);
      if (existing && existing.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你沒有權限修改此排程",
        });
      }
      const updated = await setOrbJobEnabled(input.jobId, input.enabled);
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到此排程",
        });
      }
      if (updated.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你沒有權限修改此排程",
        });
      }
      return { success: true, enabled: updated.enabled } as const;
    }),

  /**
   * Run a scheduled job once, immediately, on demand. Lets users smoke-test
   * a job they just created without waiting for the next cron tick.
   */
  runNow: protectedProcedure
    .input(z.object({ jobId: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const job = getScheduledJob(input.jobId);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此排程" });
      }
      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你沒有權限執行此排程",
        });
      }
      // Fire-and-forget: runScheduledOrbJob already catches every error and
      // persists lastError, so we return as soon as the run is queued.
      void runScheduledOrbJob(job);
      return { success: true } as const;
    }),

  listJobs: protectedProcedure.query(({ ctx }) => listScheduledJobs(ctx.user.id)),

  /**
   * Live preview the next 3 fire times for a cron expression so the user
   * can sanity-check before saving. Stateless — does not touch the DB or
   * the in-memory registry.
   */
  previewCron: protectedProcedure
    .input(
      z.object({
        cronExpression: z.string().min(1).max(128),
        count: z.number().int().min(1).max(10).default(3),
      })
    )
    .query(({ input }): {
      ok: boolean;
      nextRuns: string[];
      error?: string;
    } => {
      if (!isValidCronExpression(input.cronExpression)) {
        return {
          ok: false,
          nextRuns: [],
          error: "無效的 cron 表達式",
        };
      }
      const result = nextFireTimes(input.cronExpression, input.count);
      return {
        ok: result.ok,
        nextRuns: result.nextRuns.map(d => d.toISOString()),
        error: result.error,
      };
    }),
});
