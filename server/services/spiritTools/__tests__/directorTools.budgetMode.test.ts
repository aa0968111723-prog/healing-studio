import { describe, it, expect } from "vitest";
import {
  selectBudgetModeFromQuota,
  type BudgetMode,
} from "../directorTools";
import type { OrbQuotaSnapshot } from "../../orbQuota";

function makeSnapshot(used: number, limit: number): OrbQuotaSnapshot {
  return {
    userId: 1,
    dayKey: "2026-06-29",
    categories: [
      { category: "generation", used, limit, remaining: limit - used },
    ],
  };
}

describe("selectBudgetModeFromQuota", () => {
  it("returns premium when quota is abundant (>66% remaining)", () => {
    const result = selectBudgetModeFromQuota(makeSnapshot(5, 40));
    expect(result.mode).toBe("premium");
    expect(result.autoSelected).toBe(true);
  });

  it("returns balanced when quota is moderate (33–66% remaining)", () => {
    const result = selectBudgetModeFromQuota(makeSnapshot(20, 40)); // 50% remaining
    expect(result.mode).toBe("balanced");
    expect(result.autoSelected).toBe(true);
  });

  it("returns cheap when quota is tight (<33% remaining)", () => {
    const result = selectBudgetModeFromQuota(makeSnapshot(30, 40)); // 25% remaining
    expect(result.mode).toBe("cheap");
    expect(result.autoSelected).toBe(true);
  });

  it("respects user costPreference override regardless of quota", () => {
    const result = selectBudgetModeFromQuota(makeSnapshot(30, 40), "premium");
    expect(result.mode).toBe("premium");
    expect(result.autoSelected).toBe(false);
  });

  it("returns balanced when no quotaSnapshot is provided", () => {
    const result = selectBudgetModeFromQuota(null);
    expect(result.mode).toBe("balanced");
    expect(result.autoSelected).toBe(true);
  });

  it("returns balanced when quotaSnapshot is undefined", () => {
    const result = selectBudgetModeFromQuota(undefined);
    expect(result.mode).toBe("balanced");
    expect(result.autoSelected).toBe(true);
  });

  it("returns balanced when generation category is absent", () => {
    const snap: OrbQuotaSnapshot = {
      userId: 1,
      dayKey: "2026-06-29",
      categories: [],
    };
    const result = selectBudgetModeFromQuota(snap);
    expect(result.mode).toBe("balanced");
    expect(result.autoSelected).toBe(true);
  });

  it("returns balanced when generation limit is 0", () => {
    const snap: OrbQuotaSnapshot = {
      userId: 1,
      dayKey: "2026-06-29",
      categories: [{ category: "generation", used: 0, limit: 0, remaining: 0 }],
    };
    const result = selectBudgetModeFromQuota(snap);
    expect(result.mode).toBe("balanced");
    expect(result.autoSelected).toBe(true);
  });

  it("includes a reason string describing the decision", () => {
    const result = selectBudgetModeFromQuota(makeSnapshot(5, 40));
    expect(result.reason).toBeTruthy();
    expect(typeof result.reason).toBe("string");
  });
});
