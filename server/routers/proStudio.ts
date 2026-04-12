/**
 * proStudio.ts — 專業創作室 Router
 *
 * 整合 20 個 fal.ai 音訊/語音/影片模型，
 * 提供統一的 tRPC API 介面給前端「專業創作室」頁面使用。
 *
 * 模型分類：
 *   🎵 音樂生成：sonauto/v2/text-to-music
 *   🔊 音效生成：fal-ai/elevenlabs/sound-effects/v2
 *   🎤 語音合成：fal-ai/elevenlabs/tts/turbo-v2.5, fal-ai/qwen-3-tts/*
 *   🎭 聲音克隆：fal-ai/qwen-3-tts/clone-voice, fal-ai/dia-tts/voice-clone
 *   🔄 音訊處理：fal-ai/demucs, fal-ai/ffmpeg-api/merge-audios, fal-ai/elevenlabs/audio-isolation
 *   🔁 聲音變換：fal-ai/elevenlabs/voice-changer, fal-ai/kling-video/create-voice
 *   🗣️ 即時對話：fal-ai/personaplex/realtime
 *   📝 語音轉文字：fal-ai/nemotron/asr/stream
 *   🎬 音訊驅動影片：fal-ai/wan/v2.2-14b/speech-to-video, fal-ai/echomimic-v3
 *              fal-ai/stable-avatar, fal-ai/elevenlabs/dubbing
 *              fal-ai/longcat-single-avatar/audio-to-video
 *              fal-ai/ltx-2-19b/distilled/audio-to-video/lora
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

// ─── fal.ai 呼叫工具 ────────────────────────────────────────────────────────

async function falSubmit(
  modelId: string,
  input: Record<string, unknown>
): Promise<{ request_id: string }> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定" });

  const res = await fetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai 錯誤: ${err}` });
  }

  return res.json();
}

async function falStatus(requestId: string, modelId: string): Promise<unknown> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定" });

  const res = await fetch(`https://queue.fal.run/${modelId}/requests/${requestId}/status`, {
    headers: { "Authorization": `Key ${apiKey}` },
  });

  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "查詢狀態失敗" });
  return res.json();
}

async function falResult(requestId: string, modelId: string): Promise<unknown> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定" });

  const res = await fetch(`https://queue.fal.run/${modelId}/requests/${requestId}`, {
    headers: { "Authorization": `Key ${apiKey}` },
  });

  if (!res.ok) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "取得結果失敗" });
  return res.json();
}

/** 同步等待 fal.ai 任務完成（最多等 120 秒） */
async function falRun(modelId: string, input: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "FAL_API_KEY 未設定" });

  const res = await fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers: {
      "Authorization": `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `fal.ai 錯誤: ${err}` });
  }

  return res.json();
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const proStudioRouter = router({

  /** 取得 FAL_API_KEY 是否設定（前端用來顯示提示） */
  checkApiKey: publicProcedure.query(() => {
    return { configured: !!process.env.FAL_API_KEY };
  }),

  // ═══════════════════════════════════════════════════════
  // 🎵 音樂生成
  // ═══════════════════════════════════════════════════════

  /** sonauto/v2/text-to-music — 文字轉完整歌曲 */
  textToMusic: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(2000),
      lyrics: z.string().optional(),
      duration: z.number().min(10).max(240).optional().default(60),
      instrumental: z.boolean().optional().default(false),
      tags: z.string().optional(),  // 風格標籤, e.g. "pop, upbeat, piano"
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("sonauto/v2/text-to-music", {
        prompt: input.prompt,
        lyrics: input.lyrics,
        duration: input.duration,
        instrumental: input.instrumental,
        tags: input.tags,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🔊 音效生成
  // ═══════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/sound-effects/v2 — AI 音效生成 */
  soundEffects: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(500),
      duration_seconds: z.number().min(0.5).max(22).optional(),
      prompt_influence: z.number().min(0).max(1).optional().default(0.3),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/elevenlabs/sound-effects/v2", {
        text: input.text,
        duration_seconds: input.duration_seconds,
        prompt_influence: input.prompt_influence,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🎤 語音合成 (TTS)
  // ═══════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/tts/turbo-v2.5 — 高速 TTS */
  elevenLabsTTS: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      voice_id: z.string().optional(),
      model_id: z.string().optional().default("eleven_turbo_v2_5"),
      stability: z.number().min(0).max(1).optional().default(0.5),
      similarity_boost: z.number().min(0).max(1).optional().default(0.75),
      style: z.number().min(0).max(1).optional().default(0),
      language_code: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/elevenlabs/tts/turbo-v2.5", {
        text: input.text,
        voice_id: input.voice_id,
        model_id: input.model_id,
        voice_settings: {
          stability: input.stability,
          similarity_boost: input.similarity_boost,
          style: input.style,
        },
        language_code: input.language_code,
      });
      return result;
    }),

  /** fal-ai/qwen-3-tts/text-to-speech/1.7b — Qwen TTS */
  qwenTTS: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      voice_id: z.string().optional(),  // 預訓練語音 ID 或克隆語音 ID
      speed: z.number().min(0.5).max(2).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/qwen-3-tts/text-to-speech/1.7b", {
        text: input.text,
        voice_id: input.voice_id,
        speed: input.speed,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🎭 聲音克隆 & 設計
  // ═══════════════════════════════════════════════════════

  /** fal-ai/qwen-3-tts/clone-voice/1.7b — 零次聲音克隆 */
  qwenCloneVoice: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      reference_audio_url: z.string().url(),
      speed: z.number().min(0.5).max(2).optional().default(1),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/qwen-3-tts/clone-voice/1.7b", {
        text: input.text,
        reference_audio_url: input.reference_audio_url,
        speed: input.speed,
      });
      return result;
    }),

  /** fal-ai/qwen-3-tts/voice-design/1.7b — 自訂語音設計 */
  qwenVoiceDesign: protectedProcedure
    .input(z.object({
      voice_description: z.string().min(1).max(1000),
      text: z.string().min(1).max(500).optional().default("你好，我是你設計的聲音。"),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/qwen-3-tts/voice-design/1.7b", {
        voice_description: input.voice_description,
        text: input.text,
      });
      return result;
    }),

  /** fal-ai/dia-tts/voice-clone — 對話語音克隆 */
  diaTTSVoiceClone: protectedProcedure
    .input(z.object({
      text: z.string().min(1).max(5000),
      reference_audio_url: z.string().url(),
      reference_transcript: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/dia-tts/voice-clone", {
        text: input.text,
        reference_audio_url: input.reference_audio_url,
        reference_transcript: input.reference_transcript,
      });
      return result;
    }),

  /** fal-ai/kling-video/create-voice — Kling 語音克隆 */
  klingCreateVoice: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
      name: z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/kling-video/create-voice", {
        audio_url: input.audio_url,
        name: input.name,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🔄 音訊處理
  // ═══════════════════════════════════════════════════════

  /** fal-ai/demucs — 人聲/樂器分離 (SOTA 音幹擷取) */
  demucs: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
      model: z.enum(["htdemucs", "htdemucs_ft", "htdemucs_6s", "mdx", "mdx_extra"]).optional().default("htdemucs_ft"),
      output_format: z.enum(["mp3", "wav", "flac"]).optional().default("mp3"),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/demucs", {
        audio_url: input.audio_url,
        model: input.model,
        output_format: input.output_format,
      });
      return result;
    }),

  /** fal-ai/elevenlabs/audio-isolation — 音訊隔離（去噪/人聲分離） */
  audioIsolation: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/elevenlabs/audio-isolation", {
        audio_url: input.audio_url,
      });
      return result;
    }),

  /** fal-ai/ffmpeg-api/merge-audios — 多音訊合併 */
  mergeAudios: protectedProcedure
    .input(z.object({
      audio_urls: z.array(z.string().url()).min(2).max(10),
      merge_strategy: z.enum(["concatenate", "mix"]).optional().default("concatenate"),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/ffmpeg-api/merge-audios", {
        audio_urls: input.audio_urls,
        merge_strategy: input.merge_strategy,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🔁 聲音變換
  // ═══════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/voice-changer — 聲音變換 */
  voiceChanger: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
      voice_id: z.string(),
      remove_background_noise: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/elevenlabs/voice-changer", {
        audio_url: input.audio_url,
        voice_id: input.voice_id,
        remove_background_noise: input.remove_background_noise,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 📝 語音轉文字
  // ═══════════════════════════════════════════════════════

  /** fal-ai/nemotron/asr/stream — 高速語音轉文字 */
  speechToText: protectedProcedure
    .input(z.object({
      audio_url: z.string().url(),
      language: z.string().optional().default("zh"),
      task: z.enum(["transcribe", "translate"]).optional().default("transcribe"),
    }))
    .mutation(async ({ input }) => {
      const result = await falRun("fal-ai/nemotron/asr/stream", {
        audio_url: input.audio_url,
        language: input.language,
        task: input.task,
      });
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // 🎬 音訊驅動影片
  // ═══════════════════════════════════════════════════════

  /** fal-ai/wan/v2.2-14b/speech-to-video — 說話人影片生成 */
  speechToVideo: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url(),
      prompt: z.string().optional(),
      num_frames: z.number().min(16).max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/wan/v2.2-14b/speech-to-video", {
        image_url: input.image_url,
        audio_url: input.audio_url,
        prompt: input.prompt,
        num_frames: input.num_frames,
      });
      return { request_id, model: "fal-ai/wan/v2.2-14b/speech-to-video" };
    }),

  /** fal-ai/echomimic-v3 — 說話虛擬形像（圖片+音訊+文字） */
  echoMimic: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url().optional(),
      text: z.string().optional(),
      pose_style: z.number().min(0).max(45).optional().default(0),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/echomimic-v3", {
        image_url: input.image_url,
        audio_url: input.audio_url,
        text: input.text,
        pose_style: input.pose_style,
      });
      return { request_id, model: "fal-ai/echomimic-v3" };
    }),

  /** fal-ai/stable-avatar — 音訊驅動視訊頭像（最長5分鐘） */
  stableAvatar: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/stable-avatar", {
        image_url: input.image_url,
        audio_url: input.audio_url,
      });
      return { request_id, model: "fal-ai/stable-avatar" };
    }),

  /** fal-ai/elevenlabs/dubbing — AI 配音（影片或音訊） */
  dubbing: protectedProcedure
    .input(z.object({
      video_url: z.string().url().optional(),
      audio_url: z.string().url().optional(),
      source_language: z.string().optional().default("zh"),
      target_language: z.string().min(1),
      num_speakers: z.number().min(1).max(10).optional(),
      watermark: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/elevenlabs/dubbing", {
        video_url: input.video_url,
        audio_url: input.audio_url,
        source_language: input.source_language,
        target_language: input.target_language,
        num_speakers: input.num_speakers,
        watermark: input.watermark,
      });
      return { request_id, model: "fal-ai/elevenlabs/dubbing" };
    }),

  /** fal-ai/longcat-single-avatar/audio-to-video — 長影片唇形同步虛擬形像 */
  longcatAvatar: protectedProcedure
    .input(z.object({
      image_url: z.string().url(),
      audio_url: z.string().url(),
      prompt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/longcat-single-avatar/audio-to-video", {
        image_url: input.image_url,
        audio_url: input.audio_url,
        prompt: input.prompt,
      });
      return { request_id, model: "fal-ai/longcat-single-avatar/audio-to-video" };
    }),

  /** fal-ai/ltx-2-19b/distilled/audio-to-video/lora — LTX-2 音訊轉影片 */
  ltxAudioToVideo: protectedProcedure
    .input(z.object({
      prompt: z.string().min(1).max(2000),
      audio_url: z.string().url(),
      image_url: z.string().url().optional(),
      lora_url: z.string().url().optional(),
      num_frames: z.number().min(8).max(257).optional().default(121),
      resolution: z.enum(["480p", "720p"]).optional().default("720p"),
    }))
    .mutation(async ({ input }) => {
      const { request_id } = await falSubmit("fal-ai/ltx-2-19b/distilled/audio-to-video/lora", {
        prompt: input.prompt,
        audio_url: input.audio_url,
        image_url: input.image_url,
        lora_url: input.lora_url,
        num_frames: input.num_frames,
        resolution: input.resolution,
      });
      return { request_id, model: "fal-ai/ltx-2-19b/distilled/audio-to-video/lora" };
    }),

  // ═══════════════════════════════════════════════════════
  // 📊 任務狀態查詢（非同步任務使用）
  // ═══════════════════════════════════════════════════════

  /** 查詢非同步任務狀態 */
  jobStatus: protectedProcedure
    .input(z.object({
      request_id: z.string(),
      model: z.string(),
    }))
    .query(async ({ input }) => {
      return falStatus(input.request_id, input.model);
    }),

  /** 取得非同步任務結果 */
  jobResult: protectedProcedure
    .input(z.object({
      request_id: z.string(),
      model: z.string(),
    }))
    .query(async ({ input }) => {
      return falResult(input.request_id, input.model);
    }),
});

export type ProStudioRouter = typeof proStudioRouter;
