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
  DEFAULT_PROACTIVE_TRIGGER_SETTINGS,
  resolveProactiveTriggerSettings,
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

describe("AgentPreferences — proactive trigger settings", () => {
  it("DEFAULT_PROACTIVE_TRIGGER_SETTINGS gives all triggers a sane resting state", () => {
    // 全開、5 分鐘間隔、需要打勾才消失 — 這份預設不能更動，會破壞既有
    // user 的預期（沒設過設定的人 = 預設行為）。
    expect(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.minIntervalMs).toBe(5 * 60_000);
    expect(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.requireAck).toBe(true);
  });

  it("DEFAULT_AGENT_PREFERENCES initialises proactiveTriggerSettings as empty map", () => {
    expect(DEFAULT_AGENT_PREFERENCES.proactiveTriggerSettings).toEqual({});
  });

  it("resolveProactiveTriggerSettings falls back to defaults for unknown / missing entries", () => {
    expect(resolveProactiveTriggerSettings("prompt_too_short", null)).toEqual(
      DEFAULT_PROACTIVE_TRIGGER_SETTINGS,
    );
    expect(resolveProactiveTriggerSettings("prompt_too_short", {})).toEqual(
      DEFAULT_PROACTIVE_TRIGGER_SETTINGS,
    );
  });

  it("resolveProactiveTriggerSettings honours partial overrides + clamps minIntervalMs", () => {
    const r1 = resolveProactiveTriggerSettings("monthly_spend_threshold", {
      monthly_spend_threshold: { enabled: false },
    });
    expect(r1.enabled).toBe(false);
    // 沒覆寫的欄位仍走預設
    expect(r1.minIntervalMs).toBe(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.minIntervalMs);
    expect(r1.requireAck).toBe(true);

    // 太短的 interval 會被 clamp 到 5_000
    const r2 = resolveProactiveTriggerSettings("monthly_spend_threshold", {
      monthly_spend_threshold: { minIntervalMs: 50 },
    });
    expect(r2.minIntervalMs).toBe(5_000);

    // 太長的也會被 clamp 到 24h
    const r3 = resolveProactiveTriggerSettings("monthly_spend_threshold", {
      monthly_spend_threshold: { minIntervalMs: 999_999_999 },
    });
    expect(r3.minIntervalMs).toBe(86_400_000);
  });

  it("resolveProactiveTriggerSettings ignores invalid types in stored override", () => {
    // boolean 期望但給字串 → 走預設（防止舊 row 的髒資料污染 runtime）
    const r = resolveProactiveTriggerSettings("low_quality_generation", {
      low_quality_generation: {
        enabled: "yes" as unknown as boolean,
        requireAck: 1 as unknown as boolean,
      },
    });
    expect(r.enabled).toBe(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.enabled);
    expect(r.requireAck).toBe(DEFAULT_PROACTIVE_TRIGGER_SETTINGS.requireAck);
  });
});
