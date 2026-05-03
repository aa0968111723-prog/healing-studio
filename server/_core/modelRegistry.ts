/**
 * Canonical AI Model Registry — Single Source of Truth (SSOT)
 *
 * 統整三大目錄(推理大腦/生成引擎/Fal 16 任務引擎)、
 * 提供推導工具(per-category allowlist、known model id set、別名解析),
 * 避免 brain.ts / brainContext.ts / falDispatcher.ts 之間出現漂移。
 */
import {
  FAL_MODEL_CATALOG,
  FAL_CATEGORY_LABELS,
  type FalCategory,
} from "../services/falModels";
import {
  LEGACY_FAL_ALIAS_MAP,
  normalizeEngineModelId,
} from "../../shared/engineModelIds";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Reasoning Brain Catalog (5 slots)
// ═══════════════════════════════════════════════════════════════════════════

/** 5 大推理大腦備選清單(含 Vertex AI 模型) */
export const REASONING_MODEL_CATALOG = {
  director: {
    label: "導演 AI",
    description: "統籌創作流程、分鏡、敘事結構(對應 /director)",
    targetPath: "/director",
    options: [
      // ── Gemini / Vertex AI ──
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro ✦", tier: "premium" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      // ── Vertex AI 模型 ──
      {
        value: "vertex/gemini-2.5-pro",
        label: "Vertex Gemini 2.5 Pro 🔷",
        tier: "premium",
      },
      {
        value: "vertex/llama-3.2-90b",
        label: "Vertex Llama 3.2 90B",
        tier: "premium",
      },
      // ── DEF-13 修正:新增 NVIDIA NIM / MiniMax M2.7 ──
      {
        value: "nvidia/minimax-m2.7",
        label: "MiniMax M2.7 (NVIDIA NIM) 🟠",
        tier: "premium",
      },
      // ── Perplexity Sonar（原生 API，內建 web grounding，AI 代理專用）──
      {
        value: "perplexity/sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro 🔍 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "perplexity/sonar-pro",
        label: "Perplexity Sonar Pro 🔍",
        tier: "premium",
      },
      {
        value: "perplexity/sonar",
        label: "Perplexity Sonar 🔍 ⚡",
        tier: "fast",
      },
      // ── OpenRouter Unified Gateway ──
      {
        value: "anthropic/claude-sonnet-4.5",
        label: "Claude Sonnet 4.5 (OpenRouter) 🟣",
        tier: "premium",
      },
      {
        value: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7 (OpenRouter) 🟣",
        tier: "ultra",
      },
      {
        value: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro (OpenRouter) 🟣",
        tier: "premium",
      },
      {
        value: "minimax/minimax-m2",
        label: "MiniMax M2 (OpenRouter) 🟣",
        tier: "premium",
      },
    ],
  },
  analyst: {
    label: "新聞過濾",
    description: "數據分析、趨勢洞察、新聞摘要",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      {
        value: "vertex/gemini-2.5-flash",
        label: "Vertex Gemini 2.5 Flash 🔷",
        tier: "fast",
      },
      {
        value: "vertex/llama-3.1-405b",
        label: "Vertex Llama 3.1 405B",
        tier: "premium",
      },
      // ── Perplexity Sonar（原生 API，內建 web grounding） ──
      {
        value: "perplexity/sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro 🔍 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "perplexity/sonar-pro",
        label: "Perplexity Sonar Pro 🔍",
        tier: "premium",
      },
      // ── OpenRouter Unified Gateway ──
      {
        value: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7 (OpenRouter) 🟣 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "google/gemini-2.5-flash",
        label: "Gemini 2.5 Flash (OpenRouter) 🟣",
        tier: "fast",
      },
      {
        value: "anthropic/claude-haiku-4.5",
        label: "Claude Haiku 4.5 (OpenRouter) 🟣 ⚡",
        tier: "fast",
      },
    ],
  },
  storyteller: {
    label: "編譯器",
    description: "提示詞編譯、文案撰寫、故事展開",
    options: [
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro ✦", tier: "premium" },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      {
        value: "vertex/gemini-2.5-pro",
        label: "Vertex Gemini 2.5 Pro 🔷",
        tier: "premium",
      },
      {
        value: "vertex/mistral-nemo",
        label: "Vertex Mistral NeMo",
        tier: "standard",
      },
      // ── Perplexity Sonar（原生 API，內建 web grounding） ──
      {
        value: "perplexity/sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro 🔍 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "perplexity/sonar-pro",
        label: "Perplexity Sonar Pro 🔍",
        tier: "premium",
      },
      // ── OpenRouter Unified Gateway ──
      {
        value: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7 (OpenRouter) 🟣 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "anthropic/claude-sonnet-4.5",
        label: "Claude Sonnet 4.5 (OpenRouter) 🟣",
        tier: "premium",
      },
      {
        value: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro (OpenRouter) 🟣",
        tier: "premium",
      },
      {
        value: "mistralai/mistral-nemo",
        label: "Mistral NeMo (OpenRouter) 🟣",
        tier: "standard",
      },
    ],
  },
  technician: {
    label: "光球語調",
    description: "VisualSoul 對話風格、OARS 語句生成",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      {
        value: "vertex/gemini-2.5-flash",
        label: "Vertex Gemini 2.5 Flash 🔷",
        tier: "fast",
      },
      // ── Perplexity Sonar（原生 API，內建 web grounding） ──
      {
        value: "perplexity/sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro 🔍 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "perplexity/sonar-pro",
        label: "Perplexity Sonar Pro 🔍",
        tier: "premium",
      },
      // ── OpenRouter Unified Gateway ──
      {
        value: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7 (OpenRouter) 🟣 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "anthropic/claude-haiku-4.5",
        label: "Claude Haiku 4.5 (OpenRouter) 🟣 ⚡",
        tier: "fast",
      },
      {
        value: "google/gemini-2.5-flash",
        label: "Gemini 2.5 Flash (OpenRouter) 🟣 ⚡",
        tier: "fast",
      },
    ],
  },
  curator: {
    label: "RAG 向量",
    description: "風格推薦、美學判斷、靈感策展",
    options: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash ⚡", tier: "fast" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "premium" },
      {
        value: "vertex/gemini-2.5-pro",
        label: "Vertex Gemini 2.5 Pro 🔷",
        tier: "premium",
      },
      // ── Perplexity Sonar（原生 API，內建 web grounding） ──
      {
        value: "perplexity/sonar-reasoning-pro",
        label: "Perplexity Sonar Reasoning Pro 🔍 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "perplexity/sonar-pro",
        label: "Perplexity Sonar Pro 🔍",
        tier: "premium",
      },
      // ── OpenRouter Unified Gateway ──
      {
        value: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7 (OpenRouter) 🟣 ✦ AI 代理專用",
        tier: "ultra",
      },
      {
        value: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro (OpenRouter) 🟣",
        tier: "premium",
      },
      {
        value: "anthropic/claude-haiku-4.5",
        label: "Claude Haiku 4.5 (OpenRouter) 🟣 ⚡",
        tier: "fast",
      },
    ],
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 2. Generation Engine Catalog (4 slots)
// ═══════════════════════════════════════════════════════════════════════════

