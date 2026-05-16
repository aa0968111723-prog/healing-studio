import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { orbScheduledJobs } from "../../drizzle/schema";
import {
  getScheduledJob,
  isValidCronExpression,
  listScheduledJobs,
  runScheduledOrbJob,
  scheduleOrbJob,
  setOrbJobEnabled,
  unscheduleOrbJob,
} from "../services/orbScheduler";
import {
  describeCron,
  formatRelativeFromNow,
  formatTaipeiLabel,
  nextFireTimes,
  SCHEDULER_TIMEZONE,
} from "../services/cronPreview";

interface NextRunMeta {
  iso: string;
  label: string;
  relative: string;
}

function computeNextRun(cronExpression: string, now: Date): NextRunMeta | null {
  if (!isValidCronExpression(cronExpression)) return null;
  const result = nextFireTimes(cronExpression, 1, now);
  if (!result.ok || result.nextRuns.length === 0) return null;
  const d = result.nextRuns[0];
  return {
    iso: d.toISOString(),
    label: formatTaipeiLabel(d),
    relative: formatRelativeFromNow(d, now),
  };
}

const OrbScheduleInput = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._:-]+$/, "ID 只能包含英數、'.'、'_'、':'、'-'"),
  // Validate cron syntax at the schema layer so invalid expressions are
  // rejected at the tRPC boundary regardless of which procedure receives
  // them. The procedure-level fallback (line ~54) becomes a defence-in-
  // depth guard rather than the only check.
  cronExpression: z
    .string()
    .min(1)
    .max(128)
    .refine(isValidCronExpression, "無效的 cron 表達式"),
  taskDescription: z.string().min(1).max(1024),
  enabled: z.boolean().default(true),
});

