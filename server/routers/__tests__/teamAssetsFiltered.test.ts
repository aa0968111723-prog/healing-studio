/**
 * teamAssetsFiltered.test.ts — AIDV-601 assets.teamAssets SQL 過濾下推 + 移除靜默吞錯
 *
 * 守住本卡的兩個行為驗收（孿生 AIDV-581 myAssets 修補）：
 * (1) 過濾條件（assetType / sourceStudio / search）委派給 db.getTeamSharedAssetsFiltered
 *     （SQL 下推 + 預設 limit 200），而非在 router JS 端對全量載入結果 filter——
 *     證明「撈整個全站 team_shared 池再 JS filter」的全量載入已停止。
 * (2) DB 出錯時 router 不再 `catch { return [] }` 偽空清單，而是把錯誤拋出
 *     （tRPC 包成 TRPCError，前端可顯示重試），不再把「壞掉」偽裝成「沒有共享資產」。
 *
 * 作法：旗標 OFF（聚焦過濾下推與錯誤傳播，逐筆 RBAC 過濾另由 teamAssetsEnforcement
 * 測試守護），spyOn db.getTeamSharedAssetsFiltered，經 appRouter.createCaller 呼叫。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/authz/resourceAccess", () => ({
  isDataRbacEnabled: vi.fn(() => false),
}));

vi.mock("../../services/authz/resourceAccessResolver", () => ({
  canAccessResource: vi.fn(async () => true),
}));

import { appRouter } from "../../routers";
import * as db from "../../db";

function asset(id: number, userId: number) {
  return {
    id,
    userId,
    title: `asset-${id}`,
    description: null,
    promptUsed: null,
    visibility: "team_shared",
    assetType: "image",
    sourceStudio: null,
    createdAt: new Date(),
  } as any;
}

function caller(userId: number) {
  return appRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { cookies: {}, headers: {} },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AIDV-601 assets.teamAssets 過濾下推 + 錯誤傳播", () => {
  it("把 assetType/sourceStudio/search 委派給 getTeamSharedAssetsFiltered（SQL 下推，非 JS filter）", async () => {
    const spy = vi
      .spyOn(db, "getTeamSharedAssetsFiltered")
      .mockResolvedValue([asset(1, 1)] as any);

    await caller(1).assets.teamAssets({
      assetType: "video",
      sourceStudio: "creative",
      search: "foo",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      assetType: "video",
      sourceStudio: "creative",
      search: "foo",
    });
  });

  it("無參數呼叫：以 zod 預設（all/all）委派，回傳即 SQL 結果", async () => {
    const spy = vi
      .spyOn(db, "getTeamSharedAssetsFiltered")
      .mockResolvedValue([asset(10, 1), asset(20, 2)] as any);

    const res = await caller(1).assets.teamAssets({});

    // {} 經 zod 套用 default → assetType/sourceStudio = "all"
    expect(spy).toHaveBeenCalledWith({
      assetType: "all",
      sourceStudio: "all",
      search: undefined,
    });
    expect(res.map((a: any) => a.id)).toEqual([10, 20]);
  });

  it("DB 出錯時拋錯（不再 catch{return[]} 把壞掉偽裝成空清單）", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockRejectedValue(
      new Error("db connection lost")
    );

    await expect(caller(1).assets.teamAssets({})).rejects.toThrow();
  });
});
