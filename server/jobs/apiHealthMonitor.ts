/**
 * apiHealthMonitor.ts — API 健康巡檢背景任務
 *
 * 支援功能：
 *   1. 對所有已知 API provider 發出健康探測
 *   2. 對不健康的引擎嘗試自動修復（備援切換）
 *   3. 無法自動修復時產生管理員警報
 *   4. 每小時自動執行一次精準度抽測
 *   5. 可透過 API 開關啟用/停用自動除錯
 *   6. 可透過 API 設定巡檢間隔（分鐘）
 *
 * 模式：仿照 modelTrainingWorker.ts 的 cron + CircuitBreaker + dedup lock
 */

import * as cron from "node-cron";
import { CircuitBreaker } from "./circuitBreaker.js";
import {
  runHealthPatrol,
  runAllAccuracyTests,
} from "../services/brainAutoRepair.js";

// ─── Discord Webhook 告警 ────────────────────────────────────────────────────

async function sendDiscordAlert(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // 未設定時靜默跳過
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Healing Studio 健康巡檢",
        content: message,
        embeds: [
          {
            color: 0xff4444, // 紅色警示
            description: message,
            timestamp: new Date().toISOString(),
            footer: { text: "ApiHealthMonitor" },
          },
        ],
      }),
    });
  } catch (err) {
    console.warn("[ApiHealthMonitor] Discord alert failed:", err);
  }
}

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

// ─── Configurable State (開關 + 巡檢間隔) ───────────────────────────────────

/** 是否啟用自動除錯 */
let autoRepairEnabled = true;

/** 巡檢間隔（分鐘），預設 3 分鐘 */
let monitorIntervalMinutes = 3;

// ─── Core ───────────────────────────────────────────────────────────────────

async function runMonitorCycle(): Promise<void> {
  if (!autoRepairEnabled) {
    return;
  }
  if (isRunning) {
    console.log(
      "[ApiHealthMonitor] ⏭️  Previous cycle still running, skipping."
    );
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
      const alertMsg = `⚠️ **Healing Studio API 告警**\n巡檢發現 **${result.alerts}** 個問題（共檢查 ${result.checked} 個服務）\n時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`;
      console.warn(
        `[ApiHealthMonitor] ⚠️  巡檢完成：checked=${result.checked}, alerts=${result.alerts}`
      );
      // 送出 Discord 告警（若設定了 DISCORD_WEBHOOK_URL）
      sendDiscordAlert(alertMsg).catch(() => {});
    } else {
      console.log(
        `[ApiHealthMonitor] ✅ 巡檢完成：checked=${result.checked}, 全部正常`
      );
    }

    // Periodic accuracy tests (every ~60 min)
    tickCount++;
    const accuracyInterval = Math.max(
      1,
      Math.round(60 / monitorIntervalMinutes)
    );
    if (tickCount >= accuracyInterval) {
      tickCount = 0;
      console.log("[ApiHealthMonitor] 🎯 開始精準度抽測...");
      try {
        const tests = await runAllAccuracyTests();
        const avgScore =
          tests.length > 0
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

// ─── Internal: recreate cron with current interval ──────────────────────────

function recreateCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  if (!autoRepairEnabled) {
    console.log(
      "[ApiHealthMonitor] 🔴 Auto-repair disabled, cron not started."
    );
    return;
  }

  const cronExpr = `*/${monitorIntervalMinutes} * * * *`;
  cronTask = cron.schedule(cronExpr, () => {
    runMonitorCycle().catch(e =>
      console.error("[ApiHealthMonitor] Cron error:", e)
    );
  });

  console.log(
    `[ApiHealthMonitor] ✅ Cron re-initialized (every ${monitorIntervalMinutes} min)`
  );
}

// ─── Public API: Toggle & Interval ──────────────────────────────────────────

/**
 * 取得自動除錯設定狀態
 */
export function getAutoRepairConfig(): {
  enabled: boolean;
  intervalMinutes: number;
} {
  return {
    enabled: autoRepairEnabled,
    intervalMinutes: monitorIntervalMinutes,
  };
}

/**
 * 切換自動除錯開關
 */
export function setAutoRepairEnabled(enabled: boolean): {
  enabled: boolean;
  intervalMinutes: number;
} {
  autoRepairEnabled = enabled;
  recreateCron();
  console.log(
    `[ApiHealthMonitor] Auto-repair ${enabled ? "ENABLED ✅" : "DISABLED 🔴"}`
  );
  return getAutoRepairConfig();
}

/**
 * 設定巡檢間隔（分鐘）。有效範圍：1–60 分鐘。
 */
export function setMonitorInterval(minutes: number): {
  enabled: boolean;
  intervalMinutes: number;
} {
  const clamped = Math.max(1, Math.min(60, Math.round(minutes)));
  monitorIntervalMinutes = clamped;
  tickCount = 0; // reset accuracy test counter
  if (autoRepairEnabled) {
    recreateCron();
  }
  console.log(`[ApiHealthMonitor] Monitor interval set to ${clamped} min`);
  return getAutoRepairConfig();
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/**
 * 啟動 API 健康巡檢 cron。
 * 首次執行延遲 30 秒，避免啟動時與其他 cron 衝突。
 */
export function initApiHealthMonitorCron(): void {
  if (cronTask) {
    console.warn("[ApiHealthMonitor] Cron already initialized, skipping.");
    return;
  }

  // Delayed first run
  setTimeout(() => {
    runMonitorCycle().catch(e =>
      console.error("[ApiHealthMonitor] Initial run error:", e)
    );
  }, 30_000);

  // Schedule with current interval
  const cronExpr = `*/${monitorIntervalMinutes} * * * *`;
  cronTask = cron.schedule(cronExpr, () => {
    runMonitorCycle().catch(e =>
      console.error("[ApiHealthMonitor] Cron error:", e)
    );
  });

  console.log(
    `[ApiHealthMonitor] ✅ Cron initialized (every ${monitorIntervalMinutes} min)`
  );
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
