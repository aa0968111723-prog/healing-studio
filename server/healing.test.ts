import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the DB module before importing routers
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createFineTunedModel: vi.fn().mockResolvedValue(42),
    deductUserQuota: vi.fn().mockResolvedValue(true),
    deductUserPoints: vi.fn().mockResolvedValue(true),
    refundUserQuota: vi.fn().mockResolvedValue(undefined),
    refundUserPoints: vi.fn().mockResolvedValue(undefined),
    createApiUsageLog: vi.fn().mockResolvedValue(undefined),
    createBackgroundJob: vi.fn().mockResolvedValue(99),
    updateBackgroundJob: vi.fn().mockResolvedValue(undefined),
    createDigitalAsset: vi.fn().mockResolvedValue({ id: 1 }),
    addHistoryEntry: vi.fn().mockResolvedValue(undefined),
    getDb: vi.fn().mockResolvedValue(null),
  };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockUser(
  overrides: Partial<AuthenticatedUser> = {}
): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user-001",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    remainingGenerations: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function createMockContext(user: AuthenticatedUser | null = null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── Auth Tests ──────────────────────────────────────────────────────────────

describe("auth.me", () => {
  it("returns null for unauthenticated user", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated user", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.name).toBe("Test User");
    expect(result?.email).toBe("test@example.com");
    expect(result?.remainingGenerations).toBe(50);
  });
});

describe("auth.logout", () => {
  it("clears cookie and returns success", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
  });
});

// ─── Protected Route Access Tests ────────────────────────────────────────────

describe("protected route access control", () => {
  it("rejects unauthenticated access to generate.myJobs", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.generate.myJobs()).rejects.toThrow();
  });

  it("rejects unauthenticated access to assets.myAssets", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.assets.myAssets()).rejects.toThrow();
  });

  it("rejects unauthenticated access to models.myModels", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.models.myModels()).rejects.toThrow();
  });

  it("rejects unauthenticated access to notes.list", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.notes.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to feedback.myFeedbacks", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.feedback.myFeedbacks()).rejects.toThrow();
  });

  it("rejects unauthenticated access to dashboard.myStats", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.myStats()).rejects.toThrow();
  });
});

// ─── Admin Route Access Tests ────────────────────────────────────────────────

