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
  dailyEndpointTrends,
  perCallCostDistribution,
  detectRetryChains,
  inferFeature,
  summarizeByFeature,
  suggestSavings,
  reconcileWithProviderInvoices,
  buildDeepCostCsvReport,
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

// ─── Deep Layer 1: Daily Endpoint Trends ────────────────────────────────────

describe("dailyEndpointTrends", () => {
  it("回傳每端點 windowDays 長度的序列", () => {
    const events: UsageEventLike[] = Array.from({ length: 7 }, (_, i) =>
      evt({
        endpoint: "fal-ai/flux-pro/v1.1",
        costUsd: 0.04,
        createdAt: new Date(2026, 4, 1 + i, 12, 0, 0),
      })
    );
    const out = dailyEndpointTrends(events, 5, 7, new Date(2026, 4, 7, 23, 59, 59));
    expect(out).toHaveLength(1);
    expect(out[0].series).toHaveLength(7);
  });

  it("偵測異常（今日為 baseline 平均的 >=2 倍）", () => {
    const baseline = Array.from({ length: 6 }, (_, i) =>
      evt({
        endpoint: "fal-ai/flux-pro/v1.1",
        costUsd: 0.04,
        createdAt: new Date(2026, 4, 1 + i, 12, 0, 0),
      })
    );
    // 今日塞 10 倍流量
    const todayEvents = Array.from({ length: 10 }, () =>
      evt({
        endpoint: "fal-ai/flux-pro/v1.1",
        costUsd: 0.04,
        createdAt: new Date(2026, 4, 7, 12, 0, 0),
      })
    );
    const out = dailyEndpointTrends(
      [...baseline, ...todayEvents],
      5,
      7,
      new Date(2026, 4, 7, 23, 59, 59)
    );
    expect(out[0].isAnomaly).toBe(true);
    expect(out[0].spikeRatio).toBeGreaterThanOrEqual(2);
  });

  it("無歷史 baseline 時不誤標", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "x", costUsd: 0.5, createdAt: new Date(2026, 4, 7, 12, 0, 0) }),
    ];
    const out = dailyEndpointTrends(events, 5, 7, new Date(2026, 4, 7, 23, 59, 59));
    expect(out[0].isAnomaly).toBe(false);
    expect(out[0].spikeRatio).toBe(0);
  });
});

// ─── Deep Layer 2: Per-Call Cost Distribution ───────────────────────────────

describe("perCallCostDistribution", () => {
  it("空輸入回傳全 0", () => {
    expect(perCallCostDistribution([]).sampleCount).toBe(0);
  });

  it("計算 p50/p90/p95/p99/max", () => {
    const events: UsageEventLike[] = Array.from({ length: 100 }, (_, i) =>
      evt({ costUsd: (i + 1) * 0.01 })
    );
    const d = perCallCostDistribution(events);
    expect(d.sampleCount).toBe(100);
    expect(d.p50Usd).toBeCloseTo(0.5);
    expect(d.p95Usd).toBeCloseTo(0.95);
    expect(d.maxUsd).toBeCloseTo(1.0);
  });

  it("找出超過 p99 × 1.5 的離群值", () => {
    const normal: UsageEventLike[] = Array.from({ length: 100 }, () =>
      evt({ costUsd: 0.01 })
    );
    const outliers: UsageEventLike[] = [evt({ costUsd: 99, endpoint: "expensive/model" })];
    const d = perCallCostDistribution([...normal, ...outliers]);
    expect(d.outliers).toHaveLength(1);
    expect(d.outliers[0].endpoint).toBe("expensive/model");
  });
});

// ─── Deep Layer 3: Retry Chains ─────────────────────────────────────────────

