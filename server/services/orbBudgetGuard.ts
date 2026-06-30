/**
 * orbBudgetGuard.ts — AIDV-124 月度 AI 預算硬性閘門
 *
 * 設計：
 *   - decideBudget()：純決策邏輯，無副作用，可單元測試。
 *   - checkMonthlyBudget()：查詢 cost_aggregations 當月 SUM，呼叫 decideBudget。
 *   - enforceMonthlyBudgetGate()：閘門入口；旗標 OFF → 直接返回；超限 → 丟 TRPCError。
 *
 * 旗標 ENABLE_ORB_BUDGET_GUARD 預設 OFF。
 * 原因：硬阻擋在月花費破上限當下擋掉全站 AI 請求，風險高；
 * 需要由 Bruce 明確設 ENABLE_ORB_BUDGET_GUARD=true 才啟用。
 *
 * 啟用方式（Railway）：
 *   ENABLE_ORB_BUDGET_GUARD=true
 *   AI_MONTHLY_BUDGET_USD=<你的上限，如 300>
 */

import { TRPCError } from "@trpc/server";
import { sql, gte } from "drizzle-orm";
import { getDb } from "../db.js";
import { costAggregations } from "../../drizzle/schema.js";
import { serverEnv } from "../_core/env.validated.js";

// ─── Pure decision logic (testable without DB) ───────────────────────────────

export interface BudgetDecision {
  allowed: boolean;
  currentMonthSpendUsd: number;
  monthlyBudgetUsd: number;
  remainingUsd: number;
  reason?: string;
}

/**
 * decideBudget — pure function; no I/O.
 * @param currentSpendUsd Month-to-date spend in USD.
 * @param monthlyBudgetUsd Budget ceiling. 0 or negative → no limit (allowed=true).
 */
export function decideBudget(
  currentSpendUsd: number,
  monthlyBudgetUsd: number,
): BudgetDecision {
  if (monthlyBudgetUsd <= 0) {
    return {
      allowed: true,
      currentMonthSpendUsd: currentSpendUsd,
      monthlyBudgetUsd,
      remainingUsd: Infinity,
    };
  }

  const remainingUsd = monthlyBudgetUsd - currentSpendUsd;
  const allowed = remainingUsd > 0;

  return {
    allowed,
    currentMonthSpendUsd: currentSpendUsd,
    monthlyBudgetUsd,
    remainingUsd,
    ...(allowed
      ? undefined
      : {
          reason: `月度 AI 預算已用盡（$${currentSpendUsd.toFixed(2)} / $${monthlyBudgetUsd.toFixed(2)}）。請聯絡管理員調整上限。`,
        }),
  };
}

// ─── DB query ────────────────────────────────────────────────────────────────

export async function checkMonthlyBudget(): Promise<BudgetDecision> {
  const monthlyBudgetUsd = Number(serverEnv.AI_MONTHLY_BUDGET_USD || 500);
  const db = await getDb();

  if (!db) {
    // DB 不可用時放行（fail-open），避免阻斷服務
    return { allowed: true, currentMonthSpendUsd: 0, monthlyBudgetUsd, remainingUsd: monthlyBudgetUsd };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [row] = await db
    .select({ totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)` })
    .from(costAggregations)
    .where(gte(costAggregations.date, monthStart));

  const currentSpend = Number(row?.totalCost ?? 0);
  return decideBudget(currentSpend, monthlyBudgetUsd);
}

// ─── Gate (throws on budget exceeded) ────────────────────────────────────────

/**
 * enforceMonthlyBudgetGate — call at the top of any LLM handler.
 *
 * Does nothing (returns) when:
 *   - ENABLE_ORB_BUDGET_GUARD is not "true"
 *   - Budget has remaining capacity
 *   - DB is unavailable (fail-open)
 *
 * Throws TRPCError(TOO_MANY_REQUESTS) when budget is exhausted and flag is ON.
 */
export async function enforceMonthlyBudgetGate(): Promise<void> {
  const flagRaw = serverEnv.ENABLE_ORB_BUDGET_GUARD ?? "false";
  const enabled = ["true", "1", "yes", "on"].includes(flagRaw.trim().toLowerCase());
  if (!enabled) return;

  const decision = await checkMonthlyBudget();
  if (!decision.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: decision.reason ?? "月度 AI 預算已用盡。",
    });
  }
}
