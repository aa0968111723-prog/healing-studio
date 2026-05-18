import { describe, expect, it } from "vitest";
import {
  CHARACTER_ROLE_LABELS,
  characterRoleSchema,
  summarizeFrameworkForPrompt,
  worldbuildingFrameworkInputSchema,
  worldCharacterSchema,
  worldSceneSchema,
} from "../shared/worldbuilding-types";

describe("worldbuilding-types", () => {
  it("validates a complete framework input", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "苔森紀年",
      description: "潮濕森林裡的療癒故事",
      genre: "療癒奇幻",
      characters: [
        {
          id: "c1",
          name: "艾莉",
          role: "protagonist",
          tagline: "森林守護者",
          personality: "溫柔但執著",
          likes: ["蜂蜜茶", "晨霧"],
          interests: ["植物學", "古老符文"],
          outfit: "苔綠色斗篷、皮製腰帶",
          appearance: "深綠瞳、麥色長髮、身上有藤蔓刺青",
          signatureItems: ["木製手杖", "種子袋"],
          linkedModelId: 42,
          triggerWord: "sks_eli",
        },
        {
          id: "c2",
          name: "迷霧巫",
          role: "antagonist",
        },
      ],
      scenes: [
        {
          id: "s1",
          name: "晨霧中的療癒森林",
          environment: "春季清晨，地面潮濕",
          flora: ["松樹", "苔蘚", "蕨類"],
          fauna: ["螢火蟲"],
          props: ["石燈", "木橋"],
          lighting: "斜射晨光，柔和色溫",
          mood: "靜謐、安心",
          environmentChanges: ["黃昏起霧", "夜晚螢火蟲飛舞"],
          linkedModelId: 7,
        },
      ],
      tags: ["healing", "fantasy"],
    });

    expect(parsed.characters).toHaveLength(2);
    expect(parsed.scenes[0].flora).toContain("苔蘚");
  });

  it("rejects invalid role", () => {
    const result = characterRoleSchema.safeParse("hero");
    expect(result.success).toBe(false);
  });

  it("rejects negative linkedModelId", () => {
    const result = worldCharacterSchema.safeParse({
      id: "c1",
      name: "A",
      role: "protagonist",
      linkedModelId: -1,
    });
    expect(result.success).toBe(false);
  });

  it("enforces character likes max length", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `like${i}`);
    const result = worldCharacterSchema.safeParse({
      id: "c1",
      name: "A",
      role: "protagonist",
      likes: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it("allows null linkedModelId for scenes (explicit unlink)", () => {
    const parsed = worldSceneSchema.parse({
      id: "s1",
      name: "森林",
      linkedModelId: null,
    });
    expect(parsed.linkedModelId).toBeNull();
  });

  it("summarizeFrameworkForPrompt renders characters and scenes", () => {
    const summary = summarizeFrameworkForPrompt({
      name: "苔森紀年",
      genre: "療癒奇幻",
      characters: [
        {
          id: "c1",
          name: "艾莉",
          role: "protagonist",
          tagline: "森林守護者",
          appearance: "深綠瞳",
          outfit: "苔綠斗篷",
          personality: "溫柔",
          likes: ["蜂蜜茶"],
          signatureItems: ["木杖"],
          triggerWord: "sks_eli",
        },
      ],
      scenes: [
        {
          id: "s1",
          name: "晨霧森林",
          environment: "春季清晨",
          flora: ["松樹", "苔蘚"],
          fauna: ["螢火蟲"],
          props: ["石燈"],
          lighting: "晨光柔和",
          mood: "靜謐",
          environmentChanges: ["黃昏起霧"],
          triggerWord: "scn_forest",
        },
      ],
    });

    expect(summary).toContain("# 世界觀：苔森紀年");
    expect(summary).toContain("療癒奇幻");
    expect(summary).toContain("[主角] 艾莉");
    expect(summary).toContain("樣貌：深綠瞳");
    expect(summary).toContain("LoRA trigger：sks_eli");
    expect(summary).toContain("晨霧森林");
    expect(summary).toContain("花草樹木：松樹、苔蘚");
    expect(summary).toContain("環境變化：黃昏起霧");
  });

  it("exposes the role label map", () => {
    expect(CHARACTER_ROLE_LABELS.protagonist).toBe("主角");
    expect(CHARACTER_ROLE_LABELS.supporting).toBe("配角");
    expect(CHARACTER_ROLE_LABELS.antagonist).toBe("反派");
    expect(CHARACTER_ROLE_LABELS.npc).toBe("路人 / NPC");
  });
});
