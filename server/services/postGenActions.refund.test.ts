/**
 * postGenActions.refund.test.ts — AIDV-577 refundJobIfBilled 並發安全測試
 *
 * 驗收條件：
 * - 兩條失敗路徑同時打同一 job → refundUserPoints 只呼叫一次
 * - refunded=true 旗標由 atomicClaimJobRefund 設定（不論哪條路徑搶到）
 * - points <= 0 → 直接 return false，不觸碰 DB
 * - job 不存在 → return false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockGetBackgroundJob = vi.fn(async () => undefined as ReturnType<typeof mockGetBackgroundJob> extends Promise<infer T> ? T : never);
const mockAtomicClaimJobRefund = vi.fn(async (_id: number, _points: number): Promise<boolean> => false);
const mockRefundUserPoints = vi.fn(async (_userId: number, _points: number): Promise<void> => {});

vi.mock("../db", () => ({
  getBackgroundJob: (...args: unknown[]) => mockGetBackgroundJob(...(args as [number])),
  atomicClaimJobRefund: (...args: unknown[]) => mockAtomicClaimJobRefund(...(args as [number, number])),
  refundUserPoints: (...args: unknown[]) => mockRefundUserPoints(...(args as [number, number])),
  mergeBackgroundJobResultJson: vi.fn(async () => {}),
}));

import { refundJobIfBilled } from "./postGenActions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(id: number, costPoints: number | null = 100) {
  return {
    id,
    userId: 42,
    jobType: "video" as const,
    status: "failed" as const,
    resultJson: costPoints !== null ? { costPoints } : {},
    progressMessage: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  mockGetBackgroundJob.mockReset();
  mockAtomicClaimJobRefund.mockReset();
  mockRefundUserPoints.mockReset();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("refundJobIfBilled — AIDV-577", () => {
  it("job 不存在 → return false，不呼叫任何 DB 寫入", async () => {
    mockGetBackgroundJob.mockResolvedValue(undefined as any);

    const result = await refundJobIfBilled(99);

    expect(result).toBe(false);
    expect(mockAtomicClaimJobRefund).not.toHaveBeenCalled();
    expect(mockRefundUserPoints).not.toHaveBeenCalled();
  });

  it("costPoints 未設定 → return false，不觸碰 CAS", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(1, null) as any);

    const result = await refundJobIfBilled(1);

    expect(result).toBe(false);
    expect(mockAtomicClaimJobRefund).not.toHaveBeenCalled();
  });

  it("costPoints = 0 → return false", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(2, 0) as any);

    const result = await refundJobIfBilled(2);

    expect(result).toBe(false);
    expect(mockAtomicClaimJobRefund).not.toHaveBeenCalled();
  });

  it("已被其他呼叫搶到鎖（atomicClaim 回 false）→ return false，不退款", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(3, 50) as any);
    mockAtomicClaimJobRefund.mockResolvedValue(false);

    const result = await refundJobIfBilled(3);

    expect(result).toBe(false);
    expect(mockRefundUserPoints).not.toHaveBeenCalled();
  });

  it("正常退款路徑：atomicClaim=true → refundUserPoints 被呼叫，回傳 true", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(4, 100) as any);
    mockAtomicClaimJobRefund.mockResolvedValue(true);
    mockRefundUserPoints.mockResolvedValue(undefined);

    const result = await refundJobIfBilled(4);

    expect(result).toBe(true);
    expect(mockAtomicClaimJobRefund).toHaveBeenCalledWith(4, 100);
    expect(mockRefundUserPoints).toHaveBeenCalledWith(42, 100);
  });

  it("並發：兩條失敗路徑同時打同一 job，refundUserPoints 只呼叫一次", async () => {
    // 模擬 DB 讀取競速：兩條路徑都讀到 costPoints=80
    mockGetBackgroundJob.mockResolvedValue(makeJob(5, 80) as any);

    // CAS：第一條搶到（true），第二條搶不到（false）
    let claimCallCount = 0;
    mockAtomicClaimJobRefund.mockImplementation(async () => {
      claimCallCount++;
      return claimCallCount === 1; // 只有第一次呼叫回 true
    });
    mockRefundUserPoints.mockResolvedValue(undefined);

    // 同時觸發兩條路徑
    const [r1, r2] = await Promise.all([
      refundJobIfBilled(5),
      refundJobIfBilled(5),
    ]);

    // 一條成功、一條失敗
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect([r1, r2].filter(v => !v)).toHaveLength(1);

    // 退款只執行一次
    expect(mockRefundUserPoints).toHaveBeenCalledTimes(1);
    expect(mockRefundUserPoints).toHaveBeenCalledWith(42, 80);
  });

  it("並發：三條路徑同時打同一 job，refundUserPoints 仍只呼叫一次", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(6, 200) as any);

    let claimCallCount = 0;
    mockAtomicClaimJobRefund.mockImplementation(async () => {
      claimCallCount++;
      return claimCallCount === 1;
    });
    mockRefundUserPoints.mockResolvedValue(undefined);

    const results = await Promise.all([
      refundJobIfBilled(6),
      refundJobIfBilled(6),
      refundJobIfBilled(6),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mockRefundUserPoints).toHaveBeenCalledTimes(1);
  });

  it("refundUserPoints 拋例外 → return false，但旗標已設（供審計）", async () => {
    mockGetBackgroundJob.mockResolvedValue(makeJob(7, 60) as any);
    mockAtomicClaimJobRefund.mockResolvedValue(true);
    mockRefundUserPoints.mockRejectedValue(new Error("DB connection lost"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await refundJobIfBilled(7);

    expect(result).toBe(false);
    expect(mockRefundUserPoints).toHaveBeenCalledTimes(1);
    // atomicClaim 已設旗標（審計日誌記錄）
    expect(mockAtomicClaimJobRefund).toHaveBeenCalledWith(7, 60);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[refundJobIfBilled]"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });
});
