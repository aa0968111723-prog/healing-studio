import { describe, it, expect, vi, beforeEach } from "vitest";
import { creativeProjectRouter } from "../creativeProject";

vi.mock("../../db", () => ({
  getCreativeProjectsByUser: vi.fn(),
  createCreativeProject: vi.fn(),
  getCreativeProject: vi.fn(),
  deleteCreativeProject: vi.fn(),
  getWorldbuildingFramework: vi.fn(),
}));

import * as db from "../../db";

const ctx: any = { user: { id: 42 } };

describe("creativeProjectRouter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create/list/delete basic flow", async () => {
    (db.createCreativeProject as any).mockResolvedValue(101);
    (db.getCreativeProjectsByUser as any).mockResolvedValue([
      {
        id: 101,
        userId: 42,
        title: "P1",
        description: null,
        directorSessionId: null,
        worldFrameworkId: null,
        worldStoryboardId: null,
        status: "concept",
        coverImageUrl: null,
        tags: [],
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
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
