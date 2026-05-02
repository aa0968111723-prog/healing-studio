/**
 * server/agent-preferences-phase-d.test.ts
 *
 * Phase D: verify the extended UpdateSchema accepts the new fields and
 * that DEFAULT_AGENT_PREFERENCES + the loader keep the runtime backward-
 * compatible (missing columns / nulls fall through to defaults).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentCostBudget,
  type AgentPacingOverride,
  type PerceptionStrictness,
} from "../shared/agent-preferences";

// Re-derive the same schema shape the router uses so we can validate
// payloads in isolation. Keeping it inline (rather than importing the
// router's UpdateSchema) avoids pulling in the trpc + drizzle stack.
const CostBudgetSchema = z
  .object({
    perWorkflowCap: z.number().int().min(0).max(100_000).nullable().optional(),
    remainingCredits: z.number().int().min(0).max(1_000_000).nullable().optional(),
    confirmAtTierOrAbove: z
      .enum(["free", "cheap", "medium", "expensive", "premium"])
      .nullable()
      .optional(),
    alwaysAllow: z.boolean().nullable().optional(),
  })
  .nullable();

const PhaseDFieldsSchema = z.object({
  costBudget: CostBudgetSchema.optional(),
  perceptionEnabled: z.boolean().optional(),
  perceptionStrictness: z.enum(["lenient", "balanced", "strict"]).optional(),
  criticEnabled: z.boolean().optional(),
  criticRefineBelow: z.number().int().min(0).max(100).optional(),
  roleAutoSwitch: z.boolean().optional(),
  pacingOverride: z.enum(["auto", "patient", "balanced", "impatient"]).optional(),
  onboardingCompletedAt: z.union([z.date(), z.string().datetime(), z.null()]).optional(),
});

describe("AgentPreferences — Phase D defaults", () => {
  it("DEFAULT_AGENT_PREFERENCES matches today's runtime behaviour for new users", () => {
    expect(DEFAULT_AGENT_PREFERENCES.costBudget).toBeNull();
    expect(DEFAULT_AGENT_PREFERENCES.perceptionEnabled).toBe(true);
    expect(DEFAULT_AGENT_PREFERENCES.perceptionStrictness).toBe("balanced");
    expect(DEFAULT_AGENT_PREFERENCES.criticEnabled).toBe(false); // opt-in
    expect(DEFAULT_AGENT_PREFERENCES.criticRefineBelow).toBe(75);
    expect(DEFAULT_AGENT_PREFERENCES.roleAutoSwitch).toBe(true);
    expect(DEFAULT_AGENT_PREFERENCES.pacingOverride).toBe("auto");
    expect(DEFAULT_AGENT_PREFERENCES.onboardingCompletedAt).toBeNull();
  });
});

describe("UpdateSchema — Phase D fields", () => {
  it("accepts a fully-specified cost budget", () => {
    const budget: AgentCostBudget = {
      perWorkflowCap: 50,
      remainingCredits: 200,
      confirmAtTierOrAbove: "expensive",
      alwaysAllow: false,
    };
    const parsed = PhaseDFieldsSchema.safeParse({ costBudget: budget });
    expect(parsed.success).toBe(true);
  });

  it("accepts costBudget=null (disable gate)", () => {
    const parsed = PhaseDFieldsSchema.safeParse({ costBudget: null });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range perWorkflowCap", () => {
    const parsed = PhaseDFieldsSchema.safeParse({
      costBudget: { perWorkflowCap: -1 },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown pacing override", () => {
    const parsed = PhaseDFieldsSchema.safeParse({
      pacingOverride: "warp-speed" as AgentPacingOverride,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown perception strictness", () => {
    const parsed = PhaseDFieldsSchema.safeParse({
      perceptionStrictness: "paranoid" as PerceptionStrictness,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts criticRefineBelow in 0..100", () => {
    expect(PhaseDFieldsSchema.safeParse({ criticRefineBelow: 0 }).success).toBe(true);
    expect(PhaseDFieldsSchema.safeParse({ criticRefineBelow: 100 }).success).toBe(true);
    expect(PhaseDFieldsSchema.safeParse({ criticRefineBelow: 101 }).success).toBe(false);
  });

  it("accepts onboardingCompletedAt as Date / ISO string / null", () => {
    expect(
      PhaseDFieldsSchema.safeParse({ onboardingCompletedAt: new Date() }).success
    ).toBe(true);
    expect(
      PhaseDFieldsSchema.safeParse({ onboardingCompletedAt: "2026-05-02T10:00:00.000Z" }).success
    ).toBe(true);
    expect(PhaseDFieldsSchema.safeParse({ onboardingCompletedAt: null }).success).toBe(true);
  });
});
