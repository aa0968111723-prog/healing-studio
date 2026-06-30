/**
 * elevenLabsExtended.ts — ElevenLabs 完整功能服務
 *
 * 功能：
 *   - TTS V2/V3    文字轉語音（多語言、情感、多角色）
 *   - Sound Effects 音效生成
 *   - Music Gen    音樂生成
 *   - Voice Clone  聲音克隆
 *   - Voice Changer 聲音轉換
 *   - Dubbing       影片配音
 *   - Transcription 語音轉文字
 */

import {
  resolveProviderBaseUrl,
  providerGatewayHeaders,
} from "../_core/providerFacade";
import { withExponentialBackoff } from "../utils/withExponentialBackoff";
import { assertSafeUrl } from "../lib/urlValidator";

// ─── Models & Voices Catalog ─────────────────────────────────────────────

export const ELEVENLABS_TTS_MODELS = [
  {
    value: "eleven_v3",
    label: "Eleven V3（最新）",
    tier: "premium" as const,
    description: "最新版TTS，超自然情感，對話場景最佳",
    supportsEmotionTags: true,
    supportsMultiSpeaker: true,
    languages: 70,
  },
  {
    value: "eleven_multilingual_v2",
    label: "Eleven Multilingual V2",
    tier: "premium" as const,
    description: "多語言旗艦版，29種語言，低延遲",
    supportsEmotionTags: false,
    supportsMultiSpeaker: false,
    languages: 29,
  },
  {
    value: "eleven_turbo_v2_5",
    label: "Eleven Turbo V2.5",
    tier: "fast" as const,
    description: "高速低延遲，串流播放最佳化",
    supportsEmotionTags: false,
    supportsMultiSpeaker: false,
    languages: 32,
  },
  {
    value: "eleven_flash_v2_5",
    label: "Eleven Flash V2.5",
    tier: "fast" as const,
    description: "極速推理，成本最低",
    supportsEmotionTags: false,
    supportsMultiSpeaker: false,
    languages: 32,
  },
  {
    value: "eleven_monolingual_v1",
    label: "Eleven Monolingual V1",
    tier: "standard" as const,
    description: "英語專用，穩定可靠",
    supportsEmotionTags: false,
    supportsMultiSpeaker: false,
    languages: 1,
  },
] as const;

