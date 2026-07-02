// @vitest-environment node
/**
 * AIDV-650: credits.jobRefundStatus 授權 / 隔離 / 上限 / 錯誤 fallback 測試。
 *
 * 透過真實 createCaller 跑實際 procedure（protectedProcedure 真接線）：
 * - 未登入 → UNAUTHORIZED
 * - ctx.user.id 傳入 SQL 隔離層；非本人/不存在的 id 回 unknown 且形狀不可區分
 * - 超過 100 筆截斷、重複去重、空陣列不打 DB
 * - 非法 id 被 zod 拒絕（BAD_REQUEST）
 * - DB 錯誤整批 unknown、永不 throw 到 UI
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetBackgroundJobsRefundMeta = vi.hoisted(() =>
  vi.fn(
    async (
      _userId: number,
      _ids: number[]
    ): Promise<Array<{ id: number; resultJson: unknown }>> => []
  )
);

vi.mock("../../db", () => ({
  getBackgroundJobsRefundMeta: (...args: unknown[]) =>
    mockGetBackgroundJobsRefundMeta(...(args as [number, number[]])),
  // creditsRouter 其他 procedure 用到的 db 具名匯出（本測試不觸發，但需存在）
  getUserTopModelRecent: vi.fn(async () => null),
  getUserCostSummary: vi.fn(async () => ({ totalCost: 0 })),
}));

import { creditsRouter } from "../credits";

const callerFor = (userId: number) =>
  creditsRouter.createCaller({ user: { id: userId } } as never);

describe("credits.jobRefundStatus（AIDV-650）", () => {
  beforeEach(() => {
    mockGetBackgroundJobsRefundMeta.mockReset();
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([]);
  });

  it("未登入（無 ctx.user）→ UNAUTHORIZED", async () => {
    const anonCaller = creditsRouter.createCaller({ user: null } as never);
    await expect(
      anonCaller.jobRefundStatus({ jobIds: [1] })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockGetBackgroundJobsRefundMeta).not.toHaveBeenCalled();
  });

  it("以 ctx.user.id 為 SQL 隔離邊界（userId 原樣傳入單一批次查詢）", async () => {
    await callerFor(42).jobRefundStatus({ jobIds: [10, 11] });
    expect(mockGetBackgroundJobsRefundMeta).toHaveBeenCalledTimes(1);
    expect(mockGetBackgroundJobsRefundMeta).toHaveBeenCalledWith(42, [10, 11]);
  });

  it("非本人/不存在的 id（SQL 端過濾後查無列）→ unknown，與本人任務混批不洩漏", async () => {
    // SQL 層只回本人的 job 10；他人的 job 999 不在結果內
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([
      { id: 10, resultJson: { costPoints: 30, refunded: true, refundedPoints: 30 } },
    ]);
    const res = await callerFor(42).jobRefundStatus({ jobIds: [10, 999] });
    expect(res).toEqual([
      { taskId: 10, chargedPoints: 30, refundedPoints: 30, refundStatus: "full" },
      { taskId: 999, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("空陣列 → 回空結果、不打 DB", async () => {
    const res = await callerFor(42).jobRefundStatus({ jobIds: [] });
    expect(res).toEqual([]);
    expect(mockGetBackgroundJobsRefundMeta).not.toHaveBeenCalled();
  });

  it("超過 100 筆 → 截斷至 100；重複 id 去重", async () => {
    const ids = Array.from({ length: 130 }, (_, i) => i + 1).concat([1, 2, 3]);
    const res = await callerFor(42).jobRefundStatus({ jobIds: ids });
    const passed = mockGetBackgroundJobsRefundMeta.mock.calls[0][1];
    expect(passed).toHaveLength(100);
    expect(new Set(passed).size).toBe(100);
    expect(res).toHaveLength(100);
  });

  it("非法 id（0 / 負數 / 非整數）→ zod BAD_REQUEST", async () => {
    await expect(
      callerFor(42).jobRefundStatus({ jobIds: [0] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(42).jobRefundStatus({ jobIds: [-1] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerFor(42).jobRefundStatus({ jobIds: [1.5] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockGetBackgroundJobsRefundMeta).not.toHaveBeenCalled();
  });

  it("DB 錯誤 → 整批 unknown、不 throw 到 UI（graceful fallback）", async () => {
    mockGetBackgroundJobsRefundMeta.mockRejectedValue(new Error("db down"));
    const res = await callerFor(42).jobRefundStatus({ jobIds: [1, 2] });
    expect(res).toEqual([
      { taskId: 1, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
      { taskId: 2, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("無扣點紀錄的任務（submitStudioJob 登錄型）→ none（前端不顯示徽章）", async () => {
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([
      { id: 5, resultJson: { requestId: "r", modelId: "m", studioType: "image" } },
    ]);
    const res = await callerFor(42).jobRefundStatus({ jobIds: [5] });
    expect(res).toEqual([
      { taskId: 5, chargedPoints: 0, refundedPoints: 0, refundStatus: "none" },
    ]);
  });
});
