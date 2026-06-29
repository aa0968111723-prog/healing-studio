/**
 * teamAssetsEnforcement.test.ts — AIDV-121 旗標 ON assets.teamAssets 過濾接線
 *
 * 守住 `assets.teamAssets` 的 for-loop canAccess 過濾：旗標 ON 時 A 看不到 B
 * 未共享的資產、看得到被顯式共享的。純函式已另測，本檔證明 router 的實際接線
 * （getTeamSharedAssetsFiltered → 逐筆 canAccessResource 過濾）真的擋住非共享資產。
 * AIDV-601：過濾下推 SQL 後，router 改呼 getTeamSharedAssetsFiltered，本檔同步改 spy。
 *
 * 作法：mock 兩個 authz 模組（旗標 + canAccessResource），spyOn 真 db 的
 * getTeamSharedAssets 回固定 fixtures，經 appRouter.createCaller 呼叫。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = true;
/** 依 asset.id 決定 canAccess 結果 */
let allowedAssetIds = new Set<number>();

vi.mock("../../services/authz/resourceAccess", () => ({
  isDataRbacEnabled: vi.fn(() => flagOn),
}));

vi.mock("../../services/authz/resourceAccessResolver", () => ({
  canAccessResource: vi.fn(
    async (
      _type: string,
      resourceId: number
    ) => allowedAssetIds.has(resourceId)
  ),
}));

import { appRouter } from "../../routers";
import * as db from "../../db";

const A = 1; // ctx user
const B = 2; // 別人

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
  flagOn = true;
  allowedAssetIds = new Set<number>();
});

describe("AIDV-121 assets.teamAssets 旗標 ON 過濾", () => {
  it("旗標 ON：A 看不到 B 未共享的、看得到被允許的", async () => {
    // 全站 team_shared 池：A 自己一筆、B 的兩筆（一筆共享給 A、一筆沒）
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(10, A), // A 自己的 → 允許
      asset(20, B), // B 共享給 A → 允許
      asset(30, B), // B 未共享 → 擋
    ] as any);
    allowedAssetIds = new Set([10, 20]);

    const res = await caller(A).assets.teamAssets({});
    const ids = res.map((a: any) => a.id).sort((x: number, y: number) => x - y);
    expect(ids).toEqual([10, 20]);
    expect(ids).not.toContain(30);
  });

  it("旗標 OFF：回全站 team_shared（既有行為，不過濾＝零變化）", async () => {
    flagOn = false;
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(10, A),
      asset(20, B),
      asset(30, B),
    ] as any);
    // 即使 allowedAssetIds 為空，OFF 時不應過濾
    allowedAssetIds = new Set<number>();

    const res = await caller(A).assets.teamAssets({});
    const ids = res.map((a: any) => a.id).sort((x: number, y: number) => x - y);
    expect(ids).toEqual([10, 20, 30]);
  });
});
