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

  it("falls through to brain-config engine slot when modelId is omitted (all 4 generate tools)", async () => {
    // 統一驗證四個 studio.* 工具：呼叫端沒指定 modelId 時，必須讀大腦組態的
    // 對應 engine slot，而不是 hardcoded 的舊預設。沒有 DB 的測試環境會
    // 退回 DEFAULT_GENERATION_ENGINES，所以這裡斷言 URL 命中那些預設值。
    const { DEFAULT_GENERATION_ENGINES } = await import(
      "./middleware/brainContext"
    );
    const expected: Array<{
      tool: string;
      args: Record<string, unknown>;
      slot: keyof typeof DEFAULT_GENERATION_ENGINES;
    }> = [
      { tool: "studio.generateImage", args: { prompt: "x" }, slot: "imageEngine" },
      // 影片只有 t2v 走 brain；i2v / v2v 各有結構性預設。這裡測 t2v。
      { tool: "studio.generateVideo", args: { prompt: "x" }, slot: "videoEngine" },
      { tool: "studio.generateAudio", args: { prompt: "x" }, slot: "audioEngine" },
      { tool: "studio.generateVoice", args: { text: "你好" }, slot: "voiceEngine" },
    ];

    for (const { tool, args, slot } of expected) {
      const submitUrls: string[] = [];
      const fetchMock = vi.fn(async (url: string) => {
        submitUrls.push(url);
        return new Response(JSON.stringify({ request_id: `req-${slot}` }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const out = await executeOrbToolCalls({
        tools: [],
        calls: [
          {
            name: tool,
            // 不帶 modelId — 必須由 brain config 解析
            args: { ...args, wait: false },
          },
        ],
        userId: 1234,
        userRole: "user",
        approved: true,
      });

      expect(out[0].ok, `${tool} should succeed`).toBe(true);
      // queue.fal.run/<modelId> — modelId 必須等於 brain 預設 engine
      const expectedEngine = DEFAULT_GENERATION_ENGINES[slot].engine;
      expect(
        submitUrls[0],
        `${tool} should dispatch to brain ${slot}=${expectedEngine}`
      ).toContain(expectedEngine);

      vi.unstubAllGlobals();
    }
  });

  it("propagates extended voice args (language_code, voice_settings) into the fal payload", async () => {
    // 多語 TTS / 聲音調諧的 orb args 必須出現在送往 fal 的 request body，
    // 否則光球發起的「日文 TTS」會落回英文預設。
    const captured: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body
        ? JSON.parse(init.body as string)
        : undefined;
      captured.push({ url, body });
      return new Response(JSON.stringify({ request_id: "req-voice" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateVoice",
          args: {
            text: "こんにちは",
            language_code: "ja",
            stability: 0.6,
            similarity_boost: 0.85,
            style: 0.2,
            wait: false,
          },
        },
      ],
      userId: 555,
      userRole: "user",
      approved: true,
    });

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.text).toBe("こんにちは");
    expect(body.language_code).toBe("ja");
    expect(body.voice_settings).toMatchObject({
      stability: 0.6,
      similarity_boost: 0.85,
      style: 0.2,
    });
  });

  it("propagates extended audio args (tags, bpm) into the fal payload", async () => {
    // 對 Sonauto，tags 應該展開為陣列；對其他模型併入 prompt。
    const captured: Array<{ body: unknown }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body
        ? JSON.parse(init.body as string)
        : undefined;
      captured.push({ body });
      return new Response(JSON.stringify({ request_id: "req-audio" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await executeOrbToolCalls({
      tools: [],
      calls: [
        {
          name: "studio.generateAudio",
          args: {
            prompt: "lo-fi study beats",
            modelId: "fal-ai/sonauto", // 走 Sonauto，tags 應為陣列
            tags: "chill, lofi, study",
            bpm: 90,
            wait: false,
          },
        },
      ],
      userId: 777,
      userRole: "user",
      approved: true,
    });

    expect(captured).toHaveLength(1);
    const body = captured[0]!.body as Record<string, unknown>;
    expect(body.tags).toEqual(["chill", "lofi", "study"]);
    expect(body.bpm).toBe(90);
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
