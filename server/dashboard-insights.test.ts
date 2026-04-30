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
});
