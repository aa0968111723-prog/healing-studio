/**
 * commander / commanderService — M1-B createIntent Skeleton
 * ────────────────────────────────────────────────────────────────────────────
 * 只寫 DB，不呼叫任何外部 AI / 工具 API。
 *
 * 安全：
 *   - 一律以 authenticated userId 操作。
 *   - 帶 projectId 時，必須確認該專案屬於此使用者，否則丟 CommanderAccessError。
 *   - getRun / listRunsByProject 都檢查擁有者。
 */

import {
  createOrchestrationRun,
  getOrchestrationRun,
  getOrchestrationRunsByProject,
  getCreativeProject,
} from "../../db";
import {
  CommanderAccessError,
  type CreateIntentInput,
  type CommanderRunView,
  type OrchestrationMode,
  type OrchestrationStatus,
  type CommanderKind,
} from "./contracts";
import type { OrchestrationRun } from "../../../drizzle/schema";
import { dualEmitForUser } from "../../generationEvents";

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date(0).toISOString()
    : parsed.toISOString();
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toView(row: OrchestrationRun): CommanderRunView {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId ?? null,
    teamId: row.teamId ?? null,
    mode: row.mode as OrchestrationMode,
    intent: row.intent,
    status: row.status as OrchestrationStatus,
    commander: (row.commander as CommanderKind | null) ?? null,
    estimatedCostUsd: toNumberOrNull(row.estimatedCostUsd),
    actualCostUsd: toNumberOrNull(row.actualCostUsd),
    errorMessage: row.errorMessage ?? null,
    hasProjectContext: row.projectId != null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** 確認 projectId 屬於該使用者；不存在或非擁有者 → 丟錯。 */
async function assertProjectOwnership(
  userId: number,
  projectId: number,
): Promise<void> {
  const project = await getCreativeProject(projectId);
  if (!project) {
    throw new CommanderAccessError("not_found", "找不到創作專案");
  }
  if (project.userId !== userId) {
    throw new CommanderAccessError("forbidden", "無權存取此創作專案");
  }
}

/**
 * 建立一次創作意圖紀錄（pending run）。不呼叫任何外部模型。
 *
 * @throws CommanderAccessError 帶了不屬於該使用者的 projectId 時。
 */
export async function createIntent(
  input: CreateIntentInput,
): Promise<CommanderRunView> {
  const projectId = input.projectId ?? null;
  if (projectId != null) {
    await assertProjectOwnership(input.userId, projectId);
  }

  const id = await createOrchestrationRun({
    userId: input.userId,
    projectId,
    teamId: input.teamId ?? null,
    mode: input.mode,
    intent: input.intent,
    status: "pending",
    // 第一版不估算成本；欄位保留 null。
    estimatedCostUsd: null,
  });

  const row = await getOrchestrationRun(id);
  if (!row) {
    // 理論上剛寫入就讀不到極罕見；用 not_found 讓 router 轉成可理解錯誤。
    throw new CommanderAccessError("not_found", "建立後讀取 run 失敗");
  }

  // AIDV-495: 意圖入佇列後立即廣播，讓創作者端 SSE 進入「已排入」狀態。
  try {
    dualEmitForUser(input.userId, {
      type: "task_queued",
      runId: id,
      userId: input.userId,
      intent: input.intent,
      at: Date.now(),
    });
  } catch (_) {
    // fire-and-forget — SSE emit 失敗不能讓 createIntent 失敗
  }

  return toView(row);
}

/**
 * 取得單筆 run（僅限擁有者）。
 *
 * @throws CommanderAccessError 找不到或非擁有者。
 */
export async function getRun(
  userId: number,
  runId: number,
): Promise<CommanderRunView> {
  const row = await getOrchestrationRun(runId);
  if (!row) {
    throw new CommanderAccessError("not_found", "找不到 run");
  }
  if (row.userId !== userId) {
    throw new CommanderAccessError("forbidden", "無權存取此 run");
  }
  return toView(row);
}

/**
 * 列出某專案的 runs（僅限專案擁有者）。
 *
 * @throws CommanderAccessError 專案不存在或非擁有者。
 */
export async function listRunsByProject(
  userId: number,
  projectId: number,
  limit = 50,
): Promise<CommanderRunView[]> {
  await assertProjectOwnership(userId, projectId);
  const rows = await getOrchestrationRunsByProject(projectId, limit);
  return rows.map(toView);
}
