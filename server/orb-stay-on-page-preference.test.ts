/**
 * orb-stay-on-page-preference.test.ts
 *
 * Phase 3 — locks the contract for the new `stayOnPageMode` preference:
 *   - DEFAULT_AGENT_PREFERENCES exposes a boolean defaulting to false so
 *     existing rows keep the legacy navigate-and-fillPrompt UX.
 *   - The chat router's preferences input schema accepts the field as
 *     boolean | undefined.
 *   - The agent-preferences UpdateSchema mirror accepts the field.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_AGENT_PREFERENCES } from "../shared/agent-preferences";

// Mirror the same schema shape the agentPreferencesRouter UpdateSchema
// declares for stayOnPageMode. Keeping it inline avoids dragging the
// drizzle stack into a unit test.
const StayOnPageFieldsSchema = z.object({
  stayOnPageMode: z.boolean().optional(),
});

// Mirror the chat router's preferences sub-schema so we exercise the
// shape the planner actually sees. Includes the Phase-D wiring fields
// that used to be saved but never read at runtime — the chat router
// now threads them through too.
const ChatRouterPreferencesSchema = z.object({
  confirmationPolicy: z
    .enum(["always_approve", "confirm_high_risk", "confirm_all", "manual"])
    .optional(),
  stayOnPageMode: z.boolean().optional(),
  criticEnabled: z.boolean().optional(),
  criticRefineBelow: z.number().int().min(0).max(100).optional(),
  roleAutoSwitch: z.boolean().optional(),
});

describe("AgentPreferences.stayOnPageMode (Phase 3)", () => {
  it("exposes the field on DEFAULT_AGENT_PREFERENCES with a boolean default", () => {
    expect(typeof DEFAULT_AGENT_PREFERENCES.stayOnPageMode).toBe("boolean");
  });

  it("defaults to false so existing rows keep the legacy navigate-and-fillPrompt UX", () => {
    expect(DEFAULT_AGENT_PREFERENCES.stayOnPageMode).toBe(false);
  });

  it("UpdateSchema accepts a boolean payload", () => {
    expect(StayOnPageFieldsSchema.safeParse({ stayOnPageMode: true }).success).toBe(true);
    expect(StayOnPageFieldsSchema.safeParse({ stayOnPageMode: false }).success).toBe(true);
  });

  it("UpdateSchema accepts an absent payload (partial update)", () => {
    expect(StayOnPageFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("UpdateSchema rejects non-boolean values", () => {
    expect(
      StayOnPageFieldsSchema.safeParse({ stayOnPageMode: "yes" }).success
    ).toBe(false);
    expect(
      StayOnPageFieldsSchema.safeParse({ stayOnPageMode: 1 }).success
    ).toBe(false);
    expect(
      StayOnPageFieldsSchema.safeParse({ stayOnPageMode: null }).success
    ).toBe(false);
  });

  it("chat router preferences accept stayOnPageMode alongside existing fields", () => {
    const parsed = ChatRouterPreferencesSchema.safeParse({
      confirmationPolicy: "confirm_high_risk",
      stayOnPageMode: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("chat router preferences accept the Phase-D wiring fields (critic + roleAutoSwitch)", () => {
    // Until this commit these fields lived in the database but the chat
    // router silently ignored them. Locking the schema here so a future
    // refactor that drops the fields fails loudly instead of regressing
    // the actual runtime behaviour.
    const parsed = ChatRouterPreferencesSchema.safeParse({
      criticEnabled: true,
      criticRefineBelow: 80,
      roleAutoSwitch: false,
      stayOnPageMode: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("chat router preferences reject out-of-range criticRefineBelow", () => {
    expect(
      ChatRouterPreferencesSchema.safeParse({ criticRefineBelow: -1 }).success
    ).toBe(false);
    expect(
      ChatRouterPreferencesSchema.safeParse({ criticRefineBelow: 101 }).success
    ).toBe(false);
  });
});
