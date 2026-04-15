import { describe, it, expect, vi } from "vitest";

// Mock DB before importing routers
vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  let noteIdCounter = 1;
  const notesStore: any[] = [];
  return {
    ...actual,
    getDb: vi.fn().mockResolvedValue(null),
    createProjectNote: vi.fn().mockImplementation(async (data: any) => {
      const id = noteIdCounter++;
      notesStore.push({
        id,
        ...data,
        tags: data.tags ?? [],
        scheduledDate: data.scheduledDate ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return id;
    }),
    getProjectNotesByUser: vi
      .fn()
      .mockImplementation(async (userId: number) => {
        return notesStore.filter(n => n.userId === userId);
      }),
    deleteProjectNote: vi.fn().mockImplementation(async (id: number) => {
      const idx = notesStore.findIndex(n => n.id === id);
      if (idx !== -1) notesStore.splice(idx, 1);
    }),
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
      cookie: vi.fn(),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Phase 7: Hidden Fields & Download Features", () => {
  const caller = appRouter.createCaller(createMockContext(createMockUser()));

  describe("History list returns all fields including hidden ones", () => {
    it("should return history list with durationMs, costCredits, compiledPrompt, parameterSnapshot fields", async () => {
      const result = await caller.history.list({ limit: 5 });
      expect(Array.isArray(result)).toBe(true);
      // Even if empty, the query should succeed and return an array
      // If there are items, each should have the hidden fields
      if (result.length > 0) {
        const item = result[0];
        expect(item).toHaveProperty("durationMs");
        expect(item).toHaveProperty("costCredits");
        expect(item).toHaveProperty("compiledPrompt");
        expect(item).toHaveProperty("parameterSnapshot");
        expect(item).toHaveProperty("resultUrl");
        expect(item).toHaveProperty("modality");
        expect(item).toHaveProperty("createdAt");
      }
    });
  });

  describe("Assets list returns all fields including hidden ones", () => {
    it("should return assets list with description, promptUsed, mimeType, fileSizeBytes, updatedAt", async () => {
      const result = await caller.assets.myAssets();
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        const item = result[0];
        expect(item).toHaveProperty("description");
        expect(item).toHaveProperty("promptUsed");
        expect(item).toHaveProperty("mimeType");
        expect(item).toHaveProperty("fileSizeBytes");
        expect(item).toHaveProperty("updatedAt");
        expect(item).toHaveProperty("rewardCredits");
        expect(item).toHaveProperty("visibility");
      }
    });
  });

  describe("Notes list returns all fields including hidden ones", () => {
    it("should return notes list with tags, scheduledDate, updatedAt, scriptJson", async () => {
      const result = await caller.notes.list();
      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        const item = result[0];
        expect(item).toHaveProperty("tags");
        expect(item).toHaveProperty("scheduledDate");
        expect(item).toHaveProperty("updatedAt");
        expect(item).toHaveProperty("scriptJson");
        expect(item).toHaveProperty("noteType");
        expect(item).toHaveProperty("content");
      }
    });

    it("should create a note with tags and scheduledDate and return them in list", async () => {
      const createResult = await caller.notes.create({
        title: "Test Note with Tags",
        content: "This is a test note with hidden fields",
        noteType: "note",
      });
      expect(createResult).toHaveProperty("id");
      expect(typeof createResult.id).toBe("number");

      // Verify the note appears in the list with all fields
      const notes = await caller.notes.list();
      const created = notes.find(n => n.id === createResult.id);
      expect(created).toBeDefined();
      if (created) {
        expect(created.title).toBe("Test Note with Tags");
        expect(created.content).toBe("This is a test note with hidden fields");
        expect(created).toHaveProperty("tags");
        expect(created).toHaveProperty("scheduledDate");
        expect(created).toHaveProperty("updatedAt");
        expect(created).toHaveProperty("createdAt");
        // Clean up
        await caller.notes.delete({ id: created.id });
      }
    });
  });

  describe("Generation history schema includes all required columns", () => {
    it("should have durationMs and costCredits in the schema", async () => {
      // Verify by importing the schema
      const { generationHistory } = await import("../drizzle/schema");
      expect(generationHistory.durationMs).toBeDefined();
      expect(generationHistory.costCredits).toBeDefined();
      expect(generationHistory.compiledPrompt).toBeDefined();
      expect(generationHistory.parameterSnapshot).toBeDefined();
      expect(generationHistory.resultUrl).toBeDefined();
      expect(generationHistory.thumbnailUrl).toBeDefined();
    });
  });

  describe("Digital asset schema includes all required columns", () => {
    it("should have description, promptUsed, mimeType, fileSizeBytes in the schema", async () => {
      const { digitalAssetLibrary } = await import("../drizzle/schema");
      expect(digitalAssetLibrary.description).toBeDefined();
      expect(digitalAssetLibrary.promptUsed).toBeDefined();
      expect(digitalAssetLibrary.mimeType).toBeDefined();
      expect(digitalAssetLibrary.fileSizeBytes).toBeDefined();
      expect(digitalAssetLibrary.updatedAt).toBeDefined();
      expect(digitalAssetLibrary.rewardCredits).toBeDefined();
    });
  });

  describe("Project notes schema includes all required columns", () => {
    it("should have tags, scheduledDate, updatedAt in the schema", async () => {
      const { projectNotesCalendar } = await import("../drizzle/schema");
      expect(projectNotesCalendar.tags).toBeDefined();
      expect(projectNotesCalendar.scheduledDate).toBeDefined();
      expect(projectNotesCalendar.updatedAt).toBeDefined();
      expect(projectNotesCalendar.scriptJson).toBeDefined();
    });
  });
});
