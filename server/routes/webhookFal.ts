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
  findProcessingJobByRequestId,
} from "../db.js";
import { serverEnv } from "../_core/env.validated";
import { localizeResultUrls } from "../services/internalMedia.js";
import { generationBus } from "../generationEvents";
import { runPostGenForJob, refundJobIfBilled } from "../services/postGenActions.js";
import { extractFalMediaUrl } from "../services/falQueueAwaiter.js";

export const falWebhookRouter = Router();

// ─── Webhook 簽名驗證（可選，HMAC-SHA256 共享密鑰）─────────────────────────
// 注意：fal.ai 官方 webhook 用 Ed25519 + JWKS（見 https://fal.ai/docs/private-serverless-models/webhooks）。
// 本函式驗證的是「自家共用 HMAC 機密」(FAL_WEBHOOK_SECRET) — 適合在 fal.ai
// 與本服務之間放一層 proxy / 自家 enqueue 服務時使用。原生 fal Ed25519 驗證
// 應在另外一條路徑做 (TODO: 補完整 Ed25519 驗證 with caching)。
//
// 重要：必須使用 req.rawBody（由 _core/index.ts 的 express.json verify 鉤子保留）
// 而非 JSON.stringify(req.body)，因為 JSON.stringify 不保證鍵序與 whitespace
// 與原始位元組相同，HMAC 會失敗。
function verifyFalSignature(req: Request): boolean {
  const secret = serverEnv.FAL_WEBHOOK_SECRET;
  // 若未設定 secret，跳過驗證（開發期間可接受）
  if (!secret) return true;

  const signature = req.headers["x-fal-signature"] as string | undefined;
  if (!signature) return false;

  const rawBody =
    (req as Request & { rawBody?: Buffer }).rawBody ??
    Buffer.from(JSON.stringify(req.body ?? {}));
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const expectedHeader = `sha256=${expected}`;

  // 長度不一致時直接 false，避免 timingSafeEqual 因長度不同直接 throw
  if (signature.length !== expectedHeader.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedHeader)
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

      // 3. 找到對應的 backgroundJob：
      //    a) query string ?jobId 優先（submitMultimodalAsync / videoStudio 帶）
      //    b) request_id 正則 / metadata fallback（早期格式）
      //    c) 透過 payload.request_id 反查 resultJson.requestId（imageStudio /
      //       proStudio 流程：先送 fal、後由前端 submitStudioJob 建 backgroundJob）
      let jobId = extractJobId(req, payload);
      if (!jobId && payload.request_id) {
        const matched = await findProcessingJobByRequestId(payload.request_id);
        if (matched?.id) {
          jobId = matched.id;
          console.log(
            `[WebhookFal] Matched job ${jobId} via resultJson.requestId lookup`
          );
        }
      }
      if (!jobId) {
        console.warn(
          `[WebhookFal] Cannot resolve jobId for request_id=${payload.request_id}`
        );
        return;
      }

      const job = await getBackgroundJob(jobId);
      if (!job) {
        console.warn(`[WebhookFal] No job found for id=${jobId}`);
        return;
      }

      // 4. 根據 webhook status 更新 job + 透過 generationBus 推 SSE 事件
      //    讓訂閱 /api/generation-events/:jobId 的前端立即收到完成/失敗通知，
      //    不必等下一輪 5s 輪詢
      if (payload.status === "OK" || payload.status === "COMPLETED") {
        // 成功：取出結果 URL，並將外部 CDN URL 持久化到 S3
        const rawResult = extractResultData(payload);
        const resultData = (await localizeResultUrls(
          rawResult,
          `generated/webhook/${jobId}`
        )) as typeof rawResult;
        (resultData as Record<string, unknown>).orbTraceId = orbTraceId;
        // 合併既有 meta（studioType / modelId / prompt / label，由 submitStudioJob
        // 寫入）與本次 webhook 的結果欄位。原本是直接 overwrite，會造成
        // runPostGenForJob 找不到 studioType/modelId/prompt → 永不持久化到
        // 資產庫/歷史/提示詞庫。
        const existingMeta = (job.resultJson ?? {}) as Record<string, unknown>;
        // resultUrl 統一鍵名，下游（runPostGenForJob、前端）優先讀此欄位。
        // 用通用 extractor 重新解析 localize 過後的物件 — 涵蓋 root / data /
        // output / result 四種 envelope + nested {video: {url}} / video_url /
        // images[0].url 等 shape,避免漏接 fal 不同模型族系的 shape 差異。
        const localizedData = resultData as Record<string, unknown>;
        const extracted = extractFalMediaUrl(localizedData);
        const resultUrl =
          extracted.output_url ??
          (localizedData.imageUrl as string | undefined) ??
          (localizedData.videoUrl as string | undefined) ??
          (localizedData.audioUrl as string | undefined) ??
          undefined;

        // ⚠️ 若 status=OK 卻完全沒 URL → 不要標 completed,改標 failed,
        // 讓 UI 顯示「需重試」而不是一張無預覽無下載的卡片永遠卡在資產庫。
        if (!resultUrl) {
          const errMsg =
            "生成已完成但無法解析結果連結（fal 回傳格式異常），請重試或更換模型";
          await updateBackgroundJob(jobId, {
            status: "failed",
            errorMessage: errMsg,
            resultJson: {
              ...existingMeta,
              ...localizedData,
            } as any,
          });
          // 拿不到結果 URL → 使用者沒成品,退回 submitMultimodalAsync 預扣的點數。
          void refundJobIfBilled(jobId);
          generationBus.emit(jobId, { type: "error", message: errMsg });
          console.warn(
            `[WebhookFal] ⚠️  Job ${jobId} completed but no URL extracted. orbTraceId=${orbTraceId} rawPayload=${JSON.stringify(localizedData.rawPayload ?? {}).slice(0, 400)}`
          );
          return;
        }

        // 同時補上各模態 top-level URL 鍵（videoUrl/imageUrl/audioUrl），
        // 讓不同前端頁面（用 r.videoUrl / r.imageUrl / r.resultUrl 任一格）
        // 都能找到 URL,不再依賴 extractResultData 是否剛好寫對 key。
        const urlFields: Record<string, unknown> = {};
        if (extracted.video_url && !localizedData.videoUrl)
          urlFields.videoUrl = extracted.video_url;
        if (extracted.image_url && !localizedData.imageUrl)
          urlFields.imageUrl = extracted.image_url;
        if (extracted.audio_url && !localizedData.audioUrl)
          urlFields.audioUrl = extracted.audio_url;

        await updateBackgroundJob(jobId, {
          status: "completed",
          progress: 100,
          progressMessage: "生成完成",
          resultJson: {
            ...existingMeta,
            ...localizedData,
            ...urlFields,
            resultUrl,
          } as any,
        });
        // 後置動作（idempotent）：寫入提示詞庫 / 資產庫 / 歷史 / AI 監控室
        // 這層原本只在 polling 跑，但 webhook 通常先抵達 → polling 走 short
        // circuit → 資產永遠不入庫。修這條後 ImageStudio / VideoStudio /
        // ProStudio 三條 studio 的成品都會自動進使用者的「我的資產」。
        void runPostGenForJob(jobId);
        generationBus.emit(jobId, { type: "complete", thoughtChain: [] });
        console.log(
          `[WebhookFal] ✅ Job ${jobId} completed. orbTraceId=${orbTraceId} Result URLs saved.`
        );
      } else if (payload.status === "ERROR") {
        const errorMessage = payload.error ?? "fal.ai 回傳錯誤";
        await updateBackgroundJob(jobId, {
          status: "failed",
          progress: 0,
          progressMessage: "生成失敗",
          errorMessage,
        });
        // fal.ai 回 ERROR → 退回 submitMultimodalAsync 預扣的點數
        // （與 checkStudioJob FAILED 路徑對稱,refunded 旗標確保只退一次）。
        void refundJobIfBilled(jobId);
        generationBus.emit(jobId, { type: "error", message: errorMessage });
        console.error(
          `[WebhookFal] ❌ Job ${jobId} failed: ${payload.error} orbTraceId=${orbTraceId}`
        );
      } else {
        // IN_QUEUE / IN_PROGRESS：更新進度
        const progress = payload.status === "IN_PROGRESS" ? 50 : 10;
        const message =
          payload.status === "IN_PROGRESS" ? "生成中..." : "排隊中...";
        await updateBackgroundJob(jobId, {
          status: "processing",
          progress,
          progressMessage: message,
        });
        generationBus.emit(jobId, { type: "progress", progress, message });
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
 * 從 fal.ai webhook 找到對應 backgroundJob.id：
 * 1. 優先讀 query string `?jobId=<id>`（呼叫端組 webhook URL 時帶入，最可靠）
 * 2. 退而求其次用 request_id 配 `fal-job-(\d+)` 正則（早期格式）
 * 3. 再退就讀 payload metadata.jobId
 */
function extractJobId(req: Request, payload: FalWebhookPayload): number | null {
  const fromQuery = req.query.jobId;
  if (typeof fromQuery === "string" && /^\d+$/.test(fromQuery)) {
    return parseInt(fromQuery, 10);
  }

  const match = payload.request_id?.match(/fal-job-(\d+)/);
  if (match) return parseInt(match[1], 10);

  const meta = payload.payload as any;
  if (meta?.jobId && typeof meta.jobId === "number") return meta.jobId;

  return null;
}

/**
 * 從 webhook payload 萃取結果資料（URL、duration 等）。
 *
 * fal.ai webhook 的實際格式是 `{ status, request_id, payload: <model_output> }`，
 * 也就是真正的模型輸出（images/video/audio）會被包在 `payload.payload` 裡。
 * 早期內部測試 mock 卻把這些欄位放在 top-level。
 *
 * 為了同時支援兩種來源，我們把 top-level 與 nested envelope 都當成候選來掃，
 * 取第一個有 URL 的命中者。沒這層相容,生產環境的 fal webhook 會送進來但 URL
 * 全部抓不到,job 雖然標 completed 但 resultUrl 卻是 undefined,前端就一直
 * 顯示「處理中」直到 30 分鐘超時。
 */
function extractResultData(payload: FalWebhookPayload): Record<string, unknown> {
  const result: Record<string, unknown> = {
    falRequestId: payload.request_id,
    completedAt: new Date().toISOString(),
  };

  type FalLikePayload = {
    video?: { url?: string };
    images?: Array<{ url?: string }>;
    audio?: { url?: string };
    image?: { url?: string };
    image_url?: string;
    video_url?: string;
    audio_url?: string;
  };
  const candidates: FalLikePayload[] = [
    payload as unknown as FalLikePayload,
    (payload.payload ?? {}) as FalLikePayload,
  ];

  for (const c of candidates) {
    if (!result.videoUrl && (c.video?.url || c.video_url)) {
      result.videoUrl = c.video?.url ?? c.video_url;
      result.mediaType = "video";
    }
    if (!result.imageUrl) {
      const firstImg = c.images?.[0]?.url ?? c.image?.url ?? c.image_url;
      if (firstImg) {
        result.imageUrl = firstImg;
        if (Array.isArray(c.images)) {
          result.images = c.images
            .map(i => i.url)
            .filter((u): u is string => typeof u === "string");
        }
        result.mediaType = result.mediaType ?? "image";
      }
    }
    if (!result.audioUrl && (c.audio?.url || c.audio_url)) {
      result.audioUrl = c.audio?.url ?? c.audio_url;
      result.mediaType = result.mediaType ?? "audio";
    }
  }

  // 保留完整 payload 供除錯
  result.rawPayload = payload.payload ?? {};

  return result;
}
