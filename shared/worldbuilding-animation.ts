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
  }

  if (styleProfile) {
    if (styleProfile.triggerWord) parts.push(styleProfile.triggerWord);
    if (styleProfile.artStyle) parts.push(styleProfile.artStyle);
    if (styleProfile.palette?.length)
      parts.push(`色票：${styleProfile.palette.join("/")}`);
    if (styleProfile.lensSpec?.aspectRatio)
      parts.push(`比例 ${styleProfile.lensSpec.aspectRatio}`);
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
    if (beat.pose) cparts.push(beat.pose);
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
  return parts.join(", ");
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
  if (theme?.key) parts.push(theme.key);
  if (theme?.promptKeywords?.length) parts.push(...theme.promptKeywords);
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

// ─── 自動播種：從角色清單推導建議的分鏡架構 ───────────────────────────────

/**
 * 從世界觀生成一個 "空白分鏡骨架"。
 * 給定總長與 scene 切法，分配出場時間（按 character.scriptRole.avgScreenTimeRatio）。
 */
export function seedStoryboardSkeleton(args: {
  framework: WorldbuildingFrameworkData;
  totalDurationSec: number;
  sceneCount?: number;
  aspectRatio?: string;
  fps?: number;
}): WorldStoryboard {
  const { framework, totalDurationSec } = args;
  const sceneCount =
    args.sceneCount ??
    Math.min(8, Math.max(3, Math.round(totalDurationSec / 30)));
  const perScene = totalDurationSec / sceneCount;
  const scenes: StoryboardScene[] = [];

  // 用 framework.scenes 作 worldSceneId 池
  const scenePool = framework.scenes.length > 0 ? framework.scenes : [];
  // 主角優先安排在所有場
  const mainChars = framework.characters
    .filter(c => c.role === "protagonist")
    .map(c => c.id);
  const otherChars = framework.characters
    .filter(c => c.role !== "protagonist")
    .map(c => c.id);

  for (let i = 0; i < sceneCount; i++) {
    const start = Math.round(perScene * i);
    const end = Math.round(perScene * (i + 1));
    const worldSceneId = scenePool[i % Math.max(1, scenePool.length)]?.id;
    const sceneLength = end - start;

    const characterBeats: StoryboardCharacterBeat[] = [];
    for (const cid of mainChars) {
      characterBeats.push({
        characterId: cid,
        startOffsetSec: 0,
        durationSec: sceneLength,
      });
    }
    // 在 25% / 50% / 75% 場次插入一個配角
    if (otherChars.length && [1, Math.floor(sceneCount / 2), sceneCount - 2].includes(i)) {
      const idx = i % otherChars.length;
      characterBeats.push({
        characterId: otherChars[idx],
        startOffsetSec: 0,
        durationSec: sceneLength,
      });
    }

    // 每場默認 2 個 keyframe（開頭、中段）
    const frames: StoryboardFrame[] = [
      {
        id: `${i}-kf1`,
        atSec: 0,
        status: "queued",
      },
      {
        id: `${i}-kf2`,
        atSec: Math.round(sceneLength / 2),
        status: "queued",
      },
    ];

    // 默認音軌：整場一個 music
    const sceneObj = scenePool[i % Math.max(1, scenePool.length)];
    const musicThemeId =
      sceneObj?.musicThemeId ?? framework.musicThemes?.[0]?.id ?? undefined;
    const audioClips: StoryboardAudioClip[] = musicThemeId
      ? [
          {
            id: `${i}-music`,
            kind: "music",
            startOffsetSec: 0,
            durationSec: sceneLength,
            musicThemeId,
            volume: 0.6,
            fadeInSec: 1,
            fadeOutSec: 1,
            status: "pending",
          },
        ]
      : [];

    scenes.push({
      id: `s${i}`,
      sequenceIndex: i,
      startSec: start,
      endSec: end,
      worldSceneId,
      characterBeats,
      frames,
      audioClips,
      status: "draft",
    });
  }

  return {
    worldId: framework.id ?? 0,
    name: `${framework.name} 分鏡草稿`,
    totalDurationSec,
    fps: args.fps ?? 24,
    aspectRatio: args.aspectRatio ?? "16:9",
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
