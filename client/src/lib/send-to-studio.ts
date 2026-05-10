/**
 * client/src/lib/send-to-studio.ts
 *
 * Shared dispatcher for the "發送到工作室" flow. Before this helper existed,
 * each surface (DirectorAI, HistoryPage, SharedSpace, …) hand-rolled its own
 * sessionStorage write + navigate call:
 *
 *   - DirectorAI was the only surface that picked a modality-specific page
 *     (`/image-studio`, `/video-studio`, `/pro-studio`) AND attached an
 *     `overrideEngine`.
 *   - HistoryPage and SharedSpace always navigated to `/studio` — even when
 *     the source was an image or video — and never carried an
 *     `overrideEngine`, so the studio fell back to whatever default model was
 *     wired in for that surface.
 *
 * This helper centralizes:
 *   1. The modality → route mapping (`routeForModality`).
 *   2. The sessionStorage payload shape (`SendToStudioPayload`).
 *   3. The navigate-on-dispatch step.
 *
 * It does NOT decide WHICH model to pre-fill; that's `usePreferredStudioModel`
 * (reads the shared `agent_model_picks` table). Callers that already have a
 * model selection (DirectorAI's per-modality dropdowns) just pass it through.
 */
// wouter's `useLocation` returns `[path, navigate]` where navigate is the
// generic `<S = any>(to: string | URL, options?) => void`. The dispatcher
// only ever calls `navigate(route)` (no options) so we type StudioNavigate
// as a single-arg callable — that signature is structurally assignable
// from wouter's (extra optional parameters are allowed) AND accepts a
// vanilla `(path) => void` stub from tests.
export type StudioNavigate = (path: string | URL) => void;

export type StudioModality =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "sfx"
  | "text";

export const STUDIO_SESSION_KEY = "sendToStudio";

export interface SendToStudioBatchTask {
  prompt: string;
  generationType: StudioModality | string;
  overrideEngine?: string;
  musicStyle?: string;
  audioScript?: string;
  [key: string]: unknown;
}

export interface SendToStudioPayload {
  prompt: string;
  generationType: StudioModality | string;
  /** Specific model id the destination studio should use as default. */
  overrideEngine?: string;
  /** Where the dispatch came from — used by the studio for analytics + UI hints. */
  source: string;
  /** Optional human label so the studio can show a "from director_ai" banner. */
  sceneName?: string;
  compiledPrompt?: string;
  historyId?: number;
  // `null` is accepted because the history rows surface DB nulls directly —
  // forcing every callsite to coerce `null → undefined` is noise. The studio
  // treats both as "no value".
  resultUrl?: string | null;
  referenceImageUrl?: string | null;
  musicStyle?: string;
  audioScript?: string;
  parameterSnapshot?: Record<string, unknown>;
  segmentContext?: Record<string, unknown>;
  /** Multi-task batch — each entry runs as one studio job. */
  batchTasks?: SendToStudioBatchTask[];
  /** Free-form passthrough so callers can attach extra context. */
  [key: string]: unknown;
}

/**
 * Map a generationType to the right studio page.
 *
 * - image  → /image-studio
 * - video  → /video-studio
 * - audio / voice / sfx → /pro-studio
 * - text / anything else → /studio (the multi-purpose fallback)
 */
export function routeForModality(modality: string | undefined): string {
  const m = (modality ?? "").toLowerCase();
  if (m.startsWith("image")) return "/image-studio";
  if (m.startsWith("video")) return "/video-studio";
  if (
    m === "audio" ||
    m.startsWith("audio") ||
    m === "music" ||
    m === "voice" ||
    m.startsWith("voice") ||
    m === "tts" ||
    m === "sfx" ||
    m.startsWith("sound")
  ) {
    return "/pro-studio";
  }
  return "/studio";
}

/**
 * Pick the right page for a multi-task batch:
 *   - All-image → /image-studio
 *   - All-video → /video-studio
 *   - All-audio-family → /pro-studio
 *   - Mixed → /studio (the universal hub)
 */
export function routeForBatch(tasks: ReadonlyArray<{ generationType: string }>): string {
  if (tasks.length === 0) return "/studio";
  const onlyImage = tasks.every(t => t.generationType.toLowerCase().startsWith("image"));
  if (onlyImage) return "/image-studio";
  const onlyVideo = tasks.every(t => t.generationType.toLowerCase().startsWith("video"));
  if (onlyVideo) return "/video-studio";
  const onlyAudioFamily = tasks.every(t => {
    const m = t.generationType.toLowerCase();
    return (
      m === "audio" ||
      m.startsWith("audio") ||
      m === "music" ||
      m === "voice" ||
      m.startsWith("voice") ||
      m === "tts" ||
      m === "sfx" ||
      m.startsWith("sound")
    );
  });
  if (onlyAudioFamily) return "/pro-studio";
  return "/studio";
}

export interface DispatchToStudioArgs {
  payload: SendToStudioPayload;
  navigate: StudioNavigate;
  /**
   * Override the auto-routed destination (e.g. SharedSpace forces `/studio`
   * for unified previews even for image-only payloads). Most callers should
   * leave this undefined and trust modality-based routing.
   */
  forcePath?: string;
  /** Optional callback fired BEFORE navigation — usually a tRPC pick recorder. */
  beforeNavigate?: (payload: SendToStudioPayload, route: string) => void;
}

/**
 * Persist the payload to sessionStorage under `STUDIO_SESSION_KEY` and
 * navigate to the right studio page. Returns the route that was used so the
 * caller can show a toast like「已發送到 ${routeLabel}」.
 *
 * Server-side / SSR safe — no-ops gracefully when window is undefined.
 */
export function dispatchToStudio(args: DispatchToStudioArgs): string {
  const { payload, navigate, forcePath, beforeNavigate } = args;
  const route =
    forcePath ??
    (payload.batchTasks && payload.batchTasks.length > 0
      ? routeForBatch(payload.batchTasks)
      : routeForModality(payload.generationType));

  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(payload));
    } catch (err) {
      // Quota exceeded / sessionStorage disabled — fall through. The studio
      // will detect the missing key and just show its default empty state.
      console.warn("[send-to-studio] failed to persist payload:", err);
    }
  }

  beforeNavigate?.(payload, route);
  navigate(route);
  return route;
}

/** Human-friendly Chinese label for a route — used by toast messages. */
export function studioRouteLabel(route: string): string {
  switch (route) {
    case "/image-studio":
      return "圖片工作室";
    case "/video-studio":
      return "影片工作室";
    case "/pro-studio":
      return "音訊工作室";
    case "/studio":
      return "通用工作室";
    default:
      return "工作室";
  }
}
