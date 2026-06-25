/**
 * apiUsageAlertJob.ts — 每 15 分鐘檢查 AI API 用量告警
 *
 * 三種告警類型：
 *   1. 預算告警：當日費用 > 月預算 × (日/月天數) × 1.3
 *   2. 配額告警：provider remaining < 20% 或 < 5%
 *   3. 異常告警：近 1h 錯誤率 > 5%
 *
 * 告警輸出：Slack webhook + console log
 * 去重：同類告警每小時最多觸發一次
 */

import * as cron from "node-cron";
import { getDb } from "../db.js";
import { serverEnv } from "../_core/env.validated";
import {
  providerSnapshots,
  costAggregations,
  aiUsageEvents,
  alertConfigs,
  AI_PROVIDERS,
} from "../../drizzle/schema.js";
import { sql, gte, desc, eq } from "drizzle-orm";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

// ─── Alert dedup (in-memory, cleared each hour) ─────────────────────────────
const alertDedup = new Map<string, number>(); // key → last triggered timestamp
const DEDUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function shouldAlert(key: string): boolean {
  const last = alertDedup.get(key);
  if (last && Date.now() - last < DEDUP_INTERVAL_MS) return false;
  alertDedup.set(key, Date.now());
  return true;
}

// ─── Alert Channels ──────────────────────────────────────────────────────────

