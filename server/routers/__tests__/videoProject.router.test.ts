/**
 * videoProject.router.test.ts — AIDV-241 樂觀鎖 CAS 驗收測試
 *
 * 驗收條件：
 *   1. 無 expectedVersion → 直接成功（向下相容）
 *   2. expectedVersion 正確 → 更新成功
 *   3. expectedVersion 過期 → CONFLICT(409)
 *   4. 專案不存在 → NOT_FOUND
 *   5. 非本人 → FORBIDDEN
 *   6. list/get/create 回傳包含 version 欄位
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { videoProjectRouter } from "../videoProject";

vi.mock("../../db", () => ({
  createVideoProject: vi.fn(),
  getVideoProject: vi.fn(),
  getVideoProjectsByUser: vi.fn(),
  updateVideoProject: vi.fn(),
}));

import * as db from "../../db";

const ctx: any = { user: { id: 7 } };

const baseProject = {
  id: 55,
  userId: 7,
  creativeProjectId: null,
  title: "測試影片",
  aspectRatio: "16:9" as const,
  version: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("videoProjectRouter — 基本 CRUD", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create 回傳 id + version", async () => {
    (db.createVideoProject as any).mockResolvedValue(55);
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.create({ title: "測試影片" });
    expect(result.id).toBe(55);
    expect(result.version).toBe(2);
  });

  it("get 回傳 version", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.get({ id: 55 });
    expect(result.version).toBe(2);
  });

  it("list 回傳 version 欄位", async () => {
    (db.getVideoProjectsByUser as any).mockResolvedValue([baseProject]);

    const caller = videoProjectRouter.createCaller(ctx);
    const list = await caller.list();
    expect(list[0].version).toBe(2);
  });

  it("get 非本人 → FORBIDDEN", async () => {
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, userId: 99 });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(caller.get({ id: 55 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AIDV-241 樂觀鎖 — videoProject.update optimistic lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("無 expectedVersion → 無版本檢查，直接成功", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.update({ id: 55, title: "新標題" });
    expect(result.ok).toBe(true);
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ title: "新標題" }),
      { expectedVersion: undefined }
    );
  });

  it("expectedVersion 正確 → 更新成功", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: true });

    const caller = videoProjectRouter.createCaller(ctx);
    const result = await caller.update({ id: 55, aspectRatio: "9:16", expectedVersion: 2 });
    expect(result.ok).toBe(true);
    expect(db.updateVideoProject).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ aspectRatio: "9:16" }),
      { expectedVersion: 2 }
    );
  });

  it("expectedVersion 過期（version 不符）→ CONFLICT 409", async () => {
    (db.getVideoProject as any).mockResolvedValue(baseProject);
    (db.updateVideoProject as any).mockResolvedValue({ updated: false });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 55, title: "衝突更新", expectedVersion: 0 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("專案不存在 → NOT_FOUND", async () => {
    (db.getVideoProject as any).mockResolvedValue(null);

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 999, title: "X" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("非本人 → FORBIDDEN", async () => {
    (db.getVideoProject as any).mockResolvedValue({ ...baseProject, userId: 99 });

    const caller = videoProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 55, title: "X" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
