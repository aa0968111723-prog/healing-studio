/**
 * providerSnapshotJob.test.ts — AIDV-561 / AIDV-194
 * ──────────────────────────────────────────────────────────────────────────
 * fal_ai / gemini 快照從「寫死占位 note」改為「當日 ai_usage_events 目錄單價×用量
 * 估算」。本測試鎖定純函式 buildEstimatedUsageSnapshot 的誠實標記契約：
 *   - 永遠 estimated=true / reconciled=false（這兩家無供應商權威帳單對帳）
 *   - 用量可得 → 附 windowStart / todayCallCount / todayTotalUnits / todayCostUsd
 *   - 用量不可得（DB 失敗 fail-open）→ estimateAvailable=false，等價舊占位但誠實標記
 *   - 絕不寫 quota / remaining / balanceUsd（權威欄位不冒充，配額告警不受影響）
 */
import { describe, it, expect, vi } from "vitest";

// 隔離 DB：模組頂層 import getDb，避免測試連到真實連線。
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));

import { buildEstimatedUsageSnapshot } from "./providerSnapshotJob";

const WINDOW = new Date("2026-07-02T00:00:00.000+08:00");

describe("buildEstimatedUsageSnapshot（純函式・誠實估算契約）", () => {
  it("fal_ai 用量可得 → estimated/reconciled 標記＋當日估算數字（costUsd 六位小數字串）", () => {
    const snap = buildEstimatedUsageSnapshot(
      "fal_ai",
      { callCount: 12, totalUnits: 34.5, totalCostUsd: 1.23456789 },
      WINDOW,
    );
    expect(snap.tier).toBe("pay-as-you-go");
    expect(snap.extraData).toMatchObject({
      estimated: true,
      reconciled: false,
      estimateAvailable: true,
      windowStart: WINDOW.toISOString(),
      todayCallCount: 12,
      todayTotalUnits: 34.5,
      todayCostUsd: "1.234568",
    });
    expect(String(snap.extraData?.note)).toContain("fal.ai");
  });

  it("gemini 用量可得 → note 標 GCP billing（與 fal_ai 區分）", () => {
    const snap = buildEstimatedUsageSnapshot(
      "gemini",
      { callCount: 3, totalUnits: 0, totalCostUsd: 0.5 },
      WINDOW,
    );
    expect(String(snap.extraData?.note)).toContain("GCP billing");
    expect(snap.extraData?.todayCostUsd).toBe("0.500000");
  });

  it("用量不可得（null，DB 聚合失敗 fail-open）→ estimateAvailable=false，仍誠實標 estimated", () => {
    const snap = buildEstimatedUsageSnapshot("fal_ai", null, WINDOW);
    expect(snap.tier).toBe("pay-as-you-go");
    expect(snap.extraData).toMatchObject({
      estimated: true,
      reconciled: false,
      estimateAvailable: false,
    });
    // 無估算數字欄位（不編造）。
    expect(snap.extraData).not.toHaveProperty("todayCostUsd");
    expect(snap.extraData).not.toHaveProperty("todayCallCount");
  });

  it("估算值不冒充權威欄位：quota / remaining / balanceUsd 一律不寫", () => {
    for (const usage of [
      { callCount: 9, totalUnits: 1, totalCostUsd: 2 },
      null,
    ] as const) {
      const snap = buildEstimatedUsageSnapshot("gemini", usage, WINDOW);
      expect(snap.quota).toBeUndefined();
      expect(snap.remaining).toBeUndefined();
      expect(snap.balanceUsd).toBeUndefined();
      expect(snap.nextInvoice).toBeUndefined();
    }
  });

  it("異常數值夾限：負值/NaN/Infinity → 0（估算絕不出現離譜數字）", () => {
    const snap = buildEstimatedUsageSnapshot(
      "fal_ai",
      { callCount: -5, totalUnits: Number.NaN, totalCostUsd: Number.POSITIVE_INFINITY },
      WINDOW,
    );
    expect(snap.extraData?.todayCallCount).toBe(0);
    expect(snap.extraData?.todayTotalUnits).toBe(0);
    expect(snap.extraData?.todayCostUsd).toBe("0.000000");
  });

  it("callCount 取整（COUNT(*) 驅動；防禦上游回小數字串）", () => {
    const snap = buildEstimatedUsageSnapshot(
      "fal_ai",
      { callCount: 7.6, totalUnits: 0, totalCostUsd: 0 },
      WINDOW,
    );
    expect(snap.extraData?.todayCallCount).toBe(8);
  });
});
