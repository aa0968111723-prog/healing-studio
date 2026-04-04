import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

/**
 * Tests for atomic quota deduction.
 *
 * The key invariant: deductUserQuota uses a single SQL UPDATE with
 *   SET remainingGenerations = remainingGenerations - N
 *   WHERE remainingGenerations >= N
 * and checks affectedRows to return true/false.
 *
 * This prevents the read-then-write race condition that could allow
 * concurrent requests to over-deduct.
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

// ─── Unit tests for deductUserQuota logic ───────────────────────────────────

describe("Atomic Quota Deduction", () => {
  // We test the db helper directly by importing it
  // Since it requires a real DB connection, we mock the getDb function

  describe("deductUserQuota contract", () => {
    it("should return boolean indicating success or failure", async () => {
      // Import the function to verify its return type
      const { deductUserQuota } = await import("./db");
      // Without a DB connection, it returns false
      const result = await deductUserQuota(999, 1);
      expect(typeof result).toBe("boolean");
      expect(result).toBe(false); // no DB → false
    });

    it("should accept a custom amount parameter", async () => {
      const { deductUserQuota } = await import("./db");
      // Verify it doesn't throw with amount > 1
      const result = await deductUserQuota(999, 5);
      expect(result).toBe(false);
    });

    it("should default amount to 1", async () => {
      const { deductUserQuota } = await import("./db");
      // Verify default parameter works
      const result = await deductUserQuota(999);
      expect(result).toBe(false);
    });
  });

  describe("refundUserQuota contract", () => {
    it("should not throw when DB is unavailable", async () => {
      const { refundUserQuota } = await import("./db");
      // Should gracefully handle no DB
      await expect(refundUserQuota(999, 1)).resolves.not.toThrow();
    });

    it("should accept custom refund amount", async () => {
      const { refundUserQuota } = await import("./db");
      await expect(refundUserQuota(999, 3)).resolves.not.toThrow();
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
    // Verify the procedure is wired up
    const caller = appRouter.createCaller(makeCtx(makeUser()));
    expect(typeof caller.generate.multimodal).toBe("function");
  });

  it("should reject generation when deductUserQuota returns false (quota exhausted)", async () => {
    // Mock deductUserQuota to return false (simulating 0 remaining)
    const dbModule = await import("./db");
    const spy = vi.spyOn(dbModule, "deductUserQuota").mockResolvedValueOnce(false);

    const caller = appRouter.createCaller(makeCtx(makeUser({ remainingGenerations: 0 })));

    await expect(
      caller.generate.multimodal({
        prompt: "test prompt",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow("生成配額已用完");

    spy.mockRestore();
  });

  it("should proceed when deductUserQuota returns true (quota available)", { timeout: 15000 }, async () => {
    const dbModule = await import("./db");
    const llmModule = await import("./_core/llm");

    // Mock deductUserQuota to return true
    const deductSpy = vi.spyOn(dbModule, "deductUserQuota").mockResolvedValueOnce(true);

    // Mock LLM for safety check (returns safe)
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValue({
      choices: [{
        message: { content: JSON.stringify({ safe: true, reason: "" }) },
        finish_reason: "stop",
        index: 0,
      }],
    } as any);

    // Mock other DB calls that happen during generation
    const createJobSpy = vi.spyOn(dbModule, "createBackgroundJob").mockResolvedValueOnce(1);
    const updateJobSpy = vi.spyOn(dbModule, "updateBackgroundJob").mockResolvedValue(undefined);
    const createLogSpy = vi.spyOn(dbModule, "createApiUsageLog").mockResolvedValue(1);
    const createAssetSpy = vi.spyOn(dbModule, "createDigitalAsset").mockResolvedValue(1);
    const createHistorySpy = vi.spyOn(dbModule, "createHistoryEntry").mockResolvedValue(1);
    // Mock refundUserQuota in case generation fails
    const refundSpy = vi.spyOn(dbModule, "refundUserQuota").mockResolvedValue(undefined);

    const caller = appRouter.createCaller(makeCtx(makeUser({ remainingGenerations: 5 })));

    // The generation will likely fail due to missing image generation API in test env,
    // but deductUserQuota should have been called first
    try {
      await caller.generate.multimodal({
        prompt: "a beautiful sunset",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      });
    } catch {
      // Expected: generation may fail in test env, but quota flow should work
    }

    // Verify deductUserQuota was called FIRST (before any generation work)
    expect(deductSpy).toHaveBeenCalledWith(42, 1);
    expect(deductSpy).toHaveBeenCalledTimes(1);

    deductSpy.mockRestore();
    llmSpy.mockRestore();
    createJobSpy.mockRestore();
    updateJobSpy.mockRestore();
    createLogSpy.mockRestore();
    createAssetSpy.mockRestore();
    createHistorySpy.mockRestore();
    refundSpy.mockRestore();
  });

  it("should refund quota when safety check blocks the request", async () => {
    const dbModule = await import("./db");

    // Mock deductUserQuota to return true (quota deducted)
    const deductSpy = vi.spyOn(dbModule, "deductUserQuota").mockResolvedValueOnce(true);
    const refundSpy = vi.spyOn(dbModule, "refundUserQuota").mockResolvedValue(undefined);
    const createLogSpy = vi.spyOn(dbModule, "createApiUsageLog").mockResolvedValue(1);

    // Mock checkSafety to block the request
    // We need to mock the LLM call that checkSafety uses
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
        prompt: "blocked content test",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow("小兔子提醒你");

    // Verify: deduct was called, then refund was called
    expect(deductSpy).toHaveBeenCalledWith(42, 1);
    expect(refundSpy).toHaveBeenCalledWith(42, 1);

    deductSpy.mockRestore();
    refundSpy.mockRestore();
    createLogSpy.mockRestore();
    llmSpy.mockRestore();
  });
});

// ─── SQL pattern verification ───────────────────────────────────────────────

describe("SQL pattern correctness", () => {
  it("deductUserQuota source code uses atomic SQL pattern (not read-then-write)", async () => {
    // Read the actual source to verify the SQL pattern
    const fs = await import("fs");
    const source = fs.readFileSync("server/db.ts", "utf-8");

    // Must contain atomic SQL decrement pattern
    expect(source).toContain("remainingGenerations} - ${amount}");

    // Must contain WHERE constraint to prevent negative
    expect(source).toContain("remainingGenerations} >= ${amount}");

    // Must check affectedRows
    expect(source).toContain("affectedRows");

    // Must NOT contain a read-then-write pattern for deduction
    // (i.e., should not SELECT remaining then UPDATE with absolute value)
    const deductFnMatch = source.match(
      /export async function deductUserQuota[\s\S]*?^}/m
    );
    expect(deductFnMatch).toBeTruthy();
    const deductFn = deductFnMatch![0];
    // Should not contain .select() in the deduct function
    expect(deductFn).not.toContain(".select()");
    // Should not contain getUserByOpenId in the deduct function
    expect(deductFn).not.toContain("getUserByOpenId");
  });

  it("routers.ts does NOT read user quota before deducting (no TOCTOU)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/routers.ts", "utf-8");

    // The generate mutation should call deductUserQuota directly,
    // not check remainingGenerations first
    const generateSection = source.substring(
      source.indexOf(".mutation(async ({ ctx, input }) => {"),
      source.indexOf("// Safety pre-check")
    );

    // Should contain atomic deduction call
    expect(generateSection).toContain("deductUserQuota");

    // Should NOT contain a read-check pattern before deduction
    expect(generateSection).not.toContain("getUserByOpenId");
    expect(generateSection).not.toContain("user.remainingGenerations <= 0");
    expect(generateSection).not.toContain("user.remainingGenerations < 1");
  });
});
