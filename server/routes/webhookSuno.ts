/**
 * webhookSuno.ts — Suno (apibox.erweima.ai) Webhook 回呼端點
 *
 * 解決問題：
 *   Suno 音樂生成是 async，原本只提供 checkMusicSunoStatus query 讓前端輪詢。
 *   若使用者關閉瀏覽器，任務完成時無法持久化結果到 backgroundJobs，
 *   下次回到 Studio 看不到產出。
 *
 * 使用方式（在 SunoClient.generateMusic 時帶入）：
 *   callBackUrl: `${process.env.VITE_SITE_URL}/api/webhook/suno?jobId=<id>`
 *
 * apibox.erweima.ai 完成時會 POST 一個 JSON payload，常見格式：
 *   {
 *     "code": 200,
 *     "msg": "success",
 *     "data": {
 *       "task_id": "...",
 *       "callbackType": "complete" | "first" | "text",
 *       "data": [
 *         { "id": "...", "audio_url": "...", "title": "...", "duration": 180 },
 *         ...
 *       ]
 *     }
 *   }
 */

import { Router, Request, Response } from "express";
import {
  getBackgroundJob,
  updateBackgroundJob,
} from "../db.js";
import { localizeResultUrls } from "../services/internalMedia.js";
import { generationBus } from "../generationEvents";
import {
  runPostGenForJob,
  unifiedAssetPrefix,
  refundJobIfBilled,
} from "../services/postGenActions.js";
import { verifyWebhookToken } from "../_core/webhookTokens";

export const sunoWebhookRouter = Router();

interface SunoWebhookClip {
  id?: string;
  audio_url?: string;
  audioUrl?: string;
  source_audio_url?: string;
  sourceAudioUrl?: string;
  /** new contract: streamable URL while audio_url is still rendering */
  stream_audio_url?: string;
  streamAudioUrl?: string;
  image_url?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  tags?: string;
  prompt?: string;
}

interface SunoWebhookPayload {
  code?: number;
  msg?: string;
  data?: {
    task_id?: string;
    taskId?: string;
    callbackType?: "complete" | "first" | "text" | string;
    status?: string;
    /** Old apibox.erweima.ai webhook shape */
    data?: SunoWebhookClip[];
    /**
     * 2026-05 audit: new apibox.erweima.ai shape moved clips here. The
     * status-poll endpoint returns data.response.sunoData[]; the
     * completion webhook sends the same shape. Older code only checked
     * data.data, so live callbacks under the new contract would have
     * been silently dropped (no clips → "Suno 回呼未帶 audio URL" →
     * job marked failed even though Suno succeeded).
     */
    response?: {
      taskId?: string;
      sunoData?: SunoWebhookClip[];
    };
  };
  /** 容許頂層直接帶 task_id / clips 的舊版格式 */
  task_id?: string;
  clips?: SunoWebhookClip[];
  status?: string;
  [key: string]: unknown;
}

function pickJobId(req: Request): number | null {
  const fromQuery = req.query.jobId;
  if (typeof fromQuery === "string" && /^\d+$/.test(fromQuery)) {
    return parseInt(fromQuery, 10);
  }
  return null;
}

function normalizeClips(payload: SunoWebhookPayload): SunoWebhookClip[] {
  // Try every known clip-array location in order: new contract
  // (data.response.sunoData[]), old contract (data.data[]), top-level
  // legacy shape (clips[]).
  const list =
    payload.data?.response?.sunoData ??
    payload.data?.data ??
    payload.clips ??
    [];
  return list
    .map(c => ({
      id: c.id,
      // Accept the actual asset URL in any of the shapes Suno has used.
      // Streaming URLs are an acceptable fallback when the rendered
      // audioUrl isn't ready yet — better than dropping the clip entirely.
      audioUrl:
        c.audioUrl ??
        c.audio_url ??
        c.sourceAudioUrl ??
        c.source_audio_url ??
        c.streamAudioUrl ??
        c.stream_audio_url,
      imageUrl: c.imageUrl ?? c.image_url,
      title: c.title,
      duration: c.duration,
      tags: c.tags,
      prompt: c.prompt,
    }))
    .filter(c => !!c.audioUrl) as SunoWebhookClip[];
}

