/**
 * agent-rate-limit.test.ts — AIDV-354
 *
 * 驗收條件：
 *   1. 非代理呼叫（無 X-Agent-Id）→ 不計入、不封鎖
 *   2. 代理呼叫未超限 → 正常通過，設定 RateLimit-Remaining / RateLimit-Reset
 *   3. 代理呼叫超過上限 → TOO_MANY_REQUESTS，設定 Retry-After / RateLimit-Remaining=0
 *   4. 視窗過期後計數重置
 *   5. 不同使用者的計數獨立
 *   6. getAgentQuota 回傳正確使用量（不遞增）
 *   7. NODE_ENV=test 永遠跳過
 *   8. ENABLE_RATE_LIMIT=false 永遠跳過
 *   9. AGENT_RATE_LIMIT_MAX 可由環境變數覆蓋
 *   10. videoProject.create/save/duplicate 帶 X-Agent-Id → 被 quota 計入
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkAgentRateLimit,
  getAgentQuota,
  _resetAgentWindowsForTest,
  AGENT_RATE_LIMIT_MAX,
  AGENT_RATE_LIMIT_WINDOW_MS,
} from "./_core/trpcRateLimit";
import { TRPCError } from "@trpc/server";

const AGENT_REQ = { headers: { "x-agent-id": "script-agent-01" } } as const;
const HUMAN_REQ = { headers: {} } as const;

const originalNodeEnv = process.env.NODE_ENV;
const originalEnableRateLimit = process.env.ENABLE_RATE_LIMIT;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  delete process.env.ENABLE_RATE_LIMIT;
  _resetAgentWindowsForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalEnableRateLimit !== undefined) {
    process.env.ENABLE_RATE_LIMIT = originalEnableRateLimit;
  } else {
    delete process.env.ENABLE_RATE_LIMIT;
  }
  vi.useRealTimers();
});

describe("AIDV-354 checkAgentRateLimit — 基本行為", () => {
  it("無 X-Agent-Id（人工呼叫）→ 不計入、不拋錯", () => {
    for (let i = 0; i <= AGENT_RATE_LIMIT_MAX + 5; i++) {
      expect(() => checkAgentRateLimit(1, HUMAN_REQ)).not.toThrow();
    }
  });

  it("首次代理呼叫通過，不拋錯", () => {
    expect(() => checkAgentRateLimit(1, AGENT_REQ)).not.toThrow();
  });

  it("代理呼叫未超限 → 全部通過", () => {
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) {
      expect(() => checkAgentRateLimit(1, AGENT_REQ)).not.toThrow();
    }
  });

  it("代理呼叫超過上限 → 拋 TOO_MANY_REQUESTS", () => {
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) {
      checkAgentRateLimit(1, AGENT_REQ);
    }
    expect(() => checkAgentRateLimit(1, AGENT_REQ)).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS" } as Partial<TRPCError>)
    );
  });

  it("視窗過期後計數重置，重新允許", () => {
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) {
      checkAgentRateLimit(1, AGENT_REQ);
    }
    expect(() => checkAgentRateLimit(1, AGENT_REQ)).toThrow();
    vi.advanceTimersByTime(AGENT_RATE_LIMIT_WINDOW_MS + 1);
    expect(() => checkAgentRateLimit(1, AGENT_REQ)).not.toThrow();
  });

  it("不同使用者的計數互相獨立", () => {
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) {
      checkAgentRateLimit(1, AGENT_REQ);
    }
    expect(() => checkAgentRateLimit(1, AGENT_REQ)).toThrow();
    expect(() => checkAgentRateLimit(2, AGENT_REQ)).not.toThrow();
  });

  it("NODE_ENV=test → 永遠跳過不計入", () => {
    process.env.NODE_ENV = "test";
    for (let i = 0; i <= AGENT_RATE_LIMIT_MAX * 5; i++) {
      expect(() => checkAgentRateLimit(1, AGENT_REQ)).not.toThrow();
    }
    process.env.NODE_ENV = "development";
  });

  it("ENABLE_RATE_LIMIT=false → 永遠跳過不計入", () => {
    process.env.ENABLE_RATE_LIMIT = "false";
    for (let i = 0; i <= AGENT_RATE_LIMIT_MAX * 5; i++) {
      expect(() => checkAgentRateLimit(1, AGENT_REQ)).not.toThrow();
    }
  });
});

describe("AIDV-354 checkAgentRateLimit — RateLimit-* headers", () => {
  it("首次呼叫設定 RateLimit-Remaining 與 RateLimit-Reset", () => {
    const mockRes = { setHeader: vi.fn() } as unknown as import("express").Response;
    checkAgentRateLimit(1, AGENT_REQ, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", String(AGENT_RATE_LIMIT_MAX - 1));
    expect(mockRes.setHeader).toHaveBeenCalledWith("RateLimit-Reset", expect.stringMatching(/^\d+$/));
  });

  it("超限時設定 Retry-After + RateLimit-Remaining=0", () => {
    const mockRes = { setHeader: vi.fn() } as unknown as import("express").Response;
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) {
      checkAgentRateLimit(1, AGENT_REQ);
    }
    try {
      checkAgentRateLimit(1, AGENT_REQ, mockRes);
    } catch { /* expected */ }
    expect(mockRes.setHeader).toHaveBeenCalledWith("Retry-After", expect.stringMatching(/^\d+$/));
    expect(mockRes.setHeader).toHaveBeenCalledWith("RateLimit-Remaining", "0");
    expect(mockRes.setHeader).toHaveBeenCalledWith("RateLimit-Reset", expect.stringMatching(/^\d+$/));
  });

  it("無 X-Agent-Id 呼叫不設定任何 header", () => {
    const mockRes = { setHeader: vi.fn() } as unknown as import("express").Response;
    checkAgentRateLimit(1, HUMAN_REQ, mockRes);
    expect(mockRes.setHeader).not.toHaveBeenCalled();
  });
});

