/**
 * team-data-access-rules.test.ts — M4 set/listProjectAccessRules
 *
 * 驗證：寫規則需 owner/admin、讀規則任一成員可、upsert 經 db helper、非成員 forbidden。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getTeamMembershipMock = vi.fn();
const upsertProjectDataAccessRuleMock = vi.fn();
const listProjectDataAccessRulesMock = vi.fn();

vi.mock("./db", () => ({
  getTeamMembership: (...a: unknown[]) => getTeamMembershipMock(...a),
  upsertProjectDataAccessRule: (...a: unknown[]) =>
    upsertProjectDataAccessRuleMock(...a),
  listProjectDataAccessRules: (...a: unknown[]) =>
    listProjectDataAccessRulesMock(...a),
  // service import 了整個 db module；補上 compile 流程會用到的（此測試用不到）。
  getCreativeProject: vi.fn(),
  getLatestContextPacketForProject: vi.fn(),
  createContextPacket: vi.fn(),
  getContextPacket: vi.fn(),
}));

vi.mock("./services/teachingArchiveSearch", () => ({
  searchTeachingArchive: vi.fn(),
}));
vi.mock("./services/teachingArchiveAccess", () => ({
  loadMaterialForRead: vi.fn(),
  logAccess: vi.fn(),
}));

import {
  setProjectAccessRules,
  listProjectAccessRules,
} from "./subsystems/contextPackets/contextPacketService";

const USER = 42;
const TEAM = 5;

beforeEach(() => {
  vi.clearAllMocks();
  listProjectDataAccessRulesMock.mockResolvedValue([]);
});

describe("setProjectAccessRules — owner/admin only", () => {
  it("upserts each rule when the user is an admin", async () => {
    getTeamMembershipMock.mockResolvedValue({ teamId: TEAM, userId: USER, role: "admin" });
    upsertProjectDataAccessRuleMock.mockResolvedValue(1);
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: TEAM, projectId: 7, materialId: 101, connectionId: null, accessLevel: "chunk_access", allowedModesJson: null, createdBy: USER, updatedAt: new Date() },
    ]);

    const rules = await setProjectAccessRules(USER, {
      teamId: TEAM,
      projectId: 7,
      rules: [{ materialId: 101, accessLevel: "chunk_access", allowedModes: null }],
    });

    expect(upsertProjectDataAccessRuleMock).toHaveBeenCalledTimes(1);
    expect(upsertProjectDataAccessRuleMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: TEAM, projectId: 7, materialId: 101, accessLevel: "chunk_access", createdBy: USER })
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ accessLevel: "chunk_access", materialId: 101 });
  });

  it("rejects a plain member (forbidden)", async () => {
    getTeamMembershipMock.mockResolvedValue({ teamId: TEAM, userId: USER, role: "member" });
    await expect(
      setProjectAccessRules(USER, { teamId: TEAM, projectId: 7, rules: [{ materialId: 1, accessLevel: "none" }] })
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(upsertProjectDataAccessRuleMock).not.toHaveBeenCalled();
  });

  it("rejects a non-member (forbidden)", async () => {
    getTeamMembershipMock.mockResolvedValue(null);
    await expect(
      setProjectAccessRules(USER, { teamId: TEAM, projectId: 7, rules: [] })
    ).rejects.toMatchObject({ reason: "forbidden" });
  });
});

describe("listProjectAccessRules — any member", () => {
  it("returns mapped rules for a member", async () => {
    getTeamMembershipMock.mockResolvedValue({ teamId: TEAM, userId: USER, role: "member" });
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 2, teamId: TEAM, projectId: null, materialId: null, connectionId: null, accessLevel: "summary_only", allowedModesJson: ["create"], createdBy: 1, updatedAt: new Date("2026-05-23T00:00:00.000Z") },
    ]);

    const rules = await listProjectAccessRules(USER, { teamId: TEAM, projectId: null });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ accessLevel: "summary_only", allowedModes: ["create"], materialId: null });
  });

  it("rejects a non-member (forbidden)", async () => {
    getTeamMembershipMock.mockResolvedValue(null);
    await expect(
      listProjectAccessRules(USER, { teamId: TEAM, projectId: null })
    ).rejects.toMatchObject({ reason: "forbidden" });
  });
});