sunoWebhookRouter.post(
  "/api/webhook/suno",
  async (req: Request, res: Response) => {
    // 1. 立即回 200，避免 Suno 重試
    res.status(200).json({ received: true });

    try {
      const payload = req.body as SunoWebhookPayload;
      const callbackType = payload.data?.callbackType ?? "complete";
      const taskId =
        payload.data?.task_id ?? payload.data?.taskId ?? payload.task_id ?? "";

      console.log(
        `[WebhookSuno] Received: taskId=${taskId} callbackType=${callbackType}`
      );

      const jobId = pickJobId(req);
      if (!jobId) {
        console.warn("[WebhookSuno] Missing jobId query param, dropping payload");
        return;
      }

      // Capability token: server signs `suno:<jobId>` with JWT_SECRET when
      // constructing the callBackUrl (proStudio router). Without this any
      // POST that guesses the numeric jobId can mark a job completed with
      // attacker-controlled audio/image URLs.
      const token =
        typeof req.query.token === "string" ? req.query.token : null;
      if (!verifyWebhookToken("suno", jobId, token)) {
        console.warn(
          `[WebhookSuno] Token mismatch for jobId=${jobId}, dropping payload`
        );
        return;
      }

      const job = await getBackgroundJob(jobId);
      if (!job) {
        console.warn(`[WebhookSuno] No job found for id=${jobId}`);
        return;
      }

      // 2. text / first 階段是部分結果（lyrics ready / first clip ready），更新進度即可
      if (callbackType === "text") {
        const progress = 30;
        const message = "Suno 歌詞生成完成…";
        await updateBackgroundJob(jobId, {
          status: "processing",
          progress,
          progressMessage: message,
        });
        generationBus.emit(jobId, { type: "progress", progress, message });
        return;
      }
      if (callbackType === "first") {
        const progress = 70;
        const message = "Suno 第一首試聽片段就緒…";
        await updateBackgroundJob(jobId, {
          status: "processing",
          progress,
          progressMessage: message,
        });
        generationBus.emit(jobId, { type: "progress", progress, message });
        return;
      }

      // 3. complete：全部 clip 就緒，本地化 audio URL 並寫入結果
      const clips = normalizeClips(payload);
      if (clips.length === 0) {
        const errorMessage =
          payload.msg && payload.code !== 200
            ? `Suno: ${payload.msg}`
            : "Suno 回呼未帶 audio URL";
        await updateBackgroundJob(jobId, {
          status: "failed",
          progress: 0,
          progressMessage: "Suno 生成失敗",
          errorMessage,
        });
        // Suno 回呼未帶 audio URL → 使用者沒成品,退回 chargeForFalTask 預扣的點數
        // （proStudio.generateMusicSuno 已將 costPoints 寫入 resultJson）。
        void refundJobIfBilled(jobId);
        generationBus.emit(jobId, { type: "error", message: errorMessage });
        return;
      }

      // 統一前綴：generated/studio/<userId>/suno/<taskId>。
      const localized = (await localizeResultUrls(
        { clips, audioUrl: clips[0]?.audioUrl },
        unifiedAssetPrefix({
          userId: job.userId,
          source: "suno",
          modelId: taskId || String(jobId),
        })
      )) as { clips: SunoWebhookClip[]; audioUrl?: string };

      // Merge with existing meta (studioType/modelId/prompt/label/sunoTaskId/
      // estimate/modelVersion written by proStudio.generateMusicSuno) instead
      // of overwriting. Without the merge, runPostGenForJob can't tell which
      // studio/model produced the audio, so the asset never lands in
      // digital_asset_library or generation_history — i.e. the user generates
      // music but can't find it anywhere afterwards ("生成後都找不到東西").
      const existingMeta = (job.resultJson ?? {}) as Record<string, unknown>;
      const resultUrl =
        localized.audioUrl ?? localized.clips[0]?.audioUrl;
      await updateBackgroundJob(jobId, {
        status: "completed",
        progress: 100,
        progressMessage: "生成完成",
        resultJson: {
          // studioType/modelId/sourceStudio 只是「沒有既有 meta 時」的後備值，
          // 必須放在 spread 之前，讓 proStudio.generateMusicSuno 寫入的精確值
          // （如 modelId="suno-v3.5"、sourceStudio="music-studio"）勝出 —— 否則
          // runPostGenForJob 認不出來源 studio/model，資產就不會落進資產庫/歷史
          // （即註解所述「生成後都找不到東西」的 bug）。
          studioType: "audio",
          modelId: "suno",
          sourceStudio: "pro",
          ...existingMeta,
          // 以下為 webhook 權威欄位，永遠以本次回呼為準。
          sunoTaskId: taskId,
          mediaType: "audio",
          audioUrl: resultUrl,
          resultUrl,
          clips: localized.clips,
          completedAt: new Date().toISOString(),
        } as any,
      });
      // Persist to prompt_library / digital_asset_library / generation_history
      // / AI monitor. Idempotent — both webhook and polling fallback may call
      // this; the second one short-circuits on the postGenComplete flag.
      void runPostGenForJob(jobId);
      generationBus.emit(jobId, { type: "complete", thoughtChain: [] });
      console.log(
        `[WebhookSuno] ✅ Job ${jobId} completed (${localized.clips.length} clips)`
      );
    } catch (err) {
      console.error("[WebhookSuno] Error processing webhook:", err);
    }
  }
);
