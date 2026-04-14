/**
 * proStudio.ts — 專業創作室 Router
 *
 * 整合 fal.ai 音訊/語音/影片模型，提供統一的 tRPC API 介面。
 *
 * ──────────────────────────────────────────────────────────────
 * ⚠️  API 對接注意事項（v2026-04 修正版）
 * ──────────────────────────────────────────────────────────────
 *
 * 1. Qwen3 Clone Voice (fal-ai/qwen-3-tts/clone-voice/1.7b)
 *    - 只接受 { audio_url, reference_text? }
 *    - 回傳 speaker_embedding（.safetensors 檔案），不是音訊
 *    - 要生成音訊需再呼叫 qwenTTS 並傳入 speaker_voice_embedding_file_url
 *
 * 2. Dia TTS (fal-ai/dia-tts/voice-clone)
 *    - 只接受 { text }，沒有 reference_audio_url
 *    - 用 [S1]/[S2] 標籤標注多說話者
 *
 * 3. Demucs (fal-ai/demucs)
 *    - htdemucs / htdemucs_ft：支援 vocals/drums/bass/other（4 幹）
 *    - htdemucs_6s：額外支援 guitar/piano（6 幹）
 *    - output_format 只支援 "wav" | "mp3"（flac 不支援）
 *
 * 4. Nemotron ASR (fal-ai/nemotron/asr/stream)
 *    - 只接受 { audio_url, acceleration? }
 *    - 沒有 language / task 參數
 *    - 是 SSE 串流端點，必須用 falQueue（submit → poll → result）
 *    - 後端需解析串流並提取最終文字後回傳標準 JSON
 *
 * 5. Sonauto (sonauto/v2/text-to-music)
 *    - 歌詞參數名稱：lyrics_prompt（不是 lyrics）
 *    - 沒有 duration 參數；tags 是陣列而非字串
 *    - 不能同時傳 prompt + tags + lyrics_prompt（只能兩兩組合）
 *    - 音樂生成耗時長（1-3分鐘），必須用 falQueue 非同步
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ─── fal.ai 呼叫工具 ──────────────────────────────────────────────────────────

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RUN_BASE   = "https://fal.run";

function getFalKey(): string {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定，請在 Railway → Environment Variables 中新增" });
  return key;
}

/** 使用 queue 非同步提交任務，立即回傳 request_id */
async function falQueueSubmit(
  modelId: string,
  input: Record<string, unknown>
): Promise<{ request_id: string }> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai submit 錯誤 [${modelId}]: ${err}` });
  }
  return res.json();
}

/** 查詢 queue 任務狀態 */
async function falQueueStatus(requestId: string, modelId: string): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`, {
    headers: { "Authorization": `Key ${key}` },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "查詢狀態失敗" });
  return res.json();
}

