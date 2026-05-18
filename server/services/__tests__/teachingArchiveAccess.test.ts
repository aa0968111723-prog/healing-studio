/**
 * teachingArchiveAccess.test.ts
 *
 * 鎖定 visibility × team membership 的 access 矩陣。透過 vitest mock 把
 * db 換成 in-memory stub — 不用真的 MySQL 也能驗證 read/write 規則。
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../../db", () => {
  const materials = new Map<number, any>();
  const memberships = new Map<string, any>(); // key = `${teamId}:${userId}`
  return {
    getTeachingMaterial: vi.fn(async (id: number) => materials.get(id) ?? null),
    getTeamMembership: vi.fn(async (teamId: number, userId: number) =>
      memberships.get(`${teamId}:${userId}`) ?? null
    ),
    logTeachingMaterialAccess: vi.fn(async () => undefined),
    // expose stub helpers for tests
    __setMaterial: (m: any) => materials.set(m.id, m),
    __setMembership: (teamId: number, userId: number, role: string) =>
      memberships.set(`${teamId}:${userId}`, {
        teamId,
        userId,
        role,
        invitedBy: null,
        joinedAt: new Date(),
        id: 1,
      }),
    __reset: () => {
      materials.clear();
      memberships.clear();
    },
  };
});

import * as dbMock from "../../db";
import {
  loadMaterialForRead,
  loadMaterialForWrite,
} from "../teachingArchiveAccess";

const db = dbMock as unknown as {
  __setMaterial: (m: any) => void;
  __setMembership: (teamId: number, userId: number, role: string) => void;
  __reset: () => void;
};

function makeMaterial(overrides: Partial<any> = {}) {
  return {
    id: 1,
    userId: 100,
    teamId: null,
    title: "test",
    description: null,
    mediaType: "text",
    fileUrl: null,
    visibility: "private",
    textContent: "hi",
    transcriptionStatus: "completed",
    sourceType: "discourse",
    lineage: null,
    sourceDate: null,
    sourceLocation: null,
    topic: null,
    speaker: null,
    tags: null,
    isFeatured: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  db.__reset();
});

describe("loadMaterialForRead", () => {
  it("404s when material does not exist", async () => {
    await expect(
      loadMaterialForRead(999, { userId: 100 })
    ).rejects.toThrow(TRPCError);
  });

  it("allows owner to read their private material", async () => {
    db.__setMaterial(makeMaterial({ id: 1, userId: 100, visibility: "private" }));
    const result = await loadMaterialForRead(1, { userId: 100 });
    expect(result.material.id).toBe(1);
    expect(result.viaTeamId).toBe(null);
  });

  it("forbids non-owner from reading a private material", async () => {
    db.__setMaterial(makeMaterial({ id: 1, userId: 100, visibility: "private" }));
    await expect(
      loadMaterialForRead(1, { userId: 200 })
    ).rejects.toThrow(/權限/);
  });

  it("allows team member to read team_shared material via membership", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "team_shared",
      })
    );
    db.__setMembership(7, 200, "member");
    const result = await loadMaterialForRead(1, { userId: 200 });
    expect(result.viaTeamId).toBe(7);
  });

  it("forbids non-member from reading team_shared material", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "team_shared",
      })
    );
    await expect(
      loadMaterialForRead(1, { userId: 999 })
    ).rejects.toThrow(/權限/);
  });

  it("allows any authenticated user to read public_disciples material", async () => {
    db.__setMaterial(
      makeMaterial({ id: 1, userId: 100, visibility: "public_disciples" })
    );
    const result = await loadMaterialForRead(1, { userId: 999 });
    expect(result.material.id).toBe(1);
    expect(result.viaTeamId).toBe(null);
  });
});

describe("loadMaterialForWrite", () => {
  it("allows owner to write their own material", async () => {
    db.__setMaterial(makeMaterial({ id: 1, userId: 100 }));
    const result = await loadMaterialForWrite(1, { userId: 100 });
    expect(result.material.userId).toBe(100);
  });

  it("allows regular team member to write team_shared material (design choice)", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "team_shared",
      })
    );
    db.__setMembership(7, 200, "member");
    const result = await loadMaterialForWrite(1, { userId: 200 });
    expect(result.viaTeamId).toBe(7);
    expect(result.membership?.role).toBe("member");
  });

  it("allows team admin to write team_shared material", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "team_shared",
      })
    );
    db.__setMembership(7, 200, "admin");
    const result = await loadMaterialForWrite(1, { userId: 200 });
    expect(result.viaTeamId).toBe(7);
  });

  it("forbids non-member from writing team_shared material", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "team_shared",
      })
    );
    // no membership for user 999
    await expect(
      loadMaterialForWrite(1, { userId: 999 })
    ).rejects.toThrow(/權限/);
  });

  it("forbids public_disciples write by stranger (only owner / team admins can)", async () => {
    db.__setMaterial(
      makeMaterial({ id: 1, userId: 100, visibility: "public_disciples" })
    );
    await expect(
      loadMaterialForWrite(1, { userId: 999 })
    ).rejects.toThrow(/權限/);
  });

  it("forbids member from writing public_disciples material even if in team (only admins can)", async () => {
    db.__setMaterial(
      makeMaterial({
        id: 1,
        userId: 100,
        teamId: 7,
        visibility: "public_disciples",
      })
    );
    db.__setMembership(7, 200, "member");
    await expect(
      loadMaterialForWrite(1, { userId: 200 })
    ).rejects.toThrow(/權限/);
  });
});
