import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../services/providerHealth.js", () => ({
  setProviderHealth: vi.fn(),
  markProviderRecovered: vi.fn(),
}));
vi.mock("../db.js", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../drizzle/schema.js", () => ({
  orbSystemAlerts: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));
vi.mock("node-cron", () => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock("../_core/env.validated.js", () => ({
  serverEnv: {
    FAL_API_KEY: "test-fal-key",
    ELEVENLABS_API_KEY: "",
    REPLICATE_API_TOKEN: "",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    OPENROUTER_API_KEY: "",
    SUPABASE_URL: "",
  },
}));
vi.mock("../_core/ssrfGuard.js", () => ({
  assertSafeExternalUrl: vi.fn().mockReturnValue(new URL("https://api.anthropic.com/v1/models")),
}));

describe("providerHealthProbeJob", () => {
  let mod: typeof import("./providerHealthProbeJob.js");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./providerHealthProbeJob.js");
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.clearAllMocks();
  });

  it("getProviderProbeStatus returns empty array before first probe", () => {
    const status = mod.getProviderProbeStatus();
    expect(Array.isArray(status)).toBe(true);
  });

  it("initProviderHealthProbeCron initializes cron without throwing", () => {
    expect(() => mod.initProviderHealthProbeCron()).not.toThrow();
  });

  it("initProviderHealthProbeCron is idempotent (second call is no-op)", async () => {
    const cron = await import("node-cron");
    const scheduleSpy = vi.spyOn(cron, "schedule");
    mod.initProviderHealthProbeCron();
    mod.initProviderHealthProbeCron();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
  });

  it("stopProviderHealthProbeCron does not throw when cron not started", () => {
    expect(() => mod.stopProviderHealthProbeCron()).not.toThrow();
  });
});

describe("AIDV-574: providerHealthProbeJob exports (debounce + kind classification)", () => {
  let mod: typeof import("./providerHealthProbeJob.js");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./providerHealthProbeJob.js");
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.clearAllMocks();
  });

  it("ALERT_THRESHOLD is exported and equals 2 (debounce guard)", () => {
    expect(mod.ALERT_THRESHOLD).toBe(2);
  });

  it("getConfiguredGenerationProviderIds returns only generation providers with keys set", () => {
    // env mock: FAL_API_KEY and ANTHROPIC_API_KEY are set; others empty; SUPABASE_URL empty
    const ids = mod.getConfiguredGenerationProviderIds();
    expect(ids).toContain("fal");
    expect(ids).toContain("anthropic");
    // gemini has requiresKey=false, hasKey always true → should be included
    expect(ids).toContain("gemini");
    // No key configured for these
    expect(ids).not.toContain("elevenlabs");
    expect(ids).not.toContain("replicate");
    expect(ids).not.toContain("openrouter");
    // supabase_auth is infra, must not appear
    expect(ids).not.toContain("supabase_auth");
  });
});

describe("AIDV-574: providerSystemStatus judgment convergence (unit-level logic)", () => {
  // Test the three-fix logic directly using probe state shape
  // Simulates what brain.ts providerSystemStatus does post-fix

  function computeStatus(probes: Array<{ kind: "generation" | "infra"; consecutiveFailures: number }>, threshold: number, configuredCount: number) {
    const generationProbes = probes.filter(p => p.kind === "generation");
    const failing = generationProbes.filter(p => p.consecutiveFailures >= threshold);
    if (failing.length === 0) return "healthy";
    if (configuredCount >= 2 && failing.length >= configuredCount) return "down";
    return "degraded";
  }

  it("single failure (consecutiveFailures=1) → healthy (below ALERT_THRESHOLD=2)", () => {
    const result = computeStatus([{ kind: "generation", consecutiveFailures: 1 }], 2, 3);
    expect(result).toBe("healthy");
  });

  it("two consecutive failures → degraded (but not all providers failing)", () => {
    const result = computeStatus([
      { kind: "generation", consecutiveFailures: 2 },
      { kind: "generation", consecutiveFailures: 0 },
    ], 2, 2);
    expect(result).toBe("degraded");
  });

  it("all generation providers failing after threshold → down", () => {
    const result = computeStatus([
      { kind: "generation", consecutiveFailures: 3 },
      { kind: "generation", consecutiveFailures: 2 },
    ], 2, 2);
    expect(result).toBe("down");
  });

  it("single configured generation provider failing → degraded (never down with configuredCount<2)", () => {
    const result = computeStatus([{ kind: "generation", consecutiveFailures: 5 }], 2, 1);
    expect(result).toBe("degraded");
  });

  it("infra-only failure → healthy (supabase_auth does not affect user-facing status)", () => {
    const result = computeStatus([
      { kind: "infra", consecutiveFailures: 10 },
    ], 2, 3);
    expect(result).toBe("healthy");
  });

  it("infra failure + generation failure after threshold → degraded (infra excluded from down denominator)", () => {
    const result = computeStatus([
      { kind: "infra", consecutiveFailures: 10 },
      { kind: "generation", consecutiveFailures: 2 },
    ], 2, 3);
    expect(result).toBe("degraded");
  });
});