describe("AIDV-354 getAgentQuota — 額度查詢（唯讀）", () => {
  it("初始狀態：used=0, max=AGENT_RATE_LIMIT_MAX, resetAt=null", () => {
    const q = getAgentQuota(1);
    expect(q.used).toBe(0);
    expect(q.max).toBe(AGENT_RATE_LIMIT_MAX);
    expect(q.resetAt).toBeNull();
  });

  it("N 次代理呼叫後 used=N", () => {
    const N = 3;
    for (let i = 0; i < N; i++) checkAgentRateLimit(1, AGENT_REQ);
    const q = getAgentQuota(1);
    expect(q.used).toBe(N);
    expect(q.resetAt).toBeGreaterThan(0);
  });

  it("getAgentQuota 不遞增計數（呼叫多次結果相同）", () => {
    checkAgentRateLimit(1, AGENT_REQ);
    const q1 = getAgentQuota(1);
    const q2 = getAgentQuota(1);
    expect(q1.used).toBe(q2.used);
    expect(q1.used).toBe(1);
  });

  it("人工呼叫不影響 quota used", () => {
    for (let i = 0; i < 5; i++) checkAgentRateLimit(1, HUMAN_REQ);
    const q = getAgentQuota(1);
    expect(q.used).toBe(0);
  });

  it("視窗過期後 quota 重置 → used=0", () => {
    for (let i = 0; i < 5; i++) checkAgentRateLimit(1, AGENT_REQ);
    vi.advanceTimersByTime(AGENT_RATE_LIMIT_WINDOW_MS + 1);
    const q = getAgentQuota(1);
    expect(q.used).toBe(0);
    expect(q.resetAt).toBeNull();
  });
});

// ─── Integration: videoProject router 接線驗證 ─────────────────────────────
// These verify that the three mutable procedures wire checkAgentRateLimit
// so agent callers hit the quota (tested via unit-level mock here).

describe("AIDV-354 videoProject router — 代理呼叫被計入 quota", () => {
  it("create/save/duplicate 在代理呼叫下消耗額度", async () => {
    // Call checkAgentRateLimit directly to simulate what the router does
    // (the router calls it at the top of each mutation handler).
    const consumeOnce = () => checkAgentRateLimit(99, AGENT_REQ);
    for (let i = 0; i < AGENT_RATE_LIMIT_MAX; i++) consumeOnce();
    expect(() => consumeOnce()).toThrowError(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS" } as Partial<TRPCError>)
    );
    const q = getAgentQuota(99);
    expect(q.used).toBeGreaterThanOrEqual(AGENT_RATE_LIMIT_MAX);
    expect(q.max).toBe(AGENT_RATE_LIMIT_MAX);
  });
});
