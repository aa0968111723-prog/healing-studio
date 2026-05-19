/**
 * shared/worldbuilding-animation.ts
 *
 * 動畫腳本分鏡（World Storyboard）+ 製作管線編排（Animation Pipeline）
 *
 * 設計重點：
 *   1. Storyboard 是 "幾分幾秒，誰，在哪，做什麼" 的時間軸 —— 每一場（scene）
 *      有起訖秒數、繫結 worldScene id、登場角色 id、對白、運鏡、轉場。
 *   2. 每一場下面有 frames（圖楨），frame 包含 prompt、imageUrl、refinedImageUrl、
 *      videoClipUrl，分別對應 t2i → refine → i2v 三階段。
 *   3. 三條音軌：music（配樂）、voiceover（配音）、sfx（音效）。
 *   4. 提供 `planAnimationPipeline()` 把一個 storyboard 轉成一連串可被
 *      cross-modality-workflows 執行的 render job 步驟。
 *
 * 為何單獨檔案：worldbuilding-types.ts 已經 1300 行；分鏡語料體量更大、
 * 變動頻率更高，獨立檔案便於演進。
 */

import { z } from "zod";

import type {
  WorldCharacter,
  WorldScene,
  WorldStyleProfile,
  WorldMusicTheme,
  WorldbuildingFrameworkData,
  WorldResearchEntry,
  SceneTimeOfDay,
  CharacterExpression,
  CharacterOutfit,
} from "./worldbuilding-types";

// ─── 基本枚舉 ───────────────────────────────────────────────────────────────

export type StoryboardSceneStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rendering"
  | "rendered"
  | "needs_revision";

export type FrameRenderStage =
  | "queued"
  | "t2i_done"      // 關鍵幀已生成
  | "refined"       // 已細膩化
  | "i2v_done"      // 已轉成影片
  | "failed";

export type AudioTrackKind = "music" | "voiceover" | "sfx";

// ─── 角色出場（在一個 scene 內，誰在做什麼） ────────────────────────────────

/**
 * 在一個分鏡場景內，某角色的出場資訊。
 * 比 characterId list 更精細：能指定當下穿哪套、什麼表情、什麼姿勢、
 * 從幾秒到幾秒在場上。
 */
export type StoryboardCharacterBeat = {
  /** 引用 framework.characters[].id */
  characterId: string;
  /** 從本場開始的相對秒數（0 = 本場開頭） */
  startOffsetSec: number;
  /** 在場時長（秒） */
  durationSec: number;
  /** 指定本場使用的穿衣 id（不指定則用預設） */
  outfitId?: string;
  /** 本場主要表情 id */
  expressionId?: string;
  /** 姿勢 / 動作描述（站立、揮手、奔跑……） */
  pose?: string;
  /** 對白（角色在本場說的話；多句以 \n 分隔） */
  dialogue?: string;
  /** 內心 OS（不發聲，動畫字幕用） */
  innerThought?: string;
  /** 角色目標 / 動機（給 LLM 寫對白用） */
  goal?: string;
  /** 與其他角色的互動標籤（對話 / 戰鬥 / 擁抱 / 對視） */
  interactionTags?: string[];
};

// ─── 圖楨（Frame / Keyframe） ───────────────────────────────────────────────

/**
 * 一張關鍵幀 —— 在一個分鏡場景內的某個時間點的單張圖像。
 * 是動畫流程的最小單元：t2i 產關鍵幀 → refine 細膩化 → i2v 轉短片。
 */
export type StoryboardFrame = {
  id: string;
  /** 在本場內的時間點（相對秒數） */
  atSec: number;
  /** 構圖描述 / shot description */
  shotDescription?: string;
  /** 構圖：特寫 / 中景 / 全景 / 遠景 / 鳥瞰 / 仰角 */
  shotSize?: string;
  /** 鏡頭運動（推軌 / 環繞 / 跟拍…） */
  cameraMovement?: string;
  /** 完整 AI 生成 prompt（會在生成前由 buildFramePrompt 編譯） */
  prompt?: string;
  /** 負面提示詞 */
  negativePrompt?: string;
  /** 1st 階段：t2i 產出的關鍵幀 URL */
  imageUrl?: string;
  /** 2nd 階段：refined / inpainted / upscaled 細膩化結果 */
  refinedImageUrl?: string;
  /** 3rd 階段：i2v 後的短片 URL（通常 2–5 秒） */
  videoClipUrl?: string;
  /** 各階段使用的模型 id（給歷史與重生用） */
  modelHints?: {
    imageModel?: string;
    refineModel?: string;
    videoModel?: string;
  };
  /** 整體狀態 */
  status: FrameRenderStage;
  /** 失敗原因（最近一次） */
  errorMessage?: string;
  /** seed（用於可重現生成） */
  seed?: number;
};

// ─── 音軌片段 ──────────────────────────────────────────────────────────────

export type StoryboardAudioClip = {
  id: string;
  /** music / voiceover / sfx */
  kind: AudioTrackKind;
  /** 從本場開始的相對秒數 */
  startOffsetSec: number;
  /** 片段時長 */
  durationSec: number;
  /** 對於 voiceover：說話角色 id */
  characterId?: string;
  /** 對於 voiceover：要說的內容 */
  text?: string;
  /** 對於 music：繫結 framework.musicThemes[].id */
  musicThemeId?: string;
  /** 對於 sfx：音效描述（雨聲、玻璃碎裂） */
  sfxDescription?: string;
  /** 音量 0–1 */
  volume?: number;
  /** 淡入淡出秒數 */
  fadeInSec?: number;
  fadeOutSec?: number;
  /** 產出後的音檔 URL */
  audioUrl?: string;
  /** 狀態 */
  status?: "pending" | "generating" | "ready" | "failed";
};

// ─── 分鏡場景（時間軸的一格） ───────────────────────────────────────────────

export type StoryboardScene = {
  id: string;
  /** 順序索引（從 0 起） */
  sequenceIndex: number;
  /** 「幾分幾秒」起：在全片中的絕對秒數 */
  startSec: number;
  /** 在全片中的絕對秒數結束 */
  endSec: number;
  /** 場景標題（例：第三幕 · 重逢） */
  title?: string;
  /** 繫結 framework.scenes[].id —— 視覺場景 */
  worldSceneId?: string;
  /** 在此場景中登場的角色（含時段、表情、穿著、台詞） */
  characterBeats: StoryboardCharacterBeat[];
  /** 場景簡述（給 LLM 用） */
  actionDescription?: string;
  /** 鏡頭指示 / 鏡頭表 */
  cameraDirection?: string;
  /** 場景轉場（與下一場銜接） */
  transitionOut?: string;
  /** 圖楨清單 */
  frames: StoryboardFrame[];
  /** 音軌片段（music / voiceover / sfx 共存於本陣列，以 kind 區分） */
  audioClips: StoryboardAudioClip[];
  /** 鎖定的風格 profile id（覆蓋 worldScene 的設定） */
  styleProfileId?: string | null;
  /** 鎖定的配樂主題 id */
  musicThemeId?: string | null;
  /** 整體狀態 */
  status: StoryboardSceneStatus;
  /** 給導演 AI / 動畫師的備註 */
  notes?: string;
};

// ─── 整個分鏡（一個動畫專案的時間軸） ───────────────────────────────────────

export type WorldStoryboard = {
  id?: number;
  /** 繫結到 worldbuilding_frameworks.id */
  worldId: number;
  /** 標題 */
  name: string;
  /** 全片總長 */
  totalDurationSec: number;
  /** 影格率（預設 24） */
  fps: number;
  /** 預設長寬比（"16:9", "9:16", "1:1"） */
  aspectRatio: string;
  /** 全片場景時間軸 */
  scenes: StoryboardScene[];
  /** 與原始長腳本的關聯（如有） */
  sourceScriptId?: string;
  /** 全片旁白（與場景的 voiceover 平行） */
  narration?: string;
  /** 製作狀態 */
  productionStatus:
    | "planning"
    | "generating_frames"
    | "refining"
    | "rendering_video"
    | "composing_audio"
    | "final_compose"
    | "completed";
  /** 最後產出的成片 URL */
  finalVideoUrl?: string;
  /** 累計花費（成本估算用） */
  estimatedCostUsd?: number;
};

// ─── 動畫製作管線步驟（plan output） ────────────────────────────────────────

export type AnimationPipelineStep = {
  stepId: string;
  /** 屬於哪個 storyboard scene */
  sceneId: string;
  /** 屬於哪個 frame（如適用） */
  frameId?: string;
  /** 步驟類型 */
  kind:
    | "generate_keyframe"          // t2i
    | "refine_image"               // image-to-image / upscale / inpaint
    | "image_to_video"             // i2v
    | "generate_music"             // music generation
    | "generate_voiceover"         // tts
    | "generate_sfx"               // sound effect
    | "compose_audio_track"        // 合成音軌
    | "compose_final_video";       // 合成成片
  /** 該步驟用的 spirit / 子代理（呼應 cross-modality-workflows） */
  spirit:
    | "image-specialist"
    | "video-specialist"
    | "music-specialist"
    | "voice-specialist"
    | "video-compositor";
  /** 工具識別碼（對應 server router 的 procedure 名） */
  tool: string;
  /** 輸入 prompt / 參數 */
  input: Record<string, unknown>;
  /** 依賴的前置 stepId */
  dependsOn: string[];
  /** 預期 outputType */
  outputType: "image" | "video" | "audio" | "voice";
  /** 預估秒數 */
  estimatedSec?: number;
};

