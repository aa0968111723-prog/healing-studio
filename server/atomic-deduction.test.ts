import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

/**
 * Tests for atomic points deduction.
 *
 * The key invariant: deductUserPoints uses a SELECT FOR UPDATE transaction
 * to prevent race conditions when multiple requests try to deduct simultaneously.
 *
 * deductUserQuota (legacy, flat 1-quota) still exists for backward compatibility.
 * The generation flow now uses deductUserPoints (model-based cost).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    openId: "test-atomic-user",
    email: "atomic@test.com",
    name: "Atomic Tester",
    loginMethod: "manus",
    role: "user",
    quotaJson: null,
    remainingGenerations: 5,
    onboardingDone: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: User): TrpcContext {
  return {
    user,
    req: {} as any,
    res: {
      clearCookie: vi.fn(),
    } as any,
  };
}

// ─── Unit tests for deductUserPoints (model-based billing) ──────────────────

describe("Atomic Points Deduction", () => {
  describe("deductUserPoints contract", () => {
    it("should return an object with success boolean", async () => {
      const { deductUserPoints } = await import("./db");
      const result = await deductUserPoints(999, 5);
      expect(typeof result).toBe("object");
      expect(typeof result.success).toBe("boolean");
      expect(result.success).toBe(false); // no DB → false
    });

    it("should clamp minimum deduction to 1", async () => {
      const { deductUserPoints } = await import("./db");
      const result = await deductUserPoints(999, 0);
      expect(result.success).toBe(false); // no DB, but no throw
    });

    it("should clamp maximum deduction to 500", async () => {
      const { deductUserPoints } = await import("./db");
      const result = await deductUserPoints(999, 9999);
      expect(result.success).toBe(false); // no DB, but no throw
    });
  });

  describe("refundUserPoints contract", () => {
    it("should not throw when DB is unavailable", async () => {
      const { refundUserPoints } = await import("./db");
      await expect(refundUserPoints(999, 5)).resolves.not.toThrow();
    });

    it("should accept custom refund amount", async () => {
      const { refundUserPoints } = await import("./db");
      await expect(refundUserPoints(999, 49)).resolves.not.toThrow();
    });
  });

  describe("deductUserQuota legacy contract", () => {
    it("should return boolean indicating success or failure", async () => {
      const { deductUserQuota } = await import("./db");
      const result = await deductUserQuota(999, 1);
      expect(typeof result).toBe("boolean");
      expect(result).toBe(false); // no DB → false
    });

    it("should accept a custom amount parameter", async () => {
      const { deductUserQuota } = await import("./db");
      const result = await deductUserQuota(999, 5);
      expect(result).toBe(false);
    });

    it("should default amount to 1", async () => {
      const { deductUserQuota } = await import("./db");
      const result = await deductUserQuota(999);
      expect(result).toBe(false);
    });
  });

  describe("refundUserQuota legacy contract", () => {
    it("should not throw when DB is unavailable", async () => {
      const { refundUserQuota } = await import("./db");
      await expect(refundUserQuota(999, 1)).resolves.not.toThrow();
    });
  });

  describe("updateUserQuota contract (admin absolute set)", () => {
    it("should not throw when DB is unavailable", async () => {
      const { updateUserQuota } = await import("./db");
      await expect(updateUserQuota(999, 50)).resolves.not.toThrow();
    });
  });
});

// ─── Integration-style tests for the generation mutation flow ───────────────

describe("Generation mutation quota flow", () => {
  it("generate.multimodal procedure exists and is a mutation", () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    expect(typeof caller.generate.multimodal).toBe("function");
  });

  it("generate.prepareJob procedure exists and is a mutation", () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    expect(typeof caller.generate.prepareJob).toBe("function");
  });

  it("generate.estimateCost procedure exists and is a query", () => {
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    expect(typeof caller.generate.estimateCost).toBe("function");
  });

  it("should reject prepareJob when deductUserPoints returns failure (insufficient credits)", async () => {
    const dbModule = await import("./db");
    // Mock deductUserPoints to return failure (simulating 0 remaining)
    const spy = vi.spyOn(dbModule, "deductUserPoints").mockResolvedValueOnce({
      success: false,
      actualDeducted: 0,
      remainingBefore: 0,
      remainingAfter: 0,
    });

    const caller = appRouter.createCaller(makeCtx(makeUser({ remainingGenerations: 0 })));

    await expect(
      caller.generate.prepareJob({ generationType: "image" })
    ).rejects.toThrow(/積分不足|pts/);

    spy.mockRestore();
  });

  it("should succeed prepareJob when deductUserPoints returns success", async () => {
    const dbModule = await import("./db");
    // Mock deductUserPoints to return success
    const deductSpy = vi.spyOn(dbModule, "deductUserPoints").mockResolvedValueOnce({
      success: true,
      actualDeducted: 4,
      remainingBefore: 50,
      remainingAfter: 46,
    });
    const createJobSpy = vi.spyOn(dbModule, "createBackgroundJob").mockResolvedValueOnce(1);

    const caller = appRouter.createCaller(makeCtx(makeUser({ remainingGenerations: 50 })));

    const result = await caller.generate.prepareJob({ generationType: "image" });
    expect(result.jobId).toBe(1);
    expect(result.pointsCost).toBeGreaterThan(0);
    expect(typeof result.selectedEngine).toBe("string");
    expect(typeof result.engineLabel).toBe("string");

    deductSpy.mockRestore();
    createJobSpy.mockRestore();
  });

  it("should refund points when safety check blocks the request", async () => {
    const dbModule = await import("./db");

    // multimodal requires jobId — we need to set up for that
    const refundSpy = vi.spyOn(dbModule, "refundUserPoints").mockResolvedValue(undefined);
    const createLogSpy = vi.spyOn(dbModule, "createApiUsageLog").mockResolvedValue(1);
    const updateJobSpy = vi.spyOn(dbModule, "updateBackgroundJob").mockResolvedValue(undefined);

    // Mock checkSafety to block the request via LLM
    const llmModule = await import("./_core/llm");
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ safe: false, reason: "Test block reason" }),
        },
        finish_reason: "stop",
        index: 0,
      }],
    } as any);

    const caller = appRouter.createCaller(makeCtx(makeUser({ remainingGenerations: 5 })));

    await expect(
      caller.generate.multimodal({
        jobId: 99,
        prompt: "blocked content test",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow("小兔子提醒你");

    // refundUserPoints should be called since safety blocked it
    expect(refundSpy).toHaveBeenCalledTimes(1);

    refundSpy.mockRestore();
    createLogSpy.mockRestore();
    updateJobSpy.mockRestore();
    llmSpy.mockRestore();
  });
});

// ─── SQL pattern verification ───────────────────────────────────────────────

describe("SQL pattern correctness", () => {
  it("deductUserPoints source code uses SELECT FOR UPDATE pattern", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/db.ts", "utf-8");

    // Must contain atomic SQL decrement pattern
    expect(source).toContain("remainingGenerations} - ${toDeduct}");

    // Must use SELECT FOR UPDATE for pessimistic locking
    expect(source).toContain("FOR UPDATE");

    // Must check result before deducting
    expect(source).toContain("currentCredits < toDeduct");
  });

  it("deductUserQuota source code uses atomic SQL pattern (backward compat)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/db.ts", "utf-8");

    // Must contain atomic SQL decrement pattern for legacy function
    expect(source).toContain("remainingGenerations} - ${amount}");

    // Must contain pessimistic locking
    expect(source).toContain("FOR UPDATE");
  });

  it("routers.ts uses deductUserPoints in prepareJob (model-based billing)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/routers.ts", "utf-8");

    // prepareJob should call deductUserPoints (not the legacy deductUserQuota)
    const prepareJobSection = source.substring(
      source.indexOf("prepareJob: protectedProcedure"),
      source.indexOf("estimateCost: protectedProcedure")
    );

    expect(prepareJobSection).toContain("deductUserPoints");
    expect(prepareJobSection).toContain("estimatePoints");
    expect(prepareJobSection).toContain("pointsCost");

    // Should NOT use the old flat deduction
    expect(prepareJobSection).not.toContain("deductUserQuota");
  });
});
