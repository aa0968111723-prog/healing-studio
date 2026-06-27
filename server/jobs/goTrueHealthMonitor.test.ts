import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/env.validated.js", () => ({
  serverEnv: {
    SUPABASE_URL: "https://test.supabase.co",
    ALERT_SLACK_WEBHOOK: "",
  },
}));

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })) },
  schedule: vi.fn(() => ({ stop: vi.fn() })),
}));

describe("goTrueHealthMonitor (AIDV-352)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("exports initGoTrueHealthMonitorCron and stopGoTrueHealthMonitorCron", async () => {
    const mod = await import("./goTrueHealthMonitor.js");
    expect(typeof mod.initGoTrueHealthMonitorCron).toBe("function");
    expect(typeof mod.stopGoTrueHealthMonitorCron).toBe("function");
  });

  it("exports getGoTrueHealthState with initial zero consecutive failures", async () => {
    const mod = await import("./goTrueHealthMonitor.js");
    const state = mod.getGoTrueHealthState();
    expect(state).toHaveProperty("consecutiveFailures");
    expect(state).toHaveProperty("wasUnhealthy");
  });

  it("registers goTrueHealthMonitor in SCHEDULED_MAINTENANCE_JOBS via index import", async () => {
    const cron = await import("node-cron");
    const scheduleSpy = vi.spyOn(cron, "schedule");
    const mod = await import("./goTrueHealthMonitor.js");
    mod.initGoTrueHealthMonitorCron();
    expect(scheduleSpy).toHaveBeenCalledWith(
      "* * * * *",
      expect.any(Function)
    );
  });
});
