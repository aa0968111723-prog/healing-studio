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

describe("AIDV-886: classifyProbeStatus — auth failures mark provider unhealthy", () => {
  let mod: typeof import("./providerHealthProbeJob.js");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./providerHealthProbeJob.js");
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.clearAllMocks();
  });

  // ── 2xx → healthy ──────────────────────────────────────────────
  it.each([200, 201, 204, 299])("%i (2xx) → ok, regardless of requiresKey", (status) => {
    expect(mod.classifyProbeStatus(status, true)).toEqual({ ok: true });
    expect(mod.classifyProbeStatus(status, false)).toEqual({ ok: true });
  });

  // ── 401/403 with key → unhealthy (the core fix) ────────────────
  it.each([401, 403])("%i WITH key (requiresKey=true) → unhealthy with credential error", (status) => {
    const r = mod.classifyProbeStatus(status, true);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`HTTP ${status}`);
    expect(r.error).toMatch(/key invalid or expired/i);
  });

  // ── 401/403 WITHOUT key → reachable (gemini regression guard) ──
  it.each([401, 403])("%i WITHOUT key (requiresKey=false, e.g. gemini) → ok, no false alert", (status) => {
    expect(mod.classifyProbeStatus(status, false)).toEqual({ ok: true });
  });

  // ── 429 rate-limit → reachable (key valid, just throttled) ─────
  it("429 (rate-limit) → ok even with key — key is valid, not an auth failure", () => {
    expect(mod.classifyProbeStatus(429, true)).toEqual({ ok: true });
    expect(mod.classifyProbeStatus(429, false)).toEqual({ ok: true });
  });

  // ── other 4xx (endpoint quirks) → reachable ────────────────────
  it.each([400, 404, 405, 422])("%i (non-auth 4xx) → ok — endpoint quirk, not a key problem", (status) => {
    expect(mod.classifyProbeStatus(status, true)).toEqual({ ok: true });
  });

  // ── 5xx → unhealthy ────────────────────────────────────────────
  it.each([500, 502, 503, 504])("%i (5xx) → unhealthy, with or without key", (status) => {
    expect(mod.classifyProbeStatus(status, true).ok).toBe(false);
    expect(mod.classifyProbeStatus(status, false).ok).toBe(false);
  });

  it("5xx returns no synthesized credential error (preserves existing alert text)", () => {
    expect(mod.classifyProbeStatus(503, true)).toEqual({ ok: false });
  });

  // ── 3xx redirect edge → treated as reachable ───────────────────
  it("302 (redirect) → ok (reachable)", () => {
    expect(mod.classifyProbeStatus(302, true)).toEqual({ ok: true });
  });
});

describe("AIDV-886: probe cycle integration — expired key surfaces as unhealthy", () => {
  let mod: typeof import("./providerHealthProbeJob.js");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./providerHealthProbeJob.js");
    vi.clearAllMocks();
  });

  afterEach(() => {
    mod.stopProviderHealthProbeCron();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("401 from a keyed provider (anthropic) records ok=false; keyless gemini stays ok", async () => {
    // Every probed provider returns 401. In the test env mock, fal+anthropic carry
    // keys (requiresKey=true) → unhealthy; gemini is keyless (requiresKey=false) → ok.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false }));
    await mod._runProbeCycleForTest();

    const status = mod.getProviderProbeStatus();
    const anthropic = status.find((s) => s.providerId === "anthropic");
    const gemini = status.find((s) => s.providerId === "gemini");

    expect(anthropic).toBeDefined();
    expect(anthropic!.ok).toBe(false); // ← was silently `true` before the fix
    expect(anthropic!.statusCode).toBe(401);

    // Regression guard: keyless gemini's 401/403 must stay healthy
    expect(gemini).toBeDefined();
    expect(gemini!.ok).toBe(true);
  });

  it("200 keeps keyed providers healthy (no behavior change on success path)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));
    await mod._runProbeCycleForTest();
    const anthropic = mod.getProviderProbeStatus().find((s) => s.providerId === "anthropic");
    expect(anthropic!.ok).toBe(true);
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
