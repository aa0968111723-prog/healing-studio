/**
 * server/services/falQueueAwaiter.ts
 *
 * Bridges the gap between `dispatchFalQueueTask` (returns request_id immediately)
 * and the orb agent's multi-step orchestrator (needs the actual output URL to
 * chain into the next step's toolArgs via ${stepId.video_url} placeholders).
 *
 * Closes the audit's #7 gap: result polling. Without it, even with the new
 * step-ref resolver, a plan like
 *   step1 → studio.generateVideo → returns { request_id }
 *   step2 → studio.enhanceVideo  → "${step1.video_url}" ← never resolves
 * fails because step1's data only has request_id, not video_url.
 *
 * Strategy: poll fal's queue endpoints until COMPLETED or the timeout fires,
 * extract the canonical media URL (image_url / video_url / audio_url), and
 * merge it into the tool result.
 *
 * Bounded polling: defaults to ~120s with exponential backoff (2s → 8s).
 * If the timeout hits, we return the request_id + status="pending" so the
 * caller can surface it; the user can re-run later or the dashboard can
 * pick the result up via the /api/webhook/fal callback.
 *
 * The studio routers (videoStudio.ts / imageStudio.ts / proStudio.ts) do
 * their own per-request polling for the UI; this module is the SERVER-side
 * counterpart that runs inline inside `executeOrbToolCalls` so the orb can
 * chain steps end-to-end without the user clicking refresh.
 */

const FAL_QUEUE_BASE = "https://queue.fal.run";