/** 取得 queue 任務結果 */
async function falQueueResult(requestId: string, modelId: string): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`, {
    headers: { "Authorization": `Key ${key}` },
  });
  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "取得結果失敗" });
  return res.json();
}

/**
 * falRun — 同步呼叫（適合快速模型，如 TTS、音效）
 * 使用 fal.run（非 queue），timeout 較短。
 * ⚠️ 音樂生成、ASR 等長時任務不得用此函數。
 */
async function falRun(modelId: string, input: Record<string, unknown>): Promise<unknown> {
  const key = getFalKey();
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: { "Authorization": `Key ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    // 使用 signal 讓外層可設置 timeout
    signal: AbortSignal.timeout(90_000), // 90 秒
  });
  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai 錯誤 [${modelId}]: ${err}` });
  }
  return res.json();
}

/**
 * falQueueRun — 非同步 queue 呼叫（適合長時任務）
 * submit → 輪詢最多 waitSec 秒 → 取結果
 */
async function falQueueRun(
  modelId: string,
  input: Record<string, unknown>,
  waitSec = 300 // 參數已废棄，改由前端 Polling
): Promise<unknown> {
  const { request_id } = await falQueueSubmit(modelId, input);
  // 直接回傳 request_id，不等待結果
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}

// ─── 音樂 & 音效模型清單 ──────────────────────────────────────────────────────

/** 可用的音樂生成模型 */
const MUSIC_MODELS = [
  { id: "sonauto",      label: "Sonauto v2",     description: "完整歌曲生成，支援歌詞 & 風格標籤（1-3 分鐘）", badge: "預設", tier: "premium" as const },
  { id: "ace-step",     label: "ACE-Step",        description: "高品質音樂生成，支援自訂時長", badge: "推薦", tier: "premium" as const },
  { id: "stable-audio", label: "Stable Audio",    description: "高品質音樂/音效（最長 3 分鐘）", badge: "", tier: "premium" as const },
  { id: "musicgen",     label: "MusicGen (Meta)", description: "Meta 開源音樂模型，輕量快速", badge: "快速", tier: "standard" as const },
];

/** 可用的音效生成模型 */
const SFX_MODELS = [
  { id: "stable-audio", label: "Stable Audio",   description: "真實環境音效 & Foley 音效（最長 3 分鐘）", badge: "預設", tier: "premium" as const },
  { id: "audioldm2",    label: "AudioLDM 2",     description: "音頻潛在擴散模型，擅長自然音效", badge: "", tier: "standard" as const },
  { id: "elevenlabs",   label: "ElevenLabs SFX",  description: "ElevenLabs 音效（最長 22 秒，部分描述可能產生語音）", badge: "備用", tier: "standard" as const },
];

/** 背景任務超時閾值（毫秒）— 超過此時間未完成則標記失敗 */
const ASYNC_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘

// ─── Router ──────────────────────────────────────────────────────────────────

export const proStudioRouter = router({

  /** 取得 FAL_API_KEY 是否設定（前端用來顯示提示） */
  checkApiKey: publicProcedure.query(() => {
    return { configured: !!process.env.FAL_API_KEY };
  }),

  // ═══════════════════════════════════════════════════════════════
  // 🎵 音樂生成
  // ═══════════════════════════════════════════════════════════════

  /** 可用的音樂生成模型清單（前端使用） */
  musicModels: publicProcedure.query(() => MUSIC_MODELS),

  /**
   * 文字轉音樂 — 支援多模型切換
   *
   * 可用模型：
   *  1. sonauto/v2/text-to-music（預設）— 完整歌曲，支援歌詞 + tags
   *  2. fal-ai/ace-step           — 高品質音樂，支援 prompt + duration
   *  3. fal-ai/stable-audio       — 音效/音樂皆可，支援 duration + negative_prompt
   *  4. fal-ai/musicgen           — Meta MusicGen，支援 prompt + duration
   *
   * 當主模型失敗時前端可切換至其他備選模型重試。
   */
  textToMusic: protectedProcedure
    .input(z.object({
      prompt:       z.string().min(1).max(2000).optional(),
      lyrics:       z.string().optional(),         // 前端傳的歌詞文字，對應 Sonauto API 的 lyrics_prompt
      tags:         z.string().optional(),         // 逗號分隔的標籤字串，轉換為陣列
      instrumental: z.boolean().optional(),        // true → 傳空字串歌詞（純音樂）
      bpm:          z.number().min(40).max(300).optional(),
      duration:     z.number().min(1).max(300).optional(), // 秒數（非 Sonauto 模型用）
      model:        z.enum(["sonauto", "ace-step", "stable-audio", "musicgen"]).optional().default("sonauto"),
    }))
    .mutation(async ({ input }) => {
      const modelChoice = input.model ?? "sonauto";

      // ── Sonauto v2（預設）─────────────────────────────────────
      if (modelChoice === "sonauto") {
        const payload: Record<string, unknown> = {};
        if (input.prompt) payload.prompt = input.prompt;
        if (input.tags) {
          const tagsArr = input.tags.split(",").map(t => t.trim()).filter(Boolean);
          if (tagsArr.length > 0) payload.tags = tagsArr;
        }
        const hasPrompt = !!payload.prompt;
        const hasTags   = !!payload.tags;
        if (input.instrumental) {
          payload.lyrics_prompt = "";
        } else if (input.lyrics && !(hasPrompt && hasTags)) {
          payload.lyrics_prompt = input.lyrics;
        }
        if (!payload.prompt && !payload.tags) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "請至少提供音樂描述（prompt）或風格標籤（tags）" });
        }
        if (input.bpm) payload.bpm = input.bpm;
        payload.output_format = "mp3";
        payload.num_songs = 1;

        const falModelId = "sonauto/v2/text-to-music";
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }

      // ── 通用 prompt（非 Sonauto 模型）──────────────────────────
      // 組合 prompt + tags + 情境 為單一描述字串
      const parts: string[] = [];
      if (input.prompt) parts.push(input.prompt);
      if (input.tags) parts.push(input.tags);
      if (input.instrumental) parts.push("instrumental, no vocals");
      const combinedPrompt = parts.join(", ") || "relaxing ambient music";

      // ── ACE-Step ──────────────────────────────────────────────
      if (modelChoice === "ace-step") {
        const falModelId = "fal-ai/ace-step";
        const payload: Record<string, unknown> = {
          prompt: combinedPrompt,
          ...(input.duration ? { duration: input.duration } : {}),
        };
        if (input.lyrics && !input.instrumental) {
          payload.lyrics = input.lyrics;
        }
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }

      // ── Stable Audio ──────────────────────────────────────────
      if (modelChoice === "stable-audio") {
        const falModelId = "fal-ai/stable-audio";
        const payload: Record<string, unknown> = {
          prompt: combinedPrompt,
          ...(input.duration ? { seconds_total: input.duration } : { seconds_total: 30 }),
        };
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }

      // ── MusicGen ──────────────────────────────────────────────
      {
        const falModelId = "fal-ai/musicgen";
        const payload: Record<string, unknown> = {
          prompt: combinedPrompt,
          ...(input.duration ? { duration: input.duration } : {}),
        };
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🔊 音效生成
  // ═══════════════════════════════════════════════════════════════

  /** 可用的音效生成模型清單（前端使用） */
  sfxModels: publicProcedure.query(() => SFX_MODELS),

  /**
   * AI 音效生成 — 支援多模型切換
   *
   * 可用模型：
   *  1. fal-ai/stable-audio（預設）— 真正的環境音效/Foley 音效，非語音
   *  2. fal-ai/audioldm2          — 音頻潛在擴散模型，擅長環境音效
   *  3. fal-ai/elevenlabs/sound-effects/v2 — ElevenLabs（備用，部分描述可能產生語音）
   *
   * ⚠️ 原先使用 ElevenLabs Sound Effects 會產生「配音說話」而非音效，
   *    已改為 Stable Audio 作為預設模型。
   */
  soundEffects: protectedProcedure
    .input(z.object({
      text:              z.string().min(1).max(500),
      duration_seconds:  z.number().min(0.5).max(180).optional(),
      prompt_influence:  z.number().min(0).max(1).optional().default(0.3),
      model:             z.enum(["stable-audio", "audioldm2", "elevenlabs"]).optional().default("stable-audio"),
    }))
    .mutation(async ({ input }) => {
      const modelChoice = input.model ?? "stable-audio";

      // ── Stable Audio（預設）── 真正的音效生成 ──────────────────
      if (modelChoice === "stable-audio") {
        const falModelId = "fal-ai/stable-audio";
        const payload: Record<string, unknown> = {
          prompt: input.text,
          seconds_total: input.duration_seconds ?? 10,
        };
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }

      // ── AudioLDM2 ── 音頻潛在擴散，擅長環境音效 ────────────────
      if (modelChoice === "audioldm2") {
        const falModelId = "fal-ai/audioldm2";
        const payload: Record<string, unknown> = {
          prompt: input.text,
          ...(input.duration_seconds ? { audio_length_in_s: input.duration_seconds } : {}),
        };
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true };
      }

      // ── ElevenLabs（備用）──────────────────────────────────────
      {
        const falModelId = "fal-ai/elevenlabs/sound-effects/v2";
        const { request_id } = await falQueueSubmit(falModelId, {
          text:             input.text,
          duration_seconds: input.duration_seconds ? Math.min(input.duration_seconds, 22) : undefined,
          prompt_influence: input.prompt_influence,
        });
        return { request_id, model: falModelId, is_async_polling: true };
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎤 語音合成 (TTS)
  // ═══════════════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/tts/turbo-v2.5 — 高速 ElevenLabs TTS（非同步 queue） */
  elevenLabsTTS: protectedProcedure
    .input(z.object({
      text:              z.string().min(1).max(5000),
      voice_id:          z.string().optional(),
      model_id:          z.string().optional().default("eleven_turbo_v2_5"),
      stability:         z.number().min(0).max(1).optional().default(0.5),
      similarity_boost:  z.number().min(0).max(1).optional().default(0.75),
      style:             z.number().min(0).max(1).optional().default(0),
      language_code:     z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/elevenlabs/tts/turbo-v2.5";
      const { request_id } = await falQueueSubmit(modelId, {
        text:     input.text,
        voice_id: input.voice_id,
        model_id: input.model_id,
        voice_settings: {
          stability:       input.stability,
          similarity_boost: input.similarity_boost,
          style:           input.style,
        },
        language_code: input.language_code,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  /** fal-ai/qwen-3-tts/text-to-speech/1.7b — Qwen TTS（非同步 queue） */
  qwenTTS: protectedProcedure
    .input(z.object({
      text:                           z.string().min(1).max(5000),
      voice:                          z.string().optional(), // 預訓練語音名稱，如 "Vivian"
      speaker_voice_embedding_file_url: z.string().url().optional(), // 從 qwenCloneVoice 取得
      reference_text:                 z.string().optional(),
      language:                       z.enum(["Auto","English","Chinese","Japanese","Korean","Spanish","French","German","Italian","Portuguese","Russian"]).optional().default("Auto"),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/qwen-3-tts/text-to-speech/1.7b";
      const { request_id } = await falQueueSubmit(modelId, {
        text:                             input.text,
        voice:                            input.voice,
        speaker_voice_embedding_file_url: input.speaker_voice_embedding_file_url,
        reference_text:                   input.reference_text,
        language:                         input.language,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎭 聲音克隆 & 設計
  // ═══════════════════════════════════════════════════════════════

  /**
   * fal-ai/qwen-3-tts/clone-voice/1.7b — 聲音克隆
   *
   * ⚠️ 此 endpoint 只接受 { audio_url, reference_text? }
   * 回傳 speaker_embedding（.safetensors），不是音訊！
   * 要合成語音需取得 speaker_embedding.url，再呼叫 qwenTTS
   * 並傳入 speaker_voice_embedding_file_url。
   */
  qwenCloneVoice: protectedProcedure
    .input(z.object({
      audio_url:      z.string().url(),                   // 參考音訊 URL（3-30秒）
      reference_text: z.string().optional(),              // 參考音訊的文字（可提升品質）
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/qwen-3-tts/clone-voice/1.7b";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_url:      input.audio_url,
        reference_text: input.reference_text,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  /**
   * 二合一：克隆聲音後直接合成語音（方便前端單步操作）
   * 步驟：clone → 取得 embedding → TTS
   * ⚠️ 使用非同步 queue 避免超時
   */
  qwenCloneAndSpeak: protectedProcedure
    .input(z.object({
      audio_url:      z.string().url(),
      text:           z.string().min(1).max(5000),
      reference_text: z.string().optional(),
      language:       z.enum(["Auto","English","Chinese","Japanese","Korean","Spanish","French","German","Italian","Portuguese","Russian"]).optional().default("Auto"),
    }))
    .mutation(async ({ input }) => {
      // Step 1: 建立 speaker embedding（使用同步呼叫，因為 Step 2 依賴結果）
      const cloneModelId = "fal-ai/qwen-3-tts/clone-voice/1.7b";
      const cloneResult = await falRun(cloneModelId, {
        audio_url:      input.audio_url,
        reference_text: input.reference_text,
      }) as any;

      const embeddingUrl = cloneResult?.speaker_embedding?.url;
      if (!embeddingUrl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "聲音克隆失敗：未取得 speaker_embedding" });
      }

      // Step 2: 用克隆聲音合成語音（非同步 queue）
      const ttsModelId = "fal-ai/qwen-3-tts/text-to-speech/1.7b";
      const { request_id } = await falQueueSubmit(ttsModelId, {
        text:                             input.text,
        speaker_voice_embedding_file_url: embeddingUrl,
        reference_text:                   input.reference_text,
        language:                         input.language,
      });

      return {
        request_id,
        model: ttsModelId,
        is_async_polling: true,
        speaker_embedding_url: embeddingUrl,
      };
    }),

  /** fal-ai/qwen-3-tts/voice-design/1.7b — 文字描述設計語音（非同步 queue） */
  qwenVoiceDesign: protectedProcedure
    .input(z.object({
      voice_description: z.string().min(1).max(1000),
      text:              z.string().min(1).max(500).optional().default("你好，我是你設計的聲音。"),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/qwen-3-tts/voice-design/1.7b";
      const { request_id } = await falQueueSubmit(modelId, {
        voice_description: input.voice_description,
        text:              input.text,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  /**
   * fal-ai/dia-tts/voice-clone — Dia 多說話者 TTS
   *
   * ⚠️ 此 endpoint 沒有 reference_audio_url 參數！
   * 只接受 { text }，用 [S1]/[S2] 標籤標注不同說話者。
   * 例如："[S1] 你好 [S2] 我很好"
   */
  diaTTSVoiceClone: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/dia-tts/voice-clone";
      const { request_id } = await falQueueSubmit(modelId, {
        text: input.text,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  /** fal-ai/kling-video/create-voice — 建立 Kling 語音配置（非同步 queue） */
  klingCreateVoice: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
      name:      z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/kling-video/create-voice";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_url: input.audio_url,
        name:      input.name,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🔄 音訊處理
  // ═══════════════════════════════════════════════════════════════

  /**
   * fal-ai/demucs — 音幹分離
   *
   * ⚠️ stems 支援情況：
   *  - htdemucs / htdemucs_ft：只支援 vocals/drums/bass/other（4幹）
   *  - htdemucs_6s：額外支援 guitar/piano（6幹）
   *  - mdx / mdx_extra：支援 vocals/drums/bass/other
   *  - output_format 只支援 "wav" | "mp3"（沒有 flac）
   */
  demucs: protectedProcedure
    .input(z.object({
      audio_url:     z.string().url(),
      model:         z.enum(["htdemucs", "htdemucs_ft", "htdemucs_6s", "hdemucs_mmi", "mdx", "mdx_extra", "mdx_q", "mdx_extra_q"]).optional().default("htdemucs_ft"),
      output_format: z.enum(["mp3", "wav"]).optional().default("mp3"),
    }))
    .mutation(async ({ input }) => {
      // 根據模型強制限制 stems，避免 4幹模型收到 guitar/piano 而報錯
      const FOUR_STEM_MODELS = ["htdemucs", "htdemucs_ft", "hdemucs_mmi", "mdx", "mdx_extra", "mdx_q", "mdx_extra_q"];
      const SIX_STEM_MODELS  = ["htdemucs_6s"];

      let stems: string[];
      if (FOUR_STEM_MODELS.includes(input.model)) {
        stems = ["vocals", "drums", "bass", "other"];
      } else if (SIX_STEM_MODELS.includes(input.model)) {
        stems = ["vocals", "drums", "bass", "other", "guitar", "piano"];
      } else {
        stems = ["vocals", "drums", "bass", "other"];
      }

      const modelId = "fal-ai/demucs";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_url:     input.audio_url,
        model:         input.model,
        stems:         stems,
        output_format: input.output_format,
        shifts:        1,
        overlap:       0.25,
      });

      return { request_id, model: modelId, is_async_polling: true };
    }),

  /** fal-ai/elevenlabs/audio-isolation — 人聲隔離/去噪（非同步 queue） */
  audioIsolation: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/elevenlabs/audio-isolation";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_url: input.audio_url,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  /** fal-ai/ffmpeg-api/merge-audios — 多音訊合併（非同步 queue） */
  mergeAudios: protectedProcedure
    .input(z.object({
      audio_urls:      z.array(z.string().url()).min(2).max(10),
      merge_strategy:  z.enum(["concatenate", "mix"]).optional().default("concatenate"),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/ffmpeg-api/merge-audios";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_urls:     input.audio_urls,
        merge_strategy: input.merge_strategy,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🔁 聲音變換
  // ═══════════════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/voice-changer — 聲音變換（非同步 queue） */
  voiceChanger: protectedProcedure
    .input(z.object({
      audio_url:               z.string().url(),
      voice_id:                z.string(),
      remove_background_noise: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const modelId = "fal-ai/elevenlabs/voice-changer";
      const { request_id } = await falQueueSubmit(modelId, {
        audio_url:               input.audio_url,
        voice_id:                input.voice_id,
        remove_background_noise: input.remove_background_noise,
      });
      return { request_id, model: modelId, is_async_polling: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 📝 語音轉文字 (ASR)
  // ═══════════════════════════════════════════════════════════════

  /**
   * fal-ai/nemotron/asr/stream — NVIDIA Nemotron 語音識別
   *
   * ⚠️ 重要修正：
   * - 此模型是 SSE 串流端點（不能用 fal.run 直接呼叫取 JSON）
   * - 只接受 { audio_url, acceleration? }
   * - 沒有 language / task 參數（模型自動偵測語言）
   * - 必須用 queue 模式：submit → 輪詢 → 取結果
   * - 結果格式需要特別解析
   */
  speechToText: protectedProcedure
    .input(z.object({
      audio_url:    z.string().url(),
      acceleration: z.enum(["none", "low", "medium", "high"]).optional().default("none"),
    }))
    .mutation(async ({ input }) => {
      // 使用 submit 立即回傳 request_id，不在後端等待
      const { request_id } = await falQueueSubmit("fal-ai/nemotron/asr/stream", {
        audio_url:    input.audio_url,
        acceleration: input.acceleration,
      });

      return {
        request_id,
        model: "fal-ai/nemotron/asr/stream",
        is_async_polling: true,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎬 音訊驅動影片（非同步任務）
  // ═══════════════════════════════════════════════════════════════

  /** fal-ai/wan/v2.2-14b/speech-to-video — 說話人影片生成 */
  speechToVideo: protectedProcedure
    .input(z.object({
      image_url:  z.string().url(),
      audio_url:  z.string().url(),
      prompt:     z.string().optional(),
      num_frames: z.number().min(16).max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/wan/v2.2-14b/speech-to-video", {
        image_url:  input.image_url,
        audio_url:  input.audio_url,
        prompt:     input.prompt,
        num_frames: input.num_frames,
      });
      return { request_id, model: "fal-ai/wan/v2.2-14b/speech-to-video" };
    }),

  /** fal-ai/echomimic-v3 — 說話虛擬形像 */
  echoMimic: protectedProcedure
    .input(z.object({
      image_url:  z.string().url(),
      audio_url:  z.string().url().optional(),
      text:       z.string().optional(),
      pose_style: z.number().min(0).max(45).optional().default(0),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/echomimic-v3", {
        image_url:  input.image_url,
        audio_url:  input.audio_url,
        text:       input.text,
        pose_style: input.pose_style,
      });
      return { request_id, model: "fal-ai/echomimic-v3" };
    }),

  /** fal-ai/stable-avatar — 音訊驅動頭像（最長 5 分鐘） */
  stableAvatar: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/stable-avatar", {
        image_url: input.image_url,
        audio_url: input.audio_url,
      });
      return { request_id, model: "fal-ai/stable-avatar" };
    }),

  /** fal-ai/elevenlabs/dubbing — AI 影片配音翻譯 */
  dubbing: protectedProcedure
    .input(z.object({
      video_url:       z.string().url().optional(),
      audio_url:       z.string().url().optional(),
      source_language: z.string().optional().default("zh"),
      target_language: z.string().min(1),
      num_speakers:    z.number().min(1).max(10).optional(),
      watermark:       z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/elevenlabs/dubbing", {
        video_url:       input.video_url,
        audio_url:       input.audio_url,
        source_language: input.source_language,
        target_language: input.target_language,
        num_speakers:    input.num_speakers,
        watermark:       input.watermark,
      });
      return { request_id, model: "fal-ai/elevenlabs/dubbing" };
    }),

  /** fal-ai/longcat-single-avatar/audio-to-video — 長影片唇形同步 */
  longcatAvatar: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url(),
      prompt:    z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/longcat-single-avatar/audio-to-video", {
        image_url: input.image_url,
        audio_url: input.audio_url,
        prompt:    input.prompt,
      });
      return { request_id, model: "fal-ai/longcat-single-avatar/audio-to-video" };
    }),

  /** fal-ai/ltx-2-19b/distilled/audio-to-video/lora — LTX-2 音訊轉影片 */
  ltxAudioToVideo: protectedProcedure
    .input(z.object({
      prompt:     z.string().min(1).max(2000),
      audio_url:  z.string().url(),
      image_url:  z.string().url().optional(),
      lora_url:   z.string().url().optional(),
      num_frames: z.number().min(8).max(257).optional().default(121),
      resolution: z.enum(["480p", "720p"]).optional().default("720p"),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falQueueSubmit("fal-ai/ltx-2-19b/distilled/audio-to-video/lora", {
        prompt:     input.prompt,
        audio_url:  input.audio_url,
        image_url:  input.image_url,
        lora_url:   input.lora_url,
        num_frames: input.num_frames,
        resolution: input.resolution,
      });
      return { request_id, model: "fal-ai/ltx-2-19b/distilled/audio-to-video/lora" };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 📊 非同步任務狀態查詢
  // ═══════════════════════════════════════════════════════════════

  /** 查詢非同步影片任務狀態（jobStatus 每 3 秒輪詢一次） */
  jobStatus: protectedProcedure
    .input(z.object({
      request_id: z.string().min(1),
      model:      z.string().min(1),
    }))
    .query(async ({ input }) => {
      return falQueueStatus(input.request_id, input.model);
    }),

  /** 取得非同步影片任務結果 */
  jobResult: protectedProcedure
    .input(z.object({
      request_id: z.string().min(1),
      model:      z.string().min(1),
    }))
    .query(async ({ input }) => {
      return falQueueResult(input.request_id, input.model);
    }),

  /**
   * 結合狀態+結果的通用輪詢 API
   * 前端每 3 秒呼叫：若已完成則回傳音訊 URL
   * 支援超時偵測：若任務執行超過 10 分鐘仍未完成，自動標記為失敗
   */
  checkAudioStatus: protectedProcedure
    .input(z.object({
      requestId:   z.string().min(1),
      model:       z.string().min(1),
      submittedAt: z.number().optional(), // epoch ms — 用於超時偵測
    }))
    .query(async ({ input }) => {
      // ── 超時偵測：若超過 10 分鐘仍在處理，視為失敗 ───────────
      if (input.submittedAt) {
        const elapsed = Date.now() - input.submittedAt;
        if (elapsed > ASYNC_TASK_TIMEOUT_MS) {
          throw new TRPCError({
            code: "TIMEOUT",
            message: `任務已超時（超過 ${Math.round(ASYNC_TASK_TIMEOUT_MS / 60000)} 分鐘），請嘗試更換模型或簡化描述後重試`,
          });
        }
      }

      const status = await falQueueStatus(input.requestId, input.model) as any;
      const s = status?.status ?? status?.state;

      if (s === "COMPLETED") {
        const result = await falQueueResult(input.requestId, input.model) as any;
        const rawData = result?.data ?? result;

        // 通用提取 audio_url（支援各種模型的不同回傳格式）
        const audioUrl =
          rawData?.audio?.url ??
          rawData?.audio_url ??
          (Array.isArray(rawData?.audio) ? rawData.audio[0]?.url : null) ??
          rawData?.output?.url ??
          rawData?.audio_file?.url ??
          null;

        // 如果是 ASR 結果，提取文字
        let text = "";
        if (typeof rawData?.text === "string") text = rawData.text;
        else if (typeof rawData?.transcription === "string") text = rawData.transcription;
        else if (Array.isArray(rawData?.segments))
          text = rawData.segments.map((s: any) => s?.text ?? "").filter(Boolean).join(" ");

        return { status: "COMPLETED", audio_url: audioUrl, text: text.trim() || null, raw: rawData };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `任務失敗 [${input.model}]: ${errMsg}` });
      }

      return { status: "IN_PROGRESS" };
    }),
});

export type ProStudioRouter = typeof proStudioRouter;