export type AnimationPipelinePlan = {
  storyboardId: number;
  /** 全部步驟（已拓樸排序：dependsOn 在前） */
  steps: AnimationPipelineStep[];
  /** 估算總時長秒數（並行考量後） */
  estimatedWallClockSec: number;
  /** 估算總成本 */
  estimatedCostUsd?: number;
  /** 各 spirit 的併發限制建議 */
  concurrencyHints?: Record<string, number>;
};

// ─── Zod schemas ────────────────────────────────────────────────────────────

export const storyboardCharacterBeatSchema = z.object({
  characterId: z.string().min(1).max(64),
  startOffsetSec: z.number().min(0).max(60 * 60 * 6),
  durationSec: z.number().min(0).max(60 * 60),
  outfitId: z.string().max(64).optional(),
  expressionId: z.string().max(64).optional(),
  pose: z.string().max(500).optional(),
  dialogue: z.string().max(2000).optional(),
  innerThought: z.string().max(1000).optional(),
  goal: z.string().max(500).optional(),
  interactionTags: z.array(z.string().max(64)).max(20).optional(),
});

export const storyboardFrameSchema = z.object({
  id: z.string().min(1),
  atSec: z.number().min(0).max(60 * 60),
  shotDescription: z.string().max(1000).optional(),
  shotSize: z.string().max(64).optional(),
  cameraMovement: z.string().max(64).optional(),
  prompt: z.string().max(4000).optional(),
  negativePrompt: z.string().max(2000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  refinedImageUrl: z.string().url().max(2048).optional(),
  videoClipUrl: z.string().url().max(2048).optional(),
  modelHints: z
    .object({
      imageModel: z.string().max(128).optional(),
      refineModel: z.string().max(128).optional(),
      videoModel: z.string().max(128).optional(),
    })
    .optional(),
  status: z.enum(["queued", "t2i_done", "refined", "i2v_done", "failed"]),
  errorMessage: z.string().max(2000).optional(),
  seed: z.number().int().optional(),
});

export const storyboardAudioClipSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["music", "voiceover", "sfx"]),
  startOffsetSec: z.number().min(0),
  durationSec: z.number().min(0).max(60 * 60),
  characterId: z.string().max(64).optional(),
  text: z.string().max(4000).optional(),
  musicThemeId: z.string().max(64).optional(),
  sfxDescription: z.string().max(500).optional(),
  volume: z.number().min(0).max(1).optional(),
  fadeInSec: z.number().min(0).max(60).optional(),
  fadeOutSec: z.number().min(0).max(60).optional(),
  audioUrl: z.string().url().max(2048).optional(),
  status: z
    .enum(["pending", "generating", "ready", "failed"])
    .optional(),
});

export const storyboardSceneSchema = z.object({
  id: z.string().min(1),
  sequenceIndex: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  title: z.string().max(255).optional(),
  worldSceneId: z.string().max(64).optional(),
  characterBeats: z.array(storyboardCharacterBeatSchema).max(20),
  actionDescription: z.string().max(2000).optional(),
  cameraDirection: z.string().max(1000).optional(),
  transitionOut: z.string().max(255).optional(),
  frames: z.array(storyboardFrameSchema).max(100),
  audioClips: z.array(storyboardAudioClipSchema).max(60),
  styleProfileId: z.string().max(64).nullable().optional(),
  musicThemeId: z.string().max(64).nullable().optional(),
  status: z.enum([
    "draft",
    "in_review",
    "approved",
    "rendering",
    "rendered",
    "needs_revision",
  ]),
  notes: z.string().max(2000).optional(),
});

export const worldStoryboardInputSchema = z.object({
  worldId: z.number().int().positive(),
  name: z.string().min(1).max(255),
  totalDurationSec: z.number().min(1).max(60 * 60 * 6),
  fps: z.number().int().min(1).max(120).default(24),
  aspectRatio: z.string().max(16).default("16:9"),
  scenes: z.array(storyboardSceneSchema).max(200),
  sourceScriptId: z.string().max(64).optional(),
  narration: z.string().max(10000).optional(),
  productionStatus: z
    .enum([
      "planning",
      "generating_frames",
      "refining",
      "rendering_video",
      "composing_audio",
      "final_compose",
      "completed",
    ])
    .default("planning"),
  finalVideoUrl: z.string().url().max(2048).optional(),
  estimatedCostUsd: z.number().min(0).optional(),
});

export type WorldStoryboardInput = z.infer<typeof worldStoryboardInputSchema>;

// ─── Helpers：時間軸驗證與輔助 ──────────────────────────────────────────────

/**
 * 驗證 storyboard 的時間軸合法性：
 *   - 各 scene 不重疊、按 startSec 排序
 *   - scene.endSec 不超過 totalDurationSec
 *   - characterBeat 的 offset+duration 不超過 scene 長度
 *   - frame.atSec 不超過 scene 長度
 */
export function validateStoryboardTimeline(sb: WorldStoryboard): string[] {
  const errors: string[] = [];
  const sortedScenes = [...sb.scenes].sort(
    (a, b) => a.startSec - b.startSec
  );
  for (let i = 0; i < sortedScenes.length; i++) {
    const s = sortedScenes[i];
    if (s.endSec <= s.startSec)
      errors.push(`Scene #${s.sequenceIndex} 終止時間不能早於起始時間`);
    if (s.endSec > sb.totalDurationSec)
      errors.push(
        `Scene #${s.sequenceIndex} 終止 ${s.endSec}s 超過全片 ${sb.totalDurationSec}s`
      );
    if (i > 0 && s.startSec < sortedScenes[i - 1].endSec)
      errors.push(
        `Scene #${s.sequenceIndex} 與前一場時間重疊（${sortedScenes[i - 1].endSec}s vs ${s.startSec}s）`
      );

    const sceneLength = s.endSec - s.startSec;
    for (const beat of s.characterBeats) {
      if (beat.startOffsetSec + beat.durationSec > sceneLength + 0.01)
        errors.push(
          `Scene #${s.sequenceIndex} 角色 ${beat.characterId} 出場時間超出場長`
        );
    }
    for (const f of s.frames) {
      if (f.atSec > sceneLength + 0.01)
        errors.push(
          `Scene #${s.sequenceIndex} frame ${f.id} 時間 ${f.atSec}s 超出場長 ${sceneLength}s`
        );
    }
  }
  return errors;
}

