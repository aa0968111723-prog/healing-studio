/**
 * orb-voice-perception-prefs.test.ts
 *
 * Locks the contract for the last two saved-but-dead AgentPreferences
 * fields — voiceAutoActivate + perceptionEnabled / perceptionStrictness —
 * after they got wired through to the orb chat handler:
 *
 *   - voiceEnabled / voiceAutoActivate gate the OrbVoiceButton render
 *     and its auto-startVoice() side-effect; the schema must accept
 *     boolean | undefined and reject other shapes so a malicious payload
 *     can't pin the mic open.
 *
 *   - perceptionEnabled toggles the observeAfterStep hook on the
 *     orchestrator; perceptionStrictness tunes how a "retry"
 *     recommendation gets escalated.  Both should round-trip through
 *     the agentPreferences UpdateSchema mirror without coercion.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_AGENT_PREFERENCES } from "../shared/agent-preferences";

// Mirror of the agentPreferencesRouter UpdateSchema for the fields we
// touched in this PR. Keeping it inline avoids dragging the drizzle
// stack into a unit test.
const VoicePerceptionUpdateSchema = z.object({
  voiceEnabled: z.boolean().optional(),
  voiceAutoActivate: z.boolean().optional(),
  preferredVoiceName: z.enum(["Puck", "Charon", "Kore", "Fenrir", "Aoede"]).optional(),
  perceptionEnabled: z.boolean().optional(),
  perceptionStrictness: z.enum(["lenient", "balanced", "strict"]).optional(),
});

describe("AgentPreferences voice + perception wiring", () => {
  describe("defaults", () => {
    it("voiceEnabled + voiceAutoActivate both default to false", () => {
      expect(DEFAULT_AGENT_PREFERENCES.voiceEnabled).toBe(false);
      expect(DEFAULT_AGENT_PREFERENCES.voiceAutoActivate).toBe(false);
    });

    it("preferredVoiceName defaults to 'Puck'", () => {
      expect(DEFAULT_AGENT_PREFERENCES.preferredVoiceName).toBe("Puck");
    });

    it("perceptionEnabled defaults to true (matches the behaviour comment)", () => {
      expect(DEFAULT_AGENT_PREFERENCES.perceptionEnabled).toBe(true);
    });

    it("perceptionStrictness defaults to 'balanced'", () => {
      expect(DEFAULT_AGENT_PREFERENCES.perceptionStrictness).toBe("balanced");
    });
  });

  describe("UpdateSchema", () => {
    it("accepts boolean voice toggles", () => {
      expect(
        VoicePerceptionUpdateSchema.safeParse({
          voiceEnabled: true,
          voiceAutoActivate: true,
        }).success
      ).toBe(true);
    });

    it("rejects non-boolean voice toggles (no string truthy coercion)", () => {
      expect(
        VoicePerceptionUpdateSchema.safeParse({ voiceEnabled: "yes" }).success
      ).toBe(false);
      expect(
        VoicePerceptionUpdateSchema.safeParse({ voiceAutoActivate: 1 }).success
      ).toBe(false);
    });

    it("accepts the four supported preferredVoiceName values + Puck", () => {
      for (const name of ["Puck", "Charon", "Kore", "Fenrir", "Aoede"]) {
        expect(
          VoicePerceptionUpdateSchema.safeParse({ preferredVoiceName: name })
            .success
        ).toBe(true);
      }
    });

    it("rejects unknown preferredVoiceName", () => {
      expect(
        VoicePerceptionUpdateSchema.safeParse({
          preferredVoiceName: "Galadriel",
        }).success
      ).toBe(false);
    });

    it("accepts the three perception strictness tiers", () => {
      for (const tier of ["lenient", "balanced", "strict"]) {
        expect(
          VoicePerceptionUpdateSchema.safeParse({ perceptionStrictness: tier })
            .success
        ).toBe(true);
      }
    });

    it("rejects unknown perception strictness (locks the enum)", () => {
      expect(
        VoicePerceptionUpdateSchema.safeParse({
          perceptionStrictness: "paranoid",
        }).success
      ).toBe(false);
    });
  });
});
