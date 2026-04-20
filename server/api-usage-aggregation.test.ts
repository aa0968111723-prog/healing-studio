/**
 * api-usage-aggregation.test.ts — Unit tests for API usage aggregation logic & alert threshold calculations
 *
 * Tests cover:
 *   1. Cost aggregation helpers (grouping, summing)
 *   2. Budget alert threshold calculations
 *   3. Quota alert threshold calculations
 *   4. Anomaly detection (error rate, latency)
 *   5. Rate limit enforcement logic
 *   6. CSV export formatting
 */

import { describe, it, expect } from "vitest";

// ─── Types matching schema ──────────────────────────────────────────────────

interface UsageEvent {
  provider: string;
  endpoint: string;
  status: "success" | "failed" | "timeout" | "rate_limited";
  costUsd: number;
  latencyMs: number;
  createdAt: Date;
}

interface CostAggregation {
  provider: string;
  endpoint: string;
  date: string;
  callCount: number;
  totalUnits: number;
  totalCostUsd: number;
}

// ─── Aggregation Helpers (extracted logic) ──────────────────────────────────

function aggregateUsageEvents(events: UsageEvent[]): CostAggregation[] {
  const map = new Map<string, CostAggregation>();

  for (const event of events) {
    const date = event.createdAt.toISOString().slice(0, 10);
    const key = `${event.provider}|${event.endpoint}|${date}`;

    if (!map.has(key)) {
      map.set(key, {
        provider: event.provider,
        endpoint: event.endpoint,
        date,
        callCount: 0,
        totalUnits: 0,
        totalCostUsd: 0,
      });
    }

    const agg = map.get(key)!;
    agg.callCount += 1;
    agg.totalCostUsd += event.costUsd;
  }

  return Array.from(map.values());
}

/**
 * Budget alert fires when: todaySpend > (monthlyBudget × (dayOfMonth / daysInMonth) × 1.3)
 */
function shouldFireBudgetAlert(
  todaySpend: number,
  monthlyBudget: number,
  dayOfMonth: number,
  daysInMonth: number
): boolean {
  if (monthlyBudget <= 0) return false;
  const expectedDailyPace = (monthlyBudget * dayOfMonth) / daysInMonth;
  const threshold = expectedDailyPace * 1.3;
  return todaySpend > threshold;
}

function calculateErrorRate(events: UsageEvent[]): number {
  if (events.length === 0) return 0;
  const errors = events.filter(e => e.status !== "success").length;
  return (errors / events.length) * 100;
}

function getQuotaAlertLevel(remaining: number, quota: number): "critical" | "warning" | "ok" {
  if (quota <= 0) return "ok";
  const pct = (remaining / quota) * 100;
  if (pct < 5) return "critical";
  if (pct < 20) return "warning";
  return "ok";
}

function calculateP95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function shouldRateLimit(
  dailyCalls: number,
  dailyCost: number,
  callLimit: number | null,
  costLimit: number | null
): { limited: boolean; reason?: string } {
  if (callLimit !== null && dailyCalls >= callLimit) {
    return { limited: true, reason: `Daily call limit exceeded (${callLimit})` };
  }
  if (costLimit !== null && dailyCost >= costLimit) {
    return { limited: true, reason: `Daily cost limit exceeded ($${costLimit})` };
  }
  return { limited: false };
}