function getFalKey(): string | null {
  const key = process.env.FAL_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export interface FalAwaitResult {
  status: "completed" | "failed" | "pending";
  request_id: string;
  modelId: string;
  /** Output URL extracted from the queue result (image / video / audio). */
  output_url?: string;
  image_url?: string;
  video_url?: string;
  audio_url?: string;
  /** Raw payload, useful for downstream tools that need additional fields. */
  raw?: unknown;
  /** When status='failed' or polling errored out. */
  error?: string;
}

interface AwaitOptions {
  /** Max total wait. Defaults to 120_000 ms. */
  timeoutMs?: number;
  /** Initial poll interval. Doubles each attempt up to maxIntervalMs. */
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  /** Test seam: override `fetch` (defaults to global fetch). */
  fetchFn?: typeof fetch;
  /** Test seam: override sleep so tests don't actually wait. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Test seam: override the clock used for timeout decisions. */
  nowFn?: () => number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INITIAL_MS = 2_000;
const DEFAULT_MAX_INTERVAL_MS = 8_000;

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Walk a fal.ai response payload and return the first canonical media URL
 * we recognise. fal models nest the output differently per family, so we
 * scan a small set of well-known paths instead of relying on a single shape.
 */
export function extractFalMediaUrl(raw: unknown): {
  output_url?: string;
  image_url?: string;
  video_url?: string;
  audio_url?: string;
} {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [
    root,
    root.data as Record<string, unknown> | undefined,
    root.output as Record<string, unknown> | undefined,
    root.result as Record<string, unknown> | undefined,
  ].filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"));

  let video_url: string | undefined;
  let image_url: string | undefined;
  let audio_url: string | undefined;

  for (const node of candidates) {
    if (!video_url && typeof node.video_url === "string") video_url = node.video_url;
    if (!image_url && typeof node.image_url === "string") image_url = node.image_url;
    if (!audio_url && typeof node.audio_url === "string") audio_url = node.audio_url;
    // {video: { url }}, {image: { url }}, {audio: { url }} — the most common shape.
    const video = node.video as Record<string, unknown> | undefined;
    if (!video_url && video && typeof video.url === "string") video_url = video.url;
    const image = node.image as Record<string, unknown> | undefined;
    if (!image_url && image && typeof image.url === "string") image_url = image.url;
    const audio = node.audio as Record<string, unknown> | undefined;
    if (!audio_url && audio && typeof audio.url === "string") audio_url = audio.url;
    // images: [{url}] — flux / SDXL style.
    const images = node.images;
    if (!image_url && Array.isArray(images) && images.length > 0) {
      const first = images[0] as Record<string, unknown> | undefined;
      if (first && typeof first.url === "string") image_url = first.url;
    }
    // videos: [{url}] — some fal video models return arrays even for a
    // single output. videoStudio.extractVideoUrl handles this shape too;
    // mirror it here so checkStudioJob / webhookFal don't misclassify a
    // valid completion as "無法解析結果連結".
    const videos = node.videos;
    if (!video_url && Array.isArray(videos) && videos.length > 0) {
      const first = videos[0] as Record<string, unknown> | undefined;
      if (first && typeof first.url === "string") video_url = first.url;
    }
    // audios: [{url}] — defensive symmetry. Not all fal audio models do
    // this but a few stem-separation / multi-clip endpoints do.
    const audios = node.audios;
    if (!audio_url && Array.isArray(audios) && audios.length > 0) {
      const first = audios[0] as Record<string, unknown> | undefined;
      if (first && typeof first.url === "string") audio_url = first.url;
    }
  }
  const output_url = video_url ?? image_url ?? audio_url;
  return {
    output_url,
    image_url,
    video_url,
    audio_url,
  };
}

/**
 * Poll fal.ai's queue endpoints until the job reaches a terminal state or
 * the timeout fires. Returns a normalised `FalAwaitResult` with the output
 * URL extracted so the orchestrator can feed it into the next step.
 */
export async function awaitFalQueueResult(
  request_id: string,
  modelId: string,
  options: AwaitOptions = {}
): Promise<FalAwaitResult> {
  const key = getFalKey();
  if (!key) {
    return {
      status: "pending",
      request_id,
      modelId,
      error: "FAL_API_KEY missing — cannot poll for completion",
    };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const nowFn = options.nowFn ?? Date.now;
  let interval = options.initialIntervalMs ?? DEFAULT_INITIAL_MS;
  const maxInterval = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const deadline = nowFn() + timeoutMs;

  const statusUrl = `${FAL_QUEUE_BASE}/${modelId}/requests/${request_id}/status`;
  const resultUrl = `${FAL_QUEUE_BASE}/${modelId}/requests/${request_id}`;
  const headers = { Authorization: `Key ${key}` };

  while (nowFn() < deadline) {
    let statusPayload: { status?: string; error?: string } | null = null;
    try {
      const res = await fetchFn(statusUrl, { headers });
      if (!res.ok) {
        // 404 right after submit happens in practice; ride through it.
        if (res.status !== 404) {
          return {
            status: "failed",
            request_id,
            modelId,
            error: `fal status HTTP ${res.status}`,
          };
        }
      } else {
        statusPayload = (await res.json()) as { status?: string; error?: string };
      }
    } catch (err) {
      // Network blip — try again until timeout.
      statusPayload = null;
    }

    const status = String(statusPayload?.status ?? "").toUpperCase();
    if (status === "FAILED" || status === "CANCELLED") {
      return {
        status: "failed",
        request_id,
        modelId,
        error: statusPayload?.error ?? `fal job ${status}`,
      };
    }
    if (status === "COMPLETED") {
      try {
        const res = await fetchFn(resultUrl, { headers });
        if (!res.ok) {
          return {
            status: "failed",
            request_id,
            modelId,
            error: `fal result HTTP ${res.status}`,
          };
        }
        const raw = await res.json();
        const urls = extractFalMediaUrl(raw);
        return {
          status: "completed",
          request_id,
          modelId,
          ...urls,
          raw,
        };
      } catch (err) {
        return {
          status: "failed",
          request_id,
          modelId,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    await sleepFn(interval);
    interval = Math.min(interval * 2, maxInterval);
  }

  return {
    status: "pending",
    request_id,
    modelId,
    error: `await timed out after ${timeoutMs}ms`,
  };
}
