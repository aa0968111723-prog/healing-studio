/**
 * assetCleanupService.test.ts — AIDV-67 儲存清理核心邏輯測試（純函式、假相依）。
 *
 * 覆蓋：
 *   - 空批：scanned=0、不刪
 *   - 真刪：刪物件＋刪列、計數正確
 *   - dry-run：只統計、零刪除（含 shared-key 仍正確計入 skip）
 *   - shared-key 守門：fileKey 被共用→不刪物件、但仍刪該過期列
 *   - 無 fileKey：跳過刪物件、仍刪列
 *   - 單列失敗：計入 errors、不中斷整批
 *   - asOf 傳進 listExpired（時間基準）
 */
import { describe, it, expect, vi } from "vitest";
import {
  runAssetCleanup,
  type AssetCleanupDeps,
  type ExpiredAssetRow,
} from "./assetCleanupService";

function makeDeps(
  rows: ExpiredAssetRow[],
  overrides: Partial<AssetCleanupDeps> = {}
): AssetCleanupDeps {
  return {
    listExpired: vi.fn(async () => rows),
    countOthersByFileKey: vi.fn(async () => 0),
    deleteStorageObject: vi.fn(async () => {}),
    deleteAssetRow: vi.fn(async () => {}),
    now: () => new Date("2026-06-21T00:00:00Z"),
    ...overrides,
  };
}

describe("runAssetCleanup", () => {
  it("空批：scanned=0、不刪任何東西", async () => {
    const deps = makeDeps([]);
    const r = await runAssetCleanup({ limit: 50, dryRun: false }, deps);
    expect(r.scanned).toBe(0);
    expect(r.storageDeleted).toBe(0);
    expect(r.rowsDeleted).toBe(0);
    expect(deps.deleteStorageObject).not.toHaveBeenCalled();
    expect(deps.deleteAssetRow).not.toHaveBeenCalled();
  });

  it("真刪：刪物件＋刪列、計數正確", async () => {
    const rows = [
      { id: 1, fileKey: "u/1/a.png" },
      { id: 2, fileKey: "u/2/b.png" },
    ];
    const deps = makeDeps(rows);
    const r = await runAssetCleanup({ limit: 50, dryRun: false }, deps);
    expect(r.scanned).toBe(2);
    expect(r.storageDeleted).toBe(2);
    expect(r.rowsDeleted).toBe(2);
    expect(r.skippedSharedKey).toBe(0);
    expect(r.errors).toBe(0);
    expect(deps.deleteStorageObject).toHaveBeenCalledWith("u/1/a.png");
    expect(deps.deleteAssetRow).toHaveBeenCalledWith(2);
  });

  it("dry-run：只統計、零刪除", async () => {
    const rows = [
      { id: 1, fileKey: "u/1/a.png" },
      { id: 2, fileKey: "shared.png" },
    ];
    const deps = makeDeps(rows, {
      // 第二筆 fileKey 被別列共用
      countOthersByFileKey: vi.fn(async (key: string) =>
        key === "shared.png" ? 3 : 0
      ),
    });
    const r = await runAssetCleanup({ limit: 50, dryRun: true }, deps);
    expect(r.dryRun).toBe(true);
    expect(r.scanned).toBe(2);
    expect(r.storageDeleted).toBe(0);
    expect(r.rowsDeleted).toBe(0);
    // 演練仍正確算出「會被 shared-key 守門跳過刪物件」的筆數
    expect(r.skippedSharedKey).toBe(1);
    expect(deps.deleteStorageObject).not.toHaveBeenCalled();
    expect(deps.deleteAssetRow).not.toHaveBeenCalled();
  });

  it("shared-key 守門：不刪物件、但仍刪該過期列", async () => {
    const rows = [{ id: 7, fileKey: "shared.png" }];
    const deps = makeDeps(rows, {
      countOthersByFileKey: vi.fn(async () => 2),
    });
    const r = await runAssetCleanup({ limit: 50, dryRun: false }, deps);
    expect(r.skippedSharedKey).toBe(1);
    expect(r.storageDeleted).toBe(0);
    expect(r.rowsDeleted).toBe(1);
    expect(deps.deleteStorageObject).not.toHaveBeenCalled();
    expect(deps.deleteAssetRow).toHaveBeenCalledWith(7);
  });

  it("無 fileKey（null / 空白）：跳過刪物件、仍刪列、不算 shared", async () => {
    const rows = [
      { id: 1, fileKey: null },
      { id: 2, fileKey: "   " },
    ];
    const deps = makeDeps(rows);
    const r = await runAssetCleanup({ limit: 50, dryRun: false }, deps);
    expect(r.storageDeleted).toBe(0);
    expect(r.skippedSharedKey).toBe(0);
    expect(r.rowsDeleted).toBe(2);
    expect(deps.countOthersByFileKey).not.toHaveBeenCalled();
    expect(deps.deleteStorageObject).not.toHaveBeenCalled();
  });

  it("單列失敗：計入 errors、不中斷整批", async () => {
    const rows = [
      { id: 1, fileKey: "u/1/a.png" },
      { id: 2, fileKey: "u/2/b.png" },
      { id: 3, fileKey: "u/3/c.png" },
    ];
    const deps = makeDeps(rows, {
      deleteStorageObject: vi.fn(async (key: string) => {
        if (key === "u/2/b.png") throw new Error("R2 502");
      }),
    });
    const r = await runAssetCleanup({ limit: 50, dryRun: false }, deps);
    expect(r.scanned).toBe(3);
    expect(r.errors).toBe(1);
    // 第 1、3 筆照常完成
    expect(r.storageDeleted).toBe(2);
    expect(r.rowsDeleted).toBe(2);
    expect(deps.deleteAssetRow).toHaveBeenCalledWith(3);
  });

  it("把 now() 的時間基準傳進 listExpired，並尊重 limit", async () => {
    const deps = makeDeps([]);
    await runAssetCleanup({ limit: 25, dryRun: false }, deps);
    expect(deps.listExpired).toHaveBeenCalledWith(
      25,
      new Date("2026-06-21T00:00:00Z")
    );
  });
});
