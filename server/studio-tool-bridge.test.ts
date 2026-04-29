import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
} from "../shared/global-agent-tools";
import { executeOrbToolCalls } from "./services/agentToolExecutor";

describe("studio.* generation tool registration", () => {
  it("registers all four studio generation tools", () => {
    const names = GLOBAL_AGENT_TOOL_REGISTRY.map(t => t.name);
    expect(names).toContain("studio.generateImage");
    expect(names).toContain("studio.generateVideo");
    expect(names).toContain("studio.generateAudio");
    expect(names).toContain("studio.generateVoice");
  });

  it("studio.* tools require human approval", () => {
    for (const name of [
      "studio.generateImage",
      "studio.generateVideo",
      "studio.generateAudio",
      "studio.generateVoice",
    ]) {
      const tool = getGlobalAgentTool(name);
      expect(tool, name).not.toBeNull();
      expect(tool!.requiresHuman, `${name} requiresHuman`).toBe(true);
      expect(tool!.executionTarget).toBe("server-side");
    }
  });

  it("isKnownGlobalAgentTool recognises studio.* tools", () => {
    expect(isKnownGlobalAgentTool("studio.generateImage")).toBe(true);
    expect(isKnownGlobalAgentTool("studio.generateVideo")).toBe(true);
    expect(isKnownGlobalAgentTool("studio.generateAudio")).toBe(true);
    expect(isKnownGlobalAgentTool("studio.generateVoice")).toBe(true);
    expect(isKnownGlobalAgentTool("studio.unknownThing")).toBe(false);
  });
});

describe("executeOrbToolCalls — studio.* bridge", () => {
  beforeEach(() => {
    process.env.FAL_API_KEY = "test-fal-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.FAL_API_KEY;
  });

  it("returns confirmation-required when approved=false on studio.generateImage", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: { prompt: "a cyberpunk city" },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: false,
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "studio.generateImage",
      ok: false,
      error: "confirmation-required",
    });
  });

  it("dispatches studio.generateImage to fal.ai queue when approved", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-img-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: { prompt: "a cyberpunk city", aspect_ratio: "16:9" },
        },
      ],
      userId: 42,
      userRole: "user",
      approved: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toMatch(/queue\.fal\.run/);
    expect(out[0].ok).toBe(true);
    expect(out[0].data).toMatchObject({
      request_id: "req-img-1",
      engine: "fal",
    });
  });

  it("respects blockedTools on studio.* tools", async () => {
    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          args: { prompt: "x" },
        },
      ],
      userId: 1,
      userRole: "user",
      approved: true,
      blockedTools: ["studio.generateImage"],
    });

    expect(out[0]).toMatchObject({
      name: "studio.generateImage",
      ok: false,
      error: "tool-blocked-by-user",
    });
  });

  it("audits studio.* calls via onAuditEvent", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events: Array<Record<string, unknown>> = [];
    await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateVideo",
          args: { prompt: "ocean waves" },
        },
      ],
      userId: 7,
      userRole: "user",
      approved: true,
      onAuditEvent: ev => events.push(ev as Record<string, unknown>),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      toolName: "studio.generateVideo",
      ok: true,
      userId: 7,
    });
  });
});
