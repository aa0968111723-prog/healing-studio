/**
 * providerHealthProbeJob.ssrf.test.ts — AIDV-963
 *
 * Verifies the SSRF guard added to probeProvider():
 *  1. Legitimate env-derived supabase_auth URL (`${SUPABASE_URL}/auth/v1/health`)
 *     passes the guard and is probed normally.
 *  2. A malicious / internal SUPABASE_URL (e.g. http://169.254.169.254 — AWS IMDS)
 *     is blocked BEFORE any fetch happens, the probe result is marked failed
 *     (ok=false, ssrf-blocked error), and the rest of the probe cycle keeps
 *     running — the job never throws/crashes.
 *
 * The probe URL is interpolated at module load, so each test re-mocks
 * env.validated.js and re-imports the module (vi.doMock + vi.resetModules).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

type ProbeModule = typeof import("./providerHealthProbeJob.js");

async function loadModuleWithSupabaseUrl(supabaseUrl: string): Promise<ProbeModule> {
  vi.resetModules();
  vi.doMock("../services/providerHealth.js", () => ({
    setProviderHealth: vi.fn(),
    markProviderRecovered: vi.fn(),
  }));
  vi.doMock("../db.js", () => ({
    getDb: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock("../../drizzle/schema.js", () => ({
    orbSystemAlerts: {},
  }));
  vi.doMock("drizzle-orm", () => ({
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
  }));
  vi.doMock("node-cron", () => ({
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  }));
  vi.doMock("../_core/env.validated.js", () => ({
    serverEnv: {
      FAL_API_KEY: "test-fal-key",
      ELEVENLABS_API_KEY: "",
      REPLICATE_API_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
      SUPABASE_URL: supabaseUrl,
    },
  }));
  return await import("./providerHealthProbeJob.js");
}

describe("AIDV-963: probeProvider SSRF guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.doUnmock("../_core/env.validated.js");
  });

  it("① supabase_auth dynamic URL (${SUPABASE_URL}/auth/v1/health) passes the guard and probes normally", async () => {
    const mod = await loadModuleWithSupabaseUrl("https://test-project.supabase.co");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await mod._runProbeCycleForTest();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(true);
    expect(supabase!.statusCode).toBe(200);
    expect(supabase!.error).toBeUndefined();

    // The guard let the real health endpoint through — fetch reached it.
    const probedUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(probedUrls).toContain("https://test-project.supabase.co/auth/v1/health");
  });

  it("② internal/IMDS SUPABASE_URL (http://169.254.169.254) is blocked: probe marked failed, no fetch, job does not crash", async () => {
    const mod = await loadModuleWithSupabaseUrl("http://169.254.169.254");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // 【HARD】guard failure must follow the normal probe-failure path — the whole
    // cycle must resolve, never throw.
    await expect(mod._runProbeCycleForTest()).resolves.toBeUndefined();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(false);
    expect(supabase!.error).toMatch(/ssrf-blocked/);
    expect(supabase!.statusCode).toBeUndefined(); // never got an HTTP response
    expect(supabase!.consecutiveFailures).toBe(1);

    // The blocked URL must never reach fetch (guard runs BEFORE egress).
    const probedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(probedUrls.some((u) => u.includes("169.254.169.254"))).toBe(false);

    // Other providers were still probed in the same cycle (job kept running).
    const fal = mod.getProviderProbeStatus().find((s) => s.providerId === "fal");
    expect(fal).toBeDefined();
    expect(fal!.ok).toBe(true);
  });

  it("② repeated blocked cycles accumulate consecutiveFailures like any other probe failure (same failure path)", async () => {
    const mod = await loadModuleWithSupabaseUrl("http://169.254.169.254");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));

    await mod._runProbeCycleForTest();
    await mod._runProbeCycleForTest();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase!.ok).toBe(false);
    expect(supabase!.consecutiveFailures).toBe(2); // reaches ALERT_THRESHOLD like a network failure would
  });

  it("hardcoded generation-provider URLs (fal/gemini) still pass the guard unchanged", async () => {
    const mod = await loadModuleWithSupabaseUrl("");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await mod._runProbeCycleForTest();

    const status = mod.getProviderProbeStatus();
    for (const id of ["fal", "gemini"]) {
      const s = status.find((r) => r.providerId === id);
      expect(s, `provider ${id} should have been probed`).toBeDefined();
      expect(s!.ok).toBe(true);
    }
  });
});
