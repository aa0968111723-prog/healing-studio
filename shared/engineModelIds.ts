/**
 * Legacy model aliases -> canonical model IDs.
 * Keep this map shared between server/router validation and client payload shaping.
 */
export const LEGACY_FAL_ALIAS_MAP: Record<string, string> = {
  "fal/flux-pro-1.1": "fal-ai/flux-pro/v1.1",
  "fal/flux-dev": "fal-ai/flux/dev",
  "fal/flux-schnell": "fal-ai/flux/schnell",
  "fal/sd3-medium": "fal-ai/stable-diffusion-v3-medium",
  "fal/ideogram-v2": "fal-ai/ideogram/v2",
  "fal/aura-flow": "fal-ai/aura-flow",
  "fal/kling-v2.1-pro-t2v": "fal-ai/kling-video/v2.1/pro/text-to-video",
  "fal/minimax-t2v": "fal-ai/minimax-video/text-to-video",
  "fal/luma-dream-machine-t2v": "fal-ai/luma-dream-machine",
  "fal/wan-t2v-v2.1": "fal-ai/wan-t2v",
  "fal/cogvideox-5b-t2v": "fal-ai/cogvideox-5b",
  "fal/kling-v2.1-pro-i2v": "fal-ai/kling-video/v2.1/pro/image-to-video",
  "fal/runway-gen3-i2v": "fal-ai/runway-gen3/turbo/image-to-video",
  "fal/stable-audio": "fal-ai/stable-audio",
  "fal/musicgen": "fal-ai/musicgen",
  "fal/ace-step": "fal-ai/ace-step",
  // DEF-So1：Sonauto 真實 fal 路徑為 sonauto/v2/text-to-music。
  // 大腦組態 / brainAutoRepair / pricing 沿用 "fal-ai/sonauto" 為穩定 ID，
  // 透過此別名於 dispatcher 層轉成 fal 真實 endpoint。
  "fal-ai/sonauto": "sonauto/v2/text-to-music",
  "fal/sonauto": "sonauto/v2/text-to-music",
  // DEF-A1：fal.ai 已移除 fal-ai/audioldm2 endpoint，由 fal-ai/mmaudio-v2 接替
  // （同 latent-diffusion 路線、同 standard tier）。將 audioldm2 系列全部別名
  // 到 mmaudio-v2，避免 dispatcher 因 catalog 找不到而誤降級到 ace-step（音樂模型）。
  "fal-ai/audioldm2": "fal-ai/mmaudio-v2",
  "fal/audioldm2": "fal-ai/mmaudio-v2",
  "fal/audioldm2-v2a": "fal-ai/mmaudio-v2",
  // DEF-EL5：ElevenLabs SFX 真實 fal endpoint 帶 /v2 後綴。falModels catalog
  // 早先註冊的 fal-ai/elevenlabs/sound-effects（無 /v2，且分類錯誤在 video-to-audio）
  // 必須改寫到帶 /v2 的真實 endpoint，避免 dispatcher catalog miss 後降級到 ace-step。
  "fal-ai/elevenlabs/sound-effects": "fal-ai/elevenlabs/sound-effects/v2",
  "fal/playai-tts": "fal-ai/f5-tts",
  "fal/kokoro": "fal-ai/kokoro",
  "fal/orpheus-tts": "fal-ai/orpheus-tts",
  "fal/dia-tts": "fal-ai/dia-tts",
  "fal/triposr": "fal-ai/triposr",
  "fal/zero123plus": "fal-ai/tripo3d",
  "fal/stable-zero123": "fal-ai/tripo3d",
  "fal/mv-adapter": "fal-ai/mv-adapter",
  "fal/flux-dev-i2i": "fal-ai/flux/dev/image-to-image",
  "fal/sd3-medium-i2i": "fal-ai/stable-diffusion-v3-medium/image-to-image",
  "fal/ip-adapter-faceid": "fal-ai/ip-adapter-face-id",
  "fal/controlnet-union": "fal-ai/flux/dev/controlnet",
  "fal/aura-sr": "fal-ai/aura-sr",
  "fal/rembg": "fal-ai/rembg",
  "fal/meshy-4": "fal-ai/trellis",
  "fal/hyper3d-rodin": "fal-ai/hyper3d/rodin",
  "fal/shap-e": "fal-ai/tripo3d",
  "fal/dreamgaussian": "fal-ai/triposr",
  "fal/fantasia3d": "fal-ai/trellis",
  "fal/mmaudio-v2": "fal-ai/mmaudio-v2",
  "fal/stable-audio-v2a": "fal-ai/stable-audio",
  "fal/sync-lipsync": "fal-ai/sync-lipsync",
  "fal/elevenlabs-sound": "fal-ai/elevenlabs/tts/turbo-v2.5",
  // DEF-V5：ElevenLabs TTS short-form → canonical Fal.ai paths。
  // 之前 flash / eleven-v3 / multilingual 全部錯誤導向 turbo-v2.5（同一條別名值
  // 複製貼上的 bug），導致大腦選 Flash 或 V3 都被默默換成 Turbo —
  // 影響 Turbo v2.5 收到本不該屬於它的流量、且其他三家根本進不來。
  "elevenlabs/turbo-v2.5": "fal-ai/elevenlabs/tts/turbo-v2.5",
  "elevenlabs/flash-v2.5": "fal-ai/elevenlabs/tts/flash-v2.5",
  "elevenlabs/eleven-v3": "fal-ai/elevenlabs/tts/eleven-v3",
  "elevenlabs/multilingual-v2": "fal-ai/elevenlabs/tts/multilingual-v2",
  "fal/whisper": "fal-ai/whisper",
  "fal/wizper": "fal-ai/wizper",
  "fal/any-llm-video": "fal-ai/any-llm",
  "fal/llava-next-video": "fal-ai/llava-next",
  "fal/kling-v2.1-v2v": "fal-ai/kling-video/v2.1/standard/video-to-video",
  "fal/wan-v2v": "fal-ai/wan/v2.1/video-to-video",
  "fal/cogvideox-v2v": "fal-ai/cogvideox-5b/video-to-video",
  "fal/topaz-video": "fal-ai/topaz-video",
  "fal/stable-video-upscaler": "fal-ai/stable-video",
  "fal/flux-lora-fast": "fal-ai/flux-lora-fast-training",
  "fal/flux-lora-portrait": "fal-ai/flux-lora-fast-training",
  "fal/dreambooth-flux": "fal-ai/flux-lora-fast-training",
  "fal/sd3-lora": "fal-ai/flux-lora-fast-training",
  "fal/cogvideox-lora": "fal-ai/flux-lora-fast-training",
  // DEF-V12 (2026-05-03 live audit): the codebase used legacy fal IDs that
  // fal has since renamed. runway-gen4-turbo never existed at fal under that
  // ID; gen3/turbo is the canonical i2v endpoint. fal-ai/runway-gen4-turbo
  // /image-to-video → 404 at submit. The alias target (gen3/turbo) IS in
  // both the catalog and pricing, so SSOT consistency holds after the
  // rewrite.
  //
  // Note: fal-ai/rife-v4.6/video deliberately has NO alias here. The
  // canonical-looking fal-ai/rife/v4.6 also returns 200 {detail: "Path
  // /v4.6 not found"} on the result endpoint (i.e. fal removed the video
  // frame-interpolation handler entirely; only the /fal-ai/rife image-pair
  // interpolator remains). Adding an alias would silently bypass the
  // disabled flag on the original entry and route users to another broken
  // endpoint. The catalog `disabled: true` flag does the right thing
  // instead — dispatcher auto-degrades to a working same-category model.
  "fal-ai/runway-gen4-turbo/image-to-video":
    "fal-ai/runway-gen3/turbo/image-to-video",
};

