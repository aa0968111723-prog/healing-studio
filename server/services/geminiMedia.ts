/**
 * geminiMedia.ts — Gemini API 多媒體生成服務
 *
 * 功能：
 *   - 生圖  : Gemini Imagen 3 / Imagen 2 文字生成圖片
 *   - 生影  : Veo 2 / Veo 3 文字/圖片生成影片
 *   - 生音樂: Lyria RealTime / MusicFX 音樂生成
 *   - 配音  : Gemini TTS / Chirp 語音合成
 *
 * 所有端點均透過 Google AI Studio / Gemini API Key
 */
import { serverEnv } from "../_core/env.validated";
import { assertSafeExternalUrl } from "../_core/ssrfGuard";
import { safeApiCall } from "./modelClients";

// ─── Types ────────────────────────────────────────────────────────────────

export interface GeminiImageParams {
  prompt: string;
  model?:
    | "imagen-3.0-generate-002"
    | "imagen-3.0-fast-generate-001"
    | "imagen-2.0";
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  numImages?: number;
  negativePrompt?: string;
  seed?: number;
  safetyFilterLevel?:
    | "block_low_and_above"
    | "block_medium_and_above"
    | "block_only_high";
  personGeneration?: "allow_adult" | "allow_all" | "dont_allow";
  addWatermark?: boolean;
}

export interface GeminiImageResult {
  images: Array<{
    base64: string;
    mimeType: string;
    url?: string; // 若上傳到 Storage 後填入
  }>;
  model: string;
  generationParams: Record<string, unknown>;
}

export interface GeminiVideoParams {
  prompt: string;
  model?: "veo-2.0-generate-001" | "veo-3.0-generate-preview";
  imageUrl?: string; // 首幀圖片（圖生影）
  lastImageUrl?: string; // 末幀圖片
  duration?: number; // 秒數（5 或 8）
  aspectRatio?: "16:9" | "9:16";
  negativePrompt?: string;
  seed?: number;
  fps?: number;
  sampleCount?: number;
}

export interface GeminiVideoResult {
  operationName: string; // 長時間操作名稱
  videos?: Array<{
    uri: string;
    mimeType: string;
  }>;
  status: "processing" | "completed" | "failed";
}

export interface GeminiAudioParams {
  prompt: string;
  model?: "lyria-002" | "musicfx-001";
  duration?: number; // 秒數，最多30s
  seed?: number;
  temperature?: number;
  topP?: number;
  guidance?: number;
}

export interface GeminiAudioResult {
  audioBase64: string;
  mimeType: string;
  duration: number;
}

export interface GeminiTTSParams {
  text: string;
  model?: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts";
  voiceName?: string; // 語音名稱
  language?: string; // BCP-47 語言代碼
  speakingRate?: number; // 0.25 ~ 4.0
  pitch?: number; // -20.0 ~ 20.0
}

export interface GeminiTTSResult {
  audioBase64: string;
  mimeType: string;
  duration?: number;
}

// ─── Gemini 模型目錄 ───────────────────────────────────────────────────────

export const GEMINI_IMAGE_MODELS = [
  {
    value: "imagen-3.0-generate-002",
    label: "Imagen 3.0 (旗艦)",
    tier: "premium" as const,
    description: "Imagen 3 最高品質，支援人臉生成",
    maxImages: 4,
    supportsNegativePrompt: true,
  },
  {
    value: "imagen-3.0-fast-generate-001",
    label: "Imagen 3.0 Fast",
    tier: "fast" as const,
    description: "Imagen 3 快速版，適合即時預覽",
    maxImages: 4,
    supportsNegativePrompt: true,
  },
  {
    value: "imagen-2.0",
    label: "Imagen 2.0",
    tier: "standard" as const,
    description: "Imagen 2 穩定版，高品質寫實風格",
    maxImages: 4,
    supportsNegativePrompt: false,
  },
] as const;

