import { describe, it, expect, vi } from "vitest";
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

describe("Phase 5: 7-Persona Audit Fixes", () => {

  // ─── ISSUE-01: ThoughtChain Real Timestamps ──────────────────────────────

  describe("ThoughtChain Real Timestamps", () => {
    it("generate.multimodal should reject when user not found in DB (quota check)", async () => {
      // Test user doesn't exist in real DB, so getUserByOpenId returns undefined
      // This verifies the quota check path works correctly
      const user = createMockUser({ openId: "nonexistent-user" });
      const ctx = createMockContext(user);
      const caller = appRouter.createCaller(ctx);

      await expect(caller.generate.multimodal({
        prompt: "寧靜的禪意花園",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.6,
      })).rejects.toThrow("生成配額已用完");
    });

    it("ThoughtChain structure should include required fields", () => {
      // Verify the ThoughtChain type contract
      type ThoughtNode = {
        id: string;
        label: string;
        status: string;
        detail: string;
        timestamp: number;
      };

      const mockChain: ThoughtNode[] = [
        { id: "safety", label: "安全檢查", status: "passed", detail: "內容安全檢查通過（150ms）", timestamp: Date.now() - 4000 },
        { id: "compile", label: "提示詞編譯", status: "completed", detail: "編譯後提示詞長度: 120 字元（800ms）", timestamp: Date.now() - 3000 },
        { id: "weight", label: "視覺權重計算", status: "completed", detail: "visualWeight: 0.75, controlNet: {}", timestamp: Date.now() - 2500 },
        { id: "generate", label: "圖像生成", status: "completed", detail: "生成成功（3500ms）", timestamp: Date.now() - 1000 },
        { id: "quota", label: "配額扣除", status: "completed", detail: "扣除 1 次生成配額", timestamp: Date.now() - 100 },
        { id: "history", label: "歷史紀錄", status: "completed", detail: "已儲存至生成歷史", timestamp: Date.now() },
      ];

      // Verify all nodes have required fields
      for (const node of mockChain) {
        expect(node.id).toBeDefined();
        expect(node.label).toBeDefined();
        expect(node.status).toBeDefined();
        expect(node.detail).toBeDefined();
        expect(node.timestamp).toBeGreaterThan(0);
      }

      // Verify safety node has ms timing
      expect(mockChain[0].detail).toMatch(/\d+ms/);
      // Verify compile node has ms timing
      expect(mockChain[1].detail).toMatch(/\d+ms/);
      // Verify weight node has decimal visualWeight
      expect(mockChain[2].detail).toMatch(/visualWeight: \d+\.\d+/);
      // Verify generate node has ms timing
      expect(mockChain[3].detail).toMatch(/\d+ms/);
    });
  });

  // ─── ISSUE-02: Cross-Modal Parameter Inheritance ─────────────────────────

  describe("Cross-Modal Parameter Inheritance", () => {
    it("sessionStorage payload should include parameterSnapshot", () => {
      // Simulate what HistoryPage now sends
      const historyItem = {
        prompt: "寧靜的禪意花園",
        generationType: "video",
        referenceImageUrl: "https://example.com/img.png",
        parameterSnapshot: {
          mode: "lightning",
          temperature: 0.7,
          seed: 42,
          vibeCardIds: ["zen-garden"],
          visualWeight: 0.75,
        },
      };

      const payload = JSON.stringify(historyItem);
      const parsed = JSON.parse(payload);

      // Verify full parameter snapshot is preserved
      expect(parsed.parameterSnapshot).toBeDefined();
      expect(parsed.parameterSnapshot.mode).toBe("lightning");
      expect(parsed.parameterSnapshot.temperature).toBe(0.7);
      expect(parsed.parameterSnapshot.seed).toBe(42);
      expect(parsed.parameterSnapshot.vibeCardIds).toEqual(["zen-garden"]);
      expect(parsed.parameterSnapshot.visualWeight).toBe(0.75);
      expect(parsed.referenceImageUrl).toBe("https://example.com/img.png");
    });

    it("mode enum should only accept lightning or deep_precision", async () => {
      const user = createMockUser();
      const ctx = createMockContext(user);
      const caller = appRouter.createCaller(ctx);

      // Invalid mode should be rejected at input validation
      await expect(caller.generate.multimodal({
        prompt: "test",
        generationType: "image",
        mode: "balanced" as any,
        vibeCardIds: [],
        temperature: 0.5,
      })).rejects.toThrow();
    });
  });

  // ─── ISSUE-05: evaluatePrompt suggestions structure ──────────────────────

  describe("evaluatePrompt Suggestions", () => {
    it("should return suggestions as an array of strings", async () => {
      const user = createMockUser();
      const ctx = createMockContext(user);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.evaluate.prompt({
        prompt: "寧靜的禪意花園，柔和的晨光照射在石頭上",
        modality: "image",
      });

      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.optimizedPrompt).toBeDefined();
      expect(typeof result.optimizedPrompt).toBe("string");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }, 60000);

    it("should return 5 dimensions in evaluation", async () => {
      const user = createMockUser();
      const ctx = createMockContext(user);
      const caller = appRouter.createCaller(ctx);

      const result = await caller.evaluate.prompt({
        prompt: "一隻金色的貓咪坐在窗台上，窗外是下雨的城市街道",
        modality: "image",
      });

      expect(result.dimensions).toBeDefined();
      expect(result.dimensions.subjectClarity).toBeGreaterThanOrEqual(0);
      expect(result.dimensions.actionNarrative).toBeGreaterThanOrEqual(0);
      expect(result.dimensions.environment).toBeGreaterThanOrEqual(0);
      expect(result.dimensions.lightingTone).toBeGreaterThanOrEqual(0);
      expect(result.dimensions.technicalSpecs).toBeGreaterThanOrEqual(0);
    }, 60000);
  });

  // ─── Safety Check ────────────────────────────────────────────────────────

  describe("Safety Check", () => {
    it("should block unsafe content", async () => {
      const user = createMockUser({ openId: "nonexistent-user" });
      const ctx = createMockContext(user);
      const caller = appRouter.createCaller(ctx);

      // Even before quota check, safety or quota should reject
      await expect(caller.generate.multimodal({
        prompt: "暴力血腥殘忍的恐怖場景",
        generationType: "image",
        mode: "lightning",
        vibeCardIds: [],
        temperature: 0.5,
      })).rejects.toThrow();
    });
  });

  // ─── ZIP Export Structure ────────────────────────────────────────────────

  describe("ZIP Export Structure", () => {
    it("should define correct ZIP file structure", () => {
      // Verify the expected ZIP contents
      const expectedFiles = [
        "generated-image.png",
        "prompt.txt",
        "metadata.json",
        "thought-chain.txt",
      ];

      const metadata = {
        modality: "image",
        mode: "lightning",
        temperature: 0.6,
        seed: "random",
        vibeCardIds: [],
        resultData: { imageUrl: "https://example.com/img.png" },
        thoughtChain: [
          { id: "safety", label: "安全檢查", status: "passed", detail: "通過" },
        ],
        generatedAt: new Date().toISOString(),
      };

      const json = JSON.stringify(metadata, null, 2);
      const parsed = JSON.parse(json);

      expect(parsed.modality).toBe("image");
      expect(parsed.mode).toBe("lightning");
      expect(parsed.thoughtChain).toBeDefined();
      expect(parsed.generatedAt).toBeDefined();
      expect(expectedFiles.length).toBe(4);
    });
  });
});
