/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 四模態 SDK Orchestrator (Model Clients)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 統一封裝 Fal.ai（圖片/影片）、Suno（音樂）、ElevenLabs（語音）、
 * Replicate（進階預留）四大生成引擎，提供：
 *
 * 1. SafeApiCaller — 指數退避重試 + Rate Limit 偵測 + 超時保護
 * 2. FalClient     — Flux Pro/Schnell 圖片 + 影片生成
 * 3. SunoClient    — AI 音樂生成 REST API
 * 4. ElevenLabsClient — 語音合成 TTS
 * 5. ReplicateClient  — 通用模型調度（進階預留）
 * 6. ModelOrchestrator — 四模態統一路由 + 健康檢查
 */

import { createFalClient } from "@fal-ai/client";
import type { FalClient as FalSdkClient } from "@fal-ai/client";
import Replicate from "replicate";
import { traceToolRun } from "./langsmithTracer";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type Modality = "image" | "video" | "music" | "voice";

export type HealthStatus = "online" | "degraded" | "offline";

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

export interface ClientHealth {
  status: HealthStatus;
  lastChecked: number;
  latencyMs: number | null;
  errorMessage: string | null;
}

export interface GenerationRequest {
  modality: Modality;
  prompt: string;
  params?: Record<string, unknown>;
}

export interface GenerationResult {
  success: boolean;
  modality: Modality;
  data: unknown;
  durationMs: number;
  retries: number;
  engine: string;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// SafeApiCaller — 指數退避重試 + Rate Limit 偵測 + 超時保護
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 120000, // 2 minutes
};

/**
 * 判斷錯誤是否可重試
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit
    if (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("too many requests")
    ) {
      return true;
    }
    // Timeout
    if (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("econnreset")
    ) {
      return true;
    }
    // Server errors (5xx)
    if (
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504")
    ) {
      return true;
    }
    // Network errors
    if (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("fetch failed")
    ) {
      return true;
    }
  }
  // Check HTTP status code if available
  if (typeof error === "object" && error !== null) {
    const status = (error as any).status || (error as any).statusCode;
    if (status === 429 || (status >= 500 && status < 600)) return true;
  }
  return false;
}

/**
 * 從 Rate Limit 回應中提取 Retry-After 秒數
 */
function extractRetryAfter(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const headers = (error as any).headers || (error as any).response?.headers;
    if (headers) {
      const retryAfter = headers["retry-after"] || headers.get?.("retry-after");
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
  }
  return null;
}

/**
 * 計算指數退避延遲（含 jitter）
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.baseDelayMs;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

/**
 * 安全 API 呼叫器 — 包裝任何 async 函數，提供重試、超時、日誌
 */