export const GEMINI_VIDEO_MODELS = [
  {
    value: "veo-2.0-generate-001",
    label: "Veo 2",
    tier: "premium" as const,
    description: "Veo 2 高品質影片生成，支援圖生影",
    maxDuration: 8,
    supportsI2V: true,
    aspectRatios: ["16:9", "9:16"] as string[],
  },
  {
    value: "veo-3.0-generate-preview",
    label: "Veo 3 (預覽)",
    tier: "premium" as const,
    description: "Veo 3 最新預覽版，原生音效生成",
    maxDuration: 8,
    supportsI2V: false,
    aspectRatios: ["16:9"] as string[],
  },
] as const;

export const GEMINI_AUDIO_MODELS = [
  {
    value: "lyria-002",
    label: "Lyria 2 音樂生成",
    tier: "premium" as const,
    description: "Google Lyria 2 高品質 AI 音樂生成",
    maxDuration: 30,
    supportsInstrumental: true,
  },
  {
    value: "musicfx-001",
    label: "MusicFX",
    tier: "standard" as const,
    description: "Google MusicFX 快速音效/音樂生成",
    maxDuration: 30,
    supportsInstrumental: true,
  },
] as const;

export const GEMINI_TTS_MODELS = [
  {
    value: "gemini-2.5-flash-preview-tts",
    label: "Gemini 2.5 Flash TTS",
    tier: "fast" as const,
    description: "Gemini 2.5 Flash 自然語音合成",
    supportsMultiSpeaker: true,
    languages: [
      "zh-TW",
      "zh-CN",
      "en-US",
      "ja-JP",
      "ko-KR",
      "fr-FR",
      "de-DE",
      "es-ES",
    ],
  },
  {
    value: "gemini-2.5-pro-preview-tts",
    label: "Gemini 2.5 Pro TTS",
    tier: "premium" as const,
    description: "Gemini 2.5 Pro 高品質情感語音合成",
    supportsMultiSpeaker: true,
    languages: [
      "zh-TW",
      "zh-CN",
      "en-US",
      "ja-JP",
      "ko-KR",
      "fr-FR",
      "de-DE",
      "es-ES",
    ],
  },
] as const;

// 可用語音名稱（Gemini TTS）
export const GEMINI_TTS_VOICES = [
  { voiceId: "Zephyr", label: "Zephyr（亮麗）", gender: "female" },
  { voiceId: "Puck", label: "Puck（活潑）", gender: "male" },
  { voiceId: "Charon", label: "Charon（沉穩）", gender: "male" },
  { voiceId: "Kore", label: "Kore（堅定）", gender: "female" },
  { voiceId: "Fenrir", label: "Fenrir（激昂）", gender: "male" },
  { voiceId: "Aoede", label: "Aoede（悅耳）", gender: "female" },
  { voiceId: "Leda", label: "Leda（年輕）", gender: "female" },
  { voiceId: "Orus", label: "Orus（平靜）", gender: "male" },
] as const;

// ─── LangSmith 追蹤（Gemini 多媒體模型深度整合）──────────────────────────────

let _geminiLSClient: import("langsmith").Client | null = null;
async function getGeminiLSClient(): Promise<import("langsmith").Client | null> {
  const key = serverEnv.LANGSMITH_API_KEY;
  if (!key) return null;
  if (_geminiLSClient) return _geminiLSClient;
  try {
    const { Client } = await import("langsmith");
    _geminiLSClient = new Client({
      apiKey: key,
      apiUrl:
        serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
    });
    return _geminiLSClient;
  } catch {
    return null;
  }
}