function formatBillingCsv(
  rows: CostAggregation[],
  headers = ["Provider", "Endpoint", "Date", "Calls", "Units", "Cost (USD)"]
): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.provider,
        `"${row.endpoint}"`,
        row.date,
        row.callCount,
        row.totalUnits,
        row.totalCostUsd.toFixed(6),
      ].join(",")
    );
  }
  return lines.join("\n");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Cost Aggregation", () => {
  it("groups events by provider + endpoint + date", () => {
    const events: UsageEvent[] = [
      { provider: "fal_ai", endpoint: "flux-pro", status: "success", costUsd: 0.05, latencyMs: 200, createdAt: new Date("2026-04-15T10:00:00Z") },
      { provider: "fal_ai", endpoint: "flux-pro", status: "success", costUsd: 0.05, latencyMs: 300, createdAt: new Date("2026-04-15T14:00:00Z") },
      { provider: "gemini", endpoint: "gemini-2.5-pro", status: "success", costUsd: 0.001, latencyMs: 100, createdAt: new Date("2026-04-15T10:00:00Z") },
      { provider: "fal_ai", endpoint: "flux-pro", status: "failed", costUsd: 0, latencyMs: 50, createdAt: new Date("2026-04-16T10:00:00Z") },
    ];
    const agg = aggregateUsageEvents(events);
    expect(agg).toHaveLength(3);
    const falApril15 = agg.find(a => a.provider === "fal_ai" && a.date === "2026-04-15");
    expect(falApril15).toBeDefined();
    expect(falApril15!.callCount).toBe(2);
    expect(falApril15!.totalCostUsd).toBeCloseTo(0.10);
  });

  it("handles empty event list", () => {
    expect(aggregateUsageEvents([])).toHaveLength(0);
  });

  it("aggregates single event correctly", () => {
    const events: UsageEvent[] = [
      { provider: "suno", endpoint: "music-generation", status: "success", costUsd: 0.5, latencyMs: 5000, createdAt: new Date("2026-04-20T08:00:00Z") },
    ];
    const agg = aggregateUsageEvents(events);
    expect(agg).toHaveLength(1);
    expect(agg[0].callCount).toBe(1);
    expect(agg[0].totalCostUsd).toBeCloseTo(0.5);
  });
});

describe("Budget Alert Threshold", () => {
  it("fires alert when daily spend exceeds 130% of expected pace", () => {
    expect(shouldFireBudgetAlert(150, 300, 10, 30)).toBe(true);
  });

  it("does not fire when spend is within threshold", () => {
    expect(shouldFireBudgetAlert(100, 300, 10, 30)).toBe(false);
  });

  it("does not fire on zero budget", () => {
    expect(shouldFireBudgetAlert(100, 0, 10, 30)).toBe(false);
  });

  it("fires at start of month with high spend", () => {
    expect(shouldFireBudgetAlert(20, 300, 1, 30)).toBe(true);
  });

  it("handles last day of month correctly", () => {
    expect(shouldFireBudgetAlert(400, 300, 30, 30)).toBe(true);
    expect(shouldFireBudgetAlert(380, 300, 30, 30)).toBe(false);
  });

  it("handles February (28 days)", () => {
    expect(shouldFireBudgetAlert(190, 280, 14, 28)).toBe(true);
    expect(shouldFireBudgetAlert(180, 280, 14, 28)).toBe(false);
  });
});

describe("Error Rate Calculation", () => {
  it("calculates zero for all successful events", () => {
    const events: UsageEvent[] = Array.from({ length: 10 }, () => ({
      provider: "gemini", endpoint: "chat", status: "success" as const,
      costUsd: 0.001, latencyMs: 100, createdAt: new Date(),
    }));
    expect(calculateErrorRate(events)).toBe(0);
  });

  it("calculates correct rate for mixed events", () => {
    const events: UsageEvent[] = [
      { provider: "fal_ai", endpoint: "flux", status: "success", costUsd: 0.05, latencyMs: 200, createdAt: new Date() },
      { provider: "fal_ai", endpoint: "flux", status: "failed", costUsd: 0, latencyMs: 50, createdAt: new Date() },
      { provider: "fal_ai", endpoint: "flux", status: "timeout", costUsd: 0, latencyMs: 120000, createdAt: new Date() },
      { provider: "fal_ai", endpoint: "flux", status: "success", costUsd: 0.05, latencyMs: 250, createdAt: new Date() },
    ];
    expect(calculateErrorRate(events)).toBe(50);
  });

  it("returns zero for empty event list", () => {
    expect(calculateErrorRate([])).toBe(0);
  });

  it("returns 100 for all failed events", () => {
    const events: UsageEvent[] = Array.from({ length: 5 }, () => ({
      provider: "suno", endpoint: "music", status: "failed" as const,
      costUsd: 0, latencyMs: 50, createdAt: new Date(),
    }));
    expect(calculateErrorRate(events)).toBe(100);
  });
});

