/**
 * upload-content-sniff-fail-closed.test.ts — AIDV-203 驗收契約
 *
 * 驗收條件（fail-closed）：
 *   1. fetchObjectHeadBytes 連續失敗 3 次 → fetchBytesWithRetry 回 null（路由回 400）
 *   2. 第 1 次失敗、第 2 次成功 → 重試成功、回 Buffer（正常走 detectMimeMismatch）
 *   3. 每次失敗間有指數退避延遲（200ms / 400ms）
 *
 * 純邏輯測試：直接測 __uploadRouteInternals.fetchBytesWithRetry，不啟動 Express。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { __uploadRouteInternals } from "./uploadRoute";

const { fetchBytesWithRetry } = __uploadRouteInternals;

// 使用 vi.useFakeTimers 讓退避延遲不真的等（測速）。
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AIDV-203: fetchBytesWithRetry — fail-closed on exhausted retries", () => {
  it("所有嘗試均失敗 → 回 null（fail-closed）", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("R2 unavailable"));

    const promise = fetchBytesWithRetry("uploads/1/file.jpg", fetchFn, 3);
    // 推進兩輪退避計時器（200ms + 400ms）
    await vi.runAllTimersAsync();

    expect(await promise).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("第 1 次失敗、第 2 次成功 → 回 Buffer（重試有效）", async () => {
    const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce(BYTES);

    const promise = fetchBytesWithRetry("uploads/1/file.jpg", fetchFn, 3);
    await vi.runAllTimersAsync();

    expect(await promise).toEqual(BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("第 1 次成功 → 立刻回 Buffer（零重試）", async () => {
    const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const fetchFn = vi.fn().mockResolvedValueOnce(BYTES);

    const result = await fetchBytesWithRetry("uploads/1/file.png", fetchFn, 3);

    expect(result).toEqual(BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("退避延遲：第 1 次失敗後等 200ms，第 2 次失敗後等 400ms", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("timeout"));
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;

    // 攔截 setTimeout 記錄延遲時間（跳過 0ms 的非退避呼叫）
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: TimerHandler, delay?: number, ...args: any[]) => {
      if (typeof delay === "number" && delay > 0) delays.push(delay);
      return origSetTimeout(fn as any, delay, ...args);
    });

    const promise = fetchBytesWithRetry("uploads/1/f.jpg", fetchFn, 3);
    await vi.runAllTimersAsync();
    await promise;

    expect(delays).toEqual([200, 400]);
  });
});
