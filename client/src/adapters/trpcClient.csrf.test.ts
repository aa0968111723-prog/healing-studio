// ============================================================================
// trpcClient.csrf.test.ts — AIDV-571 回歸鎖：adapter vanilla client 兩條 link
// 都必須帶 `x-trpc-source: web`（AIDV-219 CSRF guard），否則所有 adapter-routed
// mutation 會被伺服器擋成 HTTP 403。
// ----------------------------------------------------------------------------
// 為什麼用 fetch spy 而非 mock client：本卡的 bug 正是「真實 client 的 link 漏設
// headers」。既有 adapter 測試都把 getTrpcClient 整顆 mock 掉，因此無法觸發此 bug。
// 這裡刻意走「真實 getTrpcClient() → 真實 link → spy 過的 globalThis.fetch」，
// 攔截送出的 request headers 來證明 header 確實被注入。
//   - heavy path（generate.*）→ splitLink 走 httpLink
//   - light path（auth.*）   → splitLink 走 httpBatchLink
// 兩條都驗，對齊 main.tsx 的兩 link 設定。
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Captured = { url: string; headers: Record<string, string> };

describe("AIDV-571 adapter trpcClient 兩 link 帶 x-trpc-source", () => {
  const calls: Captured[] = [];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    calls.length = 0;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: unknown, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      const rec: Record<string, string> = {};
      h.forEach((v, k) => { rec[k] = v; });
      calls.push({ url: String((input as { url?: string })?.url ?? input), headers: rec });
      // 回最小可解析的回應；本測試只關心送出的 headers，不關心回應內容。
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.resetModules();
  });

  it("heavy path（generate.*，httpLink）送出 x-trpc-source: web", async () => {
    const { getTrpcClient } = await import("./trpcClient");
    // 真實 client 以 AppRouter 強型別；此處用任意 path 驗 link 行為，故 cast。
    const client = getTrpcClient() as unknown as {
      generate: { activeJobs: { query: () => Promise<unknown> } };
    };
    await client.generate.activeJobs.query().catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.headers["x-trpc-source"] === "web")).toBe(true);
  });

  it("light path（auth.*，httpBatchLink）送出 x-trpc-source: web", async () => {
    const { getTrpcClient } = await import("./trpcClient");
    const client = getTrpcClient() as unknown as {
      auth: { me: { query: () => Promise<unknown> } };
    };
    await client.auth.me.query().catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.headers["x-trpc-source"] === "web")).toBe(true);
  });
});
