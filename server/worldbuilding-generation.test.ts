import { describe, it, expect, vi, beforeEach } from "vitest";

// invokeLLM 必須在 import 受測模組前被 mock。
// vi.mock 的 factory 會被 hoist 到檔案最頂，所以 mock value 必須 inline。
vi.mock("./_core/llm", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/llm")>();
  return {
    ...actual,
    invokeLLM: vi.fn(),
  };
});

import { invokeLLM } from "./_core/llm";
import {
  generateCharacter,
  generateScene,
} from "./services/worldbuildingGeneration";

const mockedInvokeLLM = vi.mocked(invokeLLM);

function llmJsonReply(payload: unknown) {
  return {
    id: "test",
    created: Date.now(),
    choices: [
      {
        message: { content: JSON.stringify(payload), role: "assistant" },
      },
    ],
  } as unknown as Awaited<ReturnType<typeof invokeLLM>>;
}

const sampleWorld = {
  name: "晨霧療癒森林",
  description: "一個被霧氣覆蓋的森林，住著修行者與靈獸",
  genre: "療癒",
  era: "現代奇幻",
  charactersJson: [{ name: "白雲僧" }],
  scenesJson: [],
};

describe("worldbuildingGeneration.generateCharacter", () => {
  beforeEach(() => {
    mockedInvokeLLM.mockReset();
  });

  it("呼叫 LLM 並回傳結構化角色", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "霧林行者",
        role: "protagonist",
        tagline: "在霧中尋找答案的旅人",
        personality: "寡言、敏銳，對自然有深刻的同理。",
        appearance: "中等身高，灰綠披風，瞳色琥珀。",
        backstory: "童年走失於森林，被白雲僧拾養，習得讀霧之術。",
        likes: ["晨霧", "靜坐"],
        interests: ["草藥學"],
        signatureItems: ["銅鈴杖"],
        notes: "與白雲僧為師徒關係",
      })
    );

    const character = await generateCharacter({
      world: sampleWorld,
      description: "一位在霧中行走的年輕旅人",
    });

    expect(mockedInvokeLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockedInvokeLLM.mock.calls[0][0];
    expect(callArgs.runName).toBe("worldbuilding-generate-character");
    expect(callArgs.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "worldbuilding_character", strict: true },
    });

    const userMessage = callArgs.messages.find(m => m.role === "user");
    expect(typeof userMessage?.content).toBe("string");
    expect(userMessage?.content as string).toContain("晨霧療癒森林");
    expect(userMessage?.content as string).toContain("白雲僧"); // 既有角色提示

    expect(character.id).toBeTruthy();
    expect(character.name).toBe("霧林行者");
    expect(character.role).toBe("protagonist");
    expect(character.likes).toEqual(["晨霧", "靜坐"]);
    expect(character.notes).toBe("與白雲僧為師徒關係");
  });

  it("archetype 會被寫入 prompt", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "陰影師",
        role: "antagonist",
        tagline: "從霧裡走出的反派",
        personality: "冷酷、城府深。",
        appearance: "高瘦，黑袍蒙面。",
        backstory: "曾為門中弟子，因爭執而墮入孤獨。",
        likes: [],
        interests: [],
        signatureItems: [],
        notes: "",
      })
    );

    await generateCharacter({
      world: sampleWorld,
      description: "一個從森林深處走出的對立者",
      archetype: "黑暗導師",
    });

    const userMessage = mockedInvokeLLM.mock.calls[0][0].messages.find(
      m => m.role === "user"
    );
    expect(userMessage?.content as string).toContain("黑暗導師");
  });

  it("LLM 回傳格式錯誤時拋出 TRPCError", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "缺欄位角色",
        role: "supporting",
        // 缺其他必填欄位
      })
    );

    await expect(
      generateCharacter({ world: sampleWorld, description: "test" })
    ).rejects.toThrow(/角色生成回應格式錯誤/);
  });

  it("LLM 回傳的 role 不在 enum 內時拋出格式錯誤", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "怪角色",
        role: "villain", // 不在 enum
        tagline: "x",
        personality: "x",
        appearance: "x",
        backstory: "x",
        likes: [],
        interests: [],
        signatureItems: [],
        notes: "",
      })
    );

    await expect(
      generateCharacter({ world: sampleWorld, description: "test" })
    ).rejects.toThrow(/角色生成回應格式錯誤/);
  });
});

describe("worldbuildingGeneration.generateScene", () => {
  beforeEach(() => {
    mockedInvokeLLM.mockReset();
  });

  it("呼叫 LLM 並回傳結構化場景", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "鏡湖晨霧",
        tagline: "一面映出心境的靜湖",
        environment: "湖面平靜如鏡，被晨霧環抱，岸邊蘆葦低垂。",
        mood: "寧靜、空靈，帶著一絲不可言喻的神聖感。",
        lighting: "黎明微光，色溫偏冷，光從霧中漫射。",
        flora: ["蘆葦", "白樺"],
        fauna: ["白鷺"],
        props: ["木橋", "石燈"],
        environmentChanges: ["日出後霧散", "雨後水位上升"],
        notes: "可作為主角靜心場景。",
      })
    );

    const scene = await generateScene({
      world: sampleWorld,
      description: "一座被晨霧包圍的湖泊",
      environmentType: "湖泊",
    });

    expect(mockedInvokeLLM).toHaveBeenCalledTimes(1);
    expect(mockedInvokeLLM.mock.calls[0][0].runName).toBe(
      "worldbuilding-generate-scene"
    );

    expect(scene.id).toBeTruthy();
    expect(scene.name).toBe("鏡湖晨霧");
    expect(scene.flora).toEqual(["蘆葦", "白樺"]);
    expect(scene.environmentChanges).toHaveLength(2);
  });

  it("LLM 回傳缺欄位時拋出格式錯誤", async () => {
    mockedInvokeLLM.mockResolvedValueOnce(
      llmJsonReply({
        name: "破洞場景",
        // 缺一堆必填
      })
    );

    await expect(
      generateScene({ world: sampleWorld, description: "test" })
    ).rejects.toThrow(/場景生成回應格式錯誤/);
  });
});
