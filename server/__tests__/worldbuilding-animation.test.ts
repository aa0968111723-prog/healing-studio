/**
 * Tests for shared/worldbuilding-animation.ts
 *
 * 覆蓋：
 *   - seedStoryboardSkeleton 派生分鏡骨架
 *   - validateStoryboardTimeline 時間軸驗證
 *   - planAnimationPipeline 管線編排（含依賴 / 估時 / 估價）
 *   - buildFramePrompt 整合角色/場景/風格 trigger
 *   - summarizeStoryboardForPrompt 純文字摘要
 *   - zod schema 邊界
 */

import { describe, expect, it } from "vitest";
import {
  buildFramePrompt,
  formatTimecode,
  planAnimationPipeline,
  seedStoryboardSkeleton,
  summarizeStoryboardForPrompt,
  validateStoryboardTimeline,
  worldStoryboardInputSchema,
} from "../../shared/worldbuilding-animation";
import type { WorldbuildingFrameworkData } from "../../shared/worldbuilding-types";

function makeFramework(): WorldbuildingFrameworkData & { id: number } {
  return {
    id: 1,
    name: "童話之森",
    genre: "奇幻",
    era: "中世紀",
    characters: [
      {
        id: "c1",
        name: "艾莉雅",
        role: "protagonist",
        triggerWord: "aria_v1",
        appearance: "金髮綠眼少女",
        outfits: [
          { id: "o1", name: "日常裙", description: "白色棉裙", isDefault: true },
          { id: "o2", name: "戰鬥裝", description: "綠袍與短劍", triggerWord: "aria_battle_v1" },
        ],
        expressions: [
          { id: "e1", name: "微笑", intensity: 0.6, promptKeywords: ["gentle smile"] },
        ],
        voiceProfile: {
          engine: "elevenlabs",
          voiceId: "elevenlabs/aria",
          languageCode: "zh-TW",
          emotion: "warm",
        },
        scriptRole: {
          archetype: "英雄（Hero）",
          arcType: "growth",
          defaultPosition: "main_stage",
          avgScreenTimeRatio: 0.6,
        },
      },
      {
        id: "c2",
        name: "影",
        role: "antagonist",
        triggerWord: "shadow_v1",
      },
    ],
    scenes: [
      {
        id: "s1",
        name: "晨光森林",
        environment: "陽光穿透樹冠",
        lighting: "晨光",
        mood: "靜謐",
        styleProfileId: "sp1",
        musicThemeId: "mt1",
      },
      { id: "s2", name: "黑暗深處", lighting: "月光", mood: "詭異" },
    ],
    styleProfiles: [
      {
        id: "sp1",
        name: "新海誠寫實光影",
        artStyle: "新海誠寫實光影",
        triggerWord: "shinkai_v1",
        lensSpec: { aspectRatio: "16:9", focalLengthMm: 35 },
        negativePrompt: "watermark, blurry",
      },
    ],
    musicThemes: [
      {
        id: "mt1",
        name: "森林主題",
        mood: "希望",
        bpm: 90,
        instruments: ["管弦樂團", "獨奏鋼琴"],
      },
    ],
    defaultStyleProfileId: "sp1",
    globalNegativePrompt: "low quality, deformed",
    productionTargets: {
      format: "短片動畫",
      targetDurationSec: 60,
      audience: "全年齡",
      platform: "YouTube",
    },
  };
}

describe("formatTimecode", () => {
  it("formats seconds under 1h as MM:SS", () => {
    expect(formatTimecode(0)).toBe("00:00");
    expect(formatTimecode(65)).toBe("01:05");
    expect(formatTimecode(3599)).toBe("59:59");
  });
  it("formats over 1h as HH:MM:SS", () => {
    expect(formatTimecode(3725)).toBe("01:02:05");
  });
});

describe("seedStoryboardSkeleton", () => {
  it("creates evenly distributed scenes", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 4,
    });
    expect(sb.scenes).toHaveLength(4);
    expect(sb.totalDurationSec).toBe(60);
    expect(sb.scenes[0].startSec).toBe(0);
    expect(sb.scenes[3].endSec).toBe(60);
    // 主角應被分配到每場
    for (const sc of sb.scenes) {
      const hasProtagonist = sc.characterBeats.some(b => b.characterId === "c1");
      expect(hasProtagonist).toBe(true);
    }
  });

  it("defaults sceneCount sensibly from duration", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({ framework: fw, totalDurationSec: 30 });
    // 30s → ~1 場 → clamp 至最小 3
    expect(sb.scenes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateStoryboardTimeline", () => {
  it("detects overlapping scenes", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    // 故意讓第二場重疊
    sb.scenes[1].startSec = sb.scenes[0].endSec - 5;
    const errors = validateStoryboardTimeline(sb);
    expect(errors.some(e => e.includes("重疊"))).toBe(true);
  });

  it("detects out-of-range frames", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    sb.scenes[0].frames[0].atSec = 9999;
    const errors = validateStoryboardTimeline(sb);
    expect(errors.some(e => e.includes("超出場長"))).toBe(true);
  });

  it("returns no errors for clean skeleton", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    expect(validateStoryboardTimeline(sb)).toEqual([]);
  });
});

