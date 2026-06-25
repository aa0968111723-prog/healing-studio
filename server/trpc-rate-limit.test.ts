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

describe("checkTrpcRateLimit — AIDV-242 videoStudio 多視窗保護", () => {
  it("videoStudio:hr 與 videoStudio:day 是獨立桶", () => {
    // Fill up hourly bucket but not daily
    for (let i = 0; i < 50; i++) {
      checkTrpcRateLimit(1, { limit: 50, windowMs: 60 * 60_000, label: "videoStudio:hr" });
    }
    expect(() =>
      checkTrpcRateLimit(1, { limit: 50, windowMs: 60 * 60_000, label: "videoStudio:hr" })
    ).toThrowError(expect.objectContaining({ code: "TOO_MANY_REQUESTS" } as Partial<TRPCError>));

    // Daily bucket is separate — should still allow requests
    expect(() =>
      checkTrpcRateLimit(1, { limit: 200, windowMs: 24 * 60 * 60_000, label: "videoStudio:day" })
    ).not.toThrow();
  });

  it("模擬 requireVideoStudioLimit 串聯：兩個視窗都必須通過才允許請求", () => {
    const simulateVideoGenRequest = (userId: number) => {
      // Same order as requireVideoStudioLimit middleware
      checkTrpcRateLimit(userId, { limit: 50, windowMs: 60 * 60_000, label: "videoStudio:hr" });
      checkTrpcRateLimit(userId, { limit: 200, windowMs: 24 * 60 * 60_000, label: "videoStudio:day" });
    };

    // First 50 requests should pass
    for (let i = 0; i < 50; i++) {
      expect(() => simulateVideoGenRequest(1)).not.toThrow();
    }

    // 51st request hits hourly cap first
    expect(() => simulateVideoGenRequest(1)).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS" } as Partial<TRPCError>)
    );

    // After 1 hour, hourly resets — but daily cap still applies
    vi.advanceTimersByTime(60 * 60_000 + 1);
    expect(() => simulateVideoGenRequest(1)).not.toThrow();
  });

  it("videoStudio 速率限制與 gen 桶互相獨立（不互相消耗）", () => {
    // Exhaust the gen (per-minute) bucket
    for (let i = 0; i < 5; i++) {
      checkTrpcRateLimit(1, { limit: 5, windowMs: 60_000, label: "gen" });
    }
    expect(() =>
      checkTrpcRateLimit(1, { limit: 5, windowMs: 60_000, label: "gen" })
    ).toThrow();

    // videoStudio:hr bucket is unaffected
    expect(() =>
      checkTrpcRateLimit(1, { limit: 50, windowMs: 60 * 60_000, label: "videoStudio:hr" })
    ).not.toThrow();
  });
});
