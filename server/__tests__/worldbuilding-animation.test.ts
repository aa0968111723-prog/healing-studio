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
  resolveNarrativeBeat,
  seedStoryboardSkeleton,
  summarizeStoryboardForPrompt,
  validateStoryboardTimeline,
  worldStoryboardInputSchema,
} from "../../shared/worldbuilding-animation";
import {
  summarizeFrameworkForPrompt,
  worldbuildingFrameworkInputSchema,
  type WorldbuildingFrameworkData,
} from "../../shared/worldbuilding-types";

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

  // ─── 世界觀串連：跨模組整合測試 ────────────────────────────────────────

  it("inherits fps from productionTargets.masterSpec when args.fps omitted", () => {
    const fw = makeFramework();
    fw.productionTargets!.masterSpec = { fps: 30, resolution: "1080p" };
    const sb = seedStoryboardSkeleton({ framework: fw, totalDurationSec: 60 });
    expect(sb.fps).toBe(30);
  });

  it("inherits aspectRatio from scene.preferredAspectRatio when args omitted", () => {
    const fw = makeFramework();
    fw.scenes[0].preferredAspectRatio = "9:16";
    const sb = seedStoryboardSkeleton({ framework: fw, totalDurationSec: 60 });
    expect(sb.aspectRatio).toBe("9:16");
  });

  it("mirrors scene.styleProfileId onto storyboard scene styleProfileId", () => {
    const fw = makeFramework();
    // 場景 s1 已鎖定 sp1；s2 未鎖定 → 應回退到 framework.defaultStyleProfileId
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    expect(sb.scenes[0].styleProfileId).toBe("sp1"); // 來自 scene 鎖定
    expect(sb.scenes[1].styleProfileId).toBe("sp1"); // 回退 default
  });

  it("picks scene-locked music theme; falls back to mood matching", () => {
    const fw = makeFramework();
    // 加入另一個配樂主題：詭異的氛圍
    fw.musicThemes!.push({
      id: "mt2",
      name: "暗影主題",
      mood: "詭異",
      bpm: 60,
    });
    // s1 鎖定 mt1；s2 沒鎖定但 mood=詭異 → 應自動挑 mt2
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    // scene[0] = 第一場（worldScene s1 鎖定 mt1）
    const music0 = sb.scenes[0].audioClips.find(a => a.kind === "music");
    expect(music0?.musicThemeId).toBe("mt1");
    expect(sb.scenes[0].musicThemeId).toBe("mt1");
    // scene[1] = 第二場（worldScene s2 mood=詭異 → mt2）
    const music1 = sb.scenes[1].audioClips.find(a => a.kind === "music");
    expect(music1?.musicThemeId).toBe("mt2");
  });

  it("assigns default outfit and beat-matched expression to character beats", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 4,
    });
    // 主角艾莉雅 c1 有 default outfit o1
    const firstBeat = sb.scenes[0].characterBeats.find(
      b => b.characterId === "c1"
    );
    expect(firstBeat?.outfitId).toBe("o1");
    expect(firstBeat?.expressionId).toBe("e1"); // 微笑符合 opening
  });

  it("injects signatureLines as dialogue at opening / climax / ending", () => {
    const fw = makeFramework();
    fw.characters[0].scriptRole = {
      ...fw.characters[0].scriptRole,
      signatureLines: ["我要踏上旅程。", "為了夥伴！", "終於回家了……"],
    };
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 90,
      sceneCount: 4,
    });
    // 第一場（opening）→ 第一句招牌台詞
    const opening = sb.scenes[0].characterBeats.find(b => b.characterId === "c1");
    expect(opening?.dialogue).toBe("我要踏上旅程。");
    // 最後一場（ending）→ 最後一句
    const last = sb.scenes[sb.scenes.length - 1].characterBeats.find(
      b => b.characterId === "c1"
    );
    expect(last?.dialogue).toBe("終於回家了……");
  });

  it("places character tagged with appearsInBeats=[結局] only in ending scene", () => {
    const fw = makeFramework();
    fw.characters.push({
      id: "c3",
      name: "守墓人",
      role: "supporting",
      scriptRole: {
        defaultPosition: "cameo",
        avgScreenTimeRatio: 0.3,
        appearsInBeats: ["結局"],
      },
    });
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 120,
      sceneCount: 5,
    });
    // 守墓人應該只在結局場（最後一場）
    const appearsIn = sb.scenes
      .map((sc, i) =>
        sc.characterBeats.some(b => b.characterId === "c3") ? i : -1
      )
      .filter(i => i >= 0);
    expect(appearsIn).toContain(sb.scenes.length - 1);
  });

  it("excludes narrator characters from frame-level character beats", () => {
    const fw = makeFramework();
    fw.characters.push({
      id: "c_nar",
      name: "畫外旁白",
      role: "supporting",
      scriptRole: { defaultPosition: "narrator" },
    });
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    for (const sc of sb.scenes) {
      expect(sc.characterBeats.find(b => b.characterId === "c_nar")).toBeUndefined();
    }
  });

  it("expands scene.soundDesign.signatureSfx into sfx audio clips", () => {
    const fw = makeFramework();
    fw.scenes[0].soundDesign = {
      signatureSfx: [
        { label: "鐘聲", description: "古老的青銅鐘聲" },
        { label: "風嘯", description: "穿過樹梢的風" },
      ],
    };
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    const sfxClips = sb.scenes[0].audioClips.filter(a => a.kind === "sfx");
    expect(sfxClips.length).toBe(2);
    expect(sfxClips[0].sfxDescription).toContain("青銅鐘聲");
  });

  it("expands scene.soundLibraryRefs into ambient sfx clips", () => {
    const fw = makeFramework();
    fw.soundLibrary = [
      {
        id: "sl1",
        label: "森林環境音",
        category: "ambient",
        audioUrl: "https://cdn/forest.mp3",
        loopable: true,
        volumeDefault: 0.5,
      },
    ];
    fw.scenes[0].soundLibraryRefs = ["sl1"];
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    const ambient = sb.scenes[0].audioClips.find(
      a => a.kind === "sfx" && a.sfxDescription?.includes("森林環境音")
    );
    expect(ambient).toBeDefined();
    expect(ambient?.volume).toBeCloseTo(0.5);
  });

  it("injects canonical research entry into scene notes", () => {
    const fw = makeFramework();
    fw.researchEntries = [
      {
        id: "r1",
        title: "晨光森林的歷史",
        category: "history",
        content: "這片森林源自上古，曾有精靈居住其中。",
        tags: ["森林"],
        isCanon: true,
      },
    ];
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 3,
    });
    const noteScene = sb.scenes.find(s => s.notes?.includes("晨光森林的歷史"));
    expect(noteScene).toBeDefined();
    expect(noteScene?.notes).toContain("[正史參考]");
  });

  it("uses scene.defaultCameraMovement as cameraDirection", () => {
    const fw = makeFramework();
    fw.scenes[0].defaultCameraMovement = "緩慢推軌";
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    expect(sb.scenes[0].cameraDirection).toBe("緩慢推軌");
  });

  it("composes actionDescription from environment + mood + environmentChanges", () => {
    const fw = makeFramework();
    fw.scenes[0].environmentChanges = ["突然下起小雨"];
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 2,
    });
    expect(sb.scenes[0].actionDescription).toContain("陽光穿透樹冠"); // environment
    expect(sb.scenes[0].actionDescription).toContain("靜謐"); // mood
    expect(sb.scenes[0].actionDescription).toContain("突然下起小雨"); // change
  });

  it("titles scenes with narrative-beat prefix and scene name", () => {
    const fw = makeFramework();
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 60,
      sceneCount: 4,
    });
    expect(sb.scenes[0].title).toMatch(/^開場：/);
    expect(sb.scenes[sb.scenes.length - 1].title).toMatch(/^結局：/);
  });

  it("respects character.scriptRole.defaultPosition='cameo' for screen-time-low chars", () => {
    const fw = makeFramework();
    // 加入戲份極低的客串角色
    fw.characters.push({
      id: "c_cameo",
      name: "客串老闆",
      role: "supporting",
      scriptRole: {
        defaultPosition: "cameo",
        avgScreenTimeRatio: 0.1,
      },
    });
    const sb = seedStoryboardSkeleton({
      framework: fw,
      totalDurationSec: 120,
      sceneCount: 5,
    });
    // 客串應有出現但不該每場都在
    const appearances = sb.scenes.filter(sc =>
      sc.characterBeats.some(b => b.characterId === "c_cameo")
    ).length;
    expect(appearances).toBeLessThan(sb.scenes.length);
  });
});

