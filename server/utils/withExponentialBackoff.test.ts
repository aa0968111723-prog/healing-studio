/**
 * withExponentialBackoff.test.ts — AIDV-357
 *
 * 驗收條件：
 * - 成功呼叫直接回傳，不重試
 * - 第 N 次失敗後重試，最終成功
 * - 超過 maxRetries 後拋出最後錯誤
 * - shouldRetry=false 不重試立即拋出
 * - onRetry callback 攜帶正確的 attempt 與 delayMs（> 0）
 * - jitter=false 時 delay = base * 2^attempt（精確）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub setTimeout so tests don't actually wait
vi.stubGlobal("setTimeout", (fn: () => void, _ms: number) => {
  fn();
  return 0 as unknown as ReturnType<typeof setTimeout>;
});

import { withExponentialBackoff } from "./withExponentialBackoff";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("withExponentialBackoff — AIDV-357", () => {
  it("成功呼叫直接回傳，不重試", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withExponentialBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("第 2 次才成功 → 重試 1 次", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      if (++calls < 2) throw new Error("transient");
      return "ok";
    });
    const result = await withExponentialBackoff(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("超過 maxRetries 後拋出最後錯誤", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(withExponentialBackoff(fn, { maxRetries: 2 })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(3); // 1 original + 2 retries
  });

  it("shouldRetry=false 時不重試，立即拋出", async () => {
    const fn = vi.fn(async () => {
      throw new Error("no-retry");
    });
    await expect(
      withExponentialBackoff(fn, {
        maxRetries: 5,
        shouldRetry: () => false,
      })
    ).rejects.toThrow("no-retry");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onRetry callback 攜帶正確 attempt（從 1 開始）", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      if (++calls < 3) throw new Error("x");
      return "done";
    });
    const retries: number[] = [];
    await withExponentialBackoff(fn, {
      maxRetries: 5,
      jitter: false,
      onRetry: (_err, attempt) => retries.push(attempt),
    });
    expect(retries).toEqual([1, 2]);
  });

  it("jitter=false 時 delay = base * 2^attempt（可驗算）", async () => {
    const delays: number[] = [];
    const fn = vi.fn(async () => {
      throw new Error("always fail");
    });
    // maxRetries=2 → 2 delays before final throw
    await withExponentialBackoff(fn, {
      maxRetries: 2,
      base: 100,
      jitter: false,
      onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
    }).catch(() => {});
    // attempt 0 → 100*2^0 = 100; attempt 1 → 100*2^1 = 200
    expect(delays).toEqual([100, 200]);
  });

  it("maxRetries=0 → 一次失敗即拋出", async () => {
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(withExponentialBackoff(fn, { maxRetries: 0 })).rejects.toThrow("x");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
