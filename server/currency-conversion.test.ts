import { describe, it, expect } from "vitest";
import {
  DEFAULT_USD_TO_TWD_RATE,
  POINTS_PER_USD,
  formatTwd,
  parseUsdToTwdRate,
  resolveTwdPerUsd,
  safeSharePct,
  usdToPoints,
  usdToTwd,
} from "@shared/currency";

describe("resolveTwdPerUsd — AIDV-14 匯率來源優先序", () => {
  it("TWD_PER_USD 優先（規格名）", () => {
    expect(resolveTwdPerUsd("32", "31.5")).toBe(32);
  });
  it("TWD_PER_USD 未設 → 退回 USD_TO_TWD_RATE", () => {
    expect(resolveTwdPerUsd("", "30")).toBe(30);
    expect(resolveTwdPerUsd(undefined, "30")).toBe(30);
    expect(resolveTwdPerUsd(null, "30")).toBe(30);
  });
  it("兩者皆未設 → 退回 default 31.5", () => {
    expect(resolveTwdPerUsd(undefined, undefined)).toBe(DEFAULT_USD_TO_TWD_RATE);
  });
  it("TWD_PER_USD 非法 → 退回 USD_TO_TWD_RATE（再退 default）", () => {
    expect(resolveTwdPerUsd("0", "33")).toBe(33);
    expect(resolveTwdPerUsd("99999", "abc")).toBe(DEFAULT_USD_TO_TWD_RATE);
  });
});

describe("shared/currency — USD ↔ Points ↔ TWD 換算", () => {
  it("空/壞值都退回 default 匯率", () => {
    expect(parseUsdToTwdRate(undefined)).toBe(DEFAULT_USD_TO_TWD_RATE);
    expect(parseUsdToTwdRate(null)).toBe(DEFAULT_USD_TO_TWD_RATE);
    expect(parseUsdToTwdRate("")).toBe(DEFAULT_USD_TO_TWD_RATE);
    expect(parseUsdToTwdRate("abc")).toBe(DEFAULT_USD_TO_TWD_RATE);
    // 防呆：0 / 負數 / 天文數字
    expect(parseUsdToTwdRate(0)).toBe(DEFAULT_USD_TO_TWD_RATE);
    expect(parseUsdToTwdRate(-5)).toBe(DEFAULT_USD_TO_TWD_RATE);
    expect(parseUsdToTwdRate(99999)).toBe(DEFAULT_USD_TO_TWD_RATE);
  });

  it("合法範圍內的匯率字串可以正常 parse", () => {
    expect(parseUsdToTwdRate("32")).toBe(32);
    expect(parseUsdToTwdRate("31.85")).toBeCloseTo(31.85, 5);
    expect(parseUsdToTwdRate(28)).toBe(28);
  });

  it("usdToPoints 走站內公定 1 USD = 100 pts，四捨五入到整數", () => {
    expect(POINTS_PER_USD).toBe(100);
    expect(usdToPoints(0.5)).toBe(50);
    expect(usdToPoints(0.123)).toBe(12);
    expect(usdToPoints(0.125)).toBe(13);
    expect(usdToPoints(0)).toBe(0);
    expect(usdToPoints(-1)).toBe(0);
    expect(usdToPoints(NaN)).toBe(0);
  });

  it("usdToTwd 套指定匯率；壞輸入回 0 而非 NaN", () => {
    expect(usdToTwd(1, 31.5)).toBeCloseTo(31.5, 5);
    expect(usdToTwd(2.5, 32)).toBeCloseTo(80, 5);
    expect(usdToTwd(0, 31.5)).toBe(0);
    expect(usdToTwd(-1, 31.5)).toBe(0);
    expect(usdToTwd(1, 0)).toBe(0);
    expect(usdToTwd(1, NaN)).toBe(0);
  });

  it("safeSharePct 計算佔比，total=0 不會炸 NaN", () => {
    expect(safeSharePct(25, 100)).toBe(25);
    expect(safeSharePct(50, 200)).toBe(25);
    expect(safeSharePct(0, 100)).toBe(0);
    expect(safeSharePct(10, 0)).toBe(0);
    expect(safeSharePct(NaN, 100)).toBe(0);
    expect(safeSharePct(10, NaN)).toBe(0);
  });

  it("formatTwd 顯示 zh-TW 千分位、無小數", () => {
    expect(formatTwd(1234)).toBe("NT$1,234");
    expect(formatTwd(0)).toBe("NT$0");
    expect(formatTwd(-5)).toBe("NT$0");
    expect(formatTwd(NaN)).toBe("NT$0");
    expect(formatTwd(31.7)).toBe("NT$32"); // 四捨五入
  });
});

describe("teamCostSummary 聚合語意 — 純函式模擬", () => {
  // 模擬 teamCostSummary router 的聚合邏輯，純函式測試（不打 DB），驗證：
  //   1. usdSharePct / creditsSharePct 加總 ≈ 100
  //   2. 單一成員時佔比 = 100
  //   3. totals 為各列 usd/credits 加總
  function aggregate(
    rows: Array<{ userId: number; usdCost: number; credits: number }>
  ) {
    const totals = rows.reduce(
      (acc, r) => {
        acc.usd += r.usdCost;
        acc.credits += r.credits;
        return acc;
      },
      { usd: 0, credits: 0 }
    );
    return {
      rows: rows.map(r => ({
        userId: r.userId,
        usdCost: r.usdCost,
        credits: r.credits,
        usdSharePct: safeSharePct(r.usdCost, totals.usd),
        creditsSharePct: safeSharePct(r.credits, totals.credits),
        twdCost: usdToTwd(r.usdCost, DEFAULT_USD_TO_TWD_RATE),
      })),
      totals,
    };
  }

  it("單成員佔比 100%", () => {
    const { rows } = aggregate([{ userId: 1, usdCost: 0.5, credits: 50 }]);
    expect(rows[0].usdSharePct).toBe(100);
    expect(rows[0].creditsSharePct).toBe(100);
  });

  it("多成員 share 加總 ≈ 100（浮點誤差 < 1e-6）", () => {
    const { rows } = aggregate([
      { userId: 1, usdCost: 0.3, credits: 30 },
      { userId: 2, usdCost: 0.5, credits: 50 },
      { userId: 3, usdCost: 0.2, credits: 20 },
    ]);
    const totalUsdShare = rows.reduce((s, r) => s + r.usdSharePct, 0);
    const totalCreditShare = rows.reduce((s, r) => s + r.creditsSharePct, 0);
    expect(totalUsdShare).toBeCloseTo(100, 5);
    expect(totalCreditShare).toBeCloseTo(100, 5);
  });

  it("空成員清單不會炸 NaN", () => {
    const { rows, totals } = aggregate([]);
    expect(rows).toEqual([]);
    expect(totals).toEqual({ usd: 0, credits: 0 });
  });

  it("twdCost 為各列 usdCost × default rate", () => {
    const { rows } = aggregate([{ userId: 1, usdCost: 2, credits: 200 }]);
    expect(rows[0].twdCost).toBeCloseTo(2 * DEFAULT_USD_TO_TWD_RATE, 5);
  });
});