describe("resolveNarrativeBeat", () => {
  it("maps scene index to opening / rising / climax / falling / ending", () => {
    expect(resolveNarrativeBeat(0, 5)).toBe("opening");
    expect(resolveNarrativeBeat(4, 5)).toBe("ending");
    // 中間場：rising / climax / falling
    const mids = [1, 2, 3].map(i => resolveNarrativeBeat(i, 5));
    expect(mids).toEqual(expect.arrayContaining(["rising", "climax", "falling"]));
  });

  it("returns opening for single-scene storyboard", () => {
    expect(resolveNarrativeBeat(0, 1)).toBe("opening");
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

// ─── v3 動畫製作專業欄位 ─────────────────────────────────────────────────────

describe("worldbuildingFrameworkInputSchema v3 professional fields", () => {
  it("accepts rigSpec, lipSyncSet, actingNotes, ageVariants on character", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [
        {
          id: "c1",
          name: "艾莉雅",
          role: "protagonist",
          rigSpec: {
            rigType: "rigged_3d",
            boneCount: 64,
            blendShapeCount: 52,
            ikChains: ["left_arm", "right_arm", "left_leg", "right_leg"],
            hasClothSim: true,
            hasHairPhysics: true,
            hasEyeTracking: true,
            rigger: "Studio X",
          },
          lipSyncSet: {
            system: "preston_blair",
            enabled: true,
            primaryLanguage: "zh-TW",
            shapes: { A: "https://cdn/a.png", E: "https://cdn/e.png" },
          },
          actingNotes: {
            walkCycleStyle: "輕盈",
            defaultPosture: "挺直",
            cameraPreference: "three_quarter",
            squashStretch: 0.4,
            signatureGestures: ["撥瀏海"],
            emotionalRange: ["開朗", "克制"],
            vodirection: "笑點處理需保留 0.5s 喘息",
          },
          ageVariants: [
            {
              id: "av1",
              name: "童年",
              approxAge: "8 歲",
              description: "雙馬尾、身高 130cm",
            },
          ],
          soundProfile: {
            footsteps: { 草地: "https://cdn/grass.mp3", 木地板: "https://cdn/wood.mp3" },
            breathSample: "https://cdn/breath.mp3",
            laughSample: "https://cdn/laugh.mp3",
          },
          referenceLibrary: [
            {
              id: "r1",
              imageUrl: "https://cdn/pose1.jpg",
              category: "pose",
              tags: ["奔跑", "全身"],
            },
          ],
        },
      ],
      scenes: [],
    });
    expect(parsed.characters[0].rigSpec?.boneCount).toBe(64);
    expect(parsed.characters[0].lipSyncSet?.enabled).toBe(true);
    expect(parsed.characters[0].actingNotes?.cameraPreference).toBe("three_quarter");
    expect(parsed.characters[0].ageVariants).toHaveLength(1);
    expect(parsed.characters[0].soundProfile?.footsteps?.["草地"]).toBeTruthy();
    expect(parsed.characters[0].referenceLibrary).toHaveLength(1);
  });

  it("accepts layout, productionDesign, atmospherics, soundDesign on scene", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [
        {
          id: "s1",
          name: "宴會廳",
          layout: {
            floorPlanUrl: "https://cdn/floor.jpg",
            entryPoints: ["主門", "側門"],
            exitPoints: ["後門"],
            heroShotAngle: "從吊燈下俯瞰",
            approxDimensions: { widthM: 20, depthM: 30, heightM: 8 },
          },
          productionDesign: {
            architecturalStyle: "巴洛克",
            materials: ["大理石", "黃金"],
            colorScript: {
              keyColor: "#ffe0b3",
              midColor: "#a0764a",
              shadowColor: "#3a2410",
            },
          },
          atmospherics: {
            fogDensity: 0.1,
            dustMotes: true,
            lightShafts: true,
            precipitation: "petals",
          },
          soundDesign: {
            ambientBedUrl: "https://cdn/amb.mp3",
            reverb: "hall",
            signatureSfx: [{ label: "水晶杯碰撞", description: "尖細高頻" }],
          },
        },
      ],
    });
    expect(parsed.scenes[0].layout?.approxDimensions?.widthM).toBe(20);
    expect(parsed.scenes[0].productionDesign?.colorScript?.keyColor).toBe("#ffe0b3");
    expect(parsed.scenes[0].atmospherics?.precipitation).toBe("petals");
    expect(parsed.scenes[0].soundDesign?.reverb).toBe("hall");
  });

  it("accepts shootOn, shadingModel, compositingPasses, colorSpace on styleProfile", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [],
      styleProfiles: [
        {
          id: "sp1",
          name: "京阿尼明亮",
          shootOn: 2,
          schoolReference: "京都動畫 KyoAni",
          shadingModel: "cel",
          compositingPasses: ["Depth of Field 景深", "Bloom 光暈"],
          colorSpace: "Rec709",
          masterResolution: "4K",
          masterCodec: "ProRes",
          lineSpec: {
            weight: 1.5,
            hasOutline: true,
            lineStyle: "clean",
            lineColor: "#1a1a1a",
          },
        },
      ],
    });
    expect(parsed.styleProfiles?.[0].shootOn).toBe(2);
    expect(parsed.styleProfiles?.[0].masterResolution).toBe("4K");
    expect(parsed.styleProfiles?.[0].compositingPasses).toContain("Bloom 光暈");
  });

  it("accepts leitmotif, cueVariants, stems, LUFS on musicTheme", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [],
      musicThemes: [
        {
          id: "mt1",
          name: "主角主題",
          leitmotif: {
            description: "上行小三度 → 下行純五度",
            melodicPhrase: "C-Eb-G-D",
          },
          cueVariants: [
            { label: "15s ad", durationSec: 15 },
            { label: "loop", durationSec: 60, loopable: true },
          ],
          stems: {
            drums: "https://cdn/drums.wav",
            melody: "https://cdn/mel.wav",
          },
          lufsTarget: -14,
          transitionStyle: "crossfade",
          stingerPoints: [0.5, 4.2, 8.0],
        },
      ],
    });
    expect(parsed.musicThemes?.[0].cueVariants).toHaveLength(2);
    expect(parsed.musicThemes?.[0].lufsTarget).toBe(-14);
    expect(parsed.musicThemes?.[0].stingerPoints).toEqual([0.5, 4.2, 8.0]);
  });

  it("accepts milestones, credits, masterSpec on productionTargets", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [],
      productionTargets: {
        format: "短片動畫",
        targetDurationSec: 180,
        budgetUsd: 5000,
        rating: "PG",
        subtitleLanguages: ["zh-TW", "en", "ja"],
        dubLanguages: ["zh-TW"],
        deliverables: ["Master ProRes 4K", "H.264 1080p", "預告 15s"],
        masterSpec: {
          resolution: "4K",
          fps: 24,
          colorSpace: "Rec709",
          hdr: false,
          audioChannels: "5.1",
        },
        milestones: [
          {
            id: "m1",
            stage: "Pre-Production 前期",
            title: "完成角色三視圖",
            dueDate: "2026-06-01",
            status: "in_progress",
            owner: "美術組",
          },
        ],
        credits: [
          { id: "cr1", role: "導演", name: "山田", link: "https://example.com" },
          { id: "cr2", role: "配樂", name: "Brian" },
        ],
      },
    });
    expect(parsed.productionTargets?.milestones).toHaveLength(1);
    expect(parsed.productionTargets?.credits).toHaveLength(2);
    expect(parsed.productionTargets?.masterSpec?.audioChannels).toBe("5.1");
  });

  // ─── v4 真實參考 + 研究 + 音效庫 + 上傳資產 ─────────────────────────

  it("accepts realWorldRefs and uploadedAssets on character", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [
        {
          id: "c1",
          name: "艾莉雅",
          role: "protagonist",
          realWorldRefs: [
            {
              id: "rwr1",
              label: "歷史上的奧黛麗·赫本",
              refType: "celebrity",
              personName: "Audrey Hepburn",
              externalUrl: "https://en.wikipedia.org/wiki/Audrey_Hepburn",
              description: "優雅氣質參考",
              citation: "IMDB nm0000027",
            },
          ],
          uploadedAssets: [
            {
              id: "a1",
              label: "concept.png",
              assetType: "image",
              url: "https://cdn.example.com/concept.png",
              fileKey: "user-1/concept.png",
              mimeType: "image/png",
              sizeBytes: 102400,
              purpose: "reference 參考",
              uploadedAt: "2026-05-19T00:00:00Z",
            },
          ],
        },
      ],
      scenes: [],
    });
    expect(parsed.characters[0].realWorldRefs).toHaveLength(1);
    expect(parsed.characters[0].uploadedAssets).toHaveLength(1);
    expect(parsed.characters[0].realWorldRefs?.[0].refType).toBe("celebrity");
  });

  it("accepts realWorldRefs with GPS coords and yearOfReference on scene", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [
        {
          id: "s1",
          name: "圖書館",
          realWorldRefs: [
            {
              id: "rwr1",
              label: "Trinity College Library",
              refType: "building",
              gpsCoords: { lat: 53.3441, lon: -6.2575 },
              externalUrl: "https://www.tcd.ie/library/",
              yearOfReference: "1592",
              description: "Long Room 為主要靈感",
            },
          ],
          uploadedAssets: [
            {
              id: "a1",
              label: "trinity.jpg",
              assetType: "image",
              url: "https://cdn.example.com/trinity.jpg",
            },
          ],
          soundLibraryRefs: ["sl-rain", "sl-pages"],
        },
      ],
    });
    expect(parsed.scenes[0].realWorldRefs?.[0].gpsCoords?.lat).toBeCloseTo(
      53.3441
    );
    expect(parsed.scenes[0].soundLibraryRefs).toEqual(["sl-rain", "sl-pages"]);
  });

  it("accepts researchEntries with attachments and isCanon flag", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [],
      researchEntries: [
        {
          id: "re1",
          title: "苔森紀年中的星象學",
          category: "culture",
          content: "# 星象\n\n本世界以三顆月亮為時令…",
          sourceUrls: ["https://example.com/ref"],
          attachments: [
            {
              id: "at1",
              label: "constellation.pdf",
              assetType: "pdf",
              url: "https://cdn.example.com/constellation.pdf",
            },
          ],
          citation: "作者 (2026)",
          tags: ["天文", "曆法"],
          isCanon: true,
        },
      ],
    });
    expect(parsed.researchEntries).toHaveLength(1);
    expect(parsed.researchEntries?.[0].isCanon).toBe(true);
    expect(parsed.researchEntries?.[0].attachments).toHaveLength(1);
  });

  it("accepts soundLibrary with category, triggers, license, loopable", () => {
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "test",
      characters: [],
      scenes: [],
      soundLibrary: [
        {
          id: "sl1",
          label: "森林晨間",
          category: "ambient",
          audioUrl: "https://cdn.example.com/forest.mp3",
          durationSec: 120,
          tags: ["森林", "鳥鳴"],
          triggers: ["scene_morning", "forest_enter"],
          loopable: true,
          volumeDefault: 0.6,
          license: "CC0 公眾領域",
          source: "Freesound",
        },
        {
          id: "sl2",
          label: "玻璃碎裂",
          category: "sfx",
          audioUrl: "https://cdn.example.com/glass.wav",
          durationSec: 1.2,
          loopable: false,
          license: "AI 生成（站內）",
        },
      ],
    });
    expect(parsed.soundLibrary).toHaveLength(2);
    expect(parsed.soundLibrary?.[0].triggers).toContain("forest_enter");
    expect(parsed.soundLibrary?.[1].loopable).toBe(false);
  });

  it("draft-tolerant schemas accept the UI placeholder rows", () => {
    // 客戶端 UI 在「手動加入」/「新增條目」/「新增表情」等按鈕後會立即
    // 塞一筆空白 row 讓使用者編輯，patch 馬上回寫後端。在 PR #757 之前
    // 這些空白 label/url 會被 zod 全部擋下，整段 patch 就被吞掉（且 onError
    // 也沒掛）— 那就是「音效庫無法使用」的真實根因。
    const parsed = worldbuildingFrameworkInputSchema.parse({
      name: "未命名世界",
      characters: [
        {
          id: "c-draft",
          name: "",
          role: "protagonist",
          expressions: [{ id: "e-draft", name: "", imageUrl: "" }],
          outfits: [
            { id: "o-draft", name: "", isDefault: true, imageUrl: "" },
          ],
        },
      ],
      scenes: [{ id: "s-draft", name: "" }],
      researchEntries: [{ id: "r-draft", title: "" }],
      soundLibrary: [
        { id: "sl-draft", label: "", audioUrl: "" },
      ],
    });
    expect(parsed.characters[0].expressions?.[0].imageUrl).toBe("");
    expect(parsed.soundLibrary?.[0].audioUrl).toBe("");
    expect(parsed.researchEntries?.[0].title).toBe("");
  });

  it("script-derived storyboard scene payload validates against the schema", () => {
    // 世界觀系統「腳本」分頁 → 「派生為分鏡草稿並儲存」會走這個 shape。
    // 確保未來改 schema 不會悄悄打破整合流程。
    const parsed = worldStoryboardInputSchema.parse({
      worldId: 7,
      name: "第一集 OP 分鏡草稿",
      totalDurationSec: 20,
      fps: 24,
      aspectRatio: "16:9",
      sourceScriptId: "script-1700000000000",
      productionStatus: "planning",
      scenes: [
        {
          id: "sc-1",
          sequenceIndex: 0,
          startSec: 0,
          endSec: 6,
          title: "EXT. 森林 — 黃昏",
          actionDescription: "主角踏入苔森",
          cameraDirection: "Dolly in",
          characterBeats: [],
          frames: [],
          audioClips: [],
          status: "draft",
          notes: "對白：…\n音效：…\n氛圍：療癒",
        },
        {
          id: "sc-2",
          sequenceIndex: 1,
          startSec: 6,
          endSec: 20,
          title: "第 2 場",
          characterBeats: [],
          frames: [],
          audioClips: [],
          status: "draft",
        },
      ],
    });
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.scenes[1].startSec).toBe(parsed.scenes[0].endSec);
    expect(parsed.totalDurationSec).toBe(20);
  });

  it("summarizeFrameworkForPrompt includes v3 professional fields", () => {
    const fw: WorldbuildingFrameworkData = {
      name: "範例",
      characters: [
        {
          id: "c1",
          name: "艾莉雅",
          role: "protagonist",
          rigSpec: { rigType: "rigged_3d", boneCount: 64 },
          actingNotes: { walkCycleStyle: "輕盈", squashStretch: 0.4 },
        },
      ],
      scenes: [
        {
          id: "s1",
          name: "宴會廳",
          atmospherics: { precipitation: "petals", dustMotes: true },
          soundDesign: { reverb: "hall" },
        },
      ],
      musicThemes: [
        {
          id: "mt1",
          name: "主角主題",
          lufsTarget: -14,
          leitmotif: { description: "上行三度" },
          cueVariants: [{ label: "loop", durationSec: 60, loopable: true }],
        },
      ],
      productionTargets: {
        masterSpec: { resolution: "4K", fps: 24, colorSpace: "Rec709" },
        milestones: [
          { id: "m1", stage: "前期", title: "完稿", status: "in_progress" },
        ],
        credits: [{ id: "cr1", role: "導演", name: "山田" }],
      },
    };
    const text = summarizeFrameworkForPrompt(fw);
    expect(text).toContain("Rig：rigged_3d");
    expect(text).toContain("演技");
    expect(text).toContain("petals");
    expect(text).toContain("hall");
    expect(text).toContain("主題動機");
    expect(text).toContain("LUFS");
    expect(text).toContain("Master");
    expect(text).toContain("製作里程碑");
    expect(text).toContain("Credits");
  });
});
