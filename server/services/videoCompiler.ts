/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Video Compiler — 影片編譯器
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 遵守【相機運動 + 主體 + 具體動作 + 環境光影】公式，
 * 將抽象情感翻譯為具體物理表現，綁定穩定運鏡約束，
 * 並提供首尾幀錨定邏輯接口。
 *
 * 核心演算法：
 * 1. Emotion-to-Action Translator — 抽象情感 → 具體 Action Verbs
 * 2. Camera Vector Binder — 穩定光學運鏡約束，阻擋視角跳躍
 * 3. Frame Anchoring — 首尾幀錨定邏輯，確保鏡頭連續性
 */

import {
  validateCompilerInput,
  VideoCompilerInputSchema,
} from "./compilerValidation";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoBlock {
  id: string;
  category: "subject" | "action" | "environment" | "camera" | "mood" | "style";
  label: string;
  prompt: string;
}

export interface VideoCompilerInput {
  /** 使用者選擇的積木 */
  blocks: VideoBlock[];
  /** 自由文字提示詞 */
  freePrompt?: string;
  /** 情緒關鍵字（來自 Vibe Cards） */
  moodKeywords?: string[];
  /** 目標時長（秒），預設 5 */
  targetDurationSec?: number;
  /** 強制相機運動模式 */
  forceCameraMode?: CameraModeId;
  /** 首幀錨定圖片 URL */
  firstFrameUrl?: string;
  /** 尾幀錨定圖片 URL */
  lastFrameUrl?: string;
  /** 首幀描述（文字錨定） */
  firstFrameDesc?: string;
  /** 尾幀描述（文字錨定） */
  lastFrameDesc?: string;
  /** 寬高比 */
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:3";
  /** 是否啟用慢動作 */
  slowMotion?: boolean;
  /** 風格覆寫（如 cinematic, anime, documentary） */
  styleOverride?: string;
}

// ─── 相機運動模式 ─────────────────────────────────────────

export type CameraModeId =
  | "static"
  | "dolly_in"
  | "dolly_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "orbit"
  | "crane_up"
  | "crane_down"
  | "tracking"
  | "handheld"
  | "aerial_descent"
  | "aerial_ascent"
  | "push_in"
  | "pull_out";

export interface CameraVector {
  id: CameraModeId;
  label: string;
  labelZh: string;
  /** 提示詞片段 */
  promptFragment: string;
  /** 穩定性等級 1-5（5 最穩定） */
  stabilityScore: number;
  /** 允許的後續運鏡（防止視角跳躍） */
  allowedTransitions: CameraModeId[];
  /** 建議搭配的情緒 */
  suggestedMoods: string[];
  /** 速度修飾詞 */
  speedModifier: "slow" | "medium" | "fast";
}

// ─── 情感→動作映射 ─────────────────────────────────────────

export interface EmotionActionMap {
  emotion: string;
  /** 具體物理動作動詞 */
  actionVerbs: string[];
  /** 主體行為描述 */
  subjectBehaviors: string[];
  /** 環境光影描述 */
  environmentalCues: string[];
  /** 建議相機模式 */
  suggestedCamera: CameraModeId[];
}

// ─── 首尾幀錨定 ─────────────────────────────────────────────

export interface FrameAnchor {
  type: "first" | "last";
  /** 圖片 URL（若有） */
  imageUrl?: string;
  /** 文字描述 */
  description: string;
  /** 相機位置描述 */
  cameraPosition: string;
  /** 光影狀態 */
  lightingState: string;
}

// ─── 編譯結果 ─────────────────────────────────────────────

export interface VideoShot {
  /** 鏡頭編號 */
  shotNumber: number;
  /** 相機運動 */
  cameraMotion: string;
  /** 主體描述 */
  subject: string;
  /** 具體動作 */
  action: string;
  /** 環境光影 */
  environment: string;
  /** 完整提示詞 */
  prompt: string;
  /** 預估時長（秒） */
  durationSec: number;
  /** 幀錨定資訊 */
  frameAnchor?: FrameAnchor;
}