/** 生成引擎備選清單(圖片/影片/音頻/語音 + Gemini + ElevenLabs 完整目錄) */
export const GENERATION_ENGINE_CATALOG = {
  imageEngine: {
    label: "圖片工作室",
    description: "AI 圖像生成(對應 /image-studio)",
    targetPath: "/image-studio",
    options: [
      // ── Fal.ai ──
      { value: "fal/flux-pro-1.1", label: "Flux Pro 1.1 ✦", tier: "premium" },
      { value: "fal/flux-dev", label: "Flux Dev", tier: "premium" },
      { value: "fal/flux-schnell", label: "Flux Schnell ⚡", tier: "fast" },
      {
        value: "fal/sd3-medium",
        label: "Stable Diffusion 3",
        tier: "standard",
      },
      { value: "fal/ideogram-v2", label: "Ideogram V2", tier: "premium" },
      { value: "fal/aura-flow", label: "AuraFlow", tier: "standard" },
      // ── Gemini Imagen ──
      {
        value: "gemini/imagen-3",
        label: "Imagen 3 (Gemini) 🔵",
        tier: "premium",
      },
      {
        value: "gemini/imagen-3-fast",
        label: "Imagen 3 Fast (Gemini) ⚡",
        tier: "fast",
      },
      // ── Vertex Imagen ──
      {
        value: "vertex/imagen-3",
        label: "Imagen 3 (Vertex) 🔷",
        tier: "premium",
      },
      // ── Imagen 4(Gemini & Vertex)──
      {
        value: "gemini/imagen-4",
        label: "Imagen 4 (Gemini) 🔵",
        tier: "premium",
      },
      {
        value: "gemini/imagen-4-fast",
        label: "Imagen 4 Fast (Gemini) ⚡",
        tier: "fast",
      },
      {
        value: "vertex/imagen-4",
        label: "Imagen 4 (Vertex) 🔷",
        tier: "premium",
      },
      // ── Nano Banana(Gemini 2.5 Flash Image,圖像快速編修)──
      {
        value: "gemini/nano-banana",
        label: "Nano Banana (Gemini Flash Image) 🍌",
        tier: "fast",
      },
    ],
  },
  videoEngine: {
    label: "影片工作室",
    description: "AI 影片生成(對應 /video-studio,含 t2v / i2v / v2v)",
    targetPath: "/video-studio",
    options: [
      // ── Fal.ai 文字轉影片(canonical IDs) ──
      {
        value: "fal-ai/kling-video/v2.1/pro/text-to-video",
        label: "Kling V2.1 Pro t2v ✦",
        tier: "premium",
      },
      {
        value: "fal-ai/kling-video/v2.1/standard/text-to-video",
        label: "Kling V2.1 Standard t2v",
        tier: "premium",
      },
      {
        value: "fal-ai/minimax-video/text-to-video",
        label: "MiniMax Hailuo t2v",
        tier: "standard",
      },
      {
        value: "fal-ai/minimax/hailuo-02/pro/text-to-video",
        label: "MiniMax Hailuo 02 Pro t2v",
        tier: "premium",
      },
      {
        value: "fal-ai/luma-dream-machine",
        label: "Luma Dream Machine t2v",
        tier: "premium",
      },
      { value: "fal-ai/wan-t2v", label: "WAN T2V 2.1", tier: "standard" },
      {
        value: "fal-ai/wan-ai/wan2.1-t2v-720p",
        label: "WAN 2.1 720p t2v",
        tier: "standard",
      },
      {
        value: "fal-ai/cogvideox-5b",
        label: "CogVideoX 5B t2v",
        tier: "standard",
      },
      {
        value: "fal-ai/ltx-video-13b-distilled",
        label: "LTX 13B Distilled t2v",
        tier: "standard",
      },
      { value: "fal-ai/sora", label: "OpenAI Sora t2v", tier: "ultra" },
      { value: "fal-ai/veo3", label: "Veo 3 (fal) t2v", tier: "premium" },
      {
        value: "fal-ai/veo3/pro",
        label: "Veo 3 Pro (fal) t2v ✦",
        tier: "ultra",
      },

      // ── Fal.ai 圖片轉影片 ──
      {
        value: "fal-ai/kling-video/v2.1/pro/image-to-video",
        label: "Kling V2.1 Pro i2v ✦",
        tier: "ultra",
      },
      {
        value: "fal-ai/kling-video/v2.1/standard/image-to-video",
        label: "Kling V2.1 Standard i2v",
        tier: "premium",
      },
      {
        value: "fal-ai/runway-gen3/turbo/image-to-video",
        label: "Runway Gen3 Turbo i2v",
        tier: "premium",
      },
      {
        value: "fal-ai/runway-gen4-turbo/image-to-video",
        label: "Runway Gen4 Turbo i2v",
        tier: "ultra",
      },
      {
        value: "fal-ai/minimax-video/image-to-video",
        label: "MiniMax i2v",
        tier: "standard",
      },
      {
        value: "fal-ai/minimax/hailuo-02/pro/image-to-video",
        label: "MiniMax Hailuo 02 Pro i2v",
        tier: "premium",
      },
      {
        value: "fal-ai/pixverse/v4.5/image-to-video",
        label: "PixVerse V4.5 i2v",
        tier: "standard",
      },
      {
        value: "fal-ai/luma-dream-machine/image-to-video",
        label: "Luma Dream Machine i2v",
        tier: "premium",
      },
      { value: "fal-ai/wan-i2v", label: "WAN I2V 2.1", tier: "standard" },
      {
        value: "fal-ai/wan-ai/wan2.1-i2v-720p",
        label: "WAN 2.1 720p i2v",
        tier: "standard",
      },
      {
        value: "fal-ai/ltx-video/image-to-video",
        label: "LTX Video i2v",
        tier: "standard",
      },
      {
        value: "fal-ai/stable-video",
        label: "Stable Video Diffusion",
        tier: "standard",
      },

      // ── Fal.ai 影片轉影片(v2v) ──
      {
        value: "fal-ai/kling-video/v2.1/standard/video-to-video",
        label: "Kling V2.1 V2V",
        tier: "ultra",
      },
      {
        value: "fal-ai/kling-video/v1.6/standard/video-to-video",
        label: "Kling V1.6 V2V",
        tier: "premium",
      },
      {
        value: "fal-ai/wan/v2.1/video-to-video",
        label: "WAN 2.1 V2V",
        tier: "standard",
      },
      {
        value: "fal-ai/wan-ai/wan2.1-v2v-480p",
        label: "WAN 2.1 480p V2V",
        tier: "standard",
      },
      {
        value: "fal-ai/cogvideox-5b/video-to-video",
        label: "CogVideoX V2V",
        tier: "standard",
      },
      {
        value: "fal-ai/animatediff-v2v",
        label: "AnimateDiff V2V (進階控制)",
        tier: "standard",
      },

      // ── Fal.ai 畫質優化(enhance) ──
      {
        value: "fal-ai/bytedance/upscaler/video",
        label: "ByteDance 影片超解析",
        tier: "premium",
      },
      {
        value: "fal-ai/rife-v4.6/video",
        label: "RIFE 補幀",
        tier: "standard",
      },
      {
        value: "fal-ai/topaz/video-enhance",
        label: "Topaz Video Enhance",
        tier: "ultra",
      },

      // ── Fal.ai 進階控制(control) ──
      {
        value: "fal-ai/cammaster",
        label: "CamMaster 鏡頭運動控制",
        tier: "premium",
      },
      {
        value: "fal-ai/depthcrafter",
        label: "DepthCrafter 深度感知",
        tier: "standard",
      },
      {
        value: "fal-ai/vidu/q1/reference-to-video",
        label: "Vidu Q1 Reference-to-Video",
        tier: "premium",
      },

      // ── Gemini Veo ──
      { value: "gemini/veo-2", label: "Veo 2 (Gemini) 🔵", tier: "premium" },
      {
        value: "gemini/veo-3",
        label: "Veo 3 Preview (Gemini) 🔵",
        tier: "ultra",
      },
    ],
  },
  audioEngine: {
    label: "配音配樂工作室(配樂)",
    description: "AI 音樂/音效生成(對應 /pro-studio)",
    targetPath: "/pro-studio",
    options: [
      // ── Suno ──
      { value: "suno-v4", label: "Suno V4 ✦", tier: "premium" },
      { value: "suno-v3.5", label: "Suno V3.5", tier: "standard" },
      // ── Fal.ai 音頻 ──
      {
        value: "fal/stable-audio",
        label: "Stable Audio (Fal)",
        tier: "premium",
      },
      { value: "fal/musicgen", label: "MusicGen (Meta)", tier: "standard" },
      { value: "fal/ace-step", label: "ACE-Step", tier: "premium" },
      { value: "fal/audioldm2", label: "AudioLDM 2", tier: "standard" },
      // ── Gemini Lyria ──
      {
        value: "gemini/lyria-2",
        label: "Lyria 2 (Gemini) 🔵",
        tier: "premium",
      },
      {
        value: "gemini/musicfx",
        label: "MusicFX (Gemini) 🔵",
        tier: "standard",
      },
      // ── ElevenLabs ──
      {
        value: "elevenlabs/music",
        label: "ElevenLabs Music 🎵",
        tier: "premium",
      },
      {
        value: "elevenlabs/sound-effects",
        label: "ElevenLabs 音效 🎵",
        tier: "standard",
      },
    ],
  },
  voiceEngine: {
    label: "配音配樂工作室(配音)",
    description: "AI 語音合成(對應 /pro-studio)",
    targetPath: "/pro-studio",
    options: [
      // ── ElevenLabs ──
      {
        value: "elevenlabs/eleven-v3",
        label: "ElevenLabs V3 ✦",
        tier: "premium",
      },
      {
        value: "elevenlabs/multilingual-v2",
        label: "ElevenLabs Multilingual V2",
        tier: "premium",
      },
      {
        value: "elevenlabs/turbo-v2.5",
        label: "ElevenLabs Turbo V2.5 ⚡",
        tier: "fast",
      },
      {
        value: "elevenlabs/flash-v2.5",
        label: "ElevenLabs Flash V2.5 ⚡",
        tier: "fast",
      },
      // ── Fal.ai TTS ──
      // DEF-06 修正:移除 MetaVoice v1(對應 fal-ai/metavoice-v1 API 已變更,422 錯誤)
      { value: "fal/playai-tts", label: "PlayAI TTS (Fal)", tier: "premium" },
      { value: "fal/kokoro", label: "Kokoro TTS (Fal) ⚡", tier: "fast" },
      {
        value: "fal/orpheus-tts",
        label: "Orpheus TTS (Fal)",
        tier: "standard",
      },
      { value: "fal/dia-tts", label: "Dia TTS (Fal)", tier: "standard" },
      // ── Gemini TTS ──
      {
        value: "gemini/tts-flash",
        label: "Gemini TTS Flash 🔵 ⚡",
        tier: "fast",
      },
      { value: "gemini/tts-pro", label: "Gemini TTS Pro 🔵", tier: "premium" },
    ],
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 3. Fal Task Engine Catalog (16 slots, auto-derived from FAL_MODEL_CATALOG)
// ═══════════════════════════════════════════════════════════════════════════

/** Fal.ai 16大類專用引擎(可在大腦設定中為特定任務指定) */
export const FAL_TASK_ENGINE_CATALOG = Object.fromEntries(
  (Object.keys(FAL_MODEL_CATALOG) as FalCategory[]).map(cat => [
    cat,
    {
      label: FAL_CATEGORY_LABELS[cat],
      description: FAL_MODEL_CATALOG[cat][0]?.description ?? "",
      options: FAL_MODEL_CATALOG[cat].map(m => ({
        value: m.modelId,
        label: m.label,
        tier: m.tier,
      })),
    },
  ])
) as Record<
  FalCategory,
  {
    label: string;
    description: string;
    options: Array<{ value: string; label: string; tier: string }>;
  }
>;

// ═══════════════════════════════════════════════════════════════════════════
// 4. Fal field name → category mapping
// ═══════════════════════════════════════════════════════════════════════════

/** 16 個 Fal task 欄位名 → FalCategory(供 upsert 與測試使用) */
export const FAL_FIELD_TO_CATEGORY: Record<string, FalCategory> = {
  falImageTo3dEngine: "image-to-3d",
  falImageToImageEngine: "image-to-image",
  falImageToJsonEngine: "image-to-json",
  falImageToVideoEngine: "image-to-video",
  falJsonEngine: "json",
  falLlmEngine: "llm",
  falTextTo3dEngine: "text-to-3d",
  falTextToAudioEngine: "text-to-audio",
  falTextToImageEngine: "text-to-image",
  falTextToJsonEngine: "text-to-json",
  falTextToSpeechEngine: "text-to-speech",
  falTextToVideoEngine: "text-to-video",
  falTrainingEngine: "training",
  falVideoToAudioEngine: "video-to-audio",
  falVideoToTextEngine: "video-to-text",
  falVideoToVideoEngine: "video-to-video",
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. Per-category & per-field allowlists
// ═══════════════════════════════════════════════════════════════════════════

/** 取得特定 Fal 任務分類的允許 model id 集合(供 enum 驗證使用) */
export function getFalAllowlistForCategory(category: FalCategory): Set<string> {
  return new Set(FAL_MODEL_CATALOG[category].map(m => m.modelId));
}

/** 16 個 Fal 欄位的 allowlist(預先計算,供 brain.upsert 使用) */
export const FAL_FIELD_ALLOWLISTS: Record<string, Set<string>> =
  Object.fromEntries(
    Object.entries(FAL_FIELD_TO_CATEGORY).map(([field, cat]) => [
      field,
      getFalAllowlistForCategory(cat),
    ])
  );

/** 5 推理槽 allowlist */
export const REASONING_MODEL_ALLOWLIST = Object.fromEntries(
  (
    Object.keys(REASONING_MODEL_CATALOG) as Array<
      keyof typeof REASONING_MODEL_CATALOG
    >
  ).map(slot => [
    slot,
    new Set(REASONING_MODEL_CATALOG[slot].options.map(opt => opt.value)),
  ])
) as Record<keyof typeof REASONING_MODEL_CATALOG, Set<string>>;

// ═══════════════════════════════════════════════════════════════════════════
// 6. Known model id set (auto-derived; replaces 490-line hardcoded KNOWN_MODELS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 舊版 LLM/引擎別名(catalog 中已移除但仍需識別的向後相容 ID)
 * 用於健康檢查的 isRecognizedModel,以及 fallback 鏈解析。
 */
const LEGACY_LLM_ALIASES = new Set([
  // OpenAI legacy(自動 remap 到 OpenRouter 或 Gemini)
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-16k",
  // Anthropic legacy(Claude 3 系列;OpenRouter 已下架,自動 remap 到 4.x)
  "claude-3.5-sonnet",
  "claude-3-sonnet",
  "claude-3-opus",
  "claude-3-haiku",
  "claude-instant-1",
  // Anthropic native API IDs(date-suffixed;非 OpenRouter 形式)
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-opus-4-7",
  // Gemini 1.5 系列(Google 已 deprecate,自動 remap 到 2.5)
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-pro",
  // Vertex Gemini 1.5
  "vertex/gemini-1.5-pro",
  "vertex/gemini-1.5-flash",
  // 圖像引擎短名稱
  "flux-pro",
  "flux-schnell",
  "dall-e-3",
  "stable-diffusion-xl",
  // 影片引擎短名稱
  "kling-v1",
  "kling-v1-5",
  "minimax-video",
  // 音樂引擎短名稱
  "udio-v1",
  // 語音引擎短名稱
  "elevenlabs-v2",
  "elevenlabs-v1",
  "azure-tts",
  // MiniMax via NVIDIA NIM(catalog 用 nvidia/...,brainContext 用 minimaxai/...)
  "minimaxai/minimax-m2.7",
  // OpenRouter Unified Gateway 路徑(provider/model 格式)
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-opus-4.7",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "minimax/minimax-m2",
  "meta-llama/llama-3.2-90b-vision-instruct",
  "meta-llama/llama-3.1-405b-instruct",
  "mistralai/mistral-nemo",
  // Perplexity Sonar 系列(原生 API + 可走 OpenRouter perplexity/* 前綴)
  "perplexity/sonar",
  "perplexity/sonar-pro",
  "perplexity/sonar-reasoning",
  "perplexity/sonar-reasoning-pro",
  "perplexity/sonar-deep-research",
  "sonar",
  "sonar-pro",
  "sonar-reasoning",
  "sonar-reasoning-pro",
  "sonar-deep-research",
  // OpenAI via OpenRouter
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/gpt-4-turbo",
  "openai/gpt-4",
  "openai/gpt-3.5-turbo",
]);

/**
 * 在 module load time 一次性計算「已知」模型/引擎 ID 集合,涵蓋:
 *  - 5 推理大腦 catalog(REASONING_MODEL_CATALOG)
 *  - 4 生成引擎 catalog(GENERATION_ENGINE_CATALOG;含 normalize 後的 canonical 形式)
 *  - 16 Fal 任務 catalog(FAL_MODEL_CATALOG)
 *  - LEGACY_FAL_ALIAS_MAP 的舊鍵與新值
 *  - LEGACY_LLM_ALIASES 的向後相容 ID
 *
 * 凍結為 readonly Set,避免熱載入或測試 mock 改變 catalog 後造成不一致。
 */
function buildKnownModelIds(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const slot of Object.values(REASONING_MODEL_CATALOG)) {
    for (const opt of slot.options) set.add(opt.value);
  }
  for (const slot of Object.values(GENERATION_ENGINE_CATALOG)) {
    for (const opt of slot.options) {
      set.add(opt.value);
      set.add(normalizeEngineModelId(opt.value));
    }
  }
  for (const cat of Object.values(FAL_MODEL_CATALOG)) {
    for (const m of cat) set.add(m.modelId);
  }
  for (const [from, to] of Object.entries(LEGACY_FAL_ALIAS_MAP)) {
    set.add(from);
    set.add(to);
  }
  LEGACY_LLM_ALIASES.forEach(id => set.add(id));
  return set;
}

const KNOWN_MODEL_IDS: ReadonlySet<string> = buildKnownModelIds();

export function getKnownModelIds(): ReadonlySet<string> {
  return KNOWN_MODEL_IDS;
}

/** 健康檢查使用:判斷一個模型 ID 是否在已知集合中 */
export function isCanonicalOrKnownModel(id: string): boolean {
  return getKnownModelIds().has(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Re-exports
// ═══════════════════════════════════════════════════════════════════════════

export { FAL_MODEL_CATALOG, FAL_CATEGORY_LABELS, normalizeEngineModelId };
export type { FalCategory };
