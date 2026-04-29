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

export const sunoWebhookRouter = Router();

interface SunoWebhookClip {
  id?: string;
  audio_url?: string;
  audioUrl?: string;
  source_audio_url?: string;
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
    data?: SunoWebhookClip[];
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
  const list = payload.data?.data ?? payload.clips ?? [];
  return list
    .map(c => ({
      id: c.id,
      audioUrl: c.audioUrl ?? c.audio_url ?? c.source_audio_url,
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
        generationBus.emit(jobId, { type: "error", message: errorMessage });
        return;
      }

      const localized = (await localizeResultUrls(
        { clips, audioUrl: clips[0]?.audioUrl },
        `generated/webhook/suno/${jobId}`
      )) as { clips: SunoWebhookClip[]; audioUrl?: string };

      await updateBackgroundJob(jobId, {
        status: "completed",
        progress: 100,
        progressMessage: "生成完成",
        resultJson: {
          sunoTaskId: taskId,
          mediaType: "audio",
          audioUrl: localized.audioUrl ?? localized.clips[0]?.audioUrl,
          clips: localized.clips,
          completedAt: new Date().toISOString(),
        } as any,
      });
      generationBus.emit(jobId, { type: "complete", thoughtChain: [] });
      console.log(
        `[WebhookSuno] ✅ Job ${jobId} completed (${localized.clips.length} clips)`
      );
    } catch (err) {
      console.error("[WebhookSuno] Error processing webhook:", err);
    }
  }
);
