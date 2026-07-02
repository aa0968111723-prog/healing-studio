/**
 * providerSnapshotJob.ts — 每 15 分鐘輪詢 AI 供應商配額/餘額，寫入快照 + 聚合費用
 *
 * 支援供應商：fal.ai、Gemini、ElevenLabs、Suno
 * 同時將近期 ai_usage_events 聚合至 cost_aggregations
 *
 * 精度分級（AIDV-194/AIDV-561）：
 *   - elevenlabs / suno：供應商 API 權威值（quota/remaining/invoice）。
 *   - fal_ai / gemini：無可輪詢的權威帳單 API（需外部金鑰，out-of-scope），
 *     快照為「目錄單價×用量」估算值，extraData 標 estimated=true / reconciled=false。
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

/** 單一供應商快照資料（providerSnapshots 一列的欄位子集）。 */
export interface SnapshotData {
  tier?: string;
  quota?: number;
  remaining?: number;
  balanceUsd?: number;
  nextInvoice?: { amountUsd?: number; dueDate?: string };
  extraData?: Record<string, unknown>;
}

// ─── Provider Polling ────────────────────────────────────────────────────────

async function pollElevenLabs(): Promise<SnapshotData> {
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

// ─── fal.ai / Gemini：目錄單價×用量估算快照（AIDV-194 / AIDV-561）─────────────
//
// 這兩家沒有可直接輪詢的餘額/配額 API（fal usage endpoint、GCP Cloud Billing API
// 皆需額外金鑰/憑證，明確 out-of-scope，見 AIDV-194）。取代原本寫死的占位 note，
// 改為聚合當日 ai_usage_events（其 costUsd 已由 AIDV-14 的
// costSource=provider/catalog 管線落實：目錄真實單位價 × 實際用量）產生
// 「估算快照」，並在 extraData 誠實標記 estimated=true / reconciled=false，
// 讓 admin 端可區分「估算值」與 elevenlabs/suno 的「供應商權威值」。
//
// HARD SAFETY：
//   - 不寫 balanceUsd / quota / remaining（那些欄位語意上是供應商權威數字，
//     估算值不冒充，apiUsageAlertJob 的配額告警行為不受影響）。
//   - 聚合查詢失敗 → 回退到與舊版等價的占位快照（estimateAvailable=false），
//     job 不崩、不中斷其他供應商輪詢。
//   - 不碰任何扣款/餘額計算；純呈現層透明化。

/** 當日用量聚合結果（來自 ai_usage_events）。 */
export interface UsageEstimate {
  callCount: number;
  totalUnits: number;
  totalCostUsd: number;
}

const ESTIMATED_PROVIDER_NOTES: Record<"fal_ai" | "gemini", string> = {
  fal_ai: "fal.ai usage tracked via proxy gateway",
  gemini: "Gemini usage tracked via GCP billing",
};

/** 夾成非負有限數；NaN/Infinity/負值一律 0（估算值絕不出現離譜數字）。 */
function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * pure：把當日用量聚合組裝成「估算快照」。
 *
 * - usage 為 null（DB 聚合失敗/不可得）→ 回與舊占位等價的快照，
 *   但仍標 estimated=true / estimateAvailable=false（誠實：這兩家永遠不是權威值）。
 * - usage 可得 → 附 windowStart 與當日 callCount / totalUnits / costUsd（六位小數字串，
 *   與 costUsd DECIMAL(12,6) 同 scale）。
 */
export function buildEstimatedUsageSnapshot(
  provider: "fal_ai" | "gemini",
  usage: UsageEstimate | null,
  windowStart: Date,
): SnapshotData {
  const base: Record<string, unknown> = {
    // 誠實標記：此快照為估算值，無供應商權威帳單對帳（AIDV-194 out-of-scope）。
    estimated: true,
    reconciled: false,
    estimateBasis:
      "ai_usage_events 聚合（costUsd＝目錄真實單位價×實際用量，costSource=provider/catalog，AIDV-14）",
    note: ESTIMATED_PROVIDER_NOTES[provider],
  };

  if (!usage) {
    return {
      tier: "pay-as-you-go",
      extraData: { ...base, estimateAvailable: false },
    };
  }

  return {
    tier: "pay-as-you-go",
    extraData: {
      ...base,
      estimateAvailable: true,
      windowStart: windowStart.toISOString(),
      todayCallCount: Math.round(clampNonNegative(usage.callCount)),
      todayTotalUnits: clampNonNegative(usage.totalUnits),
      todayCostUsd: clampNonNegative(usage.totalCostUsd).toFixed(6),
    },
  };
}

/** 聚合某供應商「今日（本地零點起）」的 ai_usage_events；失敗回 null（fail-open）。 */
async function pollUsageEstimate(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  provider: "fal_ai" | "gemini",
  windowStart: Date,
): Promise<UsageEstimate | null> {
  try {
    const [row] = await db
      .select({
        callCount: sql<number>`COUNT(*)`,
        totalUnits: sql<number>`COALESCE(SUM(${aiUsageEvents.units}), 0)`,
        totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)`,
      })
      .from(aiUsageEvents)
      .where(
        and(
          eq(aiUsageEvents.provider, provider),
          gte(aiUsageEvents.createdAt, windowStart)
        )
      );
    if (!row) return { callCount: 0, totalUnits: 0, totalCostUsd: 0 };
    return {
      callCount: Number(row.callCount ?? 0),
      totalUnits: Number(row.totalUnits ?? 0),
      totalCostUsd: Number(row.totalCostUsd ?? 0),
    };
  } catch (err) {
    console.warn(`[ProviderSnapshot] ${provider} usage estimate failed:`, err);
    return null;
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

    // 快照的「今日」窗口：本地零點起（與下方 cost aggregation 的 todayDate 同口徑）。
    const estimateWindowStart = new Date();
    estimateWindowStart.setHours(0, 0, 0, 0);

    // 1) Poll each provider and write snapshot
    for (const provider of AI_PROVIDERS) {
      try {
        let snapshotData: SnapshotData = {};

        if (provider === "elevenlabs") {
          snapshotData = await pollElevenLabs();
        } else if (provider === "suno") {
          snapshotData = await pollSuno();
        } else if (provider === "fal_ai" || provider === "gemini") {
          // AIDV-194/AIDV-561：無供應商權威 API（外部金鑰 out-of-scope）→
          // 以當日 ai_usage_events（目錄單價×用量）產生估算快照，標 estimated。
          const usage = await pollUsageEstimate(db, provider, estimateWindowStart);
          snapshotData = buildEstimatedUsageSnapshot(provider, usage, estimateWindowStart);
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