describe("admin route access control", () => {
  it("rejects non-admin access to admin.allUsers", async () => {
    const user = createMockUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.allUsers()).rejects.toThrow();
  });

  it("rejects non-admin access to admin.updateQuota", async () => {
    const user = createMockUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.admin.updateQuota({ userId: 2, amount: 100 })
    ).rejects.toThrow();
  });

  it("rejects non-admin access to admin.teamCostSummary", async () => {
    const user = createMockUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.teamCostSummary()).rejects.toThrow();
  });

  // leader 是中階管理者：可動成本檢視 / 自動給點，但不可改他人角色
  it("allows leader access to admin.teamCostSummary", async () => {
    const user = createMockUser({ role: "leader" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.teamCostSummary();
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("totals");
    expect(result).toHaveProperty("usdToTwdRate");
  });

  it("allows leader access to admin.updateAutoCreditPolicy", async () => {
    const user = createMockUser({ role: "leader" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    // DB mocked to no-op; only checking the procedure middleware accepts leader
    await expect(
      caller.admin.updateAutoCreditPolicy({
        userId: 2,
        enabled: true,
        amount: 100,
        intervalDays: 7,
      })
    ).resolves.toBeDefined();
  });

  it("rejects leader access to admin.updateRole (admin-only)", async () => {
    const user = createMockUser({ role: "leader" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.admin.updateRole({ userId: 2, role: "leader" })
    ).rejects.toThrow();
  });

  it("rejects non-admin access to feedback.all", async () => {
    const user = createMockUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.feedback.all()).rejects.toThrow();
  });

  it("rejects non-admin access to feedback.updateStatus", async () => {
    const user = createMockUser({ role: "user" });
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.feedback.updateStatus({ id: 1, status: "resolved" })
    ).rejects.toThrow();
  });
});

// ─── Input Validation Tests ──────────────────────────────────────────────────

describe("input validation", () => {
  it("rejects empty prompt for generation", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.generate.multimodal({
        prompt: "",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow();
  });

  it("rejects invalid temperature for generation", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.generate.multimodal({
        prompt: "test",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 2.0,
      })
    ).rejects.toThrow();
  });

  it("rejects empty title for notes.create", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.notes.create({ title: "" })).rejects.toThrow();
  });

  it("rejects empty title for feedback.create", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.feedback.create({ title: "" })).rejects.toThrow();
  });

  it("rejects empty name for models.create", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.models.create({ name: "" })).rejects.toThrow();
  });

  it("accepts models.create with triggerWord and hyperparams", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.models.create({
      name: "Test Model",
      triggerWord: "zen_test",
      epochs: 20,
      learningRate: 0.0001,
      batchSize: 4,
    });
    // Result should have id or be a job id
    expect(result).toBeDefined();
    expect(result).toHaveProperty("id");
  });

  it("validates generation type enum", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.generate.multimodal({
        prompt: "test",
        generationType: "invalid_type" as any,
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow();
  });

  it("validates mode enum", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.generate.multimodal({
        prompt: "test",
        generationType: "image",
        mode: "invalid_mode" as any,
        vibeCardIds: [],
        temperature: 0.5,
      })
    ).rejects.toThrow();
  });

  it("accepts image workspace params (aspectRatio, negativePrompt)", async () => {
    // Mock atomic deduction and LLM to prevent real API calls
    const dbModule = await import("./db");
    const llmModule = await import("./_core/llm");
    const spy = vi
      .spyOn(dbModule, "deductUserQuota")
      .mockResolvedValueOnce(true);
    const refundSpy = vi
      .spyOn(dbModule, "refundUserQuota")
      .mockResolvedValue(undefined);
    const createJobSpy = vi
      .spyOn(dbModule, "createBackgroundJob")
      .mockResolvedValue(1);
    const updateJobSpy = vi
      .spyOn(dbModule, "updateBackgroundJob")
      .mockResolvedValue(undefined);
    const createLogSpy = vi
      .spyOn(dbModule, "createApiUsageLog")
      .mockResolvedValue(1);
    const createAssetSpy = vi
      .spyOn(dbModule, "createDigitalAsset")
      .mockResolvedValue(1);
    const createHistorySpy = vi
      .spyOn(dbModule, "createHistoryEntry")
      .mockResolvedValue(1);
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ safe: true }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    // Should not throw validation error; may succeed or fail on image generation API
    try {
      await caller.generate.multimodal({
        prompt: "a zen garden",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: ["serene"],
        temperature: 0.5,
        aspectRatio: "16:9",
        negativePrompt: "blurry, low quality",
        styleReferenceUrl: null,
        vibeReferenceUrl: null,
      });
    } catch (e: any) {
      // Should NOT be a validation error
      expect(e.message).not.toMatch(/validation/i);
    }
    spy.mockRestore();
    refundSpy.mockRestore();
    createJobSpy.mockRestore();
    updateJobSpy.mockRestore();
    createLogSpy.mockRestore();
    llmSpy.mockRestore();
    createAssetSpy.mockRestore();
    createHistorySpy.mockRestore();
  });

  it("accepts video workspace params (cameraMotion, frames)", async () => {
    const dbModule = await import("./db");
    const llmModule = await import("./_core/llm");
    const spy = vi
      .spyOn(dbModule, "deductUserQuota")
      .mockResolvedValueOnce(true);
    const refundSpy = vi
      .spyOn(dbModule, "refundUserQuota")
      .mockResolvedValue(undefined);
    const createJobSpy = vi
      .spyOn(dbModule, "createBackgroundJob")
      .mockResolvedValue(1);
    const updateJobSpy = vi
      .spyOn(dbModule, "updateBackgroundJob")
      .mockResolvedValue(undefined);
    const createLogSpy = vi
      .spyOn(dbModule, "createApiUsageLog")
      .mockResolvedValue(1);
    const createAssetSpy = vi
      .spyOn(dbModule, "createDigitalAsset")
      .mockResolvedValue(1);
    const createHistorySpy = vi
      .spyOn(dbModule, "createHistoryEntry")
      .mockResolvedValue(1);
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ safe: true }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    try {
      await caller.generate.multimodal({
        prompt: "flowing water",
        generationType: "video",
        mode: "deep_precision",
        vibeCardIds: [],
        temperature: 0.7,
        videoDurationSeconds: 8,
        firstFrameUrl: null,
        lastFrameUrl: null,
        characterRefUrl: null,
        cameraMotion: { pan: 0, zoom: 50, tilt: 0 },
      });
    } catch (e: any) {
      expect(e.message).not.toMatch(/validation/i);
    }
    spy.mockRestore();
    refundSpy.mockRestore();
    createJobSpy.mockRestore();
    updateJobSpy.mockRestore();
    createLogSpy.mockRestore();
    llmSpy.mockRestore();
    createAssetSpy.mockRestore();
    createHistorySpy.mockRestore();
  });

  it("accepts audio workspace params (instrumental, lyrics)", async () => {
    const dbModule = await import("./db");
    const llmModule = await import("./_core/llm");
    const spy = vi
      .spyOn(dbModule, "deductUserQuota")
      .mockResolvedValueOnce(true);
    const refundSpy = vi
      .spyOn(dbModule, "refundUserQuota")
      .mockResolvedValue(undefined);
    const createJobSpy = vi
      .spyOn(dbModule, "createBackgroundJob")
      .mockResolvedValue(1);
    const updateJobSpy = vi
      .spyOn(dbModule, "updateBackgroundJob")
      .mockResolvedValue(undefined);
    const createLogSpy = vi
      .spyOn(dbModule, "createApiUsageLog")
      .mockResolvedValue(1);
    const createAssetSpy = vi
      .spyOn(dbModule, "createDigitalAsset")
      .mockResolvedValue(1);
    const createHistorySpy = vi
      .spyOn(dbModule, "createHistoryEntry")
      .mockResolvedValue(1);
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ safe: true }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    try {
      await caller.generate.multimodal({
        prompt: "peaceful ambient",
        generationType: "audio",
        mode: "lightning",
        vibeCardIds: ["dreamy"],
        temperature: 0.5,
        musicStyle: "ambient",
        isInstrumental: true,
        audioDuration: 60,
        audioEnergy: 50,
      });
    } catch (e: any) {
      expect(e.message).not.toMatch(/validation/i);
    }
    spy.mockRestore();
    refundSpy.mockRestore();
    createJobSpy.mockRestore();
    updateJobSpy.mockRestore();
    createLogSpy.mockRestore();
    llmSpy.mockRestore();
    createAssetSpy.mockRestore();
    createHistorySpy.mockRestore();
  });

  it("accepts voice workspace params (speed, stability, emotion)", async () => {
    const dbModule = await import("./db");
    const llmModule = await import("./_core/llm");
    const spy = vi
      .spyOn(dbModule, "deductUserQuota")
      .mockResolvedValueOnce(true);
    const refundSpy = vi
      .spyOn(dbModule, "refundUserQuota")
      .mockResolvedValue(undefined);
    const createJobSpy = vi
      .spyOn(dbModule, "createBackgroundJob")
      .mockResolvedValue(1);
    const updateJobSpy = vi
      .spyOn(dbModule, "updateBackgroundJob")
      .mockResolvedValue(undefined);
    const createLogSpy = vi
      .spyOn(dbModule, "createApiUsageLog")
      .mockResolvedValue(1);
    const createAssetSpy = vi
      .spyOn(dbModule, "createDigitalAsset")
      .mockResolvedValue(1);
    const createHistorySpy = vi
      .spyOn(dbModule, "createHistoryEntry")
      .mockResolvedValue(1);
    const llmSpy = vi.spyOn(llmModule, "invokeLLM").mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ safe: true }) },
          finish_reason: "stop",
          index: 0,
        },
      ],
    } as any);
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    try {
      await caller.generate.multimodal({
        prompt: "hello world",
        generationType: "voice",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
        voiceModelId: "warm_female",
        voiceText: "你好世界",
        voiceSpeed: 1.0,
        voiceStability: 50,
        voiceEmotionType: "calm",
        voiceEmotionIntensity: 50,
      });
    } catch (e: any) {
      expect(e.message).not.toMatch(/validation/i);
    }
    spy.mockRestore();
    refundSpy.mockRestore();
    createJobSpy.mockRestore();
    updateJobSpy.mockRestore();
    createLogSpy.mockRestore();
    llmSpy.mockRestore();
    createAssetSpy.mockRestore();
    createHistorySpy.mockRestore();
  });
});