export interface VideoCompileResult {
  /** 最終編譯的完整提示詞 */
  prompt: string;
  /** 分鏡列表 */
  shots: VideoShot[];
  /** 鏡頭數量 */
  shotCount: number;
  /** 預估總時長（秒） */
  estimatedDurationSec: number;
  /** 使用的相機模式 */
  cameraMode: CameraModeId;
  /** 相機穩定性分數 */
  cameraStabilityScore: number;
  /** 首幀錨定 */
  firstFrameAnchor?: FrameAnchor;
  /** 尾幀錨定 */
  lastFrameAnchor?: FrameAnchor;
  /** 情感翻譯日誌 */
  emotionTranslations: Array<{ from: string; to: string[] }>;
  /** 視角跳躍被阻擋的次數 */
  jumpBlockCount: number;
  /** 風格標籤 */
  styleTag: string;
  /** 寬高比 */
  aspectRatio: string;
  /** 編譯日誌 */
  compilationLog: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// 情感→物理動作 大規模翻譯表
// ═══════════════════════════════════════════════════════════════════════════

const EMOTION_ACTION_MAP: EmotionActionMap[] = [
  {
    emotion: "sadness",
    actionVerbs: ["drooping", "wilting", "sinking", "dissolving", "fading"],
    subjectBehaviors: [
      "a lone figure standing still with shoulders slumped",
      "rain droplets sliding slowly down a window pane",
      "autumn leaves detaching and drifting downward",
      "a candle flame flickering and dimming",
      "ripples fading on a still pond surface",
    ],
    environmentalCues: [
      "overcast sky with diffused grey light",
      "soft blue-grey ambient lighting, no harsh shadows",
      "muted desaturated color palette",
      "gentle fog rolling across the ground",
    ],
    suggestedCamera: ["dolly_out", "crane_down", "static", "tilt_down"],
  },
  {
    emotion: "joy",
    actionVerbs: ["blooming", "rising", "sparkling", "dancing", "radiating"],
    subjectBehaviors: [
      "sunflowers turning toward golden sunlight",
      "cherry blossom petals swirling upward in a breeze",
      "light particles floating and glowing warmly",
      "a child spinning with arms outstretched",
      "water droplets catching prismatic light",
    ],
    environmentalCues: [
      "warm golden hour sunlight streaming through",
      "bright saturated colors with soft lens flare",
      "dappled light filtering through leaves",
      "clear sky with wispy cirrus clouds",
    ],
    suggestedCamera: ["dolly_in", "crane_up", "orbit", "tracking"],
  },
  {
    emotion: "serenity",
    actionVerbs: ["floating", "drifting", "breathing", "settling", "glowing"],
    subjectBehaviors: [
      "mist gently rising from a calm lake at dawn",
      "a feather slowly descending through still air",
      "soft fabric billowing in a gentle breeze",
      "moonlight reflecting on undisturbed water",
      "incense smoke curling upward in a quiet room",
    ],
    environmentalCues: [
      "soft diffused natural light, pastel tones",
      "twilight blue-purple gradient sky",
      "warm candlelight in a dim interior",
      "underwater caustic light patterns",
    ],
    suggestedCamera: ["static", "dolly_in", "pan_left", "aerial_descent"],
  },
  {
    emotion: "nostalgia",
    actionVerbs: ["fading", "rewinding", "flickering", "echoing", "weathering"],
    subjectBehaviors: [
      "old photographs slowly curling at the edges",
      "dust particles floating in a beam of afternoon light",
      "a music box lid opening with a gentle click",
      "film grain overlay with warm color shift",
      "handwritten letters scattered on a wooden desk",
    ],
    environmentalCues: [
      "warm amber tungsten lighting",
      "soft vignette with desaturated warm tones",
      "late afternoon sun casting long shadows",
      "hazy atmosphere with visible light rays",
    ],
    suggestedCamera: ["dolly_out", "pan_right", "static", "push_in"],
  },
  {
    emotion: "wonder",
    actionVerbs: [
      "expanding",
      "revealing",
      "illuminating",
      "unfolding",
      "transforming",
    ],
    subjectBehaviors: [
      "a vast starfield slowly rotating",
      "bioluminescent organisms pulsing in dark water",
      "aurora borealis ribbons undulating across the sky",
      "a crystal refracting light into rainbow spectra",
      "time-lapse of a flower blooming in accelerated motion",
    ],
    environmentalCues: [
      "dramatic volumetric lighting with god rays",
      "deep space darkness with pinpoint starlight",
      "ethereal glow emanating from an unknown source",
      "iridescent color shifts on reflective surfaces",
    ],
    suggestedCamera: ["crane_up", "aerial_ascent", "dolly_in", "orbit"],
  },
  {
    emotion: "melancholy",
    actionVerbs: ["lingering", "receding", "dimming", "eroding", "whispering"],
    subjectBehaviors: [
      "an empty swing gently rocking in the wind",
      "tide slowly retreating from a sandy shore",
      "a clock pendulum swinging in an empty room",
      "frost patterns forming on a cold window",
      "a single leaf spinning in a puddle",
    ],
    environmentalCues: [
      "cool blue-toned overcast lighting",
      "rain-washed streets reflecting neon",
      "early morning mist in a forest clearing",
      "dim interior with a single window light source",
    ],
    suggestedCamera: ["pan_left", "dolly_out", "static", "tilt_down"],
  },
  {
    emotion: "hope",
    actionVerbs: [
      "emerging",
      "brightening",
      "sprouting",
      "ascending",
      "warming",
    ],
    subjectBehaviors: [
      "first rays of sunrise breaking over a horizon",
      "a seedling pushing through cracked earth",
      "clouds parting to reveal blue sky",
      "a lighthouse beam cutting through fog",
      "ice melting to reveal flowing water beneath",
    ],
    environmentalCues: [
      "transitional lighting from dark to warm golden",
      "rim lighting creating a halo effect",
      "gradient sky from deep blue to warm orange",
      "volumetric light shafts through clouds",
    ],
    suggestedCamera: ["crane_up", "dolly_in", "tilt_up", "aerial_ascent"],
  },
  {
    emotion: "mystery",
    actionVerbs: ["concealing", "shifting", "morphing", "lurking", "pulsing"],
    subjectBehaviors: [
      "shadows moving independently of their source",
      "fog revealing and concealing shapes",
      "a door slowly creaking open to darkness",
      "reflections in water showing different scenes",
      "particles assembling into recognizable forms",
    ],
    environmentalCues: [
      "low-key lighting with deep shadows",
      "single directional light source creating contrast",
      "moonlit scene with silver-blue tones",
      "underwater darkness with distant glow",
    ],
    suggestedCamera: ["push_in", "dolly_in", "pan_left", "handheld"],
  },
  {
    emotion: "energy",
    actionVerbs: [
      "exploding",
      "surging",
      "pulsating",
      "accelerating",
      "igniting",
    ],
    subjectBehaviors: [
      "lightning bolts branching across a dark sky",
      "waves crashing against rocks with spray",
      "sparks flying from a grinding wheel",
      "a flock of birds bursting into flight",
      "paint splashing in slow motion",
    ],
    environmentalCues: [
      "high contrast dramatic lighting",
      "strobe-like flashes of intense light",
      "vivid saturated neon colors",
      "dynamic cloud formations with dramatic sky",
    ],
    suggestedCamera: ["tracking", "handheld", "dolly_in", "orbit"],
  },
  {
    emotion: "tranquility",
    actionVerbs: ["resting", "flowing", "humming", "nesting", "balancing"],
    subjectBehaviors: [
      "a zen garden with raked sand patterns",
      "koi fish gliding through clear water",
      "bamboo swaying rhythmically in gentle wind",
      "tea being poured in a slow steady stream",
      "a cat curled up in a patch of sunlight",
    ],
    environmentalCues: [
      "even soft natural daylight",
      "warm interior with paper lantern glow",
      "garden setting with filtered green light",
      "minimalist space with clean shadows",
    ],
    suggestedCamera: ["static", "dolly_in", "pan_right", "aerial_descent"],
  },
  {
    emotion: "awe",
    actionVerbs: [
      "towering",
      "encompassing",
      "overwhelming",
      "stretching",
      "resonating",
    ],
    subjectBehaviors: [
      "camera revealing a vast mountain landscape",
      "a massive whale breaching the ocean surface",
      "ancient cathedral interior with soaring arches",
      "a total solar eclipse with corona visible",
      "a thunderstorm viewed from above the clouds",
    ],
    environmentalCues: [
      "epic scale lighting with atmospheric perspective",
      "dramatic chiaroscuro with celestial light",
      "vast depth of field showing infinite distance",
      "golden hour light on monumental structures",
    ],
    suggestedCamera: ["crane_up", "aerial_ascent", "dolly_out", "tilt_up"],
  },
  {
    emotion: "intimacy",
    actionVerbs: [
      "touching",
      "embracing",
      "whispering",
      "connecting",
      "sheltering",
    ],
    subjectBehaviors: [
      "two hands slowly reaching toward each other",
      "a close-up of eyes reflecting warm light",
      "steam rising from two cups placed close together",
      "intertwined branches of neighboring trees",
      "a blanket being gently draped over shoulders",
    ],
    environmentalCues: [
      "warm close-range lighting, shallow depth of field",
      "candlelit interior with bokeh background",
      "soft backlight creating rim glow on subjects",
      "intimate space with warm color temperature",
    ],
    suggestedCamera: ["push_in", "dolly_in", "static", "tracking"],
  },
  {
    emotion: "freedom",
    actionVerbs: ["soaring", "breaking", "releasing", "spreading", "leaping"],
    subjectBehaviors: [
      "a bird taking flight from an open cage",
      "dandelion seeds dispersing in the wind",
      "a silk scarf unfurling in open air",
      "waves of grass rippling across an open field",
      "a paper airplane gliding through open sky",
    ],
    environmentalCues: [
      "wide open sky with expansive horizon",
      "bright natural light with no enclosure",
      "high altitude perspective with vast landscape",
      "wind-swept environment with dynamic elements",
    ],
    suggestedCamera: ["aerial_ascent", "crane_up", "tracking", "orbit"],
  },
  {
    emotion: "loneliness",
    actionVerbs: ["isolating", "echoing", "shrinking", "wandering", "waiting"],
    subjectBehaviors: [
      "a single figure walking on an empty beach",
      "an empty chair at a table set for two",
      "footprints in snow leading to nowhere",
      "a phone screen glowing in a dark room",
      "a boat drifting alone on open water",
    ],
    environmentalCues: [
      "cold blue-white lighting with empty space",
      "vast negative space surrounding small subject",
      "harsh overhead light creating isolated pool",
      "twilight emptiness with distant city lights",
    ],
    suggestedCamera: ["dolly_out", "crane_up", "static", "aerial_ascent"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 相機運動向量庫
// ═══════════════════════════════════════════════════════════════════════════

const CAMERA_VECTORS: Record<CameraModeId, CameraVector> = {
  static: {
    id: "static",
    label: "Static",
    labelZh: "靜止",
    promptFragment: "static camera, locked-off shot, no camera movement",
    stabilityScore: 5,
    allowedTransitions: [
      "dolly_in",
      "dolly_out",
      "pan_left",
      "pan_right",
      "tilt_up",
      "tilt_down",
      "push_in",
    ],
    suggestedMoods: [
      "serenity",
      "tranquility",
      "sadness",
      "melancholy",
      "loneliness",
    ],
    speedModifier: "slow",
  },
  dolly_in: {
    id: "dolly_in",
    label: "Dolly In",
    labelZh: "推進",
    promptFragment:
      "smooth dolly in, camera slowly moving forward toward subject",
    stabilityScore: 4,
    allowedTransitions: ["static", "dolly_out", "orbit", "push_in"],
    suggestedMoods: ["wonder", "intimacy", "hope", "mystery"],
    speedModifier: "slow",
  },
  dolly_out: {
    id: "dolly_out",
    label: "Dolly Out",
    labelZh: "拉遠",
    promptFragment: "smooth dolly out, camera slowly pulling back from subject",
    stabilityScore: 4,
    allowedTransitions: ["static", "dolly_in", "crane_up", "aerial_ascent"],
    suggestedMoods: ["sadness", "nostalgia", "loneliness", "awe"],
    speedModifier: "slow",
  },
  pan_left: {
    id: "pan_left",
    label: "Pan Left",
    labelZh: "左搖",
    promptFragment: "smooth horizontal pan to the left, steady camera rotation",
    stabilityScore: 4,
    allowedTransitions: ["static", "pan_right", "dolly_in", "tracking"],
    suggestedMoods: ["serenity", "melancholy", "mystery", "nostalgia"],
    speedModifier: "medium",
  },
  pan_right: {
    id: "pan_right",
    label: "Pan Right",
    labelZh: "右搖",
    promptFragment:
      "smooth horizontal pan to the right, steady camera rotation",
    stabilityScore: 4,
    allowedTransitions: ["static", "pan_left", "dolly_in", "tracking"],
    suggestedMoods: ["tranquility", "nostalgia", "wonder"],
    speedModifier: "medium",
  },
  tilt_up: {
    id: "tilt_up",
    label: "Tilt Up",
    labelZh: "上仰",
    promptFragment: "smooth vertical tilt upward, camera angle rising",
    stabilityScore: 4,
    allowedTransitions: ["static", "tilt_down", "crane_up", "aerial_ascent"],
    suggestedMoods: ["hope", "wonder", "awe", "freedom"],
    speedModifier: "slow",
  },
  tilt_down: {
    id: "tilt_down",
    label: "Tilt Down",
    labelZh: "下俯",
    promptFragment: "smooth vertical tilt downward, camera angle descending",
    stabilityScore: 4,
    allowedTransitions: ["static", "tilt_up", "crane_down", "push_in"],
    suggestedMoods: ["sadness", "melancholy", "intimacy"],
    speedModifier: "slow",
  },
  orbit: {
    id: "orbit",
    label: "Orbit",
    labelZh: "環繞",
    promptFragment:
      "smooth orbital camera movement circling around the subject",
    stabilityScore: 3,
    allowedTransitions: ["static", "dolly_in", "dolly_out", "crane_up"],
    suggestedMoods: ["wonder", "joy", "energy", "awe"],
    speedModifier: "medium",
  },
  crane_up: {
    id: "crane_up",
    label: "Crane Up",
    labelZh: "升起",
    promptFragment:
      "smooth crane shot rising vertically, revealing wider scene",
    stabilityScore: 3,
    allowedTransitions: ["static", "crane_down", "dolly_out", "aerial_ascent"],
    suggestedMoods: ["hope", "wonder", "awe", "freedom"],
    speedModifier: "slow",
  },
  crane_down: {
    id: "crane_down",
    label: "Crane Down",
    labelZh: "降落",
    promptFragment:
      "smooth crane shot descending vertically, closing in on scene",
    stabilityScore: 3,
    allowedTransitions: ["static", "crane_up", "dolly_in", "push_in"],
    suggestedMoods: ["sadness", "intimacy", "tranquility"],
    speedModifier: "slow",
  },
  tracking: {
    id: "tracking",
    label: "Tracking",
    labelZh: "跟蹤",
    promptFragment: "smooth tracking shot following the subject's movement",
    stabilityScore: 3,
    allowedTransitions: [
      "static",
      "dolly_in",
      "dolly_out",
      "pan_left",
      "pan_right",
    ],
    suggestedMoods: ["energy", "joy", "freedom", "wonder"],
    speedModifier: "medium",
  },
  handheld: {
    id: "handheld",
    label: "Handheld",
    labelZh: "手持",
    promptFragment: "subtle handheld camera movement, organic slight shake",
    stabilityScore: 2,
    allowedTransitions: ["static", "tracking", "push_in"],
    suggestedMoods: ["energy", "mystery", "intimacy"],
    speedModifier: "medium",
  },
  aerial_descent: {
    id: "aerial_descent",
    label: "Aerial Descent",
    labelZh: "空中下降",
    promptFragment:
      "aerial camera slowly descending from above, bird's eye to eye level",
    stabilityScore: 3,
    allowedTransitions: ["static", "aerial_ascent", "dolly_in", "tracking"],
    suggestedMoods: ["serenity", "tranquility", "wonder"],
    speedModifier: "slow",
  },
  aerial_ascent: {
    id: "aerial_ascent",
    label: "Aerial Ascent",
    labelZh: "空中上升",
    promptFragment: "aerial camera rising from ground level to bird's eye view",
    stabilityScore: 3,
    allowedTransitions: ["static", "aerial_descent", "dolly_out", "orbit"],
    suggestedMoods: ["freedom", "awe", "hope", "wonder"],
    speedModifier: "slow",
  },
  push_in: {
    id: "push_in",
    label: "Push In",
    labelZh: "逼近",
    promptFragment: "dramatic push in toward subject, intensifying focus",
    stabilityScore: 3,
    allowedTransitions: ["static", "pull_out", "dolly_out"],
    suggestedMoods: ["mystery", "intimacy", "energy", "wonder"],
    speedModifier: "medium",
  },
  pull_out: {
    id: "pull_out",
    label: "Pull Out",
    labelZh: "退離",
    promptFragment:
      "dramatic pull out from subject, revealing surrounding context",
    stabilityScore: 3,
    allowedTransitions: ["static", "push_in", "dolly_in", "crane_up"],
    suggestedMoods: ["loneliness", "awe", "nostalgia", "sadness"],
    speedModifier: "medium",
  },
};

// ─── Vibe → Emotion 映射 ────────────────────────────────────

const VIBE_TO_EMOTION: Record<string, string> = {
  dreamy: "serenity",
  warm: "joy",
  ethereal: "wonder",
  vintage: "nostalgia",
  minimal: "tranquility",
  cosmic: "awe",
  nature: "serenity",
  urban: "energy",
  abstract: "mystery",
  romantic: "intimacy",
  dark: "melancholy",
  playful: "joy",
  mystical: "mystery",
  serene: "serenity",
  energetic: "energy",
  melancholic: "melancholy",
  hopeful: "hope",
  lonely: "loneliness",
  free: "freedom",
};

// ─── 情緒推斷 ────────────────────────────────────────────────

const EMOTION_KEYWORDS: Record<string, string[]> = {
  sadness: [
    "sad",
    "sorrow",
    "grief",
    "tears",
    "crying",
    "loss",
    "悲傷",
    "哀愁",
    "淚",
  ],
  joy: [
    "happy",
    "joy",
    "cheerful",
    "delight",
    "celebrate",
    "快樂",
    "歡喜",
    "喜悅",
  ],
  serenity: [
    "calm",
    "peaceful",
    "serene",
    "quiet",
    "still",
    "平靜",
    "寧靜",
    "安詳",
  ],
  nostalgia: [
    "memory",
    "past",
    "remember",
    "old",
    "vintage",
    "回憶",
    "懷舊",
    "往事",
  ],
  wonder: ["amazing", "wonder", "magical", "fantastic", "奇幻", "驚奇", "魔幻"],
  melancholy: [
    "melancholy",
    "bittersweet",
    "wistful",
    "longing",
    "惆悵",
    "感傷",
  ],
  hope: ["hope", "dawn", "new", "begin", "future", "希望", "曙光", "未來"],
  mystery: ["mystery", "secret", "hidden", "unknown", "dark", "神秘", "未知"],
  energy: [
    "energy",
    "power",
    "dynamic",
    "intense",
    "vibrant",
    "活力",
    "能量",
    "動感",
  ],
  tranquility: ["zen", "meditation", "peace", "harmony", "禪", "冥想", "和諧"],
  awe: ["epic", "grand", "majestic", "vast", "壯觀", "宏偉", "浩瀚"],
  intimacy: ["close", "intimate", "tender", "gentle", "親密", "溫柔", "細膩"],
  freedom: ["free", "fly", "soar", "open", "wild", "自由", "飛翔", "遼闊"],
  loneliness: [
    "alone",
    "lonely",
    "solitary",
    "isolated",
    "孤獨",
    "寂寞",
    "獨處",
  ],
};

function inferEmotion(text: string): string {
  const lower = text.toLowerCase();
  let bestMatch = "serenity";
  let bestScore = 0;

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = emotion;
    }
  }

  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════════════
// VideoCompiler 主類
// ═══════════════════════════════════════════════════════════════════════════

export class VideoCompiler {
  private maxCameraTransitions: number;

  constructor(maxCameraTransitions = 3) {
    this.maxCameraTransitions = maxCameraTransitions;
  }

  // ─── 1. 情感→物理動作翻譯 ────────────────────────────────

  translateEmotion(emotion: string): EmotionActionMap {
    const found = EMOTION_ACTION_MAP.find(
      e => e.emotion === emotion.toLowerCase()
    );
    if (found) return found;

    // 模糊匹配：包含匹配 + 共同前綴匹配（≥5 字元）
    const lower = emotion.toLowerCase();
    for (const entry of EMOTION_ACTION_MAP) {
      if (lower.includes(entry.emotion) || entry.emotion.includes(lower)) {
        return entry;
      }
    }
    // 共同前綴匹配（如 melancholic → melancholy）
    let bestMatch: EmotionActionMap | null = null;
    let bestLen = 0;
    for (const entry of EMOTION_ACTION_MAP) {
      let prefixLen = 0;
      const minLen = Math.min(lower.length, entry.emotion.length);
      for (let i = 0; i < minLen; i++) {
        if (lower[i] === entry.emotion[i]) prefixLen++;
        else break;
      }
      if (prefixLen >= 5 && prefixLen > bestLen) {
        bestLen = prefixLen;
        bestMatch = entry;
      }
    }
    if (bestMatch) return bestMatch;

    // 預設回退 serenity
    return (
      EMOTION_ACTION_MAP.find(e => e.emotion === "serenity") ||
      EMOTION_ACTION_MAP[0]
    );
  }

  /**
   * 批量翻譯：將多個抽象情感翻譯為具體 Action Verbs
   */
  translateEmotions(emotions: string[]): Array<{ from: string; to: string[] }> {
    return emotions.map(em => {
      const map = this.translateEmotion(em);
      return {
        from: em,
        to: [
          ...map.actionVerbs.slice(0, 3),
          ...map.subjectBehaviors.slice(0, 2),
        ],
      };
    });
  }

  // ─── 2. 相機運鏡約束 ────────────────────────────────────

  /**
   * 取得相機向量定義
   */
  getCameraVector(mode: CameraModeId): CameraVector {
    return CAMERA_VECTORS[mode] || CAMERA_VECTORS.static;
  }

  /**
   * 驗證相機轉場是否合法（阻擋視角跳躍）
   */
  validateCameraTransition(
    from: CameraModeId,
    to: CameraModeId
  ): { valid: boolean; reason?: string } {
    const fromVector = CAMERA_VECTORS[from];
    if (!fromVector) {
      return { valid: false, reason: `未知的相機模式: ${from}` };
    }

    if (fromVector.allowedTransitions.includes(to)) {
      return { valid: true };
    }

    return {
      valid: false,
      reason: `視角跳躍阻擋: ${fromVector.labelZh}(${from}) → ${CAMERA_VECTORS[to]?.labelZh || to} 不在允許的轉場列表中`,
    };
  }

  /**
   * 規劃安全的相機運動序列（阻擋視角跳躍）
   */
  planCameraSequence(
    startMode: CameraModeId,
    desiredModes: CameraModeId[]
  ): {
    sequence: CameraModeId[];
    blocked: Array<{ from: CameraModeId; to: CameraModeId; reason: string }>;
  } {
    const sequence: CameraModeId[] = [startMode];
    const blocked: Array<{
      from: CameraModeId;
      to: CameraModeId;
      reason: string;
    }> = [];
    let current = startMode;

    for (const desired of desiredModes.slice(0, this.maxCameraTransitions)) {
      const validation = this.validateCameraTransition(current, desired);
      if (validation.valid) {
        sequence.push(desired);
        current = desired;
      } else {
        blocked.push({
          from: current,
          to: desired,
          reason: validation.reason || "",
        });
        // 嘗試找到一個中間轉場
        const bridge = this.findBridgeTransition(current, desired);
        if (bridge) {
          sequence.push(bridge, desired);
          current = desired;
        } else {
          // 無法轉場，保持當前模式
          sequence.push(current);
        }
      }
    }

    return { sequence, blocked };
  }

  /**
   * 尋找橋接轉場（A → ? → B）
   */
  private findBridgeTransition(
    from: CameraModeId,
    to: CameraModeId
  ): CameraModeId | null {
    const fromVector = CAMERA_VECTORS[from];
    if (!fromVector) return null;

    for (const mid of fromVector.allowedTransitions) {
      const midVector = CAMERA_VECTORS[mid];
      if (midVector && midVector.allowedTransitions.includes(to)) {
        return mid;
      }
    }

    return null;
  }

  /**
   * 根據情緒推薦最佳相機模式
   */
  suggestCameraMode(emotion: string): CameraModeId {
    const map = this.translateEmotion(emotion);
    return map.suggestedCamera[0] || "static";
  }

  /**
   * 取得所有可用的相機模式
   */
  getAvailableCameraModes(): Array<{
    id: CameraModeId;
    label: string;
    labelZh: string;
    stabilityScore: number;
  }> {
    return Object.values(CAMERA_VECTORS).map(v => ({
      id: v.id,
      label: v.label,
      labelZh: v.labelZh,
      stabilityScore: v.stabilityScore,
    }));
  }

  // ─── 3. 首尾幀錨定 ──────────────────────────────────────

  /**
   * 建立首幀錨定
   */
  buildFirstFrameAnchor(
    input: VideoCompilerInput,
    emotion: string
  ): FrameAnchor {
    const map = this.translateEmotion(emotion);
    const camera = this.getCameraVector(
      input.forceCameraMode || this.suggestCameraMode(emotion)
    );

    if (input.firstFrameUrl) {
      return {
        type: "first",
        imageUrl: input.firstFrameUrl,
        description:
          input.firstFrameDesc || `Opening frame anchored to reference image`,
        cameraPosition: `${camera.promptFragment}, starting position`,
        lightingState: map.environmentalCues[0] || "natural ambient lighting",
      };
    }

    const desc =
      input.firstFrameDesc ||
      map.subjectBehaviors[0] ||
      "establishing shot of the scene";
    return {
      type: "first",
      description: desc,
      cameraPosition: `${camera.promptFragment}, initial framing`,
      lightingState: map.environmentalCues[0] || "natural ambient lighting",
    };
  }

  /**
   * 建立尾幀錨定
   */
  buildLastFrameAnchor(
    input: VideoCompilerInput,
    emotion: string
  ): FrameAnchor {
    const map = this.translateEmotion(emotion);
    const camera = this.getCameraVector(
      input.forceCameraMode || this.suggestCameraMode(emotion)
    );

    // 尾幀傾向使用反向或靜止運鏡
    const endCameraMode = this.getEndingCameraMode(camera.id);
    const endCamera = this.getCameraVector(endCameraMode);

    if (input.lastFrameUrl) {
      return {
        type: "last",
        imageUrl: input.lastFrameUrl,
        description:
          input.lastFrameDesc || `Closing frame anchored to reference image`,
        cameraPosition: `${endCamera.promptFragment}, final position`,
        lightingState:
          map.environmentalCues[map.environmentalCues.length - 1] ||
          "fading ambient light",
      };
    }

    const desc =
      input.lastFrameDesc ||
      map.subjectBehaviors[map.subjectBehaviors.length - 1] ||
      "closing shot of the scene";
    return {
      type: "last",
      description: desc,
      cameraPosition: `${endCamera.promptFragment}, final resting position`,
      lightingState:
        map.environmentalCues[map.environmentalCues.length - 1] ||
        "fading ambient light",
    };
  }

  /**
   * 根據開場運鏡推導結尾運鏡（確保連續性）
   */
  private getEndingCameraMode(startMode: CameraModeId): CameraModeId {
    const endings: Partial<Record<CameraModeId, CameraModeId>> = {
      dolly_in: "static",
      dolly_out: "static",
      crane_up: "static",
      crane_down: "static",
      aerial_ascent: "static",
      aerial_descent: "static",
      push_in: "pull_out",
      pull_out: "static",
      orbit: "static",
      tracking: "dolly_out",
      handheld: "static",
      pan_left: "static",
      pan_right: "static",
      tilt_up: "static",
      tilt_down: "static",
    };
    return endings[startMode] || "static";
  }

  // ─── 4. 主編譯管線 ──────────────────────────────────────

  compile(input: VideoCompilerInput): VideoCompileResult {
    validateCompilerInput("video", input, VideoCompilerInputSchema);
    const log: string[] = [];
    log.push(`[VideoCompiler] 開始編譯 | 積木數: ${input.blocks.length}`);

    // Step 1: 解析情緒
    const emotion = this.resolveEmotion(input);
    log.push(`[VideoCompiler] 情緒解析: ${emotion}`);

    // Step 2: 情感→動作翻譯
    const emotionMap = this.translateEmotion(emotion);
    const emotionTranslations = this.translateEmotions([emotion]);
    log.push(
      `[VideoCompiler] 動作翻譯: ${emotionMap.actionVerbs.slice(0, 3).join(", ")}`
    );

    // Step 3: 解析相機模式
    const cameraMode = input.forceCameraMode || this.suggestCameraMode(emotion);
    const cameraVector = this.getCameraVector(cameraMode);
    log.push(
      `[VideoCompiler] 相機模式: ${cameraVector.labelZh} (${cameraMode}) | 穩定性: ${cameraVector.stabilityScore}/5`
    );

    // Step 4: 解析積木元素
    const { subject, action, environment, style } = this.parseBlocks(
      input,
      emotionMap
    );
    log.push(`[VideoCompiler] 主體: ${subject}`);
    log.push(`[VideoCompiler] 動作: ${action}`);
    log.push(`[VideoCompiler] 環境: ${environment}`);

    // Step 5: 建立首尾幀錨定
    const firstFrameAnchor = this.buildFirstFrameAnchor(input, emotion);
    const lastFrameAnchor = this.buildLastFrameAnchor(input, emotion);
    log.push(
      `[VideoCompiler] 首幀錨定: ${firstFrameAnchor.description.slice(0, 50)}...`
    );
    log.push(
      `[VideoCompiler] 尾幀錨定: ${lastFrameAnchor.description.slice(0, 50)}...`
    );

    // Step 6: 組裝分鏡
    const shots = this.buildShots(
      input,
      emotionMap,
      cameraVector,
      subject,
      action,
      environment,
      style,
      firstFrameAnchor,
      lastFrameAnchor
    );
    let jumpBlockCount = 0;

    // Step 7: 驗證鏡頭序列連續性
    for (let i = 1; i < shots.length; i++) {
      const prevCamera = this.extractCameraMode(shots[i - 1].cameraMotion);
      const currCamera = this.extractCameraMode(shots[i].cameraMotion);
      if (prevCamera && currCamera) {
        const validation = this.validateCameraTransition(
          prevCamera,
          currCamera
        );
        if (!validation.valid) {
          jumpBlockCount++;
          log.push(
            `[VideoCompiler] ⚠️ 視角跳躍阻擋 Shot ${i}: ${validation.reason}`
          );
          // 修正為安全轉場
          shots[i].cameraMotion = cameraVector.promptFragment;
        }
      }
    }

    // Step 8: 組裝最終提示詞
    const prompt = this.assemblePrompt(shots, input, style);
    const aspectRatio = input.aspectRatio || "16:9";
    const estimatedDurationSec = input.targetDurationSec || 5;

    // Step 9: 建立風格標籤
    const styleTag = this.buildStyleTag(emotion, style, cameraVector);

    log.push(
      `[VideoCompiler] 編譯完成 | 鏡頭數: ${shots.length} | 預估時長: ${estimatedDurationSec}s | 視角跳躍阻擋: ${jumpBlockCount}`
    );

    return {
      prompt,
      shots,
      shotCount: shots.length,
      estimatedDurationSec,
      cameraMode,
      cameraStabilityScore: cameraVector.stabilityScore,
      firstFrameAnchor,
      lastFrameAnchor,
      emotionTranslations,
      jumpBlockCount,
      styleTag,
      aspectRatio,
      compilationLog: log,
    };
  }

  // ─── 輔助方法 ──────────────────────────────────────────

  private resolveEmotion(input: VideoCompilerInput): string {
    // 優先級：mood blocks → moodKeywords → freePrompt → 預設
    const moodBlock = input.blocks.find(b => b.category === "mood");
    if (moodBlock) {
      const vibeEmotion = VIBE_TO_EMOTION[moodBlock.prompt.toLowerCase()];
      if (vibeEmotion) return vibeEmotion;
      return inferEmotion(moodBlock.prompt);
    }

    if (input.moodKeywords?.length) {
      for (const kw of input.moodKeywords) {
        const vibeEmotion = VIBE_TO_EMOTION[kw.toLowerCase()];
        if (vibeEmotion) return vibeEmotion;
      }
      return inferEmotion(input.moodKeywords.join(" "));
    }

    if (input.freePrompt) {
      return inferEmotion(input.freePrompt);
    }

    return "serenity";
  }

  private parseBlocks(
    input: VideoCompilerInput,
    emotionMap: EmotionActionMap
  ): { subject: string; action: string; environment: string; style: string } {
    const subjectBlocks = input.blocks.filter(b => b.category === "subject");
    const actionBlocks = input.blocks.filter(b => b.category === "action");
    const envBlocks = input.blocks.filter(b => b.category === "environment");
    const styleBlocks = input.blocks.filter(b => b.category === "style");

    // 主體：積木 → 情感映射 → 預設
    const subject =
      subjectBlocks.length > 0
        ? subjectBlocks.map(b => b.prompt).join(", ")
        : emotionMap.subjectBehaviors[0];

    // 動作：積木 → 情感動作動詞 → 預設
    const action =
      actionBlocks.length > 0
        ? actionBlocks.map(b => b.prompt).join(", ")
        : emotionMap.actionVerbs.slice(0, 2).join(", ");

    // 環境：積木 → 情感環境線索 → 預設
    const environment =
      envBlocks.length > 0
        ? envBlocks.map(b => b.prompt).join(", ")
        : emotionMap.environmentalCues[0];

    // 風格：積木 → 覆寫 → 預設
    const style =
      input.styleOverride ||
      (styleBlocks.length > 0
        ? styleBlocks.map(b => b.prompt).join(", ")
        : "cinematic");

    return { subject, action, environment, style };
  }

  private buildShots(
    input: VideoCompilerInput,
    emotionMap: EmotionActionMap,
    cameraVector: CameraVector,
    subject: string,
    action: string,
    environment: string,
    style: string,
    firstAnchor: FrameAnchor,
    lastAnchor: FrameAnchor
  ): VideoShot[] {
    const totalDuration = input.targetDurationSec || 5;
    const shots: VideoShot[] = [];

    if (totalDuration <= 5) {
      // 單鏡頭：直接使用【相機運動+主體+具體動作+環境光影】公式
      shots.push({
        shotNumber: 1,
        cameraMotion: cameraVector.promptFragment,
        subject,
        action,
        environment,
        prompt: this.formatShotPrompt(
          cameraVector.promptFragment,
          subject,
          action,
          environment,
          style,
          input.slowMotion
        ),
        durationSec: totalDuration,
        frameAnchor: firstAnchor,
      });
    } else {
      // 多鏡頭：分配時間
      const shotCount = Math.min(Math.ceil(totalDuration / 4), 5);
      const shotDuration = totalDuration / shotCount;
      const endCameraMode = this.getEndingCameraMode(cameraVector.id);
      const endCamera = this.getCameraVector(endCameraMode);

      for (let i = 0; i < shotCount; i++) {
        const isFirst = i === 0;
        const isLast = i === shotCount - 1;

        // 選擇動作和主體的變化
        const shotAction = isFirst
          ? action
          : emotionMap.actionVerbs[
              Math.min(i, emotionMap.actionVerbs.length - 1)
            ];
        const shotSubject = isFirst
          ? subject
          : emotionMap.subjectBehaviors[
              Math.min(i, emotionMap.subjectBehaviors.length - 1)
            ];
        const shotEnv =
          emotionMap.environmentalCues[
            Math.min(i, emotionMap.environmentalCues.length - 1)
          ] || environment;

        // 選擇相機運動（首尾鏡頭特殊處理）
        let shotCamera: string;
        if (isFirst) {
          shotCamera = cameraVector.promptFragment;
        } else if (isLast) {
          shotCamera = endCamera.promptFragment;
        } else {
          shotCamera = cameraVector.promptFragment;
        }

        shots.push({
          shotNumber: i + 1,
          cameraMotion: shotCamera,
          subject: shotSubject,
          action: shotAction,
          environment: shotEnv,
          prompt: this.formatShotPrompt(
            shotCamera,
            shotSubject,
            shotAction,
            shotEnv,
            style,
            input.slowMotion
          ),
          durationSec: shotDuration,
          frameAnchor: isFirst ? firstAnchor : isLast ? lastAnchor : undefined,
        });
      }
    }

    return shots;
  }

  /**
   * 【相機運動 + 主體 + 具體動作 + 環境光影】公式
   */
  private formatShotPrompt(
    camera: string,
    subject: string,
    action: string,
    environment: string,
    style: string,
    slowMotion?: boolean
  ): string {
    const parts: string[] = [];

    // 風格前綴
    parts.push(`${style} style`);

    // 相機運動
    parts.push(camera);

    // 主體 + 具體動作
    parts.push(`${subject}, ${action}`);

    // 環境光影
    parts.push(environment);

    // 慢動作修飾
    if (slowMotion) {
      parts.push("slow motion, high frame rate");
    }

    return parts.join(". ") + ".";
  }

  private assemblePrompt(
    shots: VideoShot[],
    input: VideoCompilerInput,
    style: string
  ): string {
    const lines: string[] = [];

    // 首幀錨定標記
    if (input.firstFrameUrl) {
      lines.push(`[First Frame Reference: ${input.firstFrameUrl}]`);
    }
    if (input.firstFrameDesc) {
      lines.push(`[Opening: ${input.firstFrameDesc}]`);
    }

    // 寬高比
    lines.push(`[Aspect Ratio: ${input.aspectRatio || "16:9"}]`);

    // 風格
    lines.push(`[Style: ${style}]`);

    // 各鏡頭
    if (shots.length === 1) {
      lines.push(shots[0].prompt);
    } else {
      for (const shot of shots) {
        lines.push(`[Shot ${shot.shotNumber}] ${shot.prompt}`);
      }
    }

    // 尾幀錨定標記
    if (input.lastFrameUrl) {
      lines.push(`[Last Frame Reference: ${input.lastFrameUrl}]`);
    }
    if (input.lastFrameDesc) {
      lines.push(`[Closing: ${input.lastFrameDesc}]`);
    }

    // 自由提示詞
    if (input.freePrompt) {
      lines.push(`[Additional Direction] ${input.freePrompt}`);
    }

    return lines.join("\n");
  }

  private buildStyleTag(
    emotion: string,
    style: string,
    camera: CameraVector
  ): string {
    const parts = [style, emotion, camera.labelZh];
    return parts.slice(0, 3).join(", ");
  }

  private extractCameraMode(promptFragment: string): CameraModeId | null {
    for (const [id, vector] of Object.entries(CAMERA_VECTORS)) {
      if (promptFragment === vector.promptFragment) {
        return id as CameraModeId;
      }
    }
    return null;
  }

  // ─── 公開工具方法 ──────────────────────────────────────

  /**
   * 取得所有支援的情緒列表
   */
  getSupportedEmotions(): string[] {
    return EMOTION_ACTION_MAP.map(e => e.emotion);
  }

  /**
   * 預覽某個情緒的翻譯結果
   */
  previewEmotionTranslation(emotion: string): EmotionActionMap | null {
    const found = EMOTION_ACTION_MAP.find(
      e => e.emotion === emotion.toLowerCase()
    );
    return found || null;
  }

  /**
   * 取得相機穩定性報告
   */
  getCameraStabilityReport(modes: CameraModeId[]): {
    averageStability: number;
    transitions: Array<{
      from: CameraModeId;
      to: CameraModeId;
      valid: boolean;
    }>;
  } {
    let totalStability = 0;
    const transitions: Array<{
      from: CameraModeId;
      to: CameraModeId;
      valid: boolean;
    }> = [];

    for (let i = 0; i < modes.length; i++) {
      totalStability += CAMERA_VECTORS[modes[i]]?.stabilityScore || 0;
      if (i > 0) {
        const validation = this.validateCameraTransition(
          modes[i - 1],
          modes[i]
        );
        transitions.push({
          from: modes[i - 1],
          to: modes[i],
          valid: validation.valid,
        });
      }
    }

    return {
      averageStability: modes.length > 0 ? totalStability / modes.length : 0,
      transitions,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

let _instance: VideoCompiler | null = null;

export function getVideoCompiler(): VideoCompiler {
  if (!_instance) {
    _instance = new VideoCompiler();
  }
  return _instance;
}
