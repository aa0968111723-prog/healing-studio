/**
 * context-packet-compile.test.ts — M4 compileProjectContextPacket / reuse
 *
 * 用 vi.mock 攔 ./db、teachingArchiveSearch、teachingArchiveAccess，驗證：
 *   1. team_data 來源經 ACL + access rule → source-agnostic ContextSourceRef
 *   2. accessLevel "none" 排除；allowedModes 不含當前 mode 排除
 *   3. loadMaterialForRead 丟錯的素材被丟棄，不中斷整批
 *   4. 每筆納入的素材寫一筆 logAccess（via=context_packet）
 *   5. 不呼叫昂貴模型（只用 searchTeachingArchive，且只一次）
 *   6. ownership：別人的 project → forbidden；不存在 → not_found
 *   7. reuseOrRefreshPacket：新鮮快取直接回、過期回 null
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCreativeProjectMock = vi.fn();
const getLatestContextPacketForProjectMock = vi.fn();
const createContextPacketMock = vi.fn();
const getContextPacketMock = vi.fn();
const listProjectDataAccessRulesMock = vi.fn();
const listDataSourceConnectionsForUserMock = vi.fn();
const searchTeachingArchiveMock = vi.fn();
const loadMaterialForReadMock = vi.fn();
const logAccessMock = vi.fn();

vi.mock("./db", () => ({
  getCreativeProject: (...a: unknown[]) => getCreativeProjectMock(...a),
  getLatestContextPacketForProject: (...a: unknown[]) =>
    getLatestContextPacketForProjectMock(...a),
  createContextPacket: (...a: unknown[]) => createContextPacketMock(...a),
  getContextPacket: (...a: unknown[]) => getContextPacketMock(...a),
  listProjectDataAccessRules: (...a: unknown[]) =>
    listProjectDataAccessRulesMock(...a),
  listDataSourceConnectionsForUser: (...a: unknown[]) =>
    listDataSourceConnectionsForUserMock(...a),
  // 下列在 compile 流程用不到，但 service/adapter import 了整個 module。
  getTeamMembership: vi.fn(),
  upsertProjectDataAccessRule: vi.fn(),
}));

vi.mock("./services/teachingArchiveSearch", () => ({
  searchTeachingArchive: (...a: unknown[]) => searchTeachingArchiveMock(...a),
}));

vi.mock("./services/teachingArchiveAccess", () => ({
  loadMaterialForRead: (...a: unknown[]) => loadMaterialForReadMock(...a),
  logAccess: (...a: unknown[]) => logAccessMock(...a),
}));

import {
  compileProjectContextPacket,
  reuseOrRefreshPacket,
} from "./subsystems/contextPackets/contextPacketService";
import { ContextPacketAccessError } from "./subsystems/contextPackets/contracts";
import { encryptSecret, __resetSecretCryptoKeyForTests } from "./_core/secretCrypto";

// 設在 module scope：notionConn 在 describe body（collection 期）就會呼叫 encryptSecret。
process.env.CREDENTIAL_ENCRYPTION_KEY ||= "test-encryption-key-please-rotate";

const OWNER = 42;
const PROJECT = { id: 7, userId: OWNER, title: "禪修短片", description: "呼吸與放下" };

function hit(over: Record<string, unknown> = {}) {
  return {
    id: 101,
    title: "呼吸引導稿",
    mediaType: "text",
    sourceType: null,
    lineage: null,
    topic: null,
    speaker: null,
    sourceDate: null,
    fileUrl: null,
    snippet: "吸氣四拍，吐氣六拍，把注意力放在鼻尖。",
    matchedBy: "vector",
    score: 0.82,
    ...over,
  };
}

function material(over: Record<string, unknown> = {}) {
  return {
    id: 101,
    userId: 999,
    teamId: 7,
    title: "呼吸引導稿",
    visibility: "team_shared",
    textContent: "吸氣四拍，吐氣六拍。把注意力放在鼻尖，感受氣息進出。",
    mediaType: "text",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env.CREDENTIAL_ENCRYPTION_KEY = "test-encryption-key-please-rotate";
  __resetSecretCryptoKeyForTests();
  getCreativeProjectMock.mockResolvedValue({ ...PROJECT });
  getLatestContextPacketForProjectMock.mockResolvedValue(null);
  listProjectDataAccessRulesMock.mockResolvedValue([]);
  listDataSourceConnectionsForUserMock.mockResolvedValue([]);
  // createContextPacket 記下寫入內容，getContextPacket 回對應 row。
  let lastInsert: Record<string, unknown> | null = null;
  createContextPacketMock.mockImplementation(async (data: Record<string, unknown>) => {
    lastInsert = data;
    return 555;
  });
  getContextPacketMock.mockImplementation(async (id: number) => ({
    id,
    createdAt: new Date("2026-05-23T00:00:00.000Z"),
    ...(lastInsert ?? {}),
  }));
  logAccessMock.mockReturnValue(undefined);
});

describe("compileProjectContextPacket — team_data path", () => {
  it("builds source-agnostic refs (default summary_only) and audits each", async () => {
    searchTeachingArchiveMock.mockResolvedValue([hit()]);
    loadMaterialForReadMock.mockResolvedValue({ material: material(), viaTeamId: 7 });

    const view = await compileProjectContextPacket({
      userId: OWNER,
      projectId: 7,
      mode: "create",
    });

    expect(searchTeachingArchiveMock).toHaveBeenCalledTimes(1);
    expect(view.reused).toBe(false);
    expect(view.sourceRefs).toHaveLength(1);
    expect(view.sourceRefs[0]).toMatchObject({
      kind: "team_data",
      refId: "101",
      accessLevel: "summary_only",
      connectionId: null,
      matchedBy: "vector",
    });
    expect(view.summaryMarkdown).toContain("呼吸引導稿");
    // 稽核：納入的素材寫一筆 search_hit / via=context_packet。
    expect(logAccessMock).toHaveBeenCalledWith(
      101,
      OWNER,
      "search_hit",
      expect.objectContaining({ via: "context_packet", projectId: 7 })
    );
    expect(createContextPacketMock).toHaveBeenCalledTimes(1);
  });

  it("excludes a material whose rule accessLevel is none", async () => {
    searchTeachingArchiveMock.mockResolvedValue([hit()]);
    loadMaterialForReadMock.mockResolvedValue({ material: material(), viaTeamId: 7 });
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: 7, projectId: 7, materialId: 101, accessLevel: "none", allowedModesJson: null },
    ]);

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs).toHaveLength(0);
    expect(logAccessMock).not.toHaveBeenCalled();
  });

  it("excludes a material when its rule disallows the current mode", async () => {
    searchTeachingArchiveMock.mockResolvedValue([hit()]);
    loadMaterialForReadMock.mockResolvedValue({ material: material(), viaTeamId: 7 });
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: 7, projectId: 7, materialId: 101, accessLevel: "chunk_access", allowedModesJson: ["director"] },
    ]);

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs).toHaveLength(0);
  });

  it("applies a material-specific rule over a team-wide default and shapes the snippet", async () => {
    searchTeachingArchiveMock.mockResolvedValue([hit()]);
    loadMaterialForReadMock.mockResolvedValue({ material: material(), viaTeamId: 7 });
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: 7, projectId: null, materialId: null, accessLevel: "summary_only", allowedModesJson: null },
      { id: 2, teamId: 7, projectId: 7, materialId: 101, accessLevel: "full_reference", allowedModesJson: null },
    ]);

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs[0].accessLevel).toBe("full_reference");
  });

  it("drops a hit whose loadMaterialForRead rejects, keeping the rest", async () => {
    searchTeachingArchiveMock.mockResolvedValue([hit({ id: 101 }), hit({ id: 202, title: "靜心稿" })]);
    loadMaterialForReadMock.mockImplementation(async (id: number) => {
      if (id === 101) throw new Error("forbidden");
      return { material: material({ id: 202, title: "靜心稿" }), viaTeamId: 7 };
    });

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs.map(r => r.refId)).toEqual(["202"]);
  });

  it("returns an empty-but-valid packet when no team data matches", async () => {
    searchTeachingArchiveMock.mockResolvedValue([]);
    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs).toHaveLength(0);
    expect(view.summaryMarkdown).toContain("沒有可用的內部資料");
  });
});

describe("compileProjectContextPacket — ownership", () => {
  it("rejects a project owned by another user (forbidden)", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...PROJECT, userId: 999 });
    await expect(
      compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" })
    ).rejects.toMatchObject({ reason: "forbidden" });
    expect(createContextPacketMock).not.toHaveBeenCalled();
  });

  it("rejects a missing project (not_found)", async () => {
    getCreativeProjectMock.mockResolvedValue(null);
    await expect(
      compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" })
    ).rejects.toBeInstanceOf(ContextPacketAccessError);
  });

  it("reuses a fresh cached packet without recompiling", async () => {
    getLatestContextPacketForProjectMock.mockResolvedValue({
      id: 9,
      projectId: 7,
      teamId: null,
      userId: OWNER,
      scope: "project",
      summaryMarkdown: "cached",
      sourceRefsJson: [],
      tokenEstimate: 2,
      createdByModel: null,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.reused).toBe(true);
    expect(view.id).toBe(9);
    expect(searchTeachingArchiveMock).not.toHaveBeenCalled();
    expect(createContextPacketMock).not.toHaveBeenCalled();
  });
});

describe("compileProjectContextPacket — connection-level gating", () => {
  const notionConn = {
    id: 50,
    ownerUserId: OWNER,
    teamId: 7,
    projectId: 7,
    kind: "notes",
    provider: "notion",
    authType: "api_key",
    status: "active",
    encryptedCredentialRef: encryptSecret("notion_token"),
    configJson: null,
    lastHealthCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("skips an external connection that has an explicit 'none' rule (no API call)", async () => {
    searchTeachingArchiveMock.mockResolvedValue([]); // 隔離團隊資料
    listDataSourceConnectionsForUserMock.mockResolvedValue([notionConn]);
    listProjectDataAccessRulesMock.mockResolvedValue([
      { id: 1, teamId: 7, projectId: 7, materialId: null, connectionId: 50, accessLevel: "none", allowedModesJson: null },
    ]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const view = await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(view.sourceRefs).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled(); // 連接被擋 → 不打 Notion API
  });

  it("invokes the external connection when no blocking rule exists", async () => {
    searchTeachingArchiveMock.mockResolvedValue([]);
    listDataSourceConnectionsForUserMock.mockResolvedValue([notionConn]);
    listProjectDataAccessRulesMock.mockResolvedValue([]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await compileProjectContextPacket({ userId: OWNER, projectId: 7, mode: "create" });
    expect(fetchMock).toHaveBeenCalled(); // 連接放行 → 會打 Notion search
  });
});

describe("reuseOrRefreshPacket — TTL", () => {
  it("returns the packet when not expired", async () => {
    getLatestContextPacketForProjectMock.mockResolvedValue({
      id: 9, projectId: 7, teamId: null, userId: OWNER, scope: "project",
      summaryMarkdown: "x", sourceRefsJson: [], tokenEstimate: 1, createdByModel: null,
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    });
    const view = await reuseOrRefreshPacket({ userId: OWNER, projectId: 7 });
    expect(view?.reused).toBe(true);
  });

  it("returns null when expired", async () => {
    getLatestContextPacketForProjectMock.mockResolvedValue({
      id: 9, projectId: 7, teamId: null, userId: OWNER, scope: "project",
      summaryMarkdown: "x", sourceRefsJson: [], tokenEstimate: 1, createdByModel: null,
      expiresAt: new Date(Date.now() - 1000), createdAt: new Date(),
    });
    expect(await reuseOrRefreshPacket({ userId: OWNER, projectId: 7 })).toBeNull();
  });

  it("returns null when the packet belongs to another user", async () => {
    getLatestContextPacketForProjectMock.mockResolvedValue({
      id: 9, projectId: 7, teamId: null, userId: 999, scope: "project",
      summaryMarkdown: "x", sourceRefsJson: [], tokenEstimate: 1, createdByModel: null,
      expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(),
    });
    expect(await reuseOrRefreshPacket({ userId: OWNER, projectId: 7 })).toBeNull();
  });
});