export const normalizeEngineModelId = (value: string): string =>
  LEGACY_FAL_ALIAS_MAP[value] ?? value;

/**
 * DEF-V10：從 fal-ai/elevenlabs/tts/{variant} canonical 路徑回推 ElevenLabs
 * 原生 model_id（fal 反向代理時 body 內的必要欄位）。
 *
 * 對應規則：
 *   fal-ai/elevenlabs/tts/turbo-v2.5      → eleven_turbo_v2_5
 *   fal-ai/elevenlabs/tts/flash-v2.5      → eleven_flash_v2_5
 *   fal-ai/elevenlabs/tts/multilingual-v2 → eleven_multilingual_v2
 *   fal-ai/elevenlabs/tts/eleven-v3       → eleven_v3
 *
 * 給 director / orb 路徑使用，避免他們因為沒帶 model_id 而 fal 落到預設 Turbo。
 * 非 ElevenLabs TTS 路徑回傳 null（呼叫端不應加 model_id 欄位）。
 */
export function nativeElevenLabsModelId(falModelId: string): string | null {
  const m = falModelId.match(/^fal-ai\/elevenlabs\/tts\/(.+)$/);
  if (!m) return null;
  const variant = m[1].replace(/-/g, "_").replace(/\./g, "_");
  return variant.startsWith("eleven_") ? variant : `eleven_${variant}`;
}