export const ELEVENLABS_BUILTIN_VOICES = [
  {
    voiceId: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    gender: "female",
    accent: "American",
    description: "平靜、年輕，適合敘事",
  },
  {
    voiceId: "AZnzlk1XvdvUeBnXmlld",
    name: "Domi",
    gender: "female",
    accent: "American",
    description: "強勢、自信",
  },
  {
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    name: "Bella",
    gender: "female",
    accent: "American",
    description: "柔和、溫暖",
  },
  {
    voiceId: "ErXwobaYiN019PkySvjV",
    name: "Antoni",
    gender: "male",
    accent: "American",
    description: "溫暖正向，適合對話",
  },
  {
    voiceId: "MF3mGyEYCl7XYWbV9V6O",
    name: "Elli",
    gender: "female",
    accent: "American",
    description: "情感豐富，年輕",
  },
  {
    voiceId: "TxGEqnHWrfWFTfGW9XjX",
    name: "Josh",
    gender: "male",
    accent: "American",
    description: "低沉、成熟",
  },
  {
    voiceId: "VR6AewLTigWG4xSOukaG",
    name: "Arnold",
    gender: "male",
    accent: "American",
    description: "成熟男性，有份量",
  },
  {
    voiceId: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    gender: "male",
    accent: "American",
    description: "深沉，紀錄片敘事",
  },
  {
    voiceId: "yoZ06aMxZJJ28mfd3POQ",
    name: "Sam",
    gender: "male",
    accent: "American",
    description: "理性平穩",
  },
  {
    voiceId: "g5CIjZEefAph4nQFvHAz",
    name: "Ethan",
    gender: "male",
    accent: "American",
    description: "年輕熱情",
  },
  {
    voiceId: "jBpfuIE2acCO8z3wKNLl",
    name: "Freya",
    gender: "female",
    accent: "British",
    description: "優雅英式口音",
  },
  {
    voiceId: "oWAxZDx7w5VEj9dCyTzz",
    name: "Grace",
    gender: "female",
    accent: "British",
    description: "溫柔英式",
  },
  {
    voiceId: "z9fAnlkpzviPz146aGWa",
    name: "Glinda",
    gender: "female",
    accent: "American",
    description: "甜美、魔法感",
  },
  {
    voiceId: "piTKgcLEGmPE4e6mEKli",
    name: "Nicole",
    gender: "female",
    accent: "American",
    description: "耳語質感，ASMR",
  },
  {
    voiceId: "onwK4e9ZLuTAKqWW03F9",
    name: "Daniel",
    gender: "male",
    accent: "British",
    description: "英式男性，新聞主播感",
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────

export interface ElevenLabsTTSV3Params {
  text: string;
  voiceId?: string;
  modelId?: string;
  stability?: number; // 0~1
  similarityBoost?: number; // 0~1
  style?: number; // 0~1 (style exaggeration)
  useSpeakerBoost?: boolean;
  speed?: number; // 0.7~1.2
  emotionTags?: string[]; // ["[excited]", "[whispers]", etc.]
}

export interface ElevenLabsSoundEffectParams {
  text: string;
  durationSeconds?: number; // 0.5~22
  promptInfluence?: number; // 0~1
}

export interface ElevenLabsMusicParams {
  prompt: string;
  durationSeconds?: number; // 10~300
}

export interface ElevenLabsVoiceCloneParams {
  name: string;
  audioUrls: string[]; // 1-25 audio samples
  description?: string;
  removeBackgroundNoise?: boolean;
}

export interface ElevenLabsDubbingParams {
  videoUrl: string;
  targetLanguage: string; // BCP-47
  sourceLanguage?: string;
  numSpeakers?: number;
  watermark?: boolean;
  startTime?: number;
  endTime?: number;
}

export interface ElevenLabsTranscriptionParams {
  audioUrl: string;
  modelId?: "scribe_v1" | "scribe_v2_flash";
  languageCode?: string;
  diarize?: boolean;
  timestampsGranularity?: "word" | "character";
}

// ─── Extended ElevenLabs Client ────────────────────────────────────────────

export class ElevenLabsExtendedClient {
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY ?? null;
  }

  /** base URL 走統一門面（CF AI Gateway 啟用時自動換軌），呼叫時才解析。 */
  private get baseUrl(): string {
    return `${resolveProviderBaseUrl("elevenlabs")}/v1`;
  }

  get isAvailable(): boolean {
    return !!this.apiKey;
  }

  private async fetch(
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY 未設定");
    const apiKey = this.apiKey;

    return withExponentialBackoff(
      async () => {
        const res = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: {
            "xi-api-key": apiKey,
            ...providerGatewayHeaders("elevenlabs"),
            ...(options.body && typeof options.body === "string"
              ? { "Content-Type": "application/json" }
              : {}),
            ...options.headers,
          },
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`ElevenLabs API ${res.status}: ${errText.slice(0, 300)}`);
        }

        return res;
      },
      {
        maxRetries: 3,
        base: 500,
        shouldRetry: (err) => {
          if (!(err instanceof Error)) return false;
          return /ElevenLabs API (429|5\d\d):/.test(err.message);
        },
      }
    );
  }

  // ── TTS V3（最新，支援情感標籤） ────────────────────────────────────────
  async textToSpeechV3(params: ElevenLabsTTSV3Params): Promise<Buffer> {
    const voiceId = params.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const modelId = params.modelId ?? "eleven_v3";

    // 插入情感標籤到文字中（若有）
    let text = params.text;
    if (params.emotionTags?.length) {
      text = params.emotionTags.join(" ") + " " + text;
    }

    const res = await this.fetch(`/text-to-speech/${voiceId}`, {
      method: "POST",
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: params.stability ?? 0.5,
          similarity_boost: params.similarityBoost ?? 0.75,
          ...(params.style != null && { style: params.style }),
          ...(params.useSpeakerBoost != null && {
            use_speaker_boost: params.useSpeakerBoost,
          }),
          ...(params.speed != null && { speed: params.speed }),
        },
      }),
    });

    return Buffer.from(await res.arrayBuffer());
  }

  // ── TTS with streaming（低延遲） ─────────────────────────────────────────
  async textToSpeechStream(
    params: ElevenLabsTTSV3Params
  ): Promise<ReadableStream> {
    const voiceId = params.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const modelId = params.modelId ?? "eleven_turbo_v2_5";

    const res = await this.fetch(`/text-to-speech/${voiceId}/stream`, {
      method: "POST",
      body: JSON.stringify({
        text: params.text,
        model_id: modelId,
        voice_settings: {
          stability: params.stability ?? 0.5,
          similarity_boost: params.similarityBoost ?? 0.75,
        },
      }),
    });

    return res.body!;
  }

  // ── Sound Effects ────────────────────────────────────────────────────────
  async generateSoundEffect(
    params: ElevenLabsSoundEffectParams
  ): Promise<Buffer> {
    const res = await this.fetch("/sound-generation", {
      method: "POST",
      body: JSON.stringify({
        text: params.text,
        ...(params.durationSeconds && {
          duration_seconds: params.durationSeconds,
        }),
        ...(params.promptInfluence != null && {
          prompt_influence: params.promptInfluence,
        }),
      }),
    });

    return Buffer.from(await res.arrayBuffer());
  }

  // ── Music Generation ─────────────────────────────────────────────────────
  async generateMusic(params: ElevenLabsMusicParams): Promise<Buffer> {
    const res = await this.fetch("/audio-generation", {
      method: "POST",
      body: JSON.stringify({
        text: params.prompt,
        ...(params.durationSeconds && {
          duration_seconds: params.durationSeconds,
        }),
      }),
    });

    return Buffer.from(await res.arrayBuffer());
  }

  // ── Voice Cloning ────────────────────────────────────────────────────────
  async cloneVoice(
    params: ElevenLabsVoiceCloneParams
  ): Promise<{ voiceId: string; name: string }> {
    const formData = new FormData();
    formData.append("name", params.name);
    if (params.description) formData.append("description", params.description);
    if (params.removeBackgroundNoise != null) {
      formData.append(
        "remove_background_noise",
        String(params.removeBackgroundNoise)
      );
    }

    // Fetch audio files and append
    for (let i = 0; i < params.audioUrls.length; i++) {
      assertSafeUrl(params.audioUrls[i]);
      const audioRes = await fetch(params.audioUrls[i]);
      const blob = await audioRes.blob();
      formData.append("files", blob, `sample_${i}.mp3`);
    }

    const res = await this.fetch("/voices/add", {
      method: "POST",
      body: formData,
      headers: {}, // let browser set Content-Type with boundary
    });

    const data = (await res.json()) as any;
    return { voiceId: data.voice_id, name: params.name };
  }

  // ── Dubbing ──────────────────────────────────────────────────────────────
  async createDubbing(
    params: ElevenLabsDubbingParams
  ): Promise<{ dubbingId: string; expectedDurationSec: number }> {
    const formData = new FormData();
    formData.append("target_lang", params.targetLanguage);
    if (params.sourceLanguage)
      formData.append("source_lang", params.sourceLanguage);
    if (params.numSpeakers != null)
      formData.append("num_speakers", String(params.numSpeakers));
    if (params.watermark != null)
      formData.append("watermark", String(params.watermark));
    if (params.startTime != null)
      formData.append("start_time", String(params.startTime));
    if (params.endTime != null)
      formData.append("end_time", String(params.endTime));
    formData.append("mode", "automatic");

    // Fetch video
    assertSafeUrl(params.videoUrl);
    const videoRes = await fetch(params.videoUrl);
    const videoBlob = await videoRes.blob();
    formData.append("file", videoBlob, "video.mp4");

    const res = await this.fetch("/dubbing", {
      method: "POST",
      body: formData,
      headers: {},
    });

    const data = (await res.json()) as any;
    return {
      dubbingId: data.dubbing_id,
      expectedDurationSec: data.expected_duration_sec ?? 60,
    };
  }

  /** 查詢配音狀態 */
  async getDubbingStatus(
    dubbingId: string
  ): Promise<{ status: string; error?: string }> {
    const res = await this.fetch(`/dubbing/${dubbingId}`);
    const data = (await res.json()) as any;
    return { status: data.status, error: data.error };
  }

  /** 下載配音結果（返回 Buffer） */
  async getDubbingAudio(dubbingId: string, language: string): Promise<Buffer> {
    const res = await this.fetch(`/dubbing/${dubbingId}/audio/${language}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // ── Transcription (Scribe) ───────────────────────────────────────────────
  async transcribe(params: ElevenLabsTranscriptionParams): Promise<{
    text: string;
    words: Array<{
      text: string;
      start: number;
      end: number;
      speaker?: string;
    }>;
  }> {
    const formData = new FormData();
    formData.append("model_id", params.modelId ?? "scribe_v1");
    if (params.languageCode)
      formData.append("language_code", params.languageCode);
    if (params.diarize != null)
      formData.append("diarize", String(params.diarize));
    if (params.timestampsGranularity) {
      formData.append("timestamps_granularity", params.timestampsGranularity);
    }

    // Fetch audio
    assertSafeUrl(params.audioUrl);
    const audioRes = await fetch(params.audioUrl);
    const audioBlob = await audioRes.blob();
    formData.append("file", audioBlob, "audio.mp3");

    const res = await this.fetch("/speech-to-text", {
      method: "POST",
      body: formData,
      headers: {},
    });

    const data = (await res.json()) as any;
    return {
      text: data.text ?? "",
      words: (data.words ?? []).map((w: any) => ({
        text: w.text ?? "",
        start: w.start ?? 0,
        end: w.end ?? 0,
        speaker: w.speaker_id,
      })),
    };
  }

  // ── List Voices ──────────────────────────────────────────────────────────
  async listVoices(): Promise<
    Array<{
      voiceId: string;
      name: string;
      category: string;
      description: string;
      previewUrl: string;
      labels: Record<string, string>;
    }>
  > {
    const res = await this.fetch("/voices");
    const data = (await res.json()) as any;

    return (data.voices ?? []).map((v: any) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category ?? "premade",
      description: v.description ?? "",
      previewUrl: v.preview_url ?? "",
      labels: v.labels ?? {},
    }));
  }

  // ── Get Models ───────────────────────────────────────────────────────────
  async listModels(): Promise<
    Array<{
      modelId: string;
      name: string;
      description: string;
      canBeFineTuned: boolean;
      languages: Array<{ languageId: string; name: string }>;
    }>
  > {
    const res = await this.fetch("/models");
    const data = (await res.json()) as any;

    return (Array.isArray(data) ? data : []).map((m: any) => ({
      modelId: m.model_id,
      name: m.name,
      description: m.description ?? "",
      canBeFineTuned: m.can_be_finetuned ?? false,
      languages: (m.languages ?? []).map((l: any) => ({
        languageId: l.language_id,
        name: l.name,
      })),
    }));
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _elevenLabs: ElevenLabsExtendedClient | null = null;

export function getElevenLabsExtendedClient(): ElevenLabsExtendedClient {
  if (!_elevenLabs) {
    _elevenLabs = new ElevenLabsExtendedClient();
  }
  return _elevenLabs;
}
