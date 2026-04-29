import { describe, expect, it } from "vitest";
import { loadAgentPreferencesForUser } from "../agentPreferenceService";
import { DEFAULT_AGENT_PREFERENCES } from "../../../shared/agent-preferences";

describe("loadAgentPreferencesForUser", () => {
  it("returns DEFAULT_AGENT_PREFERENCES (with userId attached) when DB is unavailable", async () => {
    // No DATABASE_URL in tests → getDb() returns null → service must return
    // sane defaults rather than throwing.
    const prefs = await loadAgentPreferencesForUser(42);
    expect(prefs.userId).toBe(42);
    expect(prefs.confirmationPolicy).toBe(
      DEFAULT_AGENT_PREFERENCES.confirmationPolicy
    );
    expect(prefs.maxAutoStepsPerTask).toBe(
      DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask
    );
    expect(prefs.blockedTools).toEqual(DEFAULT_AGENT_PREFERENCES.blockedTools);
  });

  it("returns defaults for invalid userId rather than throwing", async () => {
    const prefs = await loadAgentPreferencesForUser(0);
    expect(prefs.userId).toBe(0);
    expect(prefs.autoApproveTools).toEqual(
      DEFAULT_AGENT_PREFERENCES.autoApproveTools
    );
  });
});
