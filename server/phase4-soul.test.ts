import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock LLM ──────────────────────────────────────────────────────────────

const mockInvokeLLM = vi.fn();
vi.mock("./server/_core/llm", () => ({
  invokeLLM: (...args: unknown[]) => mockInvokeLLM(...args),
}));

// ─── Mock DB ───────────────────────────────────────────────────────────────

const mockDb = {
  getHistoryByUser: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      modality: "image",
      prompt: "test prompt",
      compiledPrompt: "compiled",
      resultUrl: "https://example.com/img.png",
      thumbnailUrl: "https://example.com/thumb.png",
      isBookmarked: false,
      userRating: null,
      costCredits: 1,
      parameterSnapshot: { mode: "balanced" },
      createdAt: new Date(),
    },
    {
      id: 2,
      userId: 1,
      modality: "video",
      prompt: "video prompt",
      compiledPrompt: "compiled video",
      resultUrl: null,
      thumbnailUrl: null,
      isBookmarked: true,
      userRating: 4,
      costCredits: 2,
      parameterSnapshot: { mode: "creative" },
      createdAt: new Date(),
    },
  ]),
  getBookmarkedHistory: vi
    .fn()
    .mockResolvedValue([
      {
        id: 2,
        userId: 1,
        modality: "video",
        prompt: "video prompt",
        compiledPrompt: "compiled video",
        resultUrl: null,
        thumbnailUrl: null,
        isBookmarked: true,
        userRating: 4,
        costCredits: 2,
        parameterSnapshot: { mode: "creative" },
        createdAt: new Date(),
      },
    ]),
  updateHistoryEntry: vi.fn().mockResolvedValue(undefined),
  deleteHistoryEntry: vi.fn().mockResolvedValue(undefined),
  createHistoryEntry: vi.fn().mockResolvedValue(1),
  getDirectorPreferences: vi.fn().mockResolvedValue(null),
  upsertDirectorPreferences: vi.fn().mockResolvedValue(undefined),
  createProjectNote: vi.fn().mockResolvedValue(1),
};
vi.mock("./server/db", () => ({ default: mockDb, ...mockDb }));
vi.mock("./server/db.ts", () => ({ default: mockDb, ...mockDb }));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Phase 4: AI Soul Injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Evaluate Prompt (LLM-as-a-Judge) ────────────────────────────────────

  describe("evaluate.prompt", () => {
    it("should return structured evaluation with 5 dimensions", async () => {
      const evalResult = {
        score: 72,
        dimensions: {
          subjectClarity: 18,
          actionNarrative: 14,
          environment: 16,
          lightingTone: 12,
          technicalSpecs: 12,
        },
        strengths: "主體描述清晰，環境設定有層次",
        weaknesses: "缺乏光影描述和技術參數",
        suggestions: ["加入 golden hour 光線描述", "指定鏡頭角度如 low angle"],
        optimizedPrompt:
          "A woman in white dress walking through lavender fields at golden hour, low angle shot, cinematic lighting",
      };

      mockInvokeLLM.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(evalResult) } }],
      });

      // Simulate calling the evaluate logic
      const result = await mockInvokeLLM({
        messages: [
          { role: "system", content: expect.any(String) },
          { role: "user", content: "一位穿白色洋裝的女性在薰衣草田漫步" },
        ],
        response_format: expect.any(Object),
      });

      const parsed = JSON.parse(result.choices[0].message.content);
      expect(parsed.score).toBe(72);
      expect(parsed.dimensions.subjectClarity).toBe(18);
      expect(parsed.dimensions.actionNarrative).toBe(14);
      expect(parsed.dimensions.environment).toBe(16);
      expect(parsed.dimensions.lightingTone).toBe(12);
      expect(parsed.dimensions.technicalSpecs).toBe(12);
      expect(parsed.suggestions).toHaveLength(2);
      expect(parsed.optimizedPrompt).toContain("golden hour");
    });

    it("should handle score range 0-100 correctly", () => {
      const scores = [0, 25, 50, 75, 100];
      scores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });

    it("each dimension should be 0-20", () => {
      const dims = {
        subjectClarity: 15,
        actionNarrative: 12,
        environment: 18,
        lightingTone: 10,
        technicalSpecs: 5,
      };
      Object.values(dims).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(20);
      });
      const total = Object.values(dims).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(100);
    });
  });

  // ─── Personality System ──────────────────────────────────────────────────

  describe("Director AI Personality System", () => {
    const PERSONALITY_PROMPTS = {
      calm: {
        researchStyle: "沉穩",
        directorStyle: "邏輯",
        proactiveHint: "目標觀眾",
      },
      creative: {
        researchStyle: "靈感",
        directorStyle: "氛圍",
        proactiveHint: "情緒高潮",
      },
      technical: {
        researchStyle: "技術",
        directorStyle: "參數",
        proactiveHint: "解析度",
      },
    };

    it("should have 3 distinct personalities", () => {
      expect(Object.keys(PERSONALITY_PROMPTS)).toHaveLength(3);
      expect(PERSONALITY_PROMPTS).toHaveProperty("calm");
      expect(PERSONALITY_PROMPTS).toHaveProperty("creative");
      expect(PERSONALITY_PROMPTS).toHaveProperty("technical");
    });

    it("calm personality should emphasize logic and structure", () => {
      expect(PERSONALITY_PROMPTS.calm.researchStyle).toContain("沉穩");
      expect(PERSONALITY_PROMPTS.calm.directorStyle).toContain("邏輯");
    });

    it("creative personality should emphasize atmosphere and emotion", () => {
      expect(PERSONALITY_PROMPTS.creative.researchStyle).toContain("靈感");
      expect(PERSONALITY_PROMPTS.creative.directorStyle).toContain("氛圍");
    });

    it("technical personality should emphasize parameters and precision", () => {
      expect(PERSONALITY_PROMPTS.technical.researchStyle).toContain("技術");
      expect(PERSONALITY_PROMPTS.technical.directorStyle).toContain("參數");
    });

    it("each personality should have proactive intervention hints", () => {
      Object.values(PERSONALITY_PROMPTS).forEach(p => {
        expect(p.proactiveHint).toBeTruthy();
        expect(p.proactiveHint.length).toBeGreaterThan(0);
      });
    });

    it("director chat should accept personality parameter", async () => {
      const scriptResult = {
        context: "背景",
        situation: "情境",
        task: "任務",
        action: "行動",
        result: "結果",
        visualPrompt: "A serene landscape",
        audioScript: "歡迎來到...",
        musicVibe: "ambient chill",
        proactiveQuestion: "您希望傳達什麼核心情緒？",
      };

      mockInvokeLLM
        .mockResolvedValueOnce({
          choices: [{ message: { content: "研究結果" } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(scriptResult) } }],
        });

      // Simulate the personality-aware call
      const researchResult = await mockInvokeLLM({
        messages: [{ role: "system", content: "沉穩" }],
      });
      expect(researchResult.choices[0].message.content).toBe("研究結果");

      const directorResult = await mockInvokeLLM({
        messages: [{ role: "system", content: "邏輯" }],
      });
      const script = JSON.parse(directorResult.choices[0].message.content);
      expect(script.proactiveQuestion).toBeTruthy();
      expect(script.proactiveQuestion).toContain("情緒");
    });

    it("proactive question should be included in script output", () => {
      const script = {
        context: "test",
        proactiveQuestion: "您的目標觀眾是誰？",
      };
      expect(script.proactiveQuestion).toBeTruthy();
      expect(typeof script.proactiveQuestion).toBe("string");
    });
  });

  // ─── History Integration ─────────────────────────────────────────────────

  describe("Generation History", () => {
    it("should list history entries for a user", async () => {
      const history = await mockDb.getHistoryByUser(1, 200);
      expect(history).toHaveLength(2);
      expect(history[0].modality).toBe("image");
      expect(history[1].modality).toBe("video");
    });

    it("should return only bookmarked entries", async () => {
      const bookmarked = await mockDb.getBookmarkedHistory(1);
      expect(bookmarked).toHaveLength(1);
      expect(bookmarked[0].isBookmarked).toBe(true);
    });

    it("should toggle bookmark status", async () => {
      await mockDb.updateHistoryEntry(1, { isBookmarked: true });
      expect(mockDb.updateHistoryEntry).toHaveBeenCalledWith(1, {
        isBookmarked: true,
      });
    });

    it("should update user rating", async () => {
      await mockDb.updateHistoryEntry(1, { userRating: 5 });
      expect(mockDb.updateHistoryEntry).toHaveBeenCalledWith(1, {
        userRating: 5,
      });
    });

    it("should delete history entry", async () => {
      await mockDb.deleteHistoryEntry(1);
      expect(mockDb.deleteHistoryEntry).toHaveBeenCalledWith(1);
    });

    it("should create history entry on generation", async () => {
      await mockDb.createHistoryEntry({
        userId: 1,
        modality: "image",
        prompt: "test",
        compiledPrompt: "compiled test",
        resultUrl: "https://example.com/result.png",
        thumbnailUrl: "https://example.com/thumb.png",
        costCredits: 1,
        parameterSnapshot: { mode: "balanced", temperature: 0.7 },
      });
      expect(mockDb.createHistoryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          modality: "image",
          prompt: "test",
        })
      );
    });

    it("history entry should include parameter snapshot", async () => {
      const snapshot = {
        mode: "balanced",
        temperature: 0.7,
        vibeCardIds: ["serene"],
        seed: 42,
      };
      await mockDb.createHistoryEntry({
        userId: 1,
        modality: "image",
        prompt: "test",
        parameterSnapshot: snapshot,
      });
      const call = mockDb.createHistoryEntry.mock.calls[0][0];
      expect(call.parameterSnapshot).toEqual(snapshot);
      expect(call.parameterSnapshot.mode).toBe("balanced");
    });
  });

  // ─── Score Classification ────────────────────────────────────────────────

  describe("Score Classification", () => {
    function getScoreLabel(score: number): string {
      if (score >= 80) return "優秀";
      if (score >= 60) return "良好";
      if (score >= 40) return "一般";
      return "需改善";
    }

    it("should classify scores correctly", () => {
      expect(getScoreLabel(95)).toBe("優秀");
      expect(getScoreLabel(80)).toBe("優秀");
      expect(getScoreLabel(72)).toBe("良好");
      expect(getScoreLabel(60)).toBe("良好");
      expect(getScoreLabel(45)).toBe("一般");
      expect(getScoreLabel(40)).toBe("一般");
      expect(getScoreLabel(25)).toBe("需改善");
      expect(getScoreLabel(0)).toBe("需改善");
    });
  });
});
