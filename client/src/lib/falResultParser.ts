export type FalJobType = "image" | "video" | "audio" | "voice";

/**
 * Extracts the primary media URL from a raw Fal/Suno background-job resultJson payload.
 * Provider response shapes vary; this centralises all known patterns.
 */
export function extractResultUrl(jobType: FalJobType, raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  if (jobType === "image") {
    const images = r.images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0] as Record<string, unknown>;
      if (typeof first?.url === "string") return first.url;
    }
    const image = r.image as Record<string, unknown> | undefined;
    if (typeof image?.url === "string") return image.url;
  }

  if (jobType === "video") {
    const video = r.video as Record<string, unknown> | undefined;
    if (typeof video?.url === "string") return video.url;
    if (typeof r.video_url === "string") return r.video_url;
  }

  if (jobType === "audio" || jobType === "voice") {
    const audio = r.audio as Record<string, unknown> | undefined;
    if (typeof audio?.url === "string") return audio.url;
    if (typeof r.audio_url === "string") return r.audio_url;
  }

  return undefined;
}
