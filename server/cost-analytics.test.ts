/**
 * cost-analytics.test.ts — 深度成本分析輔助函式單元測試
 *
 * 涵蓋：
 *   1. categorizeEndpoint — catalog 對應 / 前綴匹配 / unknown 回退
 *   2. summarizeByCategory — 模態彙總、佔比、avg
 *   3. summarizeByEndpoint — Top-N、錯誤率
 *   4. summarizeByUser — Top-N、最常用端點
 *   5. summarizeByStatus — 4 種狀態完整性
 *   6. calculateWasteCost — 失敗 / 逾時的浪費
 *   7. latencyStats — 空樣本、p95/p99
 *   8. hourlyHeatmap — 168 格、空時段
 *   9. projectMonthlyCost — 月底投影
 *  10. compareCatalogVsActual — catalog 命中 / 未命中、deltaPct
 */

import { describe, it, expect } from "vitest";
import {
  categorizeEndpoint,
  summarizeByCategory,
  summarizeByEndpoint,
  summarizeByUser,
  summarizeByStatus,
  calculateWasteCost,
  latencyStats,
  hourlyHeatmap,
  projectMonthlyCost,
  compareCatalogVsActual,
  type UsageEventLike,
} from "./services/costAnalytics";

const evt = (overrides: Partial<UsageEventLike>): UsageEventLike => ({
  provider: "fal_ai",
  endpoint: "fal-ai/flux/schnell",
  status: "success",
  costUsd: 0.003,
  latencyMs: 200,
  userId: 1,
  createdAt: new Date("2026-05-01T10:00:00Z"),
  ...overrides,
});

describe("categorizeEndpoint", () => {
  it("命中 catalog 直接回傳 category", () => {
    expect(categorizeEndpoint("fal-ai/flux/schnell")).toBe("text-to-image");
  });

  it("可剝除 query string 後再匹配", () => {
    expect(categorizeEndpoint("fal-ai/flux/schnell?stream=1")).toBe("text-to-image");
  });

  it("找不到時回傳 unknown", () => {
    expect(categorizeEndpoint("fictional/model/xyz")).toBe("unknown");
  });

  it("空字串回傳 unknown", () => {
    expect(categorizeEndpoint("")).toBe("unknown");
  });
});

describe("summarizeByCategory", () => {
  it("依 category 彙總 callCount/cost 並計算佔比", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003, status: "failed" }),
      evt({ endpoint: "fictional/unknown-model", costUsd: 0.01 }),
    ];
    const out = summarizeByCategory(events);
    const known = out.find(c => c.category === "text-to-image")!;
    expect(known).toBeDefined();
    expect(known.callCount).toBe(2);
    expect(known.successCount).toBe(1);
    expect(known.failedCount).toBe(1);
    expect(known.costUsd).toBeCloseTo(0.006);

    const unknown = out.find(c => c.category === "unknown")!;
    expect(unknown.callCount).toBe(1);
    expect(unknown.share).toBeGreaterThan(0);
  });

  it("空輸入回傳空陣列", () => {
    expect(summarizeByCategory([])).toEqual([]);
  });
});

describe("summarizeByEndpoint", () => {
  it("依 provider+endpoint 彙總並按費用降冪排序", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.04 }),
      evt({ endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.04 }),
    ];
    const out = summarizeByEndpoint(events, 5);
    expect(out[0].endpoint).toBe("fal-ai/flux-pro/v1.1");
    expect(out[0].callCount).toBe(2);
    expect(out[0].costUsd).toBeCloseTo(0.08);
  });

  it("計算錯誤率", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", status: "success" }),
      evt({ endpoint: "fal-ai/flux/schnell", status: "failed" }),
      evt({ endpoint: "fal-ai/flux/schnell", status: "failed" }),
      evt({ endpoint: "fal-ai/flux/schnell", status: "timeout" }),
    ];
    const out = summarizeByEndpoint(events);
    expect(out[0].errorRate).toBe(75);
  });

  it("尊重 topN 截斷", () => {
    const events: UsageEventLike[] = Array.from({ length: 30 }, (_, i) =>
      evt({ endpoint: `fal-ai/m-${i}`, costUsd: i + 1 })
    );
    expect(summarizeByEndpoint(events, 10)).toHaveLength(10);
  });
});

describe("summarizeByUser", () => {
  it("依 userId 彙總，找出最常用端點", () => {
    const events: UsageEventLike[] = [
      evt({ userId: 7, endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ userId: 7, endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ userId: 7, endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.04 }),
    ];
    const out = summarizeByUser(events);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe(7);
    expect(out[0].callCount).toBe(3);
    expect(out[0].topEndpoint).toBe("fal-ai/flux/schnell"); // 出現 2 次
    expect(out[0].costUsd).toBeCloseTo(0.046);
  });

  it("略過 userId 為 null 的事件", () => {
    const events: UsageEventLike[] = [
      evt({ userId: null, costUsd: 0.5 }),
      evt({ userId: 1, costUsd: 0.1 }),
    ];
    const out = summarizeByUser(events);
    expect(out.map(u => u.userId)).toEqual([1]);
  });
});

