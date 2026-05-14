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

  let result: FalDispatchResult;
  switch (modality) {
    case "image": {
      result = await dispatchImageGeneration({
        modelId,
        prompt,
        imageUrl: params.image_url as string | undefined,
        negativePrompt: params.negative_prompt as string | undefined,
        seed: params.seed as number | undefined,
        aspectRatio: params.aspect_ratio as string | undefined,
        imageSize: params.image_size as string | undefined,
      });
      break;
    }
    case "video": {
      result = await dispatchVideoGeneration({
        modelId,
        prompt,
        imageUrl: params.image_url as string | undefined,
        negativePrompt: params.negative_prompt as string | undefined,
        durationSec: params.duration as number | undefined,
        aspectRatio: params.aspect_ratio as string | undefined,
        seed: params.seed as number | undefined,
      });
      break;
    }
    case "audio": {
      result = await dispatchAudioGeneration({
        modelId,
        prompt,
        durationSec: params.duration as number | undefined,
        seed: params.seed as number | undefined,
      });
      break;
    }
    case "voice": {
      result = await dispatchTTS({
        modelId,
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
