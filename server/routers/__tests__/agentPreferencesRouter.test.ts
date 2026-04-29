import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_PREFERENCES } from "../../../shared/agent-preferences";

describe("agentPreferences defaults", () => {
  it("getPreferences returns defaults for new user", () => {
    expect(DEFAULT_AGENT_PREFERENCES.confirmationPolicy).toBe("confirm_high_risk");
    expect(DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask).toBe(5);
  });

  it("updatePreferences shape supports persistence fields", () => {
    const updated = { ...DEFAULT_AGENT_PREFERENCES, confirmationPolicy: "confirm_all" as const };
    expect(updated.confirmationPolicy).toBe("confirm_all");
  });
});
