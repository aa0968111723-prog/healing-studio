import { afterEach, describe, expect, it, vi } from "vitest";
import { executeOrbToolCalls, type OrbApiTool } from "./services/agentToolExecutor";

describe("executeOrbToolCalls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
  });

  it("blocks tools when allowlist env is missing", async () => {
    const tools: OrbApiTool[] = [
      {
        name: "lookupWeather",
        description: "weather",
        method: "GET",
        endpoint: "https://api.example.com/weather",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "lookupWeather", args: { city: "Taipei" } }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain("ORB_TOOL_ALLOWED_ORIGINS");
  });

  it("requires confirmation for destructive tools", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";

    const tools: OrbApiTool[] = [
      {
        name: "createTicket",
        description: "create",
        method: "POST",
        endpoint: "https://api.example.com/tickets",
        requireConfirmation: true,
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "createTicket", args: { title: "x" } }],
      userId: 1,
      userRole: "user",
      approved: false,
    });

    expect(out).toEqual([
      expect.objectContaining({
        name: "createTicket",
        ok: false,
        error: "confirmation-required",
      }),
    ]);
  });

  it("executes GET tool call and injects user header", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({ ok: true, userId: headers.get("x-orb-user-id") }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tools: OrbApiTool[] = [
      {
        name: "lookupWeather",
        description: "weather",
        method: "GET",
        endpoint: "https://api.example.com/weather",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "lookupWeather", args: { city: "Taipei" } }],
      userId: 77,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      expect.objectContaining({
        name: "lookupWeather",
        ok: true,
        status: 200,
        data: { ok: true, userId: "77" },
      }),
    ]);
  });

  it("retries transient errors and succeeds", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary", { status: 503, headers: { "content-type": "text/plain" } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [
        {
          name: "unstable.lookup",
          description: "unstable",
          method: "GET",
          endpoint: "https://api.example.com/unstable",
          retryPolicy: { maxRetries: 1, backoffMs: 50 },
        },
      ],
      calls: [{ name: "unstable.lookup" }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0]).toEqual(
      expect.objectContaining({
        name: "unstable.lookup",
        ok: true,
        attempts: 2,
        usedTool: "unstable.lookup",
      })
    );
  });

  it("falls back to secondary tool when primary fails", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cached: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [
        {
          name: "crm.lookup",
          description: "primary",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          fallbackTools: ["crm.lookup.cached"],
        },
        {
          name: "crm.lookup.cached",
          description: "fallback",
          method: "GET",
          endpoint: "https://api.example.com/customers-cache",
        },
      ],
      calls: [{ name: "crm.lookup", args: { id: "u1" } }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0]).toEqual(
      expect.objectContaining({
        name: "crm.lookup",
        ok: true,
        usedTool: "crm.lookup.cached",
      })
    );
  });

  it("AIDV-780：未經核准時，requireConfirmation 的 fallback 不得被執行（授權缺口修補）", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [
        {
          name: "crm.lookup",
          description: "primary",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          fallbackTools: ["crm.delete.cached"],
        },
        {
          name: "crm.delete.cached",
          description: "destructive fallback",
          method: "GET",
          endpoint: "https://api.example.com/customers-cache",
          requireConfirmation: true,
        },
      ],
      calls: [{ name: "crm.lookup", args: { id: "u1" } }],
      userId: 1,
      userRole: "user",
      approved: false,
    });

    // 只打了主工具一次；需確認的 fallback 沒被執行
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out[0].ok).toBe(false);
    expect((out[0] as { usedTool?: string }).usedTool).not.toBe("crm.delete.cached");
  });

  it("AIDV-780：已核准（approved）時，requireConfirmation 的 fallback 照常可用（正常路徑零變化）", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ cached: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [
        {
          name: "crm.lookup",
          description: "primary",
          method: "GET",
          endpoint: "https://api.example.com/customers",
          fallbackTools: ["crm.lookup.cached"],
        },
        {
          name: "crm.lookup.cached",
          description: "confirmed fallback",
          method: "GET",
          endpoint: "https://api.example.com/customers-cache",
          requireConfirmation: true,
        },
      ],
      calls: [{ name: "crm.lookup", args: { id: "u1" } }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out[0]).toEqual(
      expect.objectContaining({ ok: true, usedTool: "crm.lookup.cached" })
    );
  });

  it("blocks tool call when role is not allowed", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    const tools: OrbApiTool[] = [
      {
        name: "adminOnly",
        description: "admin tool",
        method: "POST",
        endpoint: "https://api.example.com/admin",
        allowedRoles: ["admin"],
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "adminOnly", args: { op: "x" } }],
      userId: 2,
      userRole: "user",
      approved: true,
    });

    expect(out).toEqual([
      expect.objectContaining({
        name: "adminOnly",
        ok: false,
        error: "forbidden-role",
      }),
    ]);
  });

  it("emits audit event callback for each tool call", async () => {
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const audit = vi.fn();

    await executeOrbToolCalls({
      tools: [
        {
          name: "crm.lookup",
          description: "lookup",
          method: "GET",
          endpoint: "https://api.example.com/customers",
        },
      ],
      calls: [{ name: "crm.lookup", args: { id: "u_1" } }],
      userId: 9,
      userRole: "user",
      approved: true,
      requestId: "req_audit_1",
      taskId: "task_1",
      stepId: "step_1",
      onAuditEvent: audit,
    });

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_audit_1",
        userId: 9,
        taskId: "task_1",
        stepId: "step_1",
        toolName: "crm.lookup",
        ok: true,
      })
    );
  });
});

