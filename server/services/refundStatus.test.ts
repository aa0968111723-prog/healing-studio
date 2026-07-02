// @vitest-environment node
/**
 * refundStatus.test.ts — AIDV-650 退款狀態推導（純函式矩陣 + 批次服務行為）
 *
 * 驗收條件：
 * - deriveJobRefundStatus 覆蓋 none / not_refunded / partial / full 全矩陣，
 *   含防禦邊角（超退 clamp、旗標在但金額缺、非法型別、字串旗標）。
 * - getJobRefundStatuses：去重、截斷 100、空陣列不打 DB、DB 錯誤整批 unknown
 *   永不 throw、查不到的 id 回 unknown、userId 原樣傳入 SQL 層（隔離邊界）。
 * - 寫入端契約（真實 resultJson 形狀）：queue submit 失敗路徑 claim 後的形狀
 *   → full；refundRestoreFailed（搶到鎖但錢包未入帳）→ 降級 not_refunded；
 *   director 舊任務 chargedPoints-only → none（AIDV-968 之前無旗標，fail-safe
 *   pin 現狀）；director 新任務（AIDV-968：costPoints+chargedPoints 同額並存）
 *   → 未退 not_refunded、退款旗標在 → full。
 * - 原始碼結構不變量（AIDV-771 慣例）：有 jobId 的失敗退款路徑必為
 *   「atomicClaimJobRefund 先、refundUserPoints 後」claim-then-refund 順序，
 *   含 director.ts 的 executeGenerationTask catch 與 pollGenerationTask FAILED
 *   兩站點（AIDV-968），以及 director 扣點時 costPoints/chargedPoints 雙寫。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  // ── 真實寫入形狀回歸（寫入端契約，非理想化 fixture）─────────────────────

  it("queue submit 失敗路徑（generate.submitMultimodalAsync catch，claim-then-refund 後）的 resultJson 形狀 → full", () => {
    // 此路徑無 requestId（送出即失敗），旗標由 catch 內 atomicClaimJobRefund
    // 直接寫入初始 resultJson——不能只靠 webhook/輪詢補旗標。
    const submitFailShape = {
      studioType: "video",
      label: "影片生成",
      modelId: "fal-ai/kling-video",
      prompt: "a cat",
      costPoints: 30,
      refunded: true,
      refundedPoints: 30,
    };
    expect(deriveJobRefundStatus(15, submitFailShape)).toEqual({
      taskId: 15,
      chargedPoints: 30,
      refundedPoints: 30,
      refundStatus: "full",
    });
  });

  it("refundRestoreFailed=true（搶到退款鎖但 refundUserPoints 失敗、錢包未入帳）→ 降級 not_refunded", () => {
    expect(
      deriveJobRefundStatus(16, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 30,
        refundRestoreFailed: true,
      })
    ).toEqual({
      taskId: 16,
      chargedPoints: 30,
      refundedPoints: 0,
      refundStatus: "not_refunded",
    });
    // 字串 "true"（JSON round-trip 邊角）同樣降級
    expect(
      deriveJobRefundStatus(16, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 30,
        refundRestoreFailed: "true",
      }).refundStatus
    ).toBe("not_refunded");
  });

  it("refundRestoreFailed 為 false / 非 true 值 → 不影響正常 full 推導", () => {
    expect(
      deriveJobRefundStatus(17, {
        costPoints: 30,
        refunded: true,
        refundedPoints: 30,
        refundRestoreFailed: false,
      }).refundStatus
    ).toBe("full");
  });

  it("防禦分支（costPoints 缺）遇 refundRestoreFailed → 不回報 full（安靜 none，fail-safe）", () => {
    expect(
      deriveJobRefundStatus(18, {
        refunded: true,
        refundedPoints: 20,
        refundRestoreFailed: true,
      }).refundStatus
    ).toBe("none");
  });

  it("director 舊任務 chargedPoints-only resultJson（AIDV-968 前，覆蓋範圍外）→ none（pin 現狀：不可兼讀 chargedPoints，否則已退款無旗標會誤報未退點）", () => {
    expect(
      deriveJobRefundStatus(19, {
        chargedPoints: 40,
        modality: "video",
        prompt: "scene",
      })
    ).toEqual({
      taskId: 19,
      chargedPoints: 0,
      refundedPoints: 0,
      refundStatus: "none",
    });
  });

  // ── AIDV-968：director 流納入覆蓋（costPoints + chargedPoints 同額並存）──

  it("director 新任務形狀（costPoints 與 chargedPoints 並存）未退款 → not_refunded", () => {
    // executeGenerationTask 扣點時的真實寫入形狀：chargedPoints（舊欄位，
    // 加性保留）與 costPoints（AIDV-968 新增）同額並存。
    const directorShape = {
      segmentId: "seg-1",
      segmentIndex: 0,
      prompt: "a director scene",
      modelId: "fal-ai/kling-video/v2.1/standard/text-to-video",
      studioType: "video",
      sourceStudio: "director",
      label: "影片生成 - 分鏡 #1",
      chargedPoints: 40,
      costPoints: 40,
    };
    expect(deriveJobRefundStatus(20, directorShape)).toEqual({
      taskId: 20,
      chargedPoints: 40,
      refundedPoints: 0,
      refundStatus: "not_refunded",
    });
  });

  it("director 新任務失敗退款後（claim-then-refund 旗標在）→ full", () => {
    expect(
      deriveJobRefundStatus(21, {
        segmentId: "seg-1",
        segmentIndex: 0,
        prompt: "a director scene",
        modelId: "fal-ai/flux",
        studioType: "image",
        sourceStudio: "director",
        chargedPoints: 40,
        costPoints: 40,
        refunded: true,
        refundedPoints: 40,
      })
    ).toEqual({
      taskId: 21,
      chargedPoints: 40,
      refundedPoints: 40,
      refundStatus: "full",
    });
  });

  it("director 舊任務（無 costPoints）被 pollGenerationTask 補退款（claim 寫入旗標）→ 防禦分支回報 full", () => {
    // AIDV-968 後的失敗路徑對「chargedPoints-only 舊任務」claim 也會寫
    // refunded/refundedPoints——推導走防禦分支（costPoints 缺但旗標＋金額在）。
    expect(
      deriveJobRefundStatus(22, {
        chargedPoints: 40,
        refunded: true,
        refundedPoints: 40,
      })
    ).toEqual({
      taskId: 22,
      chargedPoints: 40,
      refundedPoints: 40,
      refundStatus: "full",
    });
  });
});

// ─── 原始碼結構不變量（AIDV-771 慣例：claim-then-refund 順序鎖）──────────────

describe("失敗退款路徑的 claim-then-refund 結構不變量（AIDV-650）", () => {
  it("generate.ts queue submit 失敗 catch：refundUserPoints 前必有 atomicClaimJobRefund（有 jobId）", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/routers/generate.ts"),
      "utf8"
    );
    const start = src.indexOf("// queue submit 失敗");
    expect(start, "找不到 queue submit 失敗 catch 區段").toBeGreaterThanOrEqual(0);
    const region = src.slice(start, start + 1200);
    const idxClaim = region.indexOf("db.atomicClaimJobRefund(jobId, points)");
    const idxRefund = region.indexOf("db.refundUserPoints(userId, points)");
    expect(idxClaim, "catch 內應先 atomicClaimJobRefund 寫冪等旗標").toBeGreaterThanOrEqual(0);
    expect(idxRefund, "catch 內應有 refundUserPoints").toBeGreaterThan(idxClaim);
    expect(region).toContain("if (claimed)");
  });

  it("proStudio.ts generateMusicSuno 失敗 catch：有 jobId 時 refundUserPoints 前必有 atomicClaimJobRefund", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/routers/proStudio.ts"),
      "utf8"
    );
    const anchor = src.indexOf("await suno.generateMusic(");
    expect(anchor, "找不到 suno.generateMusic 呼叫點").toBeGreaterThanOrEqual(0);
    const end = src.indexOf("checkMusicSunoStatus", anchor);
    expect(end).toBeGreaterThan(anchor);
    const region = src.slice(anchor, end);
    const idxCatch = region.indexOf("catch");
    const idxClaim = region.indexOf("atomicClaimJobRefund(jobId, charged)", idxCatch);
    const idxRefund = region.indexOf("refundUserPoints(ctx.user.id, charged)", idxClaim);
    expect(idxCatch).toBeGreaterThanOrEqual(0);
    expect(idxClaim, "catch 內有 jobId 時應先 atomicClaimJobRefund").toBeGreaterThan(idxCatch);
    expect(idxRefund, "claim 之後才 refundUserPoints").toBeGreaterThan(idxClaim);
    expect(region).toContain("if (claimed)");
  });

  it("postGenActions.refundJobIfBilled：claim-then-refund 順序＋退款失敗補寫 refundRestoreFailed", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/services/postGenActions.ts"),
      "utf8"
    );
    const start = src.indexOf("export async function refundJobIfBilled");
    expect(start).toBeGreaterThanOrEqual(0);
    const region = src.slice(start, start + 3500);
    const idxClaim = region.indexOf("atomicClaimJobRefund(jobId, points)");
    const idxRefund = region.indexOf("refundUserPoints(job.userId, points)");
    expect(idxClaim).toBeGreaterThanOrEqual(0);
    expect(idxRefund).toBeGreaterThan(idxClaim);
    const idxCatch = region.indexOf("catch", idxRefund);
    const idxRestoreFlag = region.indexOf("refundRestoreFailed: true", idxCatch);
    expect(idxCatch).toBeGreaterThan(idxRefund);
    expect(
      idxRestoreFlag,
      "refundUserPoints 失敗的 catch 內應補寫 refundRestoreFailed 旗標"
    ).toBeGreaterThan(idxCatch);
    expect(region).toContain("mergeBackgroundJobResultJson");
  });

  // ── AIDV-968：director.ts 退款站點 ─────────────────────────────────────────

  it("director.ts executeGenerationTask 扣點：costPoints 與 chargedPoints 同額雙寫（加性，兩個 resultJson 寫入點皆有）", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/routers/director.ts"),
      "utf8"
    );
    const countOf = (needle: string) => src.split(needle).length - 1;
    // 建卡（createBackgroundJob）＋送出成功後回寫（updateBackgroundJob）兩處
    // 都必須同額雙寫；chargedPoints 為舊欄位，保留不刪（向後相容）。
    expect(
      countOf("costPoints: estimate.totalPoints"),
      "director.ts 兩個 resultJson 寫入點都應寫 costPoints"
    ).toBeGreaterThanOrEqual(2);
    expect(
      countOf("chargedPoints: estimate.totalPoints"),
      "chargedPoints 舊欄位必須保留（加性、向後相容）"
    ).toBeGreaterThanOrEqual(2);
  });

  it("director.ts executeGenerationTask 送出失敗 catch：refundUserPoints 前必有 atomicClaimJobRefund（claim-then-refund）", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/routers/director.ts"),
      "utf8"
    );
    const anchor = src.indexOf('route: "trpc.director.executeGenerationTask"');
    expect(anchor, "找不到 executeGenerationTask 的 dispatch 站點").toBeGreaterThanOrEqual(0);
    // 注意：不能用裸字 "pollGenerationTask" 當終點——try 區塊內的註解就提過它。
    const end = src.indexOf("pollGenerationTask: brainProcedure", anchor);
    expect(end).toBeGreaterThan(anchor);
    const region = src.slice(anchor, end);
    const idxClaim = region.indexOf(
      "db.atomicClaimJobRefund("
    );
    const idxRefund = region.indexOf(
      "db.refundUserPoints(userId, estimate.totalPoints)",
      idxClaim
    );
    expect(idxClaim, "catch 內應先 atomicClaimJobRefund 寫冪等旗標").toBeGreaterThanOrEqual(0);
    expect(idxRefund, "claim 之後才 refundUserPoints").toBeGreaterThan(idxClaim);
    expect(region).toContain("if (claimed)");
  });

  it("director.ts pollGenerationTask FAILED：snapshot 與 recompute 兩條退款路徑皆為 claim-then-refund，且退款失敗補寫 refundRestoreFailed", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/routers/director.ts"),
      "utf8"
    );
    const anchor = src.indexOf('if (s === "FAILED")');
    expect(anchor, "找不到 pollGenerationTask 的 FAILED 分支").toBeGreaterThanOrEqual(0);
    const end = src.indexOf("IN_QUEUE / IN_PROGRESS", anchor);
    expect(end).toBeGreaterThan(anchor);
    const region = src.slice(anchor, end);

    // snapshot 路徑（chargedPoints 快照）
    const idxClaim1 = region.indexOf("atomicClaimJobRefund(");
    const idxRefund1 = region.indexOf(
      "refundUserPoints(ctx.user.id, chargedPoints)",
      idxClaim1
    );
    expect(idxClaim1, "snapshot 路徑應先 claim").toBeGreaterThanOrEqual(0);
    expect(idxRefund1, "snapshot 路徑 claim 後才退點").toBeGreaterThan(idxClaim1);

    // recompute 路徑（estimatePoints 回推）
    const idxClaim2 = region.indexOf("atomicClaimJobRefund(", idxRefund1);
    const idxRefund2 = region.indexOf(
      "refundUserPoints(ctx.user.id, refund.totalPoints)",
      idxClaim2
    );
    expect(idxClaim2, "recompute 路徑應先 claim").toBeGreaterThan(idxRefund1);
    expect(idxRefund2, "recompute 路徑 claim 後才退點").toBeGreaterThan(idxClaim2);

    // 搶到鎖但錢包未入帳 → 補寫 refundRestoreFailed（同 refundJobIfBilled）
    expect(region).toContain("refundRestoreFailed: true");
    expect(region).toContain("mergeBackgroundJobResultJson");
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
