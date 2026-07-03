/**
 * groupScopeResolver.test.ts — AIDV-297 組別範圍 DB 橋接層測試
 *
 * 驗證 ENABLE_GROUP_SCOPE=ON 時，canAccessResource / resolveRoleForResource
 * 對「已歸組資源」在 **API 層**套跨組隔離與組內授權（不只 UI）：
 *   • 非組員即使被顯式共享 editor → view 也擋（隔離 ceiling）。
 *   • member 組員（無共享）→ view 過、edit 擋（viewer 下限）。
 *   • lead 組員（無共享）→ view/edit 過、delete 擋（editor 下限）。
 *   • owner → 全過（不被自己資源的組別鎖在門外）。
 *   • 系統 admin（非組員）→ 既有共享不被壓掉（調閱），但不新增授權。
 *   • 未歸組資源 → 行為與 AIDV-121 原始語意位元相同。
 *   • demo/無 DB（helper 回空/null）→ 非 owner 全擋（失敗安全）。
 *
 * 用 vi.mock 換掉 env（旗標 ON）與 ../../db，不需真 MySQL。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// 旗標 ON（ENABLE_DATA_RBAC 在本層不讀，但一併給齊語意）
vi.mock("../../../_core/env.validated", () => ({
  serverEnv: {
    ENABLE_DATA_RBAC: "true",
    ENABLE_GROUP_SCOPE: "true",
  },
}));

const dbState: {
  teamIds: number[];
  sharesOnResource: Array<{ role: "viewer" | "editor" }>;
  /** getUsersByIds 回的（單一）使用者；null＝不存在 */
  user: { id: number; role: string } | null;
  /** getTeamGroupMembership 回的會員紀錄；null＝非組員 */
  membership: { role: "lead" | "member" } | null;
} = {
  teamIds: [],
  sharesOnResource: [],
  user: null,
  membership: null,
};

vi.mock("../../../db", () => ({
  listTeamIdsForUser: vi.fn(async () => dbState.teamIds),
  getSharesForUserOnResource: vi.fn(async () => dbState.sharesOnResource),
  getUsersByIds: vi.fn(async () => (dbState.user ? [dbState.user] : [])),
  getTeamGroupMembership: vi.fn(async () => dbState.membership),
}));

import {
  canAccessResource,
  resolveRoleForResource,
} from "../resourceAccessResolver";

const OWNER_ID = 10;
const OTHER_ID = 20;
const GROUP_ID = 9;

/** 已歸組資源的 facts */
const grouped = {
  ownerId: OWNER_ID,
  visibility: null,
  teamId: null,
  groupId: GROUP_ID,
};

beforeEach(() => {
  dbState.teamIds = [];
  dbState.sharesOnResource = [];
  dbState.user = null;
  dbState.membership = null;
});

describe("AIDV-297 跨組隔離（API 層擋，不只 UI）", () => {
  it("非組員＋顯式共享 editor → view 也擋（隔離壓掉共享）", async () => {
    dbState.sharesOnResource = [{ role: "editor" }];
    dbState.user = { id: OTHER_ID, role: "user" };
    dbState.membership = null; // 非組員
    expect(
      await canAccessResource("project", 1, grouped, OTHER_ID, "view")
    ).toBe(false);
    expect(
      await resolveRoleForResource("project", 1, grouped, OTHER_ID)
    ).toBe("none");
  });

  // 註（AIDV-297 修補）：本測項原以 "material" 為例——但教材的生產讀取路徑
  // （teachingArchiveAccess / listTeachingMaterialsForUser）**不經** canAccessResource，
  // 用 material 會給「教材已隔離」的假綠燈。改以 asset（真實接線於
  // assets.teamAssets / resolver）驗證同一 ceiling 語意；教材掛組已在
  // teamGroups.assignResource 擋下（待讀取端接線後開放）。
  it("非組員＋team_shared 池成員 → 也被隔離（ceiling 蓋過池授權）", async () => {
    dbState.teamIds = [5];
    dbState.user = { id: OTHER_ID, role: "user" };
    const facts = {
      ownerId: OWNER_ID,
      visibility: "team_shared",
      teamId: 5,
      groupId: GROUP_ID,
    };
    expect(
      await canAccessResource("asset", 1, facts, OTHER_ID, "view")
    ).toBe(false);
  });

  it("member 組員（無共享）→ view 過、edit 擋（viewer 下限）", async () => {
    dbState.user = { id: OTHER_ID, role: "user" };
    dbState.membership = { role: "member" };
    expect(
      await canAccessResource("asset", 1, grouped, OTHER_ID, "view")
    ).toBe(true);
    expect(
      await canAccessResource("asset", 1, grouped, OTHER_ID, "edit")
    ).toBe(false);
  });

  it("lead 組員（無共享）→ view/edit 過、delete 擋（editor 下限；delete 永屬 owner）", async () => {
    dbState.user = { id: OTHER_ID, role: "user" };
    dbState.membership = { role: "lead" };
    expect(
      await canAccessResource("prompt", 1, grouped, OTHER_ID, "view")
    ).toBe(true);
    expect(
      await canAccessResource("prompt", 1, grouped, OTHER_ID, "edit")
    ).toBe(true);
    expect(
      await canAccessResource("prompt", 1, grouped, OTHER_ID, "delete")
    ).toBe(false);
  });

  it("member 組員＋顯式共享 editor → 保持 editor（組下限不降級既有授權）", async () => {
    dbState.sharesOnResource = [{ role: "editor" }];
    dbState.user = { id: OTHER_ID, role: "user" };
    dbState.membership = { role: "member" };
    expect(
      await canAccessResource("project", 1, grouped, OTHER_ID, "edit")
    ).toBe(true);
  });

  it("owner → 全過，不需查組別/使用者（owner 至上）", async () => {
    for (const action of ["view", "edit", "delete"] as const) {
      expect(
        await canAccessResource("project", 1, grouped, OWNER_ID, action)
      ).toBe(true);
    }
  });

  it("系統 admin（非組員）：既有 viewer 共享不被壓掉（調閱），但無共享仍是 none（不新增授權）", async () => {
    dbState.user = { id: OTHER_ID, role: "admin" };
    dbState.membership = null;
    // 無任何共享 → none：admin 不因身分自動取得資源授權
    expect(
      await canAccessResource("asset", 1, grouped, OTHER_ID, "view")
    ).toBe(false);
    // 有 viewer 共享 → 不被隔離壓掉
    dbState.sharesOnResource = [{ role: "viewer" }];
    expect(
      await canAccessResource("asset", 1, grouped, OTHER_ID, "view")
    ).toBe(true);
    expect(
      await canAccessResource("asset", 1, grouped, OTHER_ID, "edit")
    ).toBe(false);
  });

  it("未歸組資源（groupId=null）→ 與 AIDV-121 原始語意相同（共享照常生效）", async () => {
    dbState.sharesOnResource = [{ role: "editor" }];
    const ungrouped = {
      ownerId: OWNER_ID,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    expect(
      await canAccessResource("prompt", 1, ungrouped, OTHER_ID, "edit")
    ).toBe(true);
  });

  it("demo/無 DB（user/membership 查無）→ 非 owner 全擋（失敗安全、最小可見）", async () => {
    dbState.sharesOnResource = [{ role: "editor" }];
    dbState.user = null; // 查不到使用者 → 非 admin
    dbState.membership = null; // 查不到會員 → 非組員
    expect(
      await canAccessResource("project", 1, grouped, OTHER_ID, "view")
    ).toBe(false);
  });
});
