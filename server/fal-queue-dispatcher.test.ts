import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchFalQueueTask } from "./services/falDispatcher";

describe("dispatchFalQueueTask", () => {
  beforeEach(() => {
    process.env.FAL_API_KEY = "test-fal-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FAL_API_KEY;
  });

  it("submits to fal.ai queue and returns request_id", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchFalQueueTask({
      modelId: "fal-ai/flux/dev",
      input: { prompt: "test" },
      route: "test.dispatch",
    });

    expect(result.request_id).toBe("req-123");
    expect(result.modelId).toBe("fal-ai/flux/dev");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://queue.fal.run/fal-ai/flux/dev");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("appends webhook url to query string when provided", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-2" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchFalQueueTask({
      modelId: "fal-ai/flux/dev",
      input: { prompt: "x" },
      webhookUrl: "https://app.example.com/api/webhook/fal",
    });

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("?fal_webhook=");
    expect(url).toContain(encodeURIComponent("https://app.example.com/api/webhook/fal"));
  });

  it("falls back to FALLBACK_CHAINS[category] first when modelId not in catalog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-fallback" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchFalQueueTask({
      modelId: "fal-ai/imaginary-model-not-in-catalog",
      category: "text-to-image",
      input: { prompt: "x" },
    });

    expect(result.degraded).toBe(true);
    expect(result.originalModel).toBe("fal-ai/imaginary-model-not-in-catalog");
    expect(result.modelId).not.toBe("fal-ai/imaginary-model-not-in-catalog");
    // submitted to the fallback model, not the original
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).not.toContain("imaginary-model-not-in-catalog");
  });

  it("does NOT fallback when category is missing and modelId not in catalog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-noop" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchFalQueueTask({
      modelId: "fal-ai/some-unlisted-model",
      input: { prompt: "x" },
    });

    expect(result.degraded).toBeUndefined();
    expect(result.modelId).toBe("fal-ai/some-unlisted-model");
  });

  it("includes extraHeaders in the queue submit request", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ request_id: "req-h" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await dispatchFalQueueTask({
      modelId: "fal-ai/flux/dev",
      input: { prompt: "x" },
      extraHeaders: { "x-fal-client-credentials": "client-creds" },
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-fal-client-credentials"]).toBe("client-creds");
    expect(headers.Authorization).toBe("Key test-fal-key");
  });

  it("throws on non-retryable 4xx without walking fallback chain", async () => {
    // 422 is a client error — caller's input is wrong; falling back to a
    // sibling model would just hit the same validation failure.
    const fetchMock = vi.fn(async () =>
      new Response("invalid prompt", { status: 422 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dispatchFalQueueTask({
        modelId: "fal-ai/flux/dev",
        input: { prompt: "x" },
      })
    ).rejects.toThrow(/fal\.ai queue submit error/);
    // Exactly one queue submit attempt — non-retryable errors short-circuit
    // the fallback chain. (Other fetches like brave-search auto-repair go
    // to non-fal hosts; we filter by host to ignore them.)
    const queueCalls = fetchMock.mock.calls.filter(c =>
      String(c[0]).startsWith("https://queue.fal.run/")
    );
    expect(queueCalls).toHaveLength(1);
  });

  it("walks fallback chain on retryable 5xx and degrades to next candidate", async () => {
    // Primary returns 503 (retryable); the first fallback succeeds. The
    // dispatcher should mark the result as degraded with the original
    // modelId so the UI can surface the swap.
    let callIdx = 0;
    const fetchMock = vi.fn(async (url: string) => {
      callIdx++;
      // First call → primary (flux-pro/v1.1) returns 503
      if (callIdx === 1) {
        return new Response("upstream busy", { status: 503 });
      }
      // Second call → fallback model succeeds
      return new Response(JSON.stringify({ request_id: "req-ok" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchFalQueueTask({
      modelId: "fal-ai/flux-pro/v1.1",
      input: { prompt: "x" },
    });

    expect(result.request_id).toBe("req-ok");
    expect(result.degraded).toBe(true);
    expect(result.originalModel).toBe("fal-ai/flux-pro/v1.1");
    expect(result.modelId).not.toBe("fal-ai/flux-pro/v1.1");
    // The dispatcher also fires auxiliary fetches (langsmith trace,
    // brain-auto-repair telemetry) that share the stubbed `fetch`.
    // What we actually care about is the queue submit count — primary
    // (503) + first successful fallback = 2 — so filter by host like
    // the 4xx-short-circuit test does above.
    const queueCalls = fetchMock.mock.calls.filter(c =>
      String(c[0]).startsWith("https://queue.fal.run/"),
    );
    expect(queueCalls).toHaveLength(2);
  }, 10_000);

  it("throws when FAL_API_KEY missing", async () => {
    delete process.env.FAL_API_KEY;

    await expect(
      dispatchFalQueueTask({
        modelId: "fal-ai/flux/dev",
        input: { prompt: "x" },
      })
    ).rejects.toThrow(/FAL_API_KEY/);
  });
});
