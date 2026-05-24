/**
 * project-context-summary.test.ts — M1-A Active Project Context
 *
 * 直接測 projectContextService.getProjectContextSummary，用 vi.mock 攔 ./db
 * 的三個 helper 注入確定性資料。重點：
 *   1. 擁有者可拿到完整摘要形狀（含世界觀 / 最近素材 / pendingSections）
 *   2. 非擁有者 → forbidden；找不到 → not_found（權限檢查）
 *   3. 別人的世界觀框架不會被採用
 *   4. 最近素材正確映射且 thumbnail 為 optional
 *   5. 不呼叫任何外部 API（service 只依賴注入的 db helper）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getCreativeProjectMock = vi.fn();
const getWorldbuildingFrameworkMock = vi.fn();
const getDigitalAssetsByUserMock = vi.fn();
const getOrchestrationRunsByProjectMock = vi.fn();
const reuseOrRefreshPacketMock = vi.fn();

vi.mock("./db", () => ({
  getCreativeProject: (...args: unknown[]) => getCreativeProjectMock(...args),
  getWorldbuildingFramework: (...args: unknown[]) =>
    getWorldbuildingFrameworkMock(...args),
  getDigitalAssetsByUser: (...args: unknown[]) =>
    getDigitalAssetsByUserMock(...args),
  getOrchestrationRunsByProject: (...args: unknown[]) =>
    getOrchestrationRunsByProjectMock(...args),
}));

vi.mock("./subsystems/contextPackets/contextPacketService", () => ({
  reuseOrRefreshPacket: (...args: unknown[]) => reuseOrRefreshPacketMock(...args),
}));

import { getProjectContextSummary } from "./subsystems/projectContext/projectContextService";
import { ProjectContextAccessError } from "./subsystems/projectContext/contracts";

const OWNER = 42;
const baseProject = {
  id: 7,
  userId: OWNER,
  title: "禪修短片企劃",
  description: "  一支關於呼吸與放下的短片  ",
  status: "production" as const,
  worldFrameworkId: null as number | null,
  worldStoryboardId: null,
  directorSessionId: null,
  worldviewId: null,
  scriptId: null,
  coverImageUrl: null,
  tags: [],
  metadata: null,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  updatedAt: new Date("2026-05-20T08:30:00.000Z"),
};

beforeEach(() => {
  getCreativeProjectMock.mockReset();
  getWorldbuildingFrameworkMock.mockReset();
  getDigitalAssetsByUserMock.mockReset();
  getOrchestrationRunsByProjectMock.mockReset();
  reuseOrRefreshPacketMock.mockReset();
  getDigitalAssetsByUserMock.mockResolvedValue([]);
  getWorldbuildingFrameworkMock.mockResolvedValue(null);
  getOrchestrationRunsByProjectMock.mockResolvedValue([]);
  // 預設沒有已編譯的 context packet（團隊資料尚未整理）。
  reuseOrRefreshPacketMock.mockResolvedValue(null);
});

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: OWNER,
    projectId: 7,
    teamId: null,
    mode: "director",
    intent: "分鏡這場戲",
    status: "pending",
    commander: null,
    planJson: null,
    contextPacketIdsJson: null,
    toolCallsJson: null,
    citationsJson: null,
    searchResultsJson: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    errorMessage: null,
    createdAt: new Date("2026-05-22T00:00:00.000Z"),
    updatedAt: new Date("2026-05-22T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getProjectContextSummary — shape & happy path", () => {
  it("returns the M1-A summary shape for the project owner", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    expect(summary.projectId).toBe(7);
    expect(summary.title).toBe("禪修短片企劃");
    expect(summary.status).toBe("production");
    // description is trimmed via snippet()
    expect(summary.description).toBe("一支關於呼吸與放下的短片");
    expect(summary.updatedAt).toBe("2026-05-20T08:30:00.000Z");
    expect(summary.recentAssets).toEqual([]);
    expect(summary.recentAssetsScope).toBe("user");
    expect(summary.openTasks).toEqual([]);
    // M1-A leaves these for later milestones but keeps the structure explicit.
    expect(summary.pendingSections).toContain("teamData");
    expect(summary.pendingSections).toContain("budget");
    expect(summary.pendingSections).toContain("projectScopedAssets");
    expect(summary.budget).toBeUndefined();
    expect(summary.worldview).toBeUndefined();
  });

  it("does not query worldbuilding when no framework is linked", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    await getProjectContextSummary(OWNER, baseProject.id);
    expect(getWorldbuildingFrameworkMock).not.toHaveBeenCalled();
  });
});

describe("getProjectContextSummary — permission", () => {
  it("throws forbidden when the project belongs to another user", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject, userId: 999 });

    await expect(
      getProjectContextSummary(OWNER, baseProject.id),
    ).rejects.toMatchObject({ reason: "forbidden" });
    await expect(
      getProjectContextSummary(OWNER, baseProject.id),
    ).rejects.toBeInstanceOf(ProjectContextAccessError);
  });

  it("throws not_found when the project does not exist", async () => {
    getCreativeProjectMock.mockResolvedValue(null);

    await expect(
      getProjectContextSummary(OWNER, 12345),
    ).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("getProjectContextSummary — worldview", () => {
  it("builds worldview & styleBible from a framework owned by the same user", async () => {
    getCreativeProjectMock.mockResolvedValue({
      ...baseProject,
      worldFrameworkId: 11,
    });
    getWorldbuildingFrameworkMock.mockResolvedValue({
      id: 11,
      userId: OWNER,
      name: "禪修世界觀 v1",
      description: "以森林與晨霧為核心的療癒世界。",
      genre: "療癒",
      era: "近未來",
      styleProfilesJson: [{ id: "a" }, { id: "b" }],
      defaultStyleProfileId: "a",
      globalNegativePrompt: "no text, no watermark",
    });

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    expect(summary.worldview).toContain("禪修世界觀 v1");
    expect(summary.worldview).toContain("療癒");
    expect(summary.worldview).toContain("近未來");
    expect(summary.styleBible).toContain("2 個風格設定檔");
    expect(summary.styleBible).toContain("全域負向提示");
  });

  it("ignores a framework that belongs to a different user", async () => {
    getCreativeProjectMock.mockResolvedValue({
      ...baseProject,
      worldFrameworkId: 11,
    });
    getWorldbuildingFrameworkMock.mockResolvedValue({
      id: 11,
      userId: 999,
      name: "別人的世界觀",
      description: null,
      genre: null,
      era: null,
      styleProfilesJson: null,
      defaultStyleProfileId: null,
      globalNegativePrompt: null,
    });

    const summary = await getProjectContextSummary(OWNER, baseProject.id);
    expect(summary.worldview).toBeUndefined();
    expect(summary.styleBible).toBeUndefined();
  });
});

describe("getProjectContextSummary — recent assets", () => {
  it("maps recent user assets and keeps thumbnailUrl optional", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    getDigitalAssetsByUserMock.mockResolvedValue([
      {
        id: 101,
        title: "晨霧 keyframe",
        assetType: "image",
        thumbnailUrl: "https://cdn.example/thumb.jpg",
        createdAt: new Date("2026-05-19T00:00:00.000Z"),
      },
      {
        id: 102,
        title: "旁白草稿",
        assetType: "voice",
        thumbnailUrl: null,
        createdAt: "2026-05-18T00:00:00.000Z",
      },
    ]);

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    expect(getDigitalAssetsByUserMock).toHaveBeenCalledWith(OWNER, 6);
    expect(summary.recentAssets).toHaveLength(2);
    expect(summary.recentAssets[0]).toMatchObject({
      id: 101,
      title: "晨霧 keyframe",
      assetType: "image",
      thumbnailUrl: "https://cdn.example/thumb.jpg",
    });
    expect(summary.recentAssets[1].thumbnailUrl).toBeUndefined();
    expect(summary.recentAssets[1].createdAt).toBe("2026-05-18T00:00:00.000Z");
  });
});

describe("getProjectContextSummary — open tasks from orchestration runs (M1-B)", () => {
  it("maps non-terminal runs to openTasks and drops openTasks from pendingSections", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    getOrchestrationRunsByProjectMock.mockResolvedValue([
      runRow({ id: 9, status: "running", mode: "video", estimatedCostUsd: "1.250000" }),
      runRow({ id: 8, status: "pending", mode: "director", estimatedCostUsd: null }),
    ]);

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    expect(getOrchestrationRunsByProjectMock).toHaveBeenCalledWith(baseProject.id, 50);
    expect(summary.openTasks).toHaveLength(2);
    expect(summary.openTasks[0]).toEqual({
      id: "9",
      title: "分鏡這場戲",
      status: "running",
      mode: "video",
      estimatedCostUsd: 1.25,
      createdAt: "2026-05-22T00:00:00.000Z",
    });
    expect(summary.openTasks[1].estimatedCostUsd).toBeNull();
    // openTasks is now implemented, so it must not be advertised as pending.
    expect(summary.pendingSections).not.toContain("openTasks");
  });

  it("filters out completed and cancelled runs", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    getOrchestrationRunsByProjectMock.mockResolvedValue([
      runRow({ id: 3, status: "completed" }),
      runRow({ id: 2, status: "cancelled" }),
      runRow({ id: 1, status: "failed" }),
    ]);

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    // failed stays open (needs a retry decision); completed / cancelled are gone.
    expect(summary.openTasks.map(t => t.id)).toEqual(["1"]);
  });

  it("caps openTasks at 8 even when more are open", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    getOrchestrationRunsByProjectMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => runRow({ id: i + 1, status: "pending" })),
    );

    const summary = await getProjectContextSummary(OWNER, baseProject.id);
    expect(summary.openTasks).toHaveLength(8);
  });
});

describe("getProjectContextSummary — team data from context packet (M4)", () => {
  it("fills teamDataSummary + sourcesUsed and drops teamData from pendingSections when a packet exists", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    reuseOrRefreshPacketMock.mockResolvedValue({
      id: 1,
      projectId: baseProject.id,
      teamId: null,
      scope: "project",
      summaryMarkdown:
        "# 可用資料來源\n- 「呼吸引導稿」（team_data · summary_only）：吸氣四拍…",
      sourceRefs: [
        {
          kind: "team_data",
          refId: "101",
          title: "呼吸引導稿",
          accessLevel: "summary_only",
          snippet: "吸氣四拍…",
          connectionId: null,
          score: 0.8,
          matchedBy: "vector",
        },
      ],
      tokenEstimate: 20,
      createdByModel: null,
      expiresAt: "2999-01-01T00:00:00.000Z",
      createdAt: "2026-05-23T00:00:00.000Z",
      reused: true,
    });

    const summary = await getProjectContextSummary(OWNER, baseProject.id);

    expect(summary.teamDataSummary).toContain("可用資料來源");
    expect(summary.sourcesUsed).toHaveLength(1);
    expect(summary.sourcesUsed?.[0]).toMatchObject({
      kind: "team_data",
      refId: "101",
      accessLevel: "summary_only",
    });
    expect(summary.pendingSections).not.toContain("teamData");
    expect(summary.pendingSections).toContain("budget");
  });

  it("leaves teamData pending and summary unset when no packet exists", async () => {
    getCreativeProjectMock.mockResolvedValue({ ...baseProject });
    // reuseOrRefreshPacketMock defaults to null in beforeEach.
    const summary = await getProjectContextSummary(OWNER, baseProject.id);
    expect(summary.teamDataSummary).toBeUndefined();
    expect(summary.sourcesUsed).toBeUndefined();
    expect(summary.pendingSections).toContain("teamData");
  });
});
