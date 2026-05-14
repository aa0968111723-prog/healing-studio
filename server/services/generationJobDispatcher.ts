/**
 * server/services/generationJobDispatcher.ts
 *
 * Thin façade the spirit specialist tools (image / video / music / voice)
 * import as `await import("../generationJobDispatcher")`. Routes the
 * single-call API used by those tools to the modality-specific helpers in
 * `./falDispatcher`. The face is intentionally minimal — anything that
 * needs more knobs should call falDispatcher directly.
 */

import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  type FalDispatchResult,
} from "./falDispatcher";
import { normalizeEngineModelId } from "../../shared/engineModelIds";

export type GenerationModality = "image" | "video" | "audio" | "voice";

export interface DispatchGenerationJobInput {
  userId: number;
  modality: GenerationModality;
  prompt: string;
  modelId: string;
  params?: Record<string, unknown>;
}

export interface DispatchGenerationJobResult {
  jobId: string;
  modality: GenerationModality;
  modelId: string;
  raw: FalDispatchResult;
}

/**
 * Spirit-tool friendly aliases → canonical `fal-ai/…` model IDs.
 *
 * The specialist spirit tools (image / video / voice / music) advertise
 * human-friendly model IDs in their `getXxxModels()` lists (e.g.
 * `"flux-1.1-pro"`, `"hailu-video"`, `"qwen-tts"`) so users / LLMs can
 * pick them without memorising fal's slug tree. `dispatchFalTask`
 * rejects anything that doesn't start with `fal-ai/`, so this façade has
 * to resolve those aliases before invoking the dispatcher. Mappings
 * outside this table fall through to `normalizeEngineModelId` (legacy
 * `fal/*` aliases) and finally to the raw value.
 *
 * Video aliases that need t2v / i2v split based on `imageUrl` are
 * resolved per-modality below — keep both variants here so the picker
 * stays explicit instead of branching deep in the switch.
 */
const SPIRIT_TOOL_FAL_ALIAS: Record<string, string> = {
  // Image
  "flux-1.1-pro": "fal-ai/flux-pro/v1.1",
  "clarity-upscaler": "fal-ai/clarity-upscaler",
  // Video (text→video default; i2v handled below)
  "hailu-video": "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "wav2lip": "fal-ai/sync-lipsync",
  // Music / audio
  "suno-v4": "fal-ai/sonauto",
  "audio-craft": "fal-ai/musicgen",
  // Voice / TTS
  "qwen-tts": "fal-ai/qwen-3-tts/text-to-speech/1.7b",
};

/** Image-to-video variants for video aliases when imageUrl is supplied. */
const SPIRIT_TOOL_FAL_I2V_ALIAS: Record<string, string> = {
  "hailu-video": "fal-ai/minimax/hailuo-02/pro/image-to-video",
};

function resolveModelId(modelId: string, opts: { imageToVideo?: boolean } = {}): string {
  if (opts.imageToVideo) {
    const i2v = SPIRIT_TOOL_FAL_I2V_ALIAS[modelId];
    if (i2v) return i2v;
  }
  const aliased = SPIRIT_TOOL_FAL_ALIAS[modelId];
  if (aliased) return aliased;
  // Fall through to the legacy `fal/*` → `fal-ai/*` table; if neither
  // table knows the value, return it untouched and let the dispatcher
  // raise its own clear "must start with fal-ai/" error.
  return normalizeEngineModelId(modelId);
}

function extractJobId(result: FalDispatchResult): string {
  // Fal queue results land the request id under data.request_id; sync calls
  // land it under data.requestId / data.id. Fall back to a stable hash of
  // the payload so callers always have *some* handle to surface to the
  // user, even when fal's response shape drifts.
  const data = result.data ?? {};
  const candidates = [
    (data as { request_id?: unknown }).request_id,
    (data as { requestId?: unknown }).requestId,
    (data as { id?: unknown }).id,
    (data as { job_id?: unknown }).job_id,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return `fal_${Date.now()}_${result.modelId.replace(/[^a-z0-9-]/gi, "")}`;
}

export async function dispatchGenerationJob(
  input: DispatchGenerationJobInput
): Promise<DispatchGenerationJobResult> {
  const { modality, modelId, prompt, params = {} } = input;
  const imageUrl = params.image_url as string | undefined;

  let result: FalDispatchResult;
  switch (modality) {
    case "image": {
      result = await dispatchImageGeneration({
        modelId: resolveModelId(modelId),
        prompt,
        imageUrl,
        negativePrompt: params.negative_prompt as string | undefined,
        seed: params.seed as number | undefined,
        aspectRatio: params.aspect_ratio as string | undefined,
        imageSize: params.image_size as string | undefined,
      });
      break;
    }
    case "video": {
      result = await dispatchVideoGeneration({
        modelId: resolveModelId(modelId, { imageToVideo: Boolean(imageUrl) }),
        prompt,
        imageUrl,
        negativePrompt: params.negative_prompt as string | undefined,
        durationSec: params.duration as number | undefined,
        aspectRatio: params.aspect_ratio as string | undefined,
        seed: params.seed as number | undefined,
      });
      break;
    }
    case "audio": {
      result = await dispatchAudioGeneration({
        modelId: resolveModelId(modelId),
        prompt,
        durationSec: params.duration as number | undefined,
        seed: params.seed as number | undefined,
      });
      break;
    }
    case "voice": {
      result = await dispatchTTS({
        modelId: resolveModelId(modelId),
        text: prompt,
        voiceId: params.voice_id as string | undefined,
        speed: params.speed as number | undefined,
        exaggeration: params.exaggeration as number | undefined,
      });
      break;
    }
    default: {
      const _exhaustive: never = modality;
      throw new Error(`Unsupported modality: ${String(_exhaustive)}`);
    }
  }

  if (!result.success) {
    throw new Error(result.error ?? `${modality} generation failed`);
  }

  return {
    jobId: extractJobId(result),
    modality,
    modelId: result.modelId,
    raw: result,
  };
}