async function trackGeminiMedia(opts: {
  runName: string;
  model: string;
  inputs: Record<string, unknown>;
  outputKeys?: string[];
  error?: string;
  durationMs: number;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}): Promise<void> {
  const client = await getGeminiLSClient();
  if (!client) return;
  const projectName = serverEnv.LANGSMITH_PROJECT || "網站";
  const endTime = Date.now();
  try {
    await client.createRun({
      id: `gemini-${endTime}-${Math.random().toString(36).slice(2, 8)}`,
      name: opts.runName,
      run_type: "tool",
      project_name: projectName,
      start_time: endTime - opts.durationMs,
      end_time: endTime,
      inputs: opts.inputs,
      outputs: {
        ...(opts.outputKeys ? { output_keys: opts.outputKeys } : {}),
        token_usage: {
          prompt_tokens: opts.tokenUsage?.promptTokens ?? 0,
          completion_tokens: opts.tokenUsage?.completionTokens ?? 0,
          total_tokens: opts.tokenUsage?.totalTokens ?? 0,
        },
      },
      error: opts.error,
      extra: {
        metadata: {
          provider: "gemini",
          model: opts.model,
          duration_ms: opts.durationMs,
        },
      },
    });
  } catch {
    /* 追蹤失敗不影響主流程 */
  }
}

// ─── Gemini Media Client ───────────────────────────────────────────────────

export class GeminiMediaClient {
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com";

