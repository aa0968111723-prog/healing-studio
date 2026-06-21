/**
 * assetCleanupJob.test.ts — AIDV-67 儲存清理 cron 旗標與「OFF＝零行為」測試。
 *
 * 覆蓋：
 *   - isAssetTtlCleanupEnabled：預設 OFF；只有 true/1/on/yes 才 ON
 *   - isAssetTtlCleanupDryRun：預設 ON（演練）；只有 false/0/off/no 才真刪
 *   - runAssetCleanupSweep：旗標 OFF 時連 DB 都不碰（零行為變化的硬保證）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = {
  ENABLE_ASSET_TTL_CLEANUP: process.env.ENABLE_ASSET_TTL_CLEANUP,
  ASSET_TTL_CLEANUP_DRY_RUN: process.env.ASSET_TTL_CLEANUP_DRY_RUN,
};

// 監看 db.listExpiredDigitalAssets 是否被呼叫（旗標 OFF 不該碰 DB）。
const listExpiredSpy = vi.fn(async () => []);
vi.mock("../db", () => ({
  listExpiredDigitalAssets: (...args: unknown[]) => listExpiredSpy(...args),
  countOtherDigitalAssetsByFileKey: vi.fn(async () => 0),
  deleteDigitalAsset: vi.fn(async () => {}),
}));
vi.mock("../storage", () => ({
  storageDelete: vi.fn(async () => ({ backend: "none" })),
}));

import {
  isAssetTtlCleanupEnabled,
  isAssetTtlCleanupDryRun,
  runAssetCleanupSweep,
} from "./assetCleanupJob";

beforeEach(() => {
  delete process.env.ENABLE_ASSET_TTL_CLEANUP;
  delete process.env.ASSET_TTL_CLEANUP_DRY_RUN;
  listExpiredSpy.mockClear();
});

afterEach(() => {
  for (const k of Object.keys(ORIGINAL) as (keyof typeof ORIGINAL)[]) {
    const v = ORIGINAL[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("isAssetTtlCleanupEnabled", () => {
  it("預設（未設）OFF", () => {
    expect(isAssetTtlCleanupEnabled()).toBe(false);
  });
  it("空字串 / false / 0 / 隨意值 → OFF", () => {
    for (const v of ["", "false", "0", "off", "no", "nope", " "]) {
      process.env.ENABLE_ASSET_TTL_CLEANUP = v;
      expect(isAssetTtlCleanupEnabled()).toBe(false);
    }
  });
  it("true / 1 / on / yes（含大小寫/空白）→ ON", () => {
    for (const v of ["true", "1", "on", "yes", " TRUE ", "On"]) {
      process.env.ENABLE_ASSET_TTL_CLEANUP = v;
      expect(isAssetTtlCleanupEnabled()).toBe(true);
    }
  });
});

describe("isAssetTtlCleanupDryRun", () => {
  it("預設（未設）ON＝演練", () => {
    expect(isAssetTtlCleanupDryRun()).toBe(true);
  });
  it("只有 false/0/off/no 才真刪（dry-run=false）", () => {
    for (const v of ["false", "0", "off", "no", " FALSE "]) {
      process.env.ASSET_TTL_CLEANUP_DRY_RUN = v;
      expect(isAssetTtlCleanupDryRun()).toBe(false);
    }
  });
  it("其餘值仍演練", () => {
    for (const v of ["", "true", "1", "whatever"]) {
      process.env.ASSET_TTL_CLEANUP_DRY_RUN = v;
      expect(isAssetTtlCleanupDryRun()).toBe(true);
    }
  });
});

describe("runAssetCleanupSweep 旗標 OFF 硬保證", () => {
  it("旗標 OFF：完全不碰 DB（零行為變化）", async () => {
    // ENABLE_ASSET_TTL_CLEANUP 未設＝OFF
    await runAssetCleanupSweep();
    expect(listExpiredSpy).not.toHaveBeenCalled();
  });

  it("旗標 ON：會去掃 DB（此處空批，不刪）", async () => {
    process.env.ENABLE_ASSET_TTL_CLEANUP = "true";
    await runAssetCleanupSweep();
    expect(listExpiredSpy).toHaveBeenCalledTimes(1);
  });
});
