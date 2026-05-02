/**
 * falModels.ts — Fal.ai 16大類模型目錄 + 統一呼叫介面
 *
 * 類別對照：
 *  2-1  影像轉3D       image-to-3d
 *  2-2  影像到影像     image-to-image
 *  2-3  圖像轉JSON    image-to-json
 *  2-4  圖片轉視頻     image-to-video
 *  2-5  JSON           json (structured output)
 *  2-6  大型語言模型   llm
 *  2-7  文字轉3D       text-to-3d
 *  2-8  文字轉音頻     text-to-audio
 *  2-9  文字轉圖像     text-to-image
 *  2-10 文字轉JSON    text-to-json
 *  2-11 文字轉語音     text-to-speech
 *  2-12 文字轉視頻     text-to-video
 *  2-13 訓練           training
 *  2-14 視訊轉音訊    video-to-audio
 *  2-15 影片轉文字     video-to-text
 *  2-16 影片對影片     video-to-video
 */

import { createFalClient } from "@fal-ai/client";

// ─── 模型類別定義 ─────────────────────────────────────────────────────────

export type FalCategory =
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
  | "video-to-video";

export interface FalModelConfig {
  modelId: string; // fal-ai/xxx model ID
  label: string; // 顯示名稱
  category: FalCategory;
  tier: "premium" | "standard" | "fast";
  description: string;
  inputSchema: FalInputSchema;
  outputSchema: FalOutputSchema;
  timeoutMs: number;
}

export interface FalInputSchema {
  prompt?: boolean;
  imageUrl?: boolean;
  videoUrl?: boolean;
  audioUrl?: boolean;
  negativePrompt?: boolean;
  seed?: boolean;
  numInferenceSteps?: boolean;
  guidanceScale?: boolean;
  imageSize?: boolean;
  aspectRatio?: boolean;
  duration?: boolean;
  strength?: boolean; // i2i strength
  loraUrl?: boolean; // lora weights
  loraScale?: boolean;
  numFrames?: boolean;
  fps?: boolean;
  motionBucketId?: boolean;
  condAugmentation?: boolean;
  voiceId?: boolean;
  speed?: boolean;
  exaggeration?: boolean;
  trainingSteps?: boolean;
  learningRate?: boolean;
  stylePrompt?: boolean;
}

export interface FalOutputSchema {
  imageUrl?: boolean;
  images?: boolean;
  videoUrl?: boolean;
  audioUrl?: boolean;
  modelUrl?: boolean;
  objectUrl?: boolean; // 3D object
  text?: boolean;
  json?: boolean;
  seed?: boolean;
}

// ─── 16大類 × 5-6個模型目錄 ───────────────────────────────────────────────

