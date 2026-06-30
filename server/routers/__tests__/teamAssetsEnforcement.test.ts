/**
 * teamAssetsEnforcement.test.ts — AIDV-121 旗標 ON assets.teamAssets 過濾接線
 *
 * 守住 `assets.teamAssets` 的 canAccess 過濾：旗標 ON 時 A 看不到 B
 * 未共享的資產、看得到被顯式共享的。
 *
 * AIDV-651: 批次查詢後以純函式 canAccess 過濾（取代舊的逐筆 canAccessResource）。
 * mock 改為：isDataRbacEnabled（旗標）+ db.listTeamIdsForUser + db.getSharesForUserOnManyResources。
 * canAccess 從真實模組載入（純函式，無需 mock）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = true;
/** 對 userId=A 顯式共享的 assetId 集合 */
let sharedAssetIds = new Set<number>();

vi.mock("../../services/authz/resourceAccess", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isDataRbacEnabled: vi.fn(() => flagOn),
  };
});

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

function makeSharesMap(assetIds: number[], userId: number): Map<number, any[]> {
  const m = new Map<number, any[]>();
  for (const id of assetIds) {
    m.set(id, [{ sharedWithType: "user", sharedWithId: userId, role: "viewer" }]);
  }
  return m;
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
  sharedAssetIds = new Set<number>();
});

describe("AIDV-121 assets.teamAssets 旗標 ON 過濾", () => {
  it("旗標 ON：A 看不到 B 未共享的、看得到被允許的", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(10, A), // A 自己的 → owner 可見
      asset(20, B), // B 共享給 A → viewer share
      asset(30, B), // B 未共享 → 擋
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    sharedAssetIds = new Set([20]); // 只有 asset 20 被共享給 A
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(
      makeSharesMap([20], A)
    );

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

    const res = await caller(A).assets.teamAssets({});
    const ids = res.map((a: any) => a.id).sort((x: number, y: number) => x - y);
    expect(ids).toEqual([10, 20, 30]);
  });
});