describe("Quota Alert Level", () => {
  it("returns critical for < 5%", () => {
    expect(getQuotaAlertLevel(4, 100)).toBe("critical");
    expect(getQuotaAlertLevel(0, 100)).toBe("critical");
  });

  it("returns warning for 5-20%", () => {
    expect(getQuotaAlertLevel(19, 100)).toBe("warning");
    expect(getQuotaAlertLevel(5, 100)).toBe("warning");
  });

  it("returns ok for >= 20%", () => {
    expect(getQuotaAlertLevel(20, 100)).toBe("ok");
    expect(getQuotaAlertLevel(100, 100)).toBe("ok");
  });

  it("returns ok for zero quota (avoid division by zero)", () => {
    expect(getQuotaAlertLevel(0, 0)).toBe("ok");
  });
});

describe("P95 Latency Calculation", () => {
  it("calculates P95 correctly for 100 items", () => {
    const latencies = Array.from({ length: 100 }, (_, i) => (i + 1) * 10);
    expect(calculateP95(latencies)).toBe(950);
  });

  it("handles single value", () => {
    expect(calculateP95([500])).toBe(500);
  });

  it("handles empty array", () => {
    expect(calculateP95([])).toBe(0);
  });

  it("handles unsorted input", () => {
    const latencies = [300, 100, 500, 200, 400];
    expect(calculateP95(latencies)).toBe(500);
  });

  it("detects latency spike (P95 doubling)", () => {
    const baseline = Array.from({ length: 20 }, () => 100);
    const spiked = Array.from({ length: 20 }, () => 250);
    expect(calculateP95(spiked) / calculateP95(baseline)).toBeGreaterThan(2);
  });
});

describe("Rate Limit Enforcement", () => {
  it("limits when daily calls exceed limit", () => {
    const result = shouldRateLimit(100, 5, 100, null);
    expect(result.limited).toBe(true);
    expect(result.reason).toContain("call limit");
  });

  it("limits when daily cost exceeds limit", () => {
    const result = shouldRateLimit(50, 10.5, null, 10);
    expect(result.limited).toBe(true);
    expect(result.reason).toContain("cost limit");
  });

  it("allows when within limits", () => {
    expect(shouldRateLimit(50, 5, 100, 10).limited).toBe(false);
  });

  it("allows when no limits set", () => {
    expect(shouldRateLimit(1000, 100, null, null).limited).toBe(false);
  });

  it("call limit takes priority over cost limit", () => {
    const result = shouldRateLimit(100, 100, 100, 100);
    expect(result.limited).toBe(true);
    expect(result.reason).toContain("call limit");
  });
});

describe("CSV Export Formatting", () => {
  it("formats billing rows as CSV", () => {
    const rows: CostAggregation[] = [
      { provider: "fal_ai", endpoint: "fal-ai/flux-pro", date: "2026-04-15", callCount: 10, totalUnits: 10, totalCostUsd: 0.5 },
      { provider: "gemini", endpoint: "gemini-2.5-pro", date: "2026-04-15", callCount: 100, totalUnits: 50000, totalCostUsd: 0.0625 },
    ];
    const csv = formatBillingCsv(rows);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Provider,Endpoint,Date,Calls,Units,Cost (USD)");
    expect(lines[1]).toContain("fal_ai");
    expect(lines[1]).toContain("0.500000");
  });

  it("handles empty rows", () => {
    const csv = formatBillingCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });

  it("quotes endpoint values with special characters", () => {
    const rows: CostAggregation[] = [
      { provider: "fal_ai", endpoint: "fal-ai/flux-pro/v1.1", date: "2026-04-15", callCount: 5, totalUnits: 5, totalCostUsd: 0.25 },
    ];
    expect(formatBillingCsv(rows)).toContain('"fal-ai/flux-pro/v1.1"');
  });
});
