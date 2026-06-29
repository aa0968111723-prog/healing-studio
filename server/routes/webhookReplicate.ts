/**
 * webhookReplicate.ts — Replicate Training Webhook 回呼端點
 *
 * 解決問題：
 *   Replicate LoRA 訓練是 async（5–20 分鐘），原本只提供 replicateTrainingStatus
 *   query 讓前端輪詢。瀏覽器關閉後 fineTunedModels.status 會卡在 "training"，
 *   下次回到「我的模型」看不到完成狀態。
 *
 * 使用方式（在 startReplicateTraining 時帶入）：
 *   webhook: `${process.env.VITE_SITE_URL}/api/webhook/replicate?modelId=<id>`
 *
 * Replicate 完成時 POST 標準 prediction object：
 *   {
 *     "id": "...",
 *     "status": "succeeded" | "failed" | "canceled",
 *     "output": "<weights URL>" | { weights: "..." } | [...],
 *     "error": "...",
 *     ...
 *   }
 *
 * 文件：https://replicate.com/docs/reference/webhooks
 */

import { Router, Request, Response } from "express";
import { updateFineTunedModel, getFineTunedModel } from "../db.js";
import type { InsertFineTunedModel } from "../../drizzle/schema";
import { generationBus } from "../generationEvents";
import { verifyWebhookToken } from "../_core/webhookTokens";

export const replicateWebhookRouter = Router();

interface ReplicatePredictionPayload {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  output?: unknown;
  error?: unknown;
  metrics?: Record<string, unknown>;
  completed_at?: string;
  [key: string]: unknown;
}

function pickModelId(req: Request): number | null {
  const fromQuery = req.query.modelId;
  if (typeof fromQuery === "string" && /^\d+$/.test(fromQuery)) {
    return parseInt(fromQuery, 10);
  }
  return null;
}

function extractWeightsUrl(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "weights" in (first as object)) {
      const w = (first as { weights?: unknown }).weights;
      if (typeof w === "string") return w;
    }
  }
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    if (typeof obj.weights === "string") return obj.weights;
    if (typeof obj.url === "string") return obj.url;
  }
  return null;
}

replicateWebhookRouter.post(
  "/api/webhook/replicate",
  async (req: Request, res: Response) => {
    // 1. 立即回 200，避免 Replicate 重試
    res.status(200).json({ received: true });

    try {
      const payload = req.body as ReplicatePredictionPayload;
      const trainingId = payload.id ?? "(unknown)";
      const status = payload.status ?? "(unknown)";

      console.log(
        `[WebhookReplicate] Received: trainingId=${trainingId} status=${status}`
      );

      const modelId = pickModelId(req);
      if (!modelId) {
        console.warn(
          "[WebhookReplicate] Missing modelId query param, dropping payload"
        );
        return;
      }

      // Capability token: server signs `replicate:<modelId>` with JWT_SECRET
      // when constructing the webhook URL (loraTrainer / routers/loraTrainer).
      // Reject any callback whose token doesn't match the expected HMAC so a
      // forged POST cannot mark someone else's model as ready / failed.
      const token =
        typeof req.query.token === "string" ? req.query.token : null;
      if (!verifyWebhookToken("replicate", modelId, token)) {
        console.warn(
          `[WebhookReplicate] Token mismatch for modelId=${modelId}, dropping payload`
        );
        return;
      }

      const model = await getFineTunedModel(modelId);
      if (!model) {
        console.warn(`[WebhookReplicate] No fineTunedModel found id=${modelId}`);
        return;
      }

      // AIDV-610: 終態守門（比照 webhookFal）。model 已是終態（ready/failed）就短路，
      // 避免遲到/重送的 failed/canceled 回呼把已 ready 的 LoRA 模型覆寫回 failed、
      // 並重發一次 error SSE。Replicate 在非 2xx 回應時會重送，加上網路亂序，
      // 仍可能在 ready 之後再收到終態回呼 —— 這道守門保證終態只寫一次。
      if (model.status === "ready" || model.status === "failed") {
        console.log(
          `[WebhookReplicate] Model ${modelId} already ${model.status}, ignoring duplicate/late webhook`
        );
        return;
      }

      // Webhook events_filter 設為 ["completed"]，理論上只有終態會送進來，
      // 但仍 defensively 處理 in-progress 狀態避免誤封 status。
      if (status === "starting" || status === "processing") {
        return; // 中間狀態不更新 DB（避免覆寫 trainWithReplicate 已寫入的 "training"）
      }

      const existingConfig =
        (model.configJson as Record<string, unknown> | null) ?? {};

      const completedAtMs = payload.completed_at
        ? Date.parse(payload.completed_at) || Date.now()
        : Date.now();

      if (status === "succeeded") {
        const weightsUrl = extractWeightsUrl(payload.output);
        await updateFineTunedModel(modelId, {
          status: "ready",
          replicatePredictionId: trainingId,
          ...(weightsUrl ? { trainedLoraUrl: weightsUrl } : {}),
          configJson: {
            ...existingConfig,
            predictionId: trainingId,
            completedAt: completedAtMs,
          } as InsertFineTunedModel["configJson"],
        });
        // 推 SSE，讓「我的模型 / LoRA 訓練」頁面立即收到完成通知
        generationBus.emitTraining(modelId, {
          type: "complete",
          thoughtChain: [],
        });
        console.log(
          `[WebhookReplicate] ✅ Model ${modelId} ready (training ${trainingId})`
        );
        return;
      }

      if (status === "failed" || status === "canceled") {
        const errMsg =
          typeof payload.error === "string"
            ? payload.error
            : JSON.stringify(payload.error ?? "Replicate 訓練失敗");
        await updateFineTunedModel(modelId, {
          status: "failed",
          replicatePredictionId: trainingId,
          configJson: {
            ...existingConfig,
            predictionId: trainingId,
            completedAt: completedAtMs,
          } as InsertFineTunedModel["configJson"],
        });
        generationBus.emitTraining(modelId, {
          type: "error",
          message: errMsg,
        });
        console.error(
          `[WebhookReplicate] ❌ Model ${modelId} failed (training ${trainingId}): ${errMsg}`
        );
      }
    } catch (err) {
      console.error("[WebhookReplicate] Error processing webhook:", err);
    }
  }
);
