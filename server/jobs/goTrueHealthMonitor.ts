/**
 * goTrueHealthMonitor.ts — AIDV-352: GoTrue Auth 服務健康監控
 *
 * 每 60 秒探測 GoTrue /auth/v1/health，連續 2 次失敗時透過 Slack 告警。
 * 服務恢復時自動發送恢復通知。告警每 10 分鐘最多觸發一次（去重）。
 *
 * 背景：AIDV-350 確認 2026-06-21 51 秒內發生兩次連鎖重啟；本監控可在
 * 重啟事件發生時即時感知，而非等待用戶回報才發現 Auth 不可用。
 */

import * as cron from "node-cron";
import { serverEnv } from "../_core/env.validated.js";

const CHECK_INTERVAL_CRON = "* * * * *"; // 每分鐘
const CONSECUTIVE_FAILURES_THRESHOLD = 2;
const ALERT_DEDUP_MS = 10 * 60 * 1000; // 10 分鐘
const FETCH_TIMEOUT_MS = 8_000;

let cronTask: cron.ScheduledTask | null = null;
let consecutiveFailures = 0;
let lastAlertTs = 0;
let wasUnhealthy = false;

export function getGoTrueHealthState() {
  return { consecutiveFailures, wasUnhealthy };
}

async function sendSlackAlert(message: string): Promise<void> {
  const webhookUrl = serverEnv.ALERT_SLACK_WEBHOOK;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        text: `🚨 [Healing Studio GoTrue] ${message}`,
      }),
    });
  } catch {
    // Slack 失敗不影響監控本身
  }
}

async function checkGoTrueHealth(): Promise<void> {
  const supabaseUrl = serverEnv.SUPABASE_URL;
  if (!supabaseUrl) return;

  const healthUrl = `${supabaseUrl}/auth/v1/health`;

  try {
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.ok) {
      if (wasUnhealthy) {
        const msg = `GoTrue Auth 服務恢復正常（連續失敗 ${consecutiveFailures} 次後恢復）`;
        console.info(`[GoTrueHealthMonitor] ${msg}`);
        await sendSlackAlert(`✅ ${msg}`);
        wasUnhealthy = false;
      }
      consecutiveFailures = 0;
      return;
    }

    consecutiveFailures++;
    console.warn(
      `[GoTrueHealthMonitor][AIDV-352] GoTrue health check failed: HTTP ${res.status} (consecutive: ${consecutiveFailures})`
    );
  } catch (err) {
    consecutiveFailures++;
    console.warn(
      `[GoTrueHealthMonitor][AIDV-352] GoTrue health check error (consecutive: ${consecutiveFailures}):`,
      err
    );
  }

  if (consecutiveFailures >= CONSECUTIVE_FAILURES_THRESHOLD) {
    wasUnhealthy = true;
    const now = Date.now();
    if (now - lastAlertTs > ALERT_DEDUP_MS) {
      lastAlertTs = now;
      const msg =
        `GoTrue Auth 服務不可用（連續 ${consecutiveFailures} 次失敗）。` +
        `可能為連鎖重啟或配置熱更新循環（AIDV-350/352）。` +
        `請檢查 Railway → Auth 服務日誌，並確認 GOTRUE_JWT_ADMIN_GROUP_NAME / DEFAULT_GROUP_NAME 已從 Railway 刪除。`;
      console.error(`[GoTrueHealthMonitor][AIDV-352] ${msg}`);
      await sendSlackAlert(msg);
    }
  }
}

export function initGoTrueHealthMonitorCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule(CHECK_INTERVAL_CRON, () => {
    checkGoTrueHealth().catch(err => {
      console.error("[GoTrueHealthMonitor] Unexpected error in cron tick:", err);
    });
  });
  console.info("[GoTrueHealthMonitor] Auth health monitor started (every 60s)");
}

export function stopGoTrueHealthMonitorCron(): void {
  cronTask?.stop();
  cronTask = null;
}
