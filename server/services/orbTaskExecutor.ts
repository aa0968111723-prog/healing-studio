import { bootstrapAiAdapters } from "./ai-adapters/bootstrap";
import { getAdapter } from "./ai-adapters/registry";

const DEFAULT_FAL_IMAGE_MODEL = "fal-ai/bytedance/seedream/v4/text-to-image";

function pickImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.image_url === "string" && record.image_url) return record.image_url;
  if (Array.isArray(record.images) && record.images.length > 0) {
    const first = record.images[0] as Record<string, unknown>;
    if (first && typeof first.url === "string" && first.url) return first.url;
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (data && typeof data.image_url === "string" && data.image_url) return data.image_url;
  return null;
}

export async function executeGenerateImage(
  userId: string,
  prompt: string,
  model?: string
): Promise<string> {
  if (!userId?.trim()) throw new Error("userId is required");
  if (!prompt?.trim()) throw new Error("prompt is required");

  bootstrapAiAdapters();
  const fal = getAdapter("fal_ai");
  const modelId = model?.trim() || DEFAULT_FAL_IMAGE_MODEL;
  const response = await fal.proxy({
    pathWithQuery: `${modelId}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Orb-User-Id": userId,
    },
    body: JSON.stringify({ prompt: prompt.trim() }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`FAL generate image failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as unknown;
  const imageUrl = pickImageUrl(json);
  if (!imageUrl) throw new Error("FAL response missing image url");
  return imageUrl;
}

// ── Unified multi-modal task executor ────────────────────────────────────────

import {
  DEFAULT_FAL_ENGINES,
  dispatchAudioGeneration,
  dispatchImageGeneration,
  dispatchVideoGeneration,
} from "./falDispatcher";
import { dualEmitForUser } from "../generationEvents";

export type OrbExecutableTask = {
  type: "generate_image" | "generate_music" | "generate_video";
  params: Record<string, unknown>;
};

function pickResultUrl(data: Record<string, unknown>): string | null {
  const directKeys = ["url", "imageUrl", "videoUrl", "audioUrl", "output_url"];
  for (const key of directKeys) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  const nestedArrays = ["images", "videos", "audios"];
  for (const key of nestedArrays) {
    const arr = data[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const first = arr[0];
    if (typeof first === "string" && first.trim()) return first;
    if (first && typeof first === "object") {
      const c = (first as Record<string, unknown>).url;
      if (typeof c === "string" && c.trim()) return c;
    }
  }
  return null;
}

export async function executeOrbTask(userId: number, task: OrbExecutableTask): Promise<string> {
  const prompt = String(task.params.prompt ?? "").trim();
  if (!prompt) throw new Error("execute_task 缺少 prompt");

  let resultData: Record<string, unknown>;
  if (task.type === "generate_image") {
    const result = await dispatchImageGeneration({
      modelId: String(task.params.modelId ?? DEFAULT_FAL_ENGINES.textToImage),
      prompt,
      negativePrompt: typeof task.params.negativePrompt === "string" ? task.params.negativePrompt : undefined,
      imageUrl: typeof task.params.imageUrl === "string" ? task.params.imageUrl : undefined,
    });
    if (!result.success) throw new Error(result.error || "圖片生成失敗");
    resultData = result.data;
  } else if (task.type === "generate_video") {
    const result = await dispatchVideoGeneration({
      modelId: String(task.params.modelId ?? DEFAULT_FAL_ENGINES.textToVideo),
      prompt,
      imageUrl: typeof task.params.imageUrl === "string" ? task.params.imageUrl : undefined,
      negativePrompt: typeof task.params.negativePrompt === "string" ? task.params.negativePrompt : undefined,
    });
    if (!result.success) throw new Error(result.error || "影片生成失敗");
    resultData = result.data;
  } else {
    const result = await dispatchAudioGeneration({
      modelId: String(task.params.modelId ?? DEFAULT_FAL_ENGINES.textToAudio),
      prompt,
    });
    if (!result.success) throw new Error(result.error || "音樂生成失敗");
    resultData = result.data;
  }

  const url = pickResultUrl(resultData);
  if (!url) throw new Error("生成完成但找不到結果 URL");

  dualEmitForUser(userId, {
    type: "progress",
    progress: 100,
    message: `orb_task_complete:${task.type}`,
  });
  dualEmitForUser(userId, {
    type: "complete",
    thoughtChain: [],
  });

  return url;
}
