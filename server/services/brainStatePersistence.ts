/**
 * Brain State Persistence
 * ────────────────────────────────────────────────────────────────────────────
 * 把 brainAutoRepair.ts 的 in-memory 狀態（提案、研究結果、測試結果、錯誤線索、
 * 警報、生成記錄）寫到本機 JSON 檔，避免 Railway/Docker 重啟後遺失資料。
 *
 * 設計：
 *  - 寫入路徑：`<cwd>/.brain-state.json`（可由 BRAIN_STATE_FILE 環境變數覆寫）
 *  - 寫入策略：debounced 1.5 秒 — 連續多次 mutation 只觸發一次寫入
 *  - 讀取策略：啟動時同步呼叫 loadStateSync()，失敗（檔案不存在/損壞）時靜默退場
 *  - 容量：最多保留每個陣列各自的 MAX 上限（同 brainAutoRepair）
 *  - 安全：寫入到 .tmp 檔再 rename，避免半寫入損毀
 *
 * 注意：Railway 容器檔案系統會在 redeploy 時被覆寫，但容器存活期間（通常數天到
 * 數週）內持續有效。若需跨 deploy 持久，後續可改用 R2/S3 或 DB。
 */

import { promises as fsPromises } from "fs";
import * as fs from "fs";
import path from "path";

export interface PersistableBrainState {
  apiAlerts?: unknown[];
  errorTraces?: unknown[];
  reflectionProposals?: unknown[];
  webResearchResults?: unknown[];
  accuracyTests?: unknown[];
  generationLogs?: unknown[];
  lastScanResult?: unknown;
  savedAt: number;
}

function getStateFilePath(): string {
  return process.env.BRAIN_STATE_FILE
    ? path.resolve(process.env.BRAIN_STATE_FILE)
    : path.resolve(process.cwd(), ".brain-state.json");
}

/** 測試環境（NODE_ENV=test 或 BRAIN_STATE_DISABLE=1）跳過持久化 */
function isPersistDisabled(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.BRAIN_STATE_DISABLE === "1"
  );
}

/**
 * 啟動時同步讀取狀態（避免 race：必須在 in-memory 陣列初始化之後、
 * 任何 mutation 之前呼叫）。失敗時回傳 null，不拋例外。
 */
export function loadStateSync(): PersistableBrainState | null {
  if (isPersistDisabled()) return null;
  const filePath = getStateFilePath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as PersistableBrainState;
    if (typeof parsed !== "object" || parsed == null) return null;
    return parsed;
  } catch (err) {
    console.warn(
      `[BrainState] 讀取狀態檔失敗（將以空狀態啟動）：${err instanceof Error ? err.message : err}`
    );
    return null;
  }
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProvider: (() => PersistableBrainState) | null = null;

/**
 * 觸發 debounced 寫入。caller 提供 producer 函式，在實際寫入時刻才呼叫
 * 它取得最新的快照（避免閉包綁定到舊資料）。
 */
export function schedulePersist(producer: () => PersistableBrainState): void {
  if (isPersistDisabled()) return;
  pendingProvider = producer;
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const provider = pendingProvider;
    pendingProvider = null;
    if (!provider) return;
    void writeStateOnce(provider());
  }, 1_500);
}

/** 立即同步寫入（測試 / 關機 hook 用） */
export async function flushNow(producer: () => PersistableBrainState): Promise<void> {
  if (isPersistDisabled()) return;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingProvider = null;
  await writeStateOnce(producer());
}

async function writeStateOnce(state: PersistableBrainState): Promise<void> {
  const filePath = getStateFilePath();
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    const json = JSON.stringify(state);
    await fsPromises.writeFile(tmpPath, json, "utf8");
    await fsPromises.rename(tmpPath, filePath);
  } catch (err) {
    console.warn(
      `[BrainState] 寫入狀態檔失敗：${err instanceof Error ? err.message : err}`
    );
    // 清掉殘留的 tmp 檔
    try {
      await fsPromises.unlink(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

/** 給測試用：清空狀態檔 */
export async function clearStateFile(): Promise<void> {
  const filePath = getStateFilePath();
  try {
    await fsPromises.unlink(filePath);
  } catch {
    /* ignore */
  }
}