async function sendSlackAlert(message: string): Promise<void> {
  const webhookUrl = serverEnv.ALERT_SLACK_WEBHOOK;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🚨 [Healing Studio API Alert] ${message}` }),
    });
  } catch (err) {
    console.warn("[ApiUsageAlert] Slack send failed:", err);
  }
}

async function fireAlert(alertKey: string, message: string): Promise<void> {
  if (!shouldAlert(alertKey)) return;
  console.warn(`[ApiUsageAlert] ${message}`);
  await sendSlackAlert(message);
}

// ─── Alert Checks ────────────────────────────────────────────────────────────

async function checkBudgetAlert(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const monthlyBudget = Number(serverEnv.AI_MONTHLY_BUDGET_USD || 500);
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [result] = await db
    .select({
      totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
    })
    .from(costAggregations)
    .where(gte(costAggregations.date, monthStart));

  const totalCost = Number(result?.totalCost ?? 0);
  const expectedPace = (monthlyBudget * dayOfMonth) / daysInMonth;
  const threshold = expectedPace * 1.3;

  if (totalCost > threshold) {
    await fireAlert(
      "budget",
      `Budget alert: Month-to-date spend $${totalCost.toFixed(2)} exceeds ` +
        `130% of expected pace ($${threshold.toFixed(2)}) for monthly budget $${monthlyBudget}`
    );
  }
}

async function checkQuotaAlerts(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  for (const provider of AI_PROVIDERS) {
    const [snapshot] = await db
      .select()
      .from(providerSnapshots)
      .where(eq(providerSnapshots.provider, provider))
      .orderBy(desc(providerSnapshots.snapshotAt))
      .limit(1);

    if (!snapshot || !snapshot.quota || Number(snapshot.quota) === 0) continue;

    const quota = Number(snapshot.quota);
    const remaining = Number(snapshot.remaining ?? 0);
    const pct = (remaining / quota) * 100;

    if (pct < 5) {
      await fireAlert(
        `quota-critical-${provider}`,
        `Quota CRITICAL: ${provider} has only ${pct.toFixed(1)}% remaining (${remaining}/${quota})`
      );
    } else if (pct < 20) {
      await fireAlert(
        `quota-warning-${provider}`,
        `Quota WARNING: ${provider} has ${pct.toFixed(1)}% remaining (${remaining}/${quota})`
      );
    }
  }
}

async function checkAnomalyAlerts(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [stats] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      errors: sql<number>`SUM(CASE WHEN ${aiUsageEvents.status} != 'success' THEN 1 ELSE 0 END)`,
    })
    .from(aiUsageEvents)
    .where(gte(aiUsageEvents.createdAt, oneHourAgo));

  const total = Number(stats?.total ?? 0);
  const errors = Number(stats?.errors ?? 0);

  if (total > 0) {
    const errorRate = (errors / total) * 100;
    if (errorRate > 5) {
      await fireAlert(
        "anomaly-error-rate",
        `Error rate anomaly: ${errorRate.toFixed(1)}% error rate in last hour (${errors}/${total} calls)`
      );
    }
  }
}

// ─── DB-Configured Alert Evaluation ─────────────────────────────────────────
// Evaluates user-created alertConfigs rows, fires alerts when thresholds are
// exceeded, and stamps lastTriggeredAt for dedup (re-fires after 1h).

async function evaluateDbAlertConfigs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const configs = await db
    .select()
    .from(alertConfigs)
    .where(eq(alertConfigs.isActive, true));

  if (configs.length === 0) return;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [mtdRow] = await db
    .select({ totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)` })
    .from(costAggregations)
    .where(gte(costAggregations.date, monthStart));
  const mtdCost = Number(mtdRow?.totalCost ?? 0);

  for (const cfg of configs) {
    if (cfg.lastTriggeredAt && cfg.lastTriggeredAt > oneHourAgo) continue;

    let triggered = false;
    let message = "";

    if (cfg.alertType === "budget" && cfg.monthlyBudgetUsd) {
      const budget = Number(cfg.monthlyBudgetUsd);
      const thresholdPct = Number(cfg.thresholdPct ?? 80);
      if (budget > 0 && mtdCost >= budget * (thresholdPct / 100)) {
        triggered = true;
        message = `Budget alert (cfg #${cfg.id}): MTD $${mtdCost.toFixed(2)} ≥ ${thresholdPct}% of $${budget}/mo limit`;
      }
    } else if (cfg.alertType === "quota" && cfg.provider) {
      const [snapshot] = await db
        .select()
        .from(providerSnapshots)
        .where(eq(providerSnapshots.provider, cfg.provider as (typeof AI_PROVIDERS)[number]))
        .orderBy(desc(providerSnapshots.snapshotAt))
        .limit(1);
      if (snapshot && snapshot.quota && Number(snapshot.quota) > 0) {
        const pct = (Number(snapshot.remaining ?? 0) / Number(snapshot.quota)) * 100;
        const threshold = Number(cfg.thresholdPct ?? 20);
        if (pct <= threshold) {
          triggered = true;
          message = `Quota alert (cfg #${cfg.id}): ${cfg.provider} at ${pct.toFixed(1)}% ≤ threshold ${threshold}%`;
        }
      }
    } else if (cfg.alertType === "anomaly") {
      const [stats] = await db
        .select({
          total: sql<number>`COUNT(*)`,
          errors: sql<number>`SUM(CASE WHEN ${aiUsageEvents.status} != 'success' THEN 1 ELSE 0 END)`,
        })
        .from(aiUsageEvents)
        .where(gte(aiUsageEvents.createdAt, oneHourAgo));
      const total = Number(stats?.total ?? 0);
      if (total > 0) {
        const errorRate = (Number(stats?.errors ?? 0) / total) * 100;
        const threshold = Number(cfg.thresholdPct ?? 5);
        if (errorRate >= threshold) {
          triggered = true;
          message = `Anomaly alert (cfg #${cfg.id}): ${errorRate.toFixed(1)}% error rate ≥ threshold ${threshold}%`;
        }
      }
    }

    if (triggered) {
      console.warn(`[ApiUsageAlert] ${message}`);
      await sendSlackAlert(message);
      await db.update(alertConfigs).set({ lastTriggeredAt: now }).where(eq(alertConfigs.id, cfg.id));
    }
  }
}

// ─── Main Run ────────────────────────────────────────────────────────────────

async function runAlertChecks(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    await checkBudgetAlert();
    await checkQuotaAlerts();
    await checkAnomalyAlerts();
    await evaluateDbAlertConfigs();
  } catch (err) {
    console.error("[ApiUsageAlert] Alert check error:", err);
  } finally {
    isRunning = false;
  }
}

// ─── Cron Lifecycle ──────────────────────────────────────────────────────────

export function initApiUsageAlertCron(): void {
  if (cronTask) return;
  console.log("[ApiUsageAlert] Initializing cron (every 15 min)");
  cronTask = cron.schedule("*/15 * * * *", () => {
    runAlertChecks().catch(err =>
      console.error("[ApiUsageAlert] Cron error:", err)
    );
  });
}

export function stopApiUsageAlertCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[ApiUsageAlert] Cron stopped");
  }
}
