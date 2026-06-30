/**
 * AIDV-881: feedback.create screenshotKey 擁有權驗證（IDOR write 防護）。
 *
 * 以真實 appRouter.createCaller 跑實際 procedure（非模擬邏輯），證明：
 * 使用者把「他人命名空間」或「路徑穿越」的 screenshotKey 連結到自己的回饋
 * → FORBIDDEN 且不寫庫；合法（自己 `uploads/<userId>/...`）或未帶 key → 正常寫庫。
 *
 * 合法 screenshotKey 一律由 client uploadFileToS3 回傳的 fileKey 提供，格式恆為
 * `uploads/<userId>/<safeName>-<nanoid>.<ext>`（server/signedUpload.ts buildScopedKey），
 * 故守門對既有使用者零行為變化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const fbMock = vi.hoisted(() => ({ inserts: 0 }));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createFeedbackReport: async () => {
      fbMock.inserts++;
      return 1;
    },
  };
});

// rate limit 不是本卡重點；固定放行，避免跨案例的桶狀態互相影響。
vi.mock("./_core/rateLimiter", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/rateLimiter")>();
  return { ...actual, tryConsumeFeedbackToken: () => true };
});

// notifyOwner 為 best-effort 副作用；測試中設為 no-op。
vi.mock("./_core/notification", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/notification")>();
  return { ...actual, notifyOwner: async () => {} };
});

import { appRouter } from "./routers";

function ctxFor(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `u${userId}`,
      email: "t@example.com",
      name: "T",
      loginMethod: "manus",
      role: "user",
      remainingGenerations: 9,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const BASE = { title: "測試回饋", description: "內容", category: "bug" as const };

describe("feedback.create screenshotKey ownership (AIDV-881)", () => {
  beforeEach(() => {
    fbMock.inserts = 0;
  });

  it("擁有者自己命名空間的 key（uploads/<self>/…）→ 正常寫庫", async () => {
    const res = await appRouter
      .createCaller(ctxFor(100))
      .feedback.create({ ...BASE, screenshotKey: "uploads/100/feedback-1700-ab12cd34.png" });
    expect(res).toMatchObject({ id: 1 });
    expect(fbMock.inserts).toBe(1);
  });

  it("他人命名空間的 key（uploads/<other>/…）→ FORBIDDEN 且不寫庫（IDOR 防護）", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(100))
        .feedback.create({ ...BASE, screenshotKey: "uploads/999/secret.png" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fbMock.inserts).toBe(0);
  });

  it("路徑穿越（uploads/<self>/../<other>/…）→ FORBIDDEN 且不寫庫", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(100))
        .feedback.create({ ...BASE, screenshotKey: "uploads/100/../999/secret.png" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fbMock.inserts).toBe(0);
  });

  it("非 uploads 前綴的任意 key（screenshots/100/…）→ FORBIDDEN（先前幻覺前綴）", async () => {
    await expect(
      appRouter
        .createCaller(ctxFor(100))
        .feedback.create({ ...BASE, screenshotKey: "screenshots/100/x.png" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fbMock.inserts).toBe(0);
  });

  it("未帶 screenshotKey → 正常寫庫（optional 欄位）", async () => {
    const res = await appRouter.createCaller(ctxFor(100)).feedback.create({ ...BASE });
    expect(res).toMatchObject({ id: 1 });
    expect(fbMock.inserts).toBe(1);
  });
});
