/**
 * rbac.test.ts — AIDV-121 共享 / 撤銷 / 移轉 router 測試
 *
 * 驗證擁有權守門與生命週期：
 *   • share：owner 可共享 → 呼叫 upsertResourceShare；非 owner → FORBIDDEN；
 *     資源不存在 → NOT_FOUND；分享給自己 → BAD_REQUEST。
 *   • revokeShare：owner 可撤銷 → 呼叫 revokeResourceShare；非 owner → FORBIDDEN。
 *   • transferOwnership：owner 可移轉 → 呼叫 transferResourceOwnership 並清掉
 *     新 owner 的舊 user 共享；移轉給自己 → BAD_REQUEST；非 owner → FORBIDDEN。
 *
 * 用 vi.mock 換掉 ../db 與稽核服務，直接以 rbacRouter.createCaller(ctx) 呼叫。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const dbMock = {
  ownerFacts: null as
    | { ownerId: number; visibility: string | null; teamId: number | null }
    | null,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
};

function record(fn: string, ...args: unknown[]) {
  dbMock.calls.push({ fn, args });
}

vi.mock("../../db", () => ({
  getResourceOwnerFacts: vi.fn(async () => dbMock.ownerFacts),
  upsertResourceShare: vi.fn(async (d: unknown) => record("upsertResourceShare", d)),
  revokeResourceShare: vi.fn(async (...a: unknown[]) =>
    record("revokeResourceShare", ...a)
  ),
  transferResourceOwnership: vi.fn(async (...a: unknown[]) =>
    record("transferResourceOwnership", ...a)
  ),
  listSharesForResource: vi.fn(async () => []),
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
  dbMock.calls = [];
});

describe("AIDV-121 rbac.share", () => {
  it("owner 可共享 → upsertResourceShare 被呼叫", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
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
  it("owner 可移轉 → transfer + 清新 owner 舊共享", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    const res = await callerFor(OWNER_ID).transferOwnership({
      resourceType: "asset",
      resourceId: 3,
      newOwnerUserId: OTHER_ID,
    });
    expect(res).toEqual({ success: true });
    expect(
      dbMock.calls.find(c => c.fn === "transferResourceOwnership")
    ).toBeTruthy();
    // 移轉後應清掉新 owner 對此資源的 user 共享（避免 owner 又是被共享者）
    expect(dbMock.calls.find(c => c.fn === "revokeResourceShare")).toBeTruthy();
  });

  it("移轉給自己 → BAD_REQUEST", async () => {
    dbMock.ownerFacts = { ownerId: OWNER_ID, visibility: null, teamId: null };
    await expect(
      callerFor(OWNER_ID).transferOwnership({
        resourceType: "asset",
        resourceId: 3,
        newOwnerUserId: OWNER_ID,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("非 owner → FORBIDDEN，不移轉", async () => {
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
