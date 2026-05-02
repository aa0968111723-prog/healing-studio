/**
 * tests/unit/shared/orb-onboarding-questions.test.ts
 *
 * Verifies the cold-start question schema + answer-derivation logic.
 */
import { describe, expect, it } from "vitest";
import {
  ORB_ONBOARDING_QUESTIONS,
  deriveOnboardingPreferences,
  summarizeOnboardingAnswers,
  type OrbOnboardingAnswers,
} from "../../../shared/orb-onboarding-questions";

describe("ORB_ONBOARDING_QUESTIONS", () => {
  it("has exactly three questions in a stable order", () => {
    expect(ORB_ONBOARDING_QUESTIONS).toHaveLength(3);
    expect(ORB_ONBOARDING_QUESTIONS.map(q => q.id)).toEqual([
      "primary-goal",
      "preferred-pacing",
      "confirmation-style",
    ]);
  });

  it("has at least 3 options per question (so the user has real choice)", () => {
    for (const q of ORB_ONBOARDING_QUESTIONS) {
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      // No duplicate option ids per question.
      const ids = q.options.map(o => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("deriveOnboardingPreferences", () => {
  it("maps 'patient' pacing answer to pacingOverride: patient", () => {
    const d = deriveOnboardingPreferences({ "preferred-pacing": "patient" });
    expect(d.pacingOverride).toBe("patient");
  });

  it("falls back to pacingOverride: auto when the answer is unknown / missing", () => {
    expect(deriveOnboardingPreferences({}).pacingOverride).toBe("auto");
    expect(deriveOnboardingPreferences({ "preferred-pacing": "unknown" }).pacingOverride).toBe("auto");
  });

  it("'always-confirm' confirmation answer maps to confirm_all", () => {
    const d = deriveOnboardingPreferences({ "confirmation-style": "always-confirm" });
    expect(d.confirmationPolicy).toBe("confirm_all");
    // Cap-only is the only answer that seeds a budget.
    expect(d.costBudget).toBeNull();
  });

  it("'cap-only' confirmation answer seeds a 100-credit per-workflow cap", () => {
    const d = deriveOnboardingPreferences({ "confirmation-style": "cap-only" });
    expect(d.confirmationPolicy).toBe("confirm_high_risk");
    expect(d.costBudget).toEqual({
      perWorkflowCap: 100,
      remainingCredits: null,
      confirmAtTierOrAbove: null,
      alwaysAllow: false,
    });
  });

  it("'trust' confirmation answer maps to always_approve and no budget", () => {
    const d = deriveOnboardingPreferences({ "confirmation-style": "trust" });
    expect(d.confirmationPolicy).toBe("always_approve");
    expect(d.costBudget).toBeNull();
  });

  it("welcomeMessageHint reflects the primary-goal selection", () => {
    expect(
      deriveOnboardingPreferences({ "primary-goal": "image" }).welcomeMessageHint
    ).toMatch(/圖片/);
    expect(
      deriveOnboardingPreferences({ "primary-goal": "video" }).welcomeMessageHint
    ).toMatch(/影片/);
    expect(
      deriveOnboardingPreferences({ "primary-goal": "explore" }).welcomeMessageHint
    ).toMatch(/逛逛/);
  });

  it("primaryGoal defaults to 'explore' when the answer is missing", () => {
    expect(deriveOnboardingPreferences({}).primaryGoal).toBe("explore");
  });
});

describe("summarizeOnboardingAnswers", () => {
  it("summarises all three answers when present", () => {
    const answers: OrbOnboardingAnswers = {
      "primary-goal": "image",
      "preferred-pacing": "balanced",
      "confirmation-style": "cap-only",
    };
    const text = summarizeOnboardingAnswers(answers);
    expect(text).toContain("圖片");
    expect(text).toContain("平衡");
    expect(text).toContain("設上限");
  });

  it("returns empty string for empty answers", () => {
    expect(summarizeOnboardingAnswers({})).toBe("");
  });

  it("includes only the answers that were given", () => {
    const text = summarizeOnboardingAnswers({ "primary-goal": "video" });
    expect(text).toContain("影片");
    expect(text).not.toContain("節奏");
  });
});
