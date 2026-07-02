/**
 * compositionSuggestionService.test.ts — AIDV-847 AI 構圖建議生成驗收
 *
 * Source-anchored：錨定 generateCompositionSuggestions / buildCompositionPrompt
 * 的真實行為（prompt 內容、runName、strict json_schema、格式驗證、超量裁切、
 * 失敗 throw），任一處被改壞即紅。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// invokeLLM 必須在 import 受測模組前被 mock（vi.mock factory 會被 hoist）。
vi.mock("../../_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("../../_core/llm")>();
  return {
    ...actual,
    invokeLLM: vi.fn(),
  };
});

import { invokeLLM } from "../../_core/llm";
import {
  generateCompositionSuggestions,
  buildCompositionPrompt,
} from "../compositionSuggestionService";
import type { CompositionSuggestionRequest } from "../../../shared/worldbuilding-timeline";

const mockedInvokeLLM = vi.mocked(invokeLLM);

function llmJsonReply(payload: unknown) {
  return {
    id: "test",
    created: Date.now(),
    choices: [
      { message: { content: JSON.stringify(payload), role: "assistant" } },
    ],
  } as unknown as Awaited<ReturnType<typeof invokeLLM>>;
}

const sampleWorld = {
  name: "晨霧療癒森林",
  description: "被霧氣覆蓋的森林",
  genre: "療癒",
  era: "現代奇幻",
  scenesJson: [
    {
      id: "scene-lake",
      name: "霧中湖畔",
      environment: "清晨的湖邊，薄霧未散",
      mood: "寧靜",
      lighting: "低角度暖色晨光",
    },
  ],
};

const sampleRequest: CompositionSuggestionRequest = {
  worldId: 1,
  elements: [
    {
      id: "el-hero",
      type: "character",
      characterId: "char-hero",
      position: { x: 1400, y: 300 },
      size: { width: 400, height: 600 },
      zIndex: 2,
      pose: "側身遠望",
    },
    {
      id: "el-lantern",
      type: "object",
      objectId: "obj-lantern",
      position: { x: 200, y: 700 },
      size: { width: 120, height: 180 },
      zIndex: 1,
      rotation: 15,
      opacity: 0.8,
    },
  ],
  backgroundSceneId: "scene-lake",
  focusGoal: "depth",
  canvasWidth: 1920,
  canvasHeight: 1080,
};

const validSuggestion = {
  type: "focus" as const,
  title: "引導視線至主角",
  content: "把 #2 燈籠沿對角線移向 (600, 550)，形成指向主角的視覺引導線。",
};

describe("buildCompositionPrompt", () => {
  it("包含世界脈絡、畫布尺寸、元素佈局、背景場景與構圖目標", () => {
    const prompt = buildCompositionPrompt(sampleWorld, sampleRequest);

    // 世界脈絡
    expect(prompt).toContain("晨霧療癒森林");
    expect(prompt).toContain("療癒");
    // 畫布尺寸（AIDV-847 加性欄位）
    expect(prompt).toContain("1920x1080");
    // 元素佈局：位置 / 尺寸 / 層級 / 姿勢 / 旋轉
    expect(prompt).toContain("位置(1400, 300)");
    expect(prompt).toContain("尺寸 400x600");
    expect(prompt).toContain("z=2");
    expect(prompt).toContain("側身遠望");
    expect(prompt).toContain("旋轉 15°");
    expect(prompt).toContain("不透明度 0.8");
    // 背景場景由 scenesJson 依 backgroundSceneId 查出
    expect(prompt).toContain("霧中湖畔");
    expect(prompt).toContain("低角度暖色晨光");
    // 構圖目標
    expect(prompt).toContain("景深層次");
  });

  it("無元素時標示畫布為空；無畫布尺寸時標示未提供", () => {
    const prompt = buildCompositionPrompt(
      { name: "空世界" },
      { worldId: 1, elements: [] }
    );
    expect(prompt).toContain("畫布目前沒有元素");
    expect(prompt).toContain("未提供");
  });

  it("backgroundSceneId 找不到對應場景時不注入背景區塊", () => {
    const prompt = buildCompositionPrompt(sampleWorld, {
      worldId: 1,
      elements: [],
      backgroundSceneId: "scene-nonexistent",
    });
    expect(prompt).not.toContain("背景場景");
  });
});

describe("generateCompositionSuggestions", () => {
  beforeEach(() => {
    mockedInvokeLLM.mockReset();
  });

  it("以 strict json_schema 呼叫 LLM 並回傳解析後的建議", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({ suggestions: [validSuggestion] })
    );

    const suggestions = await generateCompositionSuggestions({
      world: sampleWorld,
      request: sampleRequest,
    });

    expect(mockedInvokeLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockedInvokeLLM.mock.calls[0][0];
    expect(callArgs.runName).toBe("worldbuilding-composition-suggestions");
    expect(callArgs.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "composition_suggestions", strict: true },
    });
    const userMessage = callArgs.messages.find(m => m.role === "user");
    expect(userMessage?.content as string).toContain("晨霧療癒森林");

    expect(suggestions).toEqual([validSuggestion]);
  });

  it("LLM 回傳超過 5 條時裁切到 5 條", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      type: "layout" as const,
      title: `建議 ${i + 1}`,
      content: `內容 ${i + 1}`,
    }));
    mockedInvokeLLM.mockResolvedValueOnce(llmJsonReply({ suggestions: seven }));

    const suggestions = await generateCompositionSuggestions({
      world: sampleWorld,
      request: sampleRequest,
    });
    expect(suggestions).toHaveLength(5);
    expect(suggestions[0].title).toBe("建議 1");
  });

  it("LLM 回傳格式錯誤（type 不在 enum）時 throw", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        suggestions: [{ type: "symmetry", title: "x", content: "y" }],
      })
    );

    await expect(
      generateCompositionSuggestions({ world: sampleWorld, request: sampleRequest })
    ).rejects.toThrow(/構圖建議回應格式錯誤/);
  });

  it("LLM 回傳空 suggestions 陣列時 throw（min 1）", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(llmJsonReply({ suggestions: [] }));

    await expect(
      generateCompositionSuggestions({ world: sampleWorld, request: sampleRequest })
    ).rejects.toThrow(/構圖建議回應格式錯誤/);
  });

  it("LLM 呼叫失敗時把錯誤往外拋（降級由 router 決定）", async () => {
    mockedInvokeLLM.mockRejectedValueOnce(new Error("engine down"));

    await expect(
      generateCompositionSuggestions({ world: sampleWorld, request: sampleRequest })
    ).rejects.toThrow("engine down");
  });
});
