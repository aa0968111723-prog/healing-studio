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

vi.mock("./db", () => ({
  getCreativeProject: (...args: unknown[]) => getCreativeProjectMock(...args),
  getWorldbuildingFramework: (...args: unknown[]) =>
    getWorldbuildingFrameworkMock(...args),
  getDigitalAssetsByUser: (...args: unknown[]) =>
    getDigitalAssetsByUserMock(...args),
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
  getDigitalAssetsByUserMock.mockResolvedValue([]);
  getWorldbuildingFrameworkMock.mockResolvedValue(null);
});

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
