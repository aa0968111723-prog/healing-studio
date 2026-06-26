import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
