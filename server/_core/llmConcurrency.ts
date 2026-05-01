/**
 * llmConcurrency.ts — Global semaphore for outbound LLM HTTP calls.
 *
 * 目的：
 *   防止 burst traffic（例 brain.ts 一次 Promise.all 5+ 個 research query）打爆
 *   provider rate limit / 自家 budget。所有經過 invokeLLM 的請求都會走這個閘道。
 *
 * 行為：
 *   - 上限由 MAX_CONCURRENT_LLM_CALLS（預設 5）控制
 *   - 超過上限時請求進佇列，FIFO 順序
 *   - acquire() 永遠 resolve，不會 reject 或 timeout（呼叫端的 LLM 請求本身有 AbortSignal）
 *   - 確保 release() 呼叫即使 callback 拋例外（withSemaphore wrapper 處理）
 *
 * 為何不用 p-limit：
 *   外部依賴會擴大 install footprint；這個檔案 ~30 行夠用且零依賴。
 */

import { serverEnv } from "./env.validated";

class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(public readonly limit: number) {}

  acquire(): Promise<void> {
    return new Promise(resolve => {
      if (this.current < this.limit) {
        this.current++;
        resolve();
      } else {
        this.queue.push(() => {
          this.current++;
          resolve();
        });
      }
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** 觀測用：目前正在進行的請求數 + 等待中的請求數 */
  stats(): { active: number; pending: number; limit: number } {
    return { active: this.current, pending: this.queue.length, limit: this.limit };
  }
}

const limit = (() => {
  const parsed = parseInt(serverEnv.MAX_CONCURRENT_LLM_CALLS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
})();

export const llmSemaphore = new Semaphore(limit);

/**
 * 把 LLM 呼叫包進 semaphore。任何例外都會 release() 後再 re-throw，
 * 確保 quota 不會被洩漏的 acquire() 卡住。
 */
export async function withLLMSlot<T>(fn: () => Promise<T>): Promise<T> {
  await llmSemaphore.acquire();
  try {
    return await fn();
  } finally {
    llmSemaphore.release();
  }
}
