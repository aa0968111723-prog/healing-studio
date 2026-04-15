import { describe, expect, it, vi } from "vitest";

// Mock DB before importing routers
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue(null),
    createVaultItem: vi.fn().mockResolvedValue(1),
    getVaultItemsByUser: vi.fn().mockResolvedValue([]),
    deleteVaultItem: vi.fn().mockResolvedValue(undefined),
    upsertDirectorPreferences: vi.fn().mockResolvedValue(undefined),
    getDirectorPreferences: vi.fn().mockResolvedValue(null),
    deductUserQuota: vi.fn().mockResolvedValue(true),
    deductUserPoints: vi.fn().mockResolvedValue(true),
    refundUserQuota: vi.fn().mockResolvedValue(undefined),
    refundUserPoints: vi.fn().mockResolvedValue(undefined),
    createApiUsageLog: vi.fn().mockResolvedValue(undefined),
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

// ─── Vault Route Tests ──────────────────────────────────────────────────────

describe("vault routes", () => {
  it("rejects unauthenticated access to vault.list", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.vault.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to vault.create", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.vault.create({
        name: "Test Character",
        itemType: "character",
        imageUrl: "https://example.com/img.png",
      })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated access to vault.delete", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.vault.delete({ id: 1 })).rejects.toThrow();
  });

  it("validates vault.create requires non-empty name", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.vault.create({
        name: "",
        itemType: "character",
        imageUrl: "https://example.com/img.png",
      })
    ).rejects.toThrow();
  });

  it("validates vault.create requires non-empty imageUrl", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.vault.create({
        name: "Test",
        itemType: "character",
        imageUrl: "",
      })
    ).rejects.toThrow();
  });

  it("validates vault.create itemType enum", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.vault.create({
        name: "Test",
        itemType: "invalid" as any,
        imageUrl: "https://example.com/img.png",
      })
    ).rejects.toThrow();
  });

  it("accepts valid vault.create input with tags and metadata", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    // This should pass input validation (may fail at DB level in test env)
    const result = await caller.vault.create({
      name: "Test Character",
      itemType: "character",
      imageUrl: "https://example.com/img.png",
      fileKey: "test-key",
      tags: ["anime", "female"],
      metadata: { style: "watercolor" },
    });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("number");
  });

  it("accepts valid vault.list with optional itemType filter", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.vault.list({ itemType: "character" });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Director Preferences Route Tests ───────────────────────────────────────

describe("directorPreferences routes", () => {
  it("rejects unauthenticated access to directorPreferences.get", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.directorPreferences.get()).rejects.toThrow();
  });

  it("rejects unauthenticated access to directorPreferences.update", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.directorPreferences.update({ personality: "calm" })
    ).rejects.toThrow();
  });

  it("validates directorPreferences.update personality enum", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.directorPreferences.update({ personality: "invalid" as any })
    ).rejects.toThrow();
  });

  it("validates directorPreferences.update preferredFormat enum", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.directorPreferences.update({ preferredFormat: "invalid" as any })
    ).rejects.toThrow();
  });

  it("accepts valid directorPreferences.update input", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.directorPreferences.update({
      personality: "creative",
      preferredFormat: "co-star",
    });
    expect(result).toHaveProperty("id");
  });
});

// ─── History Route Tests ────────────────────────────────────────────────────

describe("history routes", () => {
  it("rejects unauthenticated access to history.list", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.list()).rejects.toThrow();
  });

  it("rejects unauthenticated access to history.bookmarked", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.bookmarked()).rejects.toThrow();
  });

  it("rejects unauthenticated access to history.toggleBookmark", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.history.toggleBookmark({ id: 1, isBookmarked: true })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated access to history.rate", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.rate({ id: 1, rating: 5 })).rejects.toThrow();
  });

  it("rejects unauthenticated access to history.delete", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.delete({ id: 1 })).rejects.toThrow();
  });

  it("validates history.rate rating range (min 1)", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.rate({ id: 1, rating: 0 })).rejects.toThrow();
  });

  it("validates history.rate rating range (max 5)", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.history.rate({ id: 1, rating: 6 })).rejects.toThrow();
  });

  it("accepts valid history.list with custom limit", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.history.list({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Plans Route Tests ──────────────────────────────────────────────────────

describe("plans routes", () => {
  it("allows unauthenticated access to plans.list (public)", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.plans.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("allows unauthenticated access to plans.getById (public)", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    // Should not throw on auth, may return null if plan doesn't exist
    const result = await caller.plans.getById({ id: 999 });
    // Either null or an object
    expect(
      result === null || result === undefined || typeof result === "object"
    ).toBe(true);
  });
});

// ─── Profile Route Tests ────────────────────────────────────────────────────

describe("profile routes", () => {
  it("rejects unauthenticated access to profile.updateQuotaJson", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.profile.updateQuotaJson({
        image: 10,
        video: 5,
        audio: 5,
        voice: 5,
      })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated access to profile.updateOnboarding", async () => {
    const ctx = createMockContext(null);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.profile.updateOnboarding({ done: true })
    ).rejects.toThrow();
  });

  it("validates profile.updateQuotaJson rejects negative values", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.profile.updateQuotaJson({
        image: -1,
        video: 5,
        audio: 5,
        voice: 5,
      })
    ).rejects.toThrow();
  });

  it("accepts valid profile.updateQuotaJson input", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.profile.updateQuotaJson({
      image: 10,
      video: 5,
      audio: 5,
      voice: 5,
    });
    expect(result).toEqual({ success: true });
  });

  it("accepts valid profile.updateOnboarding input", async () => {
    const user = createMockUser();
    const ctx = createMockContext(user);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.profile.updateOnboarding({ done: true });
    expect(result).toEqual({ success: true });
  });
});
