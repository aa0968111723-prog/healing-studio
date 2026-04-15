/**
 * modelPricing.ts — 全模型成本定價 & 點數換算規則
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 設計原則：
 *  1. 以「平台積分（Points）」為計費單位
 *  2. 換算基準：1 USD ≈ 100 Points（方便理解，數字整）
 *  3. 每個模型的 pointCost 按真實 API 成本按比例計算
 *  4. 免費模型 = 1 Point（平台基礎運算成本）
 *  5. 超出範圍的參數（時長、解析度）按乘數額外計費
 *
 * 計費公式：
 *  totalPoints = baseCost × durationMultiplier × resolutionMultiplier × countMultiplier
 *
 * 參考真實成本（2025 Q2）：
 *  - Flux Pro 1.1 : ~$0.04/image  → 4 pts
 *  - Kling V2.1   : ~$0.49/5s    → 49 pts
 *  - ElevenLabs V3: ~$0.18/1kchar→ 18 pts/1k
 *  - Gemini Imagen3: ~$0.04/image → 4 pts
 *  - Gemini Veo2   : ~$0.35/5s   → 35 pts
 *  - Flux Schnell  : ~$0.003/image→ 1 pt  (min 1)
 *  - Whisper       : ~$0.006/min  → 1 pt/min
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PricingTier = "free" | "economy" | "standard" | "premium" | "ultra";
export type ModelCategory =
  | "audio-to-text" | "image-to-3d" | "image-to-image" | "image-to-json" | "image-to-video"
  | "json" | "llm" | "text-to-3d" | "text-to-audio" | "text-to-image"
  | "text-to-json" | "text-to-speech" | "text-to-video" | "training"
  | "video-to-audio" | "video-to-text" | "video-to-video"
  | "reasoning" | "embedding";

export interface ModelPricing {
  modelId: string;
  label: string;
  provider: "fal" | "gemini" | "vertex" | "elevenlabs" | "suno" | "openai" | "anthropic" | "nvidia";
  category: ModelCategory;
  tier: PricingTier;

  /** 基礎點數（每次呼叫基線） */
  basePoints: number;

  /** 真實 USD 成本（參考，僅供計算） */
  baseCostUsd: number;

  /** 計費單位說明 */
  unit: string;

  /** 時長乘數（每秒） — 僅限影片/音頻模型 */
  pointsPerSecond?: number;

  /** 每千字符點數 — 僅限 TTS/LLM */
  pointsPer1kChars?: number;

  /** 每幀/每張圖點數 — 僅限批次圖片 */
  pointsPerImage?: number;

  /** 訓練步驟點數 — 僅限 training */
  pointsPerStep?: number;

  /** 最低點數（計算結果不低於此值） */
  minPoints: number;

  /** 最高單次點數上限（防異常） */
  maxPoints: number;

  /** 是否需要 API Key */
  requiresKey: boolean;

  /** 所需 API Key 環境變數名稱 */
  keyEnvVar?: string;

  /** 可用性備注 */
  availabilityNote?: string;
}

export interface PointsEstimate {
  modelId: string;
  basePoints: number;
  multipliers: Record<string, number>;
  totalPoints: number;
  breakdown: string;
}

// ─── Pricing Catalog ──────────────────────────────────────────────────────────

