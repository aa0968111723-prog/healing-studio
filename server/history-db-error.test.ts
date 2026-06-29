/**
 * server/history-db-error.test.ts — AIDV-596
 *
 * 驗收條件：
 *   1. history.list 在 DB 拋例外時回 TRPCError(INTERNAL_SERVER_ERROR)，不靜默回 []
 *   2. history.bookmarked 在 DB 拋例外時回 TRPCError(INTERNAL_SERVER_ERROR)，不靜默回 []
 *   3. DB 正常時，list/bookmarked 正常回傳資料
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("./db", () => ({
  getHistoryByUser: vi.fn(),
  getBookmarkedHistory: vi.fn(),
  updateHistoryEntry: vi.fn().mockResolvedValue(undefined),
  getHistoryEntry: vi.fn(),
  deleteHistoryEntry: vi.fn().mockResolvedValue(undefined),
  getDb: async () => null,
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("./services/agentModelPicks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/agentModelPicks")>();
  return { ...actual, recordModelPick: vi.fn().mockResolvedValue(1) };
});

import * as dbMod from "./db";
import { appRouter } from "./routers";

function ctx() {
  return { user: { id: 1, email: "test@test.com" }, req: {} as never, res: {} as never };
}

const caller = appRouter.createCaller(ctx());

beforeEach(() => {
  vi.mocked(dbMod.getHistoryByUser).mockReset();
  vi.mocked(dbMod.getBookmarkedHistory).mockReset();
});

describe("history router DB error handling (AIDV-596)", () => {
  it("list: DB 拋例外 → TRPCError INTERNAL_SERVER_ERROR（不回 []）", async () => {
    vi.mocked(dbMod.getHistoryByUser).mockRejectedValue(new Error("Connection refused"));
    await expect(caller.history.list({ limit: 10 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("bookmarked: DB 拋例外 → TRPCError INTERNAL_SERVER_ERROR（不回 []）", async () => {
    vi.mocked(dbMod.getBookmarkedHistory).mockRejectedValue(new Error("Deadlock"));
    await expect(caller.history.bookmarked()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("list: DB 正常 → 回傳資料陣列", async () => {
    const rows = [{ id: 1, prompt: "test", modality: "image" }];
    vi.mocked(dbMod.getHistoryByUser).mockResolvedValue(rows as never);
    const result = await caller.history.list({ limit: 10 });
    expect(result).toEqual(rows);
  });

  it("bookmarked: DB 正常 → 回傳書籤陣列", async () => {
    const rows = [{ id: 2, prompt: "bm", modality: "video", isBookmarked: true }];
    vi.mocked(dbMod.getBookmarkedHistory).mockResolvedValue(rows as never);
    const result = await caller.history.bookmarked();
    expect(result).toEqual(rows);
  });

  it("list: TRPCError 非 [] — 讓 tRPC onError 可正確觸發 toast", async () => {
    vi.mocked(dbMod.getHistoryByUser).mockRejectedValue(new Error("DB down"));
    let caught: unknown;
    try {
      await caller.history.list({ limit: 10 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("INTERNAL_SERVER_ERROR");
  });
});
