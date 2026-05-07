/**
 * llm-cache-dedupe.test.ts — invokeLLM 的快取與去重整合測試
 *
 * 用 vi.stubGlobal 攔截 fetch，驗證：
 *   1. cacheable=true 時：第二次相同呼叫直接命中快取（fetch 只被叫 1 次）
 *   2. dedupe（預設）：併發兩個相同請求 → fetch 只被叫 1 次（in-flight 合併）
 *   3. 不同 messages → 各自呼叫一次（不會誤命中）
 *   4. cacheable=false（預設）→ 每次都打網路
 */

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

vi.hoisted(() => {
  // 強制使用單一引擎，避免 fallback chain 拖慢測試
  process.env.LLM_ENGINE = "openrouter";
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-or-key";
  process.env.LANGCHAIN_TRACING_V2 = "false"; // 關閉 LangSmith 追蹤避免雜訊
});

// 動態 import 確保 env 已就緒
async function importModules() {
  const llm = await import("./_core/llm");
  const cache = await import("./_core/cache");
  const dedup = await import("./_core/deduplication");
  return { llm, cache: cache.cache, dedup: dedup.dedup };
}

function fakeOpenRouterResponse(text: string) {
  const body = {
    id: `chatcmpl-${Math.random().toString(36).slice(2)}`,
    created: Math.floor(Date.now() / 1000),
    model: "anthropic/claude-haiku-4.5",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("invokeLLM cache + dedupe integration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fetchMock = vi.fn(async () => fakeOpenRouterResponse("hello world"));
    vi.stubGlobal("fetch", fetchMock);
    // 清空快取與 dedup 狀態，確保測試彼此獨立
    const { cache, dedup } = await importModules();
    await cache.clear();
    dedup.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cacheable=true：相同呼叫第二次直接命中快取", async () => {
    const { llm } = await importModules();
    const params = {
      messages: [{ role: "user" as const, content: "Hello" }],
      cacheable: true,
      // 強制單一引擎避免 fallback 影響呼叫次數計數
      engine: "openrouter" as const,
    };

    const r1 = await llm.invokeLLM(params);
    const r2 = await llm.invokeLLM(params);

    expect(r1.choices[0].message.content).toBe("hello world");
    expect(r2.choices[0].message.content).toBe("hello world");
    // 第二次該命中快取 — fetch 只被叫一次
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupe 預設啟用：併發相同請求只打一次網路", async () => {
    const { llm } = await importModules();

    // 讓 fetch 等 50ms 才回應，模擬正常網路延遲
    fetchMock.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return fakeOpenRouterResponse("dedup-test");
    });

    const params = {
      messages: [{ role: "user" as const, content: "dedup me" }],
      engine: "openrouter" as const,
    };

    const [a, b, c] = await Promise.all([
      llm.invokeLLM(params),
      llm.invokeLLM(params),
      llm.invokeLLM(params),
    ]);

    expect(a.choices[0].message.content).toBe("dedup-test");
    expect(b.choices[0].message.content).toBe("dedup-test");
    expect(c.choices[0].message.content).toBe("dedup-test");
    // 三個併發但合併成一次網路呼叫
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupe=false：併發請求各自打網路", async () => {
    const { llm } = await importModules();
    fetchMock.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 30));
      return fakeOpenRouterResponse("no-dedup");
    });

    const params = {
      messages: [{ role: "user" as const, content: "no-dedup" }],
      engine: "openrouter" as const,
      dedupe: false,
    };

    await Promise.all([llm.invokeLLM(params), llm.invokeLLM(params)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("不同 messages → 不會誤命中快取", async () => {
    const { llm } = await importModules();

    await llm.invokeLLM({
      messages: [{ role: "user", content: "first" }],
      cacheable: true,
      engine: "openrouter",
    });
    await llm.invokeLLM({
      messages: [{ role: "user", content: "second" }],
      cacheable: true,
      engine: "openrouter",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cacheable=false（預設）→ 每次都打網路", async () => {
    const { llm } = await importModules();
    const params = {
      messages: [{ role: "user" as const, content: "no cache" }],
      engine: "openrouter" as const,
      // 關掉 dedupe 以隔離 cache 行為
      dedupe: false,
    };

    await llm.invokeLLM(params);
    await llm.invokeLLM(params);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
