/**
 * teamGroups.router.test.ts — AIDV-297 組別生命週期 router 測試
 *
 * 驗證能力守門與歸屬處理：
 *   • createGroup / deleteGroup：Admin 能力（group_management）——admin 可、
 *     leader/user（含 lead 組長）FORBIDDEN。
 *   • addMember：admin 或該組 lead 可；member/非組員 FORBIDDEN；
 *     對象使用者不存在 NOT_FOUND。
 *   • removeMember：管理者可移除他人；**本人可自行離開**（不需管理權）；
 *     其他人移除他人 FORBIDDEN；離開走
 *     removeTeamGroupMemberAndDetachOwnedResources（歸屬處理：自有資源摘組）。
 *   • assignResource 掛組：admin 可；owner 且目標組組員可；owner 非組員
 *     FORBIDDEN；非 owner（即使 lead）FORBIDDEN。摘組：owner / 該組 lead /
 *     admin 可；未歸組 BAD_REQUEST。
 *   • listMembers：組員或 admin 可；非組員 FORBIDDEN。
 *
 * 用 vi.mock 換掉 ../db 與稽核服務，直接以 teamGroupsRouter.createCaller。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const dbMock = {
  /** getTeamGroup 回傳（null＝組別不存在） */
  group: null as { id: number; name: string } | null,
  /** `${groupId}:${userId}` → 組內角色 */
  memberships: new Map<string, "lead" | "member">(),
  /** getUsersByIds 回傳（空＝對象不存在） */
  usersById: [] as Array<{ id: number }>,
  /** getResourceOwnerFacts 回傳 */
  ownerFacts: null as
    | { ownerId: number; visibility: string | null; teamId: number | null; groupId: number | null; isPublic?: boolean | null }
    | null,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
};

function record(fn: string, ...args: unknown[]) {
  dbMock.calls.push({ fn, args });
}

vi.mock("../../db", () => ({
  getTeamGroup: vi.fn(async () => dbMock.group),
  getTeamGroupMembership: vi.fn(async (groupId: number, userId: number) => {
    const role = dbMock.memberships.get(`${groupId}:${userId}`);
    return role ? { groupId, userId, role, addedByUserId: null } : null;
  }),
  getUsersByIds: vi.fn(async () => dbMock.usersById),
  getResourceOwnerFacts: vi.fn(async () => dbMock.ownerFacts),
  createTeamGroup: vi.fn(async (d: unknown) => {
    record("createTeamGroup", d);
    return 77;
  }),
  updateTeamGroup: vi.fn(async (...a: unknown[]) => record("updateTeamGroup", ...a)),
  deleteTeamGroupCascade: vi.fn(async (...a: unknown[]) =>
    record("deleteTeamGroupCascade", ...a)
  ),
  upsertTeamGroupMembership: vi.fn(async (d: unknown) =>
    record("upsertTeamGroupMembership", d)
  ),
  removeTeamGroupMemberAndDetachOwnedResources: vi.fn(async (...a: unknown[]) =>
    record("removeTeamGroupMemberAndDetachOwnedResources", ...a)
  ),
  setResourceGroup: vi.fn(async (...a: unknown[]) => record("setResourceGroup", ...a)),
  listTeamGroupsForUser: vi.fn(async () => []),
  listAllTeamGroups: vi.fn(async () => []),
  listTeamGroupMembers: vi.fn(async () => [{ userId: 1 }]),
}));

vi.mock("../../services/audit/auditLog", () => ({
  recordAuditEvent: vi.fn(),
  extractRequestSource: vi.fn(() => ({})),
}));

import { teamGroupsRouter } from "../teamGroups";

const ADMIN = { id: 1, role: "admin" };
const LEAD = { id: 2, role: "user" };
const MEMBER = { id: 3, role: "user" };
const OUTSIDER = { id: 4, role: "user" };
const LEADER_SYS = { id: 5, role: "leader" }; // 系統 leader ≠ Admin
const GROUP_ID = 9;

function callerFor(user: { id: number; role: string }) {
  const ctx = { user, req: { headers: {} } } as any;
  return teamGroupsRouter.createCaller(ctx);
}

beforeEach(() => {
  dbMock.group = { id: GROUP_ID, name: "剪輯組" };
  dbMock.memberships = new Map([
    [`${GROUP_ID}:${LEAD.id}`, "lead"],
    [`${GROUP_ID}:${MEMBER.id}`, "member"],
  ]);
  dbMock.usersById = [];
  dbMock.ownerFacts = null;
  dbMock.calls = [];
});