describe("agentToolExecutor allowlist edge cases", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
    delete process.env.ORB_TOOL_REGISTRY_JSON;
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
  });

  it("error message points operators at .env.example", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const tools: OrbApiTool[] = [
      {
        name: "lookupWeather",
        description: "weather",
        method: "GET",
        endpoint: "https://api.example.com/weather",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "lookupWeather", args: {} }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain("ORB_TOOL_ALLOWED_ORIGINS");
    expect(out[0].error).toContain(".env.example");
  });

  it("dev mode auto-allows http://localhost without env config", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tools: OrbApiTool[] = [
      {
        name: "local.ping",
        description: "ping",
        method: "GET",
        endpoint: "http://localhost:8787/ping",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "local.ping" }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out[0].ok).toBe(true);
  });

  it("dev mode auto-allows http://127.0.0.1 too", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const fetchMock = vi.fn(async () =>
      new Response("ok", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tools: OrbApiTool[] = [
      {
        name: "ip.ping",
        description: "ping",
        method: "GET",
        endpoint: "http://127.0.0.1:5000/health",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "ip.ping" }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(true);
  });

  it("production never auto-allows localhost", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const tools: OrbApiTool[] = [
      {
        name: "local.ping",
        description: "ping",
        method: "GET",
        endpoint: "http://localhost:8787/ping",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "local.ping" }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain("ORB_TOOL_ALLOWED_ORIGINS");
  });

  it("dev mode still rejects non-localhost origins not in allowlist", async () => {
    process.env.NODE_ENV = "development";
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.trusted.com";

    const tools: OrbApiTool[] = [
      {
        name: "evil.exfil",
        description: "should be blocked",
        method: "POST",
        endpoint: "https://api.evil.com/exfil",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "evil.exfil", args: { secret: "x" } }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(false);
    expect(out[0].error).toContain("allowlist");
  });

  it("explicit allowlist origin still works in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://api.trusted.com";

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const tools: OrbApiTool[] = [
      {
        name: "trusted.ping",
        description: "ping",
        method: "GET",
        endpoint: "https://api.trusted.com/ping",
      },
    ];

    const out = await executeOrbToolCalls({
      tools,
      calls: [{ name: "trusted.ping" }],
      userId: 1,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(true);
  });
});

describe("runOrbToolExecutorStartupSelfCheck", () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;
    delete process.env.ORB_TOOL_REGISTRY_JSON;
    if (ORIGINAL_NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }
    vi.restoreAllMocks();
  });

  it("warns (not throws) when registry is set but allowlist is empty in dev", async () => {
    const { _resetOrbToolExecutorSelfCheckForTest, runOrbToolExecutorStartupSelfCheck } =
      await import("./services/agentToolExecutor");
    _resetOrbToolExecutorSelfCheckForTest();

    process.env.NODE_ENV = "development";
    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      { name: "x", description: "y", method: "GET", endpoint: "https://a.com/" },
    ]);
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    runOrbToolExecutorStartupSelfCheck();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("ORB_TOOL_ALLOWED_ORIGINS");
    expect(warnSpy.mock.calls[0][0]).toContain(".env.example");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("escalates to console.error in production", async () => {
    const { _resetOrbToolExecutorSelfCheckForTest, runOrbToolExecutorStartupSelfCheck } =
      await import("./services/agentToolExecutor");
    _resetOrbToolExecutorSelfCheckForTest();

    process.env.NODE_ENV = "production";
    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      { name: "x", description: "y", method: "GET", endpoint: "https://a.com/" },
    ]);
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    runOrbToolExecutorStartupSelfCheck();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("ORB_TOOL_ALLOWED_ORIGINS");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stays silent when registry is empty (no tools defined → no problem yet)", async () => {
    const { _resetOrbToolExecutorSelfCheckForTest, runOrbToolExecutorStartupSelfCheck } =
      await import("./services/agentToolExecutor");
    _resetOrbToolExecutorSelfCheckForTest();

    delete process.env.ORB_TOOL_REGISTRY_JSON;
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    runOrbToolExecutorStartupSelfCheck();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("stays silent when both registry AND allowlist are properly configured", async () => {
    const { _resetOrbToolExecutorSelfCheckForTest, runOrbToolExecutorStartupSelfCheck } =
      await import("./services/agentToolExecutor");
    _resetOrbToolExecutorSelfCheckForTest();

    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      { name: "x", description: "y", method: "GET", endpoint: "https://a.com/" },
    ]);
    process.env.ORB_TOOL_ALLOWED_ORIGINS = "https://a.com";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    runOrbToolExecutorStartupSelfCheck();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("only fires once per process even if called repeatedly", async () => {
    const { _resetOrbToolExecutorSelfCheckForTest, runOrbToolExecutorStartupSelfCheck } =
      await import("./services/agentToolExecutor");
    _resetOrbToolExecutorSelfCheckForTest();

    process.env.NODE_ENV = "development";
    process.env.ORB_TOOL_REGISTRY_JSON = JSON.stringify([
      { name: "x", description: "y", method: "GET", endpoint: "https://a.com/" },
    ]);
    delete process.env.ORB_TOOL_ALLOWED_ORIGINS;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    runOrbToolExecutorStartupSelfCheck();
    runOrbToolExecutorStartupSelfCheck();
    runOrbToolExecutorStartupSelfCheck();

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
