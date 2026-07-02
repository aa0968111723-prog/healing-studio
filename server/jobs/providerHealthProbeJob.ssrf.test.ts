/**
 * providerHealthProbeJob.ssrf.test.ts — AIDV-963
 *
 * probeProvider() 在 fetch 前套用 assertSafeExternalUrl SSRF guard：
 *  ① supabase_auth 動態 URL（`${SUPABASE_URL}/auth/v1/health`）合法時照常探測通過。
 *  ② 惡意/內網 URL（IMDS 169.254.169.254、私網 10.x）被擋：該 provider 的 probe
 *    標記失敗（ok=false, error=ssrf-blocked），fetch 完全不會發出，且整個
 *    probe cycle 不會 throw，其他 provider 照常探測（不 crash 整個 job）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PROBE_CONFIG 在模組載入時就讀 serverEnv.SUPABASE_URL，因此用 hoisted 可變
// state + getter，讓每個測試以 vi.resetModules() 重新載入不同的 SUPABASE_URL。
const envState = vi.hoisted(() => ({
  SUPABASE_URL: "https://test-project.supabase.co",
}));

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
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    get SUPABASE_URL() {
      return envState.SUPABASE_URL;
    },
  },
}));

async function loadModuleWithSupabaseUrl(url: string) {
  envState.SUPABASE_URL = url;
  vi.resetModules();
  return import("./providerHealthProbeJob.js");
}

describe("AIDV-963: probeProvider SSRF guard", () => {
  let mod: typeof import("./providerHealthProbeJob.js");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mod?.stopProviderHealthProbeCron();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  // ── ① 合法動態 URL：supabase_auth 照常通過 ──────────────────────────────
  it("supabase_auth 動態 URL（https://*.supabase.co/auth/v1/health）通過 guard、探測成功", async () => {
    mod = await loadModuleWithSupabaseUrl("https://test-project.supabase.co");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await mod._runProbeCycleForTest();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(true);
    expect(supabase!.statusCode).toBe(200);
    expect(supabase!.error).toBeUndefined();
    // guard 沒有擋：fetch 真的打到動態組出來的 health URL
    expect(fetchMock).toHaveBeenCalledWith(
      "https://test-project.supabase.co/auth/v1/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  // ── ② 惡意/內網 URL：擋下、標記失敗、不 crash job ───────────────────────
  it("IMDS URL（https://169.254.169.254）被擋：probe 標記失敗、fetch 不發出、cycle 不 throw", async () => {
    mod = await loadModuleWithSupabaseUrl("https://169.254.169.254");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    // 整個 cycle 不會 throw（guard 丟錯走該 provider 的失敗路徑）
    await expect(mod._runProbeCycleForTest()).resolves.toBeUndefined();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(false);
    expect(supabase!.error).toMatch(/ssrf-blocked/);
    expect(supabase!.consecutiveFailures).toBe(1);
    expect(supabase!.statusCode).toBeUndefined();

    // 被擋的 URL 完全沒有 egress
    const probedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(probedUrls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("內網 URL 被擋時其他 provider 照常探測（job 不會整個死掉）", async () => {
    mod = await loadModuleWithSupabaseUrl("http://10.0.0.1");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mod._runProbeCycleForTest()).resolves.toBeUndefined();

    const status = mod.getProviderProbeStatus();
    const supabase = status.find((s) => s.providerId === "supabase_auth");
    const fal = status.find((s) => s.providerId === "fal");
    const gemini = status.find((s) => s.providerId === "gemini");

    // 被擋的標記失敗
    expect(supabase!.ok).toBe(false);
    expect(supabase!.error).toMatch(/ssrf-blocked/);
    // 其他合法 provider 不受影響、照常成功
    expect(fal).toBeDefined();
    expect(fal!.ok).toBe(true);
    expect(gemini).toBeDefined();
    expect(gemini!.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://queue.fal.run/fal-ai/flux/requests",
      expect.anything()
    );
  });

  // ── ③ NODE_ENV 旗標兩側釘住（mutation gate）───────────────────────────────
  // guard 第二參數是 `process.env.NODE_ENV !== "production"`（呼叫時讀取）。
  // 這兩個測試在「同一個 URL」上於兩種模式得到相反判定，任何人把旗標硬編成
  // true / false（或 ssrfGuard 改預設值）都至少會弄紅其中一個。
  it("production 模式：http://localhost 動態 URL 被擋（prod 保持嚴格、零 egress）", async () => {
    mod = await loadModuleWithSupabaseUrl("http://localhost:54321");
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(mod._runProbeCycleForTest()).resolves.toBeUndefined();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(false);
    expect(supabase!.error).toMatch(/ssrf-blocked/);
    // 被擋的 URL 完全沒有 egress
    const probedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(probedUrls.some((u) => u.includes("localhost:54321"))).toBe(false);
  });

  it("development 模式：http://localhost 動態 URL 放行（本地 supabase 不受影響）", async () => {
    mod = await loadModuleWithSupabaseUrl("http://localhost:54321");
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await mod._runProbeCycleForTest();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase).toBeDefined();
    expect(supabase!.ok).toBe(true);
    expect(supabase!.statusCode).toBe(200);
    expect(supabase!.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:54321/auth/v1/health",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("guard 失敗走與探測失敗相同的計數路徑：連續兩輪 → consecutiveFailures 累加", async () => {
    mod = await loadModuleWithSupabaseUrl("https://169.254.169.254");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true }));

    await mod._runProbeCycleForTest();
    await mod._runProbeCycleForTest();

    const supabase = mod.getProviderProbeStatus().find((s) => s.providerId === "supabase_auth");
    expect(supabase!.ok).toBe(false);
    expect(supabase!.consecutiveFailures).toBe(2);
  });
});