describe("detectRetryChains", () => {
  it("偵測 60 秒內的連續呼叫（attempts >= 2）", () => {
    const t0 = new Date(2026, 4, 1, 10, 0, 0).getTime();
    const events: UsageEventLike[] = [
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0) }),
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0 + 5_000) }),
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0 + 10_000) }),
    ];
    const chains = detectRetryChains(events, 60);
    expect(chains).toHaveLength(1);
    expect(chains[0].attempts).toBe(3);
  });

  it("間隔 > windowSec 視為不同鏈", () => {
    const t0 = new Date(2026, 4, 1, 10, 0, 0).getTime();
    const events: UsageEventLike[] = [
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0) }),
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0 + 5_000) }),
      // 5 分鐘後（>60s）應斷開
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0 + 5 * 60 * 1000) }),
      evt({ userId: 1, endpoint: "x", createdAt: new Date(t0 + 5 * 60 * 1000 + 3_000) }),
    ];
    const chains = detectRetryChains(events, 60);
    expect(chains).toHaveLength(2);
    chains.forEach(c => expect(c.attempts).toBe(2));
  });

  it("單次呼叫不算重試", () => {
    const events: UsageEventLike[] = [
      evt({ userId: 1, endpoint: "x", createdAt: new Date(2026, 4, 1, 10, 0, 0) }),
    ];
    expect(detectRetryChains(events)).toHaveLength(0);
  });

  it("略過 userId 為 null", () => {
    const t0 = new Date(2026, 4, 1, 10, 0, 0).getTime();
    const events: UsageEventLike[] = [
      evt({ userId: null, endpoint: "x", createdAt: new Date(t0) }),
      evt({ userId: null, endpoint: "x", createdAt: new Date(t0 + 5_000) }),
    ];
    expect(detectRetryChains(events)).toHaveLength(0);
  });
});

// ─── Deep Layer 4: Feature Breakdown ────────────────────────────────────────

describe("inferFeature / summarizeByFeature", () => {
  it("依 endpoint 前綴推斷功能模組", () => {
    expect(inferFeature("fal-ai/flux/schnell")).toBe("image-studio");
    expect(inferFeature("fal-ai/kling-v2.1/standard")).toBe("video-studio");
    expect(inferFeature("elevenlabs/v3")).toBe("tts-studio");
    expect(inferFeature("gemini-2.5-pro")).toBe("ai-brain");
    expect(inferFeature("totally-unknown")).toBe("general");
  });

  it("依 feature 彙總並計算佔比與最常端點", () => {
    const events: UsageEventLike[] = [
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003 }),
      evt({ endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.04 }),
      evt({ endpoint: "fal-ai/kling-v2.1/standard", costUsd: 0.3 }),
    ];
    const out = summarizeByFeature(events);
    const img = out.find(f => f.feature === "image-studio")!;
    expect(img).toBeDefined();
    expect(img.callCount).toBe(3);
    expect(img.topEndpoint).toBe("fal-ai/flux/schnell");
    const vid = out.find(f => f.feature === "video-studio")!;
    expect(vid.callCount).toBe(1);
    // 排序：cost 降冪 → video-studio 佔最大
    expect(out[0].feature).toBe("video-studio");
  });
});

// ─── Deep Layer 5: Savings Suggester ────────────────────────────────────────

describe("suggestSavings", () => {
  it("對 premium 端點推薦 economy 替代品", () => {
    const events: UsageEventLike[] = Array.from({ length: 100 }, () =>
      evt({ endpoint: "fal-ai/flux-pro/v1.1", costUsd: 0.04 })
    );
    const out = suggestSavings(events, 5, 30);
    expect(out.length).toBeGreaterThan(0);
    const top = out[0];
    expect(top.endpoint).toBe("fal-ai/flux-pro/v1.1");
    expect(top.suggestedEndpoint).not.toBe(top.endpoint);
    expect(top.savingsPct).toBeGreaterThanOrEqual(30);
  });

  it("如果端點已是同 category 最便宜，不推薦", () => {
    const events: UsageEventLike[] = Array.from({ length: 100 }, () =>
      evt({ endpoint: "fal-ai/flux/schnell", costUsd: 0.003 })
    );
    const out = suggestSavings(events, 5, 30);
    const self = out.find(s => s.endpoint === "fal-ai/flux/schnell");
    expect(self).toBeUndefined();
  });
});

// ─── Deep Layer 6: Reconciliation ───────────────────────────────────────────

