import { describe, it, expect, vi, beforeEach } from "vitest";
import { creativeProjectRouter } from "../creativeProject";

vi.mock("../../db", () => ({
  getCreativeProjectsByUser: vi.fn(),
  createCreativeProject: vi.fn(),
  getCreativeProject: vi.fn(),
  updateCreativeProject: vi.fn(),
  deleteCreativeProject: vi.fn(),
  getWorldbuildingFramework: vi.fn(),
}));

import * as db from "../../db";

const ctx: any = { user: { id: 42 } };

const baseProject = {
  id: 101,
  userId: 42,
  title: "P1",
  description: null,
  directorSessionId: null,
  worldFrameworkId: null,
  worldStoryboardId: null,
  worldviewId: null,
  scriptId: null,
  status: "concept",
  coverImageUrl: null,
  tags: [],
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 3,
};

describe("creativeProjectRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create/list/delete basic flow", async () => {
    (db.createCreativeProject as any).mockResolvedValue(101);
    (db.getCreativeProjectsByUser as any).mockResolvedValue([baseProject]);
    (db.getCreativeProject as any).mockResolvedValue({ id: 101, userId: 42 });

    const caller = creativeProjectRouter.createCaller(ctx);
    const created = await caller.create({ title: "P1" });
    expect(created.id).toBe(101);

    const list = await caller.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("P1");

    await caller.delete({ id: 101 });
    expect(db.deleteCreativeProject).toHaveBeenCalledWith(101);
  });
});

describe("AIDV-316 樂觀鎖 — creativeProject.update optimistic lock", () => {
  beforeEach(() => vi.clearAllMocks());

  it("無 expectedVersion → 無版本檢查，直接成功", async () => {
    (db.getCreativeProject as any).mockResolvedValue({ id: 101, userId: 42, version: 5 });
    (db.updateCreativeProject as any).mockResolvedValue({ updated: true });

    const caller = creativeProjectRouter.createCaller(ctx);
    const result = await caller.update({ id: 101, patch: { title: "新標題" } });
    expect(result.ok).toBe(true);
    expect(db.updateCreativeProject).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ title: "新標題" }),
      { expectedVersion: undefined }
    );
  });

  it("expectedVersion 正確 → 更新成功", async () => {
    (db.getCreativeProject as any).mockResolvedValue({ id: 101, userId: 42, version: 3 });
    (db.updateCreativeProject as any).mockResolvedValue({ updated: true });

    const caller = creativeProjectRouter.createCaller(ctx);
    const result = await caller.update({
      id: 101,
      patch: { status: "production" },
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
    expect(db.updateCreativeProject).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ status: "production" }),
      { expectedVersion: 3 }
    );
  });

  it("expectedVersion 過期（version 不符）→ 回傳 CONFLICT 409", async () => {
    (db.getCreativeProject as any).mockResolvedValue({ id: 101, userId: 42, version: 5 });
    (db.updateCreativeProject as any).mockResolvedValue({ updated: false });

    const caller = creativeProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 101, patch: { title: "衝突更新" }, expectedVersion: 3 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("專案不存在或非本人 → 回傳 NOT_FOUND", async () => {
    (db.getCreativeProject as any).mockResolvedValue(null);

    const caller = creativeProjectRouter.createCaller(ctx);
    await expect(
      caller.update({ id: 999, patch: { title: "X" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rowToData 包含 version 欄位", async () => {
    (db.getCreativeProjectsByUser as any).mockResolvedValue([baseProject]);
    const caller = creativeProjectRouter.createCaller(ctx);
    const list = await caller.list();
    expect(list[0].version).toBe(3);
  });
});
