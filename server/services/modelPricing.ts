/**
 * modelPricing.ts — 全模型成本定價 & 點數換算規則
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 設計原則：
 *  1. 以「平台積分（Points）」為計費單位
 *  2. 換算基準：1 USD ≈ 100 Points（方便理解，數字整）
 *  3. 每個模型的 pointCost 按真實 API 成本按比例計算
 *  4. 免費模型 = 1 Point（平台基礎運算成本）
 *  5. 超出範圍的參數（時長、字符、批次）按加乘額外計費
 *
 * 計費公式（加法 baseline + 超量加收）：
 *  totalPoints = basePoints
 *              + max(0, durationSec − freeSecondsInBase) × pointsPerSecond
 *              + ceil(charCount / 1000) × pointsPer1kChars
 *              + max(0, imageCount − 1) × pointsPerImage
 *              + trainingSteps × pointsPerStep
 *  最後 clamp 到 [minPoints, maxPoints]。
 *
 *  - basePoints 已含 freeSecondsInBase 秒 baseline，不會再被同一段時長重複收費。
 *  - 沒有 freeSecondsInBase 的條目視為 0（純加法）。
 *
 * 參考真實成本（2025 Q2，basePoints 對應 baseCostUsd × 100）：
 *  - Flux Pro 1.1 : ~$0.04/image  → 4 pts
 *  - Kling V2.1 Std: ~$0.30/5s    → 30 pts (5s base)
 *  - ElevenLabs V3: ~$0.18/1kchar → 18 pts/1k（catalog 採平台補貼價 4 pts/1k）
 *  - Gemini Imagen3: ~$0.04/image → 4 pts
 *  - Gemini Veo2   : ~$0.35/5s    → 35 pts (5s base)
 *  - Flux Schnell  : ~$0.003/image→ 1 pt  (min 1)
 *  - Whisper       : ~$0.006/min  → 1 pt/min (60s base)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PricingTier = "free" | "economy" | "standard" | "premium" | "ultra";
export type ModelCategory =
  | "audio-to-text"
  | "image-to-3d"
  | "image-to-image"
  | "image-to-json"
  | "image-to-video"
  | "json"
  | "llm"
  | "text-to-3d"
  | "text-to-audio"
  | "text-to-image"
  | "text-to-json"
  | "text-to-speech"
  | "text-to-video"
  | "training"
  | "video-to-audio"
  | "video-to-text"
  | "video-to-video"
  | "reasoning"
  | "embedding";

export interface ModelPricing {
  modelId: string;
  label: string;
  provider:
    | "fal"
    | "gemini"
    | "vertex"
    | "elevenlabs"
    | "suno"
    | "openai"
    | "anthropic"
    | "nvidia"
    | "openrouter";
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

  /**
   * basePoints 已包含的時長 baseline（秒）。例如 Kling V2.1 Standard 的
   * basePoints=30 對應「5 秒 baseline」，freeSecondsInBase=5，這樣
   * estimatePoints 才不會把同樣 5 秒再用 pointsPerSecond 加一次（雙倍計費）。
   * 沒設定（或設成 0）= 純加法，basePoints 是純啟動費。
   */
  freeSecondsInBase?: number;

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
  "fal-ai/seedvr/upscale/image": {
    modelId: "fal-ai/seedvr/upscale/image",
    label: "SeedVR Upscale",
    provider: "fal",
    category: "image-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次放大",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/dwpose": {
    modelId: "fal-ai/dwpose",
    label: "DWPose 骨骼偵測",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次偵測",
    minPoints: 1,
    maxPoints: 3,
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
    basePoints: 49, // 5s base
    baseCostUsd: 0.49,
    unit: "每5秒",
    pointsPerSecond: 9.8,
    freeSecondsInBase: 5,
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
    basePoints: 30, // 5s base — Standard 比 Pro 便宜
    baseCostUsd: 0.3,
    unit: "每5秒",
    pointsPerSecond: 6,
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.3,
    unit: "每5秒",
    pointsPerSecond: 6,
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.2,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    freeSecondsInBase: 6,
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
    baseCostUsd: 0.3,
    unit: "每5秒",
    pointsPerSecond: 6,
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 6,
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.5,
    unit: "每5秒",
    pointsPerSecond: 10,
    freeSecondsInBase: 5,
    minPoints: 50,
    maxPoints: 500,
    requiresKey: true,
    keyEnvVar: "GEMINI_API_KEY",
    availabilityNote: "Preview 版本，需申請存取",
  },
  // 補：videoStudio.ts soraTextToVideo 實際呼叫的 ID
  "fal-ai/sora": {
    modelId: "fal-ai/sora",
    label: "OpenAI Sora t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "ultra",
    basePoints: 60,
    baseCostUsd: 0.6,
    unit: "每5秒",
    pointsPerSecond: 12,
    minPoints: 60,
    maxPoints: 600,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
    availabilityNote: "Sora 在 fal.ai 可用性不穩，會自動降級到 LTX/Kling",
  },
  // 補：videoStudio.ts ltxTextToVideo 實際呼叫的 ID
  "fal-ai/ltx-video-13b-distilled": {
    modelId: "fal-ai/ltx-video-13b-distilled",
    label: "LTX Video 13B Distilled t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 18,
    baseCostUsd: 0.18,
    unit: "每5秒",
    pointsPerSecond: 3.6,
    minPoints: 18,
    maxPoints: 180,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：videoStudio.ts minimaxTextToVideo 實際呼叫的 ID（Hailuo 02 Pro）
  "fal-ai/minimax/hailuo-02/pro/text-to-video": {
    modelId: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    label: "MiniMax Hailuo 02 Pro t2v",
    provider: "fal",
    category: "text-to-video",
    tier: "premium",
    basePoints: 28,
    baseCostUsd: 0.28,
    unit: "每6秒",
    pointsPerSecond: 4.7,
    minPoints: 28,
    maxPoints: 280,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：UI VideoStudio.tsx:1053 使用的 Wan 720p t2v 命名
  "fal-ai/wan-ai/wan2.1-t2v-720p": {
    modelId: "fal-ai/wan-ai/wan2.1-t2v-720p",
    label: "WAN 2.1 720p t2v (alias)",
    provider: "fal",
    category: "text-to-video",
    tier: "standard",
    basePoints: 18,
    baseCostUsd: 0.18,
    unit: "每5秒",
    pointsPerSecond: 3.6,
    minPoints: 18,
    maxPoints: 180,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
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
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.4,
    unit: "每5秒",
    pointsPerSecond: 8,
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 1, // 25幀 ≈ 1s baseline
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
    freeSecondsInBase: 6,
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
    freeSecondsInBase: 5,
    minPoints: 32,
    maxPoints: 320,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：videoStudio.ts runwayImageToVideo 實際呼叫的 gen4 ID
  "fal-ai/runway-gen4-turbo/image-to-video": {
    modelId: "fal-ai/runway-gen4-turbo/image-to-video",
    label: "Runway Gen4 Turbo i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "ultra",
    basePoints: 50,
    baseCostUsd: 0.5,
    unit: "每5秒",
    pointsPerSecond: 10,
    minPoints: 50,
    maxPoints: 500,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：videoStudio.ts minimaxImageToVideo 實際呼叫的 Hailuo 02 i2v
  "fal-ai/minimax/hailuo-02/pro/image-to-video": {
    modelId: "fal-ai/minimax/hailuo-02/pro/image-to-video",
    label: "MiniMax Hailuo 02 Pro i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 30,
    baseCostUsd: 0.3,
    unit: "每6秒",
    pointsPerSecond: 5,
    minPoints: 30,
    maxPoints: 300,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：videoStudio.ts ltxImageToVideo 實際呼叫的 ID
  "fal-ai/ltx-video/image-to-video": {
    modelId: "fal-ai/ltx-video/image-to-video",
    label: "LTX Video i2v",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 20,
    baseCostUsd: 0.2,
    unit: "每5秒",
    pointsPerSecond: 4,
    minPoints: 20,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：UI VideoStudio.tsx:1753 使用的 Wan 720p i2v 命名
  "fal-ai/wan-ai/wan2.1-i2v-720p": {
    modelId: "fal-ai/wan-ai/wan2.1-i2v-720p",
    label: "WAN 2.1 720p i2v (alias)",
    provider: "fal",
    category: "image-to-video",
    tier: "standard",
    basePoints: 22,
    baseCostUsd: 0.22,
    unit: "每5秒",
    pointsPerSecond: 4.4,
    minPoints: 22,
    maxPoints: 220,
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
    freeSecondsInBase: 30,
    minPoints: 5,
    maxPoints: 60,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // DEF-A2：fal-ai/audioldm2 endpoint 已被 fal.ai 下架，dispatcher 端會
  // normalize 到 fal-ai/mmaudio-v2 實際送單。此 pricing 條目保留作為
  // 上游（proStudio.chargeForFalTask / director.estimatePoints）在 normalize
  // 之前的 lookup fallback，且數值與 mmaudio-v2 對齊，避免兩個 modelId
  // 同一交付下出現計費差異。
  "fal-ai/audioldm2": {
    modelId: "fal-ai/audioldm2",
    label: "AudioLDM 2 (→ MMAudio V2)",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每15秒",
    pointsPerSecond: 0.27,
    freeSecondsInBase: 15,
    minPoints: 4,
    maxPoints: 40,
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
    freeSecondsInBase: 15,
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
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 15,
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
    baseCostUsd: 0.1,
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
    freeSecondsInBase: 30,
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
    baseCostUsd: 0.1,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    freeSecondsInBase: 30,
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
  // DEF-EL6：fal canonical 路徑（含 /v2）必須有獨立 pricing 條目，否則
  // dispatcher 在 normalize 後 getModelPricing 會回 null，cost reconciliation
  // 無法對帳。數值與 elevenlabs/sound-effects 對齊（同一交付）。
  "fal-ai/elevenlabs/sound-effects/v2": {
    modelId: "fal-ai/elevenlabs/sound-effects/v2",
    label: "ElevenLabs SFX v2 (via fal)",
    provider: "fal",
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
  "fal-ai/f5-tts": {
    modelId: "fal-ai/f5-tts",
    label: "F5-TTS",
    provider: "fal" as const,
    category: "text-to-speech" as const,
    tier: "standard" as const,
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每1000字符",
    pointsPer1kChars: 2,
    minPoints: 1,
    maxPoints: 60,
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
    baseCostUsd: 0.1,
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
    baseCostUsd: 0.2,
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
    freeSecondsInBase: 30,
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
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.1,
    unit: "每分鐘影片",
    pointsPerSecond: 0.17,
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 5,
    minPoints: 15,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // 補：videoStudio.ts wanVideoToVideo 真實呼叫的 ID（之前只有 alias `fal-ai/wan-v2v`）
  "fal-ai/wan/v2.1/video-to-video": {
    modelId: "fal-ai/wan/v2.1/video-to-video",
    label: "WAN 2.1 V2V",
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
  // 補：UI VideoStudio.tsx:2237 使用的 Wan 480p v2v 命名
  "fal-ai/wan-ai/wan2.1-v2v-480p": {
    modelId: "fal-ai/wan-ai/wan2.1-v2v-480p",
    label: "WAN 2.1 480p V2V (alias)",
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
  // 補：UI VideoStudio.tsx:2306 使用的 Kling V1.6 v2v
  "fal-ai/kling-video/v1.6/standard/video-to-video": {
    modelId: "fal-ai/kling-video/v1.6/standard/video-to-video",
    label: "Kling V1.6 Standard V2V",
    provider: "fal",
    category: "video-to-video",
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
  // 補：videoStudio.ts animateDiff control 路由實際呼叫的 ID
  "fal-ai/animatediff-v2v": {
    modelId: "fal-ai/animatediff-v2v",
    label: "AnimateDiff V2V (進階控制)",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 18,
    baseCostUsd: 0.18,
    unit: "每5秒",
    pointsPerSecond: 3.6,
    minPoints: 18,
    maxPoints: 180,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // ── 畫質優化（enhance）：videoStudio.ts videoUpscale / frameInterpolation / topazEnhance 真實呼叫 ──
  "fal-ai/bytedance/upscaler/video": {
    modelId: "fal-ai/bytedance/upscaler/video",
    label: "ByteDance 影片超解析（2x/4x）",
    provider: "fal",
    category: "video-to-video",
    tier: "premium",
    basePoints: 25,
    baseCostUsd: 0.25,
    unit: "每分鐘影片",
    pointsPerSecond: 0.42,
    minPoints: 25,
    maxPoints: 250,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/rife-v4.6/video": {
    modelId: "fal-ai/rife-v4.6/video",
    label: "RIFE v4.6 補幀",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每分鐘影片",
    pointsPerSecond: 0.13,
    minPoints: 8,
    maxPoints: 80,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/topaz/video-enhance": {
    modelId: "fal-ai/topaz/video-enhance",
    label: "Topaz Video Enhance AI",
    provider: "fal",
    category: "video-to-video",
    tier: "ultra",
    basePoints: 40,
    baseCostUsd: 0.4,
    unit: "每分鐘影片",
    pointsPerSecond: 0.67,
    minPoints: 40,
    maxPoints: 600,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  // ── 進階控制（control）：videoStudio.ts camMaster / depthCrafter / viduReferenceToVideo 真實呼叫 ──
  "fal-ai/cammaster": {
    modelId: "fal-ai/cammaster",
    label: "CamMaster 鏡頭運動控制",
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
  "fal-ai/depthcrafter": {
    modelId: "fal-ai/depthcrafter",
    label: "DepthCrafter 深度感知",
    provider: "fal",
    category: "video-to-video",
    tier: "standard",
    basePoints: 22,
    baseCostUsd: 0.22,
    unit: "每分鐘影片",
    pointsPerSecond: 0.37,
    minPoints: 22,
    maxPoints: 220,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/vidu/q1/reference-to-video": {
    modelId: "fal-ai/vidu/q1/reference-to-video",
    label: "Vidu Q1 Reference-to-Video",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 30,
    baseCostUsd: 0.3,
    unit: "每5秒",
    pointsPerSecond: 6,
    minPoints: 30,
    maxPoints: 300,
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
    baseCostUsd: 0.2,
    unit: "每分鐘影片",
    pointsPerSecond: 0.33,
    freeSecondsInBase: 60,
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.2,
    unit: "每5秒",
    pointsPerSecond: 4,
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.2,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    freeSecondsInBase: 6,
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
    baseCostUsd: 0.2,
    unit: "每6秒",
    pointsPerSecond: 3.3,
    freeSecondsInBase: 6,
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
    baseCostUsd: 2.0,
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
    baseCostUsd: 2.5,
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
    baseCostUsd: 3.0,
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
    baseCostUsd: 1.5,
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
    baseCostUsd: 5.0,
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
    baseCostUsd: 4.0,
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
    baseCostUsd: 2.5,
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
    baseCostUsd: 1.0,
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
  // ── OpenRouter Unified Gateway 推理模型 ──
  "google/gemini-2.5-pro": {
    modelId: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次推理",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 120,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "google/gemini-2.5-flash": {
    modelId: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "standard",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "anthropic/claude-sonnet-4.5": {
    modelId: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5 (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次推理",
    pointsPer1kChars: 5,
    minPoints: 2,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "anthropic/claude-opus-4.7": {
    modelId: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7 (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "ultra",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每次推理",
    pointsPer1kChars: 12,
    minPoints: 4,
    maxPoints: 400,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "anthropic/claude-haiku-4.5": {
    modelId: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5 (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "standard",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "minimax/minimax-m2": {
    modelId: "minimax/minimax-m2",
    label: "MiniMax M2 (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "standard",
    basePoints: 1,
    baseCostUsd: 0.005,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "mistralai/mistral-nemo": {
    modelId: "mistralai/mistral-nemo",
    label: "Mistral NeMo (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.003,
    unit: "每次推理",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "meta-llama/llama-3.1-405b-instruct": {
    modelId: "meta-llama/llama-3.1-405b-instruct",
    label: "Llama 3.1 405B (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次推理",
    pointsPer1kChars: 5,
    minPoints: 2,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
  },
  "meta-llama/llama-3.2-90b-vision-instruct": {
    modelId: "meta-llama/llama-3.2-90b-vision-instruct",
    label: "Llama 3.2 90B Vision (OpenRouter)",
    provider: "openrouter",
    category: "reasoning",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次推理",
    pointsPer1kChars: 4,
    minPoints: 2,
    maxPoints: 120,
    requiresKey: true,
    keyEnvVar: "OPENROUTER_API_KEY",
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
    baseCostUsd: 0.3,
    unit: "每5秒",
    pointsPerSecond: 6,
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.4,
    unit: "每5秒",
    pointsPerSecond: 8,
    freeSecondsInBase: 5,
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.1,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    freeSecondsInBase: 30,
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
    baseCostUsd: 0.1,
    unit: "每30秒",
    pointsPerSecond: 0.33,
    freeSecondsInBase: 30,
    minPoints: 10,
    maxPoints: 100,
    requiresKey: true,
    keyEnvVar: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  },
  // (Legacy Gemini 1.5 / Vertex Gemini 1.5 entries removed —
  //  fallback policy auto-remaps these to gemini-2.5-* / google/gemini-2.5-*)

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
  "fal-ai/bytedance/seedream/v4/text-to-image": {
    modelId: "fal-ai/bytedance/seedream/v4/text-to-image",
    label: "SeeDream v4",
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

  // ── 圖片編輯（image-to-image / 語意式 edit）── 對應 ImageStudio edit 9 模型
  "fal-ai/nano-banana-pro/edit": {
    modelId: "fal-ai/nano-banana-pro/edit",
    label: "Nano Banana Pro Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次編輯",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/nano-banana/edit": {
    modelId: "fal-ai/nano-banana/edit",
    label: "Nano Banana Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次編輯",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/nano-banana-2/edit": {
    modelId: "fal-ai/nano-banana-2/edit",
    label: "Nano Banana 2 Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次編輯",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/bytedance/seedream/v4.5/edit": {
    modelId: "fal-ai/bytedance/seedream/v4.5/edit",
    label: "SeeDream v4.5 Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次編輯",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/bytedance/seedream/v5/lite/edit": {
    modelId: "fal-ai/bytedance/seedream/v5/lite/edit",
    label: "SeeDream v5 Lite Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次編輯",
    minPoints: 1,
    maxPoints: 5,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "xai/grok-imagine-image/edit": {
    modelId: "xai/grok-imagine-image/edit",
    label: "Grok Imagine Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "standard",
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每次編輯",
    minPoints: 2,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/gpt-image-1.5/edit": {
    modelId: "fal-ai/gpt-image-1.5/edit",
    label: "GPT Image 1.5 Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次編輯",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/flux-pro/kontext": {
    modelId: "fal-ai/flux-pro/kontext",
    label: "FLUX Kontext Pro",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次編輯",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/flux-2-pro/edit": {
    modelId: "fal-ai/flux-2-pro/edit",
    label: "FLUX 2 Pro Edit",
    provider: "fal",
    category: "image-to-image",
    tier: "premium",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次編輯",
    minPoints: 4,
    maxPoints: 20,
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
  "fal-ai/lora": {
    modelId: "fal-ai/lora",
    label: "SD + LoRA",
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
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.4,
    unit: "每5秒",
    pointsPerSecond: 8,
    freeSecondsInBase: 5,
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
    baseCostUsd: 0.2,
    unit: "每5秒",
    pointsPerSecond: 4,
    freeSecondsInBase: 5,
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
  // DEF-So1：Sonauto 真實 fal endpoint。dispatcher 經 normalize 後查的就是這個 key。
  // 與 fal-ai/sonauto 對齊（每首 5 pts，無時長維度）。
  "sonauto/v2/text-to-music": {
    modelId: "sonauto/v2/text-to-music",
    label: "Sonauto v2",
    provider: "fal",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每首",
    minPoints: 5,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },

  // ── 語音引擎 ──
  // DEF-V4：與上游 elevenlabs/turbo-v2.5（pricing key, line 990）對齊 maxPoints=50。
  // 兩個 entry 是同一交付（fal proxy），過去 30 vs 50 的差導致 dispatcher
  // reconciliation 與 chargeForFalTask 對同一筆使用估算出不同上限。
  // requiresKey 改為 ELEVENLABS_API_KEY（fal proxy 必要），與 SFX 對齊。
  "fal-ai/elevenlabs/tts/turbo-v2.5": {
    modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
    label: "ElevenLabs TTS Turbo V2.5 (via fal)",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
    maxPoints: 50,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/qwen-3-tts/text-to-speech/1.7b": {
    modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    label: "Qwen 3 TTS 1.7B",
    provider: "fal",
    category: "text-to-speech",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每1000字符",
    pointsPer1kChars: 1,
    minPoints: 1,
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
    basePoints: 2,
    baseCostUsd: 0.02,
    unit: "每1000字符",
    pointsPer1kChars: 2,
    minPoints: 2,
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

  // ── ProStudio 音訊處理 / 聲音克隆 / Avatar 模型 ──
  "fal-ai/qwen-3-tts/clone-voice/1.7b": {
    modelId: "fal-ai/qwen-3-tts/clone-voice/1.7b",
    label: "Qwen 3 TTS Clone Voice",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次克隆",
    minPoints: 4,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/qwen-3-tts/voice-design/1.7b": {
    modelId: "fal-ai/qwen-3-tts/voice-design/1.7b",
    label: "Qwen 3 TTS Voice Design",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次設計",
    minPoints: 3,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/kling-video/create-voice": {
    modelId: "fal-ai/kling-video/create-voice",
    label: "Kling Create Voice",
    provider: "fal",
    category: "text-to-speech",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次建立",
    minPoints: 3,
    maxPoints: 15,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/elevenlabs/voice-cloning": {
    modelId: "fal-ai/elevenlabs/voice-cloning",
    label: "ElevenLabs Instant Voice Clone",
    provider: "fal",
    category: "text-to-speech",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每次克隆",
    minPoints: 8,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/demucs": {
    modelId: "fal-ai/demucs",
    label: "Demucs 音幹分離",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次分離",
    minPoints: 4,
    maxPoints: 30,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/elevenlabs/audio-isolation": {
    modelId: "fal-ai/elevenlabs/audio-isolation",
    label: "ElevenLabs Audio Isolation",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 3,
    baseCostUsd: 0.03,
    unit: "每次處理",
    minPoints: 3,
    maxPoints: 20,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/ffmpeg-api/merge-audios": {
    modelId: "fal-ai/ffmpeg-api/merge-audios",
    label: "FFmpeg Merge Audios",
    provider: "fal",
    category: "text-to-audio",
    tier: "economy",
    basePoints: 1,
    baseCostUsd: 0.01,
    unit: "每次合併",
    minPoints: 1,
    maxPoints: 10,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/elevenlabs/voice-changer": {
    modelId: "fal-ai/elevenlabs/voice-changer",
    label: "ElevenLabs Voice Changer",
    provider: "fal",
    category: "text-to-audio",
    tier: "standard",
    basePoints: 4,
    baseCostUsd: 0.04,
    unit: "每次變聲",
    minPoints: 4,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/wan/v2.2-14b/speech-to-video": {
    modelId: "fal-ai/wan/v2.2-14b/speech-to-video",
    label: "Wan 2.2 Speech-to-Video",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每段影片",
    pointsPerSecond: 1.5,
    minPoints: 12,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/echomimic-v3": {
    modelId: "fal-ai/echomimic-v3",
    label: "EchoMimic v3",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.1,
    unit: "每段影片",
    pointsPerSecond: 1.2,
    minPoints: 10,
    maxPoints: 150,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/stable-avatar": {
    modelId: "fal-ai/stable-avatar",
    label: "Stable Avatar",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每段影片",
    pointsPerSecond: 1.4,
    minPoints: 12,
    maxPoints: 250,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/elevenlabs/dubbing": {
    modelId: "fal-ai/elevenlabs/dubbing",
    label: "ElevenLabs Dubbing",
    provider: "fal",
    category: "text-to-audio",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每段配音",
    pointsPerSecond: 0.8,
    minPoints: 8,
    maxPoints: 200,
    requiresKey: true,
    keyEnvVar: "ELEVENLABS_API_KEY",
  },
  "fal-ai/longcat-single-avatar/audio-to-video": {
    modelId: "fal-ai/longcat-single-avatar/audio-to-video",
    label: "LongCat Avatar Audio-to-Video",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 12,
    baseCostUsd: 0.12,
    unit: "每段影片",
    pointsPerSecond: 1.3,
    minPoints: 12,
    maxPoints: 250,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/ltx-2-19b/distilled/audio-to-video/lora": {
    modelId: "fal-ai/ltx-2-19b/distilled/audio-to-video/lora",
    label: "LTX-2 19B Audio-to-Video",
    provider: "fal",
    category: "image-to-video",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.1,
    unit: "每段影片",
    pointsPerSecond: 1.0,
    minPoints: 10,
    maxPoints: 180,
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
  "fal-ai/sam-3/3d-objects": {
    modelId: "fal-ai/sam-3/3d-objects",
    label: "SAM 3D Objects",
    provider: "fal",
    category: "image-to-3d",
    tier: "premium",
    basePoints: 5,
    baseCostUsd: 0.05,
    unit: "每次重建",
    minPoints: 5,
    maxPoints: 25,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/hunyuan3d-v3/image-to-3d": {
    modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
    label: "Hunyuan 3D v3",
    provider: "fal",
    category: "image-to-3d",
    tier: "premium",
    basePoints: 8,
    baseCostUsd: 0.08,
    unit: "每次生成",
    minPoints: 8,
    maxPoints: 40,
    requiresKey: true,
    keyEnvVar: "FAL_API_KEY",
  },
  "fal-ai/hunyuan_world/image-to-world": {
    modelId: "fal-ai/hunyuan_world/image-to-world",
    label: "Hunyuan World",
    provider: "fal",
    category: "image-to-3d",
    tier: "premium",
    basePoints: 10,
    baseCostUsd: 0.1,
    unit: "每次生成",
    minPoints: 10,
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
    keyEnvVar: "NVIDIA_API",
  },
};

// ─── Pricing Utilities ────────────────────────────────────────────────────────

/**
 * 計算生成點數（考慮時長/字符數/圖片數/步驟數）
 */
export function estimatePoints(
  modelId: string,
  params: {
    durationSec?: number; // 影片/音頻時長（秒）
    charCount?: number; // 文字字符數
    imageCount?: number; // 圖片張數
    trainingSteps?: number; // 訓練步驟數
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

  const asPositiveNumber = (value: number | undefined): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return value > 0 ? value : 0;
  };

  let total = pricing.basePoints;
  const multipliers: Record<string, number> = {};
  const breakdownParts: string[] = [`基礎 ${pricing.basePoints} pts`];

  // 時長計費（影片/音頻）— 扣掉 basePoints 已包含的 baseline 秒數，避免雙倍計費
  const durationSec = asPositiveNumber(params.durationSec);
  if (durationSec > 0 && pricing.pointsPerSecond) {
    const freeSec = Math.max(0, pricing.freeSecondsInBase ?? 0);
    const billableSec = Math.max(0, durationSec - freeSec);
    const extra = Math.round(billableSec * pricing.pointsPerSecond);
    if (extra > 0) {
      total += extra;
      multipliers.duration = durationSec;
      breakdownParts.push(
        freeSec > 0
          ? `時長加收 (${durationSec}s − 含 ${freeSec}s 起跳) × ${pricing.pointsPerSecond} pts/s = +${extra} pts`
          : `時長加收 ${durationSec}s × ${pricing.pointsPerSecond} pts/s = +${extra} pts`
      );
    }
  }

  // 字符數計費（TTS/LLM）
  const charCount = asPositiveNumber(params.charCount);
  if (charCount > 0 && pricing.pointsPer1kChars) {
    const charPoints = Math.ceil((charCount / 1000) * pricing.pointsPer1kChars);
    total += charPoints;
    multipliers.charCount = charCount;
    breakdownParts.push(
      `字符加收 ${charCount} 字符 × ${pricing.pointsPer1kChars} pts/1k = +${charPoints} pts`
    );
  }

  // 批次圖片計費
  const imageCount = asPositiveNumber(params.imageCount);
  if (imageCount > 1 && pricing.pointsPerImage) {
    const imgExtra = pricing.pointsPerImage * (imageCount - 1);
    total += imgExtra;
    multipliers.imageCount = imageCount;
    breakdownParts.push(
      `批次加收 額外 ${imageCount - 1} 張 × ${pricing.pointsPerImage} pts = +${imgExtra} pts`
    );
  }

  // 訓練步驟計費
  const trainingSteps = asPositiveNumber(params.trainingSteps);
  if (trainingSteps > 0 && pricing.pointsPerStep) {
    const stepPoints = Math.round(trainingSteps * pricing.pointsPerStep);
    total += stepPoints;
    multipliers.trainingSteps = trainingSteps;
    breakdownParts.push(
      `步驟加收 ${trainingSteps} 步驟 × ${pricing.pointsPerStep} pts/步 = +${stepPoints} pts`
    );
  }

  // 套用上下限
  const unclampedTotal = total;
  total = Math.max(pricing.minPoints, Math.min(pricing.maxPoints, unclampedTotal));
  if (total !== unclampedTotal) {
    if (total === pricing.maxPoints) {
      breakdownParts.push(`封頂上限 ${pricing.maxPoints} pts`);
    } else if (total === pricing.minPoints) {
      breakdownParts.push(`補足最低 ${pricing.minPoints} pts`);
    }
  }

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

export function calculateActualCost(params: {
  modelId: string;
  billingSeconds?: number;
  outputImages?: number;
  outputVideoDuration?: number;
}): number {
  const pricing = MODEL_PRICING_CATALOG[params.modelId];
  if (!pricing) return estimatePoints(params.modelId).totalPoints;

  const billingSeconds = Math.max(0, params.billingSeconds ?? 0);
  const outputImages = Math.max(0, params.outputImages ?? 0);
  const outputVideoDuration = Math.max(0, params.outputVideoDuration ?? 0);

  const freeSec = Math.max(0, pricing.freeSecondsInBase ?? 0);

  if (billingSeconds > 0 && pricing.pointsPerSecond) {
    const billable = Math.max(0, billingSeconds - freeSec);
    const total = Math.round(pricing.basePoints + billable * pricing.pointsPerSecond);
    return Math.max(pricing.minPoints, Math.min(pricing.maxPoints, total));
  }

  if (outputVideoDuration > 0 && pricing.pointsPerSecond) {
    const billable = Math.max(0, outputVideoDuration - freeSec);
    const total = Math.round(pricing.basePoints + billable * pricing.pointsPerSecond);
    return Math.max(pricing.minPoints, Math.min(pricing.maxPoints, total));
  }

  if (outputImages > 0) {
    if (pricing.pointsPerImage) {
      const total = pricing.basePoints + Math.max(0, outputImages - 1) * pricing.pointsPerImage;
      return Math.max(pricing.minPoints, Math.min(pricing.maxPoints, total));
    }
    const total = pricing.basePoints * outputImages;
    return Math.max(pricing.minPoints, Math.min(pricing.maxPoints, total));
  }

  return estimatePoints(params.modelId).totalPoints;
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
}): Record<
  string,
  { modelId: string; label: string; pointsRange: string; available: boolean }
> {
  const entries = Object.entries(brainConfig) as Array<[string, string]>;
  const result: Record<
    string,
    { modelId: string; label: string; pointsRange: string; available: boolean }
  > = {};

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
export function getAllPricingByCategory(): Record<
  ModelCategory,
  ModelPricing[]
> {
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
