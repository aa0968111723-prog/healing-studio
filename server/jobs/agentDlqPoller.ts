/**
 * agentDlqPoller.ts — AIDV-877 agent_dlq 監控心跳
 *
 * 每 5 分鐘呼叫 pollDlq()，記錄未解決 DLQ 條目數量。
 * 若 escalated > 0 輸出 warn，提示需人工介入。
 * DB 不可用時 pollDlq 自動回傳零計數，完全 fail-open。
 */

import * as cron from "node-cron";
import { pollDlq } from "../services/agentDlq";
import { serverEnv } from "../_core/env.validated";

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

function isFlagEnabled(): boolean {
  const v = serverEnv.ENABLE_AGENT_DLQ ?? "true";
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

function log(level: "info" | "warn" | "error", msg: string): void {
  console[level](`[AgentDlqPoller] ${msg}`);
}

async function runPoll(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await pollDlq();
    const { retried, escalated, decisions } = result;
    if (escalated > 0) {
      log("warn", `未解決 DLQ 條目：escalated=${escalated} retried=${retried} decisions=${decisions} — 需人工介入`);
    } else if (retried > 0 || decisions > 0) {
      log("info", `DLQ 狀態：retried=${retried} decisions=${decisions} escalated=${escalated}`);
    }
  } catch (err: unknown) {
    log("error", `pollDlq 執行失敗：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    isRunning = false;
  }
}

export function initAgentDlqPollerCron(): void {
  if (!isFlagEnabled()) {
    log("info", "ENABLE_AGENT_DLQ=false，跳過 DLQ 監控排程");
    return;
  }
  if (cronTask) return;
  cronTask = cron.schedule("*/5 * * * *", runPoll);
  log("info", "AgentDlqPoller 已啟動（每 5 分鐘輪詢）");
}

export function stopAgentDlqPollerCron(): void {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
  log("info", "AgentDlqPoller 已停止");
}
