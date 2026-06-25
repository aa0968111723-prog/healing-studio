/**
 * connection-service.test.ts — AIDV-185 單元測試
 *
 * 測試兩個子項：
 *   ① createConnection 歸屬驗證（teamId/projectId forbidden/pass）
 *   ② deleteConnection 生命週期（owner 可刪、非 owner 403）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── mock db module ────────────────────────────────────────────────────────
vi.mock("../../db", () => ({
  getTeam: vi.fn(),
  getTeamMembership: vi.fn(),
  getCreativeProject: vi.fn(),
  createDataSourceConnection: vi.fn(),
  getDataSourceConnection: vi.fn(),
  deleteDataSourceConnection: vi.fn(),
  updateDataSourceConnection: vi.fn(),
}));

vi.mock("../../_core/secretCrypto", () => ({
  encryptSecret: vi.fn((s: string) => `enc:${s}`),
  decryptSecret: vi.fn((s: string) => s.replace(/^enc:/, "")),
}));

vi.mock("../../services/googleDrive", () => ({
  getValidDriveAccessToken: vi.fn(),
}));

import * as db from "../../db";
import {
  createConnection,
  deleteConnection,
} from "./connectionService";
import { ContextPacketAccessError } from "./contracts";

const dbMock = db as {
  getTeam: ReturnType<typeof vi.fn>;
  getTeamMembership: ReturnType<typeof vi.fn>;
  getCreativeProject: ReturnType<typeof vi.fn>;
  createDataSourceConnection: ReturnType<typeof vi.fn>;
  getDataSourceConnection: ReturnType<typeof vi.fn>;
  deleteDataSourceConnection: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── ① createConnection 歸屬驗證 ──────────────────────────────────────────

describe("AIDV-185: createConnection 歸屬驗證", () => {
  it("A1: teamId 指定但 userId 非成員/非 owner → ContextPacketAccessError(forbidden)", async () => {
    dbMock.getTeam.mockResolvedValue({ id: 10, ownerId: 999 });
    dbMock.getTeamMembership.mockResolvedValue(null);

    await expect(
      createConnection(1, {
        kind: "notes",
        provider: "notion",
        teamId: 10,
        credential: "secret-token",
      })
    ).rejects.toBeInstanceOf(ContextPacketAccessError);

    const err = await createConnection(1, {
      kind: "notes",
      provider: "notion",
      teamId: 10,
      credential: "secret-token",
    }).catch(e => e) as ContextPacketAccessError;
    expect(err.reason).toBe("forbidden");
  });

  it("A2: teamId 指定且 userId 是成員 → 通過歸屬驗（不擲錯）", async () => {
    dbMock.getTeam.mockResolvedValue({ id: 10, ownerId: 999 });
    dbMock.getTeamMembership.mockResolvedValue({ teamId: 10, userId: 1, role: "member" });
    dbMock.createDataSourceConnection.mockResolvedValue(42);
    dbMock.getDataSourceConnection.mockResolvedValue({
      id: 42,
      ownerUserId: 1,
      teamId: 10,
      projectId: null,
      kind: "notes",
      provider: "notion",
      authType: "api_key",
      encryptedCredentialRef: "enc:secret-token",
      configJson: null,
      status: "pending",
      lastHealthCheckAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createConnection(1, {
      kind: "notes",
      provider: "notion",
      teamId: 10,
      credential: "secret-token",
    });
    expect(result.id).toBe(42);
    expect(result.teamId).toBe(10);
  });

  it("A3: teamId 指定且 userId 是 team owner → 通過歸屬驗", async () => {
    dbMock.getTeam.mockResolvedValue({ id: 10, ownerId: 1 }); // userId=1 is owner
    dbMock.getTeamMembership.mockResolvedValue(null); // not a listed member, but is owner
    dbMock.createDataSourceConnection.mockResolvedValue(43);
    dbMock.getDataSourceConnection.mockResolvedValue({
      id: 43,
      ownerUserId: 1,
      teamId: 10,
      projectId: null,
      kind: "notes",
      provider: "notion",
      authType: "api_key",
      encryptedCredentialRef: "enc:tok",
      configJson: null,
      status: "pending",
      lastHealthCheckAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createConnection(1, {
      kind: "notes",
      provider: "notion",
      teamId: 10,
      credential: "tok",
    });
    expect(result.id).toBe(43);
  });

  it("A4: projectId 指定但 userId 非 owner → ContextPacketAccessError(forbidden)", async () => {
    dbMock.getCreativeProject.mockResolvedValue({ id: 5, userId: 999 });

    const err = await createConnection(1, {
      kind: "cloud",
      provider: "google_drive",
      projectId: 5,
    }).catch(e => e) as ContextPacketAccessError;

    expect(err).toBeInstanceOf(ContextPacketAccessError);
    expect(err.reason).toBe("forbidden");
  });

  it("A5: projectId 指定且 userId 是 owner → 通過歸屬驗", async () => {
    dbMock.getCreativeProject.mockResolvedValue({ id: 5, userId: 1 });
    dbMock.createDataSourceConnection.mockResolvedValue(44);
    dbMock.getDataSourceConnection.mockResolvedValue({
      id: 44,
      ownerUserId: 1,
      teamId: null,
      projectId: 5,
      kind: "cloud",
      provider: "google_drive",
      authType: "oauth",
      encryptedCredentialRef: null,
      configJson: null,
      status: "pending",
      lastHealthCheckAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createConnection(1, {
      kind: "cloud",
      provider: "google_drive",
      projectId: 5,
    });
    expect(result.id).toBe(44);
    expect(result.projectId).toBe(5);
  });

  it("A6: teamId=null projectId=null → 跳過歸屬驗，直接建立", async () => {
    dbMock.createDataSourceConnection.mockResolvedValue(45);
    dbMock.getDataSourceConnection.mockResolvedValue({
      id: 45,
      ownerUserId: 1,
      teamId: null,
      projectId: null,
      kind: "notes",
      provider: "notion",
      authType: "api_key",
      encryptedCredentialRef: "enc:tok",
      configJson: null,
      status: "pending",
      lastHealthCheckAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await createConnection(1, {
      kind: "notes",
      provider: "notion",
      credential: "tok",
    });
    expect(result.id).toBe(45);
    expect(dbMock.getTeam).not.toHaveBeenCalled();
    expect(dbMock.getCreativeProject).not.toHaveBeenCalled();
  });

  it("A7: teamId 指定但團隊不存在 → ContextPacketAccessError(not_found)", async () => {
    dbMock.getTeam.mockResolvedValue(null);

    const err = await createConnection(1, {
      kind: "notes",
      provider: "notion",
      teamId: 999,
      credential: "tok",
    }).catch(e => e) as ContextPacketAccessError;

    expect(err).toBeInstanceOf(ContextPacketAccessError);
    expect(err.reason).toBe("not_found");
  });

  it("A8: projectId 指定但專案不存在 → ContextPacketAccessError(not_found)", async () => {
    dbMock.getCreativeProject.mockResolvedValue(null);

    const err = await createConnection(1, {
      kind: "cloud",
      provider: "google_drive",
      projectId: 999,
    }).catch(e => e) as ContextPacketAccessError;

    expect(err).toBeInstanceOf(ContextPacketAccessError);
    expect(err.reason).toBe("not_found");
  });
});

// ─── ② deleteConnection 生命週期 ──────────────────────────────────────────

describe("AIDV-185: deleteConnection 生命週期", () => {
  const mockRow = {
    id: 7,
    ownerUserId: 1,
    teamId: null,
    projectId: null,
    kind: "notes" as const,
    provider: "notion",
    authType: "api_key" as const,
    encryptedCredentialRef: "enc:secret",
    configJson: null,
    status: "active" as const,
    lastHealthCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("D1: owner 可刪除自己的連接", async () => {
    dbMock.getDataSourceConnection.mockResolvedValue(mockRow);
    dbMock.deleteDataSourceConnection.mockResolvedValue(undefined);

    await expect(deleteConnection(1, 7)).resolves.toBeUndefined();
    expect(dbMock.deleteDataSourceConnection).toHaveBeenCalledWith(7);
  });

  it("D2: 非 owner 嘗試刪除 → ContextPacketAccessError(forbidden)", async () => {
    dbMock.getDataSourceConnection.mockResolvedValue(mockRow); // ownerUserId=1
    const err = await deleteConnection(99, 7).catch(e => e) as ContextPacketAccessError;

    expect(err).toBeInstanceOf(ContextPacketAccessError);
    expect(err.reason).toBe("forbidden");
    expect(dbMock.deleteDataSourceConnection).not.toHaveBeenCalled();
  });

  it("D3: 連接不存在 → ContextPacketAccessError(not_found)", async () => {
    dbMock.getDataSourceConnection.mockResolvedValue(null);
    const err = await deleteConnection(1, 999).catch(e => e) as ContextPacketAccessError;

    expect(err).toBeInstanceOf(ContextPacketAccessError);
    expect(err.reason).toBe("not_found");
    expect(dbMock.deleteDataSourceConnection).not.toHaveBeenCalled();
  });

  it("D4: 刪除後 db.deleteDataSourceConnection 帶正確 id 呼叫一次", async () => {
    dbMock.getDataSourceConnection.mockResolvedValue(mockRow);
    dbMock.deleteDataSourceConnection.mockResolvedValue(undefined);

    await deleteConnection(1, 7);
    expect(dbMock.deleteDataSourceConnection).toHaveBeenCalledTimes(1);
    expect(dbMock.deleteDataSourceConnection).toHaveBeenCalledWith(7);
  });
});
