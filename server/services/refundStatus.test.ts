// @vitest-environment node
/**
 * refundStatus.test.ts — AIDV-650 退款狀態推導（純函式矩陣 + 批次服務行為）
 *
 * 驗收條件：
 * - deriveJobRefundStatus 覆蓋 none / not_refunded / partial / full 全矩陣，
 *   含防禦邊角（超退 clamp、旗標在但金額缺、非法型別、字串旗標）。
 * - getJobRefundStatuses：去重、截斷 100、空陣列不打 DB、DB 錯誤整批 unknown
 *   永不 throw、查不到的 id 回 unknown、userId 原樣傳入 SQL 層（隔離邊界）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockGetBackgroundJobsRefundMeta = vi.fn(
  async (
    _userId: number,
    _ids: number[]
  ): Promise<Array<{ id: number; resultJson: unknown }>> => []
);

vi.mock("../db", () => ({
  getBackgroundJobsRefundMeta: (...args: unknown[]) =>
    mockGetBackgroundJobsRefundMeta(...(args as [number, number[]])),
}));

import {
  deriveJobRefundStatus,
  getJobRefundStatuses,
  MAX_REFUND_STATUS_IDS,
} from "./refundStatus";

// ─── 純函式矩陣：deriveJobRefundStatus ───────────────────────────────────────

describe("deriveJobRefundStatus（純函式矩陣）", () => {
  it("resultJson 為 null → none（無扣點紀錄）", () => {
    expect(deriveJobRefundStatus(1, null)).toEqual({
      taskId: 1,
      chargedPoints: 0,
      refundedPoints: 0,
      refundStatus: "none",
    });
  });

  it("resultJson 為陣列/字串等非物件 → none（防禦）", () => {
    expect(deriveJobRefundStatus(1, [1, 2]).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(1, "oops").refundStatus).toBe("none");
    expect(deriveJobRefundStatus(1, undefined).refundStatus).toBe("none");
  });

  it("submitStudioJob 登錄型 resultJson（無 costPoints）→ none", () => {
    const meta = {
      requestId: "req-1",
      modelId: "fal-ai/flux",
      studioType: "image",
      label: "測試",
      prompt: "",
    };
    expect(deriveJobRefundStatus(2, meta).refundStatus).toBe("none");
  });

  it("costPoints > 0 且無 refunded 旗標 → not_refunded", () => {
    expect(deriveJobRefundStatus(3, { costPoints: 30 })).toEqual({
      taskId: 3,
      chargedPoints: 30,
      refundedPoints: 0,
      refundStatus: "not_refunded",
    });
  });

  it("已退款且金額相等 → full", () => {
    expect(
      deriveJobRefundStatus(4, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 30,
      })
    ).toEqual({
      taskId: 4,
      chargedPoints: 30,
      refundedPoints: 30,
      refundStatus: "full",
    });
  });

  it("refunded 為字串 'true'（JSON 序列化邊角）→ 視為已退款", () => {
    expect(
      deriveJobRefundStatus(5, {
        costPoints: 30,
        refunded: "true",
        refundedPoints: 30,
      }).refundStatus
    ).toBe("full");
  });

  it("部分退款（0 < refundedPoints < costPoints）→ partial", () => {
    expect(
      deriveJobRefundStatus(6, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 10,
      })
    ).toEqual({
      taskId: 6,
      chargedPoints: 30,
      refundedPoints: 10,
      refundStatus: "partial",
    });
  });

  it("超退（refundedPoints > costPoints）→ clamp 為 full、退點封頂於扣點", () => {
    expect(
      deriveJobRefundStatus(7, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 50,
      })
    ).toEqual({
      taskId: 7,
      chargedPoints: 30,
      refundedPoints: 30,
      refundStatus: "full",
    });
  });

  it("refunded 旗標在但 refundedPoints 缺失（防禦）→ 視為全額退款", () => {
    expect(
      deriveJobRefundStatus(8, { costPoints: 30, refunded: true })
    ).toEqual({
      taskId: 8,
      chargedPoints: 30,
      refundedPoints: 30,
      refundStatus: "full",
    });
  });

  it("costPoints 缺但 refunded + refundedPoints 俱在（防禦）→ full", () => {
    expect(
      deriveJobRefundStatus(9, { refunded: true, refundedPoints: 20 })
    ).toEqual({
      taskId: 9,
      chargedPoints: 20,
      refundedPoints: 20,
      refundStatus: "full",
    });
  });

  it("costPoints 非法值（負數 / 0 / NaN / 非數字字串）→ none", () => {
    expect(deriveJobRefundStatus(10, { costPoints: -5 }).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(10, { costPoints: 0 }).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(10, { costPoints: NaN }).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(10, { costPoints: Infinity }).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(10, { costPoints: "abc" }).refundStatus).toBe("none");
    expect(deriveJobRefundStatus(10, { costPoints: {} }).refundStatus).toBe("none");
  });

  it("costPoints 為純數字字串（JSON round-trip 邊角）→ 正常推導", () => {
    expect(deriveJobRefundStatus(11, { costPoints: "30" })).toEqual({
      taskId: 11,
      chargedPoints: 30,
      refundedPoints: 0,
      refundStatus: "not_refunded",
    });
  });

  it("refunded 為 false / 其他 truthy 非 true 值 → 不視為已退款", () => {
    expect(
      deriveJobRefundStatus(12, { costPoints: 30, refunded: false }).refundStatus
    ).toBe("not_refunded");
    expect(
      deriveJobRefundStatus(12, { costPoints: 30, refunded: 1 }).refundStatus
    ).toBe("not_refunded");
    expect(
      deriveJobRefundStatus(12, { costPoints: 30, refunded: "yes" }).refundStatus
    ).toBe("not_refunded");
  });

  it("refundedPoints 非法值（負數）在旗標在時退回防禦全額", () => {
    expect(
      deriveJobRefundStatus(13, {
        costPoints: 30,
        refunded: true,
        refundedPoints: -10,
      })
    ).toEqual({
      taskId: 13,
      chargedPoints: 30,
      refundedPoints: 30,
      refundStatus: "full",
    });
  });

  it("小數點數四捨五入收斂（防浮點漂移）", () => {
    const r = deriveJobRefundStatus(14, {
      costPoints: 29.6,
      refunded: true,
      refundedPoints: 29.6,
    });
    expect(r.chargedPoints).toBe(30);
    expect(r.refundedPoints).toBe(30);
    expect(r.refundStatus).toBe("full");
  });
});

// ─── 批次服務：getJobRefundStatuses ──────────────────────────────────────────

describe("getJobRefundStatuses（批次查詢行為）", () => {
  beforeEach(() => {
    mockGetBackgroundJobsRefundMeta.mockReset();
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([]);
  });

  it("ids 空陣列 → 直接回空結果、不打 DB", async () => {
    const res = await getJobRefundStatuses(7, []);
    expect(res).toEqual([]);
    expect(mockGetBackgroundJobsRefundMeta).not.toHaveBeenCalled();
  });

  it("userId 原樣傳入 SQL 隔離層（本人邊界）", async () => {
    await getJobRefundStatuses(42, [1, 2]);
    expect(mockGetBackgroundJobsRefundMeta).toHaveBeenCalledTimes(1);
    expect(mockGetBackgroundJobsRefundMeta).toHaveBeenCalledWith(42, [1, 2]);
  });

  it("重複 id 去重後查詢，輸出每 id 一鍵", async () => {
    const res = await getJobRefundStatuses(7, [5, 5, 6, 5]);
    expect(mockGetBackgroundJobsRefundMeta).toHaveBeenCalledWith(7, [5, 6]);
    expect(res.map(e => e.taskId)).toEqual([5, 6]);
  });

  it("超過 100 筆 → 截斷至 100（不拒絕）", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => i + 1);
    const res = await getJobRefundStatuses(7, ids);
    const passed = mockGetBackgroundJobsRefundMeta.mock.calls[0][1];
    expect(passed).toHaveLength(MAX_REFUND_STATUS_IDS);
    expect(res).toHaveLength(MAX_REFUND_STATUS_IDS);
  });

  it("查不到的 id（不存在或非本人，SQL 端已過濾）→ unknown、回應形狀一致", async () => {
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([
      { id: 1, resultJson: { costPoints: 30, refunded: true, refundedPoints: 30 } },
    ]);
    const res = await getJobRefundStatuses(7, [1, 999]);
    expect(res).toEqual([
      { taskId: 1, chargedPoints: 30, refundedPoints: 30, refundStatus: "full" },
      { taskId: 999, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("DB 回傳多餘列（未請求的 id）被防禦性忽略", async () => {
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([
      { id: 888, resultJson: { costPoints: 30 } },
    ]);
    const res = await getJobRefundStatuses(7, [1]);
    expect(res).toEqual([
      { taskId: 1, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("DB 錯誤 → 整批 unknown、永不 throw（HARD SAFETY fallback）", async () => {
    mockGetBackgroundJobsRefundMeta.mockRejectedValue(new Error("boom"));
    const res = await getJobRefundStatuses(7, [1, 2]);
    expect(res).toEqual([
      { taskId: 1, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
      { taskId: 2, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("demo 無 DB（helper 回空陣列）→ 整批 unknown 不 throw", async () => {
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([]);
    const res = await getJobRefundStatuses(7, [3]);
    expect(res).toEqual([
      { taskId: 3, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" },
    ]);
  });

  it("混合狀態批次：none / not_refunded / partial / full 一次推導正確", async () => {
    mockGetBackgroundJobsRefundMeta.mockResolvedValue([
      { id: 1, resultJson: { requestId: "r", modelId: "m" } },
      { id: 2, resultJson: { costPoints: 20 } },
      { id: 3, resultJson: { costPoints: 20, refunded: true, refundedPoints: 5 } },
      { id: 4, resultJson: { costPoints: 20, refunded: true, refundedPoints: 20 } },
    ]);
    const res = await getJobRefundStatuses(7, [1, 2, 3, 4]);
    expect(res.map(e => e.refundStatus)).toEqual([
      "none",
      "not_refunded",
      "partial",
      "full",
    ]);
  });
});