/** "幾分幾秒" 格式化：65 → "01:05"；3725 → "01:02:05" */
export function formatTimecode(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ─── Prompt 編譯：用世界觀資料把 frame.prompt 補全 ─────────────────────────

/**
 * 把一個 frame 編譯成完整的 t2i prompt —
 * 結合：場景一致性 + 角色一致性（含當下穿著、表情）+ 風格 profile + 鏡頭。
 *
 * 動畫管線在進入 generate_keyframe 步驟前會呼叫此函式。
 */
export function buildFramePrompt(args: {
  framework: WorldbuildingFrameworkData;
  storyboardScene: StoryboardScene;
  frame: StoryboardFrame;
  /** 在這格出現的角色（從 characterBeats 推導） */
  presentBeats: StoryboardCharacterBeat[];
}): string {
  const { framework, storyboardScene, frame, presentBeats } = args;
  const parts: string[] = [];

  // 1. 場景一致性
  const worldScene = framework.scenes.find(
    s => s.id === storyboardScene.worldSceneId
  );
  const styleProfile =
    framework.styleProfiles?.find(
      p =>
        p.id ===
        (storyboardScene.styleProfileId ??
          worldScene?.styleProfileId ??
          framework.defaultStyleProfileId)
    ) ?? undefined;

  if (worldScene) {
    if (worldScene.triggerWord) parts.push(worldScene.triggerWord);
    if (worldScene.environment) parts.push(worldScene.environment);
    if (worldScene.lighting) parts.push(`光線：${worldScene.lighting}`);
    if (worldScene.mood) parts.push(`氛圍：${worldScene.mood}`);
    // 場景細節：植被 / 動物 / 道具（各取前 2 項，避免 prompt 過長）
    if (worldScene.flora?.length)
      parts.push(`植被：${worldScene.flora.slice(0, 2).join("、")}`);
    if (worldScene.fauna?.length)
      parts.push(`生物：${worldScene.fauna.slice(0, 2).join("、")}`);
    if (worldScene.props?.length)
      parts.push(`道具：${worldScene.props.slice(0, 3).join("、")}`);
    // 建築 / 美術設定：年代、建材
    if (worldScene.productionDesign?.architecturalStyle)
      parts.push(`建築：${worldScene.productionDesign.architecturalStyle}`);
    if (worldScene.productionDesign?.materials?.length)
      parts.push(`建材：${worldScene.productionDesign.materials.slice(0, 2).join("、")}`);
    // Layout 提示：hero shot / 出入口（給構圖參考）
    if (worldScene.layout?.heroShotAngle && !frame.shotDescription)
      parts.push(`機位：${worldScene.layout.heroShotAngle}`);
    // 大氣 / 粒子：霧、塵、光柱、雨雪
    const atmo = worldScene.atmospherics;
    if (atmo) {
      const atmoParts: string[] = [];
      if (atmo.fogDensity && atmo.fogDensity > 0.3) atmoParts.push("濃霧");
      if (atmo.dustMotes) atmoParts.push("塵埃飛舞");
      if (atmo.lightShafts) atmoParts.push("光柱");
      if (atmo.precipitation && atmo.precipitation !== "none")
        atmoParts.push(atmo.precipitation);
      if (atmo.lightning) atmoParts.push("閃電");
      if (atmo.customParticles?.length)
        atmoParts.push(...atmo.customParticles.slice(0, 1));
      if (atmoParts.length) parts.push(atmoParts.join("、"));
    }
  }

  if (styleProfile) {
    if (styleProfile.triggerWord) parts.push(styleProfile.triggerWord);
    if (styleProfile.artStyle) parts.push(styleProfile.artStyle);
    if (styleProfile.schoolReference) parts.push(styleProfile.schoolReference);
    if (styleProfile.palette?.length)
      parts.push(`色票：${styleProfile.palette.join("/")}`);
    if (styleProfile.lensSpec?.aspectRatio)
      parts.push(`比例 ${styleProfile.lensSpec.aspectRatio}`);
    if (styleProfile.lensSpec?.depthOfField)
      parts.push(`景深：${styleProfile.lensSpec.depthOfField}`);
    if (styleProfile.shadingModel)
      parts.push(`著色：${styleProfile.shadingModel}`);
    if (styleProfile.lineSpec?.lineStyle)
      parts.push(`線條：${styleProfile.lineSpec.lineStyle}`);
    if (styleProfile.shootOn) parts.push(`拍 ${styleProfile.shootOn} 格`);
  }

  // 2. 鏡頭設定
  if (frame.shotSize) parts.push(`構圖：${frame.shotSize}`);
  if (frame.cameraMovement) parts.push(`運鏡：${frame.cameraMovement}`);
  else if (storyboardScene.cameraDirection)
    parts.push(`鏡頭指示：${storyboardScene.cameraDirection}`);

  // 3. 角色一致性
  for (const beat of presentBeats) {
    const c = framework.characters.find(ch => ch.id === beat.characterId);
    if (!c) continue;
    const cparts: string[] = [];
    if (c.triggerWord) cparts.push(c.triggerWord);
    cparts.push(c.name);
    // 體型 / 種族 / 顯著生理特徵（影響三視圖一致性）
    if (c.body?.species) cparts.push(c.body.species);
    if (c.body?.ageStage) cparts.push(c.body.ageStage);
    if (c.body?.distinctiveFeatures?.length)
      cparts.push(...c.body.distinctiveFeatures.slice(0, 2));
    const outfit =
      (beat.outfitId && c.outfits?.find(o => o.id === beat.outfitId)) ||
      c.outfits?.find(o => o.isDefault) ||
      c.outfits?.[0];
    if (outfit) {
      if (outfit.triggerWord) cparts.push(outfit.triggerWord);
      if (outfit.description) cparts.push(outfit.description);
    } else if (c.outfit) cparts.push(c.outfit);

    if (beat.expressionId) {
      const expr = c.expressions?.find(e => e.id === beat.expressionId);
      if (expr) {
        cparts.push(`表情：${expr.name}`);
        if (expr.promptKeywords?.length) cparts.push(...expr.promptKeywords);
      }
    }
    // 姿勢：beat.pose 優先；否則用 actingNotes.defaultPosture
    if (beat.pose) cparts.push(beat.pose);
    else if (c.actingNotes?.defaultPosture)
      cparts.push(c.actingNotes.defaultPosture);
    // 互動標籤（同場角色關係：戀人 / 敵對 / 羈絆…）
    if (beat.interactionTags?.length)
      cparts.push(`互動：${beat.interactionTags.slice(0, 2).join("、")}`);
    parts.push(`[${cparts.join(", ")}]`);
  }

  // 4. 場景動作 + frame 自身描述
  if (frame.shotDescription) parts.push(frame.shotDescription);
  else if (storyboardScene.actionDescription)
    parts.push(storyboardScene.actionDescription);

  return parts.filter(Boolean).join(", ");
}

/** 編譯該 frame 的 negative prompt */
export function buildFrameNegativePrompt(args: {
  framework: WorldbuildingFrameworkData;
  storyboardScene: StoryboardScene;
  frame: StoryboardFrame;
}): string {
  const parts: string[] = [];
  if (args.frame.negativePrompt) parts.push(args.frame.negativePrompt);
  if (args.framework.globalNegativePrompt)
    parts.push(args.framework.globalNegativePrompt);
  const styleProfile = args.framework.styleProfiles?.find(
    p =>
      p.id ===
      (args.storyboardScene.styleProfileId ??
        args.framework.defaultStyleProfileId)
  );
  if (styleProfile?.negativePrompt) parts.push(styleProfile.negativePrompt);
  // 製作目標的受眾 → 安全詞（兒童 / 全年齡會自動排除血腥色情）
  const audienceNeg = buildAudienceSafetyNegative(
    args.framework.productionTargets?.audience
  );
  if (audienceNeg) parts.push(audienceNeg);
  // 製作目標的內容分級
  const rating = args.framework.productionTargets?.rating?.toLowerCase();
  if (rating && (rating === "g" || rating === "pg")) {
    if (!audienceNeg) parts.push("blood, gore, nudity, sexual content");
  }
  return parts.filter(Boolean).join(", ");
}

// ─── 動畫管線編排（核心） ──────────────────────────────────────────────────

/**
 * 把一個 storyboard 拓樸排序成 render job 序列。
 *
 * 依賴關係：
 *   - generate_keyframe（每 frame）   無依賴
 *   - refine_image（每 frame）         依賴 generate_keyframe
 *   - image_to_video（每 frame）       依賴 refine_image
 *   - generate_music（每 scene）       無依賴
 *   - generate_voiceover（每 voice clip）  無依賴
 *   - generate_sfx（每 sfx clip）       無依賴
 *   - compose_audio_track（每 scene）   依賴本場所有 audio
 *   - compose_final_video               依賴全部 i2v + 全部 compose_audio_track
 *
 * 估算：t2i ~15s、refine ~30s、i2v ~60s、music ~45s、tts ~20s、final compose ~30s
 */
export function planAnimationPipeline(
  storyboard: WorldStoryboard,
  framework: WorldbuildingFrameworkData,
  options?: { skipRefine?: boolean; skipVideo?: boolean }
): AnimationPipelinePlan {
  const steps: AnimationPipelineStep[] = [];
  const concurrencyHints: Record<string, number> = {
    "image-specialist": 4,
    "video-specialist": 2,
    "music-specialist": 2,
    "voice-specialist": 4,
    "video-compositor": 1,
  };
  let estSec = 0;
  let estUsd = 0;

  // 預估：所有 i2v 步驟的 ids，最後 compose 用
  const allVideoStepIds: string[] = [];
  // 各 scene 的所有 audio step id，給 compose_audio_track 依賴
  const sceneAudioStepIds: Record<string, string[]> = {};

  for (const scene of storyboard.scenes) {
    sceneAudioStepIds[scene.id] = [];

    // ── frames：t2i → refine → i2v ──
    for (const frame of scene.frames) {
      const presentBeats = scene.characterBeats.filter(
        b =>
          frame.atSec >= b.startOffsetSec &&
          frame.atSec <= b.startOffsetSec + b.durationSec
      );

      const t2iId = `t2i:${scene.id}:${frame.id}`;
      steps.push({
        stepId: t2iId,
        sceneId: scene.id,
        frameId: frame.id,
        kind: "generate_keyframe",
        spirit: "image-specialist",
        tool: "studio.generateImage",
        input: {
          prompt: buildFramePrompt({
            framework,
            storyboardScene: scene,
            frame,
            presentBeats,
          }),
          negativePrompt: buildFrameNegativePrompt({
            framework,
            storyboardScene: scene,
            frame,
          }),
          aspectRatio:
            framework.styleProfiles?.find(
              p => p.id === framework.defaultStyleProfileId
            )?.lensSpec?.aspectRatio ?? storyboard.aspectRatio,
          seed: frame.seed,
          modelId: frame.modelHints?.imageModel,
          loraIds: collectActiveLoraIds(framework, presentBeats, scene),
        },
        dependsOn: [],
        outputType: "image",
        estimatedSec: 15,
      });
      estUsd += 0.02;
      let lastFrameStepId = t2iId;

      if (!options?.skipRefine) {
        const refineId = `refine:${scene.id}:${frame.id}`;
        steps.push({
          stepId: refineId,
          sceneId: scene.id,
          frameId: frame.id,
          kind: "refine_image",
          spirit: "image-specialist",
          tool: "studio.imageToImage",
          input: {
            sourceFrameStepId: t2iId,
            prompt: "細膩化、補細節、修正崩壞、提高解析度",
            modelId: frame.modelHints?.refineModel,
          },
          dependsOn: [t2iId],
          outputType: "image",
          estimatedSec: 30,
        });
        estUsd += 0.03;
        lastFrameStepId = refineId;
      }

      if (!options?.skipVideo) {
        const i2vId = `i2v:${scene.id}:${frame.id}`;
        steps.push({
          stepId: i2vId,
          sceneId: scene.id,
          frameId: frame.id,
          kind: "image_to_video",
          spirit: "video-specialist",
          tool: "studio.imageToVideo",
          input: {
            sourceFrameStepId: lastFrameStepId,
            motionHint: frame.cameraMovement ?? scene.cameraDirection,
            durationSec: 3,
            modelId: frame.modelHints?.videoModel,
          },
          dependsOn: [lastFrameStepId],
          outputType: "video",
          estimatedSec: 60,
        });
        estUsd += 0.12;
        allVideoStepIds.push(i2vId);
      }
    }

    // ── audio：music / voiceover / sfx ──
    for (const clip of scene.audioClips) {
      // 已有現成檔案（status=ready + audioUrl）→ 跳過生成步驟。
      // compose_audio_track 仍會在 input 中讀到此 clip 的 audioUrl 並混音。
      if (clip.status === "ready" && clip.audioUrl) {
        continue;
      }
      if (clip.kind === "music") {
        const theme = framework.musicThemes?.find(
          m => m.id === clip.musicThemeId
        );
        const id = `music:${scene.id}:${clip.id}`;
        steps.push({
          stepId: id,
          sceneId: scene.id,
          kind: "generate_music",
          spirit: "music-specialist",
          tool: "studio.generateMusic",
          input: {
            prompt: buildMusicPrompt(theme, scene),
            durationSec: clip.durationSec,
            bpm: theme?.bpm,
            volume: clip.volume,
          },
          dependsOn: [],
          outputType: "audio",
          estimatedSec: 45,
        });
        estUsd += 0.08;
        sceneAudioStepIds[scene.id].push(id);
      } else if (clip.kind === "voiceover") {
        const character = framework.characters.find(
          c => c.id === clip.characterId
        );
        const id = `voice:${scene.id}:${clip.id}`;
        steps.push({
          stepId: id,
          sceneId: scene.id,
          kind: "generate_voiceover",
          spirit: "voice-specialist",
          tool: "studio.generateVoice",
          input: {
            text: clip.text ?? "",
            voiceId: character?.voiceProfile?.voiceId,
            engine: character?.voiceProfile?.engine,
            languageCode: character?.voiceProfile?.languageCode,
            pitch: character?.voiceProfile?.pitch,
            speed: character?.voiceProfile?.speed,
            emotion: character?.voiceProfile?.emotion,
            promptPrefix: character?.voiceProfile?.promptPrefix,
            useClone: character?.voiceProfile?.useClone,
            cloneSampleUrls: character?.voiceProfile?.cloneSampleUrls,
          },
          dependsOn: [],
          outputType: "voice",
          estimatedSec: 20,
        });
        estUsd += 0.04;
        sceneAudioStepIds[scene.id].push(id);
      } else if (clip.kind === "sfx") {
        const id = `sfx:${scene.id}:${clip.id}`;
        steps.push({
          stepId: id,
          sceneId: scene.id,
          kind: "generate_sfx",
          spirit: "music-specialist",
          tool: "studio.generateSfx",
          input: {
            prompt: clip.sfxDescription,
            durationSec: clip.durationSec,
          },
          dependsOn: [],
          outputType: "audio",
          estimatedSec: 15,
        });
        estUsd += 0.02;
        sceneAudioStepIds[scene.id].push(id);
      }
    }

    // 該場音軌合成（如有任何音訊步驟）
    if (sceneAudioStepIds[scene.id].length > 0) {
      const composeId = `compose-audio:${scene.id}`;
      steps.push({
        stepId: composeId,
        sceneId: scene.id,
        kind: "compose_audio_track",
        spirit: "video-compositor",
        tool: "audio.composeTrack",
        input: { sceneId: scene.id },
        dependsOn: sceneAudioStepIds[scene.id],
        outputType: "audio",
        estimatedSec: 10,
      });
    }
  }

  // 最終合成：依賴所有 i2v + 所有 compose-audio。
  // 若 skipVideo（沒有任何 i2v step），則跳過最終合成 —— 因為沒有影片可合。
  const finalDeps = [
    ...allVideoStepIds,
    ...storyboard.scenes
      .filter(s => sceneAudioStepIds[s.id]?.length > 0)
      .map(s => `compose-audio:${s.id}`),
  ];
  if (allVideoStepIds.length > 0 && finalDeps.length > 0) {
    steps.push({
      stepId: "compose-final",
      sceneId: "global",
      kind: "compose_final_video",
      spirit: "video-compositor",
      tool: "video.composeFinal",
      input: {
        storyboardId: storyboard.id,
        aspectRatio: storyboard.aspectRatio,
        fps: storyboard.fps,
      },
      dependsOn: finalDeps,
      outputType: "video",
      estimatedSec: 30,
    });
    estUsd += 0.1;
  }

  // 估算 wall-clock：使用並行模擬 —— 對每個 spirit 按 concurrency 切批
  estSec = estimateWallClock(steps, concurrencyHints);

  return {
    storyboardId: storyboard.id ?? 0,
    steps,
    estimatedWallClockSec: estSec,
    estimatedCostUsd: Number(estUsd.toFixed(3)),
    concurrencyHints,
  };
}

/** 收集當下 frame 該套用的 LoRA 模型 id：場景 + 角色 + 風格 profile */
function collectActiveLoraIds(
  framework: WorldbuildingFrameworkData,
  presentBeats: StoryboardCharacterBeat[],
  scene: StoryboardScene
): number[] {
  const ids = new Set<number>();
  const worldScene = framework.scenes.find(s => s.id === scene.worldSceneId);
  if (worldScene?.linkedModelId) ids.add(worldScene.linkedModelId);
  for (const beat of presentBeats) {
    const c = framework.characters.find(ch => ch.id === beat.characterId);
    if (c?.linkedModelId) ids.add(c.linkedModelId);
  }
  const styleProfileId =
    scene.styleProfileId ??
    worldScene?.styleProfileId ??
    framework.defaultStyleProfileId;
  const styleProfile = framework.styleProfiles?.find(
    p => p.id === styleProfileId
  );
  if (styleProfile?.linkedModelId) ids.add(styleProfile.linkedModelId);
  return Array.from(ids);
}

function buildMusicPrompt(
  theme: WorldMusicTheme | undefined,
  scene: StoryboardScene
): string {
  const parts: string[] = [];
  if (theme?.name) parts.push(theme.name);
  if (theme?.mood) parts.push(theme.mood);
  if (theme?.instruments?.length) parts.push(theme.instruments.join("、"));
  if (theme?.bpm) parts.push(`BPM ${theme.bpm}`);
  if (theme?.timeSignature) parts.push(`拍號 ${theme.timeSignature}`);
  if (theme?.key) parts.push(theme.key);
  if (theme?.promptKeywords?.length) parts.push(...theme.promptKeywords);
  // Leitmotif —— 文字描述主題動機（給 AI 編曲時保持一致性）
  if (theme?.leitmotif?.description)
    parts.push(`主題動機：${theme.leitmotif.description}`);
  else if (theme?.leitmotif?.melodicPhrase)
    parts.push(`旋律：${theme.leitmotif.melodicPhrase}`);
  // Transition style + LUFS 讓混音器拿到完整脈絡
  if (theme?.transitionStyle) parts.push(`銜接：${theme.transitionStyle}`);
  if (theme?.lufsTarget != null) parts.push(`LUFS ${theme.lufsTarget}`);
  if (scene.actionDescription)
    parts.push(`場景動作：${scene.actionDescription}`);
  return parts.filter(Boolean).join(", ");
}

/**
 * 並行 wall-clock 估算 —— 對每個 spirit 排程，考慮 concurrency 上限。
 * 簡化版：拓樸排序 + 同層按 spirit 分桶並行，桶內 ceil(count / concurrency)。
 */
function estimateWallClock(
  steps: AnimationPipelineStep[],
  concurrency: Record<string, number>
): number {
  // 計算每個 step 的 earliest start time
  const startTime = new Map<string, number>();
  const endTime = new Map<string, number>();
  // 每個 spirit 的「下一個可開始時間隊列」
  const spiritQueues = new Map<string, number[]>();

  // 拓樸排序
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    inDeg.set(s.stepId, s.dependsOn.length);
    for (const dep of s.dependsOn) {
      if (!adj.has(dep)) adj.set(dep, []);
      adj.get(dep)!.push(s.stepId);
    }
  }
  const queue: string[] = [];
  for (const s of steps) if ((inDeg.get(s.stepId) ?? 0) === 0) queue.push(s.stepId);

  const stepMap = new Map(steps.map(s => [s.stepId, s]));

  while (queue.length) {
    const id = queue.shift()!;
    const step = stepMap.get(id)!;
    const depFinish = step.dependsOn.reduce(
      (mx, d) => Math.max(mx, endTime.get(d) ?? 0),
      0
    );
    // 從該 spirit 的併發隊列中取得最早可用 slot
    const cap = concurrency[step.spirit] ?? 1;
    if (!spiritQueues.has(step.spirit))
      spiritQueues.set(step.spirit, new Array(cap).fill(0));
    const slots = spiritQueues.get(step.spirit)!;
    // 找最早結束的 slot
    let minIdx = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i] < slots[minIdx]) minIdx = i;
    const start = Math.max(depFinish, slots[minIdx]);
    const end = start + (step.estimatedSec ?? 0);
    slots[minIdx] = end;
    startTime.set(id, start);
    endTime.set(id, end);

    for (const nxt of adj.get(id) ?? []) {
      inDeg.set(nxt, (inDeg.get(nxt) ?? 0) - 1);
      if (inDeg.get(nxt) === 0) queue.push(nxt);
    }
  }

  let max = 0;
  for (const v of endTime.values()) if (v > max) max = v;
  return Math.ceil(max);
}

