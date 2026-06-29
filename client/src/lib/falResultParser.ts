/**
 * falResultParser.ts — AIDV-714
 *
 * Type-safe helpers for extracting media URLs from fal.ai / Suno result JSON
 * stored as JSONB in background_jobs.resultJson. Replaces the `as any` clusters
 * in BackgroundTasksPage / ProStudio / VideoStudio.
 */

/**
 * Safely cast an unknown value to a plain object map.
 * Returns null for null, undefined, arrays, and primitives.
 */
export function asRecord(val: unknown): Record<string, unknown> | null {
  if (val !== null && val !== undefined && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, unknown>;
  }
  return null;
}

/**
 * Extract a URL string from a possibly-nested object.
 * Handles: { url: string }, string, null/undefined.
 */
function urlFrom(val: unknown): string | null {
  if (typeof val === "string" && val.length > 0) return val;
  const obj = asRecord(val);
  if (typeof obj?.url === "string" && obj.url.length > 0) return obj.url;
  return null;
}

/**
 * Derive image/video/audio URLs from the result data stored in
 * background_jobs.resultJson["result"] (a fal.ai or Suno payload).
 *
 * @param jobType   Value of background_jobs.jobType ("image"|"video"|"audio"|"voice")
 * @param resultUrl Top-level resultUrl from background_jobs.resultJson.resultUrl
 * @param resultData background_jobs.resultJson.result — the raw fal/Suno payload
 */
export function extractResultUrl(
  jobType: string,
  resultUrl: string | null,
  resultData: Record<string, unknown> | null
): { imageUrl: string | null; videoUrl: string | null; audioUrl: string | null } {
  // Image: fal returns { images: [{url}] } or { image: {url} }
  const images = resultData?.images;
  const firstImage = Array.isArray(images) ? (images as unknown[])[0] : null;

  const imageUrl =
    resultUrl ??
    urlFrom(firstImage) ??
    urlFrom(resultData?.image) ??
    null;

  // Video: fal returns { video: {url} } or { video_url: string }
  const videoUrl =
    (jobType === "video" ? resultUrl : null) ??
    urlFrom(resultData?.video) ??
    (typeof resultData?.video_url === "string" ? resultData.video_url : null) ??
    null;

  // Audio: fal returns { audio: {url} } or { audio_url: string }
  const audioUrl =
    (jobType === "audio" || jobType === "voice" ? resultUrl : null) ??
    urlFrom(resultData?.audio) ??
    (typeof resultData?.audio_url === "string" ? resultData.audio_url : null) ??
    null;

  return { imageUrl, videoUrl, audioUrl };
}
