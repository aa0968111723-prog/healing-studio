import { describe, expect, it } from "vitest";
import {
  computeDashboardInsights,
  type DashboardInsightsInput,
} from "../shared/dashboard-insights";

const today = "2026-04-30";

function baseInput(
  overrides: Partial<DashboardInsightsInput> = {}
): DashboardInsightsInput {
  return {
    remainingGenerations: 100,
    totalRequests: 0,
    totalCost: 0,
    modalityBreakdown: [],
    dailyTrend: [],
    today,
    ...overrides,
  };
}

describe("computeDashboardInsights", () => {
  it("returns ok risk level when there is no usage", () => {
    const out = computeDashboardInsights(baseInput());
    expect(out.riskLevel).toBe("ok");
    expect(out.anomalies).toHaveLength(0);
    expect(out.costTrend.todayCost).toBe(0);
    expect(out.costTrend.dayOverDayPct).toBeNull();
    expect(out.topModality).toBeNull();
  });

  it("flags a cost spike when today exceeds 1.5x trailing average", () => {
    const out = computeDashboardInsights(
      baseInput({
        dailyTrend: [
          { date: "2026-04-26", count: 5, totalCost: 0.1 },
          { date: "2026-04-27", count: 5, totalCost: 0.1 },
          { date: "2026-04-28", count: 5, totalCost: 0.1 },
          { date: "2026-04-29", count: 5, totalCost: 0.1 },
          { date: today, count: 20, totalCost: 0.5 },
        ],
      })
    );
    expect(out.costTrend.anomaly).toBe(true);
    expect(out.costTrend.dayOverDayPct).toBe(400);
    expect(out.anomalies.some(a => a.code === "cost_spike")).toBe(true);
    expect(out.recommendations.length).toBeGreaterThan(0);
    expect(out.riskLevel).toBe("warn");
  });

  it("does not flag a spike when today's cost is tiny absolute amount", () => {
    const out = computeDashboardInsights(
      baseInput({
        dailyTrend: [
          { date: "2026-04-29", count: 1, totalCost: 0.001 },
          { date: today, count: 1, totalCost: 0.01 },
        ],
      })
    );
    expect(out.costTrend.anomaly).toBe(false);
  });

  it("emits low_credits when remainingGenerations is at or below threshold", () => {
    const out = computeDashboardInsights(
      baseInput({ remainingGenerations: 2 })
    );
    expect(out.anomalies.some(a => a.code === "low_credits")).toBe(true);
    expect(out.riskLevel).toBe("warn");
  });

  it("escalates low_credits to high severity at zero credits", () => {
    const out = computeDashboardInsights(
      baseInput({ remainingGenerations: 0 })
    );
    const a = out.anomalies.find(x => x.code === "low_credits");
    expect(a?.severity).toBe("high");
    expect(out.riskLevel).toBe("high");
  });

  it("identifies the top modality and dominant share", () => {
    const out = computeDashboardInsights(
      baseInput({
        modalityBreakdown: [
          { requestType: "image_generation", count: 8, totalCost: 0.3 },
          { requestType: "video_generation", count: 1, totalCost: 0.05 },
          { requestType: "audio_generation", count: 1, totalCost: 0.01 },
        ],
      })
    );
    expect(out.topModality?.requestType).toBe("image_generation");
    expect(out.topModality?.share).toBeCloseTo(0.8, 2);
    expect(
      out.anomalies.some(a => a.code === "single_modality_dominant")
    ).toBe(true);
  });

  it("emits daily_spend_high when today exceeds dailyCostWarnUsd", () => {
    const out = computeDashboardInsights(
      baseInput({
        dailyTrend: [{ date: today, count: 10, totalCost: 2.0 }],
      })
    );
    expect(
      out.anomalies.some(a => a.code === "daily_spend_high")
    ).toBe(true);
  });

  it("orbSummary contains the key fields the assistant needs", () => {
    const out = computeDashboardInsights(
      baseInput({
        remainingGenerations: 42,
        dailyTrend: [
          { date: "2026-04-29", count: 2, totalCost: 0.02 },
          { date: today, count: 5, totalCost: 0.1 },
        ],
        modalityBreakdown: [
          { requestType: "image_generation", count: 5, totalCost: 0.1 },
        ],
      })
    );
    expect(out.orbSummary).toContain("今日成本");
    expect(out.orbSummary).toContain("剩餘積分：42");
    expect(out.orbSummary).toContain("image_generation");
  });

  it("ranks providers by cost descending and computes shares", () => {
    const out = computeDashboardInsights(
      baseInput({
        providerBreakdown: [
          { apiProvider: "fal-ai", count: 10, totalCost: 0.2 },
          { apiProvider: "openai", count: 4, totalCost: 0.6 },
          { apiProvider: "replicate", count: 2, totalCost: 0.2 },
        ],
      })
    );
    expect(out.providerCostBreakdown.map(p => p.apiProvider)).toEqual([
      "openai",
      "fal-ai",
      "replicate",
    ]);
    expect(out.topProvider?.apiProvider).toBe("openai");
    expect(out.topProvider?.costShare).toBeCloseTo(0.6, 2);
    expect(out.providerCostBreakdown[1].costShare).toBeCloseTo(0.2, 2);
    expect(out.orbSummary).toContain("主要提供商：openai");
  });

  it("flags provider concentration when one provider drives >=70% of cost", () => {
    const out = computeDashboardInsights(
      baseInput({
        providerBreakdown: [
          { apiProvider: "openai", count: 10, totalCost: 0.9 },
          { apiProvider: "fal-ai", count: 1, totalCost: 0.1 },
        ],
      })
    );
    expect(
      out.anomalies.some(a => a.code === "provider_concentration")
    ).toBe(true);
    expect(
      out.recommendations.some(r => r.includes("openai"))
    ).toBe(true);
  });

  it("warns about providers with low success rate", () => {
    const out = computeDashboardInsights(
      baseInput({
        providerBreakdown: [
          {
            apiProvider: "flaky-provider",
            count: 10,
            totalCost: 0.05,
            successCount: 4,
            failedCount: 6,
          },
        ],
      })
    );
    const a = out.anomalies.find(x => x.code === "provider_failures");
    expect(a).toBeDefined();
    expect(a?.severity).toBe("warn");
    expect(a?.message).toContain("flaky-provider");
    expect(out.providerCostBreakdown[0].successRate).toBeCloseTo(0.4, 2);
  });

  it("does not flag concentration when provider cost is negligible", () => {
    const out = computeDashboardInsights(
      baseInput({
        providerBreakdown: [
          { apiProvider: "openai", count: 1, totalCost: 0.001 },
        ],
      })
    );
    expect(
      out.anomalies.some(a => a.code === "provider_concentration")
    ).toBe(false);
  });
});
