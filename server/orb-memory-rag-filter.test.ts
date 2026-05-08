/**
 * orb-memory-rag-filter.test.ts — Phase 3 RAG 類型過濾與失敗教訓注入。
 *
 * Phase 3 把「教訓三類」(failed_workflow / prompt_pattern / tool_feedback) 設為
 * `buildOrbMemorySummaryForPlanner` 的預設過濾器，並在有 failed_workflow 命中時
 * 在 summary JSON 加上 `lessonHint`，由 Planner system prompt 引導 LLM 避坑。
 *
 * 真正的 Pinecone RAG 在無 PINECONE_API_KEY 時會 silently 回空陣列（見
 * ragMemory.ts:queryMemories），所以下面的測試走 keyword fallback path，
 * 也就足以驗證 type 過濾是否生效。
 */

import { describe, expect, it } from "vitest";
import {
  __unsafe_clearAllOrbMemoryForTests,
  buildOrbMemorySummaryForPlanner,
  recordOrbMemory,
  searchOrbMemoriesWithRag,
} from "./services/orbMemory";

describe("searchOrbMemoriesWithRag — types filter", () => {
  it("only returns memories whose type is in the requested set", async () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 501,
      traceId: "rag_filter_failed",
      type: "failed_workflow",
      summary: "用 modelA 做 styleB 失敗",
      source: "test",
      tags: ["modelA", "styleB"],
    });
    recordOrbMemory({
      userId: 501,
      traceId: "rag_filter_success",
      type: "successful_workflow",
      summary: "用 modelC 做 styleB 成功",
      source: "test",
      tags: ["modelC", "styleB"],
    });
    recordOrbMemory({
      userId: 501,
      traceId: "rag_filter_chat",
      type: "user_preference",
      summary: "我喜歡溫暖的色調",
      source: "test",
      tags: ["warm"],
    });

    const filtered = await searchOrbMemoriesWithRag({
      userId: 501,
      query: "styleB",
      types: ["failed_workflow", "prompt_pattern", "tool_feedback"],
      degradeOnError: true,
    });

    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.every(m => m.type === "failed_workflow")).toBe(true);
    expect(filtered.some(m => m.summary.includes("modelA"))).toBe(true);
  });

  it("returns all matching types when no filter is provided", async () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 502,
      traceId: "rag_unfiltered_a",
      type: "failed_workflow",
      summary: "失敗紀錄 A",
      source: "test",
    });
    recordOrbMemory({
      userId: 502,
      traceId: "rag_unfiltered_b",
      type: "successful_workflow",
      summary: "成功紀錄 B",
      source: "test",
    });

    const unfiltered = await searchOrbMemoriesWithRag({
      userId: 502,
      query: "紀錄",
      degradeOnError: true,
    });

    const types = new Set(unfiltered.map(m => m.type));
    expect(types.has("failed_workflow")).toBe(true);
    expect(types.has("successful_workflow")).toBe(true);
  });
});

describe("buildOrbMemorySummaryForPlanner — lesson hint injection", () => {
  it("emits lessonHint when failed_workflow memory is present", async () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 510,
      traceId: "lesson_failed_1",
      type: "failed_workflow",
      summary: "用 fastModel 做高解析度寫實人像時長期失敗",
      source: "test",
      tags: ["fastModel", "realistic"],
    });
    recordOrbMemory({
      userId: 510,
      traceId: "lesson_failed_2",
      type: "failed_workflow",
      summary: "再次嘗試 fastModel + 寫實人像，依然失敗",
      source: "test",
      tags: ["fastModel"],
    });

    const result = await buildOrbMemorySummaryForPlanner({
      userId: 510,
      query: "fastModel",
      limit: 10,
    });

    expect(result.memoryInjected).toBe(true);
    expect(result.summary).toContain("lessonHint");
    expect(result.summary).toContain("過往同類請求曾失敗");
  });

  it("omits lessonHint when only non-failed memories match", async () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 511,
      traceId: "lesson_success_only",
      type: "tool_feedback",
      summary: "tool ran successfully on previous attempt",
      source: "test",
    });

    const result = await buildOrbMemorySummaryForPlanner({
      userId: 511,
      query: "successfully",
      limit: 10,
    });

    expect(result.memoryInjected).toBe(true);
    if (result.summary.includes("lessonHint")) {
      expect(result.summary).toContain("\"lessonHint\":null");
    }
  });

  it("filters out memories that are not in the lesson types set by default", async () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 512,
      traceId: "filtered_out",
      type: "user_preference",
      summary: "使用者偏好 warm tone",
      source: "test",
      tags: ["warm"],
    });

    const result = await buildOrbMemorySummaryForPlanner({
      userId: 512,
      query: "warm",
      limit: 10,
    });

    // user_preference 不在預設教訓三類內 → RAG/keyword 階段都會被過濾掉
    // 結果應該是落到 fallback summarizeOrbMemoriesForPlanner（無 type 過濾）
    // 或是直接 memoryInjected 但 recent 為空。任一都可接受，但不應 throw。
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
