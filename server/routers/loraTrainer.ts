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
   * 取得用戶 LoRA 訓練總覽統計（含所有訓練類型）
   */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);
    const total = models.length;
    const ready = models.filter(m => m.status === "ready").length;
    const training = models.filter(m => m.status === "training").length;
    const failed = models.filter(m => m.status === "failed").length;
    const pending = models.filter(m => m.status === "pending").length;
    const totalUsage = models.reduce(
      (sum, m) =>
        sum + (((m as Record<string, unknown>).usageCount as number) ?? 0),
      0
    );

    // 各類型統計
    const byType: Record<string, number> = {};
    for (const m of models) {
      byType[m.modelType] = (byType[m.modelType] ?? 0) + 1;
    }

    return { total, ready, training, failed, pending, totalUsage, byType };
  }),

  /**
   * 取得 Replicate + Fal.ai API 連線狀態
   */
  replicateStatus: protectedProcedure.query(async () => {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    const falKey = process.env.FAL_API_KEY;

    let replicateConnected = false;
    let replicateMsg = "REPLICATE_API_TOKEN 未設定";
    let trainingModel: string | null = null;

    if (replicateToken) {
      try {
        const { getReplicateClient } =
          await import("../services/replicateClient.js");
        const replicate = getReplicateClient(replicateToken);
        const model = await replicate.models.get(
          "ostris",
          "flux-dev-lora-trainer"
        );
        const modelObj = model as unknown as Record<string, unknown> | null;
        replicateConnected = true;
        replicateMsg = "Replicate API 連線正常";
        trainingModel = modelObj
          ? `${modelObj.owner ?? "ostris"}/${modelObj.name ?? "flux-dev-lora-trainer"}`
          : "ostris/flux-dev-lora-trainer";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        replicateMsg = `Replicate API 連線失敗：${msg}`;
      }
    }

    const falConnected = !!falKey;
    const falMsg = falKey ? "Fal.ai API 已設定" : "FAL_API_KEY 未設定";

    return {
      connected: replicateConnected || falConnected,
      message:
        replicateConnected && falConnected
          ? "Replicate + Fal.ai 雙引擎就緒"
          : replicateConnected
            ? replicateMsg
            : falConnected
              ? falMsg
              : "未設定任何訓練引擎 API Key",
      trainingModel,
      engines: {
        replicate: { connected: replicateConnected, message: replicateMsg },
        fal: { connected: falConnected, message: falMsg },
      },
    };
  }),

  /**
   * 取得用戶的訓練歷史（含 Replicate prediction 資訊）
   */
  trainingHistory: protectedProcedure.query(async ({ ctx }) => {
    const models = await db.getFineTunedModelsByUser(ctx.user.id);

    return models.map(m => {
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
        isStyle: (config?.isStyle as boolean) ?? false,
        predictionId:
          m.replicatePredictionId || (config?.predictionId as string) || null,
        falModelId: (config?.falModelId as string) || null,
        trainingEngine:
          ((m as Record<string, unknown>).trainingEngine as string) ??
          "replicate",
        trainedLoraUrl: (m as Record<string, unknown>).trainedLoraUrl as
          | string
          | null,
        datasetImageCount: Array.isArray(config?.datasetImages)
          ? (config.datasetImages as unknown[]).length
          : 0,
        datasetVideoCount: Array.isArray(config?.datasetVideos)
          ? (config.datasetVideos as unknown[]).length
          : 0,
        submittedAt: (config?.submittedAt as number) || null,
        completedAt: (config?.completedAt as number) || null,
        usageCount: ((m as Record<string, unknown>).usageCount as number) ?? 0,
        visibility: m.visibility,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });
  }),

  /**
   * trainWithReplicate — 啟動 Replicate LoRA 訓練（async，立即回 trainingId）
   *
   * 流程：
   *  1. 共用 falTrainer 的 ZIP 打包+上傳 helper（buildAndUploadZip）
   *  2. 在 fineTunedModels 表建立 record（trainingEngine: "replicate"）
   *  3. 呼叫 replicateClient.startReplicateTraining 啟動 ostris/flux-dev-lora-trainer
   *  4. 將 trainingId 寫回 replicatePredictionId 欄位
   *  5. 前端可用 replicateTrainingStatus 輪詢
   */
  trainWithReplicate: protectedProcedure
    .input(
      z.object({
        modelName: z.string().min(1).max(255),
        description: z.string().optional(),
        modelType: z.enum([
          "image_subject",
          "style_lora",
          "scene_lora",
          "portrait_lora",
        ]),
        triggerWord: z.string().min(1),
        steps: z.number().int().min(100).max(10000).default(1000),
        learningRate: z.number().positive().default(0.0004),
        imageUrls: z.array(z.string().url()).min(4).max(50),
        baseModel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!process.env.REPLICATE_API_TOKEN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "REPLICATE_API_TOKEN 未設定，請在 Railway → Environment Variables 中新增",
        });
      }

      // ── Step 1: 建立 fineTunedModel record（status: pending） ──
      const model = await db.createFineTunedModel({
        userId: ctx.user.id,
        name: input.modelName,
        description: input.description,
        modelType: input.modelType,
        status: "pending",
        trainingEngine: "replicate",
        configJson: {
          triggerWord: input.triggerWord,
          steps: input.steps,
          learningRate: input.learningRate,
        },
      });
      const modelObj = model as unknown as { id: number };
      const modelId = modelObj.id;

      try {
        // ── Step 2: 共用 ZIP 打包+上傳 ──
        const { buildAndUploadZip } = await import("../services/falTrainer");
        const zipUrl = await buildAndUploadZip(
          input.imageUrls,
          ctx.user.id,
          modelId,
          "replicate"
        );

        // ── Step 3: 啟動 Replicate 訓練 ──
        const { startReplicateTraining } = await import(
          "../services/replicateClient"
        );
        const slug = input.modelName
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50);
        // Replicate destination 命名規範：owner/name，使用 token 對應的 username
        // 預設用 user-{userId} 作為 owner（需事先在 Replicate 端建立帳號）
        const destination = `user-${ctx.user.id}/${slug || `lora-${modelId}`}`;

        const siteUrl = process.env.VITE_SITE_URL?.trim();
        const webhook = siteUrl
          ? `${siteUrl}/api/webhook/replicate?modelId=${modelId}`
          : undefined;

        const { trainingId, status } = await startReplicateTraining({
          zipUrl,
          triggerWord: input.triggerWord,
          steps: input.steps,
          learningRate: input.learningRate,
          baseModel: input.baseModel,
          destination,
          webhook,
        });

        // ── Step 4: 寫回 trainingId + 標記為 training ──
        await db.updateFineTunedModel(modelId, {
          status: "training",
          replicatePredictionId: trainingId,
          configJson: {
            triggerWord: input.triggerWord,
            steps: input.steps,
            learningRate: input.learningRate,
            zipUrl,
            predictionId: trainingId,
            submittedAt: Date.now(),
          },
        });

        return {
          modelId,
          trainingId,
          status,
          destination,
          zipUrl,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .updateFineTunedModel(modelId, { status: "failed" })
          .catch(() => {});
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Replicate 訓練啟動失敗：${msg}`,
        });
      }
    }),

  /**
   * replicateTrainingStatus — 查詢 Replicate 訓練狀態
   */
  replicateTrainingStatus: protectedProcedure
    .input(z.object({ trainingId: z.string().min(1) }))
    .query(async ({ input }) => {
      if (!process.env.REPLICATE_API_TOKEN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "REPLICATE_API_TOKEN 未設定",
        });
      }
      const { getReplicateTrainingStatus } = await import(
        "../services/replicateClient"
      );
      return getReplicateTrainingStatus(input.trainingId);
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
          const { getReplicateClient } =
            await import("../services/replicateClient.js");
          const replicate = getReplicateClient();
          const prediction = (await replicate.predictions.get(
            predictionId
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
        usageCount:
          ((model as Record<string, unknown>).usageCount as number) ?? 0,
        visibility: model.visibility,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
        replicateInfo,
      };
    }),
});
