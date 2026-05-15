/**
 * Unit tests for accountantTools — 財財（accountant）的成本控制工具集。
 *
 * 涵蓋既有與新增工具：
 *   - estimateCost：未知 modelId 必須回 isUnknownModel=true（不能憑空編數字）
 *   - compareModels：同類別下要照點數遞增排序
 *   - suggestSavings：tier-gap 風險文案要與 catalog tier 對齊
 *   - getBudget：DB 不可用時必須回 noDataAvailable=true 而非崩潰
 *   - getDailyTrend：series 為空時要回零值 + hasSpike=false
 *   - getForecast：觀察期不足時回 insufficientData=true
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// 把 db 層 mock 掉 — 這些工具是純函式 / 純查詢，不該真的連 MySQL
vi.mock("../../../server/db", () => ({
  getUserAccountInfo: vi.fn(),
  getUserCostSummary: vi.fn(),
  getUserDailyTrendRange: vi.fn(),
  getUserModalityBreakdown: vi.fn(),
  getUserTopModelRecent: vi.fn(),
}));

import {
  getUserAccountInfo,
  getUserCostSummary,
  getUserDailyTrendRange,
  getUserModalityBreakdown,
  getUserTopModelRecent,
} from "../../../server/db";
import {
  compareModels,
  estimateCost,
  getBudget,
  getDailyTrend,
  getForecast,
  getMonthlyUsage,
  suggestSavings,
} from "../../../server/services/spiritTools/accountantTools";

const getUserAccountInfoMock = vi.mocked(getUserAccountInfo);
const getUserCostSummaryMock = vi.mocked(getUserCostSummary);
const getUserDailyTrendRangeMock = vi.mocked(getUserDailyTrendRange);
const getUserModalityBreakdownMock = vi.mocked(getUserModalityBreakdown);
const getUserTopModelRecentMock = vi.mocked(getUserTopModelRecent);

afterEach(() => {
  vi.clearAllMocks();
});

describe("accountantTools.estimateCost", () => {
  it("returns isUnknownModel=true for fabricated model IDs (LLM must not invent prices)", () => {
    const result = estimateCost({ modelId: "made-up/not-in-catalog" });
    expect(result.isUnknownModel).toBe(true);
    expect(result.label).toBeNull();
  });

  it("returns concrete pricing for a known model and label is non-null", () => {
    const result = estimateCost({
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      charCount: 1000,
    });
    expect(result.isUnknownModel).toBe(false);
    expect(result.label).not.toBeNull();
    expect(result.totalPoints).toBeGreaterThan(0);
  });
});

describe("accountantTools.compareModels", () => {
  it("sorts results by totalPoints ascending so cheapest comes first", () => {
    const result = compareModels({ category: "text-to-speech", charCount: 1000 });
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i].totalPoints).toBeGreaterThanOrEqual(
        result.rows[i - 1].totalPoints
      );
    }
    if (result.cheapest && result.rows.length > 0) {
      expect(result.cheapest.totalPoints).toBe(result.rows[0].totalPoints);
    }
  });
});

describe("accountantTools.suggestSavings", () => {
  it("only returns alternatives that are strictly cheaper than baseline", () => {
    const result = suggestSavings({
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      charCount: 1000,
    });
    for (const alt of result.alternatives) {
      expect(alt.savingsPoints).toBeGreaterThan(0);
    }
  });

  it("annotates each alternative with a tier-gap risk note", () => {
    const result = suggestSavings({
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      charCount: 1000,
    });
    for (const alt of result.alternatives) {
      expect(alt.riskNote.length).toBeGreaterThan(0);
      expect(alt.tierGap).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("accountantTools.getMonthlyUsage", () => {
  it("queries DB with days=30 (not all-time — fixes the 30-day vs all-time bug)", async () => {
    getUserCostSummaryMock.mockResolvedValueOnce({
      totalCost: 1.5,
      totalRequests: 42,
    });
    getUserModalityBreakdownMock.mockResolvedValueOnce([
      { requestType: "image_generation", count: 20, totalCost: "0.8" } as never,
    ]);
    getUserTopModelRecentMock.mockResolvedValueOnce({
      model: "fal-ai/flux/schnell",
      totalCalls: 20,
      totalCostUsd: 0.8,
    });

    const result = await getMonthlyUsage(1);

    // 兩個 DB call 都必須帶 { days: 30 } — 之前 bug 是兩個都沒帶 → all-time
    expect(getUserCostSummaryMock).toHaveBeenCalledWith(1, { days: 30 });
    expect(getUserModalityBreakdownMock).toHaveBeenCalledWith(1, { days: 30 });
    expect(getUserTopModelRecentMock).toHaveBeenCalledWith(1, { days: 30 });

    // 1.5 USD * 100 = 150 pts
    expect(result.totalCostPoints).toBe(150);
    expect(result.totalRequests).toBe(42);
    expect(result.topModel?.modelId).toBe("fal-ai/flux/schnell");
  });

  it("returns zero values when all DB calls reject (no crash, no silent fallback)", async () => {
    getUserCostSummaryMock.mockRejectedValueOnce(new Error("db down"));
    getUserModalityBreakdownMock.mockRejectedValueOnce(new Error("db down"));
    getUserTopModelRecentMock.mockRejectedValueOnce(new Error("db down"));

    const result = await getMonthlyUsage(1);
    expect(result.totalCostPoints).toBe(0);
    expect(result.totalRequests).toBe(0);
    expect(result.topModel).toBeNull();
  });
});

describe("accountantTools.getBudget", () => {
  it("returns noDataAvailable=true when DB lookup is null", async () => {
    getUserAccountInfoMock.mockResolvedValueOnce(null);
    const result = await getBudget(1);
    expect(result.noDataAvailable).toBe(true);
    expect(result.remainingPoints).toBe(0);
  });

  it("maps DB row to BudgetResult cleanly", async () => {
    getUserAccountInfoMock.mockResolvedValueOnce({
      remainingGenerations: 250,
      quotaJson: { image: 100, video: 50, audio: 30, voice: 70 },
      autoCreditEnabled: true,
      autoCreditAmount: 500,
      autoCreditIntervalDays: 7,
      autoCreditNextAt: new Date("2026-06-01T00:00:00Z"),
    });

    const result = await getBudget(1);
    expect(result.noDataAvailable).toBe(false);
    expect(result.remainingPoints).toBe(250);
    expect(result.autoCredit.enabled).toBe(true);
    expect(result.autoCredit.amountPoints).toBe(500);
    expect(result.autoCredit.nextAtIso).toBe("2026-06-01T00:00:00.000Z");
    expect(result.perModalityQuota?.image).toBe(100);
  });

  it("survives DB rejection without throwing", async () => {
    getUserAccountInfoMock.mockRejectedValueOnce(new Error("db down"));
    const result = await getBudget(1);
    expect(result.noDataAvailable).toBe(true);
  });
});

describe("accountantTools.getDailyTrend", () => {
  it("flags hasSpike=true when peak day is > 3× average", async () => {
    // 5 days @ ~5 pts + 1 day @ 200 pts → avg = (25+200)/6 ≈ 38, peak=200 > 38*3=114 ✓
    getUserDailyTrendRangeMock.mockResolvedValueOnce([
      { date: "2026-05-08", count: 5, totalCost: "0.05" },
      { date: "2026-05-09", count: 5, totalCost: "0.05" },
      { date: "2026-05-10", count: 5, totalCost: "0.05" },
      { date: "2026-05-11", count: 5, totalCost: "0.05" },
      { date: "2026-05-12", count: 5, totalCost: "0.05" },
      // 2.0 USD = 200 pts — far above the ~5 pts daily baseline → spike
      { date: "2026-05-13", count: 100, totalCost: "2.00" },
    ] as never);

    const result = await getDailyTrend(1, { days: 7 });
    expect(result.hasSpike).toBe(true);
    expect(result.peakDay?.date).toBe("2026-05-13");
    expect(result.peakDay?.costPoints).toBe(200);
  });

  it("returns empty series with hasSpike=false when no data", async () => {
    getUserDailyTrendRangeMock.mockResolvedValueOnce([]);
    const result = await getDailyTrend(1, { days: 14 });
    expect(result.daysObserved).toBe(0);
    expect(result.hasSpike).toBe(false);
    expect(result.peakDay).toBeNull();
  });
});

describe("accountantTools.getForecast", () => {
  it("flags insufficientData=true when fewer than 3 days observed", async () => {
    getUserDailyTrendRangeMock.mockResolvedValueOnce([
      { date: "2026-05-14", count: 5, totalCost: "0.10" },
    ] as never);
    getUserCostSummaryMock.mockResolvedValueOnce({ totalCost: 0.1, totalRequests: 5 });
    getUserAccountInfoMock.mockResolvedValueOnce(null);

    const result = await getForecast(1, { observationDays: 14 });
    expect(result.insufficientData).toBe(true);
  });

  it("estimates daysUntilDepletion when budget + burn rate are both available", async () => {
    // 14 天總共 700 pts → 平均每天 50 pts；剩 500 pts → 約 10 天見底
    const series = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-05-${(i + 1).toString().padStart(2, "0")}`,
      count: 5,
      totalCost: "0.50", // 50 pts/day
    }));
    getUserDailyTrendRangeMock.mockResolvedValueOnce(series as never);
    getUserCostSummaryMock.mockResolvedValueOnce({ totalCost: 5.0, totalRequests: 50 });
    getUserAccountInfoMock.mockResolvedValueOnce({
      remainingGenerations: 500,
      quotaJson: null,
      autoCreditEnabled: false,
      autoCreditAmount: 0,
      autoCreditIntervalDays: 0,
      autoCreditNextAt: null,
    });

    const result = await getForecast(1, { observationDays: 14 });
    expect(result.insufficientData).toBe(false);
    expect(result.avgPointsPerDay).toBeGreaterThan(0);
    // 500 / 50 = 10 days
    expect(result.daysUntilDepletion).toBe(10);
  });

  it("returns daysUntilDepletion=null when budget unavailable", async () => {
    const series = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-05-${(i + 1).toString().padStart(2, "0")}`,
      count: 5,
      totalCost: "0.50",
    }));
    getUserDailyTrendRangeMock.mockResolvedValueOnce(series as never);
    getUserCostSummaryMock.mockResolvedValueOnce({ totalCost: 5.0, totalRequests: 50 });
    getUserAccountInfoMock.mockResolvedValueOnce(null);

    const result = await getForecast(1, { observationDays: 14 });
    expect(result.daysUntilDepletion).toBeNull();
  });
});
