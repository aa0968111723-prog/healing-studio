import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  getGlobalAgentTool,
  isKnownGlobalAgentTool,
} from "../shared/global-agent-tools";
import { executeOrbToolCalls } from "./services/agentToolExecutor";

describe("studio.* generation tool registration", () => {
  it("registers all studio generation tools", () => {
    const names = GLOBAL_AGENT_TOOL_REGISTRY.map(t => t.name);
    expect(names).toContain("studio.generateImage");
    expect(names).toContain("studio.generateVideo");
    expect(names).toContain("studio.generateAudio");
    // DEF-SFX2：SFX 與 Audio（音樂）分流
    expect(names).toContain("studio.generateSfx");
    expect(names).toContain("studio.generateVoice");
  });

  it("studio.* tools require human approval", () => {
    for (const name of [
      "studio.generateImage",
      "studio.generateVideo",
      "studio.generateAudio",
      "studio.generateSfx",
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
    expect(isKnownGlobalAgentTool("studio.generateSfx")).toBe(true);
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
    // Fire-and-forget mode (wait: false) — verifies the queue submit step
    // without paying the cost of the awaiter polling fal for completion.
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
          args: { prompt: "a cyberpunk city", aspect_ratio: "16:9", wait: false },
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
      status: "pending",
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
          // wait: false avoids polling fal for completion (covered separately)
          args: { prompt: "ocean waves", wait: false },
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

  it("waits for fal queue completion and exposes media URLs to chained steps", async () => {
    // Default behaviour (no wait flag) must poll fal until COMPLETED so
    // multi-step pipelines can chain ${stepN.image_url} into the next call.
    const calls: Array<{ url: string }> = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push({ url });
      // 1) Queue submit
      if (url.startsWith("https://queue.fal.run/") && !url.includes("/requests/")) {
        return new Response(JSON.stringify({ request_id: "req-await-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // 2) Status poll → COMPLETED on first poll
      if (url.endsWith("/status")) {
        return new Response(JSON.stringify({ status: "COMPLETED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // 3) Result fetch → canonical image_url shape
      return new Response(
        JSON.stringify({
          images: [{ url: "https://fal.media/result/req-await-1.png" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateImage",
          // No wait flag — must default to polling completion.
          args: { prompt: "a forest", timeoutMs: 5_000 },
        },
      ],
      userId: 99,
      userRole: "user",
      approved: true,
    });

    expect(out[0].ok).toBe(true);
    expect(out[0].data).toMatchObject({
      request_id: "req-await-1",
      status: "completed",
      engine: "fal",
      image_url: "https://fal.media/result/req-await-1.png",
      output_url: "https://fal.media/result/req-await-1.png",
    });
    // submit + status + result fetch
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
