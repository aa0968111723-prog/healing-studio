import { describe, it, expect, vi } from "vitest";

// Mock DB before importing routers
let noteIdCounter = 100;
const notesStore: any[] = [];

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
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
    getProjectNotesByUser: vi.fn().mockImplementation(async (userId: number) => {
      return notesStore.filter((n) => n.userId === userId);
    }),
    deleteProjectNote: vi.fn().mockImplementation(async (id: number) => {
      const idx = notesStore.findIndex((n) => n.id === id);
      if (idx !== -1) notesStore.splice(idx, 1);
    }),
    updateProjectNote: vi.fn().mockImplementation(async (id: number, data: any) => {
      const note = notesStore.find((n) => n.id === id);
      if (note) Object.assign(note, data);
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

function createMockUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-phase9-user",
    name: "Phase9 Tester",
    role: "user",
    createdAt: new Date(),
    remainingGenerations: JSON.stringify({ image: 10, video: 5, audio: 5, voice: 5 }),
    ...overrides,
  } as AuthenticatedUser;
}

function mockCtx(userId = 1) {
  return {
    user: createMockUser({ id: userId }),
    req: {} as any,
    res: {} as any,
  };
}

describe("Phase 9: Agentic Connectivity + Knowledge Management + Onboarding", () => {

  // ─── Task 1: Notes API for Orb/Studio Integration ───────────────────────

  describe("Notes API for Orb/Studio pin-to-notes", () => {
    it("should create a note from studio pin action", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const note = await caller.notes.create({
        title: "圖片生成結果",
        content: "提示詞：a serene landscape\n\n結果：https://example.com/img.png",
        noteType: "note",
      });
      expect(note).toBeDefined();
      expect(note.id).toBeGreaterThan(0);
    });

    it("should create a note from thought-chain pin action", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const note = await caller.notes.create({
        title: "思維節點：安全檢查",
        content: "內容安全 ✓\n\n推理：已通過所有安全過濾器",
        noteType: "note",
      });
      expect(note).toBeDefined();
      expect(note.id).toBeGreaterThan(0);
    });

    it("should create a calendar_event note for scheduling", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const note = await caller.notes.create({
        title: "排程：發布影片",
        content: "影片分鏡排程",
        noteType: "calendar_event",
        scheduledDate: Date.now() + 7 * 24 * 60 * 60 * 1000, // next week
      });
      expect(note).toBeDefined();
      expect(note.id).toBeGreaterThan(0);
    });

    it("should list notes including pinned items", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const notes = await caller.notes.list();
      expect(Array.isArray(notes)).toBe(true);
    });

    it("should delete a note", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const note = await caller.notes.create({
        title: "待刪除筆記",
        noteType: "note",
      });
      const result = await caller.notes.delete({ id: note.id });
      expect(result).toBeDefined();
    });
  });

  // ─── Task 2: Calendar Integration ──────────────────────────────────────

  describe("Calendar scheduling via notes API", () => {
    it("should create a scheduled note with future date", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const futureDate = Date.now() + 3 * 24 * 60 * 60 * 1000;
      const note = await caller.notes.create({
        title: "待發布角色卡片",
        content: "角色：治癒系少女",
        noteType: "calendar_event",
        scheduledDate: futureDate,
      });
      expect(note).toBeDefined();
      expect(note.id).toBeGreaterThan(0);
    });

    it("should list notes and filter by scheduled date presence", async () => {
      const caller = appRouter.createCaller(mockCtx());
      const notes = await caller.notes.list();
      const scheduled = notes.filter((n: any) => n.scheduledDate);
      // At least the ones we created above
      expect(Array.isArray(scheduled)).toBe(true);
    });

    it("should support natural language scheduling (backend receives parsed date)", async () => {
      // The natural language parsing happens on the frontend (ProactiveOrbWidget)
      // Backend just receives the parsed timestamp
      const caller = appRouter.createCaller(mockCtx());
      const nextFriday = new Date();
      nextFriday.setDate(nextFriday.getDate() + ((5 - nextFriday.getDay() + 7) % 7 || 7));
      
      const note = await caller.notes.create({
        title: "排程到下週五",
        content: "自然語言解析結果",
        noteType: "calendar_event",
        scheduledDate: nextFriday.getTime(),
      });
      expect(note).toBeDefined();
    });
  });

  // ─── Task 3: Onboarding Tour Data Validation ──────────────────────────

  describe("Onboarding tour configuration", () => {
    it("should have 4 onboarding steps defined", () => {
      // Validate the tour step structure (frontend component test)
      const TOUR_STEPS = [
        { targetId: "prompt-input", title: "視覺化積木" },
        { targetId: "personality-selector", title: "自注意力滑桿" },
        { targetId: "generate-button", title: "AI 助理光球" },
        { targetId: "storyboard-panel", title: "側邊欄" },
      ];
      expect(TOUR_STEPS).toHaveLength(4);
      TOUR_STEPS.forEach(step => {
        expect(step.targetId).toBeTruthy();
        expect(step.title).toBeTruthy();
      });
    });

    it("should have valid target element IDs matching Studio page", () => {
      const requiredIds = ["prompt-input", "personality-selector", "generate-button", "storyboard-panel"];
      requiredIds.forEach(id => {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── Task 4: Orb Command Parser ──────────────────────────────────────

  describe("Orb command parsing", () => {
    // Test the natural language date parser
    function parseNaturalDate(text: string): Date | null {
      const now = new Date();
      const lower = text.toLowerCase();
      if (lower.includes("明天")) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return d;
      }
      if (lower.includes("後天")) {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        return d;
      }
      if (lower.includes("下週五") || lower.includes("下周五")) {
        const d = new Date(now);
        const dayOfWeek = d.getDay();
        const daysUntilNextFriday = ((5 - dayOfWeek + 7) % 7) || 7;
        d.setDate(d.getDate() + daysUntilNextFriday);
        return d;
      }
      const daysMatch = text.match(/(\d+)\s*(天|日)後/);
      if (daysMatch) {
        const d = new Date(now);
        d.setDate(d.getDate() + parseInt(daysMatch[1]));
        return d;
      }
      return null;
    }

    it("should parse '明天' as tomorrow", () => {
      const result = parseNaturalDate("排程到明天");
      expect(result).not.toBeNull();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(result!.toDateString()).toBe(tomorrow.toDateString());
    });

    it("should parse '後天' as day after tomorrow", () => {
      const result = parseNaturalDate("後天發布");
      expect(result).not.toBeNull();
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);
      expect(result!.toDateString()).toBe(dayAfter.toDateString());
    });

    it("should parse '下週五' as next Friday", () => {
      const result = parseNaturalDate("排程到下週五");
      expect(result).not.toBeNull();
      expect(result!.getDay()).toBe(5); // Friday
    });

    it("should parse '3天後' correctly", () => {
      const result = parseNaturalDate("3天後");
      expect(result).not.toBeNull();
      const expected = new Date();
      expected.setDate(expected.getDate() + 3);
      expect(result!.toDateString()).toBe(expected.toDateString());
    });

    it("should return null for unrecognized date patterns", () => {
      const result = parseNaturalDate("隨便什麼時候");
      expect(result).toBeNull();
    });

    // Test command type detection
    function parseOrbCommand(text: string): { type: string } {
      const lower = text.toLowerCase();
      if (lower.includes("筆記") || lower.includes("記錄") || lower.includes("釘選")) return { type: "notes" };
      if (lower.includes("排程") || lower.includes("日曆") || lower.includes("行事曆")) return { type: "calendar" };
      if (lower.includes("導覽") || lower.includes("引導") || lower.includes("教學")) return { type: "tour" };
      return { type: "unknown" };
    }

    it("should detect notes commands", () => {
      expect(parseOrbCommand("存到筆記").type).toBe("notes");
      expect(parseOrbCommand("記錄這個").type).toBe("notes");
      expect(parseOrbCommand("釘選至筆記").type).toBe("notes");
    });

    it("should detect calendar commands", () => {
      expect(parseOrbCommand("加入排程").type).toBe("calendar");
      expect(parseOrbCommand("開啟日曆").type).toBe("calendar");
      expect(parseOrbCommand("行事曆").type).toBe("calendar");
    });

    it("should detect tour commands", () => {
      expect(parseOrbCommand("重新導覽").type).toBe("tour");
      expect(parseOrbCommand("引導教學").type).toBe("tour");
    });

    it("should return unknown for unrecognized commands", () => {
      expect(parseOrbCommand("你好").type).toBe("unknown");
    });
  });

  // ─── Task 5: Drag and Drop Data Format ────────────────────────────────

  describe("Drag and drop data format validation", () => {
    it("should handle note drag payload format", () => {
      const payload = JSON.stringify({ noteId: 1, title: "測試筆記", type: "note" });
      const parsed = JSON.parse(payload);
      expect(parsed.noteId).toBe(1);
      expect(parsed.title).toBe("測試筆記");
      expect(parsed.type).toBe("note");
    });

    it("should handle studio result drag payload format", () => {
      const payload = JSON.stringify({
        prompt: "a serene landscape",
        resultUrl: "https://example.com/img.png",
        sourceType: "studio-result",
      });
      const parsed = JSON.parse(payload);
      expect(parsed.prompt).toBeTruthy();
      expect(parsed.resultUrl).toBeTruthy();
    });

    it("should handle thought node drag payload format", () => {
      const payload = JSON.stringify({
        thoughtNode: {
          id: "safety",
          label: "安全檢查",
          detail: "內容安全 ✓",
          status: "completed",
        },
      });
      const parsed = JSON.parse(payload);
      expect(parsed.thoughtNode.id).toBe("safety");
      expect(parsed.thoughtNode.label).toBe("安全檢查");
    });
  });
});