// ─── 自動播種：從世界觀全模組推導分鏡架構 ─────────────────────────────────
//
//   設計：分鏡骨架是世界觀系統的「縫合層」 —— 把零散的角色、場景、
//   風格、配樂、研究、音效、製作目標、腳本定位等模組，全部編織成
//   一條可執行的時間軸。每個世界觀欄位都對應到分鏡的某個位置：
//
//     productionTargets.targetDurationSec  → 預設總長
//     productionTargets.masterSpec.fps     → 預設 fps
//     scene.preferredAspectRatio           → 預設比例
//     scene.styleProfileId                 → storyboard scene.styleProfileId
//     scene.musicThemeId                   → storyboard scene.musicThemeId
//     scene.defaultCameraMovement          → storyboard scene.cameraDirection
//     scene.environment / mood / changes   → actionDescription
//     scene.soundDesign.signatureSfx       → audioClips (sfx)
//     scene.soundLibraryRefs               → audioClips (ambient)
//     character.scriptRole.appearsInBeats  → 角色在哪幕出場
//     character.scriptRole.avgScreenTimeRatio → 占場比例
//     character.scriptRole.signatureLines  → 開場/高潮/結尾對白
//     character.outfits[isDefault]         → beat.outfitId
//     character.expressions                → beat.expressionId（按幕別匹配）
//     musicThemes (by mood)                → 按場景情緒挑配樂
//     researchEntries (isCanon)            → 場景 notes 注入正史參考
//
//   設計原則：所有現有測試保留通過 —— 場數、起訖秒、主角到場等不變，
//   只是「填得更滿」、把更多模組資料寫進骨架。

