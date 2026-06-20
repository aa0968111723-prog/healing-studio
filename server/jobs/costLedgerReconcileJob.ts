/**
 * costLedgerReconcileJob.ts — AIDV-153 成本帳本對帳 job（基礎版：先偵測不自動修）
 * ──────────────────────────────────────────────────────────────────────────
 * 比對兩套帳：
 *   (A) cost_ledger 的 posted debit 總額（append-only 雙分錄帳本，AIDV-153）
 *   (B) cost_aggregations 的 totalCostUsd 總額（SUM(ai_usage_events.costUsd)，AIDV-14）
 * 兩者應一致（ledger debit 並行於 aggregations 寫入，同一筆 usage 成本）。差額即
 * drift，記 log 告警（Slack/console）——基礎版「只偵測、不自動修」，修復策略待 Bruce
 * 拍板。
 *
 * HARD SAFETY：
 *   - 旗標 ENABLE_COST_LEDGER OFF（cost_ledger 空表）→ ledgerSum=0；drift＝
 *     -aggregations（即「ledger 尚未啟用」的預期差），此時 job 仍只 log、不動任何
 *     資料。為避免 OFF 期間刷告警，OFF 時直接 skip（return）。
 *   - 無 db（demo/無 DB）→ skip。
 *   - 永不寫入/修改任何帳目（純讀比對）。
 *
 * 與 apiUsageAlertJob 同骨架（cron + isRunning 鎖 + 1h 去重）。掛進 _core/index.ts
 * 的 SCHEDULED_MAINTENANCE_JOBS。
 */
import * as cron from "node-cron";
import { getDb } from "../db.js";
import { serverEnv } from "../_core/env.validated";
import { costLedger, costAggregations } from "../../drizzle/schema.js";
import { sql, eq, and } from "drizzle-orm";
import { isCostLedgerEnabled } from "../services/cost/ledger";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

// 對帳差異容忍門檻（USD）——浮點/捨入雜訊不算 drift。
const DRIFT_EPSILON_USD = 0.000001;

// 去重：同一 drift 告警每小時最多觸發一次。
const driftDedup = new Map<string, number>();
const DEDUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 告警去重：同一 key 在 DEDUP_INTERVAL_MS（1h）內最多觸發一次。匯出供測試驗證
 * 「1 小時內第二次不重複告警」。
 */
export function shouldAlert(key: string): boolean {
  const last = driftDedup.get(key);
  if (last && Date.now() - last < DEDUP_INTERVAL_MS) return false;
  driftDedup.set(key, Date.now());
  return true;
}

/** 測試輔助：清空去重狀態（讓各測試彼此獨立）。 */
export function _resetAlertDedup(): void {
  driftDedup.clear();
}

async function sendSlackAlert(message: string): Promise<void> {
  const webhookUrl = serverEnv.ALERT_SLACK_WEBHOOK;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `📒 [Cost Ledger Reconcile] ${message}` }),
    });
  } catch (err) {
    console.warn("[CostLedgerReconcile] Slack send failed:", err);
  }
}

/**
 * 純函式：計算 drift（ledger 與 aggregations 的差）。抽出可單測。
 * drift = ledgerPostedDebit - aggregationsTotalCost。
 * |drift| <= epsilon 視為一致（hasDrift=false）。
 */
export function computeDrift(
  ledgerPostedDebit: number,
  aggregationsTotalCost: number,
  epsilon = DRIFT_EPSILON_USD
): { drift: number; hasDrift: boolean } {
  const drift = Number((ledgerPostedDebit - aggregationsTotalCost).toFixed(6));
  return { drift, hasDrift: Math.abs(drift) > epsilon };
}

/**
 * 對帳結果型別（runReconcile 與可注入薄殼 reconcileWith 共用）。
 */
export type ReconcileResult = {
  status: "ok" | "drift" | "skipped";
  ledgerSum?: number;
  aggregationsSum?: number;
  drift?: number;
};

/**
 * 可注入、可單測的對帳薄殼：給定已取好的兩個 SUM（ledger posted debit 與
 * aggregations 同窗總額），算 drift、決定 status、去重後告警。把「取數的 SQL」與
 * 「比對/告警邏輯」分離，使 drift 偵測路徑可用 fake 數值完整覆蓋（不需真 DB）。
 *
 * 預期 drift 來源（已知、非異常）——本薄殼只在【同一時間窗】比較以消除其中之一：
 *   (a) 啟用前歷史：aggregations SUM 全時段、ledger 僅旗標啟用後才有列。runReconcile
 *       會把 aggregations 也限縮到 ledger 已寫入的日期窗（見下），消除此結構性差。
 *   (b) normalizeAmount 邊界：ledger 對 costUsd==0 不入帳、>DECIMAL 上限 clamp。
 *       零成本不動 SUM；clamp 僅極端值，屬已知有界差，記在告警訊息供人判讀。
 */
