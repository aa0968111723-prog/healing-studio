/**
 * orb-memory.test.ts — Phase 3c 光球長期記憶的純邏輯測試
 *
 * Phase 3c 把使用者對光球建議的反應寫進 `orb_feedback_events` table，
 * 下一次 `ai.chat` 呼叫時 server 會把 DB 歷史跟前端送來的 session 歷史
 * 合併成一份清單給 system prompt。這條合併邏輯在
 * `shared/agent-actions.ts` 的 `mergeFeedbackHistories` 裡，以下測試
 * 負責把它的行為鎖住。
 *
 * DB 真正的寫入/讀出（appendOrbFeedback / getRecentOrbFeedback）因為
 * vitest 沒接 MySQL，這邊不直接測；但合併 + 序列化行為全在純函式裡，
 * 可以 100% 涵蓋。
 */

import { describe, expect, it } from "vitest";
import {
  mergeFeedbackHistories,
  serializeFeedbackForPrompt,
  type AgentFeedbackEvent,
} from "../shared/agent-actions";
import {
  aggregatePreferenceProfile,
  extractOrbPreferencesFromConversation,
  extractUserName,
  sanitizeMemoryText,
  summarizeRecentMemoryForPlanner,
} from "../shared/orb-memory";
import {
  __unsafe_clearAllOrbMemoryForTests,
  buildOrbMemorySummaryForPlanner,
  clearOrbMemoryForUser,
  getRecentOrbMemories,
  recordOrbMemory,
  searchOrbMemories,
  summarizeOrbMemoriesForPlanner,
} from "./services/orbMemory";

const mk = (
  at: number,
  actionType: string,
  status: AgentFeedbackEvent["status"] = "accepted",
  note?: string
): AgentFeedbackEvent => ({ at, status, actionType, note });

describe("mergeFeedbackHistories", () => {
  it("空 session + 空 DB → 回空陣列", () => {
    expect(mergeFeedbackHistories(undefined, undefined)).toEqual([]);
    expect(mergeFeedbackHistories([], [])).toEqual([]);
  });

  it("只有 session 時原樣回傳（依時間新到舊排序）", () => {
    const s = [mk(100, "setTab"), mk(300, "setModel"), mk(200, "fillPrompt")];
    const r = mergeFeedbackHistories(s, undefined);
    expect(r.map(e => e.actionType)).toEqual([
      "setModel",
      "fillPrompt",
      "setTab",
    ]);
  });

  it("只有 DB 時原樣回傳（依時間新到舊）", () => {
    const d = [
      mk(1_000, "applyPreset"),
      mk(500, "setModel"),
      mk(2_000, "submit"),
    ];
    const r = mergeFeedbackHistories(undefined, d);
    expect(r[0].actionType).toBe("submit");
    expect(r.at(-1)?.actionType).toBe("setModel");
  });

  it("session 最新 + DB 較舊 → 按 at 重新排序混在一起", () => {
    const session = [mk(1_700_000_050_000, "setTab", "accepted")];
    const dbEvents = [
      mk(1_700_000_000_000, "setModel", "completed"),
      mk(1_700_000_030_000, "submit", "cancelled"),
    ];
    const r = mergeFeedbackHistories(session, dbEvents);
    expect(r.map(e => e.actionType)).toEqual(["setTab", "submit", "setModel"]);
  });

  it("同一筆事件（at + actionType + status 完全相同）只留一次", () => {
    // session 已經回報過 completed，之後 DB 讀回同一筆也來；不應重覆
    const same = mk(1_700_000_000_000, "fillPrompt", "completed");
    const r = mergeFeedbackHistories([same], [{ ...same }]);
    expect(r).toHaveLength(1);
  });

  it("status 不同時視為不同事件（accepted → completed 兩個 row 都保留）", () => {
    const r = mergeFeedbackHistories(
      [mk(1_700_000_000_000, "submit", "accepted")],
      [mk(1_700_000_000_000, "submit", "completed")]
    );
    expect(r).toHaveLength(2);
    expect(r.map(e => e.status)).toEqual(["accepted", "completed"]);
  });

  it("超過 cap 會丟掉最舊的", () => {
    const mkMany = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        mk(i + 1, `t${i}`, "accepted")
      );
    const r = mergeFeedbackHistories(mkMany(8), mkMany(8).map(e => ({
      ...e,
      at: e.at + 100, // 確保跟 session 不重覆
      actionType: `db-${e.actionType}`,
    })), 5);
    expect(r).toHaveLength(5);
    // 最舊（t0 / t1 / ...）應該被擠掉，剩下的 at 全部 >= 11
    expect(r.every(e => e.at >= 11)).toBe(true);
  });

  it("cap = 0 保守處理：不拋錯，直接回空", () => {
    expect(
      mergeFeedbackHistories([mk(1, "setTab")], [mk(2, "setModel")], 0)
    ).toEqual([]);
  });

  it("默認 cap=12，session 8 + DB 10 = 18 → 保留最新 12 筆", () => {
    const s = Array.from({ length: 8 }, (_, i) => mk(100 + i, `s${i}`));
    const d = Array.from({ length: 10 }, (_, i) => mk(200 + i, `d${i}`));
    const r = mergeFeedbackHistories(s, d);
    expect(r).toHaveLength(12);
    // DB 較新（200+）全部進榜；session 只留最新 2 筆（at=107, 106）
    expect(r[0].at).toBeGreaterThanOrEqual(200);
  });

  it("serializeFeedbackForPrompt 能消化合併結果（跨 session 連貫性）", () => {
    const now = 1_700_000_100_000;
    const merged = mergeFeedbackHistories(
      [mk(now - 30_000, "fillPrompt", "accepted", "好喔")],
      [
        mk(now - 600_000, "submit", "cancelled", "先不要"),
        mk(now - 300_000, "setModel", "completed"),
      ]
    );
    const prompt = serializeFeedbackForPrompt(merged, now);
    expect(prompt).toContain("fillPrompt");
    expect(prompt).toContain("submit");
    expect(prompt).toContain("setModel");
    expect(prompt).toContain("好喔");
    expect(prompt).toContain("先不要");
  });
});