/** 敘事節拍 —— 把場序映射成戲劇結構的標籤。 */
export type NarrativeBeat =
  | "opening"
  | "rising"
  | "climax"
  | "falling"
  | "ending";

const BEAT_LABELS_ZH: Record<NarrativeBeat, string> = {
  opening: "開場",
  rising: "發展",
  climax: "高潮",
  falling: "轉折",
  ending: "結局",
};

/** 角色 scriptRole.appearsInBeats 的中英關鍵字辨識表。 */
const BEAT_TAG_KEYWORDS: Record<NarrativeBeat, string[]> = {
  opening: ["開場", "序", "起", "引子", "opening", "intro"],
  rising: ["發展", "上升", "推進", "rising", "build"],
  climax: ["高潮", "頂點", "巔峰", "climax", "peak"],
  falling: ["轉折", "下降", "falling", "twist"],
  ending: ["結局", "結尾", "尾聲", "落幕", "終", "ending", "outro"],
};

/** 把 (場序, 總場數) 解析成 NarrativeBeat 標籤 */
export function resolveNarrativeBeat(
  idx: number,
  total: number
): NarrativeBeat {
  if (total <= 1) return "opening";
  if (idx === 0) return "opening";
  if (idx === total - 1) return "ending";
  const ratio = idx / (total - 1);
  if (ratio < 0.45) return "rising";
  if (ratio < 0.75) return "climax";
  return "falling";
}

/** 判斷角色的 appearsInBeats 是否覆蓋當前節拍 */
function characterTaggedForBeat(c: WorldCharacter, beat: NarrativeBeat): boolean {
  const tags = c.scriptRole?.appearsInBeats;
  if (!tags?.length) return false;
  const keys = BEAT_TAG_KEYWORDS[beat];
  return tags.some(t => {
    const lower = t.toLowerCase();
    return keys.some(k => lower.includes(k.toLowerCase()));
  });
}

/** 按場景情緒 / 節拍挑選最適合的配樂主題 */
function pickMusicThemeForScene(
  worldScene: WorldScene | undefined,
  themes: WorldMusicTheme[] | undefined,
  beat: NarrativeBeat,
  characterIds: string[]
): WorldMusicTheme | undefined {
  if (!themes?.length) return undefined;

  // 1) 場景直接鎖定
  if (worldScene?.musicThemeId) {
    const m = themes.find(t => t.id === worldScene.musicThemeId);
    if (m) return m;
  }

  // 2) 角色主題（applicableCharacterIds 命中當前在場角色）
  for (const t of themes) {
    if (t.applicableCharacterIds?.some(id => characterIds.includes(id))) {
      return t;
    }
  }

  // 3) 場景白名單（applicableSceneIds 命中當前場景）
  if (worldScene) {
    for (const t of themes) {
      if (t.applicableSceneIds?.includes(worldScene.id)) return t;
    }
  }

  // 4) 場景 mood 與主題 mood 模糊匹配
  if (worldScene?.mood) {
    const sceneMood = worldScene.mood;
    const m = themes.find(
      t =>
        t.mood &&
        (t.mood.includes(sceneMood) || sceneMood.includes(t.mood))
    );
    if (m) return m;
  }

  // 5) 節拍對應的情緒池
  const beatMoodPool: Record<NarrativeBeat, string[]> = {
    opening: ["希望", "溫馨", "靜謐", "神秘", "懷舊"],
    rising: ["希望", "刺激", "推進", "動感"],
    climax: ["史詩", "緊張", "戰鬥", "激昂"],
    falling: ["哀傷", "壓抑", "孤寂"],
    ending: ["溫馨", "希望", "釋懷", "落幕"],
  };
  for (const mood of beatMoodPool[beat]) {
    const m = themes.find(t => t.mood?.includes(mood));
    if (m) return m;
  }

  // 6) Fallback：第一個主題
  return themes[0];
}

/** 按節拍挑選角色預設表情 id（從 expressions 名稱 / 關鍵字推導） */
function pickExpressionForBeat(
  c: WorldCharacter,
  beat: NarrativeBeat
): string | undefined {
  if (!c.expressions?.length) return undefined;
  const beatExprKeys: Record<NarrativeBeat, string[]> = {
    opening: ["微笑", "平靜", "好奇", "smile", "neutral", "calm"],
    rising: ["決心", "認真", "專注", "determined", "focused"],
    climax: ["憤怒", "驚訝", "激動", "決絕", "anger", "shock", "intense"],
    falling: ["哀傷", "失落", "疲憊", "sad", "tired"],
    ending: ["微笑", "釋懷", "平靜", "smile", "peaceful", "relief"],
  };
  const keys = beatExprKeys[beat];
  for (const k of keys) {
    const lower = k.toLowerCase();
    const found = c.expressions.find(e => {
      if (e.name.toLowerCase().includes(lower)) return true;
      return e.promptKeywords?.some(pk =>
        pk.toLowerCase().includes(lower)
      );
    });
    if (found) return found.id;
  }
  return c.expressions[0]?.id;
}

/** 從 scriptRole.signatureLines 挑出符合當前節拍的招牌台詞 */
function pickSignatureLineForBeat(
  c: WorldCharacter,
  beat: NarrativeBeat
): string | undefined {
  const lines = c.scriptRole?.signatureLines;
  if (!lines?.length) return undefined;
  if (beat === "opening") return lines[0];
  if (beat === "ending") return lines[lines.length - 1];
  if (beat === "climax") {
    return lines[Math.min(lines.length - 1, Math.floor(lines.length / 2))];
  }
  return undefined;
}

