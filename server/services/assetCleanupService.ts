/**
 * assetCleanupService.ts — AIDV-67 儲存清理核心邏輯（純函式、相依可注入，便於單測）。
 *
 * 「掃一批」做的事：
 *   1. 找出已過保留期（expiresAt）的資產。
 *   2. 對每一個：若沒有其他資產列共用同一 fileKey，刪掉儲存物件；再刪 DB 列。
 *
 * dryRun=true（演練，預設）只統計、不刪任何東西——讓正式站第一次開旗標時先看會
 * 刪什麼，確認無誤再關掉 dry-run 真刪（兩段式安全閥）。
 *
 * 所有外部相依（DB 查詢、storage 刪除）由 deps 注入，本檔不直接 import db / storage，
 * 因此單測可餵假相依、零真實 I/O。
 */

export interface ExpiredAssetRow {
  id: number;
  fileKey: string | null;
}

export interface AssetCleanupDeps {
  /** 取出已過 expiresAt 的資產（最多 limit 筆，asOf 為「現在」時間基準）。 */
  listExpired(limit: number, asOf: Date): Promise<ExpiredAssetRow[]>;
  /** 數出除了 excludeId 外還有幾列共用同一 fileKey。 */
  countOthersByFileKey(fileKey: string, excludeId: number): Promise<number>;
  /** 刪除儲存後端的物件（冪等、不存在不算錯）。 */
  deleteStorageObject(fileKey: string): Promise<void>;
  /** 刪除 DB 資產列。 */
  deleteAssetRow(id: number): Promise<void>;
  /** 可注入時間（測試用）；省略時用 new Date()。 */
  now?: () => Date;
}

export interface AssetCleanupOptions {
  /** 單批最多處理幾筆。 */
  limit: number;
  /** true＝演練（只統計不刪）。 */
  dryRun: boolean;
}

export interface AssetCleanupResult {
  /** 本批掃到幾筆過期資產。 */
  scanned: number;
  /** 實際刪掉幾個儲存物件（dry-run 恆為 0）。 */
  storageDeleted: number;
  /** 實際刪掉幾列 DB（dry-run 恆為 0）。 */
  rowsDeleted: number;
  /** 因 fileKey 仍被其他列共用而「不刪物件」的筆數（仍會刪該列本身）。 */
  skippedSharedKey: number;
  /** 單列處理失敗的筆數（不中斷整批）。 */
  errors: number;
  /** 是否為演練。 */
  dryRun: boolean;
}

/**
 * 掃一批過期資產並（非演練時）刪除。單列失敗只計數、不中斷整批；
 * 「刪物件」與「刪列」分開計：物件被共用時跳過刪物件，但該過期列本身仍會刪。
 */
export async function runAssetCleanup(
  opts: AssetCleanupOptions,
  deps: AssetCleanupDeps
): Promise<AssetCleanupResult> {
  const now = (deps.now ?? (() => new Date()))();
  const expired = await deps.listExpired(opts.limit, now);

  const result: AssetCleanupResult = {
    scanned: expired.length,
    storageDeleted: 0,
    rowsDeleted: 0,
    skippedSharedKey: 0,
    errors: 0,
    dryRun: opts.dryRun,
  };

  for (const row of expired) {
    try {
      // 能不能刪儲存物件：有 fileKey 且沒有其他列共用才刪。
      let canDeleteObject = false;
      if (row.fileKey && row.fileKey.trim()) {
        const others = await deps.countOthersByFileKey(row.fileKey, row.id);
        if (others === 0) {
          canDeleteObject = true;
        } else {
          result.skippedSharedKey++;
        }
      }

      // 演練模式：算完統計即止，不刪任何東西。
      if (opts.dryRun) continue;

      if (canDeleteObject && row.fileKey) {
        await deps.deleteStorageObject(row.fileKey);
        result.storageDeleted++;
      }
      await deps.deleteAssetRow(row.id);
      result.rowsDeleted++;
    } catch {
      // 單列失敗（DB / 儲存暫時性錯誤）不應中斷整批；下輪 cron 會再掃到。
      result.errors++;
    }
  }

  return result;
}
