/**
 * orb-agent-preset.test.ts
 *
 * Pure-function coverage for `detectActivePreset` — the helper that
 * compares saved prefs against the four canonical preset patches and
 * decides whether the settings page should highlight one of them as
 * "currently in use".
 */

import { describe, expect, it } from "vitest";
import {
  detectActivePreset,
  ORB_AGENT_PRESETS,
} from "../client/src/components/orb-agent/OrbAgentPresetCards";

describe("detectActivePreset", () => {
  it("returns null for empty / nullish prefs", () => {
    expect(detectActivePreset(null)).toBeNull();
    expect(detectActivePreset(undefined)).toBeNull();
    expect(detectActivePreset({})).toBeNull();
  });

  it("identifies each preset when the patch fields match", () => {
    for (const preset of ORB_AGENT_PRESETS) {
      const matched = detectActivePreset({
        confirmationPolicy: preset.patch.confirmationPolicy,
        voiceEnabled: preset.patch.voiceEnabled,
        orbProactiveSuggestions: preset.patch.orbProactiveSuggestions,
        orbShortcutEnabled: preset.patch.orbShortcutEnabled,
        maxAutoStepsPerTask: preset.patch.maxAutoStepsPerTask,
      });
      expect(matched).toBe(preset.id);
    }
  });

  it("returns null when one identifying field disagrees", () => {
    const preset = ORB_AGENT_PRESETS.find(p => p.id === "assistant")!;
    const matched = detectActivePreset({
      confirmationPolicy: preset.patch.confirmationPolicy,
      voiceEnabled: !preset.patch.voiceEnabled,
      orbProactiveSuggestions: preset.patch.orbProactiveSuggestions,
      maxAutoStepsPerTask: preset.patch.maxAutoStepsPerTask,
    });
    expect(matched).toBeNull();
  });

  it("treats null/undefined boolean fields as false (default)", () => {
    // The "calm" preset has voice off + suggestions off; if a fresh row
    // arrives with those fields literally null, the comparison should
    // still match.
    const calm = ORB_AGENT_PRESETS.find(p => p.id === "calm")!;
    const matched = detectActivePreset({
      confirmationPolicy: calm.patch.confirmationPolicy,
      voiceEnabled: null,
      orbProactiveSuggestions: null,
      maxAutoStepsPerTask: calm.patch.maxAutoStepsPerTask,
    });
    expect(matched).toBe("calm");
  });

  it("falls back to the legacy default maxAutoStepsPerTask when the field is null", () => {
    // None of the presets share the legacy default (5) except "assistant",
    // so a null field should still uniquely match assistant when its other
    // fields line up.
    const assistant = ORB_AGENT_PRESETS.find(p => p.id === "assistant")!;
    const matched = detectActivePreset({
      confirmationPolicy: assistant.patch.confirmationPolicy,
      voiceEnabled: assistant.patch.voiceEnabled,
      orbProactiveSuggestions: assistant.patch.orbProactiveSuggestions,
      maxAutoStepsPerTask: null,
    });
    expect(matched).toBe("assistant");
  });
});
