/**
 * teamAssetsEnforcement.test.ts — AIDV-121 旗標 ON assets.teamAssets 過濾接線
 *
 * 守住 `assets.teamAssets` 的 canAccess 過濾：旗標 ON 時 A 看不到 B
 * 未共享的資產、看得到被顯式共享的。
 *
 * AIDV-651: 批次查詢後以純函式 canAccess 過濾（取代舊的逐筆 canAccessResource）。
 * mock 改為：isDataRbacEnabled（旗標）+ db.listTeamIdsForUser + db.getSharesForUserOnManyResources。
 * canAccess 從真實模組載入（純函式，無需 mock）。
 *
 * AIDV-297: 加 ENABLE_GROUP_SCOPE=ON 案例，釘住 router 內的組別過濾 wiring
 * （groupedIds 去重 → listGroupRolesForUserInGroups 批次 → applyGroupScope 逐筆）：
 * 已歸組資產對非組員（含被顯式共享者）過濾、member 組員可見（viewer 下限）、
 * 未歸組資產結果集不變（加性承諾）、admin 非組員無共享看不到（不新增授權）。
 * applyGroupScope 從真實模組載入（純函式），只 mock isGroupScopeEnabled 旗標。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let flagOn = true;
let groupFlagOn = false;
/** 對 userId=A 顯式共享的 assetId 集合 */
let sharedAssetIds = new Set<number>();

vi.mock("../../services/authz/resourceAccess", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isDataRbacEnabled: vi.fn(() => flagOn),
  };
});

vi.mock("../../services/authz/groupAccess", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    isGroupScopeEnabled: vi.fn(() => groupFlagOn),
  };
});

import { appRouter } from "../../routers";
import * as db from "../../db";

const A = 1; // ctx user
const B = 2; // 別人
const G = 9; // 組別 id

function asset(id: number, userId: number, groupId: number | null = null) {
  return {
    id,
    userId,
    title: `asset-${id}`,
    description: null,
    promptUsed: null,
    visibility: "team_shared",
    assetType: "image",
    sourceStudio: null,
    groupId,
    createdAt: new Date(),
  } as any;
}

function makeSharesMap(
  assetIds: number[],
  userId: number,
  role: "viewer" | "editor" = "viewer"
): Map<number, any[]> {
  const m = new Map<number, any[]>();
  for (const id of assetIds) {
    m.set(id, [{ sharedWithType: "user", sharedWithId: userId, role }]);
  }
  return m;
}

function caller(userId: number, role: string = "user") {
  return appRouter.createCaller({
    user: { id: userId, role },
    req: { cookies: {}, headers: {} },
    res: { cookie: () => {}, clearCookie: () => {} },
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  flagOn = true;
  groupFlagOn = false;
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

describe("AIDV-297 assets.teamAssets ENABLE_GROUP_SCOPE=ON 組別過濾 wiring", () => {
  beforeEach(() => {
    groupFlagOn = true;
  });

  it("已歸組資產：非組員即使被顯式共享 editor 也被過濾（隔離 ceiling 壓掉共享）", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(20, B, G), // B 的已歸組資產，顯式共享 editor 給 A —— 仍要擋
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(
      makeSharesMap([20], A, "editor")
    );
    const groupSpy = vi
      .spyOn(db, "listGroupRolesForUserInGroups")
      .mockResolvedValue(new Map()); // A 非任何組組員

    const res = await caller(A).assets.teamAssets({});
    expect(res.map((a: any) => a.id)).toEqual([]);
    // wiring 釘：批次組別查詢真的被呼叫、且 groupId 去重後傳入
    expect(groupSpy).toHaveBeenCalledWith(A, [G]);
  });

  it("member 組員（無共享）→ 看得到（viewer 下限）；owner 的已歸組資產不自鎖", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(10, A, G), // A 自己的已歸組資產 → owner 至上
      asset(20, B, G), // B 的已歸組資產，A 是組員 member → viewer 下限可見
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(new Map());
    vi.spyOn(db, "listGroupRolesForUserInGroups").mockResolvedValue(
      new Map([[G, "member"]])
    );

    const res = await caller(A).assets.teamAssets({});
    const ids = res.map((a: any) => a.id).sort((x: number, y: number) => x - y);
    expect(ids).toEqual([10, 20]);
  });

  it("未歸組資產：旗標 ON 結果集不變（加性承諾），且不多打組別查詢", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(10, A), // 未歸組
      asset(20, B), // 未歸組、共享給 A
      asset(30, B), // 未歸組、未共享 → 仍由 AIDV-121 基礎過濾擋
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(
      makeSharesMap([20], A)
    );
    const groupSpy = vi
      .spyOn(db, "listGroupRolesForUserInGroups")
      .mockResolvedValue(new Map());

    const res = await caller(A).assets.teamAssets({});
    const ids = res.map((a: any) => a.id).sort((x: number, y: number) => x - y);
    expect(ids).toEqual([10, 20]); // 與旗標 OFF 的 AIDV-121 過濾語意位元相同
    expect(groupSpy).not.toHaveBeenCalled(); // 沒有已歸組資產 → 免查
  });

  it("admin 非組員、無共享 → 已歸組資產仍看不到（調閱不新增授權）", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(20, B, G),
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(new Map());
    vi.spyOn(db, "listGroupRolesForUserInGroups").mockResolvedValue(new Map());

    const res = await caller(A, "admin").assets.teamAssets({});
    expect(res.map((a: any) => a.id)).toEqual([]);
  });

  it("admin 非組員、有 viewer 共享 → 不被隔離壓掉（調閱通過既有授權）", async () => {
    vi.spyOn(db, "getTeamSharedAssetsFiltered").mockResolvedValue([
      asset(20, B, G),
    ] as any);
    vi.spyOn(db, "listTeamIdsForUser").mockResolvedValue([]);
    vi.spyOn(db, "getSharesForUserOnManyResources").mockResolvedValue(
      makeSharesMap([20], A)
    );
    vi.spyOn(db, "listGroupRolesForUserInGroups").mockResolvedValue(new Map());

    const res = await caller(A, "admin").assets.teamAssets({});
    expect(res.map((a: any) => a.id)).toEqual([20]);
  });
});