/** 找出與當前場景最相關的正史研究條目（給 scene.notes 注入背景參考） */
function pickCanonResearchForScene(
  research: WorldResearchEntry[] | undefined,
  worldScene: WorldScene | undefined,
  beat: NarrativeBeat
): WorldResearchEntry | undefined {
  if (!research?.length) return undefined;
  const canon = research.filter(r => r.isCanon !== false);
  if (!canon.length) return undefined;

  // 1) tag / title 與場景 environment / name 模糊匹配
  if (worldScene) {
    const haystack = `${worldScene.name ?? ""} ${
      worldScene.environment ?? ""
    } ${worldScene.tagline ?? ""}`.toLowerCase();
    const matched = canon.find(r => {
      if (r.tags?.some(t => haystack.includes(t.toLowerCase()))) return true;
      return r.title && haystack.includes(r.title.toLowerCase());
    });
    if (matched) return matched;
  }

  // 2) 開場優先 geography / history，高潮優先 politics / religion
  const beatCategoryPref: Record<NarrativeBeat, string[]> = {
    opening: ["geography", "culture", "history"],
    rising: ["culture", "technology", "economy"],
    climax: ["politics", "religion", "history"],
    falling: ["culture", "religion"],
    ending: ["culture", "history", "language"],
  };
  for (const cat of beatCategoryPref[beat]) {
    const m = canon.find(r => r.category === cat);
    if (m) return m;
  }

  // 3) Fallback：第一個正史
  return canon[0];
}

/** 把研究條目壓縮成 scene.notes 字串（< 200 字） */
function summarizeResearchEntryForNotes(r: WorldResearchEntry): string {
  const parts: string[] = [`[正史參考] ${r.title}`];
  if (r.category) parts.push(`類別：${r.category}`);
  if (r.content) parts.push(r.content.slice(0, 140));
  if (r.tags?.length) parts.push(`#${r.tags.slice(0, 4).join(" #")}`);
  return parts.join("　");
}

/**
 * 從場景的 timeOfDay 列表選一個時段 —— 多場景重用同一 worldScene 時
 * 自動輪替時段（黎明 / 黃昏 / 入夜…），增加視覺變化。
 */
function pickTimeOfDayForScene(
  worldScene: WorldScene | undefined,
  sceneIdx: number
): SceneTimeOfDay | undefined {
  const arr = worldScene?.timeOfDay;
  if (!arr?.length) return undefined;
  return arr[sceneIdx % arr.length];
}

/**
 * 按場長從 musicTheme.cueVariants 中挑選最相近時長的變體 —— 給混音用。
 * 回傳變體 label，注入到 audio clip 的 sfxDescription 作為 hint
 * （StoryboardAudioClip 沒有 cueVariantId 欄位，先用既有欄位攜帶）。
 */
function pickCueVariantLabelForDuration(
  theme: WorldMusicTheme | undefined,
  durationSec: number
): string | undefined {
  const variants = theme?.cueVariants;
  if (!variants?.length) return undefined;
  let best = variants[0];
  let bestDiff = Math.abs(best.durationSec - durationSec);
  for (const v of variants) {
    const d = Math.abs(v.durationSec - durationSec);
    if (d < bestDiff) {
      best = v;
      bestDiff = d;
    }
  }
  return best.label;
}

/**
 * 同場角色之間如有 relationships，互寫 interactionTags ——
 * 讓動畫師 / LLM 在同場戲裡知道彼此的關係（羈絆、敵對、戀人等）。
 */
function enrichBeatsWithInteractionTags(
  beats: StoryboardCharacterBeat[],
  characters: WorldCharacter[]
): void {
  if (beats.length < 2) return;
  const charById = new Map(characters.map(c => [c.id, c]));
  const inSceneIds = new Set(beats.map(b => b.characterId));
  for (const beat of beats) {
    const c = charById.get(beat.characterId);
    const rels = c?.scriptRole?.relationships;
    if (!rels?.length) continue;
    const tags = new Set(beat.interactionTags ?? []);
    for (const rel of rels) {
      if (inSceneIds.has(rel.targetCharacterId) && rel.relation) {
        tags.add(rel.relation);
      }
    }
    if (tags.size > 0) beat.interactionTags = Array.from(tags);
  }
}

/**
 * 為有 dialogue 的角色 beat 自動建立對應的 voiceover 音軌 ——
 * 閉合「signatureLines → dialogue → 配音」這條線。
 * 條件：角色有 voiceProfile.voiceId 或 voiceProfile.engine。
 */
function buildVoiceoverClipsForBeats(
  beats: StoryboardCharacterBeat[],
  characters: WorldCharacter[],
  sceneIdxPrefix: number,
  sceneLengthSec: number
): StoryboardAudioClip[] {
  const clips: StoryboardAudioClip[] = [];
  const charById = new Map(characters.map(c => [c.id, c]));
  for (const beat of beats) {
    const text = beat.dialogue?.trim();
    if (!text) continue;
    const c = charById.get(beat.characterId);
    const vp = c?.voiceProfile;
    if (!vp?.voiceId && !vp?.engine) continue;
    const estDur = estimateDialogueDurationSec(text);
    const start = Math.max(
      0,
      Math.min(sceneLengthSec - estDur, beat.startOffsetSec + 1)
    );
    clips.push({
      id: `${sceneIdxPrefix}-vo-${beat.characterId}`,
      kind: "voiceover",
      startOffsetSec: start,
      durationSec: Math.max(1, Math.min(sceneLengthSec, estDur)),
      characterId: beat.characterId,
      text,
      volume: 0.85,
      fadeInSec: 0.2,
      fadeOutSec: 0.3,
      status: "pending",
    });
  }
  return clips;
}

/**
 * 估算中文台詞所需語音時長 —— 約 3.5 字 / 秒。
 * Clamp 至 [2, 15]，避免單句佔滿整場或不到 1 秒。
 */
function estimateDialogueDurationSec(text: string): number {
  const charCount = Array.from(text).length;
  return Math.max(2, Math.min(15, Math.ceil(charCount / 3.5)));
}

/**
 * 找出 framework.objects 中 appearsInScenes 命中當前場景的物件名稱，
 * 拼入 actionDescription，告訴 LLM / 動畫師此場該出現哪些道具。
 */
function pickObjectsForScene(
  framework: WorldbuildingFrameworkData,
  worldSceneId: string | undefined
): string[] {
  if (!worldSceneId || !framework.objects?.length) return [];
  return framework.objects
    .filter(o => o.appearsInScenes?.includes(worldSceneId))
    .slice(0, 4)
    .map(o => o.name);
}

/**
 * 依 productionTargets.audience 推導追加的負面提示詞 ——
 * 兒童 / 全年齡限制血腥色情，青少年僅限明顯露骨。
 */
function buildAudienceSafetyNegative(
  audience: string | undefined
): string | undefined {
  if (!audience) return undefined;
  const a = audience.toLowerCase();
  if (
    a.includes("兒童") ||
    a.includes("全年齡") ||
    a.includes("kids") ||
    a.includes("children") ||
    a.includes("family")
  ) {
    return "blood, gore, scary, violence, sexual content, nudity, weapons closeup";
  }
  if (a.includes("青少年") || a.includes("teen") || a.includes("pg-13")) {
    return "explicit gore, sexual content, nudity";
  }
  return undefined;
}

/**
 * 平台對應的優先比例（TikTok / Reels 走 9:16，YouTube Shorts 也是；
 * 影展 / 電影走 16:9 或 21:9）。若使用者沒指定 args.aspectRatio 且場景
 * 也沒 preferredAspectRatio，會用這個 fallback。
 */
function inferAspectFromPlatform(platform: string | undefined): string | undefined {
  if (!platform) return undefined;
  const p = platform.toLowerCase();
  if (
    p.includes("tiktok") ||
    p.includes("reels") ||
    p.includes("shorts") ||
    p.includes("抖音")
  ) {
    return "9:16";
  }
  if (p.includes("instagram")) return "1:1";
  if (p.includes("影展") || p.includes("cinema") || p.includes("film festival")) {
    return "21:9";
  }
  return undefined;
}

/**
 * 從角色的 actingNotes 推導初始 pose：
 *   - 開場場景 → signatureGestures[0]（招牌動作出場最有辨識度）
 *   - 其他場景 → defaultPosture（基本站姿 / 坐姿）
 */
function pickPoseForBeat(
  c: WorldCharacter,
  beat: NarrativeBeat
): string | undefined {
  if (beat === "opening" && c.actingNotes?.signatureGestures?.length) {
    return c.actingNotes.signatureGestures[0];
  }
  return c.actingNotes?.defaultPosture;
}

