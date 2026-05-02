/**
 * Unified Fallback Policy
 *
 * 統一管理「降級鏈」(fallback chains)。歷史上 `brainContext.ts` 與
 * `falDispatcher.ts` 各自維護一份,容易在重構時分叉。本模組提供:
 *  - PER_MODEL_FALLBACK: 針對特定 model id 的降級候選(原 ENGINE_FALLBACK_CHAIN)
 *  - PER_CATEGORY_FALLBACK: 針對 Fal 任務分類的降級候選(原 FALLBACK_CHAINS)
 *  - resolveFallbackChain(modelId, category): 統一查詢介面
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. Per-model fallback (原 brainContext.ENGINE_FALLBACK_CHAIN)
// ═══════════════════════════════════════════════════════════════════════════

export const PER_MODEL_FALLBACK: Record<string, string[]> = {
  // 推理大腦(Gemini 模型族)
  "gemini-2.5-pro": [
    "gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4.5",
  ],
  "gemini-2.5-flash": [
    "gemini-2.5-pro",
    "google/gemini-2.5-flash",
    "anthropic/claude-haiku-4.5",
  ],
  // OpenRouter 推理大腦
  "google/gemini-2.5-pro": [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-flash",
    "gemini-2.5-pro",
  ],
  "google/gemini-2.5-flash": [
    "anthropic/claude-haiku-4.5",
    "google/gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
  "anthropic/claude-sonnet-4.5": [
    "google/gemini-2.5-pro",
    "anthropic/claude-haiku-4.5",
    "gemini-2.5-pro",
  ],
  "anthropic/claude-opus-4.7": [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-pro",
    "gemini-2.5-pro",
  ],
  "anthropic/claude-haiku-4.5": [
    "google/gemini-2.5-flash",
    "anthropic/claude-sonnet-4.5",
    "gemini-2.5-flash",
  ],
  "minimax/minimax-m2": ["google/gemini-2.5-flash", "gemini-2.5-flash"],
  "mistralai/mistral-nemo": ["google/gemini-2.5-flash", "gemini-2.5-flash"],
  "meta-llama/llama-3.1-405b-instruct": [
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4.5",
  ],
  "meta-llama/llama-3.2-90b-vision-instruct": [
    "google/gemini-2.5-pro",
    "anthropic/claude-sonnet-4.5",
  ],
  // MiniMax M2.7(NVIDIA NIM 代理人引擎)→ 降級到 Gemini
  "minimaxai/minimax-m2.7": ["gemini-2.5-flash", "gemini-2.5-pro"],
  // OpenAI 模型名稱 → Gemini fallback(向後相容,防止舊設定觸發 404)
  "gpt-4o": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "gpt-4o-mini": ["gemini-2.5-flash"],
  "gpt-3.5-turbo": ["gemini-2.5-flash"],
  "claude-3.5-sonnet": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "claude-3-opus": ["gemini-2.5-pro"],
  "claude-3-haiku": ["gemini-2.5-flash"],
  // Vertex AI 路徑 → 直接 Gemini fallback
  "vertex/gemini-2.5-pro": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "vertex/gemini-2.5-flash": ["gemini-2.5-flash", "gemini-2.5-pro"],
  // 圖像引擎(實際 Fal.ai 模型 ID)
  "fal-ai/flux-pro/v1.1": [
    "fal-ai/fast-sdxl",
    "fal-ai/stable-diffusion-v35-large",
  ],
  "fal-ai/nano-banana-2": ["fal-ai/nano-banana-pro", "fal-ai/flux-pro/v1.1"],
  "fal-ai/nano-banana-pro": ["fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1"],
  "fal-ai/imagen4/preview": ["fal-ai/nano-banana-2", "fal-ai/flux-pro/v1.1"],
  "fal-ai/fast-sdxl": [
    "fal-ai/flux-pro/v1.1",
    "fal-ai/stable-diffusion-v35-large",
  ],
  // 圖片編輯模型 fallback（同系列優先）
  "fal-ai/nano-banana-pro/edit": [
    "fal-ai/nano-banana-2/edit",
    "fal-ai/nano-banana/edit",
    "fal-ai/flux-pro/kontext",
  ],
  "fal-ai/nano-banana-2/edit": [
    "fal-ai/nano-banana-pro/edit",
    "fal-ai/nano-banana/edit",
    "fal-ai/flux-pro/kontext",
  ],
  "fal-ai/nano-banana/edit": [
    "fal-ai/nano-banana-2/edit",
    "fal-ai/nano-banana-pro/edit",
  ],
  "fal-ai/bytedance/seedream/v4.5/edit": [
    "fal-ai/bytedance/seedream/v5/lite/edit",
    "fal-ai/flux-pro/kontext",
  ],
  "fal-ai/bytedance/seedream/v5/lite/edit": [
    "fal-ai/bytedance/seedream/v4.5/edit",
    "fal-ai/flux-pro/kontext",
  ],
  "fal-ai/gpt-image-1.5/edit": [
    "fal-ai/flux-pro/kontext",
    "fal-ai/nano-banana-pro/edit",
  ],
  "fal-ai/flux-pro/kontext": [
    "fal-ai/flux-2-pro/edit",
    "fal-ai/nano-banana-pro/edit",
  ],
  "fal-ai/flux-2-pro/edit": [
    "fal-ai/flux-pro/kontext",
    "fal-ai/nano-banana-pro/edit",
  ],
  // 圖像引擎(向後相容舊別名)
  "flux-pro": ["fal-ai/flux-pro/v1.1", "flux-schnell", "dall-e-3"],
  "flux-schnell": ["flux-pro", "dall-e-3"],
  "dall-e-3": ["flux-pro", "flux-schnell"],
  "stable-diffusion-xl": ["flux-pro", "dall-e-3"],
  // 影片引擎(實際 Fal.ai 模型 ID)
  "fal-ai/kling-video/v2.1/standard/text-to-video": [
    "fal-ai/wan-t2v",
    "fal-ai/minimax-video/text-to-video",
  ],
  "fal-ai/kling-video/v2.1/standard/image-to-video": [
    "fal-ai/minimax-video/image-to-video",
    "fal-ai/pixverse/v4.5/image-to-video",
  ],
  "fal-ai/wan-t2v": [
    "fal-ai/kling-video/v2.1/standard/text-to-video",
    "fal-ai/minimax-video/text-to-video",
  ],
  "fal-ai/veo3": [
    "fal-ai/kling-video/v2.1/standard/text-to-video",
    "fal-ai/wan-t2v",
  ],
  // 影片引擎(向後相容舊別名)
  "kling-v1": [
    "fal-ai/kling-video/v2.1/standard/text-to-video",
    "kling-v1-5",
    "minimax-video",
  ],
  "kling-v1-5": ["kling-v1", "minimax-video"],
  "minimax-video": [
    "fal-ai/minimax-video/text-to-video",
    "kling-v1",
    "kling-v1-5",
  ],
  // 音樂引擎(實際 Fal.ai 模型 ID)
  "fal-ai/ace-step": ["fal-ai/stable-audio", "fal-ai/musicgen"],
  "fal-ai/stable-audio": ["fal-ai/ace-step", "fal-ai/musicgen"],
  // 音樂引擎(向後相容舊別名)
  "suno-v4": ["fal-ai/ace-step", "suno-v3.5", "udio-v1"],
  "suno-v3.5": ["suno-v4", "udio-v1"],
  "udio-v1": ["suno-v4", "suno-v3.5"],
  // 語音引擎(實際 Fal.ai 模型 ID)
  "fal-ai/elevenlabs/tts/turbo-v2.5": [
    "fal-ai/dia-tts",
    "fal-ai/f5-tts",
  ],
  "fal-ai/dia-tts": [
    "fal-ai/elevenlabs/tts/turbo-v2.5",
    "fal-ai/f5-tts",
  ],
  "fal-ai/f5-tts": [
    "fal-ai/elevenlabs/tts/turbo-v2.5",
    "fal-ai/orpheus-tts",
  ],
  // 語音引擎(向後相容舊別名)
  "elevenlabs-v2": [
    "fal-ai/elevenlabs/tts/turbo-v2.5",
    "elevenlabs-v1",
    "azure-tts",
  ],
  "elevenlabs-v1": ["elevenlabs-v2", "azure-tts"],
  "azure-tts": ["elevenlabs-v2", "elevenlabs-v1"],
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. Per-category fallback (原 falDispatcher.FALLBACK_CHAINS)
// ═══════════════════════════════════════════════════════════════════════════

export const PER_CATEGORY_FALLBACK: Record<string, string[]> = {
  "text-to-image": [
    "fal-ai/flux-pro/v1.1",
    "fal-ai/flux/dev",
    "fal-ai/stable-diffusion-v3-medium",
    "fal-ai/flux/schnell",
    "fal-ai/aura-flow",
  ],
  "image-to-image": [
    "fal-ai/flux/dev/image-to-image",
    "fal-ai/stable-diffusion-v3-medium/image-to-image",
    "fal-ai/flux/dev/controlnet",
    "fal-ai/ip-adapter-face-id",
    "fal-ai/aura-sr",
  ],
  "text-to-video": [
    "fal-ai/kling-video/v2.1/pro/text-to-video",
    "fal-ai/kling-video/v2.1/standard/text-to-video",
    "fal-ai/wan-t2v",
    "fal-ai/minimax/hailuo-02/pro/text-to-video",
    "fal-ai/minimax-video/text-to-video",
    "fal-ai/ltx-video-13b-distilled",
    "fal-ai/cogvideox-5b",
  ],
  "image-to-video": [
    "fal-ai/kling-video/v2.1/pro/image-to-video",
    "fal-ai/kling-video/v2.1/standard/image-to-video",
    "fal-ai/runway-gen4-turbo/image-to-video",
    "fal-ai/minimax/hailuo-02/pro/image-to-video",
    "fal-ai/minimax-video/image-to-video",
    "fal-ai/pixverse/v4.5/image-to-video",
    "fal-ai/luma-dream-machine/image-to-video",
    "fal-ai/wan-i2v",
    "fal-ai/ltx-video/image-to-video",
    "fal-ai/stable-video",
    // 進階控制:i2v 變體
    "fal-ai/cammaster",
    "fal-ai/vidu/q1/reference-to-video",
  ],
  "text-to-speech": [
    "fal-ai/f5-tts", // playai-tts Not Found, replaced with f5-tts
    "fal-ai/orpheus-tts",
    "fal-ai/dia-tts",
    "fal-ai/kokoro",
  ],
  "text-to-audio": [
    "fal-ai/ace-step",
    "fal-ai/stable-audio",
    "fal-ai/mmaudio-v2",
    "fal-ai/musicgen",
  ],
  "image-to-3d": ["fal-ai/triposr", "fal-ai/tripo3d", "fal-ai/trellis"],
  "text-to-3d": ["fal-ai/tripo3d", "fal-ai/trellis", "fal-ai/hyper3d/rodin"],
  "video-to-audio": ["fal-ai/mmaudio-v2", "fal-ai/stable-audio"],
  "video-to-text": ["fal-ai/wizper", "fal-ai/whisper"],
  "video-to-video": [
    "fal-ai/kling-video/v2.1/standard/video-to-video",
    "fal-ai/kling-video/v1.6/standard/video-to-video",
    "fal-ai/wan/v2.1/video-to-video",
    "fal-ai/animatediff-v2v",
    "fal-ai/cogvideox-5b/video-to-video",
    "fal-ai/video-to-video",
    // 畫質優化(fallback 對 enhance 類別共用同一池;同類別內降級)
    "fal-ai/topaz/video-enhance",
    "fal-ai/bytedance/upscaler/video",
    "fal-ai/topaz-upscale-video",
    "fal-ai/stable-video-upscaler",
    "fal-ai/rife-v4.6/video",
    // 進階控制:v2v 變體
    "fal-ai/depthcrafter",
  ],
  training: ["fal-ai/flux-lora-fast-training"],
  llm: ["fal-ai/any-llm"],
  json: ["fal-ai/any-llm"],
  "text-to-json": ["fal-ai/any-llm"],
  "image-to-json": ["fal-ai/llava-next", "fal-ai/moondream"],
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. Unified resolver
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 統一查詢一個模型的降級鏈。先看 per-model 覆寫(更精確),缺則退到
 * per-category 名單。回傳已去重的合併陣列(不含 currentModel 自己)。
 */
export function resolveFallbackChain(
  currentModel: string,
  category?: string
): string[] {
  const perModel = PER_MODEL_FALLBACK[currentModel] ?? [];
  const perCategory = category
    ? (PER_CATEGORY_FALLBACK[category] ?? []).filter(
        id => id !== currentModel
      )
    : [];
  if (perModel.length === 0) return perCategory;
  return Array.from(new Set([...perModel, ...perCategory]));
}
