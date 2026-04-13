/**
 * loraTrainer.ts — LoRA 訓練工坊 Router（Replicate 專屬）
 *
 * 提供 LoRA 訓練專屬的 API 端點：
 *  - 取得訓練統計資訊
 *  - 取得 Replicate 帳號狀態
 *  - 查詢訓練歷史紀錄（含詳細 Replicate prediction 資訊）
 *  - 取得單一模型的完整訓練詳情
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const loraTrainerRouter = router({
  /**
   * 取得用戶 LoRA 訓練總覽統計
   */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);
    const total = models.length;
    const ready = models.filter((m) => m.status === "ready").length;
    const training = models.filter((m) => m.status === "training").length;
    const failed = models.filter((m) => m.status === "failed").length;
    const pending = models.filter((m) => m.status === "pending").length;
    const totalUsage = models.reduce(
      (sum, m) => sum + ((m as Record<string, unknown>).usageCount as number ?? 0),
      0,
    );

    return { total, ready, training, failed, pending, totalUsage };
  }),

  /**
   * 取得 Replicate API 連線狀態
   */
  replicateStatus: protectedProcedure.query(async () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return {
        connected: false,
        message: "REPLICATE_API_TOKEN 未設定",
      };
    }

    try {
      const Replicate = (await import("replicate")).default;
      const replicate = new Replicate({ auth: token });

      // Use a simple API call to verify the token works
      // Get the training model info to verify connectivity
      const model = await replicate.models.get("ostris", "flux-dev-lora-trainer");
      const modelObj = model as unknown as Record<string, unknown> | null;
      return {
        connected: true,
        message: "Replicate API 連線正常",
        trainingModel: modelObj
          ? `${modelObj.owner ?? "ostris"}/${modelObj.name ?? "flux-dev-lora-trainer"}`
          : "ostris/flux-dev-lora-trainer",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        connected: false,
        message: `Replicate API 連線失敗：${msg}`,
      };
    }
  }),

  /**
   * 取得用戶的訓練歷史（含 Replicate prediction 資訊）
   */
  trainingHistory: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);

    return models.map((m) => {
      const config = m.configJson as Record<string, unknown> | null;
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        status: m.status,
        modelType: m.modelType,
        triggerWord: (config?.triggerWord as string) || "",
        epochs: (config?.epochs as number) ?? 0,
        learningRate: (config?.learningRate as number) ?? 0,
        steps: (config?.steps as number) ?? 0,
        predictionId: m.replicatePredictionId || (config?.predictionId as string) || null,
        trainedLoraUrl: (m as Record<string, unknown>).trainedLoraUrl as string | null,
        datasetImageCount: Array.isArray(config?.datasetImages)
          ? (config.datasetImages as unknown[]).length
          : 0,
        submittedAt: (config?.submittedAt as number) || null,
        completedAt: (config?.completedAt as number) || null,
        usageCount: (m as Record<string, unknown>).usageCount as number ?? 0,
        visibility: m.visibility,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });
  }),

  /**
   * 取得單一模型的完整訓練詳情（含 Replicate 即時狀態）
   */
  trainingDetail: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.modelId);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }

      const config = model.configJson as Record<string, unknown> | null;
      const predictionId =
        model.replicatePredictionId ||
        (config?.predictionId as string | undefined);

      let replicateInfo: Record<string, unknown> | null = null;

      if (predictionId && process.env.REPLICATE_API_TOKEN) {
        try {
          const Replicate = (await import("replicate")).default;
          const replicate = new Replicate({
            auth: process.env.REPLICATE_API_TOKEN,
          });
          const prediction = (await replicate.predictions.get(
            predictionId,
          )) as unknown as Record<string, unknown>;
          replicateInfo = {
            id: prediction.id,
            status: prediction.status,
            createdAt: prediction.created_at,
            startedAt: prediction.started_at,
            completedAt: prediction.completed_at,
            model: prediction.model,
            version: prediction.version,
            metrics: prediction.metrics,
            error: prediction.error,
          };
        } catch {
          // Silently fail — will show null
        }
      }

      return {
        id: model.id,
        name: model.name,
        description: model.description,
        status: model.status,
        modelType: model.modelType,
        triggerWord: (config?.triggerWord as string) || "",
        epochs: (config?.epochs as number) ?? 0,
        learningRate: (config?.learningRate as number) ?? 0,
        batchSize: (config?.batchSize as number) ?? 4,
        steps: (config?.steps as number) ?? 0,
        predictionId: predictionId || null,
        trainedLoraUrl:
          ((model as Record<string, unknown>).trainedLoraUrl as string) || null,
        zipUrl: (config?.zipUrl as string) || null,
        datasetImages: (config?.datasetImages as unknown[]) || [],
        submittedAt: (config?.submittedAt as number) || null,
        completedAt: (config?.completedAt as number) || null,
        usageCount: (model as Record<string, unknown>).usageCount as number ?? 0,
        visibility: model.visibility,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
        replicateInfo,
      };
    }),
});
