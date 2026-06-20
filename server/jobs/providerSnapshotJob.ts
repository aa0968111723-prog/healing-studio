/**
 * providerSnapshotJob.ts — 每 15 分鐘輪詢 AI 供應商配額/餘額，寫入快照 + 聚合費用
 *
 * 支援供應商：fal.ai、Gemini、ElevenLabs、Suno
 * 同時將近期 ai_usage_events 聚合至 cost_aggregations
 */

import * as cron from "node-cron";
import { getDb } from "../db.js";
import { serverEnv } from "../_core/env.validated.js";
import {
  providerSnapshots,
  aiUsageEvents,
  costAggregations,
  AI_PROVIDERS,
} from "../../drizzle/schema.js";
import { sql, eq, gte, and } from "drizzle-orm";
import { getTwdPerUsd } from "../services/cost/costAttribution.js";
import { usdToTwd } from "../../shared/currency.js";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

// ─── Provider Polling ────────────────────────────────────────────────────────

async function pollElevenLabs(): Promise<{
  tier?: string;
  quota?: number;
  remaining?: number;
  balanceUsd?: number;
  nextInvoice?: { amountUsd?: number; dueDate?: string };
  extraData?: Record<string, unknown>;
}> {
  const key = serverEnv.ELEVENLABS_API_KEY;
  if (!key) return {};

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) {
      console.warn(`[ProviderSnapshot] ElevenLabs API returned ${res.status}`);
      return {};
    }
    const data = await res.json() as Record<string, unknown>;
    return {
      tier: String(data.tier ?? ""),
      quota: Number(data.character_limit ?? 0),
      remaining: Number(data.character_limit ?? 0) - Number(data.character_count ?? 0),
      nextInvoice: data.next_invoice
        ? { amountUsd: Number((data.next_invoice as Record<string, unknown>).amount_due_cents ?? 0) / 100 }
        : undefined,
      extraData: {
        character_count: data.character_count,
        character_limit: data.character_limit,
      },
    };
  } catch (err) {
    console.warn("[ProviderSnapshot] ElevenLabs poll failed:", err);
    return {};
  }
}

async function pollSuno(): Promise<{
  remaining?: number;
  quota?: number;
  extraData?: Record<string, unknown>;
}> {
  const key = serverEnv.SUNO_API_KEY;
  if (!key) return {};

  try {
    const res = await fetch("https://api.sunoapi.org/api/v1/generate/credit", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn(`[ProviderSnapshot] Suno API returned ${res.status}`);
      return {};
    }
    const data = await res.json() as Record<string, unknown>;
    const credits = Number(data.credits ?? data.remaining ?? 0);
    return {
      remaining: credits,
      quota: credits,
      extraData: data,
    };
  } catch (err) {
    console.warn("[ProviderSnapshot] Suno poll failed:", err);
    return {};
  }
}

// ─── Snapshot + Aggregation Logic ────────────────────────────────────────────

