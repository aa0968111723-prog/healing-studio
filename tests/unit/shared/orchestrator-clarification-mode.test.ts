/**
 * tests/unit/shared/orchestrator-clarification-mode.test.ts
 *
 * Mode-aware clarification threshold (`clarificationThresholdFor`):
 *   • navigate / ask-feature lowers the bar (user already declared their
 *     intent by picking the mode — don't pepper them with a wizard).
 *   • multi-step raises it (autonomous execution deserves more confirmation).
 *   • plan keeps the default appetite.
 *   • undefined mode falls back to the legacy behaviour.
 */
import { describe, expect, it } from "vitest";
import { clarificationThresholdFor } from "../../../shared/orchestrator-clarification";

describe("clarificationThresholdFor — mode-aware", () => {
  const baseCtx = { userMessage: "幫我做" };

  it("lowers the bar for navigate mode", () => {
    const navigateBar = clarificationThresholdFor({ ...baseCtx, requestedMode: "navigate" });
    const defaultBar = clarificationThresholdFor(baseCtx);
    expect(navigateBar).toBeLessThan(defaultBar);
  });

  it("lowers the bar for ask-feature mode", () => {
    const askBar = clarificationThresholdFor({ ...baseCtx, requestedMode: "ask-feature" });
    const defaultBar = clarificationThresholdFor(baseCtx);
    expect(askBar).toBeLessThan(defaultBar);
  });

  it("raises the bar for multi-step mode", () => {
    const multiBar = clarificationThresholdFor({ ...baseCtx, requestedMode: "multi-step" });
    const defaultBar = clarificationThresholdFor(baseCtx);
    expect(multiBar).toBeGreaterThan(defaultBar);
  });

  it("keeps the default appetite for plan mode", () => {
    const planBar = clarificationThresholdFor({ ...baseCtx, requestedMode: "plan" });
    const defaultBar = clarificationThresholdFor(baseCtx);
    expect(planBar).toBe(defaultBar);
  });

  it("clamps the result within [0.50, 0.85]", () => {
    // Stack every modifier that lowers the bar — should still clamp at 0.5.
    const veryLow = clarificationThresholdFor({
      ...baseCtx,
      requestedMode: "navigate",
      rememberedPreferences: {
        usualProjectSize: "single_asset",
        typicalTimeline: "urgent",
        preferredQuality: "cost_sensitive",
      },
    });
    expect(veryLow).toBeGreaterThanOrEqual(0.5);

    // Stack every modifier that raises the bar — should still clamp at 0.85.
    const veryHigh = clarificationThresholdFor({
      ...baseCtx,
      requestedMode: "multi-step",
      rememberedPreferences: {
        usualProjectSize: "campaign",
        typicalTimeline: "exploratory",
        preferredQuality: "quality_first",
      },
    });
    expect(veryHigh).toBeLessThanOrEqual(0.85);
  });
});
