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
