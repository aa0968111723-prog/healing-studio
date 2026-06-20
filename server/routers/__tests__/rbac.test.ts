/**
 * rbac.test.ts — AIDV-121 共享 / 撤銷 / 移轉 router 測試
 *
 * 驗證擁有權守門與生命週期：
 *   • share：owner 可共享 → 呼叫 upsertResourceShare；非 owner → FORBIDDEN；
 *     資源不存在 → NOT_FOUND；分享給自己 → BAD_REQUEST；
 *     對象不存在（user/team）→ NOT_FOUND；分享給無關係 team → FORBIDDEN。
 *   • revokeShare：owner 可撤銷 → 呼叫 revokeResourceShare；非 owner → FORBIDDEN。
 *   • transferOwnership：受 ENABLE_DATA_RBAC 旗標 gate（OFF→FORBIDDEN）；ON 時
 *     owner 可移轉 → 呼叫 transferResourceOwnership 並 deleteAllSharesForResource
 *     清乾淨共享圖；移轉給自己 → BAD_REQUEST；非 owner → FORBIDDEN；新 owner
 *     不存在 → NOT_FOUND。
 *
 * 用 vi.mock 換掉 ../db、稽核服務與旗標 helper，直接以 rbacRouter.createCaller。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const dbMock = {
  ownerFacts: null as
    | { ownerId: number; visibility: string | null; teamId: number | null }
    | null,
  /** getUsersByIds 回傳值（空＝對象不存在） */
  usersById: [] as Array<{ id: number }>,
  /** getTeam 回傳值（null＝團隊不存在） */
  team: null as { id: number; ownerId: number } | null,
  /** getTeamMembership 回傳值（null＝非成員） */
  membership: null as { id: number } | null,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
};

let rbacFlagOn = false;

function record(fn: string, ...args: unknown[]) {
  dbMock.calls.push({ fn, args });
}

vi.mock("../../db", () => ({
  getResourceOwnerFacts: vi.fn(async () => dbMock.ownerFacts),
  getUsersByIds: vi.fn(async () => dbMock.usersById),
  getTeam: vi.fn(async () => dbMock.team),
  getTeamMembership: vi.fn(async () => dbMock.membership),
  upsertResourceShare: vi.fn(async (d: unknown) => record("upsertResourceShare", d)),
  revokeResourceShare: vi.fn(async (...a: unknown[]) =>
    record("revokeResourceShare", ...a)
  ),
  deleteAllSharesForResource: vi.fn(async (...a: unknown[]) =>
    record("deleteAllSharesForResource", ...a)
  ),
  transferResourceOwnership: vi.fn(async (...a: unknown[]) =>
    record("transferResourceOwnership", ...a)
  ),
  listSharesForResource: vi.fn(async () => []),
}));

vi.mock("../../services/authz/resourceAccess", () => ({
  isDataRbacEnabled: vi.fn(() => rbacFlagOn),
}));

vi.mock("../../services/audit/auditLog", () => ({
  recordAuditEvent: vi.fn(),
  extractRequestSource: vi.fn(() => ({})),
}));

import { rbacRouter } from "../rbac";

const OWNER_ID = 100;
const OTHER_ID = 200;

