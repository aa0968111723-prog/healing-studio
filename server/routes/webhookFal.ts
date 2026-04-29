/**
 * webhookFal.ts — fal.ai Webhook 回呼端點
 *
 * 解決問題：
 *   fal.ai 影片/音訊生成任務完成後，會主動 POST 到此端點回傳結果。
 *   不再依賴前端輪詢 ─ 瀏覽器關閉後任務結果仍會被持久化到 backgroundJobs 資料表。
 *
 * 使用方式（在 fal.ai queue.submit 時帶入）：
 *   webhookUrl: `${process.env.VITE_SITE_URL}/api/webhook/fal`
 *
 * fal.ai Webhook 文件：https://fal.ai/docs/webhooks
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import {
  getBackgroundJob,
  updateBackgroundJob,
} from "../db.js";
import { localizeResultUrls } from "../services/internalMedia.js";

export const falWebhookRouter = Router();

// ─── Webhook 簽名驗證（可選，fal.ai 支援 HMAC-SHA256）─────────────────────────
function verifyFalSignature(req: Request): boolean {
  const secret = process.env.FAL_WEBHOOK_SECRET;
  // 若未設定 secret，跳過驗證（開發期間可接受）
  if (!secret) return true;

  const signature = req.headers["x-fal-signature"] as string | undefined;
  if (!signature) return false;

  const body = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
}

// ─── POST /api/webhook/fal ─────────────────────────────────────────────────
falWebhookRouter.post(
  "/api/webhook/fal",
  async (req: Request, res: Response) => {
    // 1. 立即回 200，避免 fal.ai 重試
    res.status(200).json({ received: true });

    try {
      // 2. 簽名驗證
      if (!verifyFalSignature(req)) {
        console.warn("[WebhookFal] ⚠️  Invalid signature, ignoring payload.");
        return;
      }

      const payload = req.body as FalWebhookPayload;
      const orbTraceId = (req.headers["x-orb-trace-id"] as string | undefined) || payload.orbTraceId || payload.request_id;

      console.log(
        `[WebhookFal] Received: requestId=${payload.request_id} status=${payload.status}`
      );

      // 3. 從 request_id 找到對應的 backgroundJob
      //    慣例：submit 時將 jobId 存放在 fal.ai 的 metadata / requestId 欄位
      //    這裡透過 request_id 查詢 resultJson 中記錄的 falRequestId
      const jobId = extractJobId(payload);
      if (!jobId) {
        console.warn(
          `[WebhookFal] Cannot extract jobId from request_id: ${payload.request_id}`
        );
        return;
      }

      const job = await getBackgroundJob(jobId);
      if (!job) {
        console.warn(`[WebhookFal] No job found for id=${jobId}`);
        return;
      }

      // 4. 根據 webhook status 更新 job
      if (payload.status === "OK" || payload.status === "COMPLETED") {
        // 成功：取出結果 URL，並將外部 CDN URL 持久化到 S3
        const rawResult = extractResultData(payload);
        const resultData = (await localizeResultUrls(
          rawResult,
          `generated/webhook/${jobId}`
        )) as typeof rawResult;
        (resultData as Record<string, unknown>).orbTraceId = orbTraceId;
        await updateBackgroundJob(jobId, {
          status: "completed",
          progress: 100,
          progressMessage: "生成完成",
          resultJson: resultData as any,
        });
        console.log(
          `[WebhookFal] ✅ Job ${jobId} completed. orbTraceId=${orbTraceId} Result URLs saved.`
        );
      } else if (payload.status === "ERROR") {
        await updateBackgroundJob(jobId, {
          status: "failed",
          progress: 0,
          progressMessage: "生成失敗",
          errorMessage: payload.error ?? "fal.ai 回傳錯誤",
        });
        console.error(
          `[WebhookFal] ❌ Job ${jobId} failed: ${payload.error} orbTraceId=${orbTraceId}`
        );
      } else {
        // IN_QUEUE / IN_PROGRESS：更新進度
        const progress = payload.status === "IN_PROGRESS" ? 50 : 10;
        await updateBackgroundJob(jobId, {
          status: "processing",
          progress,
          progressMessage:
            payload.status === "IN_PROGRESS" ? "生成中..." : "排隊中...",
        });
      }
    } catch (err) {
      console.error("[WebhookFal] Error processing webhook:", err);
    }
  }
);

// ─── 型別定義 ───────────────────────────────────────────────────────────────

interface FalWebhookPayload {
  request_id: string;
  /** OK | ERROR | IN_QUEUE | IN_PROGRESS | COMPLETED */
  status: string;
  error?: string;
  payload?: Record<string, unknown>;
  /** fal.ai 標準輸出：影片 */
  video?: { url: string; content_type?: string };
  /** fal.ai 標準輸出：圖片陣列 */
  images?: Array<{ url: string; content_type?: string }>;
  /** fal.ai 標準輸出：音訊 */
  audio?: { url: string; content_type?: string };
  /** 任意額外欄位 */
  orbTraceId?: string;
  [key: string]: unknown;
}

/**
 * 從 fal.ai request_id 萃取 backgroundJob.id
 * 慣例：submit 時使用 `fal-job-{jobId}-{timestamp}` 作為 request_id 前綴
 * 或：將 jobId 存入 fal.ai metadata（如有支援）
 */
function extractJobId(payload: FalWebhookPayload): number | null {
  // 嘗試從 request_id 解析（格式：fal-job-{id}-...）
  const match = payload.request_id?.match(/fal-job-(\d+)/);
  if (match) return parseInt(match[1], 10);

  // 嘗試從 payload metadata 解析
  const meta = payload.payload as any;
  if (meta?.jobId && typeof meta.jobId === "number") return meta.jobId;

  return null;
}

/**
 * 從 webhook payload 萃取結果資料（URL、duration 等）
 */
function extractResultData(payload: FalWebhookPayload): Record<string, unknown> {
  const result: Record<string, unknown> = {
    falRequestId: payload.request_id,
    completedAt: new Date().toISOString(),
  };

  if (payload.video?.url) {
    result.videoUrl = payload.video.url;
    result.mediaType = "video";
  }
  if (payload.images?.length) {
    result.imageUrl = payload.images[0].url;
    result.images = payload.images.map(i => i.url);
    result.mediaType = "image";
  }
  if (payload.audio?.url) {
    result.audioUrl = payload.audio.url;
    result.mediaType = "audio";
  }

  // 保留完整 payload 供除錯
  result.rawPayload = payload.payload ?? {};

  return result;
}
