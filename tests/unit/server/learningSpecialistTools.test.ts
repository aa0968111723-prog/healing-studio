/**
 * Unit tests for 學學 (learning-specialist) tools.
 *
 * 守住三個關鍵契約：
 *   1. listTutorials() 列出的 5 個 id 全部都能在 getTutorial() 拿到（之前 bug：
 *      只實作 2 個，問 prompt-engineering / lora-training / workflow-automation
 *      直接 404）。
 *   2. searchLearningContent 真的會翻 LearnHub 種子資料；找不到時回 success:false。
 *   3. generateLearningPath 對主要 keyword（lora / 短影音 / prompt / 新手）
 *      都能 match 到一條學習路徑，不會空轉。
 *   4. explainConcept 對內建概念（lora / negative prompt / controlnet）回完整
 *      what/why/example；未知概念回 success:false 並列出可選概念。
 *   5. recommendForContext 對 /image-studio 等已知頁面，會推出 LearnHub 的真實
 *      doc，不是憑空捏。
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

// orbFeatureDiscovery 會打 DB — mock 掉避免測試需要 DB 連線
vi.mock("../../../server/services/orbFeatureDiscovery", () => ({
  orbFeatureDiscovery: {
    getUserStats: vi.fn().mockResolvedValue([]),
    generateRecommendations: vi.fn().mockResolvedValue([]),
  },
}));

import {
  getTutorial,
  listTutorials,
  getQuickTips,
  searchLearningContent,
  recommendForContext,
  generateLearningPath,
  explainConcept,
  getUserLearningProgress,
  getNextLearningStep,
  __setLearnHubForTest,
} from "../../../server/services/spiritTools/learningSpecialistTools";

// vitest 環境下 dynamic import("../../routers/learnHub") 會碰到 ESM/TS 解析問題；
// 用 __setLearnHubForTest 注入一個小型 stub（涵蓋 prompt / image-studio 相關
// category），讓 searchLearningContent 和 recommendForContext 可以驗證真實邏輯。
beforeAll(() => {
  __setLearnHubForTest({
    docs: [
      {
        id: "gs-001",
        category: "getting-started",
        title: "Healing Studio 完整入門指南",
        summary: "5 分鐘快速了解平台所有功能",
        difficulty: "beginner",
        readingMinutes: 8,
        featured: true,
      },
      {
        id: "tech-prompt-mastery",
        category: "technique",
        title: "Prompt Mastery — 進階提示詞工程",
        summary: "深入講解 prompt 結構、權重、negative prompt",
        difficulty: "intermediate",
        readingMinutes: 18,
        featured: true,
      },
      {
        id: "mg-001",
        category: "model-guide",
        title: "Flux / SDXL / SD3 模型總覽",
        summary: "比較圖片生成主流模型",
        difficulty: "intermediate",
        readingMinutes: 12,
        featured: true,
      },
      {
        id: "deep-lora-trainer",
        category: "technique",
        title: "深入 LoRA Trainer",
        summary: "從資料集備齊到訓練參數，一條龍 LoRA 教學",
        difficulty: "advanced",
        readingMinutes: 25,
        featured: false,
      },
    ],
    videos: [
      {
        id: "video-001",
        category: "getting-started",
        title: "Healing Studio 快速入門",
        summary: "5 分鐘導覽影片",
        difficulty: "beginner",
        durationMinutes: 5,
        featured: true,
      },
    ],
    quizzes: [],
  });
});

describe("learningSpecialistTools — getTutorial / listTutorials 契約", () => {
  it("listTutorials() 列出的每個 id 都能在 getTutorial() 拿到（修補舊 bug）", () => {
    const list = listTutorials();
    expect(list.success).toBe(true);
    expect(list.tutorials.length).toBeGreaterThanOrEqual(5);
    for (const t of list.tutorials) {
      const detail = getTutorial(t.id);
      expect(detail.success).toBe(true);
      expect(detail.tutorial?.id).toBe(t.id);
      expect(detail.tutorial?.steps.length).toBeGreaterThan(0);
    }
  });

  it("getTutorial 對未知 id 回 success:false 並列出可選 id", () => {
    const result = getTutorial("nonexistent-tutorial");
    expect(result.success).toBe(false);
    expect(result.message).toContain("找不到");
    expect(result.message).toContain("image-generation");
  });

  it("舊 bug 的三個 id 現在都拿得到 — prompt-engineering / lora-training / workflow-automation", () => {
    for (const id of ["prompt-engineering", "lora-training", "workflow-automation"]) {
      const result = getTutorial(id);
      expect(result.success, `${id} should be defined`).toBe(true);
      expect(result.tutorial?.steps.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("learningSpecialistTools — searchLearningContent", () => {
  it("空 query → 回 success:false", () => {
    const result = searchLearningContent({ query: "   " });
    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
  });

  it("常見關鍵字 'prompt' 能在 LearnHub 找到 doc", () => {
    const result = searchLearningContent({ query: "prompt", limit: 5 });
    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.deepLink).toMatch(/^\/learn-hub\?/);
      expect(r.id).toBeDefined();
    }
  });

  it("type='doc' 只回 doc，不會混 video / quiz", () => {
    const result = searchLearningContent({ query: "入門", type: "doc", limit: 10 });
    if (result.success) {
      for (const r of result.results) {
        expect(r.kind).toBe("doc");
      }
    }
  });

  it("非常冷僻的關鍵字 → 回 success:false 並給友善訊息", () => {
    const result = searchLearningContent({ query: "asdfasdfasdf-不存在的關鍵字-xyz" });
    expect(result.success).toBe(false);
    expect(result.message).toContain("沒有命中");
  });
});

describe("learningSpecialistTools — generateLearningPath", () => {
  it("空 goal → 回 success:false", () => {
    const result = generateLearningPath({ goal: "  " });
    expect(result.success).toBe(false);
  });

  it("match 'lora' keyword → 回完整訓練路徑", () => {
    const result = generateLearningPath({ goal: "我想訓我自己的 lora 模型" });
    expect(result.success).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.goalLabel).toMatch(/LoRA/i);
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.totalMinutes).toBeGreaterThan(0);
    expect(result.finalActionPath).toBe("/models");
  });

  it("match '短影音' keyword → 回社群影音路徑", () => {
    const result = generateLearningPath({ goal: "我想做 ig 短影音" });
    expect(result.success).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.finalActionPath).toBe("/video-studio");
  });

  it("match '新手' → 回入門路徑", () => {
    const result = generateLearningPath({ goal: "我是新手不知道怎麼開始" });
    expect(result.success).toBe(true);
    expect(result.matched).toBe(true);
    expect(result.level).toBe("beginner");
  });

  it("沒命中 keyword → 仍給 fallback 路徑（matched:false 但 success:true）", () => {
    const result = generateLearningPath({ goal: "完全不相關的奇怪目標 zzz" });
    expect(result.success).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.steps.length).toBeGreaterThan(0);
  });
});

describe("learningSpecialistTools — explainConcept", () => {
  it("空 concept → 回 success:false", () => {
    const result = explainConcept({ concept: "" });
    expect(result.success).toBe(false);
  });

  it("'LoRA' → 回完整 what/why/example + 相關 doc deep-link", () => {
    const result = explainConcept({ concept: "LoRA" });
    expect(result.success).toBe(true);
    expect(result.explanation?.what).toMatch(/LoRA|增益/);
    expect(result.explanation?.why.length).toBeGreaterThan(10);
    expect(result.explanation?.example.length).toBeGreaterThan(10);
    expect(result.explanation?.relatedDocs.length).toBeGreaterThan(0);
    expect(result.explanation?.relatedDocs[0].deepLink).toMatch(/^\/learn-hub\?docId=/);
  });

  it("level=beginner 會切換到簡化版說明", () => {
    const beginner = explainConcept({ concept: "LoRA", level: "beginner" });
    const intermediate = explainConcept({ concept: "LoRA", level: "intermediate" });
    expect(beginner.explanation?.what).not.toBe(intermediate.explanation?.what);
  });

  it("'negative prompt' / 'ControlNet' / 'workflow' 都有定義", () => {
    for (const c of ["negative prompt", "ControlNet", "workflow", "trigger word", "image-to-video"]) {
      const result = explainConcept({ concept: c });
      expect(result.success, `${c} should be defined`).toBe(true);
    }
  });

  it("未知概念 → 回 success:false 並列出已知概念", () => {
    const result = explainConcept({ concept: "完全沒聽過的東西 zzz" });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/lora|negative|controlnet/i);
  });
});

describe("learningSpecialistTools — recommendForContext", () => {
  it("/image-studio 會推 model-guide / technique 類的 LearnHub 真實 doc", () => {
    const result = recommendForContext({ currentPath: "/image-studio", limit: 5 });
    expect(result.success).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.basis.categories.length).toBeGreaterThan(0);
    for (const r of result.recommendations) {
      expect(r.deepLink).toMatch(/^\/learn-hub\?docId=/);
      expect(r.id).toBeDefined();
      expect(r.matchReason.length).toBeGreaterThan(0);
    }
  });

  it("無 path / topic → 仍 fallback 到 getting-started", () => {
    const result = recommendForContext({});
    expect(result.basis.categories).toContain("getting-started");
  });

  it("topic='lora' → categories 含 technique", () => {
    const result = recommendForContext({ topic: "lora", limit: 3 });
    expect(result.basis.categories).toContain("technique");
  });
});

describe("learningSpecialistTools — getNextLearningStep", () => {
  it("沒任何輸入 → fallback 到 gs-001 入門指南", async () => {
    const result = await getNextLearningStep({});
    expect(result.success).toBe(true);
    expect(result.nextStep.resourceId).toBe("gs-001");
  });

  it("有 hint='訓 LoRA' → 給 LoRA 路徑的第一步", async () => {
    const result = await getNextLearningStep({ hint: "我想訓 LoRA" });
    expect(result.success).toBe(true);
    expect(result.nextStep.reason).toMatch(/LoRA/i);
  });

  it("currentPath=/image-studio → 給 LearnHub 推薦的第一篇", async () => {
    const result = await getNextLearningStep({ currentPath: "/image-studio" });
    expect(result.success).toBe(true);
    expect(result.nextStep.deepLink).toMatch(/^\/learn-hub\?docId=/);
  });
});

describe("learningSpecialistTools — getUserLearningProgress (mocked DB)", () => {
  it("DB 空 → 回 beginner + 空陣列，不爆炸", async () => {
    const result = await getUserLearningProgress({ userId: 1 });
    expect(result.success).toBe(true);
    expect(result.level).toBe("beginner");
    expect(result.features.mastered).toEqual([]);
  });
});

describe("learningSpecialistTools — getQuickTips", () => {
  it("回 6+ 條 tip", () => {
    const result = getQuickTips();
    expect(result.success).toBe(true);
    expect(result.tips.length).toBeGreaterThanOrEqual(6);
  });
});