describe("buildFramePrompt", () => {
  it("injects character trigger word + outfit + style profile", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 30,
      sceneCount: 1,
    });
    const scene = sb.scenes[0];
    scene.worldSceneId = "s1";
    scene.characterBeats = [
      {
        characterId: "c1",
        startOffsetSec: 0,
        durationSec: 30,
        outfitId: "o2",
        expressionId: "e1",
      },
    ];
    const frame = {
      id: "f1",
      atSec: 0,
      shotSize: "中景（MS）",
      cameraMovement: "推軌",
      status: "queued" as const,
    };
    const prompt = buildFramePrompt({
      framework: fw,
      storyboardScene: scene,
      frame,
      presentBeats: scene.characterBeats,
    });
    expect(prompt).toContain("aria_v1"); // 角色 trigger
    expect(prompt).toContain("aria_battle_v1"); // 戰鬥裝 trigger
    expect(prompt).toContain("shinkai_v1"); // 風格 profile trigger
    expect(prompt).toContain("表情：微笑");
    expect(prompt).toContain("推軌");
  });
});

describe("planAnimationPipeline", () => {
  it("generates t2i + refine + i2v + music + compose steps with correct deps", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 30,
      sceneCount: 2,
    });
    const plan = planAnimationPipeline(sb, fw);
    expect(plan.steps.length).toBeGreaterThan(0);

    const t2iSteps = plan.steps.filter(s => s.kind === "generate_keyframe");
    const refineSteps = plan.steps.filter(s => s.kind === "refine_image");
    const i2vSteps = plan.steps.filter(s => s.kind === "image_to_video");
    const musicSteps = plan.steps.filter(s => s.kind === "generate_music");
    const finalStep = plan.steps.find(s => s.kind === "compose_final_video");

    expect(t2iSteps.length).toBeGreaterThan(0);
    expect(refineSteps.length).toBe(t2iSteps.length);
    expect(i2vSteps.length).toBe(t2iSteps.length);
    expect(musicSteps.length).toBeGreaterThan(0);
    expect(finalStep).toBeDefined();

    // refine 依賴 t2i
    for (const r of refineSteps) {
      const matchedT2i = t2iSteps.find(t => r.dependsOn.includes(t.stepId));
      expect(matchedT2i).toBeDefined();
    }
    // final compose 依賴所有 i2v + 所有 compose-audio
    for (const i2v of i2vSteps) {
      expect(finalStep!.dependsOn).toContain(i2v.stepId);
    }

    // 估時 > 0
    expect(plan.estimatedWallClockSec).toBeGreaterThan(0);
    expect(plan.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("respects skipRefine / skipVideo flags", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 30,
      sceneCount: 2,
    });
    const noRefine = planAnimationPipeline(sb, fw, { skipRefine: true });
    expect(noRefine.steps.find(s => s.kind === "refine_image")).toBeUndefined();
    const noVideo = planAnimationPipeline(sb, fw, { skipVideo: true });
    expect(noVideo.steps.find(s => s.kind === "image_to_video")).toBeUndefined();
    // skipVideo 時也不該有 final-compose（沒影片可合）
    expect(
      noVideo.steps.find(s => s.kind === "compose_final_video")
    ).toBeUndefined();
  });

  it("collects active LoRA ids from character + scene + style profile", () => {
    const fw = makeFramework();
    fw.characters[0].linkedModelId = 100;
    fw.scenes[0].linkedModelId = 200;
    fw.styleProfiles![0].linkedModelId = 300;
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 30,
      sceneCount: 1,
    });
    sb.scenes[0].worldSceneId = "s1";
    sb.scenes[0].characterBeats = [
      { characterId: "c1", startOffsetSec: 0, durationSec: 30 },
    ];
    const plan = planAnimationPipeline(sb, fw, { skipRefine: true, skipVideo: true });
    const t2i = plan.steps.find(s => s.kind === "generate_keyframe");
    const loras = (t2i?.input as { loraIds: number[] }).loraIds;
    expect(loras).toEqual(expect.arrayContaining([100, 200, 300]));
  });
});

describe("summarizeStoryboardForPrompt", () => {
  it("includes timecodes and character names", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    sb.scenes[0].characterBeats = [
      {
        characterId: "c1",
        startOffsetSec: 0,
        durationSec: 20,
        dialogue: "你好世界。",
      },
    ];
    const text = summarizeStoryboardForPrompt(sb, fw);
    expect(text).toContain("分鏡表");
    expect(text).toContain("00:00");
    expect(text).toContain("艾莉雅");
    expect(text).toContain("你好世界");
  });
});

describe("worldStoryboardInputSchema", () => {
  it("validates a well-formed minimal storyboard", () => {
    const parsed = worldStoryboardInputSchema.parse({
      worldId: 1,
      name: "test",
      totalDurationSec: 30,
      fps: 24,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "s1",
          sequenceIndex: 0,
          startSec: 0,
          endSec: 30,
          characterBeats: [],
          frames: [],
          audioClips: [],
          status: "draft",
        },
      ],
      productionStatus: "planning",
    });
    expect(parsed.scenes).toHaveLength(1);
  });

  it("rejects negative duration", () => {
    expect(() =>
      worldStoryboardInputSchema.parse({
        worldId: 1,
        name: "test",
        totalDurationSec: -1,
        scenes: [],
      })
    ).toThrow();
  });
});