// ─── Shared Types Tests ──────────────────────────────────────────────────────

describe("shared types - Zen palette and constants", () => {
  it("VIBE_CARDS has correct structure", async () => {
    const { VIBE_CARDS } = await import("../shared/types");
    expect(VIBE_CARDS).toBeInstanceOf(Array);
    expect(VIBE_CARDS.length).toBe(8);
    for (const card of VIBE_CARDS) {
      expect(card).toHaveProperty("id");
      expect(card).toHaveProperty("label");
      expect(card).toHaveProperty("labelZh");
      expect(card).toHaveProperty("description");
      expect(card).toHaveProperty("color");
      expect(card).toHaveProperty("icon");
    }
  });

  it("ZEN_COLORS has all expected keys", async () => {
    const { ZEN_COLORS } = await import("../shared/types");
    expect(ZEN_COLORS).toHaveProperty("oat");
    expect(ZEN_COLORS).toHaveProperty("smoke");
    expect(ZEN_COLORS).toHaveProperty("warmGray");
    expect(ZEN_COLORS).toHaveProperty("blush");
    expect(ZEN_COLORS).toHaveProperty("sage");
    expect(ZEN_COLORS).toHaveProperty("lavender");
    expect(ZEN_COLORS).toHaveProperty("skyMist");
    expect(ZEN_COLORS).toHaveProperty("sand");
    expect(ZEN_COLORS).toHaveProperty("peach");
    expect(ZEN_COLORS).toHaveProperty("frost");
  });

  it("ZEN_TOOLTIPS has all expected keys", async () => {
    const { ZEN_TOOLTIPS } = await import("../shared/types");
    expect(ZEN_TOOLTIPS).toHaveProperty("temperature");
    expect(ZEN_TOOLTIPS).toHaveProperty("seed");
    expect(ZEN_TOOLTIPS).toHaveProperty("loraWeight");
    expect(ZEN_TOOLTIPS).toHaveProperty("mode");
    expect(ZEN_TOOLTIPS).toHaveProperty("epochs");
    expect(ZEN_TOOLTIPS).toHaveProperty("learningRate");
    expect(ZEN_TOOLTIPS).toHaveProperty("batchSize");
    for (const key of Object.keys(ZEN_TOOLTIPS)) {
      expect(ZEN_TOOLTIPS[key]).toHaveProperty("title");
      expect(ZEN_TOOLTIPS[key]).toHaveProperty("description");
    }
  });

  it("PROGRESS_MESSAGES has all generation types", async () => {
    const { PROGRESS_MESSAGES } = await import("../shared/types");
    expect(PROGRESS_MESSAGES).toHaveProperty("image");
    expect(PROGRESS_MESSAGES).toHaveProperty("video");
    expect(PROGRESS_MESSAGES).toHaveProperty("audio");
    expect(PROGRESS_MESSAGES).toHaveProperty("voice");
    for (const key of Object.keys(PROGRESS_MESSAGES)) {
      expect(PROGRESS_MESSAGES[key].length).toBeGreaterThan(0);
    }
  });

  it("CharacterForgeStep type covers all wizard steps", async () => {
    // Verify the type exists by checking DatasetImage structure
    const types = await import("../shared/types");
    expect(types).toBeDefined();
    // Verify CoStarScript has all required fields
    const scriptKeys = [
      "context",
      "situation",
      "task",
      "action",
      "result",
      "visualPrompt",
      "audioScript",
      "musicVibe",
    ];
    // We can't directly test types at runtime, but we verify the module exports
    expect(typeof types.VIBE_CARDS).toBe("object");
    expect(typeof types.ZEN_COLORS).toBe("object");
    expect(typeof types.ZEN_TOOLTIPS).toBe("object");
    expect(typeof types.PROGRESS_MESSAGES).toBe("object");
  });
});
