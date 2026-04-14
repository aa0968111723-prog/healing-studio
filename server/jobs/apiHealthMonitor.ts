/**
 * apiHealthMonitor.ts — API 健康巡檢背景任務
 *
 * 每 3 分鐘執行一次：
 *   1. 對所有已知 API provider 發出健康探測
 *   2. 對不健康的引擎嘗試自動修復（備援切換）
 *   3. 無法自動修復時產生管理員警報
 *   4. 每小時自動執行一次精準度抽測
 *
 * 模式：仿照 modelTrainingWorker.ts 的 cron + CircuitBreaker + dedup lock
 */

import * as cron from "node-cron";
import { CircuitBreaker } from "./circuitBreaker.js";
import { runHealthPatrol, runAllAccuracyTests } from "../services/brainAutoRepair.js";

// ─── State ──────────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

// Circuit Breaker — stop hammering if our own monitoring fails repeatedly
const monitorBreaker = new CircuitBreaker("ApiHealthMonitor", {
  failureThreshold: 5,
  cooldownMs: 5 * 60_000, // 5 minutes cooldown
});

// Deduplication lock
let isRunning = false;

// Counter for hourly accuracy tests
let tickCount = 0;
const ACCURACY_TEST_INTERVAL = 20; // every 20 ticks = ~60 min (3min * 20)

// ─── Core ───────────────────────────────────────────────────────────────────

async function runMonitorCycle(): Promise<void> {
  if (isRunning) {
    console.log("[ApiHealthMonitor] ⏭️  Previous cycle still running, skipping.");
    return;
  }
  if (!monitorBreaker.canExecute()) {
    console.warn("[ApiHealthMonitor] 🔴 Circuit breaker OPEN, skipping cycle.");
    return;
  }

  isRunning = true;

  try {
    // Health patrol
    const result = await runHealthPatrol();
    monitorBreaker.recordSuccess();

    if (result.alerts > 0) {
      console.warn(
        `[ApiHealthMonitor] ⚠️  巡檢完成：checked=${result.checked}, alerts=${result.alerts}`
      );
    } else {
      console.log(
        `[ApiHealthMonitor] ✅ 巡檢完成：checked=${result.checked}, 全部正常`
      );
    }

    // Periodic accuracy tests (every ~60 min)
    tickCount++;
    if (tickCount >= ACCURACY_TEST_INTERVAL) {
      tickCount = 0;
      console.log("[ApiHealthMonitor] 🎯 開始精準度抽測...");
      try {
        const tests = await runAllAccuracyTests();
        const avgScore = tests.length > 0
          ? Math.round(tests.reduce((s, t) => s + t.score, 0) / tests.length)
          : 0;
        console.log(
          `[ApiHealthMonitor] 🎯 精準度抽測完成：${tests.length} 項，平均分數 ${avgScore}/100`
        );
      } catch (testErr) {
        console.warn("[ApiHealthMonitor] 精準度抽測失敗:", testErr);
      }
    }
  } catch (err) {
    monitorBreaker.recordFailure();
    console.error(
      "[ApiHealthMonitor] 🔴 巡檢失敗:",
      err instanceof Error ? err.message : err
    );
  } finally {
    isRunning = false;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * 啟動 API 健康巡檢 cron（每 3 分鐘）。
 * 首次執行延遲 30 秒，避免啟動時與其他 cron 衝突。
 */
export function initApiHealthMonitorCron(): void {
  if (cronTask) {
    console.warn("[ApiHealthMonitor] Cron already initialized, skipping.");
    return;
  }

  // Delayed first run
  setTimeout(() => {
    runMonitorCycle().catch((e) =>
      console.error("[ApiHealthMonitor] Initial run error:", e)
    );
  }, 30_000);

  // Schedule: every 3 minutes
  cronTask = cron.schedule("*/3 * * * *", () => {
    runMonitorCycle().catch((e) =>
      console.error("[ApiHealthMonitor] Cron error:", e)
    );
  });

  console.log("[ApiHealthMonitor] ✅ Cron initialized (every 3 min)");
}

/**
 * 停止 cron 任務。
 */
export function stopApiHealthMonitorCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[ApiHealthMonitor] 🛑 Cron stopped");
  }
}
