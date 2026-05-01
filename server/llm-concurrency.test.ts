/**
 * llm-concurrency.test.ts — withLLMSlot semaphore correctness
 *
 * 驗證重點：
 *   1. 同時間最多 N 個請求 in-flight（N = MAX_CONCURRENT_LLM_CALLS，測試固定 limit=2）
 *   2. fn 拋例外時 slot 仍會被釋放（finally 路徑）
 *   3. 大量請求排隊時 FIFO 順序
 *   4. stats() 正確回報 active/pending
 */

import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // 在 import semaphore 之前先把 limit 鎖在 2，便於觀察排隊行為
  process.env.MAX_CONCURRENT_LLM_CALLS = "2";
});

// 動態 import 確保上面的 process.env 設定先生效
async function importSemaphore() {
  const mod = await import("./_core/llmConcurrency");
  return mod;
}

describe("withLLMSlot semaphore", () => {
  it("respects the configured concurrency limit", async () => {
    const { withLLMSlot, llmSemaphore } = await importSemaphore();
    expect(llmSemaphore.limit).toBe(2);

    let inflight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 5 }, async () =>
      withLLMSlot(async () => {
        inflight++;
        peak = Math.max(peak, inflight);
        await new Promise(r => setTimeout(r, 10));
        inflight--;
        return "ok";
      })
    );

    const results = await Promise.all(tasks);
    expect(results).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("releases the slot when fn throws", async () => {
    const { withLLMSlot, llmSemaphore } = await importSemaphore();

    await expect(
      withLLMSlot(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // 失敗後 active 必須回到 0，否則後續呼叫會永久卡住
    expect(llmSemaphore.stats().active).toBe(0);
  });

  it("processes the queue in FIFO order", async () => {
    const { withLLMSlot } = await importSemaphore();

    const order: number[] = [];
    // 先佔滿兩個 slot 並維持忙碌
    const slow1 = withLLMSlot(async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(1);
    });
    const slow2 = withLLMSlot(async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push(2);
    });
    // 排隊的 3 個應該按提交順序執行
    const queued3 = withLLMSlot(async () => {
      order.push(3);
    });
    const queued4 = withLLMSlot(async () => {
      order.push(4);
    });
    const queued5 = withLLMSlot(async () => {
      order.push(5);
    });

    await Promise.all([slow1, slow2, queued3, queued4, queued5]);
    // 1 與 2 哪個先 settle 不確定（同時 setTimeout），但 3/4/5 必為 FIFO
    const idx3 = order.indexOf(3);
    const idx4 = order.indexOf(4);
    const idx5 = order.indexOf(5);
    expect(idx3).toBeLessThan(idx4);
    expect(idx4).toBeLessThan(idx5);
  });

  it("reports active and pending in stats()", async () => {
    const { withLLMSlot, llmSemaphore } = await importSemaphore();
    expect(llmSemaphore.stats().active).toBe(0);
    expect(llmSemaphore.stats().pending).toBe(0);

    let resolveBlocker: (() => void) | null = null;
    const blocker = new Promise<void>(r => { resolveBlocker = r; });

    // 兩個 slot 都被佔住，第三個應在 pending
    const t1 = withLLMSlot(() => blocker);
    const t2 = withLLMSlot(() => blocker);
    const t3 = withLLMSlot(async () => undefined);

    // 等到 microtask flush，acquire 才會結算
    await new Promise(r => setTimeout(r, 0));
    expect(llmSemaphore.stats().active).toBe(2);
    expect(llmSemaphore.stats().pending).toBe(1);

    resolveBlocker!();
    await Promise.all([t1, t2, t3]);
    expect(llmSemaphore.stats().active).toBe(0);
    expect(llmSemaphore.stats().pending).toBe(0);
  });
});