/**
 * 從世界觀生成一個 "空白分鏡骨架"。
 *
 * 此函式是世界觀系統的核心縫合層 —— 它把所有模組（角色、場景、風格、
 * 配樂、研究、音效、製作目標）整合成一條可派生的時間軸。
 *
 * 給定總長與 scene 切法，會：
 *   1. 從 productionTargets 推導 fps / aspectRatio 預設
 *   2. 依角色 scriptRole（appearsInBeats / avgScreenTimeRatio / defaultPosition）
 *      決定每場誰登場
 *   3. 自動指定每個 beat 的 outfitId（預設穿衣）與 expressionId（按節拍）
 *   4. 開場 / 高潮 / 結尾自動寫入 signatureLines 作為 dialogue 種子
 *   5. 每場 styleProfile / musicTheme 從場景鎖定欄位繼承，否則按情緒挑選
 *   6. 場景的 signatureSfx 與 soundLibraryRefs 自動展開為 sfx 音軌
 *   7. researchEntries 中的正史條目按場景關聯注入到 notes
 *   8. actionDescription 整合場景 environment / mood / environmentChanges
 */
export function seedStoryboardSkeleton(args: {
  framework: WorldbuildingFrameworkData;
  totalDurationSec: number;
  sceneCount?: number;
  aspectRatio?: string;
  fps?: number;
}): WorldStoryboard {
  const { framework, totalDurationSec } = args;
  const targets = framework.productionTargets;

  // ── 預設值來源優先序：args → 場景偏好 → 平台 → masterSpec → fallback ──
  const inferredAspectRatio =
    args.aspectRatio ??
    framework.scenes.find(s => s.preferredAspectRatio)?.preferredAspectRatio ??
    inferAspectFromPlatform(targets?.platform) ??
    framework.styleProfiles?.find(
      p => p.id === framework.defaultStyleProfileId
    )?.lensSpec?.aspectRatio ??
    "16:9";
  const inferredFps =
    args.fps ?? targets?.masterSpec?.fps ?? framework.styleProfiles?.[0]?.fps ?? 24;

  const sceneCount =
    args.sceneCount ??
    Math.min(8, Math.max(3, Math.round(totalDurationSec / 30)));
  const perScene = totalDurationSec / sceneCount;
  const scenes: StoryboardScene[] = [];

  // 用 framework.scenes 作 worldSceneId 池（旋轉指派）
  const scenePool = framework.scenes.length > 0 ? framework.scenes : [];

  // ── 角色分桶：主角 always-in / 戲份高的配角 / 戲份低的配角 ──
  // 規則：role=protagonist 且 defaultPosition=main_stage（含未設定）且 ratio>=0.5
  //       的角色，每場必登場（保留與舊版測試一致：主角到所有場）。
  const isAlwaysIn = (c: WorldCharacter): boolean => {
    if (c.role !== "protagonist") return false;
    const pos = c.scriptRole?.defaultPosition ?? "main_stage";
    if (pos !== "main_stage") return false;
    const ratio = c.scriptRole?.avgScreenTimeRatio;
    if (ratio == null) return true; // 未設定 ratio 的主角預設always-in
    return ratio >= 0.5;
  };
  const alwaysInChars = framework.characters.filter(isAlwaysIn);
  const otherChars = framework.characters.filter(c => !isAlwaysIn(c));

  // 旁白角色不應出現在分鏡 frame 裡（只作為畫外音）
  const isFrameworthy = (c: WorldCharacter): boolean => {
    const pos = c.scriptRole?.defaultPosition;
    return pos !== "narrator";
  };

  for (let i = 0; i < sceneCount; i++) {
    const start = Math.round(perScene * i);
    const end = Math.round(perScene * (i + 1));
    const sceneLength = end - start;
    const beat = resolveNarrativeBeat(i, sceneCount);
    const beatLabel = BEAT_LABELS_ZH[beat];

    const worldScene =
      scenePool.length > 0 ? scenePool[i % scenePool.length] : undefined;

    // 此場 styleProfile：場景鎖定 → world 預設
    const styleProfileId =
      worldScene?.styleProfileId ?? framework.defaultStyleProfileId ?? null;

    // ── 角色出場 ──
    const characterBeats: StoryboardCharacterBeat[] = [];
    const beatCharIds: string[] = [];

    const addCharacterBeat = (
      c: WorldCharacter,
      durationFactor: number
    ): void => {
      if (!isFrameworthy(c)) return;
      const defaultOutfit =
        c.outfits?.find(o => o.isDefault) ?? c.outfits?.[0];
      const exprId = pickExpressionForBeat(c, beat);
      const signatureLine = pickSignatureLineForBeat(c, beat);
      const pose = pickPoseForBeat(c, beat);
      const dur = Math.max(1, Math.round(sceneLength * durationFactor));
      characterBeats.push({
        characterId: c.id,
        startOffsetSec: 0,
        durationSec: Math.min(sceneLength, dur),
        outfitId: defaultOutfit?.id,
        expressionId: exprId,
        pose,
        dialogue: signatureLine,
        goal: c.scriptRole?.archetype,
      });
      beatCharIds.push(c.id);
    };

    // 1) Always-in 主角必登場
    for (const c of alwaysInChars) addCharacterBeat(c, 1);

    // 2) appearsInBeats 標籤命中當前節拍的角色登場
    for (const c of otherChars) {
      if (beatCharIds.includes(c.id)) continue;
      if (characterTaggedForBeat(c, beat)) {
        const ratio = c.scriptRole?.avgScreenTimeRatio ?? 0.7;
        addCharacterBeat(c, Math.max(0.3, Math.min(1, ratio)));
      }
    }

    // 3) 配角輪替：保留舊版「25% / 50% / 75% 場插入一個配角」的行為，
    //    避免回歸測試破壞 —— 旁白角色 / 已登場者跳過
    const supportingPool = otherChars.filter(
      c => isFrameworthy(c) && !beatCharIds.includes(c.id)
    );
    if (
      supportingPool.length &&
      [1, Math.floor(sceneCount / 2), sceneCount - 2].includes(i)
    ) {
      const idx = i % supportingPool.length;
      const c = supportingPool[idx];
      const ratio = c.scriptRole?.avgScreenTimeRatio ?? 1;
      addCharacterBeat(c, Math.max(0.3, Math.min(1, ratio)));
    }

    // 同場關係：互寫 interactionTags（戀人、敵對、羈絆…）
    enrichBeatsWithInteractionTags(characterBeats, framework.characters);

    // ── 場景動作描述（彙整 environment / mood / 時段 / objects / 變化） ──
    const actionParts: string[] = [];
    if (worldScene?.environment) actionParts.push(worldScene.environment);
    if (worldScene?.mood) actionParts.push(`氛圍：${worldScene.mood}`);
    // 時段（多場景共用同一 worldScene 時自動輪替）
    const todPick = pickTimeOfDayForScene(worldScene, i);
    if (todPick) {
      const todBits: string[] = [`時段：${todPick.label}`];
      if (todPick.lighting) todBits.push(todPick.lighting);
      if (todPick.palette?.length)
        todBits.push(`色票：${todPick.palette.slice(0, 3).join("/")}`);
      actionParts.push(todBits.join("　"));
    }
    if (worldScene?.environmentChanges?.length) {
      actionParts.push(`環境變化：${worldScene.environmentChanges[0]}`);
    }
    // framework.objects 中此場可能出現的道具
    const sceneObjects = pickObjectsForScene(framework, worldScene?.id);
    if (sceneObjects.length)
      actionParts.push(`場景物件：${sceneObjects.join("、")}`);

    // ── 鏡頭指示（場景 defaultCameraMovement → cameraDirection） ──
    const cameraDirection = worldScene?.defaultCameraMovement;

    // ── frames：保留 2 個 keyframe（開頭、中段） ──
    // 若場景有 layout.heroShotAngle，把第一格設為 hero shot；
    // 角色 actingNotes.cameraPreference 也提供 fallback 構圖偏好。
    const heroShotAngle = worldScene?.layout?.heroShotAngle;
    const firstFrameShotDesc = heroShotAngle ?? undefined;
    const frames: StoryboardFrame[] = [
      {
        id: `${i}-kf1`,
        atSec: 0,
        status: "queued",
        ...(firstFrameShotDesc ? { shotDescription: firstFrameShotDesc } : {}),
      },
      {
        id: `${i}-kf2`,
        atSec: Math.round(sceneLength / 2),
        status: "queued",
      },
    ];

    // ── 音軌：music + signatureSfx + soundLibrary ambient ──
    const audioClips: StoryboardAudioClip[] = [];
    const pickedMusic = pickMusicThemeForScene(
      worldScene,
      framework.musicThemes,
      beat,
      beatCharIds
    );
    if (pickedMusic) {
      // 場長最相近的 cue variant（給混音 / 生成 prompt 參考）
      const cueVariantLabel = pickCueVariantLabelForDuration(
        pickedMusic,
        sceneLength
      );
      audioClips.push({
        id: `${i}-music`,
        kind: "music",
        startOffsetSec: 0,
        durationSec: sceneLength,
        musicThemeId: pickedMusic.id,
        volume: 0.6,
        fadeInSec: 1,
        fadeOutSec: 1,
        status: "pending",
        // 在 voiceover 用不到 sfxDescription 的情境下借此欄位攜帶 cue 變體
        // 提示（避免新增 schema 欄位破壞向後相容）。
        ...(cueVariantLabel
          ? { sfxDescription: `cue:${cueVariantLabel}` }
          : {}),
      });
    }
    // 場景定義的招牌音效
    if (worldScene?.soundDesign?.signatureSfx?.length) {
      worldScene.soundDesign.signatureSfx.slice(0, 2).forEach((sfx, sIdx) => {
        // 若 signatureSfx 已有 absolute URL，直接帶過去避免管線重新生成。
        const validAudioUrl =
          typeof sfx.url === "string" && /^https?:\/\//.test(sfx.url)
            ? sfx.url
            : undefined;
        audioClips.push({
          id: `${i}-sigsfx-${sIdx}`,
          kind: "sfx",
          startOffsetSec: Math.min(
            sceneLength - 1,
            Math.round(sceneLength * 0.15 * (sIdx + 1))
          ),
          durationSec: Math.max(1, Math.min(3, Math.round(sceneLength * 0.2))),
          sfxDescription: sfx.description ?? sfx.label,
          volume: 0.7,
          status: validAudioUrl ? "ready" : "pending",
          ...(validAudioUrl ? { audioUrl: validAudioUrl } : {}),
        });
      });
    }
    // 場景引用的世界音效庫項目 → 環境音床
    if (worldScene?.soundLibraryRefs?.length && framework.soundLibrary?.length) {
      worldScene.soundLibraryRefs.slice(0, 2).forEach((refId, sIdx) => {
        const item = framework.soundLibrary!.find(s => s.id === refId);
        if (!item) return;
        // 音效庫已是現成檔案，直接帶 URL；管線可跳過生成步驟。
        const validUrl =
          typeof item.audioUrl === "string" && /^https?:\/\//.test(item.audioUrl)
            ? item.audioUrl
            : undefined;
        audioClips.push({
          id: `${i}-amb-${sIdx}`,
          kind: "sfx",
          startOffsetSec: 0,
          durationSec: item.loopable
            ? sceneLength
            : Math.min(sceneLength, Math.max(1, item.durationSec ?? 5)),
          sfxDescription: `[ambient/${item.category ?? "sfx"}] ${item.label}${
            item.description ? `：${item.description}` : ""
          }`,
          volume: item.volumeDefault ?? 0.35,
          status: validUrl ? "ready" : "pending",
          ...(validUrl ? { audioUrl: validUrl } : {}),
        });
      });
    }

    // 對白 → voiceover：把已 seed 的招牌台詞自動展開成配音音軌
    const voClips = buildVoiceoverClipsForBeats(
      characterBeats,
      framework.characters,
      i,
      sceneLength
    );
    audioClips.push(...voClips);

    // ── 轉場：上一場 → 本場（若風格 / 場景變化才標註） ──
    let transitionOut: string | undefined;
    if (scenes.length > 0) {
      const prev = scenes[scenes.length - 1];
      const prevStyle = prev.styleProfileId ?? null;
      const prevWorldScene = prev.worldSceneId ?? null;
      const currWorldScene = worldScene?.id ?? null;
      // 場景或風格切換時，給上一場標個轉場（hard_cut / crossfade）
      if (prevWorldScene !== currWorldScene) {
        prev.transitionOut =
          prevStyle !== styleProfileId ? "crossfade" : "hard_cut";
      }
    }
    void transitionOut;

    // ── 場景標題與正史備註 ──
    const title = worldScene
      ? `${beatLabel}：${worldScene.name}`
      : beatLabel;
    const canon = pickCanonResearchForScene(
      framework.researchEntries,
      worldScene,
      beat
    );
    const notes = canon ? summarizeResearchEntryForNotes(canon) : undefined;

    scenes.push({
      id: `s${i}`,
      sequenceIndex: i,
      startSec: start,
      endSec: end,
      title,
      worldSceneId: worldScene?.id,
      characterBeats,
      actionDescription: actionParts.length ? actionParts.join("；") : undefined,
      cameraDirection,
      frames,
      audioClips,
      styleProfileId,
      musicThemeId: pickedMusic?.id ?? null,
      status: "draft",
      notes,
    });
  }

  return {
    worldId: framework.id ?? 0,
    name: `${framework.name} 分鏡草稿`,
    totalDurationSec,
    fps: inferredFps,
    aspectRatio: inferredAspectRatio,
    scenes,
    productionStatus: "planning",
  };
}