export const FAL_MODEL_CATALOG: Record<FalCategory, FalModelConfig[]> = {
  // ════════════════════════════════════════════════════════
  // 2-0  音訊轉文字  audio-to-text
  // DEF-ASR1：ASR（語音辨識）。modelPricing.ts 早就有 audio-to-text category，
  // 但 falModels.ts 的 FalCategory enum 過去缺，導致 ASR 模型無法在 catalog
  // 註冊。proStudio.speechToText 直接呼叫 falQueueSubmit（不傳 category）僥倖
  // 避開 dispatcher 降級邏輯，但任何透過 dispatcher 帶 category 的路徑會踩
  // catalog miss bug。新增此分類後，nemotron-asr / wizper / whisper 都能由
  // dispatcher 正確認得。
  // ════════════════════════════════════════════════════════
  "audio-to-text": [
    {
      modelId: "fal-ai/nemotron/asr/stream",
      label: "Nemotron ASR Stream",
      category: "audio-to-text",
      tier: "standard",
      description:
        "NVIDIA Nemotron ASR — SSE 串流端點，自動偵測語言（不接 language 參數）",
      inputSchema: { audioUrl: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/wizper",
      label: "Wizper 快速 ASR",
      category: "audio-to-text",
      tier: "fast",
      description: "Wizper 快速語音轉文字（音訊輸入），fal.ai 主流選擇",
      inputSchema: { audioUrl: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/whisper",
      label: "Whisper ASR",
      category: "audio-to-text",
      tier: "standard",
      description: "OpenAI Whisper 多語言 ASR，audio_url 輸入",
      inputSchema: { audioUrl: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 180_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-1  影像轉3D  image-to-3d
  // ════════════════════════════════════════════════════════
  "image-to-3d": [
    {
      modelId: "fal-ai/trellis",
      label: "Trellis 3D",
      category: "image-to-3d",
      tier: "premium",
      description:
        "Trellis 高品質結構化圖片轉3D，支援 GLB/OBJ 輸出（替代 Zero123++）",
      inputSchema: {
        imageUrl: true,
        seed: true,
        numInferenceSteps: true,
      },
      outputSchema: { objectUrl: true, images: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/triposr",
      label: "TripoSR",
      category: "image-to-3d",
      tier: "standard",
      description: "快速單張圖片3D重建",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { objectUrl: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/tripo3d",
      label: "TripoSG (Zero123)",
      category: "image-to-3d",
      tier: "standard",
      description: "TripoSG 高品質單張圖片3D重建（替代 Stable Zero123）",
      inputSchema: { imageUrl: true, seed: true, numInferenceSteps: true },
      outputSchema: { images: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/mv-adapter",
      label: "MV-Adapter",
      category: "image-to-3d",
      tier: "premium",
      description: "多視圖適配器，精確3D重建",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { images: true, objectUrl: true },
      timeoutMs: 300_000,
    },

    // ─── ImageStudio 3D 分頁 4 模型（hyper3d/rodin 在 text-to-3d 區） ──
    {
      modelId: "fal-ai/trellis-2",
      label: "Trellis 2",
      category: "image-to-3d",
      tier: "premium",
      description:
        "Trellis 2 原生 3D 生成，輸出 GLB，電影級幾何與貼圖品質",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { objectUrl: true, modelUrl: true, images: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/sam-3/3d-objects",
      label: "SAM 3D Objects",
      category: "image-to-3d",
      tier: "premium",
      description: "Meta SAM 3D 物件重建，從單張圖片分離出 3D 物件",
      inputSchema: { imageUrl: true },
      outputSchema: { objectUrl: true, images: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
      label: "Hunyuan 3D v3",
      category: "image-to-3d",
      tier: "premium",
      description:
        "騰訊混元 3D v3 電影級 3D 模型生成，支援 Normal / LowPoly / Geometry 多種型態",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { objectUrl: true, modelUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/hunyuan_world/image-to-world",
      label: "Hunyuan World",
      category: "image-to-3d",
      tier: "premium",
      description:
        "騰訊混元 World 圖片轉 3D 世界，從單張圖生成可探索的 3D 場景",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { objectUrl: true, modelUrl: true },
      timeoutMs: 300_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-2  影像到影像  image-to-image
  // ════════════════════════════════════════════════════════
  "image-to-image": [
    {
      modelId: "fal-ai/flux/dev/image-to-image",
      label: "Flux Dev i2i",
      category: "image-to-image",
      tier: "premium",
      description: "Flux Dev 圖像風格轉換，保留結構細節",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        strength: true,
        seed: true,
        numInferenceSteps: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/stable-diffusion-v3-medium/image-to-image",
      label: "SD3 Medium i2i",
      category: "image-to-image",
      tier: "standard",
      description: "Stable Diffusion 3 圖生圖",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        strength: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/ip-adapter-face-id",
      label: "IP-Adapter FaceID",
      category: "image-to-image",
      tier: "premium",
      description: "臉部特徵保留風格遷移",
      inputSchema: { imageUrl: true, prompt: true, strength: true, seed: true },
      outputSchema: { images: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/flux/dev/controlnet",
      label: "Flux ControlNet",
      category: "image-to-image",
      tier: "standard",
      description: "Flux Dev ControlNet 控制網路圖生圖（姿勢/深度/邊緣）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        negativePrompt: true,
        seed: true,
        guidanceScale: true,
      },
      outputSchema: { images: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/aura-sr",
      label: "AuraSR 超解析度",
      category: "image-to-image",
      tier: "fast",
      description: "AI 圖像超解析度增強（4x放大）",
      inputSchema: { imageUrl: true },
      outputSchema: { imageUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/imageutils/rembg",
      label: "RemBG 去背",
      category: "image-to-image",
      tier: "fast",
      description: "AI 智能去除圖片背景",
      inputSchema: { imageUrl: true },
      outputSchema: { imageUrl: true },
      timeoutMs: 30_000,
    },

    // ─── 影像放大（upscale）── 對應 ImageStudio.tsx upscale 分頁
    {
      modelId: "fal-ai/seedvr/upscale/image",
      label: "SeedVR Upscale (ByteDance)",
      category: "image-to-image",
      tier: "standard",
      description:
        "ByteDance SeedVR 影像放大，支援 ×2/×4 倍率或 720p/1080p/1440p/2160p 目標解析度",
      inputSchema: { imageUrl: true, seed: true },
      outputSchema: { imageUrl: true, seed: true },
      timeoutMs: 180_000,
    },

    // ─── 骨骼姿勢偵測（pose）── 對應 ImageStudio.tsx pose 分頁
    // DWPose 為前處理模型：image_url → 骨骼/臉部/手部姿勢圖（可餵 ControlNet）
    {
      modelId: "fal-ai/dwpose",
      label: "DWPose 骨骼姿勢偵測",
      category: "image-to-image",
      tier: "fast",
      description:
        "Mediapipe DWPose 骨骼姿勢偵測，支援 full-pose / body-pose / face-pose / hand-pose 等模式，輸出可作 ControlNet OpenPose 控制圖",
      inputSchema: { imageUrl: true },
      outputSchema: { imageUrl: true },
      timeoutMs: 60_000,
    },

    // ─── 圖片編輯（語意式 edit）── 對應 ImageStudio.tsx edit 分頁 9 模型
    {
      modelId: "fal-ai/nano-banana-pro/edit",
      label: "Nano Banana Pro Edit",
      category: "image-to-image",
      tier: "premium",
      description:
        "Gemini 3 Pro 圖片語意式編輯，支援多達 14 張參考圖融合，無需遮罩",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { images: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/nano-banana/edit",
      label: "Nano Banana Edit",
      category: "image-to-image",
      tier: "fast",
      description: "Gemini 2.0 Flash 快速圖片編輯，多圖融合",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { images: true },
      timeoutMs: 90_000,
    },
    {
      modelId: "fal-ai/nano-banana-2/edit",
      label: "Nano Banana 2 Edit",
      category: "image-to-image",
      tier: "fast",
      description: "Gemini 3.1 Flash 圖片編輯，多圖融合，0.5K-4K 解析度",
      inputSchema: { imageUrl: true, prompt: true, aspectRatio: true },
      outputSchema: { images: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/bytedance/seedream/v4.5/edit",
      label: "SeeDream v4.5 Edit",
      category: "image-to-image",
      tier: "premium",
      description: "ByteDance SeeDream v4.5 高品質語意編輯，支援強度調節",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        strength: true,
        negativePrompt: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/bytedance/seedream/v5/lite/edit",
      label: "SeeDream v5 Lite Edit",
      category: "image-to-image",
      tier: "fast",
      description: "ByteDance SeeDream v5 Lite 輕量快速編輯",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        strength: true,
        negativePrompt: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 90_000,
    },
    {
      modelId: "xai/grok-imagine-image/edit",
      label: "Grok Imagine Edit (xAI)",
      category: "image-to-image",
      tier: "standard",
      description: "xAI Grok 原生多模態圖片編輯，語意理解精確",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { images: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/gpt-image-1.5/edit",
      label: "GPT Image 1.5 Edit (OpenAI)",
      category: "image-to-image",
      tier: "premium",
      description:
        "OpenAI GPT Image 1.5 圖片編輯，可選遮罩，頂尖語意理解與物件保留",
      inputSchema: { imageUrl: true, prompt: true, imageSize: true },
      outputSchema: { images: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/flux-pro/kontext",
      label: "FLUX Kontext Pro",
      category: "image-to-image",
      tier: "premium",
      description:
        "Black Forest Labs FLUX.1 Kontext Pro，精準局部修改與上下文感知編輯",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        guidanceScale: true,
        seed: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/flux-2-pro/edit",
      label: "FLUX 2 Pro Edit",
      category: "image-to-image",
      tier: "premium",
      description: "Black Forest Labs FLUX 2 Pro 高真實感圖片編輯，多參考圖融合",
      inputSchema: { imageUrl: true, prompt: true, seed: true },
      outputSchema: { images: true, seed: true },
      timeoutMs: 180_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-3  圖像轉JSON  image-to-json
  // ════════════════════════════════════════════════════════
  "image-to-json": [
    {
      modelId: "fal-ai/any-llm",
      label: "Any LLM Vision→JSON",
      category: "image-to-json",
      tier: "premium",
      description: "多模態LLM視覺理解輸出結構化JSON",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { json: true, text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/llava-next",
      label: "LLaVA-Next",
      category: "image-to-json",
      tier: "standard",
      description: "視覺語言模型圖像分析",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/moondream",
      label: "Moondream 2",
      category: "image-to-json",
      tier: "fast",
      description: "輕量圖像問答模型",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { text: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/doctr",
      label: "DocTR OCR",
      category: "image-to-json",
      tier: "fast",
      description: "文件OCR文字識別輸出JSON",
      inputSchema: { imageUrl: true },
      outputSchema: { json: true, text: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/sam2",
      label: "SAM2 分割",
      category: "image-to-json",
      tier: "standard",
      description: "圖像語義分割輸出JSON標注",
      inputSchema: { imageUrl: true, prompt: true },
      outputSchema: { json: true, images: true },
      timeoutMs: 60_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-4  圖片轉視頻  image-to-video
  // ════════════════════════════════════════════════════════
  "image-to-video": [
    {
      modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
      label: "Kling V2.1 Pro i2v",
      category: "image-to-video",
      tier: "premium",
      description: "Kling最新版高品質圖生影（5s/10s）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/kling-video/v2.1/standard/image-to-video",
      label: "Kling V2.1 Standard i2v",
      category: "image-to-video",
      tier: "premium",
      description: "Kling V2.1 圖生影（標準版）",
      inputSchema: { imageUrl: true, prompt: true, duration: true, seed: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/runway-gen3/turbo/image-to-video",
      label: "Runway Gen3 Turbo i2v",
      category: "image-to-video",
      tier: "premium",
      description: "Runway Gen-3 Alpha Turbo 圖生影",
      inputSchema: { imageUrl: true, prompt: true, duration: true, seed: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/stable-video",
      label: "Stable Video Diffusion",
      category: "image-to-video",
      tier: "standard",
      description: "SVD 圖生影，動態幀數控制",
      inputSchema: {
        imageUrl: true,
        motionBucketId: true,
        condAugmentation: true,
        numFrames: true,
        fps: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/minimax-video/image-to-video",
      label: "MiniMax i2v",
      category: "image-to-video",
      tier: "standard",
      description: "MiniMax Hailuo 圖生影",
      inputSchema: { imageUrl: true, prompt: true, duration: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/luma-dream-machine/image-to-video",
      label: "Luma Dream Machine i2v",
      category: "image-to-video",
      tier: "premium",
      description: "Luma AI 高真實感圖生影",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        aspectRatio: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/wan-i2v",
      label: "WAN I2V 2.1",
      category: "image-to-video",
      tier: "standard",
      description: "WAN 2.1 開源圖生影（720p）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/wan-ai/wan2.1-i2v-720p",
      label: "WAN 2.1 720p i2v",
      category: "image-to-video",
      tier: "standard",
      description: "WAN 2.1 720p 圖生影（前端 UI 命名）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/runway-gen4-turbo/image-to-video",
      label: "Runway Gen4 Turbo i2v",
      category: "image-to-video",
      tier: "premium",
      description: "Runway Gen4 Turbo 圖生影",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/pixverse/v4.5/image-to-video",
      label: "PixVerse V4.5 i2v",
      category: "image-to-video",
      tier: "standard",
      description: "PixVerse 4.5 圖生影（社群短片節奏）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        aspectRatio: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/minimax/hailuo-02/pro/image-to-video",
      label: "MiniMax Hailuo 02 Pro i2v",
      category: "image-to-video",
      tier: "premium",
      description: "MiniMax Hailuo 02 Pro 圖生影",
      inputSchema: { imageUrl: true, prompt: true, duration: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/ltx-video/image-to-video",
      label: "LTX Video i2v",
      category: "image-to-video",
      tier: "standard",
      description: "LTX 開源圖生影",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    // ── 進階控制（control）：i2v 變體 ──
    {
      modelId: "fal-ai/cammaster",
      label: "CamMaster 鏡頭運動控制",
      category: "image-to-video",
      tier: "premium",
      description: "精確鏡頭運動控制（推拉搖移旋轉），基於圖生影",
      inputSchema: { imageUrl: true, prompt: true, duration: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/vidu/q1/reference-to-video",
      label: "Vidu Q1 Reference-to-Video",
      category: "image-to-video",
      tier: "premium",
      description: "Vidu Q1 角色一致性影片生成（最多 3 參考圖）",
      inputSchema: { imageUrl: true, prompt: true, duration: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    // DEF-WAN1：Wan 2.2 Speech-to-Video — 說話人動畫（image + audio → 對嘴影片）。
    // pricing 早就掛在 image-to-video category（line 2906），但 falModels catalog
    // 缺。proStudio.speechToVideo 直接呼叫 falQueueSubmit（不傳 category）僥倖
    // 避開 dispatcher 降級邏輯，但任何 category-aware 路徑會 catalog miss → 降級
    // 到 image-to-video[0] = kling-video/v2.1/pro/image-to-video（純 i2v，無對嘴）。
    // 使用者送靜態頭像 + 配音，期望「對嘴影片」，卻拿到「不對嘴的純動畫」。
    {
      modelId: "fal-ai/wan/v2.2-14b/speech-to-video",
      label: "Wan 2.2 說話人動畫",
      category: "image-to-video",
      tier: "premium",
      description:
        "Wan 2.2 Speech-to-Video — 靜態頭像 + 音訊 → 對嘴說話影片（≈24fps，num_frames 16-200）",
      inputSchema: { imageUrl: true, audioUrl: true, prompt: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 600_000,
    },
    // DEF-EM1：EchoMimic V3 與 Stable Avatar — 兩個 avatar 系列引擎與 Wan 同 pattern：
    // pricing + brainAutoRepair 都認得，但 catalog 缺。差異：EchoMimic 接受 text 模式
    // （image + text → 內含 TTS 的對嘴影片，audio_url 可選），Stable Avatar 是
    // 長片優化（最長 5 分鐘）。三家共用 image-to-video category，光球
    // studio.animateSpeaker 可透過 modelId 切換。
    {
      modelId: "fal-ai/echomimic-v3",
      label: "EchoMimic V3 對嘴",
      category: "image-to-video",
      tier: "premium",
      description:
        "EchoMimic V3 — image + audio（或 text）→ 精準對嘴 + 表情連動，pose_style 0-45 控制動作幅度",
      inputSchema: { imageUrl: true, audioUrl: true, prompt: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 600_000,
    },
    {
      modelId: "fal-ai/stable-avatar",
      label: "Stable Avatar 長片頭像",
      category: "image-to-video",
      tier: "premium",
      description:
        "Stable Avatar — 音訊驅動頭像，最長 5 分鐘長片連續對嘴（適合長 podcast / 課程旁白）",
      inputSchema: { imageUrl: true, audioUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 900_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-5  JSON  structured output generation
  // ════════════════════════════════════════════════════════
  json: [
    {
      modelId: "fal-ai/any-llm",
      label: "Any LLM JSON Mode",
      category: "json",
      tier: "premium",
      description: "多模型JSON結構化輸出路由",
      inputSchema: { prompt: true },
      outputSchema: { json: true, text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/lmstudio",
      label: "LMStudio 本地模型",
      category: "json",
      tier: "fast",
      description: "本地 LMStudio 模型 JSON 輸出",
      inputSchema: { prompt: true },
      outputSchema: { json: true, text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/wizardcoder",
      label: "WizardCoder JSON",
      category: "json",
      tier: "standard",
      description: "程式碼/JSON 生成專用模型",
      inputSchema: { prompt: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/outlines",
      label: "Outlines 結構化生成",
      category: "json",
      tier: "fast",
      description: "保證 Schema 合規的結構化文字生成",
      inputSchema: { prompt: true },
      outputSchema: { json: true },
      timeoutMs: 30_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-6  大型語言模型  LLM
  // ════════════════════════════════════════════════════════
  llm: [
    {
      modelId: "fal-ai/any-llm",
      label: "Any LLM Router",
      category: "llm",
      tier: "premium",
      description: "自動路由到最佳可用LLM（GPT/Claude/Gemini/Llama）",
      inputSchema: { prompt: true },
      outputSchema: { text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/meta-llama/llama-3.2-90b-vision-instruct",
      label: "Llama 3.2 90B Vision",
      category: "llm",
      tier: "premium",
      description: "Meta Llama 3.2 90B 視覺語言模型",
      inputSchema: { prompt: true, imageUrl: true },
      outputSchema: { text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/meta-llama/llama-3.1-8b-instruct",
      label: "Llama 3.1 8B",
      category: "llm",
      tier: "fast",
      description: "Meta Llama 3.1 8B 高速推理",
      inputSchema: { prompt: true },
      outputSchema: { text: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/wizardlm-2-8x22b",
      label: "WizardLM 2 8×22B",
      category: "llm",
      tier: "premium",
      description: "WizardLM 2 混合專家模型",
      inputSchema: { prompt: true },
      outputSchema: { text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/dolphin-2.9.2-qwen2-72b",
      label: "Dolphin Qwen2 72B",
      category: "llm",
      tier: "standard",
      description: "Dolphin 無過濾創意寫作模型",
      inputSchema: { prompt: true },
      outputSchema: { text: true },
      timeoutMs: 60_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-7  文字轉3D  text-to-3d
  // ════════════════════════════════════════════════════════
  "text-to-3d": [
    {
      modelId: "fal-ai/trellis",
      label: "Trellis T23D",
      category: "text-to-3d",
      tier: "standard",
      description: "Trellis 結構化快速3D生成（替代 DreamGaussian）",
      inputSchema: { prompt: true, seed: true },
      outputSchema: { objectUrl: true, images: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/hyper3d/rodin",
      label: "Hyper3D Rodin Pro",
      category: "text-to-3d",
      tier: "premium",
      description:
        "Hyper3D Rodin 高精度文字到3D資產生成（替代 Fantasia3D）",
      inputSchema: { prompt: true, seed: true, numInferenceSteps: true },
      outputSchema: { objectUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/tripo3d",
      label: "TripoSG Pro 3D",
      category: "text-to-3d",
      tier: "premium",
      description:
        "TripoSG 文字到3D高品質生成，支援風格提示與遊戲級資產（替代 Shap-E / Meshy-4）",
      inputSchema: {
        prompt: true,
        stylePrompt: true,
        seed: true,
        numInferenceSteps: true,
      },
      outputSchema: { objectUrl: true },
      timeoutMs: 300_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-8  文字轉音頻  text-to-audio
  // ════════════════════════════════════════════════════════
  "text-to-audio": [
    {
      modelId: "fal-ai/stable-audio",
      label: "Stable Audio",
      category: "text-to-audio",
      tier: "premium",
      description: "Stable Audio 高品質音效生成（可達3分鐘）",
      inputSchema: {
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/mmaudio-v2",
      label: "MMAudio V2",
      category: "text-to-audio",
      tier: "standard",
      description: "MMAudio V2 多模態音頻潛在擴散生成（替代 AudioLDM2）",
      inputSchema: {
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
      },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/ace-step",
      label: "ACE-Step 音樂",
      category: "text-to-audio",
      tier: "premium",
      description: "ACE-Step 高品質音樂生成",
      inputSchema: { prompt: true, duration: true, seed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/musicgen",
      label: "MusicGen",
      category: "text-to-audio",
      tier: "standard",
      description: "Meta MusicGen 文字生成音樂",
      inputSchema: { prompt: true, duration: true, seed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    // DEF-So1：Sonauto v2 — fal endpoint 真實路徑為 sonauto/v2/text-to-music
    // （非 fal-ai/sonauto）。沒有 duration 參數，自動產 1-3 分鐘完整歌曲；
    // 歌詞欄位為 lyrics_prompt（不是 lyrics），tags 是陣列。
    {
      modelId: "sonauto/v2/text-to-music",
      label: "Sonauto v2",
      category: "text-to-audio",
      tier: "premium",
      description: "Sonauto v2 完整歌曲生成（含歌詞、風格 tags，1-3 分鐘）",
      inputSchema: { prompt: true, seed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 240_000,
    },
    // DEF-EL1：ElevenLabs Sound Effects v2 — fal 真實路徑帶 /v2 後綴。
    // 未註冊在 catalog 時 dispatcher 會把任何 SFX 請求降級到 text-to-audio[0]
    // = fal-ai/ace-step（音樂引擎！），導致每次選 ElevenLabs SFX 都默默被換成
    // 音樂。輸入欄位為 { text, duration_seconds, prompt_influence }（與其他
    // SFX 模型用 prompt+seconds_total/duration 不同），且需 ELEVENLABS_API_KEY
    // 經 fal proxy header 認證；最大時長 22 秒。
    {
      modelId: "fal-ai/elevenlabs/sound-effects/v2",
      label: "ElevenLabs SFX v2",
      category: "text-to-audio",
      tier: "standard",
      description: "ElevenLabs Sound Effects v2（最長 22 秒，需 ELEVENLABS_API_KEY）",
      inputSchema: { prompt: true, duration: true, seed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-9  文字轉圖像  text-to-image
  // ════════════════════════════════════════════════════════
  "text-to-image": [
    {
      modelId: "fal-ai/nano-banana-2",
      label: "Nano Banana 2 (Gemini Flash)",
      category: "text-to-image",
      tier: "fast",
      description:
        "Gemini 3.1 Flash 圖像生成，支援多達 14 張參考圖、文字渲染與 0.5K-4K 解析度",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        aspectRatio: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/nano-banana-pro",
      label: "Nano Banana Pro (Gemini Pro)",
      category: "text-to-image",
      tier: "premium",
      description:
        "Gemini 3 Pro 高品質圖像生成，商業授權友善，支援多參考圖與精細語意控制",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        aspectRatio: true,
        negativePrompt: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/bytedance/seedream/v4/text-to-image",
      label: "SeeDream v4 (ByteDance)",
      category: "text-to-image",
      tier: "premium",
      description:
        "ByteDance SeeDream v4 高品質文字生圖，支援中文提示詞與負向提示，擅長東方美學風格",
      inputSchema: {
        prompt: true,
        aspectRatio: true,
        negativePrompt: true,
        seed: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/imagen4/preview",
      label: "Imagen 4 Preview (Google)",
      category: "text-to-image",
      tier: "premium",
      description: "Google Imagen 4 寫實風格圖像生成，超高細節與真實感",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        aspectRatio: true,
        negativePrompt: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/flux-pro/v1.1",
      label: "Flux Pro 1.1",
      category: "text-to-image",
      tier: "premium",
      description: "Flux Pro 最新版旗艦文生圖模型",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/flux/dev",
      label: "Flux Dev",
      category: "text-to-image",
      tier: "premium",
      description: "Flux Dev 開發版高品質生成",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/flux/schnell",
      label: "Flux Schnell",
      category: "text-to-image",
      tier: "fast",
      description: "Flux Schnell 極速生成（4步）",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        numInferenceSteps: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/stable-diffusion-v3-medium",
      label: "SD3 Medium",
      category: "text-to-image",
      tier: "standard",
      description: "Stable Diffusion 3 中型版本",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/stable-diffusion-v35-large",
      label: "SD 3.5 Large",
      category: "text-to-image",
      tier: "premium",
      description:
        "Stable Diffusion 3.5 Large，旗艦級高品質生圖，支援 ControlNet + LoRA + 負向提示",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
        loraUrl: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/fast-sdxl",
      label: "Fast SDXL",
      category: "text-to-image",
      tier: "fast",
      description: "SDXL 快速生圖（4-12 步），支援 LoRA 與多種尺寸",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
        loraUrl: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/lora",
      label: "SD + LoRA",
      category: "text-to-image",
      tier: "standard",
      description: "Stable Diffusion 1.5 + 任意 HuggingFace LoRA，可自訂 trigger word 與 LoRA 強度",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
        loraUrl: true,
        loraScale: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/aura-flow",
      label: "AuraFlow",
      category: "text-to-image",
      tier: "standard",
      description: "AuraFlow 開源高品質生成模型",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
        numInferenceSteps: true,
        guidanceScale: true,
      },
      outputSchema: { images: true, seed: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/ideogram/v2",
      label: "Ideogram V2",
      category: "text-to-image",
      tier: "premium",
      description: "Ideogram V2 精準文字嵌入圖像",
      inputSchema: {
        prompt: true,
        imageSize: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { images: true },
      timeoutMs: 120_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-10 文字轉JSON  text-to-json
  // ════════════════════════════════════════════════════════
  "text-to-json": [
    {
      modelId: "fal-ai/any-llm",
      label: "Any LLM t2json",
      category: "text-to-json",
      tier: "premium",
      description: "多模型路由文字轉結構化JSON",
      inputSchema: { prompt: true },
      outputSchema: { json: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/outlines",
      label: "Outlines t2json",
      category: "text-to-json",
      tier: "fast",
      description: "Schema 約束的結構化輸出",
      inputSchema: { prompt: true },
      outputSchema: { json: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/meta-llama/llama-3.1-8b-instruct",
      label: "Llama 3.1 t2json",
      category: "text-to-json",
      tier: "fast",
      description: "Llama 3.1 快速 JSON 輸出",
      inputSchema: { prompt: true },
      outputSchema: { json: true, text: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/wizardcoder",
      label: "WizardCoder t2json",
      category: "text-to-json",
      tier: "standard",
      description: "程式碼導向JSON結構生成",
      inputSchema: { prompt: true },
      outputSchema: { json: true },
      timeoutMs: 60_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-11 文字轉語音  text-to-speech
  // ════════════════════════════════════════════════════════
  "text-to-speech": [
    {
      modelId: "fal-ai/elevenlabs/tts/multilingual-v2",
      label: "ElevenLabs Multilingual V2",
      category: "text-to-speech",
      tier: "premium",
      description:
        "ElevenLabs Multilingual V2 高品質多語言 TTS（中/英/日/韓/西/法 等 29 語），支援情感與語氣控制",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
      label: "ElevenLabs Turbo V2.5",
      category: "text-to-speech",
      tier: "fast",
      description: "ElevenLabs Turbo V2.5 低延遲多語言 TTS，適合即時互動場景",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 30_000,
    },
    // DEF-V6：ElevenLabs TTS 家族其他兩家原本只有 proStudio.ENGINE_MAP 引用，
    // catalog 完全沒註冊。一旦透過 dispatcher（光球 / 導演 / brain-driven）使用，
    // catalog miss → fallback chain[0] = fal-ai/f5-tts。使用者選 Flash 或 V3 都會
    // 默默被換成 f5-tts。
    {
      modelId: "fal-ai/elevenlabs/tts/flash-v2.5",
      label: "ElevenLabs Flash V2.5",
      category: "text-to-speech",
      tier: "fast",
      description: "ElevenLabs Flash V2.5 超低延遲（~75ms），適合即時對話場景",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/elevenlabs/tts/eleven-v3",
      label: "ElevenLabs Eleven V3",
      category: "text-to-speech",
      tier: "premium",
      description: "ElevenLabs Eleven V3 最強情緒表達與最高品質 TTS",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/metavoice-v1",
      label: "MetaVoice V1",
      category: "text-to-speech",
      tier: "premium",
      description: "高品質逼真語音合成",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/f5-tts",  // playai-tts Not Found → f5-tts
      label: "PlayAI TTS",
      category: "text-to-speech",
      tier: "premium",
      description: "PlayAI 自然語音合成，多語言支援",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    // DEF-D1：Dia voice-clone endpoint 未註冊。dispatcher 對 modelId
    // fal-ai/dia-tts/voice-clone 的請求會 catalog miss → 降級到
    // text-to-speech[0] = fal-ai/f5-tts。光球 / 導演 / 大腦選 Dia 對話克隆
    // 都會被默默換成 f5-tts。
    // ⚠️ 名稱誤導：fal 端 "voice-clone" 實為多說話者對話 TTS（用 [S1]/[S2]
    // 標籤生成不同合成聲音），並非以參考音訊複製真實使用者聲音 —— 故只接受
    // { text }，沒有 audio_url 參數。
    {
      modelId: "fal-ai/dia-tts/voice-clone",
      label: "Dia 多說話者對話 TTS",
      category: "text-to-speech",
      tier: "standard",
      description:
        "Dia 多說話者對話 TTS — 用 [S1]/[S2] 標籤生成多角色合成聲音（非真實聲音克隆）",
      inputSchema: { prompt: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    // DEF-IVC1：ElevenLabs Instant Voice Cloning (IVC) — 上傳 1-3 分鐘參考音訊
    // 在 ElevenLabs 端建立永久 voice_id，後續可在所有 ElevenLabs TTS / dubbing /
    // voice-changer 復用。需 ELEVENLABS_API_KEY 經 fal proxy header 認證。
    // 過去未註冊在 catalog → 大腦/光球選 ElevenLabs IVC 都被默默降級到 f5-tts。
    {
      modelId: "fal-ai/elevenlabs/voice-cloning",
      label: "ElevenLabs Instant Voice Clone",
      category: "text-to-speech",
      tier: "premium",
      description:
        "ElevenLabs IVC — 1-3 分鐘參考音訊建立永久 voice_id，可被全家族 TTS 復用（需 ELEVENLABS_API_KEY）",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    // DEF-DM1：Demucs 音幹分離 — fal endpoint 是 audio-to-audio（音訊輸入、
    // 多軌音訊輸出），但 FalCategory type 沒有 audio-to-audio enum。暫時掛在
    // text-to-audio 下，避免新增 enum 引發大範圍 type 變更；catalog 註冊後
    // dispatcher 對 modelId fal-ai/demucs 不再 miss → 不會降級到 ace-step。
    // proStudio.demucs 直接呼叫 falQueueSubmit（不傳 category）原本繞過了
    // category-aware fallback，但任何透過 dispatcher 帶 category 的路徑（光球 /
    // 導演自動編曲）都會踩 catalog miss bug。
    {
      modelId: "fal-ai/demucs",
      label: "Demucs 音幹分離",
      category: "text-to-audio",
      tier: "standard",
      description:
        "Demucs 音幹分離 — 將歌曲拆解為 4 軌（vocals/drums/bass/other）或 6 軌（+guitar/piano，僅 htdemucs_6s）",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 180_000,
    },
    // DEF-AI1：ElevenLabs Audio Isolation — 與 Demucs 互補：Demucs 拆多軌、
    // Isolation 抽乾淨單軌（去背景噪、保留人聲/語音）。同 audio-to-audio 概念，
    // 同樣為避免 enum 變更掛在 text-to-audio。catalog 過去缺席 → 任何 category-
    // aware 路徑會降級到 ace-step（音樂引擎）。需 ELEVENLABS_API_KEY proxy。
    {
      modelId: "fal-ai/elevenlabs/audio-isolation",
      label: "ElevenLabs 音訊隔離",
      category: "text-to-audio",
      tier: "standard",
      description:
        "ElevenLabs Audio Isolation — 從含背景噪訊的錄音抽出乾淨人聲/語音（需 ELEVENLABS_API_KEY）",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    // DEF-MA1：FFmpeg merge-audios — 多音訊合併（concatenate 序接 / mix 混音）。
    // 是音幹分離 → 替換人聲 → 合回成品工作流的最後一塊拼圖。同 audio-to-audio
    // 概念，掛在 text-to-audio 下避免 FalCategory enum 變更。
    {
      modelId: "fal-ai/ffmpeg-api/merge-audios",
      label: "FFmpeg 多音訊合併",
      category: "text-to-audio",
      tier: "fast",
      description:
        "FFmpeg merge-audios — 將 2-10 段音訊以 concatenate（序接）或 mix（混音）合併成一段",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    // DEF-VCH1：ElevenLabs Voice Changer — 把現有錄音的「聲音」換成另一個 voice_id
    // 但保留原本的語音內容、語速、情緒。與 generateVoice + cloneVoice 三件一組：
    //   - cloneVoice 建立 voice_id（從參考音訊）
    //   - generateVoice 用 voice_id 念新文字
    //   - voiceChanger 用 voice_id 換掉現有錄音的聲音（保留原語氣與時長）
    // 同 audio-to-audio 概念，掛在 text-to-audio 避免 enum 變更。
    {
      modelId: "fal-ai/elevenlabs/voice-changer",
      label: "ElevenLabs 聲音變換",
      category: "text-to-audio",
      tier: "standard",
      description:
        "ElevenLabs Voice Changer — 把錄音的聲音換成指定 voice_id，保留原語速/語氣（需 ELEVENLABS_API_KEY）",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/dia-tts",
      label: "Dia TTS",
      category: "text-to-speech",
      tier: "standard",
      description: "Dia 對話式TTS，自然情感表達",
      inputSchema: {
        prompt: true,
        voiceId: true,
        exaggeration: true,
        speed: true,
      },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/kokoro",
      label: "Kokoro TTS",
      category: "text-to-speech",
      tier: "fast",
      description: "Kokoro 輕量高速 TTS",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 30_000,
    },
    {
      modelId: "fal-ai/orpheus-tts",
      label: "Orpheus TTS",
      category: "text-to-speech",
      tier: "standard",
      description: "Orpheus 情感豐富語音合成",
      inputSchema: { prompt: true, voiceId: true, speed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    // DEF-Q1：Qwen3-TTS 1.7B — 早先只有 pricing/brain-repair 紀錄，沒註冊到
    // FAL_MODEL_CATALOG，因此 dispatcher 對任何 category=text-to-speech 的
    // 請求 + modelId="fal-ai/qwen-3-tts/text-to-speech/1.7b" 都 catalog miss，
    // 自動降級到 fal-ai/f5-tts。光球 / 導演 / 大腦選 Qwen 全部默默被換掉。
    // 欄位形狀與其他 TTS 不同：用 voice（預訓練名稱，如 "Vivian"）或
    // speaker_voice_embedding_file_url，並可選 reference_text + language。
    {
      modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
      label: "Qwen 3 TTS 1.7B",
      category: "text-to-speech",
      tier: "fast",
      description: "Qwen 3 TTS 1.7B — 多語言（中英日韓西法德義葡俄）+ 預訓練聲線/克隆 embedding",
      inputSchema: { prompt: true, voiceId: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/qwen-3-tts/clone-voice/1.7b",
      label: "Qwen 3 Voice Clone",
      category: "text-to-speech",
      tier: "fast",
      description: "Qwen 3 聲音克隆 — 回傳 speaker_voice_embedding，供 qwenTTS 復用",
      inputSchema: { audioUrl: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 90_000,
    },
    {
      modelId: "fal-ai/qwen-3-tts/voice-design/1.7b",
      label: "Qwen 3 Voice Design",
      category: "text-to-speech",
      tier: "fast",
      description: "Qwen 3 文字描述設計語音 — prompt 描述聲線 → embedding",
      inputSchema: { prompt: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 90_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-12 文字轉視頻  text-to-video
  // ════════════════════════════════════════════════════════
  "text-to-video": [
    {
      modelId: "fal-ai/kling-video/v2.1/pro/text-to-video",
      label: "Kling V2.1 Pro t2v",
      category: "text-to-video",
      tier: "premium",
      description: "Kling V2.1 旗艦文生影（5s/10s）",
      inputSchema: {
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/kling-video/v2.1/standard/text-to-video",
      label: "Kling V2.1 Standard t2v",
      category: "text-to-video",
      tier: "premium",
      description: "Kling V2.1 文生影（標準版）",
      inputSchema: {
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/minimax-video/text-to-video",
      label: "MiniMax Hailuo t2v",
      category: "text-to-video",
      tier: "standard",
      description: "MiniMax Hailuo AI 文生影",
      inputSchema: { prompt: true, duration: true, aspectRatio: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/luma-dream-machine",
      label: "Luma Dream Machine t2v",
      category: "text-to-video",
      tier: "premium",
      description: "Luma Dream Machine 高真實感文生影",
      inputSchema: {
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/wan-t2v",
      label: "WAN T2V 2.1",
      category: "text-to-video",
      tier: "standard",
      description: "WAN T2V 高品質開源文生影",
      inputSchema: {
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/cogvideox-5b",
      label: "CogVideoX 5B",
      category: "text-to-video",
      tier: "standard",
      description: "CogVideoX 5B 文生影模型",
      inputSchema: {
        prompt: true,
        duration: true,
        seed: true,
        numInferenceSteps: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/sora",
      label: "OpenAI Sora t2v",
      category: "text-to-video",
      tier: "premium",
      description: "OpenAI Sora 文生影（fal.ai 可用性不穩，自動降級到 LTX/Kling）",
      inputSchema: { prompt: true, aspectRatio: true, duration: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 480_000,
    },
    {
      modelId: "fal-ai/ltx-video-13b-distilled",
      label: "LTX Video 13B Distilled t2v",
      category: "text-to-video",
      tier: "standard",
      description: "LTX 13B 蒸餾版開源文生影",
      inputSchema: {
        prompt: true,
        duration: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/minimax/hailuo-02/pro/text-to-video",
      label: "MiniMax Hailuo 02 Pro t2v",
      category: "text-to-video",
      tier: "premium",
      description: "MiniMax Hailuo 02 Pro 文生影",
      inputSchema: { prompt: true, duration: true, aspectRatio: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/wan-ai/wan2.1-t2v-720p",
      label: "WAN 2.1 720p t2v",
      category: "text-to-video",
      tier: "standard",
      description: "WAN 2.1 720p 文生影（前端 UI 命名）",
      inputSchema: {
        prompt: true,
        duration: true,
        aspectRatio: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/veo3",
      label: "Veo 3 (fal) t2v",
      category: "text-to-video",
      tier: "premium",
      description: "Google Veo 3（fal.ai 代理）：高擬真、可含音訊",
      inputSchema: { prompt: true, duration: true, aspectRatio: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 480_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-13 訓練  training
  // ════════════════════════════════════════════════════════
  training: [
    {
      modelId: "fal-ai/flux-lora-fast-training",
      label: "Flux LoRA 快速訓練",
      category: "training",
      tier: "premium",
      description: "Flux LoRA 快速微調（15分鐘/概念）",
      inputSchema: {
        imageUrl: true,
        prompt: true,
        trainingSteps: true,
        learningRate: true,
      },
      outputSchema: { modelUrl: true },
      timeoutMs: 1_800_000,
    },
    {
      modelId: "fal-ai/flux-lora-portrait-trainer",
      label: "Flux LoRA 人像訓練",
      category: "training",
      tier: "premium",
      description: "Flux LoRA 人像專用訓練器",
      inputSchema: { imageUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 1_800_000,
    },
    {
      modelId: "fal-ai/dreambooth-flux",
      label: "DreamBooth Flux",
      category: "training",
      tier: "premium",
      description: "DreamBooth 個人化概念微調",
      inputSchema: { imageUrl: true, prompt: true, trainingSteps: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 3_600_000,
    },
    {
      modelId: "fal-ai/sd3-lora-training",
      label: "SD3 LoRA 訓練",
      category: "training",
      tier: "standard",
      description: "Stable Diffusion 3 LoRA 微調",
      inputSchema: { imageUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 3_600_000,
    },
    {
      modelId: "fal-ai/cogvideox-lora-training",
      label: "CogVideoX LoRA 訓練",
      category: "training",
      tier: "premium",
      description: "CogVideoX 影片風格LoRA微調",
      inputSchema: { videoUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 3_600_000,
    },
    {
      modelId: "fal-ai/hunyuan-video-lora-training",
      label: "Hunyuan 影片 LoRA 訓練",
      category: "training",
      tier: "premium",
      description: "混元影片 LoRA 微調，支援自動標註與影片風格學習",
      inputSchema: { imageUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 3_600_000,
    },
    {
      modelId: "fal-ai/flux-2-trainer",
      label: "FLUX.2 LoRA 訓練",
      category: "training",
      tier: "premium",
      description: "FLUX.2 模型 LoRA 微調，支援高解析度與多域訓練",
      inputSchema: { imageUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 3_600_000,
    },
    {
      modelId: "fal-ai/turbo-flux-trainer",
      label: "Turbo Flux 快速訓練",
      category: "training",
      tier: "fast",
      description: "極速 Flux LoRA 訓練，效能最佳化版本",
      inputSchema: { imageUrl: true, trainingSteps: true, learningRate: true },
      outputSchema: { modelUrl: true },
      timeoutMs: 1_800_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-14 視訊轉音訊  video-to-audio
  // ════════════════════════════════════════════════════════
  "video-to-audio": [
    {
      modelId: "fal-ai/mmaudio-v2/video-to-audio",
      label: "MMAudio V2 v2a",
      category: "video-to-audio",
      tier: "premium",
      description: "MMAudio 視頻同步音效生成",
      inputSchema: {
        videoUrl: true,
        prompt: true,
        negativePrompt: true,
        seed: true,
      },
      outputSchema: { audioUrl: true, videoUrl: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/stable-audio",
      label: "Stable Audio v2a",
      category: "video-to-audio",
      tier: "standard",
      description: "從影片內容生成配樂音效",
      inputSchema: { videoUrl: true, prompt: true, duration: true, seed: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/sync-lipsync",
      label: "Sync.so Lipsync",
      category: "video-to-audio",
      tier: "premium",
      description: "AI唇形同步音頻對齊",
      inputSchema: { videoUrl: true, audioUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/elevenlabs/sound-effects",
      label: "ElevenLabs 音效",
      category: "video-to-audio",
      tier: "standard",
      description: "ElevenLabs 影片配音效生成",
      inputSchema: { videoUrl: true, prompt: true, duration: true },
      outputSchema: { audioUrl: true },
      timeoutMs: 60_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-15 影片轉文字  video-to-text
  // ════════════════════════════════════════════════════════
  "video-to-text": [
    {
      modelId: "fal-ai/whisper",
      label: "Whisper (影片)",
      category: "video-to-text",
      tier: "standard",
      description: "OpenAI Whisper 影片語音轉文字",
      inputSchema: { videoUrl: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 180_000,
    },
    {
      modelId: "fal-ai/wizper",
      label: "Wizper 快速轉錄",
      category: "video-to-text",
      tier: "fast",
      description: "快速影片字幕轉錄",
      inputSchema: { videoUrl: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/any-llm",
      label: "Any LLM 影片分析",
      category: "video-to-text",
      tier: "premium",
      description: "LLM 多模態影片內容理解分析",
      inputSchema: { videoUrl: true, prompt: true },
      outputSchema: { text: true, json: true },
      timeoutMs: 120_000,
    },
    {
      modelId: "fal-ai/moondream",
      label: "Moondream 影片",
      category: "video-to-text",
      tier: "fast",
      description: "輕量影片幀理解問答",
      inputSchema: { videoUrl: true, prompt: true },
      outputSchema: { text: true },
      timeoutMs: 60_000,
    },
    {
      modelId: "fal-ai/llava-next",
      label: "LLaVA-Next 影片",
      category: "video-to-text",
      tier: "standard",
      description: "LLaVA 視覺語言模型影片分析",
      inputSchema: { videoUrl: true, prompt: true },
      outputSchema: { text: true },
      timeoutMs: 120_000,
    },
  ],

  // ════════════════════════════════════════════════════════
  // 2-16 影片對影片  video-to-video
  // ════════════════════════════════════════════════════════
  "video-to-video": [
    {
      modelId: "fal-ai/kling-video/v2.1/standard/video-to-video",
      label: "Kling V2.1 v2v",
      category: "video-to-video",
      tier: "premium",
      description: "Kling V2.1 影片風格轉換",
      inputSchema: { videoUrl: true, prompt: true, strength: true, seed: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/wan/v2.1/video-to-video",
      label: "WAN V2V",
      category: "video-to-video",
      tier: "standard",
      description: "WAN 影片到影片風格遷移",
      inputSchema: {
        videoUrl: true,
        prompt: true,
        strength: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/cogvideox-5b/video-to-video",
      label: "CogVideoX V2V",
      category: "video-to-video",
      tier: "standard",
      description: "CogVideoX 影片編輯轉換",
      inputSchema: { videoUrl: true, prompt: true, strength: true, seed: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/video-to-video",
      label: "Fal.ai V2V",
      category: "video-to-video",
      tier: "standard",
      description: "Fal.ai 通用影片風格轉換",
      inputSchema: { videoUrl: true, prompt: true, strength: true, seed: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/topaz-upscale-video",
      label: "Topaz 影片超解析度",
      category: "video-to-video",
      tier: "premium",
      description: "Topaz AI 影片品質提升",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 600_000,
    },
    {
      modelId: "fal-ai/stable-video-upscaler",
      label: "SVD 超解析度",
      category: "video-to-video",
      tier: "standard",
      description: "Stable Video Diffusion 影片上採樣",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/wan-ai/wan2.1-v2v-480p",
      label: "WAN 2.1 480p V2V",
      category: "video-to-video",
      tier: "standard",
      description: "WAN 2.1 480p 影片風格化（前端 UI 命名）",
      inputSchema: {
        videoUrl: true,
        prompt: true,
        strength: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/kling-video/v1.6/standard/video-to-video",
      label: "Kling V1.6 Standard V2V",
      category: "video-to-video",
      tier: "premium",
      description: "Kling V1.6 影片重繪（保留向後相容）",
      inputSchema: {
        videoUrl: true,
        prompt: true,
        strength: true,
        guidanceScale: true,
        seed: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/animatediff-v2v",
      label: "AnimateDiff V2V",
      category: "video-to-video",
      tier: "standard",
      description: "AnimateDiff + ControlNet 逐幀姿勢控制",
      inputSchema: {
        videoUrl: true,
        prompt: true,
        seed: true,
        negativePrompt: true,
      },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    // ── 畫質優化（enhance） ──
    {
      modelId: "fal-ai/bytedance/upscaler/video",
      label: "ByteDance 影片超解析",
      category: "video-to-video",
      tier: "premium",
      description: "ByteDance 影片超解析（2x / 4x 放大）",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
    {
      modelId: "fal-ai/rife-v4.6/video",
      label: "RIFE 補幀",
      category: "video-to-video",
      tier: "standard",
      description: "RIFE v4.6 高品質補幀（2x / 4x 幀率提升）",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 240_000,
    },
    {
      modelId: "fal-ai/topaz/video-enhance",
      label: "Topaz Video Enhance",
      category: "video-to-video",
      tier: "premium",
      description: "Topaz 專業降噪 + 超解析（iris / artemis / theia / gaia / nyx）",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 600_000,
    },
    // ── 進階控制：v2v 變體 ──
    {
      modelId: "fal-ai/depthcrafter",
      label: "DepthCrafter 深度感知",
      category: "video-to-video",
      tier: "standard",
      description: "從單目影片重建深度時序，3D 視差效果",
      inputSchema: { videoUrl: true },
      outputSchema: { videoUrl: true },
      timeoutMs: 300_000,
    },
  ],
};

// ─── 便利查詢函數 ──────────────────────────────────────────────────────────

/** 取得某類別所有模型 */
export function getFalModelsByCategory(
  category: FalCategory
): FalModelConfig[] {
  return FAL_MODEL_CATALOG[category] ?? [];
}

/**
 * 依 modelId 查詢模型設定。
 * 可選 category 收窄查詢範圍，避免跨類別 modelId 衝突
 * （例如 fal-ai/trellis 同時存在於 image-to-3d 與 text-to-3d）。
 */
export function getFalModelById(
  modelId: string,
  category?: FalCategory
): FalModelConfig | undefined {
  if (category) {
    return FAL_MODEL_CATALOG[category]?.find(m => m.modelId === modelId);
  }
  for (const models of Object.values(FAL_MODEL_CATALOG)) {
    const found = models.find(m => m.modelId === modelId);
    if (found) return found;
  }
  return undefined;
}

/**
 * 模組載入時的去重保護：在每個類別內檢查 modelId 是否重複。
 * 這個檢查避免「dispatcher 按 modelId 查找會匹配到第一個，
 * 第二條設定永遠不可達」的回歸。
 *
 * 若發現重複，正式環境僅 console.error（不阻斷啟動），
 * 開發/測試環境則拋錯讓問題立即暴露。
 */
export function findDuplicateModelIds(): Array<{
  category: FalCategory;
  modelId: string;
  count: number;
}> {
  const dups: Array<{
    category: FalCategory;
    modelId: string;
    count: number;
  }> = [];
  for (const [category, models] of Object.entries(FAL_MODEL_CATALOG) as Array<
    [FalCategory, FalModelConfig[]]
  >) {
    const counts: Record<string, number> = {};
    for (const m of models) {
      counts[m.modelId] = (counts[m.modelId] ?? 0) + 1;
    }
    for (const modelId of Object.keys(counts)) {
      const count = counts[modelId];
      if (count > 1) dups.push({ category, modelId, count });
    }
  }
  return dups;
}

export function assertNoDuplicateModelIds(): void {
  const dups = findDuplicateModelIds();
  if (dups.length === 0) return;
  const lines = dups
    .map(d => `  - [${d.category}] ${d.modelId} ×${d.count}`)
    .join("\n");
  const message = `FAL_MODEL_CATALOG contains duplicate modelIds within categories (later entries are unreachable via getFalModelById):\n${lines}`;
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === undefined
  ) {
    // 正式環境：僅警告，避免阻斷啟動
    console.error(`[falModels] ${message}`);
  } else {
    throw new Error(message);
  }
}

// 模組載入時自動檢查（開發/測試環境會拋錯）
assertNoDuplicateModelIds();

/** 取得所有類別標籤（繁中） */
export const FAL_CATEGORY_LABELS: Record<FalCategory, string> = {
  "audio-to-text": "音訊轉文字",
  "image-to-3d": "影像轉3D",
  "image-to-image": "影像到影像",
  "image-to-json": "圖像轉JSON",
  "image-to-video": "圖片轉視頻",
  json: "JSON",
  llm: "大型語言模型",
  "text-to-3d": "文字轉3D",
  "text-to-audio": "文字轉音頻",
  "text-to-image": "文字轉圖像",
  "text-to-json": "文字轉JSON",
  "text-to-speech": "文字轉語音",
  "text-to-video": "文字轉視頻",
  training: "訓練",
  "video-to-audio": "視訊轉音訊",
  "video-to-text": "影片轉文字",
  "video-to-video": "影片對影片",
};

// ─── Fal.ai 統一呼叫器 ─────────────────────────────────────────────────────

export interface FalCallInput {
  modelId: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}

export interface FalCallResult {
  data: Record<string, unknown>;
  durationMs: number;
  modelId: string;
}

/**
 * 統一 Fal.ai 模型呼叫介面
 * 支援所有 16 大類模型
 */
export async function callFalModel(
  params: FalCallInput
): Promise<FalCallResult> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY 未設定");

  const client = createFalClient({ credentials: apiKey });
  const start = Date.now();

  const result = await Promise.race([
    client.subscribe(params.modelId, {
      input: params.input,
      logs: false,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Fal.ai 超時：${params.modelId}`)),
        params.timeoutMs ?? 300_000
      )
    ),
  ]);

  return {
    data: (result as any).data ?? result ?? {},
    durationMs: Date.now() - start,
    modelId: params.modelId,
  };
}

/**
 * falQueueSubmitModel — 送出任務到 fal.ai queue，立即回傳 request_id（不等待結果）。
 * 用於背景任務模式：前端收到 request_id 後立刻登錄到 BackgroundTasksContext。
 */
export async function falQueueSubmitModel(
  modelId: string,
  input: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
  webhookUrl?: string
): Promise<{ request_id: string }> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY 未設定");

  const client = createFalClient({ credentials: apiKey });

  // fal-client 的 queue.submit 不直接支援 webhookUrl，需自行帶 ?fal_webhook= query string
  const target = webhookUrl
    ? `${modelId}?fal_webhook=${encodeURIComponent(webhookUrl)}`
    : modelId;

  const status = await client.queue.submit(target as any, {
    input,
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  });

  return { request_id: status.request_id };
}
