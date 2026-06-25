/**
 * trpc-rate-limit.test.ts — AIDV-211
 * Unit tests for the in-memory sliding-window per-user tRPC rate limiter.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkTrpcRateLimit, _resetWindowsForTest } from "./_core/trpcRateLimit";
import { TRPCError } from "@trpc/server";

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  // checkTrpcRateLimit skips in test mode — temporarily override so we can exercise the real logic
  process.env.NODE_ENV = "development";
  _resetWindowsForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  vi.useRealTimers();
});

describe("checkTrpcRateLimit — AIDV-211", () => {
  it("首次請求：不拋錯", () => {
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
    ).not.toThrow();
  });

  it("未超限的多次請求：全部通過", () => {
    for (let i = 0; i < 3; i++) {
      expect(() =>
        checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
      ).not.toThrow();
    }
  });

  it("超過 limit → 拋 TOO_MANY_REQUESTS", () => {
    for (let i = 0; i < 3; i++) {
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" });
    }
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
    ).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS" } as Partial<TRPCError>)
    );
  });

  it("窗口過期後計數重置，不再拋錯", () => {
    for (let i = 0; i < 3; i++) {
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" });
    }
    // 超限
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
    ).toThrow();

    // 推進時間超過窗口
    vi.advanceTimersByTime(61_000);

    // 重置後首次請求通過
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
    ).not.toThrow();
  });

  it("不同使用者的計數互相獨立", () => {
    for (let i = 0; i < 3; i++) {
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" });
    }
    // user 1 超限
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "test" })
    ).toThrow();

    // user 2 未超限
    expect(() =>
      checkTrpcRateLimit(2, { limit: 3, windowMs: 60_000, label: "test" })
    ).not.toThrow();
  });

  it("不同 label 的計數互相獨立", () => {
    for (let i = 0; i < 3; i++) {
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "aichat" });
    }
    // aichat 超限
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "aichat" })
    ).toThrow();

    // gen bucket 獨立，不受影響
    expect(() =>
      checkTrpcRateLimit(1, { limit: 3, windowMs: 60_000, label: "gen" })
    ).not.toThrow();
  });

  it("在 test 環境中永遠跳過（NODE_ENV=test）", () => {
    // 還原為 test 模式，驗證 skip 邏輯
    process.env.NODE_ENV = "test";
    for (let i = 0; i < 1000; i++) {
      expect(() =>
        checkTrpcRateLimit(1, { limit: 1, windowMs: 60_000, label: "skip" })
      ).not.toThrow();
    }
    process.env.NODE_ENV = "development"; // 恢復 beforeEach 設定，讓 afterEach 正確還原
  });
});