async function runSnapshotAndAggregation(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const db = await getDb();
    if (!db) {
      console.warn("[ProviderSnapshot] DB not available, skipping");
      return;
    }

    // 1) Poll each provider and write snapshot
    for (const provider of AI_PROVIDERS) {
      try {
        let snapshotData: {
          tier?: string;
          quota?: number;
          remaining?: number;
          balanceUsd?: number;
          nextInvoice?: { amountUsd?: number; dueDate?: string };
          extraData?: Record<string, unknown>;
        } = {};

        if (provider === "elevenlabs") {
          snapshotData = await pollElevenLabs();
        } else if (provider === "suno") {
          snapshotData = await pollSuno();
        } else if (provider === "fal_ai") {
          // TODO: Implement fal.ai usage API polling when pricing/estimate endpoint is available
          snapshotData = {
            tier: "pay-as-you-go",
            extraData: { note: "fal.ai usage tracked via proxy gateway" },
          };
        } else if (provider === "gemini") {
          // TODO: Implement GCP Cloud Billing API polling for Gemini costs
          snapshotData = {
            tier: "pay-as-you-go",
            extraData: { note: "Gemini usage tracked via GCP billing" },
          };
        }

        await db.insert(providerSnapshots).values({
          provider,
          tier: snapshotData.tier ?? null,
          quota: snapshotData.quota?.toString() ?? null,
          remaining: snapshotData.remaining?.toString() ?? null,
          balanceUsd: snapshotData.balanceUsd?.toString() ?? null,
          nextInvoice: snapshotData.nextInvoice ?? null,
          extraData: snapshotData.extraData ?? null,
        });

        console.log(`[ProviderSnapshot] ${provider} snapshot saved`);
      } catch (err) {
        console.warn(`[ProviderSnapshot] ${provider} snapshot failed:`, err);
      }
    }

    // 2) Aggregate recent usage events into cost_aggregations
    try {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);

      // AIDV-14：當下生效匯率（TWD_PER_USD→USD_TO_TWD_RATE→default），落帳當下凍結
      // 寫入 exchangeRate 欄位以利稽核回溯；totalCostTwd = totalCostUsd × rate。
      const twdRate = getTwdPerUsd();

      // Get today's events grouped by provider + endpoint
      const aggregated = await db
        .select({
          provider: aiUsageEvents.provider,
          endpoint: aiUsageEvents.endpoint,
          callCount: sql<number>`COUNT(*)`,
          totalUnits: sql<number>`COALESCE(SUM(${aiUsageEvents.units}), 0)`,
          totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)`,
        })
        .from(aiUsageEvents)
        .where(gte(aiUsageEvents.createdAt, todayDate))
        .groupBy(aiUsageEvents.provider, aiUsageEvents.endpoint);

      for (const row of aggregated) {
        // AIDV-14：真實價（SUM(costUsd)）→ TWD 凍結換算。$0.00 根因（#924 前 costUsd
        // 硬編 "0"）已上游修掉；此處只負責把真實 USD 彙總成 TWD 呈現。
        const totalCostTwd = usdToTwd(Number(row.totalCostUsd), twdRate);

        // Upsert: try update first, insert if not exists
        const existing = await db
          .select()
          .from(costAggregations)
          .where(
            and(
              eq(costAggregations.provider, row.provider),
              eq(costAggregations.endpoint, row.endpoint),
              eq(costAggregations.date, todayDate)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(costAggregations)
            .set({
              callCount: Number(row.callCount),
              totalUnits: String(row.totalUnits),
              totalCostUsd: String(row.totalCostUsd),
              totalCostTwd: totalCostTwd.toFixed(4),
              exchangeRate: twdRate.toFixed(6),
            })
            .where(eq(costAggregations.id, existing[0].id));
        } else {
          await db.insert(costAggregations).values({
            provider: row.provider,
            endpoint: row.endpoint,
            date: todayDate,
            callCount: Number(row.callCount),
            totalUnits: String(row.totalUnits),
            totalCostUsd: String(row.totalCostUsd),
            totalCostTwd: totalCostTwd.toFixed(4),
            exchangeRate: twdRate.toFixed(6),
          });
        }
      }

      console.log(`[ProviderSnapshot] Cost aggregation done (${aggregated.length} groups)`);
    } catch (err) {
      console.warn("[ProviderSnapshot] Cost aggregation failed:", err);
    }
  } finally {
    isRunning = false;
  }
}

// ─── Cron Lifecycle ──────────────────────────────────────────────────────────

export function initProviderSnapshotCron(): void {
  if (cronTask) return;
  console.log("[ProviderSnapshot] Initializing cron (every 15 min)");
  cronTask = cron.schedule("*/15 * * * *", () => {
    runSnapshotAndAggregation().catch(err =>
      console.error("[ProviderSnapshot] Cron error:", err)
    );
  });
}

export function stopProviderSnapshotCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[ProviderSnapshot] Cron stopped");
  }
}
