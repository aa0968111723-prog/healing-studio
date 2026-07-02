/**
 * creator-dashboard-router.test.ts — AIDV-277 creatorDashboard router 資料接線層測試
 *
 * 純函式層已由 creator-dashboard-quota.test.ts 錨定；本檔補 router 層
 * （ctx.user.id 為界的資料接線）防護，比照 history-db-error.test.ts 的
 * mock-db 風格：
 *   (a) quotaStatus 的兩個查詢 where 條件都綁 ctx.user.id（擁有權過濾）
 *   (b) sumCostThisMonth 只累計 eventType='video_generated' 事件
 *   (c) unlimited 方案 → quotaLimit=null / remaining=null / alertActive=false
 *       （Infinity 不可 JSON 序列化，必須回 null）
 *   (d) db 不可用（getDb 回 null）→ 用量回 0，不 throw
 *   (e) cancelled 的 pro 訂閱 → 顯示 free 配額（鏡像 isPaidPlan 語意）
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getDb: vi.fn(),
  getUserSubscription: vi.fn(),
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));

import * as dbMod from "./db";
import { appRouter } from "./routers";

const USER_ID = 42;

function ctx() {
  return { user: { id: USER_ID, email: "creator@test.com" }, req: {} as never, res: {} as never };
}

const caller = appRouter.createCaller(ctx());

/** 遞迴收集 drizzle SQL 條件樹裡所有綁定參數值（Param 節點 = { value, encoder }）。 */
function collectParams(node: unknown, out: unknown[] = [], seen = new Set<object>()): unknown[] {
  if (!node || typeof node !== "object") return out;
  const obj = node as Record<string, unknown>;
  if (seen.has(obj)) return out;
  seen.add(obj);
  if ("value" in obj && "encoder" in obj) out.push(obj.value);
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) v.forEach(item => collectParams(item, out, seen));
    else if (v && typeof v === "object") collectParams(v, out, seen);
  }
  return out;
}

/** 假 drizzle db：捕捉每個查詢的 where 條件，回固定 rows。 */
function makeFakeDb(capturedWheres: unknown[], rows: Array<Record<string, unknown>> = []) {
  return {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          capturedWheres.push(cond);
          return Promise.resolve(rows.length ? rows : [{ total: 0 }]);
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.mocked(dbMod.getDb).mockReset();
  vi.mocked(dbMod.getUserSubscription).mockReset();
});

describe("creatorDashboard.quotaStatus — 資料接線層 (AIDV-277)", () => {
  it("兩個用量查詢的 where 條件都綁 ctx.user.id（擁有權過濾）", async () => {
    const wheres: unknown[] = [];
    vi.mocked(dbMod.getDb).mockResolvedValue(makeFakeDb(wheres, [{ total: 2 }]) as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue({ planId: "free", status: "active" });

    await caller.creatorDashboard.quotaStatus();

    expect(wheres.length).toBe(2); // countVideosThisMonth + sumCostThisMonth
    for (const cond of wheres) {
      const params = collectParams(cond);
      expect(params).toContain(USER_ID);
    }
  });

  it("成本查詢只累計 eventType='video_generated'（其一 where 綁該參數）", async () => {
    const wheres: unknown[] = [];
    vi.mocked(dbMod.getDb).mockResolvedValue(makeFakeDb(wheres) as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue(null);

    await caller.creatorDashboard.quotaStatus();

    const allParams = wheres.map(w => collectParams(w));
    const sumWheres = allParams.filter(p => p.includes("video_generated"));
    expect(sumWheres.length).toBe(1);
    // 該查詢同時綁 userId（不是全表加總）
    expect(sumWheres[0]).toContain(USER_ID);
  });

  it("unlimited 方案 → quotaLimit/remaining 回 null（非 Infinity）、alertActive=false", async () => {
    vi.mocked(dbMod.getDb).mockResolvedValue(makeFakeDb([], [{ total: 500 }]) as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue({
      planId: "enterprise",
      status: "active",
    });

    const r = await caller.creatorDashboard.quotaStatus();

    expect(r.plan).toBe("unlimited");
    expect(r.currentMonth.isUnlimited).toBe(true);
    expect(r.currentMonth.quotaLimit).toBeNull();
    expect(r.currentMonth.remaining).toBeNull();
    expect(r.alertActive).toBe(false);
    // 整包可 JSON 序列化（無 Infinity 洩出）
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(JSON.stringify(r)).not.toContain("Infinity");
  });

  it("db 不可用（getDb=null）→ 用量回 0、不 throw", async () => {
    vi.mocked(dbMod.getDb).mockResolvedValue(null as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue(null);

    const r = await caller.creatorDashboard.quotaStatus();

    expect(r.currentMonth.videosGenerated).toBe(0);
    expect(r.currentMonth.costUsdSoFar).toBe(0);
    expect(r.plan).toBe("free");
  });

  it("cancelled 的 pro 訂閱 → 顯示 free 配額（鏡像 isPaidPlan 的 status 語意）", async () => {
    vi.mocked(dbMod.getDb).mockResolvedValue(makeFakeDb([], [{ total: 1 }]) as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue({
      planId: "pro",
      status: "cancelled",
    });

    const r = await caller.creatorDashboard.quotaStatus();

    expect(r.plan).toBe("free");
    expect(r.currentMonth.quotaLimit).toBe(5);
  });

  it("active 的 premium 訂閱 → pro 層級配額（不誤降為 free）", async () => {
    vi.mocked(dbMod.getDb).mockResolvedValue(makeFakeDb([], [{ total: 1 }]) as never);
    vi.mocked(dbMod.getUserSubscription).mockResolvedValue({
      planId: "premium",
      status: "active",
    });

    const r = await caller.creatorDashboard.quotaStatus();

    expect(r.plan).toBe("pro");
    expect(r.currentMonth.quotaLimit).toBe(100);
  });

  it("未登入（ctx.user 缺）→ UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller({
      user: null,
      req: {} as never,
      res: {} as never,
    } as never);
    await expect(anon.creatorDashboard.quotaStatus()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
