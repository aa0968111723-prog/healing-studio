import * as cron from "node-cron";
import { runDueAutoCreditGrant } from "../db";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

async function executeAutoCreditTick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await runDueAutoCreditGrant(500);
    if (result.processedUsers > 0) {
      console.log(
        `[UserAutoCredit] ✅ processed=${result.processedUsers}, granted=${result.totalGranted} pts`
      );
    }
  } catch (error) {
    console.error("[UserAutoCredit] ❌ run failed:", error);
  } finally {
    isRunning = false;
  }
}

export function initUserAutoCreditCron() {
  if (cronTask) return;
  console.log("[UserAutoCredit] Initializing cron (every 15 min)");
  cronTask = cron.schedule("*/15 * * * *", () => {
    void executeAutoCreditTick();
  });

  // Warm run once at boot (non-blocking)
  setTimeout(() => {
    void executeAutoCreditTick();
  }, 15_000);
}

export function stopUserAutoCreditCron() {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
}
