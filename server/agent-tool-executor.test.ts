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