export function reconcileWith(
  ledgerSum: number,
  aggregationsSum: number
): { result: ReconcileResult; alert: string | null } {
  const { drift, hasDrift } = computeDrift(ledgerSum, aggregationsSum);
  if (hasDrift) {
    const msg = `drift 偵測：ledger(posted debit)=${ledgerSum.toFixed(6)} vs aggregations(同窗)=${aggregationsSum.toFixed(6)}，差額=${drift.toFixed(6)} USD（基礎版只偵測不自動修；已知有界差：clamp/零成本邊界；修復策略待拍板）`;
    return {
      result: { status: "drift", ledgerSum, aggregationsSum, drift },
      alert: msg,
    };
  }
  return {
    result: { status: "ok", ledgerSum, aggregationsSum, drift },
    alert: null,
  };
}

/**
 * 跑一次對帳。基礎版只偵測 + log drift，不修任何資料。
 * 回傳結果物件方便測試（無 db / 旗標 OFF 時回 skipped）。
 */
export async function runReconcile(): Promise<ReconcileResult> {
  if (isRunning) return { status: "skipped" };
  isRunning = true;
  try {
    // 旗標 OFF＝ledger 尚未啟用，跳過對帳（避免空表狂刷 drift 告警）。
    if (!isCostLedgerEnabled()) return { status: "skipped" };

    const db = await getDb();
    if (!db) {
      console.warn("[CostLedgerReconcile] DB not available, skipping");
      return { status: "skipped" };
    }

    // (A) cost_ledger：posted debit 總額（＋ ledger 已寫入的最早日期，作為對帳窗起點）。
    const ledgerRows = await db
      .select({
        total: sql<number>`COALESCE(SUM(${costLedger.amount}), 0)`,
        // ledger 最早一筆的日期（無列時為 NULL）。用來把 aggregations 限縮到同一窗，
        // 消除「啟用前歷史」結構性 drift（aggregations 全時段 vs ledger 僅啟用後）。
        sinceDate: sql<string | null>`DATE(MIN(${costLedger.createdAt}))`,
      })
      .from(costLedger)
      .where(
        and(
          eq(costLedger.status, "posted"),
          eq(costLedger.entryType, "debit")
        )
      );
    const ledgerSum = Number(ledgerRows[0]?.total ?? 0);
    const sinceDate = ledgerRows[0]?.sinceDate ?? null;

    // ledger 尚無任何 posted debit（剛啟用、還沒落帳）→ 無對帳對象，視為一致 skip，
    // 避免拿「ledger=0 vs aggregations=全歷史」狂刷負 drift（首次啟用結構性假 drift）。
    if (!sinceDate) {
      console.log(
        "[CostLedgerReconcile] ledger 尚無 posted debit（啟用後尚未落帳），skip"
      );
      return { status: "skipped" };
    }

    // (B) cost_aggregations：totalCostUsd 總額——【限縮到 ledger 已啟用的日期窗】
    // （date >= ledger 最早日），與 ledger 同窗比較才是 apples-to-apples。
    const aggRows = await db
      .select({
        total: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
      })
      .from(costAggregations)
      .where(sql`${costAggregations.date} >= ${sinceDate}`);
    const aggregationsSum = Number(aggRows[0]?.total ?? 0);

    const { result, alert } = reconcileWith(ledgerSum, aggregationsSum);

    if (alert) {
      console.warn(`[CostLedgerReconcile] ${alert}`);
      if (shouldAlert("ledger-vs-aggregations")) await sendSlackAlert(alert);
    } else {
      console.log(
        `[CostLedgerReconcile] OK — ledger=${ledgerSum.toFixed(6)} aggregations(同窗)=${aggregationsSum.toFixed(6)}（一致）`
      );
    }
    return result;
  } catch (err) {
    console.error("[CostLedgerReconcile] Reconcile error:", err);
    return { status: "skipped" };
  } finally {
    isRunning = false;
  }
}

// ─── Cron Lifecycle ──────────────────────────────────────────────────────────

export function initCostLedgerReconcileCron(): void {
  if (cronTask) return;
  console.log("[CostLedgerReconcile] Initializing cron (every 30 min)");
  cronTask = cron.schedule("*/30 * * * *", () => {
    runReconcile().catch(err =>
      console.error("[CostLedgerReconcile] Cron error:", err)
    );
  });
}

export function stopCostLedgerReconcileCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[CostLedgerReconcile] Cron stopped");
  }
}
