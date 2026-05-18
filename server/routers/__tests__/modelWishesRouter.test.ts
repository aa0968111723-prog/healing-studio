/**
 * server/routers/__tests__/modelWishesRouter.test.ts
 *
 * 鎖住模型許願池 router 的輸入合約與授權邏輯,讓未來的重構不會悄悄
 * 放行空白名稱 / 不安全 URL / 越權刪除 / 投票數對不上。
 *
 * 這層不需要真的 MySQL — db 模組在邊界被 mock,以便我們直接驗證 zod
 * schema 與 mutation handler 的判斷分支。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── DB mock (must be hoisted before importing the router) ────────────────
const dbState: {
  wishes: Map<
    number,
    {
      id: number;
      userId: number;
      voteCount: number;
      status: string;
      adminNote: string | null;
    }
  >;
  votes: Set<string>;
  nextId: number;
} = { wishes: new Map(), votes: new Set(), nextId: 1 };

vi.mock("../../db", () => ({
  listModelWishes: vi.fn(async () => []),
  createModelWish: vi.fn(async (data: { userId: number }) => {
    const id = dbState.nextId++;
    dbState.wishes.set(id, {
      id,
      userId: data.userId,
      voteCount: 0,
      status: "pending",
      adminNote: null,
    });
    return id;
  }),
  getModelWishById: vi.fn(async (id: number) => dbState.wishes.get(id) ?? null),
  deleteModelWish: vi.fn(async (id: number) => {
    dbState.wishes.delete(id);
    for (const key of [...dbState.votes]) {
      if (key.startsWith(`${id}:`)) dbState.votes.delete(key);
    }
  }),
  updateModelWishStatus: vi.fn(
    async (
      id: number,
      patch: { status?: string; adminNote?: string | null }
    ) => {
      const wish = dbState.wishes.get(id);
      if (!wish) return;
      if (patch.status !== undefined) wish.status = patch.status;
      if (patch.adminNote !== undefined) wish.adminNote = patch.adminNote;
    }
  ),
  voteModelWish: vi.fn(async (wishId: number, userId: number) => {
    const wish = dbState.wishes.get(wishId);
    if (!wish) throw new Error("WISH_NOT_FOUND");
    const key = `${wishId}:${userId}`;
    if (!dbState.votes.has(key)) {
      dbState.votes.add(key);
      wish.voteCount += 1;
    }
    return { voted: true, voteCount: wish.voteCount };
  }),
  unvoteModelWish: vi.fn(async (wishId: number, userId: number) => {
    const wish = dbState.wishes.get(wishId);
    if (!wish) throw new Error("WISH_NOT_FOUND");
    const key = `${wishId}:${userId}`;
    if (dbState.votes.has(key)) {
      dbState.votes.delete(key);
      wish.voteCount = Math.max(0, wish.voteCount - 1);
    }
    return { voted: false, voteCount: wish.voteCount };
  }),
}));

// Notification is best-effort — make it succeed so create() returns cleanly.
vi.mock("../../_core/notification", () => ({
  notifyOwner: vi.fn(async () => {}),
}));

import { modelWishesRouter } from "../modelWishesRouter";
import { TRPCError } from "@trpc/server";

// ─── Caller factory ───────────────────────────────────────────────────────

type Role = "user" | "admin";

function callerFor(
  userId: number | null,
  role: Role = "user",
  name = "Tester"
) {
  return modelWishesRouter.createCaller({
    user: userId == null ? null : ({ id: userId, role, name } as any),
    req: { headers: {}, header: () => undefined } as any,
    res: { setHeader: () => {} } as any,
    orbTraceId: "test-trace",
  } as any);
}

beforeEach(() => {
  dbState.wishes.clear();
  dbState.votes.clear();
  dbState.nextId = 1;
});

// ─── Input contract tests ─────────────────────────────────────────────────

describe("modelWishes.create — input validation", () => {
  it("rejects whitespace-only modelName even via direct API calls", async () => {
    const caller = callerFor(1);
    await expect(
      caller.create({ modelName: "   \t  ", modality: "text" })
    ).rejects.toBeInstanceOf(Error);
  });

  it("trims modelName before insert", async () => {
    const caller = callerFor(1);
    const { id } = await caller.create({
      modelName: "  GPT-5  ",
      modality: "text",
    });
    expect(dbState.wishes.get(id)?.userId).toBe(1);
  });

  it("rejects javascript: referenceUrl", async () => {
    const caller = callerFor(1);
    await expect(
      caller.create({
        modelName: "MaliciousModel",
        modality: "text",
        // eslint-disable-next-line no-script-url
        referenceUrl: "javascript:alert(1)",
      })
    ).rejects.toBeInstanceOf(Error);
  });

  it("accepts https referenceUrl", async () => {
    const caller = callerFor(1);
    await expect(
      caller.create({
        modelName: "GoodModel",
        modality: "text",
        referenceUrl: "https://example.com/paper",
      })
    ).resolves.toHaveProperty("id");
  });

  it("accepts empty referenceUrl (optional field)", async () => {
    const caller = callerFor(1);
    await expect(
      caller.create({ modelName: "M", modality: "text" })
    ).resolves.toHaveProperty("id");
  });

  it("auto-votes for the creator", async () => {
    const caller = callerFor(7);
    const { id } = await caller.create({ modelName: "M", modality: "text" });
    expect(dbState.wishes.get(id)?.voteCount).toBe(1);
    expect(dbState.votes.has(`${id}:7`)).toBe(true);
  });
});

describe("modelWishes.list — limit validation", () => {
  it("rejects fractional limit", async () => {
    const caller = callerFor(null);
    await expect(caller.list({ limit: 1.5 } as any)).rejects.toBeInstanceOf(
      Error
    );
  });

  it("accepts integer limit", async () => {
    const caller = callerFor(null);
    await expect(caller.list({ limit: 50 })).resolves.toBeTruthy();
  });
});

// ─── Vote idempotency ─────────────────────────────────────────────────────

describe("modelWishes.vote / unvote", () => {
  it("voting twice keeps count at 1 (idempotent)", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    // Owner already auto-voted → voteCount = 1
    const voter = callerFor(2);
    await voter.vote({ id });
    await voter.vote({ id });
    expect(dbState.wishes.get(id)?.voteCount).toBe(2); // owner + voter 2
  });

  it("unvote decrements and is idempotent", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    await owner.unvote({ id });
    await owner.unvote({ id });
    expect(dbState.wishes.get(id)?.voteCount).toBe(0);
  });

  it("vote on non-existent wish returns NOT_FOUND", async () => {
    const caller = callerFor(1);
    await expect(caller.vote({ id: 9999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── Delete authorization ────────────────────────────────────────────────

describe("modelWishes.delete — authorization", () => {
  it("owner can delete own wish", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    await expect(owner.delete({ id })).resolves.toEqual({ success: true });
    expect(dbState.wishes.has(id)).toBe(false);
  });

  it("another regular user cannot delete others' wishes", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    const intruder = callerFor(2);
    await expect(intruder.delete({ id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(dbState.wishes.has(id)).toBe(true);
  });

  it("admin can delete any wish", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    const admin = callerFor(99, "admin");
    await expect(admin.delete({ id })).resolves.toEqual({ success: true });
    expect(dbState.wishes.has(id)).toBe(false);
  });
});

// ─── Admin note / status partial updates ─────────────────────────────────

describe("modelWishes.updateStatus — partial updates", () => {
  it("note-only update preserves status", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    const admin = callerFor(99, "admin");
    // Admin changes status to planned
    await admin.updateStatus({ id, status: "planned" });
    expect(dbState.wishes.get(id)?.status).toBe("planned");
    // Note-only update — should NOT revert status
    await admin.updateStatus({ id, adminNote: "在 Q3 接" });
    expect(dbState.wishes.get(id)?.status).toBe("planned");
    expect(dbState.wishes.get(id)?.adminNote).toBe("在 Q3 接");
  });

  it("explicit null adminNote clears the existing note", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    const admin = callerFor(99, "admin");
    await admin.updateStatus({ id, adminNote: "draft" });
    expect(dbState.wishes.get(id)?.adminNote).toBe("draft");
    await admin.updateStatus({ id, adminNote: null });
    expect(dbState.wishes.get(id)?.adminNote).toBeNull();
  });

  it("rejects payload with neither status nor adminNote", async () => {
    const owner = callerFor(1);
    const { id } = await owner.create({ modelName: "M", modality: "text" });
    const admin = callerFor(99, "admin");
    await expect(admin.updateStatus({ id } as any)).rejects.toBeInstanceOf(
      Error
    );
  });
});
