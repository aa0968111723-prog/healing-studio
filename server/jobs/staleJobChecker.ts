/**
 * staleJobChecker.ts — AIDV-332 代理容錯機制：DLQ + stale job 自動恢復
 *
 * 每 1 分鐘掃描 background_jobs 表中狀態為 processing 且超過 5 分鐘未更新的任務。
 * - retryCount < 3：重新排隊（queued），遞增 retryCount
 * - retryCount >= 3：標記為 failed，透過 SSE 廣播 job_failed 讓前端感知
 *
 * 涵蓋 jobType：image / video / audio / voice（model_training 有自己的 worker）
 */

import * as cron from "node-cron";
import { getStuckJobsByType, updateBackgroundJob } from "../db.js";
import { generationBus } from "../generationEvents.js";
import { getRedisClient } from "../_core/redisClient.js";

const DLQ_KEY = "dlq:video_jobs";

// ─── 常數 ────────────────────────────────────────────────────────────────────

const STUCK_MINUTES = 5;
const MAX_RETRIES = 3;
const STALE_JOB_TYPES = ["video", "audio", "image", "voice"] as const;

// ─── State ───────────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

// ─── Types ───────────────────────────────────────────────────────────────────

interface StaleJobResultJson {
  retryCount?: number;
  [key: string]: unknown;
}

// ─── Logger ──────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", msg: string): void {
  const icon = level === "info" ? "✅" : level === "warn" ? "⚠️" : "❌";
  console[level](`[StaleJobChecker] ${icon} ${msg}`);
}

// ─── Core logic ──────────────────────────────────────────────────────────────

export async function checkStaleJobs(): Promise<void> {
  for (const jobType of STALE_JOB_TYPES) {
    const stuckJobs = await getStuckJobsByType(jobType, STUCK_MINUTES, 10);
    if (stuckJobs.length === 0) continue;

    log("warn", `發現 ${stuckJobs.length} 個卡住的 ${jobType} 任務`);

    for (const job of stuckJobs) {
      try {
        const resultJson = (job.resultJson ?? {}) as StaleJobResultJson;
        const retryCount = typeof resultJson.retryCount === "number" ? resultJson.retryCount : 0;

        if (retryCount < MAX_RETRIES) {
          const newCount = retryCount + 1;
          await updateBackgroundJob(job.id, {
            status: "queued",
            resultJson: { ...resultJson, retryCount: newCount },
            progressMessage: `自動恢復：第 ${newCount} 次重試`,
          });
          log("info", `任務 #${job.id}（${jobType}）重新排隊，第 ${newCount}/${MAX_RETRIES} 次重試`);
        } else {
          await updateBackgroundJob(job.id, {
            status: "failed",
            errorMessage: `stale timeout：已重試 ${MAX_RETRIES} 次仍卡住`,
          });
          generationBus.emit(job.id, {
            type: "error",
            message: `job_failed: stale timeout after ${MAX_RETRIES} retries`,
          });
          const redis = getRedisClient();
          if (redis) {
            const dlqEntry = JSON.stringify({
              jobId: job.id,
              jobType,
              failedAt: new Date().toISOString(),
              reason: `stale_timeout:retries_exhausted`,
            });
            redis.lpush(DLQ_KEY, dlqEntry).catch(() => {});
          }
          log("error", `任務 #${job.id}（${jobType}）超過 ${MAX_RETRIES} 次重試，標記 failed 並廣播 SSE`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log("error", `處理卡住任務 #${job.id} 時發生錯誤：${msg}`);
      }
    }
  }
}

// ─── Cron registration ───────────────────────────────────────────────────────

export function initStaleJobCheckerCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule("* * * * *", async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await checkStaleJobs();
    } finally {
      isRunning = false;
    }
  });
  log("info", "Stale job checker 已啟動（每 1 分鐘掃描）");
}

export function stopStaleJobCheckerCron(): void {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
  log("info", "Stale job checker 已停止");
}
