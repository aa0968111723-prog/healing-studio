import { beforeEach, describe, expect, it } from "vitest";
import { getProviderCatalog, selectProvider, getProviderStatus } from "./services/providerRouter";
import {
  __unsafe_resetProviderHealthForTests,
  markProviderFailure,
  setProviderHealth,
} from "./services/providerHealth";

const OLD_ENV = { ...process.env };

describe("provider router", () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    __unsafe_resetProviderHealthForTests();
    process.env.GEMINI_API_KEY = "test-key";
    process.env.FAL_KEY = "test-key";
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.SUNO_API_KEY = "test-key";
    process.env.NVIDIA_API = "test-key";
    process.env.ENABLE_CODEX_TASKS = "true";
    process.env.ENABLE_CLAUDE_CODE_TASKS = "true";
  });

  it("selects Gemini for multimodal planner", () => {
    const selection = selectProvider({ intent: "planner_multimodal" });
    expect(selection.provider?.id).toBe("gemini");
  });

  it("selects ClaudeCode for code task", () => {
    const selection = selectProvider({ intent: "code_task" });
    expect(selection.provider?.id).toBe("claudeCode");
  });

  it("missing GEMINI_API_KEY marks gemini missing_key and returns provider_unavailable when all llm providers are unusable", () => {
    process.env.GEMINI_API_KEY = "";
    process.env.NVIDIA_API = "";
    const catalog = getProviderCatalog().map(provider =>
      provider.id === "default_llm"
        ? { ...provider, enabled: false }
        : provider
    );
    const gemini = catalog.find(entry => entry.id === "gemini");
    expect(gemini && getProviderStatus(gemini)).toBe("missing_key");

    const selection = selectProvider({ intent: "planner_multimodal" }, catalog);
    expect(selection.provider).toBeNull();
    expect(selection.plannerStatus).toBe("provider_unavailable");
  });

  it("provider timeout falls back safely", () => {
    markProviderFailure("gemini", new Error("timeout while calling gemini"));
    const selection = selectProvider({ intent: "planner_multimodal" });
    expect(selection.provider?.id).toBe("default_llm");
    expect(selection.reason).toContain("fallback");
  });

  it("provider disabled not selected", () => {
    process.env.ENABLE_CLAUDE_CODE_TASKS = "false";
    const selection = selectProvider({ intent: "code_task" });
    expect(selection.provider?.id).toBe("codex");
  });

  it("fallback provider selected when primary degraded", () => {
    setProviderHealth("gemini", "degraded", "timeout");
    const selection = selectProvider({ intent: "planner_multimodal" });
    expect(selection.provider?.id).toBe("default_llm");
  });

  it("text-only low-risk uses default provider", () => {
    const selection = selectProvider({ intent: "planner_text", riskLevel: "low" });
    expect(selection.provider?.id).toBe("default_llm");
  });

  it("telemetry helper in health never leaks api key text", () => {
    const snapshot = markProviderFailure("gemini", new Error("token=abc123"));
    expect(snapshot.reason).not.toContain("abc123");
  });
});