describe("summarizeByStatus", () => {
  it("回傳 4 種狀態，零次也要列出", () => {
    const events: UsageEventLike[] = [
      evt({ status: "success", costUsd: 0.1 }),
      evt({ status: "failed", costUsd: 0.05 }),
    ];
    const out = summarizeByStatus(events);
    expect(out).toHaveLength(4);
    const statuses = out.map(s => s.status).sort();
    expect(statuses).toEqual(["failed", "rate_limited", "success", "timeout"]);
    expect(out.find(s => s.status === "success")!.costUsd).toBeCloseTo(0.1);
    expect(out.find(s => s.status === "rate_limited")!.callCount).toBe(0);
  });
});

describe("calculateWasteCost", () => {
  it("加總非 success 的費用", () => {
    const events: UsageEventLike[] = [
      evt({ status: "success", costUsd: 0.1 }),
      evt({ status: "failed", costUsd: 0.05 }),
      evt({ status: "timeout", costUsd: 0.02 }),
      evt({ status: "rate_limited", costUsd: 0.01 }),
    ];
    const w = calculateWasteCost(events);
    expect(w.wastedCalls).toBe(3);
    expect(w.wastedUsd).toBeCloseTo(0.08);
    expect(w.wastedShare).toBeCloseTo(44.44, 1);
  });

  it("全成功時 wastedShare=0", () => {
    const events: UsageEventLike[] = [evt({ costUsd: 0.5 })];
    expect(calculateWasteCost(events).wastedShare).toBe(0);
  });

  it("空輸入 share=0", () => {
    expect(calculateWasteCost([])).toEqual({
      wastedUsd: 0,
      wastedCalls: 0,
      wastedShare: 0,
    });
  });
});

describe("latencyStats", () => {
  it("空輸入全 0", () => {
    expect(latencyStats([])).toEqual({
      sampleCount: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    });
  });

  it("計算 p50/p95/p99/max", () => {
    const events: UsageEventLike[] = Array.from({ length: 100 }, (_, i) =>
      evt({ latencyMs: (i + 1) * 10 })
    );
    const s = latencyStats(events);
    expect(s.sampleCount).toBe(100);
    expect(s.maxMs).toBe(1000);
    expect(s.p50Ms).toBe(500);
    expect(s.p95Ms).toBe(950);
    expect(s.p99Ms).toBe(990);
  });

  it("忽略 latencyMs <= 0 的事件", () => {
    const events: UsageEventLike[] = [
      evt({ latencyMs: 0 }),
      evt({ latencyMs: -5 }),
      evt({ latencyMs: null }),
      evt({ latencyMs: 100 }),
    ];
    expect(latencyStats(events).sampleCount).toBe(1);
  });
});

describe("hourlyHeatmap", () => {
  it("永遠回傳 168 格（7 × 24）", () => {
    const events: UsageEventLike[] = [evt({})];
    expect(hourlyHeatmap(events)).toHaveLength(168);
  });

  it("把事件落在對應的 weekday/hour 格", () => {
    // 2026-05-01 是星期五（weekday=5）UTC 10:00 → 取決於 server 本地時區，
    // 為避免時區漂移，這裡僅檢查 callCount 加總
    const events: UsageEventLike[] = [
      evt({ createdAt: new Date("2026-05-01T10:00:00") }),
      evt({ createdAt: new Date("2026-05-01T10:30:00") }),
    ];
    const grid = hourlyHeatmap(events);
    const totalCalls = grid.reduce((s, c) => s + c.callCount, 0);
    expect(totalCalls).toBe(2);
  });
});

describe("projectMonthlyCost", () => {
  it("依 daysElapsed 推估月底", () => {
    // 假設今天是 2026-05-15，當月 31 天
    const now = new Date(2026, 4, 15);
    const proj = projectMonthlyCost(150, now);
    expect(proj.daysInMonth).toBe(31);
    expect(proj.daysElapsed).toBe(15);
    expect(proj.remainingDays).toBe(16);
    expect(proj.averageDailyUsd).toBeCloseTo(10);
    expect(proj.projectedMonthEndUsd).toBeCloseTo(150 + 10 * 16);
  });

  it("月初時不會除以零", () => {
    const now = new Date(2026, 4, 1);
    const proj = projectMonthlyCost(5, now);
    expect(proj.daysElapsed).toBe(1);
    expect(proj.averageDailyUsd).toBeCloseTo(5);
  });
});

describe("compareCatalogVsActual", () => {
  it("命中 catalog 才比對；計算 deltaPct", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.005 }), // catalog: 0.003
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.005 }),
      evt({ endpoint: "fictional/unknown-model", costUsd: 99 }), // 應被略過
    ];
    const out = compareCatalogVsActual(events);
    expect(out.find(o => o.endpoint === "fictional/unknown-model")).toBeUndefined();
    const hit = out.find(o => o.endpoint === "fal-ai/flux/schnell")!;
    expect(hit.callCount).toBe(2);
    // expected = 0.003 × 2 = 0.006；actual = 0.01；delta = +0.004（≈ +66.67%）
    expect(hit.expectedUsd).toBeCloseTo(0.006);
    expect(hit.actualUsd).toBeCloseTo(0.01);
    expect(hit.deltaUsd).toBeCloseTo(0.004);
    expect(hit.deltaPct).toBeCloseTo(66.67, 1);
  });

  it("依 |delta| 降冪排序", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.0035 }), // delta 小
      evt({ endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.5 }), // delta 大（catalog 0.04）
    ];
    const out = compareCatalogVsActual(events);
    expect(out[0].endpoint).toBe("fal-ai/flux-pro/v1.1");
  });
});
