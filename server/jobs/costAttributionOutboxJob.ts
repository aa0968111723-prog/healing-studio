/**
 * costAttributionOutboxJob.ts — AIDV-14 成本歸屬 outbox drain job（不漏帳）
 * ──────────────────────────────────────────────────────────────────────────
 * 定期把 cost_attribution_outbox 的 pending 列重放成 cost_ledger 落帳：成功標 done、
 * 失敗 attempts++ 留 pending（下輪重試）、超上限標 dead。這是「不漏帳」的補帳機制：
 * aiProxy 熱路徑只輕量 enqueue（永不同步等 ledger 寫入），實際落帳由本 job 可靠重放。
 *
 * HARD SAFETY：
 *   - 旗標 ENABLE_COST_ATTRIBUTION OFF → skip（不 drain）。
 *   - 無 db（demo/無 DB）→ skip。
 *   - 永不 throw（cron 包 catch）；冪等鍵確保重送不雙重入帳。
 *
 * 與 costLedgerReconcileJob 同骨架（cron + isRunning 鎖）。掛進 _core 排程清單。
 */
import * as cron from "node-cron";
import { getDb } from "../db.js";
import {
  isCostAttributionEnabled,
  drainAttributionOutbox,
  getTwdPerUsd,
  type OutboxDb,
  type DrainResult,
} from "../services/cost/costAttribution";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * 跑一次 drain。回傳結果方便測試（無 db / 旗標 OFF 時回 skipped）。
 */
export async function runDrain(): Promise<DrainResult> {
  if (isRunning)
    return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };
  isRunning = true;
  try {
    if (!isCostAttributionEnabled())
      return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };

    const db = await getDb();
    if (!db) {
      console.warn("[CostAttributionOutbox] DB not available, skipping");
      return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };
    }

    const rate = getTwdPerUsd();
    const result = await drainAttributionOutbox(db as unknown as OutboxDb, rate);
    if (result.scanned > 0) {
      console.log(
        `[CostAttributionOutbox] drained scanned=${result.scanned} posted=${result.posted} failed=${result.failed} dead=${result.dead}`
      );
    }
    return result;
  } catch (err) {
    console.error("[CostAttributionOutbox] Drain error:", err);
    return { status: "skipped", scanned: 0, posted: 0, failed: 0, dead: 0 };
  } finally {
    isRunning = false;
  }
}

// ─── Cron Lifecycle ──────────────────────────────────────────────────────────

export function initCostAttributionOutboxCron(): void {
  if (cronTask) return;
  console.log("[CostAttributionOutbox] Initializing cron (every 2 min)");
  cronTask = cron.schedule("*/2 * * * *", () => {
    runDrain().catch(err =>
      console.error("[CostAttributionOutbox] Cron error:", err)
    );
  });
}

export function stopCostAttributionOutboxCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[CostAttributionOutbox] Cron stopped");
  }
}
