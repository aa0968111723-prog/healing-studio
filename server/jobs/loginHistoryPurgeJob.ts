import * as cron from "node-cron";
import { loginHistoryService } from "../services/auth/loginHistoryService";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

async function executeLoginHistoryPurgeTick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const deleted = await loginHistoryService.cleanupOldHistory(90);
    if (deleted > 0) {
      console.log(`[LoginHistoryPurge] ✅ Purged ${deleted} login_history records older than 90 days`);
    }
  } catch (error) {
    console.error("[LoginHistoryPurge] ❌ Purge failed:", error);
  } finally {
    isRunning = false;
  }
}

export function initLoginHistoryPurgeCron() {
  if (cronTask) return;
  console.log("[LoginHistoryPurge] Initializing cron (daily at 03:00 UTC)");
  cronTask = cron.schedule("0 3 * * *", () => {
    void executeLoginHistoryPurgeTick();
  });
}

export function stopLoginHistoryPurgeCron() {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
}
