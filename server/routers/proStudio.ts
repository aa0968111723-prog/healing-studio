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
import { brainProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { recordErrorTrace } from "../services/brainAutoRepair";
import { traceToolRun } from "../services/langsmithTracer";
import { localizeResultUrls } from "../services/internalMedia";
import { getAudioCompiler } from "../services/audioCompiler";
import type { AudioBlock, AudioCompilerInput } from "../services/audioCompiler";
import { dispatchFalQueueTask } from "../services/falDispatcher";
import { estimatePoints } from "../services/modelPricing";
import { deductUserPoints, refundUserPoints } from "../db";

/**
 * 預扣積分：在送出 fal queue 任務前先估點＋扣款。
 * 若使用者餘額不足，拋 TRPCError；若送出失敗，呼叫端應用 refundUserPoints 退回。
 *
 * 回傳 estimatedCredits 供 webhook 後續對帳（actual vs estimated）。
 */
async function chargeForFalTask(
  userId: number,
  modelId: string,
  params: { durationSec?: number; charCount?: number } = {}
): Promise<number> {
  const estimate = estimatePoints(modelId, params);
  const result = await deductUserPoints(userId, estimate.totalPoints);
  if (!result.success) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: `積分不足：本次需 ${estimate.totalPoints} pts，餘額 ${result.remainingBefore} pts`,
    });
  }
  return estimate.totalPoints;
}

// ─── fal.ai 呼叫工具 ──────────────────────────────────────────────────────────

const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_RUN_BASE = "https://fal.run";

function getFalKey(): string {
  const key = process.env.FAL_API_KEY;
  if (!key)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "FAL_API_KEY 未設定，請在 Railway → Environment Variables 中新增",
    });
  return key;
}

/**
 * fal.ai ElevenLabs proxy 需要將 ElevenLabs key 以
 * `x-fal-client-credentials` header 傳入，否則會得到 401
 */
function getElevenLabsProxyHeaders(): Record<string, string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return {}; // key 未設定時讓 fal.ai 自記錄 401，不在此層拋錯
  return { "x-fal-client-credentials": key };
}

/** 使用 queue 非同步提交任務（透過 falDispatcher 統一派發），立即回傳 request_id */
async function falQueueSubmit(
  modelId: string,
  input: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<{ request_id: string }> {
  // 帶 fal.ai webhook 回呼，瀏覽器關閉時 webhookFal 會以 request_id 反查
  // resultJson.requestId 對應的 backgroundJob 並寫回結果（不依賴前端輪詢）
  const siteUrl = process.env.VITE_SITE_URL?.trim();
  const webhookUrl = siteUrl ? `${siteUrl}/api/webhook/fal` : undefined;

  try {
    const result = await dispatchFalQueueTask({
      modelId,
      input,
      webhookUrl,
      extraHeaders,
      route: "trpc.proStudio.*",
      modality: "audio",
    });
    return { request_id: result.request_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `fal.ai submit 錯誤 [${modelId}]: ${msg}`,
    });
  }
}

