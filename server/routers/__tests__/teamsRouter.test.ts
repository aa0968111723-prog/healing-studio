/**
 * teamsRouter.test.ts — AIDV-188 transferOwnership + updateMemberRole
 *
 * 驗收（AIDV-188 工作表）：
 *   1. owner transfer 後舊 owner 可正常 leave（不被「請先轉移」擋）
 *   2. transfer：新/舊 owner role 由 db 原子更新
 *   3. updateMemberRole owner-only；不可改 owner 本身
 *   4. 既有 removeMember/leave 對 owner 的守則不破
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── shared db state ──────────────────────────────────────────────────────────

type Role = "owner" | "admin" | "member";
type Membership = { role: Role; teamId: number; userId: number };

const _memberships = new Map<string, Membership>();
const _calls: Array<{ fn: string; args: unknown[] }> = [];

function mKey(teamId: number, userId: number) {
  return `${teamId}:${userId}`;
}
function setM(teamId: number, userId: number, role: Role) {
  _memberships.set(mKey(teamId, userId), { role, teamId, userId });
}

vi.mock("../../db", () => ({
  getTeamMembership: vi.fn(async (teamId: number, userId: number) =>
    _memberships.get(`${teamId}:${userId}`) ?? null
  ),
  transferTeamOwnership: vi.fn(
    async (teamId: number, oldOwnerId: number, newOwnerId: number) => {
      _calls.push({ fn: "transferTeamOwnership", args: [teamId, oldOwnerId, newOwnerId] });
      setM(teamId, newOwnerId, "owner");
      setM(teamId, oldOwnerId, "member");
    }
  ),
  updateTeamMemberRole: vi.fn(
    async (teamId: number, userId: number, newRole: "admin" | "member") => {
      _calls.push({ fn: "updateTeamMemberRole", args: [teamId, userId, newRole] });
      const m = _memberships.get(`${teamId}:${userId}`);
      if (m) m.role = newRole;
    }
  ),
  removeTeamMember: vi.fn(async (teamId: number, userId: number) => {
    _calls.push({ fn: "removeTeamMember", args: [teamId, userId] });
    _memberships.delete(`${teamId}:${userId}`);
  }),
  getTeam: vi.fn(async () => ({ id: 1, name: "test-team", ownerId: 10 })),
  listTeamsForUser: vi.fn(async () => []),
  createTeam: vi.fn(async () => 1),
  addTeamMember: vi.fn(async () => {}),
  listTeamMembers: vi.fn(async () => []),
  getUsersByIds: vi.fn(async (ids: number[]) => ids.map(id => ({ id }))),
  deleteTeam: vi.fn(async () => {}),
}));

import { teamsRouter } from "../teams";

const T = 1;       // teamId
const OWNER = 10;
const ADMIN = 20;
const MEMBER = 30;
const OUTSIDER = 99;

function caller(userId: number) {
  return teamsRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  _memberships.clear();
  _calls.length = 0;
  setM(T, OWNER, "owner");
  setM(T, ADMIN, "admin");
  setM(T, MEMBER, "member");
});

// ─── transferOwnership ────────────────────────────────────────────────────────

describe("transferOwnership（AIDV-188）", () => {
  it("owner 轉移給現有成員 → 呼叫 db.transferTeamOwnership", async () => {
    await caller(OWNER).transferOwnership({ teamId: T, newOwnerId: ADMIN });
    const c = _calls.find(c => c.fn === "transferTeamOwnership");
    expect(c).toBeTruthy();
    expect(c!.args).toEqual([T, OWNER, ADMIN]);
  });

  it("非 owner（admin）嘗試轉移 → FORBIDDEN", async () => {
    await expect(
      caller(ADMIN).transferOwnership({ teamId: T, newOwnerId: MEMBER })
    ).rejects.toThrow(TRPCError);
  });

  it("非成員 → FORBIDDEN（getRequireMembership）", async () => {
    await expect(
      caller(OUTSIDER).transferOwnership({ teamId: T, newOwnerId: MEMBER })
    ).rejects.toThrow(TRPCError);
  });

  it("轉移給自己 → BAD_REQUEST", async () => {
    await expect(
      caller(OWNER).transferOwnership({ teamId: T, newOwnerId: OWNER })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("新 owner 不是成員 → NOT_FOUND", async () => {
    await expect(
      caller(OWNER).transferOwnership({ teamId: T, newOwnerId: OUTSIDER })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("transfer 後舊 owner 可 leave（守則閉合）", async () => {
    await caller(OWNER).transferOwnership({ teamId: T, newOwnerId: ADMIN });
    // mock simulates db updating roles atomically
    expect(_memberships.get(mKey(T, OWNER))?.role).toBe("member");
    // old owner is now a plain member → leave should succeed
    await caller(OWNER).leave({ teamId: T });
    const removeCalls = _calls.filter(c => c.fn === "removeTeamMember");
    expect(removeCalls.length).toBeGreaterThan(0);
    expect(_memberships.has(mKey(T, OWNER))).toBe(false);
  });
});

// ─── updateMemberRole ─────────────────────────────────────────────────────────

describe("updateMemberRole（AIDV-188）", () => {
  it("owner 把 admin 降為 member → 呼叫 db.updateTeamMemberRole", async () => {
    await caller(OWNER).updateMemberRole({ teamId: T, memberId: ADMIN, newRole: "member" });
    const c = _calls.find(c => c.fn === "updateTeamMemberRole");
    expect(c!.args).toEqual([T, ADMIN, "member"]);
  });

  it("owner 把 member 升為 admin → 成功", async () => {
    await caller(OWNER).updateMemberRole({ teamId: T, memberId: MEMBER, newRole: "admin" });
    const c = _calls.find(c => c.fn === "updateTeamMemberRole");
    expect(c!.args).toEqual([T, MEMBER, "admin"]);
  });

  it("admin（非 owner）嘗試 updateMemberRole → FORBIDDEN", async () => {
    await expect(
      caller(ADMIN).updateMemberRole({ teamId: T, memberId: MEMBER, newRole: "admin" })
    ).rejects.toThrow(TRPCError);
  });

  it("owner 嘗試修改自己的角色 → BAD_REQUEST", async () => {
    await expect(
      caller(OWNER).updateMemberRole({ teamId: T, memberId: OWNER, newRole: "member" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("嘗試直接修改另一個 owner 的角色 → BAD_REQUEST（應用 transferOwnership）", async () => {
    setM(T, ADMIN, "owner"); // 模擬 ADMIN 也有 owner role（異常態）
    await expect(
      caller(OWNER).updateMemberRole({ teamId: T, memberId: ADMIN, newRole: "member" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("成員不存在 → NOT_FOUND", async () => {
    await expect(
      caller(OWNER).updateMemberRole({ teamId: T, memberId: OUTSIDER, newRole: "admin" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── 既有守則不破 ──────────────────────────────────────────────────────────────

describe("既有 removeMember / leave 守則不破（AIDV-188 驗收項 4）", () => {
  it("removeMember 擋掉 owner → FORBIDDEN", async () => {
    await expect(
      caller(ADMIN).removeMember({ teamId: T, userId: OWNER })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner 直接 leave（未轉移）→ FORBIDDEN", async () => {
    await expect(
      caller(OWNER).leave({ teamId: T })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin 移除 member → 成功，呼叫 db.removeTeamMember", async () => {
    await caller(ADMIN).removeMember({ teamId: T, userId: MEMBER });
    const c = _calls.find(c => c.fn === "removeTeamMember");
    expect(c!.args).toEqual([T, MEMBER]);
  });

  it("member 自行 leave → 成功", async () => {
    await caller(MEMBER).leave({ teamId: T });
    const c = _calls.find(c => c.fn === "removeTeamMember");
    expect(c!.args).toEqual([T, MEMBER]);
  });
});
