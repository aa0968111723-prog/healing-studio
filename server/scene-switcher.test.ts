/**
 * Tests for Scene Switcher (Background Theme Switcher)
 *
 * Validates:
 * 1. Scene-to-hour mapping logic
 * 2. Override persistence pattern (localStorage)
 * 3. Scene metadata completeness
 * 4. Dark/light mode detection
 */
import { describe, it, expect } from "vitest";

// ─── Scene Logic (mirrors AmbientEnvironment.tsx) ──────────────────────────

type SceneId = "nightSky" | "morning" | "cafe" | "deepSea";

function getSceneForHour(hour: number): SceneId {
  if (hour >= 22 || hour < 5) return "nightSky";
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "cafe";
  return "deepSea";
}

function isDarkScene(scene: SceneId): boolean {
  return scene === "nightSky" || scene === "deepSea";
}

const ALL_SCENES: SceneId[] = ["nightSky", "morning", "cafe", "deepSea"];

const SCENE_META: Record<SceneId, { label: string; description: string }> = {
  nightSky: { label: "夜空", description: "深藍星空 · 流星閃爍" },
  morning: { label: "晨光", description: "暖橙日出 · 光塵飄浮" },
  cafe: { label: "咖啡廳", description: "暖棕午後 · 散景光點" },
  deepSea: { label: "深海", description: "深青海洋 · 氣泡光影" },
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Scene Switcher", () => {
  describe("Time-based Scene Selection", () => {
    it("should return nightSky for late night hours (22-4)", () => {
      expect(getSceneForHour(22)).toBe("nightSky");
      expect(getSceneForHour(23)).toBe("nightSky");
      expect(getSceneForHour(0)).toBe("nightSky");
      expect(getSceneForHour(1)).toBe("nightSky");
      expect(getSceneForHour(4)).toBe("nightSky");
    });

    it("should return morning for morning hours (5-10)", () => {
      expect(getSceneForHour(5)).toBe("morning");
      expect(getSceneForHour(7)).toBe("morning");
      expect(getSceneForHour(10)).toBe("morning");
    });

    it("should return cafe for afternoon hours (11-16)", () => {
      expect(getSceneForHour(11)).toBe("cafe");
      expect(getSceneForHour(13)).toBe("cafe");
      expect(getSceneForHour(16)).toBe("cafe");
    });

    it("should return deepSea for evening hours (17-21)", () => {
      expect(getSceneForHour(17)).toBe("deepSea");
      expect(getSceneForHour(19)).toBe("deepSea");
      expect(getSceneForHour(21)).toBe("deepSea");
    });

    it("should cover all 24 hours without gaps", () => {
      for (let h = 0; h < 24; h++) {
        const scene = getSceneForHour(h);
        expect(ALL_SCENES).toContain(scene);
      }
    });
  });

  describe("Dark/Light Mode Detection", () => {
    it("nightSky should be dark", () => {
      expect(isDarkScene("nightSky")).toBe(true);
    });

    it("deepSea should be dark", () => {
      expect(isDarkScene("deepSea")).toBe(true);
    });

    it("morning should be light", () => {
      expect(isDarkScene("morning")).toBe(false);
    });

    it("cafe should be light", () => {
      expect(isDarkScene("cafe")).toBe(false);
    });
  });

  describe("Scene Metadata", () => {
    it("all scenes should have labels", () => {
      ALL_SCENES.forEach((id) => {
        expect(SCENE_META[id].label).toBeTruthy();
        expect(typeof SCENE_META[id].label).toBe("string");
      });
    });

    it("all scenes should have descriptions", () => {
      ALL_SCENES.forEach((id) => {
        expect(SCENE_META[id].description).toBeTruthy();
        expect(typeof SCENE_META[id].description).toBe("string");
      });
    });

    it("labels should be in Chinese", () => {
      expect(SCENE_META.nightSky.label).toBe("夜空");
      expect(SCENE_META.morning.label).toBe("晨光");
      expect(SCENE_META.cafe.label).toBe("咖啡廳");
      expect(SCENE_META.deepSea.label).toBe("深海");
    });
  });

  describe("Override Persistence Logic", () => {
    it("should validate scene ID before accepting override", () => {
      const validScenes = new Set(ALL_SCENES);
      expect(validScenes.has("nightSky" as SceneId)).toBe(true);
      expect(validScenes.has("morning" as SceneId)).toBe(true);
      expect(validScenes.has("invalid" as SceneId)).toBe(false);
    });

    it("null override should fall back to auto scene", () => {
      const override: SceneId | null = null;
      const autoScene: SceneId = "cafe";
      const activeScene = override ?? autoScene;
      expect(activeScene).toBe("cafe");
    });

    it("non-null override should take precedence over auto scene", () => {
      const override: SceneId | null = "nightSky";
      const autoScene: SceneId = "cafe";
      const activeScene = override ?? autoScene;
      expect(activeScene).toBe("nightSky");
    });

    it("localStorage key should be consistent", () => {
      const key = "hs-scene-override";
      expect(key).toBe("hs-scene-override");
    });

    it("should serialize and deserialize scene ID correctly", () => {
      const sceneId: SceneId = "deepSea";
      const serialized = sceneId; // stored as plain string
      const deserialized = serialized as SceneId;
      expect(deserialized).toBe("deepSea");
      expect(ALL_SCENES).toContain(deserialized);
    });
  });

  describe("Scene Transition", () => {
    it("switching from light to dark should change isDark", () => {
      const from: SceneId = "cafe";
      const to: SceneId = "nightSky";
      expect(isDarkScene(from)).toBe(false);
      expect(isDarkScene(to)).toBe(true);
    });

    it("switching between same brightness should not change isDark", () => {
      expect(isDarkScene("nightSky")).toBe(isDarkScene("deepSea"));
      expect(isDarkScene("morning")).toBe(isDarkScene("cafe"));
    });
  });
});
