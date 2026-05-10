import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdapterMock = vi.fn();
vi.mock("./services/ai-adapters/registry", () => ({
  getAdapter: getAdapterMock,
}));

describe("orbTaskExecutor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes fal task and returns success", async () => {
    getAdapterMock.mockReturnValue({
      proxy: vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x", model: "fal/flux" }), { status: 200 })),
    });
    const { executeOrbTaskStep } = await import("./services/orbTaskExecutor");
    const r = await executeOrbTaskStep({ provider: "fal_ai", path: "/v1/generate", payload: { prompt: "cat" } });
    expect(r.status).toBe("success");
    expect(r.provider).toBe("fal_ai");
  });

  it("normalizes provider errors", async () => {
    getAdapterMock.mockReturnValue({
      proxy: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad request" }), { status: 400 })),
    });
    const { executeOrbTaskStep } = await import("./services/orbTaskExecutor");
    const r = await executeOrbTaskStep({ provider: "suno", path: "/v1/music" });
    expect(r.status).toBe("failed");
    expect(r.retryable).toBe(false);
    expect(r.error).toBe("bad request");
  });

  it("chains steps with previousResult", async () => {
    const proxy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ audioId: "a1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ voiceId: "v1" }), { status: 200 }));
    getAdapterMock.mockReturnValue({ proxy });
    const { executeOrbTaskChain } = await import("./services/orbTaskExecutor");
    const out = await executeOrbTaskChain([
      { provider: "suno", path: "/v1/music", payload: { prompt: "lofi" } },
      { provider: "elevenlabs", path: "/v1/voice", payload: { text: "narrate" } },
    ]);
    expect(out).toHaveLength(2);
    const secondCallArg = proxy.mock.calls[1][0];
    expect(secondCallArg.body).toContain("previousResult");
  });
});
