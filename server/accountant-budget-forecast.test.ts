/**
 * Regression tests for getBudgetForecast — guards two Codex review findings
 * (PR #638):
 *
 *   P1: 「30 天 baseline」之前是用 getUserCostSummary（lifetime 累計）÷ 30，
 *       對老用戶會把 baseline 拉到天上去，導致 trajectory 一律報 "low"。
 *       現在改用 getUserDailyTrend({ days: 30 }) 加總 → 真的是 30 天範圍。
 *
 *   P2: 「7 天日均」之前用 rows.length 當分母，但 daily trend 會跳過零用量天 →
 *       在「7 天只活躍 1 天」的稀疏分布下日均被高估 7 倍。
 *       現在固定除以 7 calendar days。
 *
 * 都用 vi.mock 攔 ./db 的兩個 helper，注入確定性的資料來驗證計算。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const dailyTrendMock = vi.fn();
const costSummaryMock = vi.fn();
const modalityBreakdownMock = vi.fn();
const topModelMock = vi.fn();

vi.mock("./db", () => ({
  getUserDailyTrend: (...args: unknown[]) => dailyTrendMock(...args),
  getUserCostSummary: (...args: unknown[]) => costSummaryMock(...args),
  getUserModalityBreakdown: (...args: unknown[]) => modalityBreakdownMock(...args),
  getUserTopModelRecent: (...args: unknown[]) => topModelMock(...args),
}));

import { getBudgetForecast } from "./services/spiritTools/accountantTools";

describe("getBudgetForecast — regression guards for PR #638 review", () => {
  beforeEach(() => {
    dailyTrendMock.mockReset();
    costSummaryMock.mockReset();
    modalityBreakdownMock.mockReset();
    topModelMock.mockReset();
    // Default no-data — individual tests override.
    dailyTrendMock.mockResolvedValue([]);
    costSummaryMock.mockResolvedValue({ totalCost: 0, totalRequests: 0 });
  });

  it("P2: 7-day average divides by 7 calendar days, not rows.length", async () => {
    // User had a single active day with $1.00 = 100 pts. Other 6 days had no
    // rows (daily trend skips them). Old logic: 100 / 1 = 100 pts/day.
    // New logic: 100 / 7 ≈ 14 pts/day.
    dailyTrendMock.mockImplementation(
      async (_userId: number, opts?: { days?: number }) => {
        if (opts?.days === 7) {
          return [{ date: "2026-05-10", count: 5, totalCost: "1.00", totalTokens: 0 }];
        }
        return [{ date: "2026-05-10", count: 5, totalCost: "1.00", totalTokens: 0 }];
      }
    );

    const result = await getBudgetForecast(42);
    expect(result.recent7dAvgPoints).toBe(Math.round(100 / 7)); // 14
    // sanity: definitely not the buggy 100 pts/day
    expect(result.recent7dAvgPoints).toBeLessThan(50);
  });

  it("P1: 30-day baseline uses 30-day window, not lifetime aggregate", async () => {
    // Lifetime cost: $1000 (would yield 100000/30 ≈ 3333 pts/day under old logic).
    // True 30-day cost: $1.00 (100 pts) → 30-day avg ≈ 3 pts/day.
    // Recent 7-day cost: $0.70 (70 pts) → 7-day avg ≈ 10 pts/day.
    //
    // Old broken behaviour: ratio = 10 / 3333 ≈ 0.003 → "low" (false alarm).
    // Correct behaviour:    ratio = 10 / 3 ≈ 3.3       → "high" (real spike).
    costSummaryMock.mockResolvedValue({ totalCost: 1000, totalRequests: 5000 });
    dailyTrendMock.mockImplementation(
      async (_userId: number, opts?: { days?: number }) => {
        if (opts?.days === 30) {
          return [{ date: "2026-04-20", count: 1, totalCost: "1.00", totalTokens: 0 }];
        }
        if (opts?.days === 7) {
          return [{ date: "2026-05-12", count: 1, totalCost: "0.70", totalTokens: 0 }];
        }
        return [];
      }
    );

    const result = await getBudgetForecast(42);
    expect(result.last30dTotalPoints).toBe(100); // $1.00 * 100, NOT 100000
    expect(result.last30dAvgPoints).toBe(Math.round(100 / 30)); // 3
    expect(result.trajectory).toBe("high");
  });

  it("returns trajectory='on-track' when 7-day rhythm matches 30-day baseline", async () => {
    // Both 7d and 30d at ≈ 10 pts/day → ratio = 1.0 → on-track.
    dailyTrendMock.mockImplementation(
      async (_userId: number, opts?: { days?: number }) => {
        if (opts?.days === 30) {
          // 30 * 10 pts = 300 pts = $3.00 across the window
          return [{ date: "2026-04-20", count: 1, totalCost: "3.00", totalTokens: 0 }];
        }
        if (opts?.days === 7) {
          // 7 * 10 pts = 70 pts = $0.70 across the window
          return [{ date: "2026-05-12", count: 1, totalCost: "0.70", totalTokens: 0 }];
        }
        return [];
      }
    );

    const result = await getBudgetForecast(42);
    expect(result.trajectory).toBe("on-track");
  });

  it("returns no-data when both windows are empty", async () => {
    dailyTrendMock.mockResolvedValue([]);
    const result = await getBudgetForecast(42);
    expect(result.trajectory).toBe("no-data");
    expect(result.recent7dAvgPoints).toBe(0);
    expect(result.last30dAvgPoints).toBe(0);
    expect(result.projectedMonthEndAddPoints).toBe(0);
  });

  it("projects month-end add by 7d avg × daysRemainingInMonth", async () => {
    dailyTrendMock.mockImplementation(
      async (_userId: number, opts?: { days?: number }) => {
        if (opts?.days === 7) {
          return [{ date: "2026-05-12", count: 1, totalCost: "1.40", totalTokens: 0 }];
        }
        return [{ date: "2026-04-20", count: 1, totalCost: "6.00", totalTokens: 0 }];
      }
    );

    const result = await getBudgetForecast(42);
    // 140 pts / 7 days = 20 pts/day
    expect(result.recent7dAvgPoints).toBe(20);
    expect(result.projectedMonthEndAddPoints).toBe(
      result.recent7dAvgPoints * result.daysRemainingInMonth
    );
  });
});
