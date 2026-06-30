/**
 * falRecoveryPolicy.test.ts — ADP-2 三層失敗恢復策略單元測試
 *
 * 覆蓋三條路徑：
 *   1. transient — 退避重試，成功後不標 degraded。
 *   2. content   — 修改 prompt 重試，成功後不標 degraded。
 *   3. hard      — 換降級 model 重試，成功後標 degraded=true。
 * 以及邊界條件：超出重試上限、無降級 model 可用。
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyFalError,
  shouldRetry,
  getBackoffMs,
  buildRetryPrompt,
  getHardFallbackModel,
  runFalWithRecovery,
  DEFAULT_FAL_RECOVERY_POLICY,
  type FalResultLike,
} from "./falRecoveryPolicy";

// ─── classifyFalError ────────────────────────────────────────────────────────

describe("classifyFalError", () => {
  it("429 → transient", () => {
    expect(classifyFalError("fal status HTTP 429")).toBe("transient");
  });
  it("503 → transient", () => {
    expect(classifyFalError("fal status HTTP 503")).toBe("transient");
  });
  it("timeout → transient", () => {
    expect(classifyFalError("await timed out after 120000ms")).toBe("transient");
  });
  it("ECONNRESET → transient", () => {
    expect(classifyFalError("ECONNRESET: socket hang up")).toBe("transient");
  });
  it("unknown error → transient（安全側預設）", () => {
    expect(classifyFalError("something unexpected happened")).toBe("transient");
  });
  it("content policy → content", () => {
    expect(classifyFalError("content policy violation detected")).toBe("content");
  });
  it("nsfw → content", () => {
    expect(classifyFalError("Output contains NSFW material")).toBe("content");
  });
  it("no-url-extracted → content", () => {
    expect(classifyFalError("no-url-extracted")).toBe("content");
  });
  it("model not found → hard", () => {
    expect(classifyFalError("model fal-ai/xxx not found")).toBe("hard");
  });
  it("deprecated → hard", () => {
    expect(classifyFalError("This model is deprecated")).toBe("hard");
  });
  it("HTTP 403 → hard", () => {
    expect(classifyFalError("fal status HTTP 403")).toBe("hard");
  });
});

// ─── shouldRetry ─────────────────────────────────────────────────────────────

describe("shouldRetry", () => {
  const p = DEFAULT_FAL_RECOVERY_POLICY;
  it("transient attempt 1 → true", () => expect(shouldRetry("transient", 1, p)).toBe(true));
  it("transient attempt 3 → true (= maxTransientRetries)", () => expect(shouldRetry("transient", 3, p)).toBe(true));
  it("transient attempt 4 → false (exceeded)", () => expect(shouldRetry("transient", 4, p)).toBe(false));
  it("content attempt 1 → true", () => expect(shouldRetry("content", 1, p)).toBe(true));
  it("content attempt 2 → true (= maxContentRetries)", () => expect(shouldRetry("content", 2, p)).toBe(true));
  it("content attempt 3 → false", () => expect(shouldRetry("content", 3, p)).toBe(false));
  it("hard attempt 1 → true (= maxHardRetries)", () => expect(shouldRetry("hard", 1, p)).toBe(true));
  it("hard attempt 2 → false", () => expect(shouldRetry("hard", 2, p)).toBe(false));
});

// ─── getBackoffMs ─────────────────────────────────────────────────────────────

describe("getBackoffMs", () => {
  it("attempt 1, base 2000 → 2000", () => expect(getBackoffMs(1, 2000)).toBe(2000));
  it("attempt 2, base 2000 → 4000", () => expect(getBackoffMs(2, 2000)).toBe(4000));
  it("attempt 3, base 2000 → 8000", () => expect(getBackoffMs(3, 2000)).toBe(8000));
  it("clamps at 30s", () => expect(getBackoffMs(20, 2000)).toBe(30_000));
});

// ─── buildRetryPrompt ─────────────────────────────────────────────────────────

describe("buildRetryPrompt", () => {
  it("appends retry marker", () => {
    const result = buildRetryPrompt("A sunset", 1);
    expect(result).toContain("A sunset");
    expect(result).toContain("Retry 1");
  });
  it("includes attempt number", () => {
    const result = buildRetryPrompt("cats", 2);
    expect(result).toContain("Retry 2");
  });
});

// ─── getHardFallbackModel ─────────────────────────────────────────────────────

describe("getHardFallbackModel", () => {
  it("flux-pro/v1.1-ultra → flux-pro", () => {
    expect(getHardFallbackModel("fal-ai/flux-pro/v1.1-ultra")).toBe("fal-ai/flux-pro");
  });
  it("flux/dev → flux/schnell", () => {
    expect(getHardFallbackModel("fal-ai/flux/dev")).toBe("fal-ai/flux/schnell");
  });
  it("unknown model → null", () => {
    expect(getHardFallbackModel("fal-ai/does-not-exist")).toBeNull();
  });
});

// ─── runFalWithRecovery ───────────────────────────────────────────────────────

describe("runFalWithRecovery", () => {
  const noSleep = () => Promise.resolve();

  it("成功時直接回傳（無重試）", async () => {
    const factory = vi.fn<() => Promise<FalResultLike>>().mockResolvedValue({
      status: "completed",
    });
    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "a cat", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  // ── 路徑 1：transient 退避重試 ──

  it("transient: 首次失敗後重試並成功，不標 degraded", async () => {
    const factory = vi.fn<(m: string, p?: string) => Promise<FalResultLike>>()
      .mockResolvedValueOnce({ status: "failed", error: "fal status HTTP 429" })
      .mockResolvedValueOnce({ status: "completed" });

    const slept: number[] = [];
    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "a dog", {
      sleepFn: (ms) => { slept.push(ms); return Promise.resolve(); },
    });
    expect(result.status).toBe("completed");
    expect(result.degraded).toBeFalsy();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(slept).toHaveLength(1); // 一次 sleep
    // 第一次 attempt 退避 = 2000 * 2^0 = 2000
    expect(slept[0]).toBe(DEFAULT_FAL_RECOVERY_POLICY.backoffBaseMs);
  });

  it("transient: 超出重試上限 → 回傳最後失敗結果，不拋錯", async () => {
    const factory = vi.fn<() => Promise<FalResultLike>>()
      .mockResolvedValue({ status: "failed", error: "timeout" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", undefined, {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("failed");
    // maxTransientRetries=3，所以共 1 初始 + 3 重試 = 4 次呼叫
    expect(factory).toHaveBeenCalledTimes(1 + DEFAULT_FAL_RECOVERY_POLICY.maxTransientRetries);
  });

  // ── 路徑 2：content 改 prompt 重試 ──

  it("content: 首次失敗後用修改 prompt 重試並成功", async () => {
    const factory = vi.fn<(m: string, p?: string) => Promise<FalResultLike>>()
      .mockResolvedValueOnce({ status: "failed", error: "content policy violation" })
      .mockResolvedValueOnce({ status: "completed" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "original prompt", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("completed");
    expect(factory).toHaveBeenCalledTimes(2);
    // 第二次呼叫應傳入修改過的 prompt（包含 Retry 標記）
    const secondCallPrompt = factory.mock.calls[1][1];
    expect(secondCallPrompt).toContain("original prompt");
    expect(secondCallPrompt).toContain("Retry 1");
  });

  it("content: 超出重試上限 → 回傳最後失敗", async () => {
    const factory = vi.fn<() => Promise<FalResultLike>>()
      .mockResolvedValue({ status: "failed", error: "nsfw detected" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "a photo", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("failed");
    // maxContentRetries=2，共 1 + 2 = 3 次
    expect(factory).toHaveBeenCalledTimes(1 + DEFAULT_FAL_RECOVERY_POLICY.maxContentRetries);
  });

  // ── 路徑 3：hard 降級 model ──

  it("hard: 首次失敗後換降級 model 重試，成功後標 degraded=true", async () => {
    const factory = vi.fn<(m: string, p?: string) => Promise<FalResultLike>>()
      .mockResolvedValueOnce({ status: "failed", error: "model not found" })
      .mockResolvedValueOnce({ status: "completed" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "test", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("completed");
    expect(result.degraded).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
    // 第二次應換成降級 model
    const fallbackModelId = factory.mock.calls[1][0];
    expect(fallbackModelId).toBe("fal-ai/flux/schnell");
  });

  it("hard: 無降級 model 可用 → 立即回傳 degraded=true", async () => {
    const factory = vi.fn<() => Promise<FalResultLike>>()
      .mockResolvedValue({ status: "failed", error: "model not found" });

    const result = await runFalWithRecovery(factory, "fal-ai/does-not-exist", "test", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("failed");
    expect(result.degraded).toBe(true);
    // 沒有降級選項 → 只呼叫一次後即結束
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("hard: 超出重試上限（maxHardRetries=1）→ 回傳 degraded=true", async () => {
    // fal-ai/flux/dev → fal-ai/flux/schnell（有降級），但兩次都失敗
    const factory = vi.fn<() => Promise<FalResultLike>>()
      .mockResolvedValue({ status: "failed", error: "model not found" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "test", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("failed");
    expect(result.degraded).toBe(true);
    // maxHardRetries=1 → 1 初始 + 1 重試 = 2 次
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("pending 結果不觸發重試", async () => {
    const factory = vi.fn<() => Promise<FalResultLike>>()
      .mockResolvedValue({ status: "pending" });

    const result = await runFalWithRecovery(factory, "fal-ai/flux/dev", "test", {
      sleepFn: noSleep,
    });
    expect(result.status).toBe("pending");
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