export async function safeApiCall<T>(
  fn: () => Promise<T>,
  label: string,
  config: Partial<RetryConfig> = {}
): Promise<{ data: T; retries: number; durationMs: number }> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      // Timeout wrapper
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(new Error(`[${label}] Timeout after ${cfg.timeoutMs}ms`)),
            cfg.timeoutMs
          )
        ),
      ]);

      const durationMs = Date.now() - startTime;
      if (attempt > 0) {
        console.log(
          `[SafeApiCaller] ✅ ${label} succeeded after ${attempt} retries (${durationMs}ms)`
        );
      }
      return { data: result, retries: attempt, durationMs };
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - startTime;

      if (attempt < cfg.maxRetries && isRetryableError(error)) {
        // Check for Retry-After header
        const retryAfterMs = extractRetryAfter(error);
        const delayMs = retryAfterMs || calculateBackoff(attempt, cfg);

        console.warn(
          `[SafeApiCaller] ⚠️ ${label} attempt ${attempt + 1}/${cfg.maxRetries + 1} failed ` +
            `(${durationMs}ms). Retrying in ${Math.round(delayMs)}ms... ` +
            `Error: ${error instanceof Error ? error.message : String(error)}`
        );

        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.error(
          `[SafeApiCaller] ❌ ${label} failed permanently after ${attempt + 1} attempts ` +
            `(${durationMs}ms). Error: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }
    }
  }

  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════
// FalClient — Fal.ai 圖片/影片生成
// ═══════════════════════════════════════════════════════════════════════════

export class FalClient {
  private initialized = false;
  private client: FalSdkClient | null = null;

  constructor() {
    const key = process.env.FAL_API_KEY;
    if (key) {
      this.client = createFalClient({ credentials: key });
      this.initialized = true;
      console.log("[FalClient] ✅ Initialized with FAL_API_KEY");
    } else {
      console.warn("[FalClient] ⚠️ FAL_API_KEY not set — client disabled");
    }
  }

  get isAvailable(): boolean {
    return this.initialized;
  }

  /**
   * 圖片生成 — Flux Pro / Flux Schnell / SDXL
   */
  async generateImage(params: {
    prompt: string;
    model?: "flux-pro" | "flux-schnell" | "stable-diffusion-xl";
    width?: number;
    height?: number;
    numImages?: number;
    guidanceScale?: number;
    seed?: number;
    negativePrompt?: string;
  }): Promise<{
    images: Array<{ url: string; width: number; height: number }>;
    seed: number;
  }> {
    if (!this.initialized)
      throw new Error("FalClient not initialized — FAL_API_KEY missing");

    const modelMap: Record<string, string> = {
      "flux-pro": "fal-ai/flux-pro/v1.1",
      "flux-schnell": "fal-ai/flux/schnell",
      "stable-diffusion-xl": "fal-ai/stable-diffusion-xl",
    };

    const modelId =
      modelMap[params.model || "flux-pro"] || modelMap["flux-pro"];

    const { data, retries, durationMs } = await safeApiCall(
      async () => {
        const result = await this.client!.subscribe(modelId, {
          input: {
            prompt: params.prompt,
            image_size:
              params.width && params.height
                ? { width: params.width, height: params.height }
                : "landscape_16_9",
            num_images: params.numImages || 1,
            ...(params.guidanceScale && {
              guidance_scale: params.guidanceScale,
            }),
            ...(params.seed && { seed: params.seed }),
            ...(params.negativePrompt && {
              negative_prompt: params.negativePrompt,
            }),
          },
          logs: false,
        });
        return result.data;
      },
      `Fal:${params.model || "flux-pro"}`,
      { timeoutMs: 180000 } // 3 min for image gen
    );

    console.log(
      `[FalClient] 🖼️ Image generated in ${durationMs}ms (${retries} retries)`
    );

    const result = data as any;
    return {
      images: (result.images || []).map((img: any) => ({
        url: img.url,
        width: img.width || params.width || 1024,
        height: img.height || params.height || 768,
      })),
      seed: result.seed || 0,
    };
  }

  /**
   * 影片生成 — Kling / Runway 等
   */
  async generateVideo(params: {
    prompt: string;
    model?: "kling-v1-5" | "runway-gen3" | "kling-v1";
    duration?: number;
    aspectRatio?: string;
    imageUrl?: string; // 首幀圖片
  }): Promise<{ videoUrl: string; durationSec: number }> {
    if (!this.initialized)
      throw new Error("FalClient not initialized — FAL_API_KEY missing");

    const modelMap: Record<string, string> = {
      "kling-v1-5": "fal-ai/kling-video/v1.5/pro/image-to-video",
      "runway-gen3": "fal-ai/runway-gen3/turbo/image-to-video",
      "kling-v1": "fal-ai/kling-video/v1/standard/text-to-video",
    };

    const modelId =
      modelMap[params.model || "kling-v1"] || modelMap["kling-v1"];

    const { data, retries, durationMs } = await safeApiCall(
      async () => {
        const input: Record<string, unknown> = {
          prompt: params.prompt,
          ...(params.duration && { duration: String(params.duration) }),
          ...(params.aspectRatio && { aspect_ratio: params.aspectRatio }),
        };

        // Image-to-video models need image_url
        if (params.imageUrl && modelId.includes("image-to-video")) {
          input.image_url = params.imageUrl;
        }

        const result = await this.client!.subscribe(modelId, {
          input,
          logs: false,
        });
        return result.data;
      },
      `Fal:Video:${params.model || "kling-v1"}`,
      { timeoutMs: 300000 } // 5 min for video gen
    );

    console.log(
      `[FalClient] 🎬 Video generated in ${durationMs}ms (${retries} retries)`
    );

    const result = data as any;
    return {
      videoUrl: result.video?.url || result.url || "",
      durationSec: params.duration || 5,
    };
  }

  /**
   * 健康檢查
   */
  async healthCheck(): Promise<ClientHealth> {
    const start = Date.now();
    try {
      if (!this.initialized) {
        return {
          status: "offline",
          lastChecked: start,
          latencyMs: null,
          errorMessage: "FAL_API_KEY not set",
        };
      }
      // Lightweight check — just verify credentials
      // Fal doesn't have a dedicated health endpoint, so we check init status
      return {
        status: "online",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: null,
      };
    } catch (error) {
      return {
        status: "offline",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SunoClient — Suno AI 音樂生成 (REST API)
// ═══════════════════════════════════════════════════════════════════════════

export class SunoClient {
  private apiKey: string | null;
  private baseUrl = "https://apibox.erweima.ai"; // Suno API proxy

  constructor() {
    this.apiKey = process.env.SUNO_API_KEY || null;
    if (this.apiKey) {
      console.log("[SunoClient] ✅ Initialized with SUNO_API_KEY");
    } else {
      console.warn("[SunoClient] ⚠️ SUNO_API_KEY not set — client disabled");
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * 生成音樂
   */
  async generateMusic(params: {
    prompt: string;
    style?: string;
    title?: string;
    instrumental?: boolean;
    duration?: number;
    customMode?: boolean;
    lyrics?: string;
    /**
     * Suno 完成時主動 POST 回呼到此 URL（apibox.erweima.ai 的 callBackUrl）。
     * 不帶則僅能用 getTaskStatus 輪詢；前端關閉後結果會遺失。
     */
    callBackUrl?: string;
  }): Promise<{ taskId: string; status: string }> {
    if (!this.apiKey)
      throw new Error("SunoClient not initialized — SUNO_API_KEY missing");
    const traceStart = Date.now();
    const body: Record<string, unknown> = {
      prompt: params.prompt,
      make_instrumental: params.instrumental ?? false,
      wait_audio: false, // async mode
    };
    if (params.customMode && params.lyrics) {
      body.custom_mode = true;
      body.lyrics = params.lyrics;
      if (params.title) body.title = params.title;
      if (params.style) body.tags = params.style;
    }
    if (params.callBackUrl) {
      body.callBackUrl = params.callBackUrl;
    }

    let data: unknown;
    let retries = 0;
    let durationMs = 0;
    try {
      const response = await safeApiCall(
        async () => {
          const res = await fetch(`${this.baseUrl}/api/v1/generate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw Object.assign(
              new Error(`Suno API error: ${res.status} ${errText}`),
              {
                status: res.status,
                headers: res.headers,
              }
            );
          }

          return res.json();
        },
        "Suno:Generate",
        { timeoutMs: 60000 }
      );
      data = response.data;
      retries = response.retries;
      durationMs = response.durationMs;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      await traceToolRun({
        runName: "suno/music-generate",
        provider: "suno",
        model: "suno-v1",
        route: "service.modelClients.suno.generateMusic",
        method: "POST",
        inputs: {
          prompt: params.prompt.slice(0, 500),
          custom_mode: Boolean(params.customMode),
          has_lyrics: Boolean(params.lyrics),
        },
        error: errMessage,
        durationMs: Date.now() - traceStart,
      });
      throw error;
    }

    console.log(
      `[SunoClient] 🎵 Music generation initiated in ${durationMs}ms (${retries} retries)`
    );

    const result = data as any;
    await traceToolRun({
      runName: "suno/music-generate",
      provider: "suno",
      model: "suno-v1",
      route: "service.modelClients.suno.generateMusic",
      method: "POST",
      inputs: {
        prompt: params.prompt.slice(0, 500),
        custom_mode: Boolean(params.customMode),
        has_lyrics: Boolean(params.lyrics),
      },
      outputs: {
        task_id: result.data?.task_id || result.task_id || "",
        status: "processing",
      },
      durationMs,
    });
    return {
      taskId: result.data?.task_id || result.task_id || "",
      status: "processing",
    };
  }

  /**
   * 查詢音樂生成狀態
   */
  async getTaskStatus(taskId: string): Promise<{
    status: string;
    clips: Array<{ audioUrl: string; title: string; duration: number }>;
  }> {
    if (!this.apiKey) throw new Error("SunoClient not initialized");

    const { data } = await safeApiCall(
      async () => {
        const res = await fetch(
          `${this.baseUrl}/api/v1/generate/record?taskId=${taskId}`,
          {
            headers: { Authorization: `Bearer ${this.apiKey}` },
          }
        );
        if (!res.ok) throw new Error(`Suno status check failed: ${res.status}`);
        return res.json();
      },
      "Suno:Status",
      { maxRetries: 1, timeoutMs: 15000 }
    );

    const result = data as any;
    const responseData = result.data || result;

    return {
      status: responseData.status || "unknown",
      clips: (responseData.data || []).map((clip: any) => ({
        audioUrl: clip.audio_url || "",
        title: clip.title || "",
        duration: clip.duration || 0,
      })),
    };
  }

  /**
   * 健康檢查
   */
  async healthCheck(): Promise<ClientHealth> {
    const start = Date.now();
    try {
      if (!this.apiKey) {
        return {
          status: "offline",
          lastChecked: start,
          latencyMs: null,
          errorMessage: "SUNO_API_KEY not set",
        };
      }
      return {
        status: "online",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: null,
      };
    } catch (error) {
      return {
        status: "offline",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ElevenLabsClient — 語音合成 TTS
// ═══════════════════════════════════════════════════════════════════════════

export class ElevenLabsClient {
  private apiKey: string | null;
  private baseUrl = "https://api.elevenlabs.io/v1";

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || null;
    if (this.apiKey) {
      console.log("[ElevenLabsClient] ✅ Initialized with ELEVENLABS_API_KEY");
    } else {
      console.warn(
        "[ElevenLabsClient] ⚠️ ELEVENLABS_API_KEY not set — client disabled"
      );
    }
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * 文字轉語音
   */
  async textToSpeech(params: {
    text: string;
    voiceId?: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
  }): Promise<{ audioBuffer: Buffer; contentType: string }> {
    if (!this.apiKey)
      throw new Error(
        "ElevenLabsClient not initialized — ELEVENLABS_API_KEY missing"
      );

    const voiceId = params.voiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel (default)
    const modelId = params.modelId || "eleven_multilingual_v2";
    const startedAt = Date.now();

    let data: { audioBuffer: Buffer; contentType: string };
    let retries = 0;
    let durationMs = 0;
    try {
      const response = await safeApiCall(
        async () => {
          const res = await fetch(`${this.baseUrl}/text-to-speech/${voiceId}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": this.apiKey!,
            },
            body: JSON.stringify({
              text: params.text,
              model_id: modelId,
              voice_settings: {
                stability: params.stability ?? 0.5,
                similarity_boost: params.similarityBoost ?? 0.75,
                ...(params.speed && { speed: params.speed }),
              },
            }),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw Object.assign(
              new Error(`ElevenLabs TTS error: ${res.status} ${errText}`),
              {
                status: res.status,
                headers: res.headers,
              }
            );
          }

          const arrayBuffer = await res.arrayBuffer();
          return {
            audioBuffer: Buffer.from(arrayBuffer),
            contentType: res.headers.get("content-type") || "audio/mpeg",
          };
        },
        "ElevenLabs:TTS",
        { timeoutMs: 60000 }
      );
      data = response.data;
      retries = response.retries;
      durationMs = response.durationMs;
    } catch (error) {
      await traceToolRun({
        runName: "elevenlabs/tts",
        provider: "elevenlabs",
        model: modelId,
        route: "service.modelClients.elevenlabs.textToSpeech",
        method: "POST",
        inputs: {
          voice_id: voiceId,
          text_preview: params.text.slice(0, 500),
        },
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }

    console.log(
      `[ElevenLabsClient] 🎙️ TTS generated in ${durationMs}ms (${retries} retries, ${data.audioBuffer.length} bytes)`
    );
    await traceToolRun({
      runName: "elevenlabs/tts",
      provider: "elevenlabs",
      model: modelId,
      route: "service.modelClients.elevenlabs.textToSpeech",
      method: "POST",
      inputs: {
        voice_id: voiceId,
        text_preview: params.text.slice(0, 500),
      },
      outputs: {
        content_type: data.contentType,
        audio_bytes: data.audioBuffer.length,
      },
      durationMs,
    });
    return data;
  }

  /**
   * 取得可用語音列表
   */
  async listVoices(): Promise<
    Array<{ voiceId: string; name: string; category: string }>
  > {
    if (!this.apiKey) throw new Error("ElevenLabsClient not initialized");

    const { data } = await safeApiCall(
      async () => {
        const res = await fetch(`${this.baseUrl}/voices`, {
          headers: { "xi-api-key": this.apiKey! },
        });
        if (!res.ok)
          throw Object.assign(
            new Error(`ElevenLabs voices error: ${res.status}`),
            { status: res.status }
          );
        return res.json();
      },
      "ElevenLabs:Voices",
      { maxRetries: 2, timeoutMs: 15000 }
    );

    const result = data as any;
    return (result.voices || []).map((v: any) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category || "premade",
    }));
  }

  /**
   * 健康檢查
   */
  async healthCheck(): Promise<ClientHealth> {
    const start = Date.now();
    try {
      if (!this.apiKey) {
        return {
          status: "offline",
          lastChecked: start,
          latencyMs: null,
          errorMessage: "ELEVENLABS_API_KEY not set",
        };
      }
      const res = await fetch(`${this.baseUrl}/user`, {
        headers: { "xi-api-key": this.apiKey },
      });
      const latencyMs = Date.now() - start;
      if (res.status === 200) {
        return {
          status: "online",
          lastChecked: Date.now(),
          latencyMs,
          errorMessage: null,
        };
      } else if (res.status === 401) {
        return {
          status: "degraded",
          lastChecked: Date.now(),
          latencyMs,
          errorMessage: "API key expired or invalid (free tier)",
        };
      } else {
        return {
          status: "degraded",
          lastChecked: Date.now(),
          latencyMs,
          errorMessage: `HTTP ${res.status}`,
        };
      }
    } catch (error) {
      return {
        status: "offline",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ReplicateClient — 進階預留通用模型
// ═══════════════════════════════════════════════════════════════════════════

export class ReplicateClient {
  private client: Replicate | null = null;

  constructor() {
    const token = process.env.REPLICATE_API_TOKEN;
    if (token) {
      this.client = new Replicate({ auth: token });
      console.log("[ReplicateClient] ✅ Initialized with REPLICATE_API_TOKEN");
    } else {
      console.warn(
        "[ReplicateClient] ⚠️ REPLICATE_API_TOKEN not set — client disabled"
      );
    }
  }

  get isAvailable(): boolean {
    return !!this.client;
  }

  /**
   * 執行任意 Replicate 模型
   */
  async run(params: {
    model: `${string}/${string}` | `${string}/${string}:${string}`;
    input: Record<string, unknown>;
  }): Promise<{ output: unknown; durationMs: number }> {
    if (!this.client)
      throw new Error(
        "ReplicateClient not initialized — REPLICATE_API_TOKEN missing"
      );

    const startedAt = Date.now();
    let data: unknown;
    let retries = 0;
    let durationMs = 0;
    try {
      const response = await safeApiCall(
        async () => {
          const output = await this.client!.run(params.model, {
            input: params.input,
          });
          return output;
        },
        `Replicate:${params.model}`,
        { timeoutMs: 300000 } // 5 min
      );
      data = response.data;
      retries = response.retries;
      durationMs = response.durationMs;
    } catch (error) {
      await traceToolRun({
        runName: "replicate/run",
        provider: "replicate",
        model: params.model,
        route: "service.modelClients.replicate.run",
        method: "POST",
        inputs: {
          model: params.model,
          input_keys: Object.keys(params.input || {}),
        },
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }

    console.log(
      `[ReplicateClient] 🔧 Model ${params.model} completed in ${durationMs}ms (${retries} retries)`
    );
    await traceToolRun({
      runName: "replicate/run",
      provider: "replicate",
      model: params.model,
      route: "service.modelClients.replicate.run",
      method: "POST",
      inputs: {
        model: params.model,
        input_keys: Object.keys(params.input || {}),
      },
      outputs: {
        output_type: Array.isArray(data) ? "array" : typeof data,
      },
      durationMs,
    });
    return { output: data, durationMs };
  }

  /**
   * 健康檢查
   */
  async healthCheck(): Promise<ClientHealth> {
    const start = Date.now();
    try {
      if (!this.client) {
        return {
          status: "offline",
          lastChecked: start,
          latencyMs: null,
          errorMessage: "REPLICATE_API_TOKEN not set",
        };
      }
      // Lightweight check — get account info
      const account = await this.client.accounts.current();
      return {
        status: "online",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: null,
      };
    } catch (error) {
      return {
        status: "degraded",
        lastChecked: Date.now(),
        latencyMs: Date.now() - start,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ModelOrchestrator — 四模態統一調度器
// ═══════════════════════════════════════════════════════════════════════════

export class ModelOrchestrator {
  public readonly fal: FalClient;
  public readonly suno: SunoClient;
  public readonly elevenlabs: ElevenLabsClient;
  public readonly replicate: ReplicateClient;

  constructor() {
    this.fal = new FalClient();
    this.suno = new SunoClient();
    this.elevenlabs = new ElevenLabsClient();
    this.replicate = new ReplicateClient();
  }

  /**
   * 根據模態路由到對應引擎
   */
  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const start = Date.now();

    try {
      switch (request.modality) {
        case "image": {
          const result = await this.fal.generateImage({
            prompt: request.prompt,
            model: (request.params?.model as any) || "flux-pro",
            width: (request.params?.width as number) || undefined,
            height: (request.params?.height as number) || undefined,
            numImages: (request.params?.numImages as number) || 1,
            guidanceScale:
              (request.params?.guidanceScale as number) || undefined,
            seed: (request.params?.seed as number) || undefined,
            negativePrompt:
              (request.params?.negativePrompt as string) || undefined,
          });
          return {
            success: true,
            modality: "image",
            data: result,
            durationMs: Date.now() - start,
            retries: 0,
            engine: `fal:${request.params?.model || "flux-pro"}`,
          };
        }

        case "video": {
          const result = await this.fal.generateVideo({
            prompt: request.prompt,
            model: (request.params?.model as any) || "kling-v1",
            duration: (request.params?.duration as number) || 5,
            aspectRatio: (request.params?.aspectRatio as string) || "16:9",
            imageUrl: (request.params?.imageUrl as string) || undefined,
          });
          return {
            success: true,
            modality: "video",
            data: result,
            durationMs: Date.now() - start,
            retries: 0,
            engine: `fal:${request.params?.model || "kling-v1"}`,
          };
        }

        case "music": {
          const result = await this.suno.generateMusic({
            prompt: request.prompt,
            style: (request.params?.style as string) || undefined,
            title: (request.params?.title as string) || undefined,
            instrumental: (request.params?.instrumental as boolean) || false,
            customMode: (request.params?.customMode as boolean) || false,
            lyrics: (request.params?.lyrics as string) || undefined,
          });
          return {
            success: true,
            modality: "music",
            data: result,
            durationMs: Date.now() - start,
            retries: 0,
            engine: "suno",
          };
        }

        case "voice": {
          const result = await this.elevenlabs.textToSpeech({
            text: request.prompt,
            voiceId: (request.params?.voiceId as string) || undefined,
            modelId: (request.params?.modelId as string) || undefined,
            stability: (request.params?.stability as number) || undefined,
            similarityBoost:
              (request.params?.similarityBoost as number) || undefined,
            speed: (request.params?.speed as number) || undefined,
          });
          return {
            success: true,
            modality: "voice",
            data: {
              audioSize: result.audioBuffer.length,
              contentType: result.contentType,
            },
            durationMs: Date.now() - start,
            retries: 0,
            engine: "elevenlabs",
          };
        }

        default:
          throw new Error(`Unknown modality: ${request.modality}`);
      }
    } catch (error) {
      return {
        success: false,
        modality: request.modality,
        data: null,
        durationMs: Date.now() - start,
        retries: 0,
        engine: "unknown",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 全引擎健康檢查
   */
  async healthCheckAll(): Promise<Record<Modality, ClientHealth>> {
    const [falHealth, sunoHealth, elevenHealth, replicateHealth] =
      await Promise.allSettled([
        this.fal.healthCheck(),
        this.suno.healthCheck(),
        this.elevenlabs.healthCheck(),
        this.replicate.healthCheck(),
      ]);

    const defaultOffline: ClientHealth = {
      status: "offline",
      lastChecked: Date.now(),
      latencyMs: null,
      errorMessage: "Health check failed",
    };

    return {
      image:
        falHealth.status === "fulfilled" ? falHealth.value : defaultOffline,
      video:
        falHealth.status === "fulfilled" ? falHealth.value : defaultOffline,
      music:
        sunoHealth.status === "fulfilled" ? sunoHealth.value : defaultOffline,
      voice:
        elevenHealth.status === "fulfilled"
          ? elevenHealth.value
          : defaultOffline,
    };
  }

  /**
   * 取得可用模態列表
   */
  getAvailableModalities(): Modality[] {
    const available: Modality[] = [];
    if (this.fal.isAvailable) {
      available.push("image", "video");
    }
    if (this.suno.isAvailable) {
      available.push("music");
    }
    if (this.elevenlabs.isAvailable) {
      available.push("voice");
    }
    return available;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton Instance
// ═══════════════════════════════════════════════════════════════════════════

let _orchestrator: ModelOrchestrator | null = null;

export function getOrchestrator(): ModelOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new ModelOrchestrator();
  }
  return _orchestrator;
}

/**
 * 重新初始化 Orchestrator（用於金鑰更新後）
 */
export function resetOrchestrator(): void {
  _orchestrator = null;
  console.log(
    "[ModelOrchestrator] 🔄 Reset — will reinitialize on next access"
  );
}
