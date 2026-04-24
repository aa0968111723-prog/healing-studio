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
});