/** 查詢 queue 任務狀態 */
async function falQueueStatus(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await fetch(
    `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`,
    {
      headers: { Authorization: `Key ${key}` },
    }
  );
  if (!res.ok) {
    void traceToolRun({
      runName: "pro-studio/fal-queue-status",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.proStudio.check*",
      method: "GET",
      inputs: { request_id: requestId },
      error: `HTTP ${res.status}`,
      durationMs: Date.now() - startedAt,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "查詢狀態失敗",
    });
  }
  const data = await res.json();
  void traceToolRun({
    runName: "pro-studio/fal-queue-status",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.proStudio.check*",
    method: "GET",
    inputs: { request_id: requestId },
    outputs: {
      status: (data as { status?: string })?.status ?? "unknown",
      request_id: requestId,
    },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

/** 取得 queue 任務結果 */
async function falQueueResult(
  requestId: string,
  modelId: string
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await fetch(
    `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`,
    {
      headers: { Authorization: `Key ${key}` },
    }
  );
  if (!res.ok) {
    void traceToolRun({
      runName: "pro-studio/fal-queue-result",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.proStudio.check*",
      method: "GET",
      inputs: { request_id: requestId },
      error: `HTTP ${res.status}`,
      durationMs: Date.now() - startedAt,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "取得結果失敗",
    });
  }
  const data = await res.json();
  void traceToolRun({
    runName: "pro-studio/fal-queue-result",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.proStudio.check*",
    method: "GET",
    inputs: { request_id: requestId },
    outputs: {
      status: (data as { status?: string })?.status ?? "unknown",
      request_id: requestId,
      has_result: true,
    },
    durationMs: Date.now() - startedAt,
  });
  return data;
}

/**
 * falRun — 同步呼叫（適合快速模型，如 TTS、音效）
 * 使用 fal.run（非 queue），timeout 較短。
 * ⚠️ 音樂生成、ASR 等長時任務不得用此函數。
 */
async function falRun(
  modelId: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const startedAt = Date.now();
  const key = getFalKey();
  const res = await fetch(`${FAL_RUN_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    // 使用 signal 讓外層可設置 timeout
    signal: AbortSignal.timeout(90_000), // 90 秒
  });
  if (!res.ok) {
    const err = await res.text();
    void traceToolRun({
      runName: "pro-studio/fal-run",
      provider: "fal.ai",
      model: modelId,
      route: "trpc.proStudio.*",
      method: "POST",
      inputs: { input_keys: Object.keys(input) },
      error: err.slice(0, 500),
      durationMs: Date.now() - startedAt,
    });
    recordErrorTrace({
      userId: 0,
      modality: "audio",
      engine: modelId,
      prompt: "[falRun]",
      errorMessage: err.slice(0, 500),
      errorCode: "FAL_RUN_ERROR",
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `fal.ai 錯誤 [${modelId}]: ${err}`,
    });
  }
  const data = await res.json();
  void traceToolRun({
    runName: "pro-studio/fal-run",
    provider: "fal.ai",
    model: modelId,
    route: "trpc.proStudio.*",
    method: "POST",
    inputs: { input_keys: Object.keys(input) },
    outputs: { has_data: Boolean(data) },
    durationMs: Date.now() - startedAt,
  });
  return data;
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
  // DEF-14 修正：ACE-Step 設為預設（Sonauto v2 目前 fal.ai 不穩定）
  {
    id: "ace-step",
    label: "ACE-Step",
    description: "高品質音樂生成，支援自訂時長",
    badge: "預設",
    tier: "premium" as const,
  },
  {
    id: "sonauto",
    label: "Sonauto v2",
    description: "完整歌曲生成，支援歌詞 & 風格標籤（1-3 分鐘）",
    badge: "歌詞支援",
    tier: "premium" as const,
  },
  {
    id: "stable-audio",
    label: "Stable Audio",
    description: "高品質音樂/音效（最長 3 分鐘）",
    badge: "",
    tier: "premium" as const,
  },
  {
    id: "musicgen",
    label: "MusicGen (Meta)",
    description: "Meta 開源音樂模型，輕量快速",
    badge: "快速",
    tier: "standard" as const,
  },
];

/** 可用的音效生成模型 */
const SFX_MODELS = [
  {
    id: "stable-audio",
    label: "Stable Audio",
    description: "真實環境音效 & Foley 音效（最長 3 分鐘）",
    badge: "預設",
    tier: "premium" as const,
  },
  // DEF-SFX3 / DEF-A3：id 維持 "audioldm2" 以避開前端枚舉破壞性變更。
  // fal.ai 已下架 fal-ai/audioldm2 endpoint，整個堆疊（dispatcher / pricing
  // 別名 / brain audioEngine）會自動 normalize 到 fal-ai/mmaudio-v2 — 同 latent
  // diffusion 路線、同 standard tier，使用者無感切換。Label 與 description
  // 對齊真實交付模型，避免誤導。
  {
    id: "audioldm2",
    label: "MMAudio V2",
    description: "MMAudio 多模態音頻生成（替代已下架的 AudioLDM2，同 latent diffusion，擅長自然音效）",
    badge: "",
    tier: "standard" as const,
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs SFX",
    description: "ElevenLabs 音效（最長 22 秒，部分描述可能產生語音）",
    badge: "備用",
    tier: "standard" as const,
  },
];

/** 背景任務超時閾值（毫秒）— 超過此時間未完成則標記失敗 */
const BACKGROUND_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘

// ─── 音樂模型解析（接通大腦組態 audioEngine）────────────────────────────────

type MusicShortId = "sonauto" | "ace-step" | "stable-audio" | "musicgen";

const FAL_TO_SHORT_MUSIC: Record<string, MusicShortId> = {
  "fal-ai/sonauto": "sonauto",
  "fal-ai/ace-step": "ace-step",
  "fal-ai/stable-audio": "stable-audio",
  "fal-ai/musicgen": "musicgen",
};

/**
 * DEF-15：接通大腦組態。
 * 當使用者未顯式選擇模型時，採用 ctx.brain.generation.audioEngine（含降級
 * 後的 fallback engine），而非硬編碼預設值。優先序：
 *   1. input.model（使用者顯式選擇）
 *   2. brain.generation.audioEngine.engine（大腦組態，可被使用者在大腦頁設定）
 *   3. "ace-step"（最終安全預設）
 */
function resolveMusicModelChoice(
  inputModel: MusicShortId | undefined,
  brainEngine: string | undefined
): MusicShortId {
  if (inputModel) return inputModel;
  if (brainEngine && FAL_TO_SHORT_MUSIC[brainEngine]) {
    return FAL_TO_SHORT_MUSIC[brainEngine];
  }
  return "ace-step";
}

// ─── 音效模型解析 ────────────────────────────────────────────────────────

type SfxShortId = "stable-audio" | "audioldm2" | "elevenlabs";

/** ElevenLabs Sound Effects v2 endpoint（帶 /v2，與 fal 真實 URL 對齊） */
const ELEVENLABS_SFX_MODEL_ID = "fal-ai/elevenlabs/sound-effects/v2";

/** ElevenLabs Sound Effects v2 最大時長（per fal docs） */
const ELEVENLABS_SFX_MAX_SECONDS = 22;

/**
 * SFX-capable fal 引擎集合（不含純音樂模型如 ace-step / sonauto / musicgen）。
 * 大腦 audioEngine 落在這個集合內時，SFX 路徑才能跟著大腦走。
 */
const FAL_TO_SHORT_SFX: Record<string, SfxShortId> = {
  "fal-ai/stable-audio": "stable-audio",
  // SFX_MODELS 的 "audioldm2" 實際路由到 fal-ai/mmaudio-v2，故兩個 canonical
  // 都映射到同一短碼。
  "fal-ai/mmaudio-v2": "audioldm2",
  "fal-ai/audioldm2": "audioldm2",
  // DEF-EL2：ElevenLabs SFX canonical（含 legacy 無 /v2 拼法）也接通短碼，
  // 讓使用者在大腦頁選 ElevenLabs 後 SFX 路徑能跟隨。
  [ELEVENLABS_SFX_MODEL_ID]: "elevenlabs",
  "fal-ai/elevenlabs/sound-effects": "elevenlabs",
};

/**
 * DEF-SFX1：SFX 路徑接通大腦 audioEngine。
 * 大腦 audioEngine 若為純音樂引擎（ace-step / sonauto / musicgen）則不適用，
 * 退回 SFX 安全預設 stable-audio，避免拿不會生環境音的模型去做 Foley。
 *   1. input.model（使用者顯式選擇）
 *   2. brain.generation.audioEngine.engine（僅當為 SFX-capable）
 *   3. "stable-audio"（最終安全預設）
 */
function resolveSfxModelChoice(
  inputModel: SfxShortId | undefined,
  brainEngine: string | undefined
): SfxShortId {
  if (inputModel) return inputModel;
  if (brainEngine && FAL_TO_SHORT_SFX[brainEngine]) {
    return FAL_TO_SHORT_SFX[brainEngine];
  }
  return "stable-audio";
}

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
  textToMusic: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000).optional(),
        lyrics: z.string().optional(), // 前端傳的歌詞文字，對應 Sonauto API 的 lyrics_prompt
        tags: z.string().optional(), // 逗號分隔的標籤字串，轉換為陣列
        instrumental: z.boolean().optional(), // true → 傳空字串歌詞（純音樂）
        bpm: z.number().min(40).max(300).optional(),
        duration: z.number().min(1).max(300).optional(), // 秒數（非 Sonauto 模型用）
        // DEF-S1：Stable Audio 支援 negative_prompt（其他音樂模型會忽略）
        negativePrompt: z.string().max(500).optional(),
        model: z
          .enum(["sonauto", "ace-step", "stable-audio", "musicgen"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // DEF-15：接通大腦 audioEngine — 未指定 model 時依大腦組態選擇引擎
      const modelChoice = resolveMusicModelChoice(
        input.model,
        ctx.brain.generation.audioEngine.engine
      );

      // ── Sonauto v2（預設）─────────────────────────────────────
      if (modelChoice === "sonauto") {
        const payload: Record<string, unknown> = {};
        if (input.prompt) payload.prompt = input.prompt;
        if (input.tags) {
          const tagsArr = input.tags
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);
          if (tagsArr.length > 0) payload.tags = tagsArr;
        }
        const hasPrompt = !!payload.prompt;
        const hasTags = !!payload.tags;
        const hasLyrics = !!input.lyrics && !input.instrumental;

        // Sonauto API 限制：prompt + tags + lyrics_prompt 不能三者同時存在
        if (hasPrompt && hasTags && hasLyrics) {
          // 優先使用 prompt + lyrics，移除 tags（tags 可從 prompt 推斷）
          console.warn(
            "[ProStudio] Sonauto: prompt+tags+lyrics all set, dropping tags to comply with API constraints"
          );
          delete payload.tags;
        }

        if (input.instrumental) {
          payload.lyrics_prompt = "";
        } else if (input.lyrics) {
          payload.lyrics_prompt = input.lyrics;
        }
        if (!payload.prompt && !payload.tags) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "請至少提供音樂描述（prompt）或風格標籤（tags）",
          });
        }
        if (input.bpm) payload.bpm = input.bpm;
        payload.output_format = "mp3";
        payload.num_songs = 1;

        const falModelId = "fal-ai/sonauto";
        const charged = await chargeForFalTask(ctx.user.id, falModelId, {
          durationSec: input.duration ?? 60,
        });
        try {
          const { request_id } = await falQueueSubmit("sonauto/v2/text-to-music", payload);
          return {
            request_id,
            model: "sonauto/v2/text-to-music",
            is_async_polling: true,
            estimated_credits: charged,
          };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
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
        const charged = await chargeForFalTask(ctx.user.id, falModelId, {
          durationSec: input.duration ?? 60,
        });
        try {
          const { request_id } = await falQueueSubmit(falModelId, payload);
          return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      // ── Stable Audio ──────────────────────────────────────────
      if (modelChoice === "stable-audio") {
        const falModelId = "fal-ai/stable-audio";
        const payload: Record<string, unknown> = {
          prompt: combinedPrompt,
          seconds_total: input.duration ?? 30,
        };
        // DEF-S1：Stable Audio 支援 negative_prompt
        if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
        const charged = await chargeForFalTask(ctx.user.id, falModelId, {
          durationSec: input.duration ?? 30,
        });
        try {
          const { request_id } = await falQueueSubmit(falModelId, payload);
          return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      // ── MusicGen（最終備選）──────────────────────────────────
      const falModelId = "fal-ai/musicgen";
      const payload: Record<string, unknown> = {
        prompt: combinedPrompt,
        ...(input.duration ? { duration: input.duration } : {}),
      };
      const charged = await chargeForFalTask(ctx.user.id, falModelId, {
        durationSec: input.duration ?? 15,
      });
      try {
        const { request_id } = await falQueueSubmit(falModelId, payload);
        return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
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
   *  2. fal-ai/mmaudio-v2         — MMAudio 多模態音頻生成，擅長環境音效
   *  3. fal-ai/elevenlabs/sound-effects/v2 — ElevenLabs（備用，部分描述可能產生語音）
   *
   * ⚠️ 原先使用 ElevenLabs Sound Effects 會產生「配音說話」而非音效，
   *    已改為 Stable Audio 作為預設模型。
   */
  soundEffects: brainProcedure
    .input(
      z.object({
        text: z.string().min(1).max(500),
        duration_seconds: z.number().min(0.5).max(180).optional(),
        prompt_influence: z.number().min(0).max(1).optional().default(0.3),
        model: z
          .enum(["stable-audio", "audioldm2", "elevenlabs"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // DEF-SFX1：SFX 接通大腦 audioEngine（僅當為 SFX-capable 引擎時生效）
      const modelChoice = resolveSfxModelChoice(
        input.model,
        ctx.brain.generation.audioEngine.engine
      );

      // ── Stable Audio（預設）── 真正的音效生成 ──────────────────
      if (modelChoice === "stable-audio") {
        const falModelId = "fal-ai/stable-audio";
        const payload: Record<string, unknown> = {
          prompt: input.text,
          seconds_total: input.duration_seconds ?? 10,
        };
        const charged = await chargeForFalTask(ctx.user.id, falModelId, {
          durationSec: input.duration_seconds ?? 10,
        });
        try {
          const { request_id } = await falQueueSubmit(falModelId, payload);
          return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      // ── AudioLDM2 ── 音頻潛在擴散，擅長環境音效 ────────────────
      if (modelChoice === "audioldm2") {
        const falModelId = "fal-ai/mmaudio-v2";
        const payload: Record<string, unknown> = {
          prompt: input.text,
          ...(input.duration_seconds
            ? { duration: input.duration_seconds }
            : {}),
        };
        const charged = await chargeForFalTask(ctx.user.id, falModelId, {
          durationSec: input.duration_seconds ?? 15,
        });
        try {
          const { request_id } = await falQueueSubmit(falModelId, payload);
          return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      // ── ElevenLabs（最終備用）─────────────────────────────────
      // DEF-EL7：先檢查 ELEVENLABS_API_KEY 再扣點，避免使用者被「扣點 → fal 401
      // → 退點」的無謂往返；同時提早給出明確錯誤訊息。
      if (!process.env.ELEVENLABS_API_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ElevenLabs SFX 需要 ELEVENLABS_API_KEY。請改用 Stable Audio 或 MMAudio V2，或聯絡管理員設定金鑰。",
        });
      }
      const falModelId = ELEVENLABS_SFX_MODEL_ID;
      const charged = await chargeForFalTask(ctx.user.id, "elevenlabs/sound-effects");
      try {
        const { request_id } = await falQueueSubmit(falModelId, {
          text: input.text,
          duration_seconds: input.duration_seconds
            ? Math.min(input.duration_seconds, ELEVENLABS_SFX_MAX_SECONDS)
            : undefined,
          prompt_influence: input.prompt_influence,
        }, getElevenLabsProxyHeaders());  // 需要 ElevenLabs key 認證
        return { request_id, model: falModelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎤 語音合成 (TTS)
  // ═══════════════════════════════════════════════════════════════

  /**
   * ElevenLabs TTS — 支援 4 個聲線模型
   *
   * 可用 engine：
   *  - turbo-v2.5（預設）— 最快速度、英文友善、低成本（pricing: turbo-v2.5）
   *  - flash-v2.5 — 超低延遲，適合即時對話（pricing: flash-v2.5）
   *  - multilingual-v2 — 29 語言、品質穩定（pricing: multilingual-v2）
   *  - eleven-v3 — 最強情緒表達、最高品質（pricing: eleven-v3）
   */
  elevenLabsTTS: brainProcedure
    .input(
      z.object({
        text: z.string().min(1).max(5000),
        voice_id: z.string().optional(),
        engine: z
          .enum(["turbo-v2.5", "flash-v2.5", "multilingual-v2", "eleven-v3"])
          .optional()
          .default("turbo-v2.5"),
        /** 直接傳入 ElevenLabs 原生 model_id（覆寫 engine 對應） */
        model_id: z.string().optional(),
        stability: z.number().min(0).max(1).optional().default(0.5),
        similarity_boost: z.number().min(0).max(1).optional().default(0.75),
        style: z.number().min(0).max(1).optional().default(0),
        language_code: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // engine → fal route + native ElevenLabs model_id + pricing key
      const ENGINE_MAP: Record<
        string,
        { falModelId: string; nativeModelId: string; pricingKey: string }
      > = {
        "turbo-v2.5": {
          falModelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
          nativeModelId: "eleven_turbo_v2_5",
          pricingKey: "elevenlabs/turbo-v2.5",
        },
        "flash-v2.5": {
          falModelId: "fal-ai/elevenlabs/tts/flash-v2.5",
          nativeModelId: "eleven_flash_v2_5",
          pricingKey: "elevenlabs/flash-v2.5",
        },
        "multilingual-v2": {
          falModelId: "fal-ai/elevenlabs/tts/multilingual-v2",
          nativeModelId: "eleven_multilingual_v2",
          pricingKey: "elevenlabs/multilingual-v2",
        },
        "eleven-v3": {
          falModelId: "fal-ai/elevenlabs/tts/eleven-v3",
          nativeModelId: "eleven_v3",
          pricingKey: "elevenlabs/eleven-v3",
        },
      };
      const engine = input.engine ?? "turbo-v2.5";
      const route = ENGINE_MAP[engine];
      const charged = await chargeForFalTask(ctx.user.id, route.pricingKey, {
        charCount: input.text.length,
      });
      try {
        const { request_id } = await falQueueSubmit(route.falModelId, {
          text: input.text,
          voice_id: input.voice_id,
          model_id: input.model_id ?? route.nativeModelId,
          voice_settings: {
            stability: input.stability,
            similarity_boost: input.similarity_boost,
            style: input.style,
          },
          language_code: input.language_code,
        }, getElevenLabsProxyHeaders());  // 需要 ElevenLabs key 認證
        return { request_id, model: route.falModelId, engine, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/qwen-3-tts/text-to-speech/1.7b — Qwen TTS（非同步 queue） */
  qwenTTS: brainProcedure
    .input(
      z.object({
        text: z.string().min(1).max(5000),
        voice: z.string().optional(), // 預訓練語音名稱，如 "Vivian"
        speaker_voice_embedding_file_url: z.string().url().optional(), // 從 qwenCloneVoice 取得
        reference_text: z.string().optional(),
        language: z
          .enum([
            "Auto",
            "English",
            "Chinese",
            "Japanese",
            "Korean",
            "Spanish",
            "French",
            "German",
            "Italian",
            "Portuguese",
            "Russian",
          ])
          .optional()
          .default("Auto"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/qwen-3-tts/text-to-speech/1.7b";
      // DEF-04 修正：voice 與 speaker_voice_embedding_file_url 不能同時為空，否則 422
      const resolvedVoice =
        input.voice ??
        (input.speaker_voice_embedding_file_url ? undefined : "Vivian");
      const charged = await chargeForFalTask(ctx.user.id, modelId, {
        charCount: input.text.length,
      });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          text: input.text,
          voice: resolvedVoice,
          speaker_voice_embedding_file_url:
            input.speaker_voice_embedding_file_url,
          reference_text: input.reference_text,
          language: input.language,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
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
  qwenCloneVoice: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(), // 參考音訊 URL（3-30秒）
        reference_text: z.string().optional(), // 參考音訊的文字（可提升品質）
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/qwen-3-tts/clone-voice/1.7b";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
          reference_text: input.reference_text,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /**
   * 二合一：克隆聲音後直接合成語音（方便前端單步操作）
   * 步驟：clone → 取得 embedding → TTS
   * ⚠️ 使用非同步 queue 避免超時
   */
  qwenCloneAndSpeak: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        text: z.string().min(1).max(5000),
        reference_text: z.string().optional(),
        language: z
          .enum([
            "Auto",
            "English",
            "Chinese",
            "Japanese",
            "Korean",
            "Spanish",
            "French",
            "German",
            "Italian",
            "Portuguese",
            "Russian",
          ])
          .optional()
          .default("Auto"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 兩段式扣款：clone + TTS 各自單獨估點，失敗時各自退款
      const cloneModelId = "fal-ai/qwen-3-tts/clone-voice/1.7b";
      const ttsModelId = "fal-ai/qwen-3-tts/text-to-speech/1.7b";

      const cloneCharged = await chargeForFalTask(ctx.user.id, cloneModelId);

      let cloneResult: any;
      try {
        cloneResult = (await falRun(cloneModelId, {
          audio_url: input.audio_url,
          reference_text: input.reference_text,
        })) as any;
      } catch (err) {
        await refundUserPoints(ctx.user.id, cloneCharged);
        throw err;
      }

      const embeddingUrl = cloneResult?.speaker_embedding?.url;
      if (!embeddingUrl) {
        await refundUserPoints(ctx.user.id, cloneCharged);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "聲音克隆失敗：未取得 speaker_embedding",
        });
      }

      const ttsCharged = await chargeForFalTask(ctx.user.id, ttsModelId, {
        charCount: input.text.length,
      });
      try {
        const { request_id } = await falQueueSubmit(ttsModelId, {
          text: input.text,
          speaker_voice_embedding_file_url: embeddingUrl,
          reference_text: input.reference_text,
          language: input.language,
        });

        return {
          request_id,
          model: ttsModelId,
          is_async_polling: true,
          speaker_embedding_url: embeddingUrl,
          estimated_credits: cloneCharged + ttsCharged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, ttsCharged);
        throw err;
      }
    }),

  /** fal-ai/qwen-3-tts/voice-design/1.7b — 文字描述設計語音（非同步 queue） */
  qwenVoiceDesign: brainProcedure
    .input(
      z.object({
        voice_description: z.string().min(1).max(1000),
        text: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .default("你好，我是你設計的聲音。"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/qwen-3-tts/voice-design/1.7b";
      const charged = await chargeForFalTask(ctx.user.id, modelId, {
        charCount: input.text?.length ?? 0,
      });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          voice_description: input.voice_description,
          text: input.text,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /**
   * fal-ai/dia-tts/voice-clone — Dia 多說話者 TTS
   *
   * ⚠️ 此 endpoint 沒有 reference_audio_url 參數！
   * 只接受 { text }，用 [S1]/[S2] 標籤標注不同說話者。
   * 例如："[S1] 你好 [S2] 我很好"
   */
  diaTTSVoiceClone: brainProcedure
    .input(
      z.object({
        text: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/dia-tts/voice-clone";
      // DEF-07 修正：Dia TTS 要求 [S1]/[S2] 說話者標籤格式，純文字會 422
      const formattedText = /\[S\d\]/.test(input.text)
        ? input.text
        : `[S1] ${input.text}`;
      const charged = await chargeForFalTask(ctx.user.id, modelId, {
        charCount: input.text.length,
      });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          text: formattedText,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /**
   * fal-ai/elevenlabs/voice-cloning — ElevenLabs Instant Voice Cloning (IVC)
   *
   * 上傳 1-3 分鐘乾淨語音樣本，建立 voice_id，後續可在 elevenLabsTTS 直接使用。
   * 與 qwenCloneVoice 的差異：
   *  - Qwen 回 .safetensors embedding（only Qwen TTS 可用）
   *  - ElevenLabs 回 voice_id（可走 ElevenLabs 全家族 TTS / dubbing / voice-changer）
   */
  elevenLabsVoiceClone: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        labels: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/elevenlabs/voice-cloning";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(
          modelId,
          {
            audio_url: input.audio_url,
            name: input.name,
            description: input.description,
            labels: input.labels,
          },
          getElevenLabsProxyHeaders()
        );
        return {
          request_id,
          model: modelId,
          is_async_polling: true,
          estimated_credits: charged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/kling-video/create-voice — 建立 Kling 語音配置（非同步 queue） */
  klingCreateVoice: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/kling-video/create-voice";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
          name: input.name,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
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
  demucs: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        model: z
          .enum([
            "htdemucs",
            "htdemucs_ft",
            "htdemucs_6s",
            "hdemucs_mmi",
            "mdx",
            "mdx_extra",
            "mdx_q",
            "mdx_extra_q",
          ])
          .optional()
          .default("htdemucs_ft"),
        output_format: z.enum(["mp3", "wav"]).optional().default("mp3"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 根據模型強制限制 stems，避免 4幹模型收到 guitar/piano 而報錯
      const FOUR_STEM_MODELS = [
        "htdemucs",
        "htdemucs_ft",
        "hdemucs_mmi",
        "mdx",
        "mdx_extra",
        "mdx_q",
        "mdx_extra_q",
      ];
      const SIX_STEM_MODELS = ["htdemucs_6s"];

      let stems: string[];
      if (FOUR_STEM_MODELS.includes(input.model)) {
        stems = ["vocals", "drums", "bass", "other"];
      } else if (SIX_STEM_MODELS.includes(input.model)) {
        stems = ["vocals", "drums", "bass", "other", "guitar", "piano"];
      } else {
        stems = ["vocals", "drums", "bass", "other"];
      }

      const modelId = "fal-ai/demucs";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
          model: input.model,
          stems: stems,
          output_format: input.output_format,
          shifts: 1,
          overlap: 0.25,
        });

        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/elevenlabs/audio-isolation — 人聲隔離/去噪（非同步 queue） */
  audioIsolation: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/elevenlabs/audio-isolation";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
        }, getElevenLabsProxyHeaders());  // 需要 ElevenLabs key 認證
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/ffmpeg-api/merge-audios — 多音訊合併（非同步 queue） */
  mergeAudios: brainProcedure
    .input(
      z.object({
        audio_urls: z.array(z.string().url()).min(2).max(10),
        merge_strategy: z
          .enum(["concatenate", "mix"])
          .optional()
          .default("concatenate"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/ffmpeg-api/merge-audios";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_urls: input.audio_urls,
          merge_strategy: input.merge_strategy,
        });
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🔁 聲音變換
  // ═══════════════════════════════════════════════════════════════

  /** fal-ai/elevenlabs/voice-changer — 聲音變換（非同步 queue） */
  voiceChanger: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        voice_id: z.string(),
        remove_background_noise: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/elevenlabs/voice-changer";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
          voice_id: input.voice_id,
          remove_background_noise: input.remove_background_noise,
        }, getElevenLabsProxyHeaders());  // 需要 ElevenLabs key 認證
        return { request_id, model: modelId, is_async_polling: true, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
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
  speechToText: brainProcedure
    .input(
      z.object({
        audio_url: z.string().url(),
        acceleration: z
          .enum(["none", "low", "medium", "high"])
          .optional()
          .default("none"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/nemotron/asr/stream";
      const charged = await chargeForFalTask(ctx.user.id, modelId);
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          audio_url: input.audio_url,
          acceleration: input.acceleration,
        });

        return {
          request_id,
          model: modelId,
          is_async_polling: true,
          estimated_credits: charged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎬 音訊驅動影片（非同步任務）
  // ═══════════════════════════════════════════════════════════════

  /** fal-ai/wan/v2.2-14b/speech-to-video — 說話人影片生成 */
  speechToVideo: brainProcedure
    .input(
      z.object({
        image_url: z.string().url(),
        audio_url: z.string().url(),
        prompt: z.string().optional(),
        num_frames: z.number().min(16).max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/wan/v2.2-14b/speech-to-video";
      // 過濾 undefined 鍾開候送入 fal.ai 造成 422
      const falPayload: Record<string, unknown> = {
        image_url: input.image_url,
        audio_url: input.audio_url,
      };
      if (input.prompt) falPayload.prompt = input.prompt;
      if (input.num_frames) falPayload.num_frames = input.num_frames;
      // num_frames 約 24fps；給不到時就以 5 秒估
      const durationSec = input.num_frames ? Math.max(1, Math.round(input.num_frames / 24)) : 5;
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec });
      try {
        const { request_id } = await falQueueSubmit(modelId, falPayload);
        return { request_id, model: modelId, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/echomimic-v3 — 說話虛擬形像 */
  echoMimic: brainProcedure
    .input(
      z.object({
        image_url: z.string().url(),
        audio_url: z.string().url().optional(),
        text: z.string().optional(),
        pose_style: z.number().min(0).max(45).optional().default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/echomimic-v3";
      // 沒明確時長提示，以 5 秒估點
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec: 5 });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          image_url: input.image_url,
          audio_url: input.audio_url,
          text: input.text,
          pose_style: input.pose_style,
        });
        return { request_id, model: modelId, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/stable-avatar — 音訊驅動頭像（最長 5 分鐘） */
  stableAvatar: brainProcedure
    .input(
      z.object({
        image_url: z.string().url(),
        audio_url: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/stable-avatar";
      // Stable Avatar 預估 30 秒（典型短講解片段）
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec: 30 });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          image_url: input.image_url,
          audio_url: input.audio_url,
        });
        return { request_id, model: modelId, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/elevenlabs/dubbing — AI 影片配音翻譯 */
  dubbing: brainProcedure
    .input(
      z.object({
        video_url: z.string().url().optional(),
        audio_url: z.string().url().optional(),
        source_language: z.string().optional().default("zh"),
        target_language: z.string().min(1),
        num_speakers: z.number().min(1).max(10).optional(),
        watermark: z.boolean().optional().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/elevenlabs/dubbing";
      // 驗證：video_url 和 audio_url 必須至少存在一個
      if (!input.video_url && !input.audio_url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "請提供 video_url 或 audio_url （必選其一）",
        });
      }
      // Dubbing 沒給時長提示，以 30 秒估
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec: 30 });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          video_url: input.video_url,
          audio_url: input.audio_url,
          source_language: input.source_language,
          target_language: input.target_language,
          num_speakers: input.num_speakers,
          watermark: input.watermark,
        }, getElevenLabsProxyHeaders());  // 需要 ElevenLabs key 認證
        return { request_id, model: modelId, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/longcat-single-avatar/audio-to-video — 長影片唇形同步 */
  longcatAvatar: brainProcedure
    .input(
      z.object({
        image_url: z.string().url(),
        audio_url: z.string().url(),
        prompt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/longcat-single-avatar/audio-to-video";
      // LongCat 設計用於長片，預估 60 秒
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec: 60 });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          image_url: input.image_url,
          audio_url: input.audio_url,
          prompt: input.prompt,
        });
        return {
          request_id,
          model: modelId,
          estimated_credits: charged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /** fal-ai/ltx-2-19b/distilled/audio-to-video/lora — LTX-2 音訊轉影片 */
  ltxAudioToVideo: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        audio_url: z.string().url(),
        image_url: z.string().url().optional(),
        lora_url: z.string().url().optional(),
        num_frames: z.number().min(8).max(257).optional().default(121),
        resolution: z.enum(["480p", "720p"]).optional().default("720p"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const modelId = "fal-ai/ltx-2-19b/distilled/audio-to-video/lora";
      // num_frames @ ~24fps 換算秒數
      const durationSec = Math.max(1, Math.round((input.num_frames ?? 121) / 24));
      const charged = await chargeForFalTask(ctx.user.id, modelId, { durationSec });
      try {
        const { request_id } = await falQueueSubmit(modelId, {
          prompt: input.prompt,
          audio_url: input.audio_url,
          image_url: input.image_url,
          lora_url: input.lora_url,
          num_frames: input.num_frames,
          resolution: input.resolution,
        });
        return {
          request_id,
          model: modelId,
          estimated_credits: charged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 📊 非同步任務狀態查詢
  // ═══════════════════════════════════════════════════════════════

  /** 查詢非同步影片任務狀態（jobStatus 每 3 秒輪詢一次） */
  jobStatus: brainProcedure
    .input(
      z.object({
        request_id: z.string().min(1),
        model: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      return falQueueStatus(input.request_id, input.model);
    }),

  /** 取得非同步影片任務結果 */
  jobResult: brainProcedure
    .input(
      z.object({
        request_id: z.string().min(1),
        model: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const raw = await falQueueResult(input.request_id, input.model);
      return localizeResultUrls(
        raw,
        `generated/pro-studio/${input.model.replace(/[^\w/-]+/g, "_")}`
      );
    }),

  /**
   * 結合狀態+結果的通用輪詢 API
   * 前端每 3 秒呼叫：若已完成則回傳音訊 URL
   * 支援超時偵測：若任務執行超過 10 分鐘仍未完成，自動標記為失敗
   */
  checkAudioStatus: brainProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        model: z.string().min(1),
        submittedAt: z.number().optional(), // epoch ms — 用於超時偵測
      })
    )
    .query(async ({ input }) => {
      // ── 超時偵測：若超過 10 分鐘仍在處理，視為失敗 ───────────
      if (input.submittedAt) {
        const elapsed = Date.now() - input.submittedAt;
        if (elapsed > BACKGROUND_TASK_TIMEOUT_MS) {
          throw new TRPCError({
            code: "TIMEOUT",
            message: `任務已超時（超過 ${Math.round(BACKGROUND_TASK_TIMEOUT_MS / 60000)} 分鐘），請嘗試更換模型或簡化描述後重試`,
          });
        }
      }

      const status = (await falQueueStatus(
        input.requestId,
        input.model
      )) as any;
      const s = status?.status ?? status?.state;

      if (s === "COMPLETED") {
        const result = (await falQueueResult(
          input.requestId,
          input.model
        )) as any;
        const rawData = result?.data ?? result;

        // 持久化到 S3，防止 fal.ai CDN URL 過期；遞迴本地化整個 result 樹
        const localized = (await localizeResultUrls(
          rawData,
          `generated/pro-studio/${input.model.replace(/[^\w/-]+/g, "_")}`
        )) as any;

        // 通用提取 audio_url（支援各種模型的不同回傳格式）
        const audioUrl =
          localized?.audio?.url ??
          localized?.audio_url ??
          (Array.isArray(localized?.audio) ? localized.audio[0]?.url : null) ??
          localized?.output?.url ??
          localized?.audio_file?.url ??
          null;

        // 如果是 ASR 結果，提取文字
        let text = "";
        if (typeof localized?.text === "string") text = localized.text;
        else if (typeof localized?.transcription === "string")
          text = localized.transcription;
        else if (Array.isArray(localized?.segments))
          text = localized.segments
            .map((s: any) => s?.text ?? "")
            .filter(Boolean)
            .join(" ");

        return {
          status: "COMPLETED",
          audio_url: audioUrl,
          text: text.trim() || null,
          raw: localized,
        };
      }

      if (s === "FAILED") {
        const errMsg = status?.error ?? status?.message ?? "未知錯誤";
        // 連動：記錄到錯誤線索系統 → 自動觸發爬網搜尋 → 建立修復提案
        recordErrorTrace({
          userId: 0,
          modality: "audio",
          engine: input.model,
          prompt: `[非同步任務失敗] requestId=${input.requestId}`,
          errorMessage: errMsg,
          errorCode: "FAL_TASK_FAILED",
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `任務失敗 [${input.model}]: ${errMsg}`,
        });
      }

      return { status: "IN_PROGRESS" };
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎼 AudioCompiler — 情緒積木 → 結構化音樂提示詞
  // ═══════════════════════════════════════════════════════════════

  /**
   * compiledTextToMusic — 情緒積木預處理後送往音樂生成
   *
   * 流程：AudioBlock[] → AudioCompiler.compile() → textToMusic (ace-step / sonauto)
   * 解決：proStudio.textToMusic 只接受純文字，繞過了 28KB 的 audioCompiler 邏輯。
   */
  compiledTextToMusic: brainProcedure
    .input(
      z.object({
        blocks: z.array(
          z.object({
            id: z.string(),
            category: z.enum(["instrument", "genre", "tempo", "ambiance"]),
            label: z.string(),
            prompt: z.string(),
          })
        ),
        freePrompt: z.string().optional(),
        moodKeywords: z.array(z.string()).optional(),
        lyrics: z.string().optional(),
        targetDurationSec: z.number().min(10).max(300).optional(),
        instrumental: z.boolean().optional().default(false),
        bpmOverride: z.number().min(40).max(300).optional(),
        // DEF-S1：Stable Audio 支援 negative_prompt（其他音樂模型會忽略）
        negativePrompt: z.string().max(500).optional(),
        model: z
          .enum(["sonauto", "ace-step", "stable-audio", "musicgen"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ── 1. 用 AudioCompiler 將積木轉化為結構化提示詞 ─────────────
      const compiler = getAudioCompiler();
      const compilerInput: AudioCompilerInput = {
        blocks: input.blocks as AudioBlock[],
        freePrompt: input.freePrompt,
        moodKeywords: input.moodKeywords,
        lyrics: input.lyrics,
        targetDurationSec: input.targetDurationSec,
        instrumental: input.instrumental,
        bpmOverride: input.bpmOverride,
      };
      const compiled = compiler.compile(compilerInput);

      // ── 2. 依選定模型送出 fal.ai 任務 ────────────────────────────
      // DEF-15：接通大腦 audioEngine — 未指定 model 時依大腦組態選擇引擎
      const modelChoice = resolveMusicModelChoice(
        input.model,
        ctx.brain.generation.audioEngine.engine
      );
      const durationSec =
        input.targetDurationSec ?? compiled.estimatedDurationSec ?? 30;

      if (modelChoice === "sonauto") {
        const falModelId = "fal-ai/sonauto";
        const payload: Record<string, unknown> = {
          prompt: compiled.prompt,
        };
        if (compiled.styleTag) {
          payload.tags = compiled.styleTag
            .split(",")
            .map(t => t.trim())
            .filter(Boolean);
        }
        if (input.lyrics && !input.instrumental) {
          payload.lyrics_prompt = input.lyrics;
        } else if (input.instrumental) {
          payload.lyrics_prompt = "";
        }
        if (input.bpmOverride) payload.bpm = input.bpmOverride;
        payload.output_format = "mp3";
        payload.num_songs = 1;

        const charged = await chargeForFalTask(ctx.user.id, falModelId, { durationSec });
        try {
          const { request_id } = await falQueueSubmit("sonauto/v2/text-to-music", payload);
          return {
            request_id,
            model: "sonauto/v2/text-to-music",
            is_async_polling: true,
            compiledPrompt: compiled.prompt,
            styleTag: compiled.styleTag,
            estimatedDurationSec: compiled.estimatedDurationSec,
            compilationLog: compiled.compilationLog,
            estimated_credits: charged,
          };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      if (modelChoice === "stable-audio") {
        const falModelId = "fal-ai/stable-audio";
        const charged = await chargeForFalTask(ctx.user.id, falModelId, { durationSec });
        const stablePayload: Record<string, unknown> = {
          prompt: compiled.prompt,
          seconds_total: durationSec,
        };
        // DEF-S1：Stable Audio 支援 negative_prompt
        if (input.negativePrompt) stablePayload.negative_prompt = input.negativePrompt;
        try {
          const { request_id } = await falQueueSubmit(falModelId, stablePayload);
          return {
            request_id,
            model: falModelId,
            is_async_polling: true,
            compiledPrompt: compiled.prompt,
            styleTag: compiled.styleTag,
            estimatedDurationSec: compiled.estimatedDurationSec,
            compilationLog: compiled.compilationLog,
            estimated_credits: charged,
          };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      if (modelChoice === "musicgen") {
        const falModelId = "fal-ai/musicgen";
        const charged = await chargeForFalTask(ctx.user.id, falModelId, { durationSec });
        try {
          const { request_id } = await falQueueSubmit(falModelId, {
            prompt: compiled.prompt,
            duration: durationSec,
          });
          return {
            request_id,
            model: falModelId,
            is_async_polling: true,
            compiledPrompt: compiled.prompt,
            styleTag: compiled.styleTag,
            estimatedDurationSec: compiled.estimatedDurationSec,
            compilationLog: compiled.compilationLog,
            estimated_credits: charged,
          };
        } catch (err) {
          await refundUserPoints(ctx.user.id, charged);
          throw err;
        }
      }

      // ace-step（預設）
      const aceModelId = "fal-ai/ace-step";
      const acePayload: Record<string, unknown> = {
        prompt: compiled.prompt,
        ...(input.targetDurationSec
          ? { duration: input.targetDurationSec }
          : compiled.estimatedDurationSec
          ? { duration: compiled.estimatedDurationSec }
          : {}),
      };
      if (input.lyrics && !input.instrumental) {
        acePayload.lyrics = input.lyrics;
      }
      const charged = await chargeForFalTask(ctx.user.id, aceModelId, { durationSec });
      try {
        const { request_id } = await falQueueSubmit(aceModelId, acePayload);
        return {
          request_id,
          model: aceModelId,
          is_async_polling: true,
          compiledPrompt: compiled.prompt,
          styleTag: compiled.styleTag,
          estimatedDurationSec: compiled.estimatedDurationSec,
          compilationLog: compiled.compilationLog,
          estimated_credits: charged,
        };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  // ═══════════════════════════════════════════════════════════════
  // 🎵 Suno 音樂生成（直接走 Suno API，與 fal.ai 並存）
  // ═══════════════════════════════════════════════════════════════

  /**
   * generateMusicSuno — 透過 Suno API 生成音樂（async）
   *
   * 與 textToMusic / compiledTextToMusic 的差異：
   *  - textToMusic 走 fal.ai（ace-step / sonauto / stable-audio / musicgen）
   *  - generateMusicSuno 直接呼叫 Suno API，可使用 customMode 指定歌詞 + 風格
   *
   * 完成後使用 checkMusicSunoStatus 輪詢結果。
   */
  generateMusicSuno: brainProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(4000),
        style: z.string().optional(),
        title: z.string().optional(),
        instrumental: z.boolean().default(false),
        customMode: z.boolean().default(false),
        lyrics: z.string().optional(),
        /** Suno 模型版本：v3.5（穩定預設）/ v4（高品質） */
        modelVersion: z.enum(["v3.5", "v4"]).optional().default("v3.5"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getOrchestrator } = await import("../services/modelClients");
      const { suno } = getOrchestrator();
      if (!suno.isAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SUNO_API_KEY 未設定，請在 Railway → Environment Variables 中新增",
        });
      }

      const { createBackgroundJob } = await import("../db");

      // 依模型版本走對應 catalog 條目（v3.5: 6 pts, v4: 10 pts 起跳）
      const pricingKey = input.modelVersion === "v4" ? "suno-v4" : "suno-v3.5";
      const estimate = estimatePoints(pricingKey, { durationSec: 60 });
      const charged = await chargeForFalTask(ctx.user.id, pricingKey, { durationSec: 60 });

      // 先建 backgroundJob 取得 jobId，才能組出帶 jobId 的 callBackUrl
      const job = await createBackgroundJob({
        userId: ctx.user.id,
        jobType: "audio",
        status: "processing",
        progressMessage: `Suno ${input.modelVersion} 生成中…`,
        resultJson: { estimate } as any,
      });
      const jobId =
        typeof job === "object" && job && "id" in job
          ? ((job as any).id as number)
          : null;

      const siteUrl = process.env.VITE_SITE_URL?.trim();
      const callBackUrl =
        siteUrl && jobId ? `${siteUrl}/api/webhook/suno?jobId=${jobId}` : undefined;

      try {
        const { taskId } = await suno.generateMusic({ ...input, callBackUrl });

        // 把 sunoTaskId 補回 backgroundJob.resultJson，供 webhook / 輪詢反查
        if (jobId) {
          const { updateBackgroundJob } = await import("../db");
          await updateBackgroundJob(jobId, {
            resultJson: {
              sunoTaskId: taskId,
              estimate,
              userId: ctx.user.id,
              modelVersion: input.modelVersion,
            } as any,
          });
        }

        return { taskId, jobId, modelVersion: input.modelVersion, estimated_credits: charged };
      } catch (err) {
        await refundUserPoints(ctx.user.id, charged);
        throw err;
      }
    }),

  /**
   * checkMusicSunoStatus — 輪詢 Suno 生成狀態，完成時本地化 audio URL 並回寫 backgroundJob
   */
  checkMusicSunoStatus: brainProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        jobId: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { getOrchestrator } = await import("../services/modelClients");
      const { suno } = getOrchestrator();
      if (!suno.isAvailable) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "SUNO_API_KEY 未設定",
        });
      }

      const status = await suno.getTaskStatus(input.taskId);

      if (status.status === "completed" && status.clips?.[0]?.audioUrl) {
        const localized = (await localizeResultUrls(
          { audioUrl: status.clips[0].audioUrl, clips: status.clips },
          `generated/${ctx.user.id}/suno-${input.taskId}`
        )) as { audioUrl: string; clips: typeof status.clips };

        if (input.jobId) {
          const { updateBackgroundJob } = await import("../db");
          await updateBackgroundJob(input.jobId, {
            status: "completed",
            progress: 100,
            resultJson: localized as any,
          });
        }

        return {
          status: "COMPLETED" as const,
          audioUrl: localized.audioUrl,
          clips: localized.clips,
        };
      }

      return {
        status: status.status,
        audioUrl: null,
        clips: status.clips ?? [],
      };
    }),
});

export type ProStudioRouter = typeof proStudioRouter;