// H3 修復:per-user job cap。沒有上限的話一個帳號可建上千條 1 分鐘 cron
// 把 Node main thread 跑滿(每條 job 內含 LLM 呼叫 + DB 寫入)。
// 50 條已足夠一般「每天提醒 / 每週整理」之類用途,異常多就是 DoS 嫌疑。
// 數字對齊 orbConversationsRouter.ts:31 的 MAX_CONVERSATIONS_PER_USER。
const MAX_JOBS_PER_USER = 50;

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
      // Per-user 上限檢查。只在「新增」(existing 為 undefined)時擋,既有
      // job 的 update 不擋 — 否則 disable→enable / 改 cron 都會卡住。
      // 即使 existing 在 memory registry 沒有,DB 還是可能有(restart 後
      // 還沒重灌記憶體),getOwnedJobs 走 in-memory list 是近似而非精確;
      // 拒絕的代價只是「使用者要先刪一條再加」,寬鬆 1-2 條不致命。
      if (!existing) {
        const owned = listScheduledJobs(ctx.user.id);
        if (owned.length >= MAX_JOBS_PER_USER) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `已達排程上限（${MAX_JOBS_PER_USER}），請先刪除或停用舊排程後再新增。`,
          });
        }
      }
      // After a server restart the in-memory registry hasn't been rebuilt
      // yet for jobs that won't fire soon, so `getScheduledJob` can return
      // undefined for an id that actually belongs to another tenant in the
      // DB. Without this check `persistJob` would happily run
      // `.onDuplicateKeyUpdate` and OVERWRITE the rightful owner's
      // `userId`, hijacking the job. Look up the persisted row before we
      // touch it.
      if (!existing) {
        try {
          const db = await getDb();
          if (db) {
            const rows = await db
              .select({ userId: orbScheduledJobs.userId })
              .from(orbScheduledJobs)
              .where(eq(orbScheduledJobs.id, input.id))
              .limit(1);
            const persisted = rows[0];
            if (persisted && persisted.userId !== ctx.user.id) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "此 ID 已被其他使用者使用，請換一個",
              });
            }
          }
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          // Other DB errors (missing table on first boot, transient
          // outages) — log and fall through to the schedule attempt, since
          // the existing scheduleOrbJob path is already defensive.
          console.warn(
            "[OrbScheduler] scheduleJob ownership pre-check failed:",
            error instanceof Error ? error.message : error
          );
        }
      }
      try {
        await scheduleOrbJob({ ...input, userId: ctx.user.id });
      } catch (error) {
        // L13:server-side log 完整 error,user message 只回通用文案,不
        // 把 DB / drizzle 原始錯誤(可能含 connection string / 表名)洩
        // 漏給 client。極端罕見:scheduleOrbJob 本身就丟人類可讀的中文
        // 訊息(例如「cron 表達式無效」),但保險起見一律重寫。
        console.error(
          "[OrbScheduler] scheduleJob failed:",
          error instanceof Error ? error.message : error
        );
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "建立排程失敗,請稍後再試",
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
      // Pass the caller's userId through to the service so the DB-lookup
      // fallback (used when the in-memory registry hasn't been rebuilt
      // yet) refuses to mutate cross-tenant rows. Without this, calling
      // setEnabled with another tenant's jobId would silently flip their
      // job's enabled flag before the post-update userId check fired.
      const updated = await setOrbJobEnabled(
        input.jobId,
        input.enabled,
        ctx.user.id
      );
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到此排程",
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

  /**
   * List the current user's scheduled jobs, enriched with the next planned
   * fire time (in Asia/Taipei) and a plain-Chinese description of the cron
   * expression so the panel can show "下次執行：05/04（週一）下午 09:00 ·
   * 還有 4 小時 32 分" without doing any TZ math on the client.
   */
  listJobs: protectedProcedure.query(({ ctx }) => {
    const now = new Date();
    return listScheduledJobs(ctx.user.id).map(job => ({
      ...job,
      cronDescription: describeCron(job.cronExpression),
      nextRun: job.enabled ? computeNextRun(job.cronExpression, now) : null,
    }));
  }),

  /**
   * Live preview the next N fire times for a cron expression so the user
   * can sanity-check before saving. Stateless — does not touch the DB or
   * the in-memory registry.
   *
   * The cron expression is interpreted as Asia/Taipei wall-clock time
   * (matches what the actual scheduler uses), and the response carries
   * pre-formatted Taiwan strings so the client doesn't have to do any
   * timezone math itself.
   */
  previewCron: protectedProcedure
    .input(
      z.object({
        // No `.refine(isValidCronExpression)` here on purpose: previewCron
        // is the live-typing inline-validation endpoint. The handler
        // already returns a structured `{ ok: false, error }` payload
        // for invalid cron, and `CronPreview` renders `data.error` as a
        // red helper message while the user is still typing. Refining
        // at the schema layer would convert that into a tRPC input
        // error, leaving the helper component (which only consumes
        // `query.data`, not `query.error`) silently empty.
        cronExpression: z.string().min(1).max(128),
        count: z.number().int().min(1).max(10).default(3),
      })
    )
    .query(({ input }): {
      ok: boolean;
      timezone: string;
      description: string;
      nextRuns: string[];
      nextRunsLocal: Array<{ iso: string; label: string; relative: string }>;
      error?: string;
    } => {
      if (!isValidCronExpression(input.cronExpression)) {
        return {
          ok: false,
          timezone: SCHEDULER_TIMEZONE,
          description: describeCron(input.cronExpression),
          nextRuns: [],
          nextRunsLocal: [],
          error: "無效的 cron 表達式",
        };
      }
      const result = nextFireTimes(input.cronExpression, input.count);
      const now = new Date();
      return {
        ok: result.ok,
        timezone: SCHEDULER_TIMEZONE,
        description: describeCron(input.cronExpression),
        nextRuns: result.nextRuns.map(d => d.toISOString()),
        nextRunsLocal: result.nextRuns.map(d => ({
          iso: d.toISOString(),
          label: formatTaipeiLabel(d),
          relative: formatRelativeFromNow(d, now),
        })),
        error: result.error,
      };
    }),
});
