/**
 * resourceAccessResolver.test.ts — AIDV-121 DB 橋接層測試
 *
 * 驗證 resolver 把 DB 事實（團隊成員、顯式共享）正確組進 canAccess：
 *   • owner → true（不需任何共享）
 *   • 他人未共享 → false
 *   • team_shared 成員（listTeamIdsForUser 命中） → view/edit true
 *   • 顯式共享 viewer/editor → 對應動作
 *   • user 共享 + team 共享併存 → 取最高
 *   • 無 DB（helper 回空集合）→ 只剩 owner 過、其餘擋（demo 安全）
 *
 * 用 vi.mock 把 ../../db 換成可控 stub，不需真 MySQL。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

const dbState: {
  teamIds: number[];
  sharesOnResource: Array<{ role: "viewer" | "editor" }>;
} = {
  teamIds: [],
  sharesOnResource: [],
};

vi.mock("../../../db", () => ({
  listTeamIdsForUser: vi.fn(async () => dbState.teamIds),
  getSharesForUserOnResource: vi.fn(async () => dbState.sharesOnResource),
}));

import {
  canAccessResource,
  buildSubjectFacts,
} from "../resourceAccessResolver";

const OWNER_ID = 10;
const OTHER_ID = 20;
const TEAM_ID = 5;

beforeEach(() => {
  dbState.teamIds = [];
  dbState.sharesOnResource = [];
});

describe("AIDV-121 canAccessResource（DB 版）", () => {
  it("owner：不需任何共享即 view/edit/delete 全過", async () => {
    const facts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    for (const action of ["view", "edit", "delete"] as const) {
      expect(
        await canAccessResource("project", 1, facts, OWNER_ID, action)
      ).toBe(true);
    }
  });

  it("他人未共享：view 也擋", async () => {
    const facts = { ownerId: OWNER_ID, visibility: "private", teamId: null };
    expect(
      await canAccessResource("asset", 1, facts, OTHER_ID, "view")
    ).toBe(false);
  });

  it("team_shared 成員：view/edit 過、delete 擋", async () => {
    dbState.teamIds = [TEAM_ID];
    const facts = {
      ownerId: OWNER_ID,
      visibility: "team_shared",
      teamId: TEAM_ID,
    };
    expect(
      await canAccessResource("material", 1, facts, OTHER_ID, "view")
    ).toBe(true);
    expect(
      await canAccessResource("material", 1, facts, OTHER_ID, "edit")
    ).toBe(true);
    expect(
      await canAccessResource("material", 1, facts, OTHER_ID, "delete")
    ).toBe(false);
  });

  it("顯式共享 viewer：只 view", async () => {
    dbState.sharesOnResource = [{ role: "viewer" }];
    const facts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    expect(
      await canAccessResource("prompt", 1, facts, OTHER_ID, "view")
    ).toBe(true);
    expect(
      await canAccessResource("prompt", 1, facts, OTHER_ID, "edit")
    ).toBe(false);
  });

  it("顯式共享 editor：view+edit", async () => {
    dbState.sharesOnResource = [{ role: "editor" }];
    const facts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    expect(
      await canAccessResource("prompt", 1, facts, OTHER_ID, "edit")
    ).toBe(true);
  });

  it("user 共享 viewer + team 共享 editor → editor（取最高）", async () => {
    dbState.sharesOnResource = [{ role: "viewer" }, { role: "editor" }];
    const facts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    const subject = await buildSubjectFacts("asset", 1, OTHER_ID);
    expect(subject.explicitShareRole).toBe("editor");
  });

  it("無共享 + 非成員（helper 回空）→ 只剩 owner 過，他人全擋（demo 安全）", async () => {
    const facts = { ownerId: OWNER_ID, visibility: "team_shared", teamId: 999 };
    expect(
      await canAccessResource("asset", 1, facts, OTHER_ID, "view")
    ).toBe(false);
  });
});