describe("AIDV-297 teamGroups.createGroup / deleteGroup（Admin 能力）", () => {
  it("admin 可建立組別", async () => {
    const res = await callerFor(ADMIN).createGroup({ name: "新組" });
    expect(res).toEqual({ groupId: 77 });
    expect(dbMock.calls.find(c => c.fn === "createTeamGroup")).toBeTruthy();
  });

  it("user / leader（含組長 lead）→ FORBIDDEN", async () => {
    for (const user of [LEAD, LEADER_SYS, OUTSIDER]) {
      await expect(
        callerFor(user).createGroup({ name: "偷開組" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
    }
    expect(dbMock.calls.find(c => c.fn === "createTeamGroup")).toBeFalsy();
  });

  it("admin 可刪除組別 → deleteTeamGroupCascade（清會員＋資源摘組）", async () => {
    await callerFor(ADMIN).deleteGroup({ groupId: GROUP_ID });
    expect(
      dbMock.calls.find(c => c.fn === "deleteTeamGroupCascade")
    ).toBeTruthy();
  });

  it("lead 組長也不能刪除組別（group_management 屬 Admin）", async () => {
    await expect(
      callerFor(LEAD).deleteGroup({ groupId: GROUP_ID })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });

  it("組別不存在 → NOT_FOUND", async () => {
    dbMock.group = null;
    await expect(
      callerFor(ADMIN).deleteGroup({ groupId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("AIDV-297 teamGroups.addMember（admin 或該組 lead）", () => {
  it("lead 可加成員（對象存在）", async () => {
    dbMock.usersById = [{ id: OUTSIDER.id }];
    await callerFor(LEAD).addMember({
      groupId: GROUP_ID,
      userId: OUTSIDER.id,
      role: "member",
    });
    expect(
      dbMock.calls.find(c => c.fn === "upsertTeamGroupMembership")
    ).toBeTruthy();
  });

  it("admin（非組員）也可加成員", async () => {
    dbMock.usersById = [{ id: OUTSIDER.id }];
    await callerFor(ADMIN).addMember({
      groupId: GROUP_ID,
      userId: OUTSIDER.id,
      role: "lead",
    });
    expect(
      dbMock.calls.find(c => c.fn === "upsertTeamGroupMembership")
    ).toBeTruthy();
  });

  it("member / 非組員 → FORBIDDEN", async () => {
    dbMock.usersById = [{ id: 99 }];
    for (const user of [MEMBER, OUTSIDER]) {
      await expect(
        callerFor(user).addMember({ groupId: GROUP_ID, userId: 99, role: "member" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
    }
  });

  it("對象使用者不存在 → NOT_FOUND（防幽靈會員）", async () => {
    dbMock.usersById = [];
    await expect(
      callerFor(LEAD).addMember({ groupId: GROUP_ID, userId: 12345, role: "member" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("AIDV-297 teamGroups.removeMember（管理者移除 / 本人離開＋歸屬處理）", () => {
  it("lead 可移除組員 → 走 detach 交易（自有資源摘組）", async () => {
    await callerFor(LEAD).removeMember({ groupId: GROUP_ID, userId: MEMBER.id });
    const call = dbMock.calls.find(
      c => c.fn === "removeTeamGroupMemberAndDetachOwnedResources"
    );
    expect(call).toBeTruthy();
    expect(call!.args).toEqual([GROUP_ID, MEMBER.id]);
  });

  it("member 本人可自行離開（不需管理權）", async () => {
    await callerFor(MEMBER).removeMember({
      groupId: GROUP_ID,
      userId: MEMBER.id,
    });
    expect(
      dbMock.calls.find(
        c => c.fn === "removeTeamGroupMemberAndDetachOwnedResources"
      )
    ).toBeTruthy();
  });

  it("member 移除他人 → FORBIDDEN", async () => {
    await expect(
      callerFor(MEMBER).removeMember({ groupId: GROUP_ID, userId: LEAD.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });

  it("對象不是組員 → NOT_FOUND", async () => {
    await expect(
      callerFor(LEAD).removeMember({ groupId: GROUP_ID, userId: OUTSIDER.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("AIDV-297 teamGroups.assignResource（掛組 / 摘組）", () => {
  it("掛組：owner 且目標組組員 → 可", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    await callerFor(MEMBER).assignResource({
      resourceType: "project",
      resourceId: 1,
      groupId: GROUP_ID,
    });
    const call = dbMock.calls.find(c => c.fn === "setResourceGroup");
    expect(call!.args).toEqual(["project", 1, GROUP_ID]);
  });

  it("掛組：owner 但非目標組組員 → FORBIDDEN", async () => {
    dbMock.ownerFacts = {
      ownerId: OUTSIDER.id,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    await expect(
      callerFor(OUTSIDER).assignResource({
        resourceType: "asset",
        resourceId: 1,
        groupId: GROUP_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });

  it("掛組：lead 不能把「別人的」資源掛進組（owner 同意優先）", async () => {
    dbMock.ownerFacts = {
      ownerId: OUTSIDER.id,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    await expect(
      callerFor(LEAD).assignResource({
        resourceType: "prompt",
        resourceId: 1,
        groupId: GROUP_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });

  it("掛組：admin 可（跨組治理）", async () => {
    dbMock.ownerFacts = {
      ownerId: OUTSIDER.id,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    await callerFor(ADMIN).assignResource({
      resourceType: "asset",
      resourceId: 2,
      groupId: GROUP_ID,
    });
    expect(dbMock.calls.find(c => c.fn === "setResourceGroup")).toBeTruthy();
  });

  it("掛組：material 一律 BAD_REQUEST（教材讀取路徑尚未接組別隔離——擋假承諾）", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: "team_shared",
      teamId: 1,
      groupId: null,
    };
    // owner＋組員擋、admin 也擋——讀取端沒隔離，誰掛都會產生無效的隔離承諾
    for (const user of [MEMBER, ADMIN]) {
      await expect(
        callerFor(user).assignResource({
          resourceType: "material",
          resourceId: 2,
          groupId: GROUP_ID,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
    }
    expect(dbMock.calls.find(c => c.fn === "setResourceGroup")).toBeFalsy();
  });

  it("摘組：material 仍可（只縮小狀態面，安全）", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: "team_shared",
      teamId: 1,
      groupId: GROUP_ID,
    };
    await callerFor(MEMBER).assignResource({
      resourceType: "material",
      resourceId: 2,
      groupId: null,
    });
    const call = dbMock.calls.find(c => c.fn === "setResourceGroup");
    expect(call!.args).toEqual(["material", 2, null]);
  });

  it("掛組：公開提示詞（isPublic=true）→ BAD_REQUEST（public 與組隔離矛盾；admin 也擋）", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: null,
      teamId: null,
      groupId: null,
      isPublic: true,
    };
    for (const user of [MEMBER, ADMIN]) {
      await expect(
        callerFor(user).assignResource({
          resourceType: "prompt",
          resourceId: 5,
          groupId: GROUP_ID,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
    }
    expect(dbMock.calls.find(c => c.fn === "setResourceGroup")).toBeFalsy();
  });

  it("掛組：非公開提示詞 → owner 組員可（isPublic 守門不誤傷）", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: null,
      teamId: null,
      groupId: null,
      isPublic: false,
    };
    await callerFor(MEMBER).assignResource({
      resourceType: "prompt",
      resourceId: 5,
      groupId: GROUP_ID,
    });
    const call = dbMock.calls.find(c => c.fn === "setResourceGroup");
    expect(call!.args).toEqual(["prompt", 5, GROUP_ID]);
  });

  it("摘組：該組 lead 可（縮小曝光面）", async () => {
    dbMock.ownerFacts = {
      ownerId: OUTSIDER.id,
      visibility: null,
      teamId: null,
      groupId: GROUP_ID,
    };
    await callerFor(LEAD).assignResource({
      resourceType: "asset",
      resourceId: 3,
      groupId: null,
    });
    const call = dbMock.calls.find(c => c.fn === "setResourceGroup");
    expect(call!.args).toEqual(["asset", 3, null]);
  });

  it("摘組：一般組員（非 owner、非 lead）→ FORBIDDEN", async () => {
    dbMock.ownerFacts = {
      ownerId: OUTSIDER.id,
      visibility: null,
      teamId: null,
      groupId: GROUP_ID,
    };
    await expect(
      callerFor(MEMBER).assignResource({
        resourceType: "asset",
        resourceId: 3,
        groupId: null,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });

  it("摘組：資源未歸組 → BAD_REQUEST", async () => {
    dbMock.ownerFacts = {
      ownerId: MEMBER.id,
      visibility: null,
      teamId: null,
      groupId: null,
    };
    await expect(
      callerFor(MEMBER).assignResource({
        resourceType: "project",
        resourceId: 4,
        groupId: null,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" } as Partial<TRPCError>);
  });

  it("資源不存在 → NOT_FOUND", async () => {
    dbMock.ownerFacts = null;
    await expect(
      callerFor(ADMIN).assignResource({
        resourceType: "project",
        resourceId: 999,
        groupId: GROUP_ID,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" } as Partial<TRPCError>);
  });
});

describe("AIDV-297 teamGroups.listMembers（組員或 admin）", () => {
  it("組員可看成員名單", async () => {
    const res = await callerFor(MEMBER).listMembers({ groupId: GROUP_ID });
    expect(res).toEqual([{ userId: 1 }]);
  });

  it("admin（非組員）可看（調閱）", async () => {
    const res = await callerFor(ADMIN).listMembers({ groupId: GROUP_ID });
    expect(res).toEqual([{ userId: 1 }]);
  });

  it("非組員 → FORBIDDEN", async () => {
    await expect(
      callerFor(OUTSIDER).listMembers({ groupId: GROUP_ID })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
  });
});
