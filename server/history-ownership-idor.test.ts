/**
 * server/history-ownership-idor.test.ts
 *
 * AIDV-609 — generation_history 存取控制（IDOR）回歸測試。
 *
 * 覆蓋三個子缺口的「擁有權守門」：
 *   ① history.delete / rate / toggleBookmark：必須先確認記錄屬於呼叫者，
 *      否則回 NOT_FOUND，且不得執行底層 update/delete。
 *   ③ loraTrainer.replicateTrainingStatus：必須先確認 trainingId 對應的訓練
 *      模型屬於呼叫者，否則回 NOT_FOUND。
 *
 * 守門以 db.getHistoryEntry(id, userId) / db.getFineTunedModelByReplicateId(
 * trainingId, userId) 為界（兩者 WHERE 皆鎖 userId）；本測試以 mock 模擬
 * 「命中 / 未命中」兩種回傳，驗證 router 行為。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getHistoryEntry: vi.fn(),
    updateHistoryEntry: vi.fn().mockResolvedValue(undefined),
    deleteHistoryEntry: vi.fn().mockResolvedValue(undefined),
    getFineTunedModelByReplicateId: vi.fn(),
  };
});

vi.mock("./services/agentModelPicks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/agentModelPicks")>();
  return { ...actual, recordModelPick: vi.fn().mockResolvedValue(1) };
});

import * as dbMod from "./db";
import { appRouter } from "./routers";

function ctxFor(userId: number) {
  return { user: { id: userId, email: `u${userId}@t.com` }, req: {} as never, res: {} as never };
}

const ownerId = 7;
const attackerId = 99;

function ownedEntry(id: number, userId: number) {
  return {
    id,
    userId,
    modality: "image" as const,
    parameterSnapshot: null,
    userRating: null,
    isBookmarked: false,
    costCredits: 1,
    prompt: "secret prompt",
    compiledPrompt: null,
    resultUrl: "https://r/result.png",
    thumbnailUrl: null,
    durationMs: null,
    requestId: null,
    sourceUrl: null,
    provider: null,
    archivedAt: null,
    expiresAt: null,
    archivalChecksum: null,
    createdAt: new Date(),
  };
}

beforeEach(() => {
  vi.mocked(dbMod.getHistoryEntry).mockReset();
  vi.mocked(dbMod.updateHistoryEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(dbMod.deleteHistoryEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(dbMod.getFineTunedModelByReplicateId).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AIDV-609 ① history write IDOR — ownership guard", () => {
  // getHistoryEntry(id, userId) 鎖 userId → 攻擊者對他人 id 查詢回 null。
  describe("when the record is NOT owned by the caller (guard returns null)", () => {
    beforeEach(() => {
      vi.mocked(dbMod.getHistoryEntry).mockResolvedValue(null);
    });

    it("history.delete throws NOT_FOUND and never calls deleteHistoryEntry", async () => {
      const caller = appRouter.createCaller(ctxFor(attackerId) as never);
      await expect(caller.history.delete({ id: 1 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(dbMod.getHistoryEntry).toHaveBeenCalledWith(1, attackerId);
      expect(dbMod.deleteHistoryEntry).not.toHaveBeenCalled();
    });

    it("history.rate throws NOT_FOUND and never calls updateHistoryEntry", async () => {
      const caller = appRouter.createCaller(ctxFor(attackerId) as never);
      await expect(caller.history.rate({ id: 1, rating: 5 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(dbMod.getHistoryEntry).toHaveBeenCalledWith(1, attackerId);
      expect(dbMod.updateHistoryEntry).not.toHaveBeenCalled();
    });

    it("history.toggleBookmark throws NOT_FOUND and never calls updateHistoryEntry", async () => {
      const caller = appRouter.createCaller(ctxFor(attackerId) as never);
      await expect(
        caller.history.toggleBookmark({ id: 1, isBookmarked: true })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(dbMod.getHistoryEntry).toHaveBeenCalledWith(1, attackerId);
      expect(dbMod.updateHistoryEntry).not.toHaveBeenCalled();
    });
  });

  describe("when the record IS owned by the caller (guard returns the row)", () => {
    beforeEach(() => {
      vi.mocked(dbMod.getHistoryEntry).mockResolvedValue(ownedEntry(5, ownerId));
    });

    it("history.delete proceeds and deletes", async () => {
      const caller = appRouter.createCaller(ctxFor(ownerId) as never);
      await expect(caller.history.delete({ id: 5 })).resolves.toEqual({ success: true });
      expect(dbMod.deleteHistoryEntry).toHaveBeenCalledWith(5);
    });

    it("history.rate proceeds and writes the rating", async () => {
      const caller = appRouter.createCaller(ctxFor(ownerId) as never);
      await expect(caller.history.rate({ id: 5, rating: 5 })).resolves.toEqual({
        success: true,
      });
      expect(dbMod.updateHistoryEntry).toHaveBeenCalledWith(5, { userRating: 5 });
    });

    it("history.toggleBookmark proceeds and writes the flag", async () => {
      const caller = appRouter.createCaller(ctxFor(ownerId) as never);
      await expect(
        caller.history.toggleBookmark({ id: 5, isBookmarked: true })
      ).resolves.toEqual({ success: true });
      expect(dbMod.updateHistoryEntry).toHaveBeenCalledWith(5, { isBookmarked: true });
    });
  });
});

describe("AIDV-609 ③ loraTrainer.replicateTrainingStatus — ownership guard", () => {
  it("throws NOT_FOUND when the trainingId is not owned by the caller", async () => {
    vi.mocked(dbMod.getFineTunedModelByReplicateId).mockResolvedValue(null);
    const caller = appRouter.createCaller(ctxFor(attackerId) as never);
    await expect(
      caller.loraTrainer.replicateTrainingStatus({ trainingId: "abc-123" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbMod.getFineTunedModelByReplicateId).toHaveBeenCalledWith("abc-123", attackerId);
  });

  it("passes the ownership gate when owned (reaching the REPLICATE_API_TOKEN check)", async () => {
    // Ownership OK → proceeds past the guard; with no token set the next gate
    // throws PRECONDITION_FAILED. Proves the guard does not block the owner.
    vi.mocked(dbMod.getFineTunedModelByReplicateId).mockResolvedValue({
      id: 1,
      userId: ownerId,
    } as never);
    const prev = process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_API_TOKEN;
    try {
      const caller = appRouter.createCaller(ctxFor(ownerId) as never);
      await expect(
        caller.loraTrainer.replicateTrainingStatus({ trainingId: "abc-123" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (prev !== undefined) process.env.REPLICATE_API_TOKEN = prev;
    }
  });
});

// 型別觸碰：確保 TRPCError 形狀被引用（避免 lint unused）。
void TRPCError;
