/**
 * data-source-connections.test.ts — M4/M5 連接管理
 *
 * 驗證：Notion credential 後端加密且不外洩、Drive 走 OAuth 不需 credential、
 * 健檢更新 status、擁有權檢查。用真的 secretCrypto（設 env），mock db / Drive / fetch。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getDataSourceConnectionMock = vi.fn();
const createDataSourceConnectionMock = vi.fn();
const listDataSourceConnectionsForUserMock = vi.fn();
const updateDataSourceConnectionMock = vi.fn();
const getValidDriveAccessTokenMock = vi.fn();

vi.mock("./db", () => ({
  getDataSourceConnection: (...a: unknown[]) => getDataSourceConnectionMock(...a),
  createDataSourceConnection: (...a: unknown[]) =>
    createDataSourceConnectionMock(...a),
  listDataSourceConnectionsForUser: (...a: unknown[]) =>
    listDataSourceConnectionsForUserMock(...a),
  updateDataSourceConnection: (...a: unknown[]) =>
    updateDataSourceConnectionMock(...a),
}));

vi.mock("./services/googleDrive", () => ({
  getValidDriveAccessToken: (...a: unknown[]) => getValidDriveAccessTokenMock(...a),
}));

import {
  createConnection,
  listConnections,
  testConnection,
  setConnectionStatus,
} from "./subsystems/contextPackets/connectionService";
import { __resetSecretCryptoKeyForTests } from "./_core/secretCrypto";

const USER = 42;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-please-rotate";
  __resetSecretCryptoKeyForTests();
  vi.unstubAllGlobals();
});

function captureInsert() {
  let last: Record<string, unknown> | null = null;
  createDataSourceConnectionMock.mockImplementation(async (data: Record<string, unknown>) => {
    last = data;
    return 7;
  });
  getDataSourceConnectionMock.mockImplementation(async (id: number) => ({
    id,
    createdAt: new Date("2026-05-23T00:00:00.000Z"),
    updatedAt: new Date("2026-05-23T00:00:00.000Z"),
    lastHealthCheckAt: null,
    ...(last ?? {}),
  }));
  return () => last;
}

describe("createConnection", () => {
  it("encrypts the Notion credential and never returns it", async () => {
    const getLast = captureInsert();
    const view = await createConnection(USER, {
      kind: "notes",
      provider: "notion",
      credential: "secret_notion_token",
      config: { databaseId: "db1" },
    });

    const inserted = getLast()!;
    expect(inserted.authType).toBe("api_key");
    expect(inserted.encryptedCredentialRef).toBeTruthy();
    expect(inserted.encryptedCredentialRef).not.toContain("secret_notion_token");
    // 對外視圖不得含任何 credential 欄位。
    expect(view).not.toHaveProperty("credential");
    expect(view).not.toHaveProperty("encryptedCredentialRef");
    expect(view).toMatchObject({ provider: "notion", kind: "notes", status: "pending" });
  });

  it("rejects a Notion connection without a credential", async () => {
    await expect(
      createConnection(USER, { kind: "notes", provider: "notion" })
    ).rejects.toMatchObject({ reason: "forbidden" });
  });

  it("creates a Drive connection via OAuth without a credential", async () => {
    const getLast = captureInsert();
    await createConnection(USER, {
      kind: "cloud",
      provider: "google_drive",
      config: { folderIds: ["abc"] },
    });
    const inserted = getLast()!;
    expect(inserted.authType).toBe("oauth");
    expect(inserted.encryptedCredentialRef).toBeNull();
  });
});

describe("listConnections", () => {
  it("maps rows to views without credentials", async () => {
    listDataSourceConnectionsForUserMock.mockResolvedValue([
      {
        id: 1, ownerUserId: USER, teamId: null, projectId: null, kind: "notes",
        provider: "notion", authType: "api_key", status: "active",
        encryptedCredentialRef: "v1:secret", configJson: { databaseId: "x" },
        lastHealthCheckAt: null, createdAt: new Date(), updatedAt: new Date(),
      },
    ]);
    const views = await listConnections(USER);
    expect(views).toHaveLength(1);
    expect(views[0]).not.toHaveProperty("encryptedCredentialRef");
    expect(views[0].config).toEqual({ databaseId: "x" });
  });
});

describe("testConnection — health check", () => {
  it("marks a Drive connection active when a token is available", async () => {
    getDataSourceConnectionMock.mockResolvedValue({
      id: 5, ownerUserId: USER, kind: "cloud", provider: "google_drive",
      authType: "oauth", encryptedCredentialRef: null, configJson: null,
      status: "pending", teamId: null, projectId: null,
      lastHealthCheckAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    getValidDriveAccessTokenMock.mockResolvedValue("ya29.token");

    await testConnection(USER, 5);
    expect(updateDataSourceConnectionMock).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ status: "active" })
    );
  });

  it("marks a Drive connection error when no token", async () => {
    getDataSourceConnectionMock.mockResolvedValue({
      id: 5, ownerUserId: USER, kind: "cloud", provider: "google_drive",
      authType: "oauth", encryptedCredentialRef: null, configJson: null,
      status: "pending", teamId: null, projectId: null,
      lastHealthCheckAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    getValidDriveAccessTokenMock.mockResolvedValue(null);

    await testConnection(USER, 5);
    expect(updateDataSourceConnectionMock).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ status: "error" })
    );
  });

  it("rejects testing another user's connection", async () => {
    getDataSourceConnectionMock.mockResolvedValue({
      id: 5, ownerUserId: 999, kind: "cloud", provider: "google_drive",
      authType: "oauth", status: "pending",
    });
    await expect(testConnection(USER, 5)).rejects.toMatchObject({ reason: "forbidden" });
    expect(updateDataSourceConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a missing connection (not_found)", async () => {
    getDataSourceConnectionMock.mockResolvedValue(null);
    await expect(testConnection(USER, 5)).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("setConnectionStatus", () => {
  it("updates status for an owned connection", async () => {
    getDataSourceConnectionMock.mockResolvedValue({
      id: 5, ownerUserId: USER, kind: "notes", provider: "notion",
      authType: "api_key", status: "active", teamId: null, projectId: null,
      encryptedCredentialRef: "v1:x", configJson: null,
      lastHealthCheckAt: null, createdAt: new Date(), updatedAt: new Date(),
    });
    await setConnectionStatus(USER, 5, "disabled");
    expect(updateDataSourceConnectionMock).toHaveBeenCalledWith(5, { status: "disabled" });
  });
});
