// @vitest-environment node
/**
 * AIDV-253: video-project-lifecycle.test.ts
 *
 * 驗收：
 *   ✅ duplicate → 複製來源專案屬性，回傳新 id（不同於 sourceId）
 *   ✅ duplicate → 非擁有者嘗試複製 → FORBIDDEN
 *   ✅ listSnapshots → 列出屬於指定專案的快照，照時間倒序
 *   ✅ listSnapshots → 非擁有者 → FORBIDDEN
 *   ✅ restoreSnapshot → 覆寫專案，先寫 pre-restore 快照
 *   ✅ restoreSnapshot → 快照屬於別的專案 → NOT_FOUND
 *   ✅ save → 成功後寫入 auto 快照
 *   ✅ save → 版本衝突 → CONFLICT
 *   ✅ save → 非擁有者 → FORBIDDEN
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetVideoProject = vi.fn();
const mockUpdateVideoProject = vi.fn();
const mockDuplicateVideoProject = vi.fn();
const mockListProjectSnapshots = vi.fn();
const mockGetProjectSnapshot = vi.fn();
const mockCreateProjectSnapshot = vi.fn();

vi.mock("../server/db", () => ({
  getVideoProject: (...a: any[]) => mockGetVideoProject(...a),
  updateVideoProject: (...a: any[]) => mockUpdateVideoProject(...a),
  duplicateVideoProject: (...a: any[]) => mockDuplicateVideoProject(...a),
  listProjectSnapshots: (...a: any[]) => mockListProjectSnapshots(...a),
  getProjectSnapshot: (...a: any[]) => mockGetProjectSnapshot(...a),
  createProjectSnapshot: (...a: any[]) => mockCreateProjectSnapshot(...a),
  getVideoProjectsByUser: vi.fn().mockResolvedValue([]),
  createVideoProject: vi.fn(),
}));

// Import the router after mocks
const { videoProjectRouter } = await import("./routers/videoProject");

function makeCaller(userId: number) {
  return videoProjectRouter.createCaller({
    user: { id: userId, openId: "test", role: "user", email: null, name: null },
    req: { cookies: {}, headers: {} } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  });
}

const USER_A = 1;
const USER_B = 2;

const baseProject = {
  id: 10,
  userId: USER_A,
  title: "測試影片",
  aspectRatio: "16:9" as const,
  version: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
  creativeProjectId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateProjectSnapshot.mockResolvedValue(99);
  mockUpdateVideoProject.mockResolvedValue({ updated: true });
});

// ── duplicate ─────────────────────────────────────────────────────────────────

describe("videoProject.duplicate", () => {
  it("複製成功：回傳新 id（不同於 sourceId）", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject);
    mockDuplicateVideoProject.mockResolvedValueOnce(55);

    const caller = makeCaller(USER_A);
    const result = await caller.duplicate({ sourceId: 10 });

    expect(result.id).toBe(55);
    expect(mockDuplicateVideoProject).toHaveBeenCalledWith(10, USER_A, undefined);
  });

  it("非擁有者嘗試複製 → FORBIDDEN", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject); // owned by USER_A

    const caller = makeCaller(USER_B);
    await expect(caller.duplicate({ sourceId: 10 })).rejects.toThrow(TRPCError);
  });

  it("來源不存在 → NOT_FOUND", async () => {
    mockGetVideoProject.mockResolvedValueOnce(null);

    const caller = makeCaller(USER_A);
    await expect(caller.duplicate({ sourceId: 999 })).rejects.toThrow(TRPCError);
  });
});

// ── listSnapshots ─────────────────────────────────────────────────────────────

describe("videoProject.listSnapshots", () => {
  it("回傳快照列表（照倒序）", async () => {
    const snapshots = [
      { id: 2, projectId: 10, snapshot: { title: "v2" }, source: "auto", createdAt: new Date() },
      { id: 1, projectId: 10, snapshot: { title: "v1" }, source: "auto", createdAt: new Date(0) },
    ];
    mockGetVideoProject.mockResolvedValueOnce(baseProject);
    mockListProjectSnapshots.mockResolvedValueOnce(snapshots);

    const caller = makeCaller(USER_A);
    const result = await caller.listSnapshots({ projectId: 10 });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(2);
  });

  it("非擁有者 → FORBIDDEN", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject);

    const caller = makeCaller(USER_B);
    await expect(caller.listSnapshots({ projectId: 10 })).rejects.toThrow(TRPCError);
  });
});

// ── restoreSnapshot ───────────────────────────────────────────────────────────

describe("videoProject.restoreSnapshot", () => {
  it("回溯成功：先存 pre-restore 快照，再覆寫", async () => {
    const snap = { id: 5, projectId: 10, snapshot: { title: "old" }, source: "auto", createdAt: new Date() };
    mockGetVideoProject
      .mockResolvedValueOnce(baseProject)
      .mockResolvedValueOnce({ ...baseProject, version: 4 });
    mockGetProjectSnapshot.mockResolvedValueOnce(snap);

    const caller = makeCaller(USER_A);
    const result = await caller.restoreSnapshot({ projectId: 10, snapshotId: 5 });

    expect(result.ok).toBe(true);
    expect(mockCreateProjectSnapshot).toHaveBeenCalledWith(10, {}, "pre-restore");
    expect(mockUpdateVideoProject).toHaveBeenCalledWith(10, { title: "old" });
  });

  it("快照屬於別的專案 → NOT_FOUND", async () => {
    const snap = { id: 5, projectId: 999, snapshot: {}, source: "auto", createdAt: new Date() };
    mockGetVideoProject.mockResolvedValueOnce(baseProject);
    mockGetProjectSnapshot.mockResolvedValueOnce(snap);

    const caller = makeCaller(USER_A);
    await expect(caller.restoreSnapshot({ projectId: 10, snapshotId: 5 })).rejects.toThrow(TRPCError);
  });
});

// ── save ──────────────────────────────────────────────────────────────────────

describe("videoProject.save", () => {
  it("成功後寫入 auto 快照（當 snapshotData 提供時）", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject);
    mockUpdateVideoProject.mockResolvedValueOnce({ updated: true });

    const caller = makeCaller(USER_A);
    const result = await caller.save({
      id: 10,
      title: "新標題",
      expectedVersion: 3,
      snapshotData: { title: "新標題" },
    });

    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(mockCreateProjectSnapshot).toHaveBeenCalledWith(10, { title: "新標題" }, "auto"));
  });

  it("版本衝突 → CONFLICT", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject);
    mockUpdateVideoProject.mockResolvedValueOnce({ updated: false });

    const caller = makeCaller(USER_A);
    await expect(
      caller.save({ id: 10, title: "新標題", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("非擁有者 → FORBIDDEN", async () => {
    mockGetVideoProject.mockResolvedValueOnce(baseProject);

    const caller = makeCaller(USER_B);
    await expect(caller.save({ id: 10, title: "x" })).rejects.toThrow(TRPCError);
  });
});
