/**
 * adminApiUsageEstimate.test.ts — fal/gemini 估算快照前端解析契約（AIDV-561／AIDV-194）
 *
 * 對應 server/jobs/providerSnapshotJob.ts buildEstimatedUsageSnapshot 產出的
 * extraData 形狀：estimated / reconciled / estimateAvailable / todayCallCount /
 * todayTotalUnits / todayCostUsd（六位小數字串）。
 */
import { describe, expect, it } from "vitest";
import { readSnapshotEstimate } from "./adminApiUsageEstimate";

describe("readSnapshotEstimate", () => {
  it("null / undefined / 非物件 / 陣列 → null（走原權威值呈現）", () => {
    expect(readSnapshotEstimate(null)).toBeNull();
    expect(readSnapshotEstimate(undefined)).toBeNull();
    expect(readSnapshotEstimate("estimated")).toBeNull();
    expect(readSnapshotEstimate(42)).toBeNull();
    expect(readSnapshotEstimate([{ estimated: true }])).toBeNull();
  });

  it("非估算 extraData（elevenlabs/suno 權威快照、舊版占位）→ null", () => {
    // elevenlabs 權威快照的 extraData 形狀
    expect(
      readSnapshotEstimate({ character_count: 100, character_limit: 10000 })
    ).toBeNull();
    // 舊版占位（無 estimated 標記）
    expect(
      readSnapshotEstimate({ note: "fal.ai usage tracked via proxy gateway" })
    ).toBeNull();
    // estimated 必須是嚴格 true
    expect(readSnapshotEstimate({ estimated: "true" })).toBeNull();
    expect(readSnapshotEstimate({ estimated: 1 })).toBeNull();
  });

  it("估算快照（聚合成功）：解析 job 實際落庫形狀，todayCostUsd 字串轉數字", () => {
    // 與 buildEstimatedUsageSnapshot(provider, usage, windowStart) 產出對齊
    const info = readSnapshotEstimate({
      estimated: true,
      reconciled: false,
      estimateBasis: "ai_usage_events 聚合",
      note: "fal.ai usage tracked via proxy gateway",
      estimateAvailable: true,
      windowStart: "2026-07-03T00:00:00.000Z",
      todayCallCount: 42,
      todayTotalUnits: 17.5,
      todayCostUsd: "1.234567",
    });
    expect(info).toEqual({
      estimateAvailable: true,
      todayCallCount: 42,
      todayCostUsd: 1.234567,
    });
  });

  it("估算快照（聚合失敗 fail-open）：estimateAvailable=false、數字為 null", () => {
    const info = readSnapshotEstimate({
      estimated: true,
      reconciled: false,
      note: "Gemini usage tracked via GCP billing",
      estimateAvailable: false,
    });
    expect(info).toEqual({
      estimateAvailable: false,
      todayCallCount: null,
      todayCostUsd: null,
    });
  });

  it("防禦性：NaN／負值／型別不符的估算數字降級為 null，不丟例外", () => {
    const info = readSnapshotEstimate({
      estimated: true,
      estimateAvailable: true,
      todayCallCount: -3,
      todayCostUsd: "not-a-number",
    });
    expect(info).toEqual({
      estimateAvailable: true,
      todayCallCount: null,
      todayCostUsd: null,
    });

    const info2 = readSnapshotEstimate({
      estimated: true,
      estimateAvailable: true,
      todayCallCount: Number.NaN,
      todayCostUsd: "",
    });
    expect(info2).toEqual({
      estimateAvailable: true,
      todayCallCount: null,
      todayCostUsd: null,
    });
  });

  it("todayCostUsd 為數字型別也接受（向前相容）", () => {
    const info = readSnapshotEstimate({
      estimated: true,
      estimateAvailable: true,
      todayCallCount: 0,
      todayCostUsd: 0,
    });
    expect(info).toEqual({
      estimateAvailable: true,
      todayCallCount: 0,
      todayCostUsd: 0,
    });
  });
});
