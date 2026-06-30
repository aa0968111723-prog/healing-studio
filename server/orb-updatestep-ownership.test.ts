/**
 * AIDV-885: ai.orbTask.updateStepStatus 擁有權驗證（IDOR write 防護）。
 *
 * 以真實 appRouter.createCaller 跑實際 procedure（非模擬邏輯），證明：
 * 非擁有者對他人 taskId 更新步驟狀態 → NOT_FOUND 且不呼叫 step 變更；
 * 擁有者 / 無主(null userId) 任務 → 正常執行。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const orbMock = vi.hoisted(() => ({
  task: { userId: 100 } as { userId: number | null } | null,
  completeCalls: 0,
  failCalls: 0,
}));

vi.mock("./services/orbTaskStateMachine", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/orbTaskStateMachine")>();
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getOrbAgentTask: () => orbMock.task as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    completeOrbAgentStep: () => {
      orbMock.completeCalls++;
      return { ok: true } as any;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    failOrbAgentStep: () => {
      orbMock.failCalls++;
      return { ok: true } as any;
    },
  };
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

const INPUT = { taskId: "t1", stepId: "s1", status: "completed" as const };

describe("ai.orbTask.updateStepStatus ownership (AIDV-885)", () => {
  beforeEach(() => {
    orbMock.task = { userId: 100 };
    orbMock.completeCalls = 0;
    orbMock.failCalls = 0;
  });

  it("擁有者（userId 相符）→ 正常執行 completeOrbAgentStep", async () => {
    await appRouter.createCaller(ctxFor(100)).ai.orbTask.updateStepStatus(INPUT);
    expect(orbMock.completeCalls).toBe(1);
  });

  it("非擁有者（userId 不符）→ NOT_FOUND 且不呼叫 step 變更（IDOR 防護）", async () => {
    await expect(
      appRouter.createCaller(ctxFor(999)).ai.orbTask.updateStepStatus(INPUT)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(orbMock.completeCalls).toBe(0);
  });

  it("無主任務（userId=null）→ 放行", async () => {
    orbMock.task = { userId: null };
    await appRouter.createCaller(ctxFor(999)).ai.orbTask.updateStepStatus(INPUT);
    expect(orbMock.completeCalls).toBe(1);
  });
});