export const MODEL_PRICING_CATALOG: Record<string, ModelPricing> = {

  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-IMAGE
  // ═══════════════════════════════════════════════════════════

  "fal-ai/flux-pro/v1.1": {
    modelId: "fal-ai/flux-pro/v1.1",
    label: "Flux Pro 1.1",
    provider: "fal",
    category: "text-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每張圖片",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/flux/dev": {
    modelId: "fal-ai/flux/dev",
    label: "Flux Dev",
    provider: "fal",
    category: "text-to-image",
    tier: "premium",
    basePoints: 3,
    baseCostUsd: 0.025,
    unit: "每張圖片",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/flux/schnell": {
    modelId: "fal-ai/flux/schnell",
    label: "Flux Schnell",
    provider: "fal",
    category: "text-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.003,
    unit: "每張圖片",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-diffusion-v3-medium": {
    modelId: "fal-ai/stable-diffusion-v3-medium",
    label: "SD3 Medium",
    provider: "fal",
    category: "text-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每張圖片",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/aura-flow": {
    modelId: "fal-ai/aura-flow",
    label: "AuraFlow",
    provider: "fal",
    category: "text-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每張圖片",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/ideogram/v2": {
    modelId: "fal-ai/ideogram/v2",
    label: "Ideogram V2",
    provider: "fal",
    category: "text-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每張圖片",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "gemini/imagen-3": {
    modelId: "gemini/imagen-3",
    label: "Imagen 3 (Gemini)",
    provider: "gemini",
    category: "text-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每張圖片",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "gemini/imagen-3-fast": {
    modelId: "gemini/imagen-3-fast",
    label: "Imagen 3 Fast (Gemini)",
    provider: "gemini",
    category: "text-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每張圖片",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/imagen-3": {
    modelId: "vertex/imagen-3",
    label: "Imagen 3 (Vertex)",
    provider: "vertex",
    category: "text-to-image",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每張圖片",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },

  // ═══════════════════════════════════════════════════════════
  // IMAGE-TO-IMAGE
  // ═══════════════════════════════════════════════════════════

  "fal-ai/flux/dev/image-to-image": {
    modelId: "fal-ai/flux/dev/image-to-image",
    label: "Flux Dev i2i",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次轉換",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-diffusion-v3-medium/image-to-image": {
    modelId: "fal-ai/stable-diffusion-v3-medium/image-to-image",
    label: "SD3 Medium i2i",
    provider: "fal",
    category: "image-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次轉換",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/ip-adapter-face-id": {
    modelId: "fal-ai/ip-adapter-face-id",
    label: "IP-Adapter FaceID",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次轉換",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/controlnet-union": {
    modelId: "fal-ai/controlnet-union",
    label: "ControlNet Union",
    provider: "fal",
    category: "image-to-image",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次轉換",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/aura-sr": {
    modelId: "fal-ai/aura-sr",
    label: "AuraSR 超解析度",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次增強",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/imageutils/rembg": {
    modelId: "fal-ai/imageutils/rembg",
    label: "RemBG 去背",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.001,
    unit: "每次去背",
    minPoints: 1,
    maxPoints: 3,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-VIDEO
  // ═══════════════════════════════════════════════════════════

  "fal-ai/kling-video/v2.1/pro/text-to-video": {
    modelId: "fal-ai/kling-video/v2.1/pro/text-to-video",
    label: "Kling V2.1 Pro t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 49,   // 5s base
    baseCostUsd: 0.49,
    unit: "每5秒",
    pointsPerSecond: 9.8,
    minPoints: 49,
    maxPoints: 500,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/kling-video/v2.1/standard/text-to-video": {
    modelId: "fal-ai/kling-video/v2.1/standard/text-to-video",
    label: "Kling V2.1 Standard t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "premium",
    basePoints: 30,   // 5s base — Standard 比 Pro 便宜
    baseCostUsd: 0.30,
    unit: "每5秒",
    pointsPerSecond: 6,
    minPoints: 30,
    maxPoints: 350,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // ⚠️ Deprecated: Kling V1.5 — 保留向後相容（映射到 V2.1 Standard 計費）
  "fal-ai/kling-video/v1.5/pro/text-to-video": {
    modelId: "fal-ai/kling-video/v1.5/pro/text-to-video",
    label: "Kling V1.5 Pro t2v (deprecated → V2.1)",
    provider: "fal",
    category: "text-to-video",
    tier: "premium",
    basePoints: 30,
    baseCostUsd: 0.30,
    unit: "每5秒",
    pointsPerSecond: 6,
    minPoints: 30,
    maxPoints: 350,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/minimax-video/text-to-video": {
    modelId: "fal-ai/minimax-video/text-to-video",
    label: "MiniMax Hailuo t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/luma-dream-machine": {
    modelId: "fal-ai/luma-dream-machine",
    label: "Luma Dream Machine t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "premium",
    basePoints: 30,
    baseCostUsd: 0.30,
    unit: "每5秒",
    pointsPerSecond: 6,
    minPoints: 30,
    maxPoints: 300,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wan-t2v-v2.1": {
    modelId: "fal-ai/wan-t2v-v2.1",
    label: "WAN T2V 2.1",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每5秒",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/cogvideox-5b": {
    modelId: "fal-ai/cogvideox-5b",
    label: "CogVideoX 5B",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每6秒",
    pointsPerSecond: 2.5,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "gemini/veo-2": {
    modelId: "gemini/veo-2",
    label: "Veo 2 (Gemini)",
    provider: "gemini",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 35,
    baseCostUsd: 0.35,
    unit: "每5秒",
    pointsPerSecond: 7,
    minPoints: 35,
    maxPoints: 350,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "gemini/veo-3": {
    modelId: "gemini/veo-3",
    label: "Veo 3 Preview (Gemini)",
    provider: "gemini",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 50,
    baseCostUsd: 0.50,
    unit: "每5秒",
    pointsPerSecond: 10,
    minPoints: 50,
    maxPoints: 500,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
    availabilityNote: "Preview 版本，需申請存取",
  },

  // ═══════════════════════════════════════════════════════════
  // IMAGE-TO-VIDEO
  // ═══════════════════════════════════════════════════════════

  "fal-ai/kling-video/v2.1/pro/image-to-video": {
    modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    label: "Kling V2.1 Pro i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "ultra",
    basePoints: 55,
    baseCostUsd: 0.55,
    unit: "每5秒",
    pointsPerSecond: 11,
    minPoints: 55,
    maxPoints: 550,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/kling-video/v2.1/standard/image-to-video": {
    modelId: "fal-ai/kling-video/v2.1/standard/image-to-video",
    label: "Kling V2.1 Standard i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 35,
    baseCostUsd: 0.35,
    unit: "每5秒",
    pointsPerSecond: 7,
    minPoints: 35,
    maxPoints: 350,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // ⚠️ Deprecated: Kling V1.5 i2v — 保留向後相容
  "fal-ai/kling-video/v1.5/pro/image-to-video": {
    modelId: "fal-ai/kling-video/v1.5/pro/image-to-video",
    label: "Kling V1.5 Pro i2v (deprecated → V2.1)",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 35,
    baseCostUsd: 0.35,
    unit: "每5秒",
    pointsPerSecond: 7,
    minPoints: 35,
    maxPoints: 400,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/runway-gen3/turbo/image-to-video": {
    modelId: "fal-ai/runway-gen3/turbo/image-to-video",
    label: "Runway Gen3 Turbo i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 40,
    baseCostUsd: 0.40,
    unit: "每5秒",
    pointsPerSecond: 8,
    minPoints: 40,
    maxPoints: 400,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-video": {
    modelId: "fal-ai/stable-video",
    label: "Stable Video Diffusion",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每25幀",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/minimax-video/image-to-video": {
    modelId: "fal-ai/minimax-video/image-to-video",
    label: "MiniMax i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 22,
    baseCostUsd: 0.22,
    unit: "每6秒",
    pointsPerSecond: 3.7,
    minPoints: 22,
    maxPoints: 220,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/luma-dream-machine/image-to-video": {
    modelId: "fal-ai/luma-dream-machine/image-to-video",
    label: "Luma Dream Machine i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 32,
    baseCostUsd: 0.32,
    unit: "每5秒",
    pointsPerSecond: 6.4,
    minPoints: 32,
    maxPoints: 320,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-AUDIO / MUSIC
  // ═══════════════════════════════════════════════════════════

  "fal-ai/stable-audio": {
    modelId: "fal-ai/stable-audio",
    label: "Stable Audio",
    provider: "fal",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每30秒",
    pointsPerSecond: 0.17,
    minPoints: 5,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/audioldm2": {
    modelId: "fal-ai/audioldm2",
    label: "AudioLDM 2",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每10秒",
    pointsPerSecond: 0.3,
    minPoints: 3,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/mmaudio-v2": {
    modelId: "fal-ai/mmaudio-v2",
    label: "MMAudio V2",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每15秒",
    pointsPerSecond: 0.27,
    minPoints: 4,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/ace-step": {
    modelId: "fal-ai/ace-step",
    label: "ACE-Step",
    provider: "fal",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每60秒",
    pointsPerSecond: 0.13,
    minPoints: 8,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/musicgen": {
    modelId: "fal-ai/musicgen",
    label: "MusicGen",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每15秒",
    pointsPerSecond: 0.2,
    minPoints: 3,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "suno-v4": {
    modelId: "suno-v4",
    label: "Suno V4",
    provider: "suno",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每首歌曲",
    minPoints: 10,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "SUNO_API_KEY",
  },
  "suno-v3.5": {
    modelId: "suno-v3.5",
    label: "Suno V3.5",
    provider: "suno",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 6,
    baseCostUsd: 0.06,
    unit: "每首歌曲",
    minPoints: 6,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "SUNO_API_KEY",
  },
  "gemini/lyria-2": {
    modelId: "gemini/lyria-2",
    label: "Lyria 2 (Gemini)",
    provider: "gemini",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每30秒",
    pointsPerSecond: 0.27,
    minPoints: 8,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "elevenlabs/music": {
    modelId: "elevenlabs/music",
    label: "ElevenLabs Music",
    provider: "elevenlabs",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    minPoints: 10,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "elevenlabs/sound-effects": {
    modelId: "elevenlabs/sound-effects",
    label: "ElevenLabs 音效",
    provider: "elevenlabs",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次生成",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-SPEECH / VOICE
  // ═══════════════════════════════════════════════════════════

  "elevenlabs/eleven-v3": {
    modelId: "elevenlabs/eleven-v3",
    label: "ElevenLabs V3",
    provider: "elevenlabs",
    category: "text-to-speech",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每1000字符",
    pointsPer1kChars: 4,
    minPoints: 1,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "elevenlabs/multilingual-v2": {
    modelId: "elevenlabs/multilingual-v2",
    label: "ElevenLabs Multilingual V2",
    provider: "elevenlabs",
    category: "text-to-speech",
    tier: "premium",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每1000字符",
    pointsPer1kChars: 3,
    minPoints: 1,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "elevenlabs/turbo-v2.5": {
    modelId: "elevenlabs/turbo-v2.5",
    label: "ElevenLabs Turbo V2.5",
    provider: "elevenlabs",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "elevenlabs/flash-v2.5": {
    modelId: "elevenlabs/flash-v2.5",
    label: "ElevenLabs Flash V2.5",
    provider: "elevenlabs",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/metavoice-v1": {
    modelId: "fal-ai/metavoice-v1",
    label: "MetaVoice V1",
    provider: "fal",
    category: "text-to-speech",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每1000字符",
    pointsPer1kChars: 5,
    minPoints: 2,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/playai-tts": {
    modelId: "fal-ai/playai-tts",
    label: "PlayAI TTS",
    provider: "fal",
    category: "text-to-speech",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每1000字符",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/kokoro": {
    modelId: "fal-ai/kokoro",
    label: "Kokoro TTS",
    provider: "fal",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/orpheus-tts": {
    modelId: "fal-ai/orpheus-tts",
    label: "Orpheus TTS",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每1000字符",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dia-tts": {
    modelId: "fal-ai/dia-tts",
    label: "Dia TTS",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每1000字符",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "gemini/tts-flash": {
    modelId: "gemini/tts-flash",
    label: "Gemini TTS Flash",
    provider: "gemini",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "gemini/tts-pro": {
    modelId: "gemini/tts-pro",
    label: "Gemini TTS Pro",
    provider: "gemini",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每1000字符",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // IMAGE-TO-3D
  // ═══════════════════════════════════════════════════════════

  "fal-ai/trellis": {
    modelId: "fal-ai/trellis",
    label: "Trellis 3D",
    provider: "fal",
    category: "image-to-3d",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每次3D生成",
    minPoints: 10,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/triposr": {
    modelId: "fal-ai/triposr",
    label: "TripoSR",
    provider: "fal",
    category: "image-to-3d",
    tier: "standard",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次3D生成",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-zero123": {
    modelId: "fal-ai/stable-zero123",
    label: "Stable Zero123",
    provider: "fal",
    category: "image-to-3d",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次3D生成",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/zero123plus": {
    modelId: "fal-ai/zero123plus",
    label: "Zero123++",
    provider: "fal",
    category: "image-to-3d",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次生成",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/mv-adapter": {
    modelId: "fal-ai/mv-adapter",
    label: "MV-Adapter",
    provider: "fal",
    category: "image-to-3d",
    tier: "premium",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每次3D重建",
    minPoints: 12,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // TEXT-TO-3D
  // ═══════════════════════════════════════════════════════════

  "fal-ai/hyper3d/rodin": {
    modelId: "fal-ai/hyper3d/rodin",
    label: "Hyper3D Rodin",
    provider: "fal",
    category: "text-to-3d",
    tier: "premium",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每次3D生成",
    minPoints: 15,
    maxPoints: 75,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/meshy-4": {
    modelId: "fal-ai/meshy-4",
    label: "Meshy 4",
    provider: "fal",
    category: "text-to-3d",
    tier: "premium",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每次3D生成",
    minPoints: 20,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/shap-e": {
    modelId: "fal-ai/shap-e",
    label: "Shap-E",
    provider: "fal",
    category: "text-to-3d",
    tier: "standard",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次3D生成",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dreamgaussian": {
    modelId: "fal-ai/dreamgaussian",
    label: "DreamGaussian",
    provider: "fal",
    category: "text-to-3d",
    tier: "standard",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每次3D生成",
    minPoints: 8,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/fantasia3d": {
    modelId: "fal-ai/fantasia3d",
    label: "Fantasia3D",
    provider: "fal",
    category: "text-to-3d",
    tier: "premium",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每次3D生成",
    minPoints: 12,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // VIDEO-TO-AUDIO
  // ═══════════════════════════════════════════════════════════

  "fal-ai/mmaudio-v2/video-to-audio": {
    modelId: "fal-ai/mmaudio-v2/video-to-audio",
    label: "MMAudio V2 v2a",
    provider: "fal",
    category: "video-to-audio",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每30秒影片",
    pointsPerSecond: 0.27,
    minPoints: 8,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/sync-lipsync": {
    modelId: "fal-ai/sync-lipsync",
    label: "Sync.so Lipsync",
    provider: "fal",
    category: "video-to-audio",
    tier: "premium",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每分鐘影片",
    pointsPerSecond: 0.25,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // VIDEO-TO-TEXT (Transcription)
  // ═══════════════════════════════════════════════════════════

  "fal-ai/whisper": {
    modelId: "fal-ai/whisper",
    label: "Whisper",
    provider: "fal",
    category: "video-to-text",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.006,
    unit: "每分鐘音訊",
    pointsPerSecond: 0.017,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wizper": {
    modelId: "fal-ai/wizper",
    label: "Wizper",
    provider: "fal",
    category: "video-to-text",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.004,
    unit: "每分鐘音訊",
    pointsPerSecond: 0.01,
    minPoints: 1,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // VIDEO-TO-VIDEO
  // ═══════════════════════════════════════════════════════════

  "fal-ai/kling-video/v2.1/standard/video-to-video": {
    modelId: "fal-ai/kling-video/v2.1/standard/video-to-video",
    label: "Kling V2.1 v2v",
    provider: "fal",
    category: "video-to-video",
    tier: "ultra",
    basePoints: 45,
    baseCostUsd: 0.45,
    unit: "每5秒",
    pointsPerSecond: 9,
    minPoints: 45,
    maxPoints: 450,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wan-v2v": {
    modelId: "fal-ai/wan-v2v",
    label: "WAN V2V",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每5秒",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/video-to-video": {
    modelId: "fal-ai/video-to-video",
    label: "Fal.ai V2V",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每5秒",
    pointsPerSecond: 2.4,
    minPoints: 12,
    maxPoints: 120,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-video-upscaler": {
    modelId: "fal-ai/stable-video-upscaler",
    label: "SVD 超解析度",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每分鐘影片",
    pointsPerSecond: 0.17,
    minPoints: 10,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/cogvideox-5b/video-to-video": {
    modelId: "fal-ai/cogvideox-5b/video-to-video",
    label: "CogVideoX V2V",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每5秒",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/topaz-upscale-video": {
    modelId: "fal-ai/topaz-upscale-video",
    label: "Topaz 超解析度",
    provider: "fal",
    category: "video-to-video",
    tier: "premium",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每分鐘影片",
    pointsPerSecond: 0.33,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // LLM / JSON / IMAGE-TO-JSON / TEXT-TO-JSON
  // ═══════════════════════════════════════════════════════════

  "fal-ai/any-llm": {
    modelId: "fal-ai/any-llm",
    label: "Any LLM Router",
    provider: "fal",
    category: "llm",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次呼叫",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/meta-llama/llama-3.2-90b-vision-instruct": {
    modelId: "fal-ai/meta-llama/llama-3.2-90b-vision-instruct",
    label: "Llama 3.2 90B Vision",
    provider: "fal",
    category: "llm",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次呼叫",
    pointsPer1kChars: 5,
    minPoints: 2,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/meta-llama/llama-3.1-8b-instruct": {
    modelId: "fal-ai/meta-llama/llama-3.1-8b-instruct",
    label: "Llama 3.1 8B",
    provider: "fal",
    category: "llm",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次呼叫",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/moondream": {
    modelId: "fal-ai/moondream",
    label: "Moondream 2",
    provider: "fal",
    category: "image-to-json",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次分析",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wizardlm-2-8x22b": {
    modelId: "fal-ai/wizardlm-2-8x22b",
    label: "WizardLM 2 8x22B",
    provider: "fal",
    category: "llm",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次呼叫",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dolphin-2.9.2-qwen2-72b": {
    modelId: "fal-ai/dolphin-2.9.2-qwen2-72b",
    label: "Dolphin Qwen2 72B",
    provider: "fal",
    category: "llm",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次呼叫",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/lmstudio": {
    modelId: "fal-ai/lmstudio",
    label: "LM Studio",
    provider: "fal",
    category: "llm",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次呼叫",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/outlines": {
    modelId: "fal-ai/outlines",
    label: "Outlines 結構化",
    provider: "fal",
    category: "llm",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次呼叫",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/elevenlabs/sound-effects": {
    modelId: "fal-ai/elevenlabs/sound-effects",
    label: "ElevenLabs 音效 (via fal)",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次生成",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wizardcoder": {
    modelId: "fal-ai/wizardcoder",
    label: "WizardCoder JSON",
    provider: "fal",
    category: "llm",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次呼叫",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // LEGACY ALIASES — 向後相容短名稱（指向對應正式模型的定價）
  // ═══════════════════════════════════════════════════════════

  "fal-ai/flux-schnell": {
    modelId: "fal-ai/flux-schnell",
    label: "FLUX.1 Schnell (alias)",
    provider: "fal",
    category: "text-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每張圖片",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wan-t2v": {
    modelId: "fal-ai/wan-t2v",
    label: "WAN T2V (alias → v2.1)",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每5秒",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/wan-i2v": {
    modelId: "fal-ai/wan-i2v",
    label: "WAN I2V (alias)",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每5秒",
    pointsPerSecond: 4,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/minimax/video-01": {
    modelId: "fal-ai/minimax/video-01",
    label: "MiniMax Hailuo (alias → minimax-video)",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/minimax/video-01/image-to-video": {
    modelId: "fal-ai/minimax/video-01/image-to-video",
    label: "MiniMax Hailuo I2V (alias → minimax-video)",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/llava-next": {
    modelId: "fal-ai/llava-next",
    label: "LLaVA-Next",
    provider: "fal",
    category: "image-to-json",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次分析",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/doctr": {
    modelId: "fal-ai/doctr",
    label: "DocTR OCR",
    provider: "fal",
    category: "image-to-json",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次 OCR",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/sam2": {
    modelId: "fal-ai/sam2",
    label: "SAM2 分割",
    provider: "fal",
    category: "image-to-json",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次分割",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // TRAINING
  // ═══════════════════════════════════════════════════════════

  "fal-ai/flux-lora-fast-training": {
    modelId: "fal-ai/flux-lora-fast-training",
    label: "Flux LoRA 快速訓練",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 200,
    baseCostUsd: 2.00,
    unit: "每次訓練任務",
    pointsPerStep: 0.1,
    minPoints: 200,
    maxPoints: 2000,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
    availabilityNote: "訓練通常需要 10-20 分鐘",
  },
  "fal-ai/flux-lora-portrait-trainer": {
    modelId: "fal-ai/flux-lora-portrait-trainer",
    label: "Flux LoRA 人像訓練",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 250,
    baseCostUsd: 2.50,
    unit: "每次訓練任務",
    pointsPerStep: 0.12,
    minPoints: 250,
    maxPoints: 2500,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dreambooth-flux": {
    modelId: "fal-ai/dreambooth-flux",
    label: "DreamBooth Flux",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 300,
    baseCostUsd: 3.00,
    unit: "每次訓練任務",
    pointsPerStep: 0.15,
    minPoints: 300,
    maxPoints: 3000,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/sd3-lora-training": {
    modelId: "fal-ai/sd3-lora-training",
    label: "SD3 LoRA 訓練",
    provider: "fal",
    category: "training",
    tier: "premium",
    basePoints: 150,
    baseCostUsd: 1.50,
    unit: "每次訓練任務",
    pointsPerStep: 0.08,
    minPoints: 150,
    maxPoints: 1500,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/cogvideox-lora-training": {
    modelId: "fal-ai/cogvideox-lora-training",
    label: "CogVideoX LoRA 訓練",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 500,
    baseCostUsd: 5.00,
    unit: "每次訓練任務",
    pointsPerStep: 0.2,
    minPoints: 500,
    maxPoints: 5000,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/hunyuan-video-lora-training": {
    modelId: "fal-ai/hunyuan-video-lora-training",
    label: "Hunyuan 影片 LoRA 訓練",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 400,
    baseCostUsd: 4.00,
    unit: "每次訓練任務",
    pointsPerStep: 0.18,
    minPoints: 400,
    maxPoints: 4000,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/flux-2-trainer": {
    modelId: "fal-ai/flux-2-trainer",
    label: "FLUX.2 LoRA 訓練",
    provider: "fal",
    category: "training",
    tier: "ultra",
    basePoints: 250,
    baseCostUsd: 2.50,
    unit: "每次訓練任務",
    pointsPerStep: 0.12,
    minPoints: 250,
    maxPoints: 2500,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/turbo-flux-trainer": {
    modelId: "fal-ai/turbo-flux-trainer",
    label: "Turbo Flux 快速訓練",
    provider: "fal",
    category: "training",
    tier: "premium",
    basePoints: 100,
    baseCostUsd: 1.00,
    unit: "每次訓練任務",
    pointsPerStep: 0.05,
    minPoints: 100,
    maxPoints: 1000,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ═══════════════════════════════════════════════════════════
  // REASONING (LLM for brain slots)
  // ═══════════════════════════════════════════════════════════

  "gemini-2.5-pro": {
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "gemini",
    category: "reasoning",
    tier: "premium",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次推理",
    pointsPer1kChars: 3,
    minPoints: 1,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "gemini-2.5-flash": {
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "gemini",
    category: "reasoning",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "gemini-1.5-pro": {
    modelId: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    provider: "gemini",
    category: "reasoning",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次推理",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/gemini-2.5-pro": {
    modelId: "vertex/gemini-2.5-pro",
    label: "Vertex Gemini 2.5 Pro",
    provider: "vertex",
    category: "reasoning",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次推理",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 120,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "vertex/gemini-2.5-flash": {
    modelId: "vertex/gemini-2.5-flash",
    label: "Vertex Gemini 2.5 Flash",
    provider: "vertex",
    category: "reasoning",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.01,
    unit: "每次推理",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "vertex/llama-3.2-90b": {
    modelId: "vertex/llama-3.2-90b",
    label: "Vertex Llama 3.2 90B",
    provider: "vertex",
    category: "reasoning",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次推理",
    pointsPer1kChars: 5,
    minPoints: 2,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },

  // ═══════════════════════════════════════════════════════════
  // GOOGLE AI STUDIO / VERTEX AI — 多模態模型
  // ═══════════════════════════════════════════════════════════

  "gemini/imagen-4": {
    modelId: "gemini/imagen-4",
    label: "Imagen 4 (AI Studio)",
    provider: "gemini",
    category: "text-to-image",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每張圖片",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/imagen-4": {
    modelId: "vertex/imagen-4",
    label: "Imagen 4 (Vertex)",
    provider: "vertex",
    category: "text-to-image",
    tier: "premium",
    basePoints: 6,
    baseCostUsd: 0.06,
    unit: "每張圖片",
    minPoints: 6,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "gemini/veo-3-fast": {
    modelId: "gemini/veo-3-fast",
    label: "Veo 3 Fast (AI Studio)",
    provider: "gemini",
    category: "text-to-video",
    tier: "premium",
    basePoints: 30,
    baseCostUsd: 0.30,
    unit: "每5秒",
    pointsPerSecond: 6,
    minPoints: 30,
    maxPoints: 300,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/veo-2": {
    modelId: "vertex/veo-2",
    label: "Veo 2 (Vertex)",
    provider: "vertex",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 40,
    baseCostUsd: 0.40,
    unit: "每5秒",
    pointsPerSecond: 8,
    minPoints: 40,
    maxPoints: 400,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "vertex/veo-3": {
    modelId: "vertex/veo-3",
    label: "Veo 3 (Vertex)",
    provider: "vertex",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 55,
    baseCostUsd: 0.55,
    unit: "每5秒",
    pointsPerSecond: 11,
    minPoints: 55,
    maxPoints: 550,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    availabilityNote: "Preview 版本",
  },
  "gemini/lyria-3": {
    modelId: "gemini/lyria-3",
    label: "Lyria 3 (AI Studio)",
    provider: "gemini",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    minPoints: 10,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/lyria-2": {
    modelId: "vertex/lyria-2",
    label: "Lyria 2 (Vertex)",
    provider: "vertex",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.10,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    minPoints: 10,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "gemini-1.5-flash": {
    modelId: "gemini-1.5-flash",
    label: "Gemini 1.5 Flash",
    provider: "gemini",
    category: "reasoning",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.003,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
  },
  "vertex/gemini-1.5-pro": {
    modelId: "vertex/gemini-1.5-pro",
    label: "Vertex Gemini 1.5 Pro",
    provider: "vertex",
    category: "reasoning",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次推理",
    pointsPer1kChars: 3,
    minPoints: 1,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  "vertex/gemini-1.5-flash": {
    modelId: "vertex/gemini-1.5-flash",
    label: "Vertex Gemini 1.5 Flash",
    provider: "vertex",
    category: "reasoning",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },

  // ═══════════════════════════════════════════════════════════
  // 新增模型（main 分支引入的 ENGINE_FALLBACK_CHAIN / falDispatcher 模型）
  // ═══════════════════════════════════════════════════════════

  // ── 圖像引擎 ──
  "fal-ai/nano-banana-2": {
    modelId: "fal-ai/nano-banana-2",
    label: "Nano Banana 2",
    provider: "fal",
    category: "text-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每張圖片",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/nano-banana-pro": {
    modelId: "fal-ai/nano-banana-pro",
    label: "Nano Banana Pro",
    provider: "fal",
    category: "text-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每張圖片",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/imagen4/preview": {
    modelId: "fal-ai/imagen4/preview",
    label: "Imagen 4 Preview (fal)",
    provider: "fal",
    category: "text-to-image",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每張圖片",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/fast-sdxl": {
    modelId: "fal-ai/fast-sdxl",
    label: "Fast SDXL",
    provider: "fal",
    category: "text-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每張圖片",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-diffusion-v35-large": {
    modelId: "fal-ai/stable-diffusion-v35-large",
    label: "SD 3.5 Large",
    provider: "fal",
    category: "text-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每張圖片",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ── 影片引擎 ──
  "fal-ai/wan/v2.2-14b": {
    modelId: "fal-ai/wan/v2.2-14b",
    label: "WAN V2.2 14B",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 15,
    baseCostUsd: 0.15,
    unit: "每5秒",
    pointsPerSecond: 3,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/veo3": {
    modelId: "fal-ai/veo3",
    label: "Veo 3 (fal)",
    provider: "fal",
    category: "text-to-video",
    tier: "premium",
    basePoints: 40,
    baseCostUsd: 0.40,
    unit: "每5秒",
    pointsPerSecond: 8,
    minPoints: 40,
    maxPoints: 400,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/pixverse/v4.5/image-to-video": {
    modelId: "fal-ai/pixverse/v4.5/image-to-video",
    label: "PixVerse V4.5 I2V",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.20,
    unit: "每5秒",
    pointsPerSecond: 4,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ── 音樂引擎 ──
  "fal-ai/sonauto": {
    modelId: "fal-ai/sonauto",
    label: "SonAuto 音樂生成",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每首",
    minPoints: 5,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ── 語音引擎 ──
  "fal-ai/elevenlabs/tts/turbo-v2.5": {
    modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
    label: "ElevenLabs TTS Turbo V2.5 (via fal)",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次合成",
    minPoints: 3,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": {
    modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    label: "Qwen 3 TTS 1.7B",
    provider: "fal",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次合成",
    minPoints: 2,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dia-tts/voice-clone": {
    modelId: "fal-ai/dia-tts/voice-clone",
    label: "Dia TTS Voice Clone",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次合成",
    minPoints: 3,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ── falDispatcher 新增模型 ──
  "fal-ai/nemotron/asr/stream": {
    modelId: "fal-ai/nemotron/asr/stream",
    label: "Nemotron ASR Stream",
    provider: "fal",
    category: "audio-to-text",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次辨識",
    minPoints: 2,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/trellis-2": {
    modelId: "fal-ai/trellis-2",
    label: "Trellis 2 (3D)",
    provider: "fal",
    category: "image-to-3d",
    tier: "standard",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次生成",
    minPoints: 5,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // ── MiniMax M2.7 via NVIDIA NIM（光球 AI 代理人推理引擎）──
  "minimaxai/minimax-m2.7": {
    modelId: "minimaxai/minimax-m2.7",
    label: "MiniMax M2.7 (NVIDIA NIM)",
    provider: "nvidia",
    category: "llm",
    tier: "standard",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次呼叫",
    minPoints: 1,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "NVIDA_API",
  },
};

// ─── Pricing Utilities ────────────────────────────────────────────────────────

/**
 * 計算生成點數（考慮時長/字符數/圖片數/步驟數）
 */
export function estimatePoints(
  modelId: string,
  params: {
    durationSec?: number;       // 影片/音頻時長（秒）
    charCount?: number;          // 文字字符數
    imageCount?: number;         // 圖片張數
    trainingSteps?: number;      // 訓練步驟數
  } = {}
): PointsEstimate {
  const pricing = MODEL_PRICING_CATALOG[modelId];

  if (!pricing) {
    // 未知模型：收取標準費用
    return {
      modelId,
      basePoints: 5,
      multipliers: {},
      totalPoints: 5,
      breakdown: "未知模型（標準計費 5 pts）",
    };
  }

  let total = pricing.basePoints;
  const multipliers: Record<string, number> = {};
  const breakdownParts: string[] = [`基礎 ${pricing.basePoints} pts`];

  // 時長計費（影片/音頻）
  if (params.durationSec && pricing.pointsPerSecond) {
    const extra = Math.round(params.durationSec * pricing.pointsPerSecond);
    if (extra > pricing.basePoints) {
      const diff = extra - pricing.basePoints;
      total = extra;
      multipliers.duration = params.durationSec;
      breakdownParts.push(`時長 ${params.durationSec}s × ${pricing.pointsPerSecond} pts/s = ${extra} pts`);
    }
  }

  // 字符數計費（TTS/LLM）
  if (params.charCount && pricing.pointsPer1kChars) {
    const charPoints = Math.ceil((params.charCount / 1000) * pricing.pointsPer1kChars);
    total = Math.max(total, charPoints);
    multipliers.charCount = params.charCount;
    breakdownParts.push(`${params.charCount} 字符 × ${pricing.pointsPer1kChars} pts/1k = ${charPoints} pts`);
  }

  // 批次圖片計費
  if (params.imageCount && params.imageCount > 1 && pricing.pointsPerImage) {
    const imgExtra = pricing.pointsPerImage * (params.imageCount - 1);
    total += imgExtra;
    multipliers.imageCount = params.imageCount;
    breakdownParts.push(`額外 ${params.imageCount - 1} 張 × ${pricing.pointsPerImage} pts = ${imgExtra} pts`);
  }

  // 訓練步驟計費
  if (params.trainingSteps && pricing.pointsPerStep) {
    const stepPoints = Math.round(params.trainingSteps * pricing.pointsPerStep);
    total += stepPoints;
    multipliers.trainingSteps = params.trainingSteps;
    breakdownParts.push(`${params.trainingSteps} 步驟 × ${pricing.pointsPerStep} pts/步 = ${stepPoints} pts`);
  }

  // 套用上下限
  total = Math.max(pricing.minPoints, Math.min(pricing.maxPoints, total));

  return {
    modelId,
    basePoints: pricing.basePoints,
    multipliers,
    totalPoints: total,
    breakdown: breakdownParts.join(" + "),
  };
}

/**
 * 取得模型定價資訊（若無則返回預設）
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  return MODEL_PRICING_CATALOG[modelId] ?? null;
}

/**
 * 驗證 API Key 是否可用
 */
export function checkModelAvailability(modelId: string): {
  available: boolean;
  reason?: string;
} {
  const pricing = MODEL_PRICING_CATALOG[modelId];
  if (!pricing) return { available: false, reason: "模型不在目錄中" };
  if (!pricing.requiresKey) return { available: true };

  const keyEnv = pricing.keyEnvVar;
  if (!keyEnv) return { available: true };

  const keyValue = process.env[keyEnv];
  if (!keyValue || keyValue.trim() === "") {
    return {
      available: false,
      reason: `需要設定環境變數 ${keyEnv}`,
    };
  }

  return { available: true };
}

/**
 * 取得四模態的預設模型與點數費率摘要
 */
export function getModalityPricingSummary(brainConfig: {
  imageEngine: string;
  videoEngine: string;
  audioEngine: string;
  voiceEngine: string;
}): Record<string, { modelId: string; label: string; pointsRange: string; available: boolean }> {
  const entries = Object.entries(brainConfig) as Array<[string, string]>;
  const result: Record<string, { modelId: string; label: string; pointsRange: string; available: boolean }> = {};

  for (const [slot, modelId] of entries) {
    const p = MODEL_PRICING_CATALOG[modelId];
    const avail = checkModelAvailability(modelId);
    result[slot] = {
      modelId,
      label: p?.label ?? modelId,
      pointsRange: p
        ? p.pointsPerSecond
          ? `${p.minPoints}–${p.maxPoints} pts/次`
          : `${p.minPoints} pts/次`
        : "5 pts/次",
      available: avail.available,
    };
  }

  return result;
}

/**
 * 點數換算 USD（方便顯示）
 */
export function pointsToUsd(points: number): string {
  return `$${(points / 100).toFixed(3)}`;
}

/**
 * 所有模型按分類的費率摘要（供 UI 展示）
 */
export function getAllPricingByCategory(): Record<ModelCategory, ModelPricing[]> {
  const result = {} as Record<ModelCategory, ModelPricing[]>;
  for (const p of Object.values(MODEL_PRICING_CATALOG)) {
    if (!result[p.category]) result[p.category] = [];
    result[p.category].push(p);
  }
  // Sort each category by basePoints ascending
  for (const cat of Object.keys(result) as ModelCategory[]) {
    result[cat].sort((a, b) => a.basePoints - b.basePoints);
  }
  return result;
}
