/**
 * AIDV-561: orbClarificationEngine 澄清生成收斂測試
 * ──────────────────────────────────────────────────────────────────────────
 *   1. generateClarification 的 LLM prompt 會帶入「對話 context」（取代原 TODO 佔位）。
 *   2. LLM 失敗 → 誠實降級：通用問題＋以偵測到的意圖組選項（非假裝智慧生成）。
 *   3. needsClarification=false → 不生成（回 null）。
 *   4. 死 stub predictClarificationNeed（零 callsite、永回固定值）已依卡上結論移除。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// 隔離 DB：getDb 回 null → 走「無 DB」路徑（pattern 查詢降級、跳過持久化）。
const mockGetDb = vi.fn();
vi.mock("./db", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
}));

// 隔離 LLM：捕捉 prompt、可控成功/失敗。
const mockInvokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({
  invokeLLM: (...args: unknown[]) => mockInvokeLLM(...args),
  extractMessageText: (content: unknown) => String(content ?? ""),
}));

import { orbClarificationEngine, type IntentLog } from "./services/orbClarificationEngine";

function makeIntentLog(overrides: Partial<IntentLog> = {}): IntentLog {
  return {
    id: "42",
    userId: 7,
    conversationId: "conv-1",
    userInput: "幫我弄一下那個影片",
    detectedIntents: [
      { intent: "create_video", confidence: 0.55, category: "video" },
      { intent: "edit_video", confidence: 0.5, category: "video" },
    ],
    needsClarification: true,
    createdAt: new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockGetDb.mockResolvedValue(null);
  mockInvokeLLM.mockReset();
});

describe("generateClarification（LLM 生成＋context 注入）", () => {
  it("intentLog.context 會注入 LLM user prompt（AIDV-561 取代 TODO 佔位）", async () => {
    mockInvokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              question: "您想建立新影片，還是編輯現有影片？",
              questionType: "choice",
              options: [
                { value: "create_video", label: "建立新影片" },
                { value: "edit_video", label: "編輯現有影片" },
              ],
            }),
          },
        },
      ],
    });

    const q = await orbClarificationEngine.generateClarification(
      makeIntentLog({ context: { page: "studio", projectId: 99 } }),
    );

    expect(q).not.toBeNull();
    expect(q?.clarificationQuestion).toBe("您想建立新影片，還是編輯現有影片？");
    expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
    const call = mockInvokeLLM.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const userMsg = call.messages.find(m => m.role === "user");
    expect(userMsg?.content).toContain('Conversation context: {"page":"studio","projectId":99}');
    expect(userMsg?.content).toContain("create_video");
  });

  it("LLM 失敗 → 誠實降級：通用問題＋意圖清單選項（含相關度）", async () => {
    mockInvokeLLM.mockRejectedValue(new Error("llm down"));

    const q = await orbClarificationEngine.generateClarification(makeIntentLog());

    expect(q).not.toBeNull();
    expect(q?.clarificationQuestion).toBe("您想要做什麼？請告訴我更多細節。");
    expect(q?.questionType).toBe("choice");
    expect(q?.options).toEqual([
      { value: "create_video", label: "create_video", description: "相關度: 55%" },
      { value: "edit_video", label: "edit_video", description: "相關度: 50%" },
    ]);
  });

  it("needsClarification=false → 不生成（回 null、不呼叫 LLM）", async () => {
    const q = await orbClarificationEngine.generateClarification(
      makeIntentLog({ needsClarification: false }),
    );
    expect(q).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });
});

describe("死 stub 清除（AIDV-561）", () => {
  it("predictClarificationNeed 已移除（原為零 callsite、永回固定值的假實作）", () => {
    // 若要重新引入此 API，必須是真實預測邏輯並更新本測試——不得回填固定值 stub。
    expect(
      (orbClarificationEngine as unknown as Record<string, unknown>).predictClarificationNeed,
    ).toBeUndefined();
  });
});
