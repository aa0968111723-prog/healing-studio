/**
 * mediaArchivalCron.ts — 把資產庫裡還沒歸檔的外部 URL 拉回自家儲存的背景掃描。
 *
 * 為什麼存在：
 *   doPostGenComplete 結尾已經 fire-and-forget enqueue 一個歸檔任務，但 process
 *   重啟、enqueue 失敗、或舊資料根本沒走過 doPostGenComplete 流程的 row 都會
 *   留下 archivedAt IS NULL 的外部 URL。AI 提供商的 presigned link 多半 24h ~ 7d
 *   就過期，等到使用者點開「我的資產」就壞圖。
 *
 *   本 cron 每 5 分鐘掃一批未歸檔的 row 補刀，靠 archivedAt 達成 idempotency；
 *   已歸檔 / 並行歸檔中的 row 不會被重複下載。
 *
 * Pattern：仿 teachingArchiveIngestionWorker — node-cron + isWorkerRunning
 * 防止重疊執行 + setTimeout 啟動後早一次掃描讓重啟更快收斂。
 */

import * as cron from "node-cron";
import { runMediaArchival } from "../services/mediaArchivalService";

const SWEEP_SCHEDULE = "*/5 * * * *";
const MAX_BATCH = 20;

let cronTask: cron.ScheduledTask | null = null;
let isWorkerRunning = false;

function logWorker(level: "info" | "warn" | "error", message: string): void {
  const icon = level === "info" ? "✅" : level === "warn" ? "⚠️" : "❌";
  console.log(`${icon} [mediaArchival] ${message}`);
}

export async function runMediaArchivalSweep(): Promise<void> {
  if (isWorkerRunning) {
    logWorker("info", "已有實例運行中，跳過此次排程");
    return;
  }
  isWorkerRunning = true;
  try {
    const result = await runMediaArchival(MAX_BATCH);
    if (result.assets.total === 0 && result.history.total === 0) return;
    logWorker(
      "info",
      `掃描完成 assets=${result.assets.total}/${result.assets.archived} history=${result.history.total}/${result.history.archived}`
    );
  } finally {
    isWorkerRunning = false;
  }
}

export function initMediaArchivalCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule(SWEEP_SCHEDULE, async () => {
    try {
      await runMediaArchivalSweep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `排程執行異常: ${message}`);
    }
  });
  logWorker("info", "媒體歸檔 Worker 排程已註冊 — 每 5 分鐘執行一次");

  setTimeout(async () => {
    try {
      await runMediaArchivalSweep();
    } catch {
      // first-run 異常已在 runner 內 log
    }
  }, 5_000);
}

export function stopMediaArchivalCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logWorker("info", "Worker 排程已停止");
  }
}