  constructor() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY 未設定");
    this.apiKey = key;
  }

  get isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  /**
   * 統一 Gemini HTTP 呼叫：
   * - timeout + retry（共用 safeApiCall）
   * - 保留 status / headers 供 retry 判斷（429/5xx）
   */
  private async geminiJson<T>(
    label: string,
    url: string,
    init: RequestInit,
    cfg: { timeoutMs?: number; maxRetries?: number } = {}
  ): Promise<T> {
    const { data } = await safeApiCall(
      async () => {
        const res = await fetch(url, init);
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw Object.assign(
            new Error(`Gemini API error ${res.status}: ${errText}`),
            { status: res.status, headers: res.headers }
          );
        }
        return res.json() as Promise<T>;
      },
      label,
      {
        timeoutMs: cfg.timeoutMs ?? 60_000,
        maxRetries: cfg.maxRetries ?? 2,
      }
    );
    return data;
  }

  // ── 圖片生成（Imagen） ───────────────────────────────────────────────────
  async generateImage(params: GeminiImageParams): Promise<GeminiImageResult> {
    const model = params.model ?? "imagen-3.0-generate-002";
    const url = `${this.baseUrl}/v1beta/models/${model}:predict?key=${this.apiKey}`;
    const startMs = Date.now();

    const body: Record<string, unknown> = {
      instances: [
        {
          prompt: params.prompt,
          ...(params.negativePrompt && {
            negativePrompt: params.negativePrompt,
          }),
        },
      ],
      parameters: {
        sampleCount: params.numImages ?? 1,
        ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
        ...(params.seed != null && { seed: params.seed }),
        ...(params.safetyFilterLevel && {
          safetySetting: params.safetyFilterLevel,
        }),
        ...(params.personGeneration && {
          personGeneration: params.personGeneration,
        }),
        ...(params.addWatermark != null && {
          addWatermark: params.addWatermark,
        }),
      },
    };

    let data: any;
    try {
      data = await this.geminiJson<any>(
        `Gemini:Imagen:${model}`,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { timeoutMs: 60_000, maxRetries: 2 }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trackGeminiMedia({
        runName: `gemini/imagen/${model}`,
        model,
        inputs: {
          prompt: params.prompt,
          numImages: params.numImages,
          aspectRatio: params.aspectRatio,
        },
        error: errMsg,
        durationMs: Date.now() - startMs,
      }).catch(() => {});
      throw new Error(errMsg);
    }
    const predictions = data.predictions ?? [];
    trackGeminiMedia({
      runName: `gemini/imagen/${model}`,
      model,
      inputs: {
        prompt: params.prompt,
        numImages: params.numImages,
        aspectRatio: params.aspectRatio,
      },
      outputKeys: ["images"],
      durationMs: Date.now() - startMs,
    }).catch(() => {});

    return {
      images: predictions.map((p: any) => ({
        base64: p.bytesBase64Encoded ?? "",
        mimeType: p.mimeType ?? "image/png",
      })),
      model,
      generationParams: params as unknown as Record<string, unknown>,
    };
  }

  // ── 影片生成（Veo） ──────────────────────────────────────────────────────
  async generateVideo(params: GeminiVideoParams): Promise<GeminiVideoResult> {
    const model = params.model ?? "veo-2.0-generate-001";
    const url = `${this.baseUrl}/v1beta/models/${model}:predictLongRunning?key=${this.apiKey}`;
    const startMs = Date.now();

    const instance: Record<string, unknown> = {
      prompt: params.prompt,
    };

    // 圖生影：加入首幀圖片
    if (params.imageUrl) {
      if (params.imageUrl.startsWith("data:")) {
        // data URL → 直接解析 base64
        const [mimeMatch, b64] = params.imageUrl.split(",");
        const mimeType = mimeMatch.replace("data:", "").replace(";base64", "");
        instance.image = { bytesBase64Encoded: b64, mimeType };
      } else if (params.imageUrl.startsWith("gs://")) {
        // GCS URI → 直接傳 gcsUri
        instance.image = { gcsUri: params.imageUrl };
      } else {
        // DEF-11 修正：HTTP URL 需下載轉 base64（gcsUri 只接受 gs:// 不接受 https://）
        // AIDV-322：下載前先過 SSRF 守衛，防止 imageUrl 指向私網 / IMDS
        assertSafeExternalUrl(params.imageUrl);
        try {
          const imgRes = await fetch(params.imageUrl, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!imgRes.ok) throw new Error(`無法下載圖片 ${imgRes.status}`);
          const mimeType = imgRes.headers.get("content-type") ?? "image/jpeg";
          const arrayBuf = await imgRes.arrayBuffer();
          const b64 = Buffer.from(arrayBuf).toString("base64");
          instance.image = { bytesBase64Encoded: b64, mimeType };
        } catch (e) {
          throw new Error(
            `圖生影圖片下載失敗（DEF-11）：${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }

    const body = {
      instances: [instance],
      parameters: {
        ...(params.duration && { durationSeconds: params.duration }),
        ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
        ...(params.negativePrompt && { negativePrompt: params.negativePrompt }),
        ...(params.seed != null && { seed: params.seed }),
        ...(params.fps && { fps: params.fps }),
        sampleCount: params.sampleCount ?? 1,
      },
    };

    let data: any;
    try {
      data = await this.geminiJson<any>(
        `Gemini:Veo:${model}`,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { timeoutMs: 90_000, maxRetries: 2 }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trackGeminiMedia({
        runName: `gemini/veo/${model}`,
        model,
        inputs: {
          prompt: params.prompt,
          imageUrl: params.imageUrl ? "[provided]" : undefined,
          duration: params.duration,
        },
        error: errMsg,
        durationMs: Date.now() - startMs,
      }).catch(() => {});
      throw new Error(errMsg);
    }
    trackGeminiMedia({
      runName: `gemini/veo/${model}`,
      model,
      inputs: {
        prompt: params.prompt,
        imageUrl: params.imageUrl ? "[provided]" : undefined,
        duration: params.duration,
      },
      outputKeys: ["operationName"],
      durationMs: Date.now() - startMs,
    }).catch(() => {});
    return {
      operationName: data.name ?? "",
      status: "processing",
    };
  }

  /** 查詢 Veo 長時間操作狀態 */
  async pollVideoOperation(operationName: string): Promise<GeminiVideoResult> {
    const url = `${this.baseUrl}/v1beta/${operationName}?key=${this.apiKey}`;
    const data = await this.geminiJson<any>(
      "Gemini:VeoOperationStatus",
      url,
      {
        headers: { "Content-Type": "application/json" },
      },
      { timeoutMs: 20_000, maxRetries: 1 }
    );

    if (data.done) {
      if (data.error) {
        throw new Error(`Veo 生成失敗: ${JSON.stringify(data.error)}`);
      }
      const videos = (data.response?.predictions ?? []).map((p: any) => ({
        uri: p.video?.uri ?? p.gcsUri ?? "",
        mimeType: p.video?.mimeType ?? "video/mp4",
      }));
      return { operationName, videos, status: "completed" };
    }

    return { operationName, status: "processing" };
  }

  /** Veo 生成 + 輪詢（最長5分鐘） */
  async generateVideoSync(
    params: GeminiVideoParams,
    maxWaitMs = 300_000
  ): Promise<{ videoUrl: string; mimeType: string }> {
    const initResult = await this.generateVideo(params);
    const startTime = Date.now();
    const pollInterval = 5_000;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollInterval));
      const result = await this.pollVideoOperation(initResult.operationName);

      if (result.status === "completed" && result.videos?.length) {
        return {
          videoUrl: result.videos[0].uri,
          mimeType: result.videos[0].mimeType,
        };
      }
    }

    throw new Error(`Veo 影片生成超時（${maxWaitMs / 1000}s）`);
  }

  // ── 音樂生成（Lyria / MusicFX） ──────────────────────────────────────────
  async generateAudio(params: GeminiAudioParams): Promise<GeminiAudioResult> {
    const model = params.model ?? "lyria-002";
    const url = `${this.baseUrl}/v1beta/models/${model}:predict?key=${this.apiKey}`;
    const startMs = Date.now();

    const body = {
      instances: [{ prompt: params.prompt }],
      parameters: {
        ...(params.duration && { durationSeconds: params.duration }),
        ...(params.seed != null && { seed: params.seed }),
        ...(params.temperature != null && { temperature: params.temperature }),
        ...(params.guidance != null && { guidanceScale: params.guidance }),
      },
    };

    let data: any;
    try {
      data = await this.geminiJson<any>(
        `Gemini:Audio:${model}`,
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { timeoutMs: 60_000, maxRetries: 2 }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      trackGeminiMedia({
        runName: `gemini/audio/${model}`,
        model,
        inputs: { prompt: params.prompt, duration: params.duration },
        error: errMsg,
        durationMs: Date.now() - startMs,
      }).catch(() => {});
      throw new Error(errMsg);
    }
    const prediction = data.predictions?.[0] ?? {};
    trackGeminiMedia({
      runName: `gemini/audio/${model}`,
      model,
      inputs: { prompt: params.prompt, duration: params.duration },
      outputKeys: ["audioBase64"],
      durationMs: Date.now() - startMs,
    }).catch(() => {});

    return {
      audioBase64:
        prediction.bytesBase64Encoded ?? prediction.audioContent ?? "",
      mimeType: prediction.mimeType ?? "audio/wav",
      duration: params.duration ?? 15,
    };
  }

  // ── 語音合成（Gemini TTS） ────────────────────────────────────────────────
  async textToSpeech(params: GeminiTTSParams): Promise<GeminiTTSResult> {
    const model = params.model ?? "gemini-2.5-flash-preview-tts";
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    // Gemini TTS 使用 generateContent API，但加上 responseModalities
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: params.text }],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: params.voiceName ?? "Zephyr",
            },
          },
        },
      },
    };

    const data = await this.geminiJson<any>(
      `Gemini:TTS:${model}`,
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { timeoutMs: 45_000, maxRetries: 2 }
    );
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const inlineData = part?.inlineData;

    return {
      audioBase64: inlineData?.data ?? "",
      mimeType: inlineData?.mimeType ?? "audio/wav",
    };
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _geminiMedia: GeminiMediaClient | null = null;

export function getGeminiMediaClient(): GeminiMediaClient {
  if (!_geminiMedia) {
    _geminiMedia = new GeminiMediaClient();
  }
  return _geminiMedia;
}
