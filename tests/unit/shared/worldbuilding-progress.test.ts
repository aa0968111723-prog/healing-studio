import { describe, it, expect } from "vitest";
import {
  calculateWorldbuildingProgress,
  CATEGORY_WEIGHTS,
} from "../../../shared/worldbuilding-progress";
import type {
  WorldbuildingFrameworkData,
  WorldCharacter,
  WorldScene,
} from "../../../shared/worldbuilding-types";

const makeCharacter = (overrides: Partial<WorldCharacter> = {}): WorldCharacter => ({
  id: "c1",
  name: "小光",
  role: "protagonist",
  ...overrides,
});

const makeScene = (overrides: Partial<WorldScene> = {}): WorldScene => ({
  id: "s1",
  name: "森林深處",
  ...overrides,
});

describe("calculateWorldbuildingProgress", () => {
  it("returns overall 0 when world is empty", () => {
    const result = calculateWorldbuildingProgress({
      name: "Empty world",
      characters: [],
      scenes: [],
    });
    expect(result.overall).toBe(0);
    expect(result.status).toBe("empty");
    expect(result.categories.characters.status).toBe("empty");
    expect(result.categories.scenes.status).toBe("empty");
    // Empty category should expose a warning
    expect(result.categories.characters.warning).toBeTruthy();
  });

  it("returns non-zero when only some categories are filled", () => {
    const world: Partial<WorldbuildingFrameworkData> = {
      name: "Partial world",
      characters: [
        makeCharacter({ appearance: "綠髮、藍眼", personality: "溫柔" }),
      ],
      scenes: [],
    };
    const result = calculateWorldbuildingProgress(world);
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThan(100);
    expect(result.categories.characters.percent).toBeGreaterThan(0);
    expect(result.categories.characters.count).toBe(1);
    expect(result.categories.scenes.percent).toBe(0);
  });

  it("treats brand-new character with just an id+name as low progress", () => {
    const world: Partial<WorldbuildingFrameworkData> = {
      name: "Skeleton world",
      characters: [makeCharacter()],
      scenes: [makeScene()],
    };
    const result = calculateWorldbuildingProgress(world);
    // Even though there's a character, percent must NOT jump to 100.
    expect(result.categories.characters.percent).toBeLessThan(50);
    expect(result.categories.scenes.percent).toBeLessThan(50);
  });

  it("hits 100% when every category is fully populated", () => {
    const world: Partial<WorldbuildingFrameworkData> = {
      name: "Complete world",
      characters: [
        makeCharacter({
          appearance: "綠髮藍眼",
          personality: "溫柔內斂",
          backstory: "森林精靈血脈",
          threeViewSheet: {
            frontImageUrl: "https://example.com/f.png",
            sideImageUrl: "https://example.com/s.png",
            backImageUrl: "https://example.com/b.png",
          },
          expressions: [
            { id: "e1", name: "微笑" },
            { id: "e2", name: "驚訝" },
          ],
          outfits: [{ id: "o1", name: "日常服" }],
          voiceProfile: { engine: "elevenlabs", voiceId: "abc" },
        }),
      ],
      scenes: [
        makeScene({
          environment: "古老森林，潮濕、覆滿苔蘚",
          establishingShotUrl: "https://example.com/scene.png",
          mood: "靜謐",
          lighting: "晨光透過樹葉",
        }),
      ],
      styleProfiles: [
        {
          id: "sp1",
          name: "主風格",
          artStyle: "吉卜力溫潤",
          palette: ["#a8d8b9", "#5e8b7e"],
          lighting: "柔和體積光",
        },
      ],
      musicThemes: [
        {
          id: "mt1",
          name: "主題曲",
          mood: "希望",
          instruments: ["管弦樂團", "獨奏鋼琴"],
        },
      ],
    };
    const result = calculateWorldbuildingProgress(world);
    expect(result.overall).toBe(100);
    expect(result.status).toBe("complete");
    expect(result.categories.voice.percent).toBe(100);
  });

  it("respects category weights (sum to 1)", () => {
    const total = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    // Floating point safety
    expect(Math.abs(total - 1)).toBeLessThan(1e-6);
  });

  it("surfaces warnings when characters have no appearance / three-view", () => {
    const world: Partial<WorldbuildingFrameworkData> = {
      name: "Warning world",
      characters: [makeCharacter()],
      scenes: [makeScene({ environment: "教室" })],
    };
    const result = calculateWorldbuildingProgress(world);
    const warnings = result.blockingWarnings.join("\n");
    expect(warnings).toContain("外觀");
    expect(warnings).toContain("三視圖");
  });

  it("voice category is partial when only some characters have voiceProfile", () => {
    const world: Partial<WorldbuildingFrameworkData> = {
      name: "Voice partial",
      characters: [
        makeCharacter({
          id: "c1",
          voiceProfile: { engine: "elevenlabs", voiceId: "id" },
        }),
        makeCharacter({ id: "c2", name: "另一個" }),
      ],
      scenes: [],
    };
    const result = calculateWorldbuildingProgress(world);
    expect(result.categories.voice.percent).toBe(50);
    expect(result.categories.voice.status).toBe("partial");
  });
});