// ─── 把分鏡輸出成「分鏡表」純文字（給 LLM / 人類閱讀） ────────────────────

/**
 * 輸出可讀的分鏡表 —— 給導演 AI、編劇、客戶 review 用。
 * 格式：每場列「幾分幾秒 · 場景 · 角色 · 動作 · 對白 · 音樂」。
 */
export function summarizeStoryboardForPrompt(
  storyboard: WorldStoryboard,
  framework: WorldbuildingFrameworkData
): string {
  const lines: string[] = [];
  lines.push(
    `# 分鏡表：${storyboard.name}（總長 ${formatTimecode(
      storyboard.totalDurationSec
    )} · ${storyboard.fps}fps · ${storyboard.aspectRatio}）`
  );
  if (storyboard.narration)
    lines.push(`\n旁白：${storyboard.narration.slice(0, 200)}`);

  for (const sc of [...storyboard.scenes].sort(
    (a, b) => a.startSec - b.startSec
  )) {
    const worldScene = framework.scenes.find(s => s.id === sc.worldSceneId);
    const tc = `${formatTimecode(sc.startSec)}–${formatTimecode(sc.endSec)}`;
    lines.push(`\n## #${sc.sequenceIndex + 1} ${tc} · ${worldScene?.name ?? "—"}`);
    if (sc.title) lines.push(`  · 標題：${sc.title}`);
    if (sc.actionDescription) lines.push(`  · 動作：${sc.actionDescription}`);
    if (sc.cameraDirection) lines.push(`  · 鏡頭：${sc.cameraDirection}`);

    // 出場角色
    for (const beat of sc.characterBeats) {
      const c = framework.characters.find(ch => ch.id === beat.characterId);
      if (!c) continue;
      const beatTc = `${formatTimecode(
        sc.startSec + beat.startOffsetSec
      )}–${formatTimecode(sc.startSec + beat.startOffsetSec + beat.durationSec)}`;
      const beatParts: string[] = [`  · 角色：${c.name}（${beatTc}）`];
      if (beat.expressionId) {
        const expr = c.expressions?.find(e => e.id === beat.expressionId);
        if (expr) beatParts.push(`表情=${expr.name}`);
      }
      if (beat.outfitId) {
        const o = c.outfits?.find(x => x.id === beat.outfitId);
        if (o) beatParts.push(`穿著=${o.name}`);
      }
      if (beat.pose) beatParts.push(`姿勢=${beat.pose}`);
      lines.push(beatParts.join(" / "));
      if (beat.dialogue) lines.push(`    · 對白：「${beat.dialogue}」`);
      if (beat.innerThought) lines.push(`    · OS：${beat.innerThought}`);
    }

    // 圖楨
    if (sc.frames.length) {
      lines.push(`  · 圖楨：${sc.frames.length} 格`);
      for (const f of sc.frames) {
        const stat = f.status;
        lines.push(
          `    [${formatTimecode(sc.startSec + f.atSec)}] ${
            f.shotSize ?? "—"
          } · ${f.cameraMovement ?? "—"} · ${stat}`
        );
      }
    }

    // 音軌
    if (sc.audioClips.length) {
      for (const a of sc.audioClips) {
        if (a.kind === "music") {
          const mt = framework.musicThemes?.find(m => m.id === a.musicThemeId);
          lines.push(`  · 配樂：${mt?.name ?? "未指定"}（${a.durationSec}s）`);
        } else if (a.kind === "voiceover") {
          lines.push(
            `  · 配音：${
              framework.characters.find(c => c.id === a.characterId)?.name ?? "?"
            } —— ${(a.text ?? "").slice(0, 60)}`
          );
        } else if (a.kind === "sfx") {
          lines.push(`  · 音效：${a.sfxDescription ?? "—"}`);
        }
      }
    }

    if (sc.transitionOut) lines.push(`  · 轉場：${sc.transitionOut}`);
  }

  return lines.join("\n");
}

// ─── Aspect ratio 與時長預設 ────────────────────────────────────────────────

export const STORYBOARD_ASPECT_RATIO_PRESETS = [
  { value: "16:9", label: "16:9 橫向（電影 / YouTube）" },
  { value: "9:16", label: "9:16 直向（TikTok / Reels）" },
  { value: "1:1", label: "1:1 方形（Instagram）" },
  { value: "21:9", label: "21:9 寬銀幕" },
  { value: "4:3", label: "4:3 經典電視" },
] as const;

export const STORYBOARD_FPS_PRESETS = [12, 24, 30, 60] as const;

export const SHOT_SIZE_PRESETS = [
  "特寫（CU）",
  "大特寫（ECU）",
  "中景（MS）",
  "中近景（MCU）",
  "全景（FS）",
  "遠景（WS）",
  "極遠景（EWS）",
  "鳥瞰",
  "仰角",
  "俯角",
] as const;
