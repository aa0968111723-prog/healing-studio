/**
 * export.ts — 影片匯出路由（AIDV-237）
 *
 * 從已完成的 background_jobs 讀取影片 URL，
 * 供前端直接下載或批次匯出。不依賴 S3/Redis，
 * 直接回傳 fal.ai CDN URL（resultJson.resultUrl）。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

type JobResultJson = {
  resultUrl?: string;
  url?: string;
  video_url?: string;
} | null;

function extractUrl(resultJson: unknown): string | undefined {
  const r = resultJson as JobResultJson;
  return r?.resultUrl ?? r?.url ?? r?.video_url;
}

export const exportRouter = router({
  /** 取得單一已完成 job 的影片 URL */
  getJobUrl: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getBackgroundJob(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任務不存在" });
      if (job.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (job.status !== "completed")
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "影片尚未完成" });
      const url = extractUrl(job.resultJson);
      if (!url) throw new TRPCError({ code: "NOT_FOUND", message: "影片 URL 不存在" });
      return { url, jobId: job.id };
    }),

  /** 批次取得多個已完成 job 的影片 URL（最多 50 筆） */
  getJobUrls: protectedProcedure
    .input(z.object({ jobIds: z.array(z.number().int().positive()).max(50) }))
    .query(async ({ ctx, input }) => {
      // AIDV-651: 一次批次查詢取代逐筆 N+1 await；過濾邏輯與舊版語意完全一致。
      const jobs = await db.getBackgroundJobsByIds(input.jobIds);
      const jobMap = new Map(jobs.map(j => [j.id, j]));
      const items: { jobId: number; url: string }[] = [];
      for (const jobId of input.jobIds) {
        const job = jobMap.get(jobId);
        if (!job || job.userId !== ctx.user.id || job.status !== "completed") continue;
        const url = extractUrl(job.resultJson);
        if (url) items.push({ jobId, url });
      }
      return { items };
    }),
});