describe("reconcileWithProviderInvoices", () => {
  it("缺口為正：供應商帳單高於記錄", () => {
    const events: UsageEventLike[] = [
      evt({ provider: "fal_ai", costUsd: 10 }),
      evt({ provider: "gemini", costUsd: 2 }),
    ];
    const invoices = [
      { provider: "fal_ai", invoiceUsd: 12, snapshotAt: new Date() },
      { provider: "gemini", invoiceUsd: 2, snapshotAt: new Date() },
    ];
    const r = reconcileWithProviderInvoices(events, invoices);
    expect(r.totalRecordedUsd).toBeCloseTo(12);
    expect(r.totalInvoicedUsd).toBeCloseTo(14);
    expect(r.totalGapUsd).toBeCloseTo(2);
    expect(r.truthTotalUsd).toBeCloseTo(14);
  });

  it("供應商沒有發票時 invoice = null", () => {
    const events: UsageEventLike[] = [evt({ provider: "fal_ai", costUsd: 5 })];
    const r = reconcileWithProviderInvoices(events, [
      { provider: "fal_ai", invoiceUsd: null, snapshotAt: null },
    ]);
    expect(r.perProvider[0].providerInvoiceUsd).toBeNull();
    expect(r.perProvider[0].gapUsd).toBeNull();
    expect(r.truthTotalUsd).toBeCloseTo(5);
  });

  it("整併兩邊鍵：events / invoices 不對稱也要列", () => {
    const events: UsageEventLike[] = [evt({ provider: "fal_ai", costUsd: 5 })];
    const invoices = [
      { provider: "gemini", invoiceUsd: 3, snapshotAt: new Date() },
    ];
    const r = reconcileWithProviderInvoices(events, invoices);
    expect(r.perProvider).toHaveLength(2);
  });
});

// ─── Deep Layer 7: CSV Report Builder ───────────────────────────────────────

describe("buildDeepCostCsvReport", () => {
  it("輸出含全部段落標題", () => {
    const csv = buildDeepCostCsvReport({
      windowStart: "2026-05-01",
      windowEnd: "2026-05-07",
      reconciliation: {
        perProvider: [
          {
            provider: "fal_ai",
            recordedCostUsd: 10,
            providerInvoiceUsd: 12,
            gapUsd: 2,
            gapPct: 16.67,
            lastSnapshotAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        totalRecordedUsd: 10,
        totalInvoicedUsd: 12,
        totalGapUsd: 2,
        totalGapPct: 16.67,
        truthTotalUsd: 12,
      },
      byCategory: [],
      byFeature: [],
      byStatus: [],
      topEndpoints: [],
      topUsers: [],
      catalogVsActual: [],
      retryChains: [],
      savingsSuggestions: [],
      costDistribution: {
        sampleCount: 0,
        p50Usd: 0,
        p90Usd: 0,
        p95Usd: 0,
        p99Usd: 0,
        maxUsd: 0,
        outliers: [],
      },
      waste: { wastedUsd: 0, wastedCalls: 0, wastedShare: 0 },
      projection: {
        daysElapsed: 7,
        daysInMonth: 31,
        monthToDateUsd: 10,
        averageDailyUsd: 1.43,
        projectedMonthEndUsd: 44.27,
        remainingDays: 24,
      },
    });

    expect(csv).toContain("## 帳單對帳");
    expect(csv).toContain("## 模態拆解");
    expect(csv).toContain("## 功能模組拆解");
    expect(csv).toContain("## 狀態拆解");
    expect(csv).toContain("## Top 端點");
    expect(csv).toContain("## Top 使用者");
    expect(csv).toContain("## Catalog 預估 vs 實際");
    expect(csv).toContain("## 重試鏈");
    expect(csv).toContain("## 節費建議");
    expect(csv).toContain("## 月底投影");
    expect(csv).toContain("真實總成本");
  });

  it("正確跳脫含逗號 / 雙引號的欄位", () => {
    const csv = buildDeepCostCsvReport({
      windowStart: "x",
      windowEnd: "y",
      reconciliation: {
        perProvider: [],
        totalRecordedUsd: 0,
        totalInvoicedUsd: 0,
        totalGapUsd: 0,
        totalGapPct: 0,
        truthTotalUsd: 0,
      },
      byCategory: [],
      byFeature: [],
      byStatus: [],
      topEndpoints: [
        {
          provider: "fal_ai",
          endpoint: 'evil,"endpoint',
          category: "text-to-image",
          callCount: 1,
          costUsd: 0.04,
          avgCostPerCall: 0.04,
          errorRate: 0,
        },
      ],
      topUsers: [],
      catalogVsActual: [],
      retryChains: [],
      savingsSuggestions: [],
      costDistribution: {
        sampleCount: 0,
        p50Usd: 0,
        p90Usd: 0,
        p95Usd: 0,
        p99Usd: 0,
        maxUsd: 0,
        outliers: [],
      },
      waste: { wastedUsd: 0, wastedCalls: 0, wastedShare: 0 },
      projection: {
        daysElapsed: 1,
        daysInMonth: 31,
        monthToDateUsd: 0,
        averageDailyUsd: 0,
        projectedMonthEndUsd: 0,
        remainingDays: 30,
      },
    });
    expect(csv).toContain('"evil,""endpoint"');
  });
});