function callerFor(userId: number) {
  const ctx = {
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any;
  return rbacRouter.createCaller(ctx);
}

beforeEach(() => {
  dbMock.ownerFacts = null;
  dbMock.usersById = [];
  dbMock.team = null;
  dbMock.membership = null;
  dbMock.calls = [];
  rbacFlagOn = false;
});

describe("AIDV-121 rbac.share", () => {
  it("owner 可共享（對象存在）→ upsertResourceShare 被呼叫", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.usersById = [{ id: OTHER_ID }];
    const res = await callerFor(OWNER_ID).share({
      resourceType: "project",
      resourceId: 1,
      sharedWithType: "user",
      sharedWithId: OTHER_ID,
      role: "editor",
    });
    expect(res).toEqual({ success: true });
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeTruthy();
  });

  it("非 owner → FORBIDDEN，不寫入", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OTHER_ID).share({
        resourceType: "project",
        resourceId: 1,
        sharedWithType: "user",
        sharedWithId: 999,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } as Partial<TRPCError>);
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeFalsy();
  });

  it("資源不存在 → NOT_FOUND", async () => {
    dbMock.ownerFacts = null;
    await expect(
      callerFor(OWNER_ID).share({
        resourceType: "asset",
        resourceId: 42,
        sharedWithType: "team",
        sharedWithId: 7,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("分享給自己 → BAD_REQUEST", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OWNER_ID).share({
        resourceType: "prompt",
        resourceId: 1,
        sharedWithType: "user",
        sharedWithId: OWNER_ID,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── 對象驗證（防幽靈授權）─────────────────────────────────────────────
  it("分享給不存在的 user → NOT_FOUND，不寫入", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.usersById = []; // 對象不存在
    await expect(
      callerFor(OWNER_ID).share({
        resourceType: "project",
        resourceId: 1,
        sharedWithType: "user",
        sharedWithId: 99999,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeFalsy();
  });

  it("分享給不存在的 team → NOT_FOUND，不寫入", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.team = null; // 團隊不存在
    await expect(
      callerFor(OWNER_ID).share({
        resourceType: "project",
        resourceId: 1,
        sharedWithType: "team",
        sharedWithId: 7,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeFalsy();
  });

  it("分享給分享者無關係的 team → FORBIDDEN，不寫入", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.team = { id: 7, ownerId: 555 }; // 團隊存在，但 owner 非分享者
    dbMock.membership = null; // 分享者非成員
    await expect(
      callerFor(OWNER_ID).share({
        resourceType: "project",
        resourceId: 1,
        sharedWithType: "team",
        sharedWithId: 7,
        role: "viewer",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeFalsy();
  });

  it("分享給分享者為成員的 team → 放行", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.team = { id: 7, ownerId: 555 };
    dbMock.membership = { id: 1 }; // 分享者是成員
    const res = await callerFor(OWNER_ID).share({
      resourceType: "project",
      resourceId: 1,
      sharedWithType: "team",
      sharedWithId: 7,
      role: "editor",
    });
    expect(res).toEqual({ success: true });
    expect(dbMock.calls.find(c => c.fn === "upsertResourceShare")).toBeTruthy();
  });
});

describe("AIDV-121 rbac.revokeShare", () => {
  it("owner 可撤銷 → revokeResourceShare 被呼叫", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    const res = await callerFor(OWNER_ID).revokeShare({
      resourceType: "project",
      resourceId: 1,
      sharedWithType: "user",
      sharedWithId: OTHER_ID,
    });
    expect(res).toEqual({ success: true });
    expect(dbMock.calls.find(c => c.fn === "revokeResourceShare")).toBeTruthy();
  });

  it("非 owner → FORBIDDEN", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OTHER_ID).revokeShare({
        resourceType: "project",
        resourceId: 1,
        sharedWithType: "user",
        sharedWithId: OTHER_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AIDV-121 rbac.transferOwnership", () => {
  it("旗標 OFF（預設）→ FORBIDDEN，不移轉（HARD SAFETY ①）", async () => {
    rbacFlagOn = false;
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.usersById = [{ id: OTHER_ID }];
    await expect(
      callerFor(OWNER_ID).transferOwnership({
        resourceType: "asset",
        resourceId: 3,
        newOwnerUserId: OTHER_ID,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      dbMock.calls.find(c => c.fn === "transferResourceOwnership")
    ).toBeFalsy();
  });

  it("旗標 ON：owner 可移轉 → transfer + deleteAllSharesForResource 清乾淨", async () => {
    rbacFlagOn = true;
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.usersById = [{ id: OTHER_ID }];
    const res = await callerFor(OWNER_ID).transferOwnership({
      resourceType: "asset",
      resourceId: 3,
      newOwnerUserId: OTHER_ID,
    });
    expect(res).toEqual({ success: true });
    expect(
      dbMock.calls.find(c => c.fn === "transferResourceOwnership")
    ).toBeTruthy();
    // 移轉後應清掉此資源的「全部」共享（給新 owner 乾淨共享圖、舊 owner 不留殘餘）
    expect(
      dbMock.calls.find(c => c.fn === "deleteAllSharesForResource")
    ).toBeTruthy();
  });

  it("旗標 ON：移轉給自己 → BAD_REQUEST", async () => {
    rbacFlagOn = true;
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OWNER_ID).transferOwnership({
        resourceType: "asset",
        resourceId: 3,
        newOwnerUserId: OWNER_ID,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("旗標 ON：新 owner 不存在 → NOT_FOUND，不移轉", async () => {
    rbacFlagOn = true;
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    dbMock.usersById = []; // 新 owner 不存在
    await expect(
      callerFor(OWNER_ID).transferOwnership({
        resourceType: "asset",
        resourceId: 3,
        newOwnerUserId: 99999,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      dbMock.calls.find(c => c.fn === "transferResourceOwnership")
    ).toBeFalsy();
  });

  it("旗標 ON：非 owner → FORBIDDEN，不移轉", async () => {
    rbacFlagOn = true;
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OTHER_ID).transferOwnership({
        resourceType: "asset",
        resourceId: 3,
        newOwnerUserId: 999,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      dbMock.calls.find(c => c.fn === "transferResourceOwnership")
    ).toBeFalsy();
  });
});