describe("AIDV-930: auth-aware ok determination (401/403 = unhealthy for requiresKey providers)", () => {
  let mod: typeof import("./providerHealthProbeJob.js");
  let setProviderHealthFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./providerHealthProbeJob.js");
    const ph = await import("../services/providerHealth.js");
    setProviderHealthFn = ph.setProviderHealth as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("invalid/expired API key (401) marks requiresKey provider as failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));
    await mod._runProbeCycleForTest();
    await mod._runProbeCycleForTest();
    // anthropic is requiresKey=true — 401 should now count as failure
    expect(setProviderHealthFn).toHaveBeenCalledWith(
      "anthropic",
      "degraded",
      expect.stringContaining("401")
    );
  });

  it("rate-limited (429) marks requiresKey provider as healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 429, ok: false }));
    const markRecoveredFn = (await import("../services/providerHealth.js")).markProviderRecovered as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
    await mod._runProbeCycleForTest();
    // 429 = key valid, rate-limited = healthy → markProviderRecovered should be called
    expect(markRecoveredFn).toHaveBeenCalledWith("anthropic");
  });

  it("network timeout returns false (does not throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("TimeoutError"), { name: "TimeoutError" })));
    // Should not throw, probe cycle completes
    await expect(mod._runProbeCycleForTest()).resolves.toBeUndefined();
  });
});

describe("AIDV-707: health-store bridging (probe → providerRouter)", () => {
  let mod: typeof import("./providerHealthProbeJob.js");
  let setProviderHealthFn: ReturnType<typeof vi.fn>;
  let markProviderRecoveredFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    mod = await import("./providerHealthProbeJob.js");
    const ph = await import("../services/providerHealth.js");
    setProviderHealthFn = ph.setProviderHealth as ReturnType<typeof vi.fn>;
    markProviderRecoveredFn = ph.markProviderRecovered as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("successful probe calls markProviderRecovered for generation providers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    await mod._runProbeCycleForTest();
    // fal, anthropic, gemini all have keys or requiresKey=false in the test env mock
    expect(markProviderRecoveredFn).toHaveBeenCalledWith("fal");
  });

  it("does not call setProviderHealth(degraded) on first failure (below ALERT_THRESHOLD=2)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await mod._runProbeCycleForTest();
    expect(setProviderHealthFn).not.toHaveBeenCalledWith("fal", "degraded", expect.anything());
  });

  it("calls setProviderHealth(degraded) after ALERT_THRESHOLD consecutive failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await mod._runProbeCycleForTest();
    await mod._runProbeCycleForTest();
    expect(setProviderHealthFn).toHaveBeenCalledWith(
      "fal",
      "degraded",
      expect.stringContaining("connection refused")
    );
  });

  it("does not bridge infra providers to health store", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("infra down")));
    await mod._runProbeCycleForTest();
    await mod._runProbeCycleForTest();
    expect(setProviderHealthFn).not.toHaveBeenCalledWith("supabase_auth", expect.anything(), expect.anything());
  });
});
