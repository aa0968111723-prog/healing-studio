/**
 * credentialExpiryAlertJob.ts — 外部服務憑證到期預警（AIDV-68 M5）
 *
 * 每日 09:00 UTC 掃描 data_source_connections.expiresAt，
 * 對 30 天內即將到期且尚未警告過（或警告距今 >=7 天）的連接寫入 console.warn。
 * 服務層掛好後可改成 email / SSE / DB 通知；目前 server log 足夠讓 Railway
 * 的 log alert 攔截並轉給 Bruce。
 */

import * as cron from "node-cron";
import { getDb } from "../db.js";
import { dataSourceConnections } from "../../drizzle/schema.js";
import { and, isNotNull, lt, or, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

const WARN_HORIZON_DAYS = 30;
const REWARN_COOLDOWN_DAYS = 7;

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

export async function executeCredentialExpiryAlertTick(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const db = await getDb();
    if (!db) return;

    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + WARN_HORIZON_DAYS);

    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - REWARN_COOLDOWN_DAYS);

    // Connections expiring within 30 days where we haven't warned in the last 7 days
    const expiring = await db
      .select({
        id: dataSourceConnections.id,
        ownerUserId: dataSourceConnections.ownerUserId,
        provider: dataSourceConnections.provider,
        kind: dataSourceConnections.kind,
        expiresAt: dataSourceConnections.expiresAt,
      })
      .from(dataSourceConnections)
      .where(
        and(
          isNotNull(dataSourceConnections.expiresAt),
          lt(dataSourceConnections.expiresAt, horizonDate),
          or(
            isNull(dataSourceConnections.expireWarnedAt),
            lt(dataSourceConnections.expireWarnedAt, cooldownDate)
          )
        )
      );

    if (expiring.length === 0) return;

    const nowForUpdate = new Date();
    for (const conn of expiring) {
      const daysLeft = conn.expiresAt
        ? Math.ceil(
            (conn.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      console.warn(
        `[CredentialExpiry] ⚠️  userId=${conn.ownerUserId} 的 ${conn.kind}/${conn.provider}` +
          ` (id=${conn.id}) 將在 ${daysLeft} 天後到期（${conn.expiresAt?.toISOString()}）`
      );

      // Stamp expireWarnedAt to prevent repeat warnings within cooldown window
      await db
        .update(dataSourceConnections)
        .set({ expireWarnedAt: nowForUpdate })
        .where(sql`${dataSourceConnections.id} = ${conn.id}`);
    }

    console.log(
      `[CredentialExpiry] ✅ 已警告 ${expiring.length} 個即將到期的外部服務連接`
    );
  } catch (err) {
    console.error("[CredentialExpiry] ❌ 到期掃描失敗:", err);
  } finally {
    isRunning = false;
  }
}

export function initCredentialExpiryAlertCron(): void {
  if (cronTask) return;
  console.log("[CredentialExpiry] Initializing cron (daily at 09:00 UTC)");
  cronTask = cron.schedule("0 9 * * *", () => {
    void executeCredentialExpiryAlertTick();
  });
}

export function stopCredentialExpiryAlertCron(): void {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
}
