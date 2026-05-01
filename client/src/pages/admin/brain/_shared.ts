/**
 * Shared types & constants for the AI Brain Configuration admin page.
 *
 * Extracted from `pages/AiBrainSettings.tsx` so that future per-tab
 * modules (ConfigTab / AlertsTab / ErrorsTab / etc) can import a single
 * source instead of re-declaring the same maps.
 */

// ─── Error category maps ────────────────────────────────────────────────────

/** 錯誤分類中文標籤(集中定義,避免重複) */
export const ERROR_CATEGORY_LABEL_MAP: Record<string, string> = {
  rate_limit: "速率限制",
  auth_failure: "認證失敗",
  connection: "連線問題",
  timeout: "請求逾時",
  missing_api: "缺失 API",
  broken_link: "連結中斷",
  validation: "參數錯誤",
  server_error: "伺服器錯誤",
  quota_exceeded: "配額用盡",
  model_unavailable: "模型不可用",
  unknown: "未知",
};

/** 錯誤分類的顏色樣式 */
export const ERROR_CATEGORY_COLOR_MAP: Record<string, string> = {
  rate_limit: "text-orange-600 bg-orange-500/10",
  auth_failure: "text-red-600 bg-red-500/10",
  connection: "text-yellow-600 bg-yellow-500/10",
  timeout: "text-amber-600 bg-amber-500/10",
  missing_api: "text-purple-600 bg-purple-500/10",
  broken_link: "text-pink-600 bg-pink-500/10",
  validation: "text-blue-600 bg-blue-500/10",
  server_error: "text-red-700 bg-red-600/10",
  quota_exceeded: "text-orange-700 bg-orange-600/10",
  model_unavailable: "text-slate-600 bg-slate-500/10",
  unknown: "text-muted-foreground bg-muted",
};

/** 錯誤分類帶 emoji 標籤(爬網研究頁用) */
export const ERROR_CATEGORY_EMOJI_LABELS: Record<string, string> = {
  rate_limit: "🚦 速率限制",
  auth_failure: "🔑 認證失敗",
  connection: "🔌 連線問題",
  timeout: "⏱️ 請求逾時",
  missing_api: "❓ 缺失 API",
  broken_link: "🔗 連結中斷",
  validation: "📋 參數錯誤",
  server_error: "💥 伺服器錯誤",
  quota_exceeded: "📊 配額用盡",
  model_unavailable: "🚫 模型不可用",
  unknown: "❔ 未分類",
};

// ─── Reusable view types ────────────────────────────────────────────────────

export interface ModelOption {
  value: string;
  label: string;
  tier: string;
  description?: string;
}

export interface SlotCatalog {
  label: string;
  description: string;
  options: readonly ModelOption[];
  targetPath?: string;
}

export type HealthState = "healthy" | "unhealthy" | "unverified";

export type HealthStatus = Record<
  string,
  {
    healthy: boolean;
    state?: HealthState;
    consecutiveFailures: number;
    lastError?: string;
  }
>;

// ─── Fal.ai 16-task identifiers ─────────────────────────────────────────────

/** Fal.ai 16 大類任務引擎鍵名 */
export type FalTaskKey =
  | "image-to-3d"
  | "image-to-image"
  | "image-to-json"
  | "image-to-video"
  | "json"
  | "llm"
  | "text-to-3d"
  | "text-to-audio"
  | "text-to-image"
  | "text-to-json"
  | "text-to-speech"
  | "text-to-video"
  | "training"
  | "video-to-audio"
  | "video-to-text"
  | "video-to-video";

/** Maps FalTaskKey → state field name in upsert */
export const FAL_TASK_UPSERT_KEY: Record<FalTaskKey, string> = {
  "image-to-3d": "falImageTo3dEngine",
  "image-to-image": "falImageToImageEngine",
  "image-to-json": "falImageToJsonEngine",
  "image-to-video": "falImageToVideoEngine",
  json: "falJsonEngine",
  llm: "falLlmEngine",
  "text-to-3d": "falTextTo3dEngine",
  "text-to-audio": "falTextToAudioEngine",
  "text-to-image": "falTextToImageEngine",
  "text-to-json": "falTextToJsonEngine",
  "text-to-speech": "falTextToSpeechEngine",
  "text-to-video": "falTextToVideoEngine",
  training: "falTrainingEngine",
  "video-to-audio": "falVideoToAudioEngine",
  "video-to-text": "falVideoToTextEngine",
  "video-to-video": "falVideoToVideoEngine",
};

/** Default models per task category (first premium model in catalog) */
export const FAL_TASK_DEFAULTS: Record<FalTaskKey, string> = {
  "image-to-3d": "fal-ai/trellis-2",
  "image-to-image": "fal-ai/flux/dev/image-to-image",
  "image-to-json": "fal-ai/any-llm",
  "image-to-video": "fal-ai/kling-video/v2.1/pro/image-to-video",
  json: "fal-ai/any-llm",
  llm: "fal-ai/any-llm",
  "text-to-3d": "fal-ai/hyper3d/rodin",
  "text-to-audio": "fal-ai/stable-audio",
  "text-to-image": "fal-ai/flux-pro/v1.1",
  "text-to-json": "fal-ai/any-llm",
  "text-to-speech": "fal-ai/elevenlabs/tts/turbo-v2.5",
  "text-to-video": "fal-ai/kling-video/v2.1/pro/text-to-video",
  training: "fal-ai/flux-lora-fast-training",
  "video-to-audio": "fal-ai/mmaudio-v2/video-to-audio",
  "video-to-text": "fal-ai/whisper",
  "video-to-video": "fal-ai/kling-video/v2.1/standard/video-to-video",
};
