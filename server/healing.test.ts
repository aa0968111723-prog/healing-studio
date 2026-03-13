import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createMockUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
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

function createMockAdminUser(): AuthenticatedUser {
  return createMockUser({
    id: 99,
    openId: "admin-user-001",
    name: "Admin User",
    role: "admin",
  });
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
    await expect(
      caller.notes.create({ title: "" })
    ).rejects.toThrow();
  });

  it("rejects empty title for feedback.create", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.feedback.create({ title: "" })
    ).rejects.toThrow();
  });

  it("rejects empty name for models.create", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.models.create({ name: "", modelType: "image_subject" })
    ).rejects.toThrow();
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
});

// ─── Shared Types Tests ──────────────────────────────────────────────────────

describe("shared types", () => {
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

  it("MORANDI_COLORS has all expected keys", async () => {
    const { MORANDI_COLORS } = await import("../shared/types");
    expect(MORANDI_COLORS).toHaveProperty("cream");
    expect(MORANDI_COLORS).toHaveProperty("blush");
    expect(MORANDI_COLORS).toHaveProperty("sage");
    expect(MORANDI_COLORS).toHaveProperty("lavender");
    expect(MORANDI_COLORS).toHaveProperty("skyMist");
    expect(MORANDI_COLORS).toHaveProperty("sand");
    expect(MORANDI_COLORS).toHaveProperty("peach");
    expect(MORANDI_COLORS).toHaveProperty("softGray");
  });

  it("MASCOT_DIALOGUES has all states", async () => {
    const { MASCOT_DIALOGUES } = await import("../shared/types");
    expect(MASCOT_DIALOGUES).toHaveProperty("idle");
    expect(MASCOT_DIALOGUES).toHaveProperty("hover");
    expect(MASCOT_DIALOGUES).toHaveProperty("loading");
    expect(MASCOT_DIALOGUES.idle.length).toBeGreaterThan(0);
    expect(MASCOT_DIALOGUES.hover.length).toBeGreaterThan(0);
    expect(MASCOT_DIALOGUES.loading.length).toBeGreaterThan(0);
  });
});
