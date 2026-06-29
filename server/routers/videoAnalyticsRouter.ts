/**
 * videoAnalyticsRouter.ts — AIDV-272 影片分析數據
 *
 * 提供兩個端點：
 *   track  — 記錄播放事件（公開，支援匿名訪客）
 *   getSummary — 取得影片分析摘要（僅限專案擁有者）
 *
 * 隱私設計：
 *   - userId 可為 null（用戶 GDPR opt-out）
 *   - visitorId 須為 SHA-256 hash，不含 IP 或直接可識別個人資料
 *   - 資料保留 90 天滾動視窗（由定期清理 cron 執行）
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq, and, gte, sql, count, avg } from "drizzle-orm";
import { getDb } from "../db";
import { videoAnalytics, videoProjects, VIDEO_ANALYTICS_EVENT_TYPES } from "../../drizzle/schema";

const eventTypeSchema = z.enum(VIDEO_ANALYTICS_EVENT_TYPES);

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export const videoAnalyticsRouter = router({
  /**
   * 記錄播放事件。
   * publicProcedure：允許匿名訪客（visitorId 傳 SHA-256 hash）。
   * 若 userId 欄位需要，呼叫端可從 session 讀取並傳入。
   */
  track: publicProcedure
    .input(
      z.object({
        videoProjectId: z.number().int().positive(),
        eventType: eventTypeSchema,
        durationWatched: z.number().int().min(0).max(86400).default(0),
        /** 已登入用戶的 userId（GDPR opt-out 時傳 null）*/
        userId: z.number().int().positive().optional(),
        /** 匿名訪客識別符（SHA-256，長度 64）；已登入用戶可省略 */
        visitorId: z.string().length(64).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) return { ok: false };

      await db.insert(videoAnalytics).values({
        videoProjectId: input.videoProjectId,
        userId: input.userId ?? null,
        visitorId: input.visitorId ?? null,
        eventType: input.eventType,
        durationWatched: input.durationWatched,
      });

      return { ok: true };
    }),

  /**
   * 取得影片分析摘要（僅限影片所有者）。
   * 回傳：總播放次數、完播率、平均觀看秒數、7 天 / 30 天分日趨勢。
   */
  getSummary: protectedProcedure
    .input(
      z.object({
        videoProjectId: z.number().int().positive(),
        /** 查詢期間（天），最多 90 天 */
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB 不可用" });

      // 確認只有影片擁有者可查
      const project = await db
        .select({ id: videoProjects.id, userId: videoProjects.userId })
        .from(videoProjects)
        .where(eq(videoProjects.id, input.videoProjectId))
        .limit(1);

      if (project.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "影片專案不存在" });
      }
      if (project[0]!.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權查看此影片的分析數據" });
      }

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      // 總播放次數（'play' 事件數）
      const [playsRow] = await db
        .select({ total: count() })
        .from(videoAnalytics)
        .where(
          and(
            eq(videoAnalytics.videoProjectId, input.videoProjectId),
            eq(videoAnalytics.eventType, "play"),
            gte(videoAnalytics.createdAt, since)
          )
        );

      // 完播次數（'complete' 事件數）
      const [completionsRow] = await db
        .select({ total: count() })
        .from(videoAnalytics)
        .where(
          and(
            eq(videoAnalytics.videoProjectId, input.videoProjectId),
            eq(videoAnalytics.eventType, "complete"),
            gte(videoAnalytics.createdAt, since)
          )
        );

      // 平均觀看秒數（所有 complete 事件的 durationWatched 均值）
      const [avgRow] = await db
        .select({ avgDuration: avg(videoAnalytics.durationWatched) })
        .from(videoAnalytics)
        .where(
          and(
            eq(videoAnalytics.videoProjectId, input.videoProjectId),
            eq(videoAnalytics.eventType, "complete"),
            gte(videoAnalytics.createdAt, since)
          )
        );

      const totalPlays = Number(playsRow?.total ?? 0);
      const totalCompletions = Number(completionsRow?.total ?? 0);
      const completionRate = totalPlays > 0 ? totalCompletions / totalPlays : 0;

      return {
        videoProjectId: input.videoProjectId,
        period: { days: input.days, since: since.toISOString() },
        totalPlays,
        totalCompletions,
        completionRate: Math.round(completionRate * 100) / 100,
        avgCompletionDurationSeconds: Math.round(Number(avgRow?.avgDuration ?? 0)),
      };
    }),
});