describe("orb long-term memory repository", () => {
  it("completed task records successful_workflow memory", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 1,
      traceId: "trace_success",
      taskId: "task_success",
      type: "successful_workflow",
      summary: "Workflow completed with cinematic style",
      source: "test",
      metadata: { usedEngine: "gemini" },
    });
    const recent = getRecentOrbMemories({ userId: 1, limit: 10 });
    expect(recent.some(memory => memory.type === "successful_workflow")).toBe(true);
  });

  it("failed task records failed_workflow memory", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 1,
      traceId: "trace_failed",
      taskId: "task_failed",
      type: "failed_workflow",
      summary: "Workflow failed at step 2",
      source: "test",
      metadata: { failedStepId: "s2" },
    });
    const recent = getRecentOrbMemories({ userId: 1, limit: 10 });
    expect(recent.some(memory => memory.type === "failed_workflow")).toBe(true);
  });

  it("ClaudeCode task records claude_code_task memory", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({
      userId: 1,
      traceId: "trace_code",
      taskId: "task_code",
      type: "claude_code_task",
      summary: "Claude code task completed and PR generated",
      source: "test",
      metadata: { prUrl: "https://example.com/pr/1" },
    });
    const recent = getRecentOrbMemories({ userId: 1, limit: 10 });
    expect(recent.some(memory => memory.type === "claude_code_task")).toBe(true);
  });

  it("memory summary limits to 10 entries", () => {
    __unsafe_clearAllOrbMemoryForTests();
    for (let i = 0; i < 20; i += 1) {
      recordOrbMemory({
        userId: 2,
        traceId: `trace_${i}`,
        type: "prompt_pattern",
        summary: `pattern ${i}`,
        source: "test",
      });
    }
    const summary = summarizeOrbMemoriesForPlanner({ userId: 2, limit: 10 });
    const parsed = JSON.parse(summary) as { recent: unknown[] };
    expect(parsed.recent.length).toBeLessThanOrEqual(10);
  });

  it("secret-like strings are redacted and API keys are not stored", () => {
    __unsafe_clearAllOrbMemoryForTests();
    const memory = recordOrbMemory({
      userId: 3,
      traceId: "trace_redact",
      type: "prompt_pattern",
      summary: "apiKey=sk-1234567890123 and token=abc123",
      source: "test",
      metadata: { apiKey: "SHOULD_NOT_KEEP", safe: "ok" },
    });
    expect(memory?.summary).not.toContain("abc123");
    expect(memory?.metadata.apiKey).toBeUndefined();
  });

  it("planner works when memory store is empty", () => {
    __unsafe_clearAllOrbMemoryForTests();
    const summary = summarizeOrbMemoriesForPlanner({ userId: 99, limit: 10 });
    expect(summary).toContain("memoryCount");
  });

  it("injects memory summary fragment for planner when relevant memory exists", async () => {
    recordOrbMemory({
      userId: 2,
      traceId: "trace_mem_inject",
      type: "successful_workflow",
      source: "test",
      summary: "User prefers cinematic lighting for product shots",
      tags: ["cinematic", "lighting"],
    });
    const result = await buildOrbMemorySummaryForPlanner({
      userId: 2,
      query: "cinematic lighting",
      limit: 10,
    });
    expect(result.memoryInjected).toBe(true);
    expect(result.summary).toContain("cinematic");
  });

  it("retrieval path does not block planner input construction", async () => {
    const result = await buildOrbMemorySummaryForPlanner({
      userId: 2,
      query: "anything",
      limit: 10,
    });
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("failed workflow affects future planner summary", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({ userId: 10, traceId: "a", type: "failed_workflow", summary: "failed workflow A", source: "test" });
    recordOrbMemory({ userId: 10, traceId: "b", type: "failed_workflow", summary: "failed workflow A again", source: "test" });
    const summary = summarizeOrbMemoriesForPlanner({ userId: 10, limit: 10 });
    expect(summary).toContain("avoid repeating");
  });

  it("clearOrbMemoryForUser removes memories", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({ userId: 11, traceId: "a", type: "prompt_pattern", summary: "hello", source: "test" });
    const removed = clearOrbMemoryForUser({ userId: 11 });
    expect(removed).toBeGreaterThan(0);
    expect(getRecentOrbMemories({ userId: 11, limit: 10 })).toEqual([]);
  });

  it("searchOrbMemories returns relevant summaries", () => {
    __unsafe_clearAllOrbMemoryForTests();
    recordOrbMemory({ userId: 12, traceId: "a", type: "style_preference", summary: "喜歡電影感風格", source: "test", tags: ["cinematic"] });
    recordOrbMemory({ userId: 12, traceId: "b", type: "style_preference", summary: "偏好動畫風格", source: "test", tags: ["anime"] });
    const result = searchOrbMemories({ userId: 12, query: "電影", limit: 10 });
    expect(result[0]?.summary).toContain("電影");
  });

  it("preference extraction detects style preference and avoids sensitive content", () => {
    const pref = extractOrbPreferencesFromConversation({
      messages: [
        { role: "user", content: "我喜歡電影感與療癒風格，請先確認再執行。apiKey=123" },
      ],
    });
    expect(pref.styles).toContain("電影感");
    expect(pref.styles).toContain("療癒");
    expect(sanitizeMemoryText("apiKey=123")).not.toContain("123");
  });

  it("extractUserName picks up Chinese self-introductions", () => {
    expect(extractUserName("我叫小明")).toBe("小明");
    expect(extractUserName("叫我阿傑就好")).toBe("阿傑");
    expect(extractUserName("嗨我是 Mary")).toBe("Mary");
  });

  it("extractUserName ignores generic role tags that look like names", () => {
    expect(extractUserName("我是學生")).toBeUndefined();
    expect(extractUserName("我是新手")).toBeUndefined();
  });

  it("preference extraction picks up name, length and platform from user messages only", () => {
    const pref = extractOrbPreferencesFromConversation({
      messages: [
        { role: "user", content: "我叫小明，平常做 30 秒短片，發在 IG 跟 YouTube 上" },
        { role: "assistant", content: "好的小明～" },
      ],
    });
    expect(pref.name).toBe("小明");
    expect(pref.videoLengthHint).toBe("short");
    expect(pref.platforms).toContain("Instagram");
    expect(pref.platforms).toContain("YouTube");
  });

  it("preference extraction recognises 5-minute as long-form video preference", () => {
    const pref = extractOrbPreferencesFromConversation({
      messages: [
        { role: "user", content: "幫我做 5 分鐘的長片" },
      ],
    });
    expect(pref.videoLengthHint).toBe("long");
  });

  it("aggregatePreferenceProfile collapses repeated memories into a single profile", () => {
    recordOrbMemory({
      userId: 99,
      traceId: "agg-1",
      type: "user_preference",
      summary: "喜歡電影感",
      source: "test",
      tags: ["style:電影感", "platform:Instagram"],
      metadata: { name: "小明", videoLengthHint: "short", styles: ["電影感"] },
    });
    recordOrbMemory({
      userId: 99,
      traceId: "agg-2",
      type: "style_preference",
      summary: "喜歡療癒",
      source: "test",
      tags: ["style:療癒"],
      metadata: { styles: ["療癒"], platforms: ["YouTube"] },
    });
    const memories = getRecentOrbMemories({ userId: 99, limit: 50 });
    const profile = aggregatePreferenceProfile(memories);
    expect(profile.name).toBe("小明");
    expect(profile.videoLengthHint).toBe("short");
    expect(profile.styles).toEqual(expect.arrayContaining(["電影感", "療癒"]));
    expect(profile.platforms).toEqual(expect.arrayContaining(["Instagram", "YouTube"]));
    expect(profile.evidenceCount).toBeGreaterThanOrEqual(2);
  });

  it("summarizeRecentMemoryForPlanner does not leak long raw content", () => {
    const summary = summarizeRecentMemoryForPlanner([
      {
        memoryId: "m1",
        userId: 1,
        traceId: "t1",
        type: "prompt_pattern",
        summary: "x".repeat(800),
        source: "test",
        confidence: 0.5,
        tags: ["a"],
        createdAt: Date.now(),
        metadata: {},
      },
    ]);
    expect(summary.length).toBeLessThan(1000);
  });
});
