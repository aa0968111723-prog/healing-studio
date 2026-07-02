import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { serverEnv } from "../_core/env.validated";
import { isDemoMode } from "../_core/googleAuth";
import { ensureFalApiKeyConfigured } from "../_core/apiGuards";
import * as db from "../db";
import { storagePut } from "../storage";
import { invokeLLM, extractMessageText } from "../_core/llm";
import { withTimeout } from "../services/director/templates";
import { dispatchImageGeneration } from "../services/falDispatcher";

// ─── Fine-Tuned Models ────────────────────────────────────────────────────

export const modelsRouter = router({
  myModels: protectedProcedure.query(async ({ ctx }) => {
    return db.getFineTunedModelsByUser(ctx.user.id);
  }),

  teamModels: protectedProcedure.query(async () => {
    return db.getTeamSharedModels();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model)
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      // Only allow access to own or team-shared models
      if (
        model.userId !== ctx.user.id &&
        model.visibility !== "team_shared"
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
      }
      return model;
    }),

  // ── 模型詳細分析（訓練配置 + 資料集 + 訓練歷史 + 使用統計）──────────
  getAnalysis: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model)
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      if (
        model.userId !== ctx.user.id &&
        model.visibility !== "team_shared"
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
      }

      const trainingJobs = await db.getTrainingJobsByModelId(input.id);

      const config = (model.configJson ?? {}) as Record<string, unknown>;
      const datasetImages = (config.datasetImages ?? []) as Array<{
        url: string;
        fileKey?: string;
        angle: string;
        caption?: string;
      }>;

      return {
        model: {
          id: model.id,
          name: model.name,
          description: model.description,
          modelType: model.modelType,
          status: model.status,
          visibility: model.visibility,
          usageCount: model.usageCount,
          trainedLoraUrl: model.trainedLoraUrl,
          replicatePredictionId: model.replicatePredictionId,
          createdAt: model.createdAt,
          updatedAt: model.updatedAt,
        },
        config: {
          triggerWord: (config.triggerWord as string) || "",
          epochs: (config.epochs as number) ?? 0,
          learningRate: (config.learningRate as number) ?? 0,
          batchSize: (config.batchSize as number) ?? 0,
          steps: (config.steps as number) ?? 0,
          submittedAt: (config.submittedAt as number) ?? null,
          completedAt: (config.completedAt as number) ?? null,
        },
        datasetImages,
        trainingJobs: trainingJobs.map(j => ({
          id: j.id,
          status: j.status,
          progress: j.progress,
          progressMessage: j.progressMessage,
          errorMessage: j.errorMessage,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
        })),
      };
    }),

  // ── 取得訓練任務狀態（輪詢用）────────────────────────────────────────
  trainingStatus: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getBackgroundJob(input.jobId);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "任務不存在" });
      if (job.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
      }
      return {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        progressMessage: job.progressMessage,
        resultJson: job.resultJson as Record<string, unknown> | null,
        errorMessage: job.errorMessage,
        updatedAt: job.updatedAt,
      };
    }),

  // ── 同步 Replicate 狀態（主動拉取 Replicate prediction 最新狀態）────
  syncReplicateStatus: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.modelId);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }
      if (model.status === "ready" || model.status === "failed") {
        return { status: model.status, message: "已是最終狀態" };
      }

      // ── AIDV-45：fal 引擎模型改走 fal queue 輪詢回寫 ──────────────────
      // fal 模型的 replicatePredictionId 存的是 fal request id，拿去問
      // Replicate 只會報錯。checkAndSyncFalTraining 會查 fal 狀態，
      // 終態時直接回寫 fine_tuned_models + 收尾訓練 job。
      const syncConfig = model.configJson as Record<string, unknown> | null;
      const isFalEngine =
        model.trainingEngine === "fal" || !!syncConfig?.falModelId;
      if (isFalEngine) {
        const { checkAndSyncFalTraining } = await import(
          "../services/falTrainer"
        );
        const falSync = await checkAndSyncFalTraining(model);
        if (!falSync) {
          return {
            status: model.status,
            message: "尚無 Fal.ai request ID（或 FAL_API_KEY 未設定）",
          };
        }
        if (falSync.synced && falSync.modelStatus === "ready") {
          return {
            status: "ready",
            loraUrl: falSync.outputUrl ?? null,
            message: "訓練完成！",
          };
        }
        if (falSync.synced && falSync.modelStatus === "failed") {
          return {
            status: "failed",
            message: `Fal.ai 任務 ${falSync.queueStatus}${falSync.error ? `：${falSync.error}` : ""}`,
          };
        }
        return {
          status: "training",
          message: `Fal.ai 狀態：${falSync.queueStatus}`,
        };
      }

      const predictionId =
        model.replicatePredictionId ||
        ((model.configJson as Record<string, unknown> | null)
          ?.predictionId as string | undefined);

      if (!predictionId) {
        return {
          status: model.status,
          message: "尚無 Replicate prediction ID",
        };
      }

      if (!process.env.REPLICATE_API_TOKEN) {
        return {
          status: model.status,
          message: "REPLICATE_API_TOKEN 未設定",
        };
      }

      try {
        const { getReplicateClient } =
          await import("../services/replicateClient.js");
        const replicate = getReplicateClient();
        const prediction = (await replicate.predictions.get(
          predictionId
        )) as {
          status: string;
          output?: unknown;
          error?: unknown;
        };

        if (prediction.status === "succeeded") {
          const outputUrl =
            typeof prediction.output === "string"
              ? prediction.output
              : Array.isArray(prediction.output)
                ? (prediction.output as string[])[0]
                : null;

          await db.updateFineTunedModel(input.modelId, {
            status: "ready",
            trainedLoraUrl: outputUrl || undefined,
            fileUrl: outputUrl || model.fileUrl || undefined,
          });
          return {
            status: "ready",
            loraUrl: outputUrl,
            message: "訓練完成！",
          };
        } else if (
          prediction.status === "failed" ||
          prediction.status === "canceled"
        ) {
          await db.updateFineTunedModel(input.modelId, { status: "failed" });
          return {
            status: "failed",
            message: `Replicate 任務 ${prediction.status}`,
          };
        }
        return {
          status: "training",
          message: `Replicate 狀態：${prediction.status}`,
        };
      } catch (e: any) {
        return { status: model.status, message: `同步失敗：${e.message}` };
      }
    }),

  // ── 重新訓練（重新提交已失敗的模型）──────────────────────────────────
  retrain: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.modelId);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }
      if (model.status === "training") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "模型正在訓練中",
        });
      }
      if (!process.env.REPLICATE_API_TOKEN) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "REPLICATE_API_TOKEN 未設定，無法訓練",
        });
      }

      const config = model.configJson as Record<string, unknown> | null;
      const imageUrls =
        (config?.datasetImages as Array<{ url: string }> | undefined)?.map(
          i => i.url
        ) ?? [];
      if (imageUrls.length < 3) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "訓練圖片不足（至少 3 張）",
        });
      }

      // Reset status
      await db.updateFineTunedModel(input.modelId, {
        status: "pending",
        trainedLoraUrl: undefined,
      });

      const jobId = await db.createBackgroundJob({
        userId: ctx.user.id,
        jobType: "model_training",
        status: "queued",
        progress: 0,
        progressMessage: "重新訓練任務已加入佇列",
        resultJson: { modelId: input.modelId, modelName: model.name },
      });

      import("../services/loraTrainer").then(({ runLoraTrainingJob }) => {
        runLoraTrainingJob({
          userId: ctx.user.id,
          modelId: input.modelId,
          jobId,
          modelName: model.name,
          triggerWord: (config?.triggerWord as string) || "",
          epochs: (config?.epochs as number) ?? 20,
          learningRate: (config?.learningRate as number) ?? 0.0001,
          imageUrls,
        }).catch(err => {
          console.error(
            `[LoraTrainer] Retrain job failed for model ${input.modelId}:`,
            err
          );
        });
      });

      return { jobId, message: "重新訓練已啟動" };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        modelType: z
          .enum([
            "image_subject",
            "voice_clone",
            "style_lora",
            "scene_lora",
            "video_lora",
            "portrait_lora",
          ])
          .default("image_subject"),
        trainingEngine: z.enum(["replicate", "fal"]).default("replicate"),
        triggerWord: z.string().max(50).optional(),
        epochs: z.number().min(5).max(100).optional(),
        learningRate: z.number().min(0.00001).max(0.01).optional(),
        batchSize: z.number().min(1).max(8).optional(),
        steps: z.number().min(100).max(5000).optional(),
        isStyle: z.boolean().optional(),
        falModelId: z.string().optional(),
        fileUrl: z.string().optional(),
        fileKey: z.string().optional(),
        datasetImages: z
          .array(
            z.object({
              url: z.string(),
              fileKey: z.string(),
              angle: z.enum(["front", "side", "back", "expression", "other"]),
              caption: z.string().optional(),
            })
          )
          .max(50)
          .optional(),
        datasetVideos: z
          .array(
            z.object({
              url: z.string(),
              fileKey: z.string(),
              caption: z.string().optional(),
            })
          )
          .max(20)
          .optional(),
        /**
         * 訓練資料的主體類型。只要不是 `synthetic`，後端就會強制要求至少
         * 一筆有效（未撤回 / 未過期）的 modelTrainingConsents 紀錄。
         * - synthetic：純 AI 生成 / 無辨識性內容
         * - self：本人
         * - real_person：真實他人
         * - copyrighted：第三方版權素材
         */
        subjectType: z
          .enum(["synthetic", "self", "real_person", "copyrighted"])
          .default("synthetic"),
        /** 引用的同意書 ID（必須屬於本人、且為有效狀態） */
        consentIds: z.array(z.number()).max(20).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ── 同意書門檻：人像 / 第三方版權素材必須提供有效 consent ──────
      const requiresConsent =
        input.subjectType === "self" ||
        input.subjectType === "real_person" ||
        input.subjectType === "copyrighted" ||
        input.modelType === "portrait_lora";

      if (requiresConsent) {
        const ids = input.consentIds ?? [];
        if (ids.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "訓練真實人物或受版權保護的素材，必須先簽署數位肖像權 / 照片使用同意書",
          });
        }
        // AIDV-796: batch fetch — 1 DB roundtrip instead of N
        const fetched = await db.getModelTrainingConsentsByIds(ids);
        const consentMap = new Map(fetched.map(c => [c.id, c]));
        for (const cid of ids) {
          const c = consentMap.get(cid);
          if (!c || c.userId !== ctx.user.id) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `同意書 #${cid} 不存在或不屬於目前帳號`,
            });
          }
          if (
            !db.isConsentActive({
              revokedAt: c.revokedAt,
              validFrom: c.validFrom,
              validUntil: c.validUntil,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `同意書 #${cid}（${c.subjectName}）已撤回或過期，無法用於訓練`,
            });
          }
          if (
            input.modelType === "portrait_lora" &&
            c.consentType === "photo_usage"
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `同意書 #${cid} 僅授權「照片使用」，未涵蓋肖像權，不可用於 portrait_lora`,
            });
          }
        }
      }

      const STEPS_PER_EPOCH = 30;
      const MIN_TRAINING_STEPS = 200;
      const MAX_TRAINING_STEPS = 2000;
      const effectiveSteps =
        input.steps ??
        Math.min(
          Math.max(
            (input.epochs ?? 20) * STEPS_PER_EPOCH,
            MIN_TRAINING_STEPS
          ),
          MAX_TRAINING_STEPS
        );
      const configJson: Record<string, unknown> = {
        triggerWord: input.triggerWord || "",
        epochs: input.epochs ?? 20,
        learningRate: input.learningRate ?? 0.0001,
        batchSize: input.batchSize ?? 4,
        steps: effectiveSteps,
        isStyle: input.isStyle,
        datasetImages: input.datasetImages ?? [],
        datasetVideos: input.datasetVideos ?? [],
      };
      if (input.falModelId) configJson.falModelId = input.falModelId;

      // Create the model record
      // AIDV-45 欄位對映：trainingEngine 過去漏寫 → fal 引擎訓練的模型在
      // fine_tuned_models 一律掛預設 "replicate"，訓練歷史顯示與輪詢回寫
      // 的引擎判定都會判錯。
      const modelId = await db.createFineTunedModel({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        modelType: input.modelType,
        trainingEngine: input.trainingEngine,
        fileUrl: input.datasetImages?.[0]?.url || input.fileUrl,
        fileKey: input.datasetImages?.[0]?.fileKey || input.fileKey,
        configJson,
      });

      // Link consents (if any) to the model for audit trail
      if (input.consentIds && input.consentIds.length > 0) {
        await db.linkConsentsToModel(modelId, input.consentIds);
      }

      // Create a background job for training
      const jobId = await db.createBackgroundJob({
        userId: ctx.user.id,
        jobType: "model_training",
        status: "queued",
        progress: 0,
        progressMessage: "訓練任務已加入佇列",
        resultJson: {
          modelId,
          modelName: input.name,
          engine: input.trainingEngine,
        },
      });

      const imageUrls = (input.datasetImages ?? []).map(img => img.url);
      const videoUrls = (input.datasetVideos ?? []).map(v => v.url);
      const totalDataCount = imageUrls.length + videoUrls.length;

      // Dispatch to the correct training engine
      if (input.trainingEngine === "fal") {
        // ── Fal.ai training path ──
        if (!process.env.FAL_API_KEY) {
          console.warn(
            `[FalTrainer] FAL_API_KEY not set — model ${modelId} will remain queued`
          );
        } else if (totalDataCount >= 1) {
          import("../services/falTrainer").then(
            ({ runFalTrainingJob, resolveFalTrainingModel }) => {
              const resolvedFalModel =
                input.falModelId || resolveFalTrainingModel(input.modelType);
              runFalTrainingJob({
                userId: ctx.user.id,
                modelId,
                jobId,
                modelName: input.name,
                modelType: input.modelType,
                triggerWord: input.triggerWord || "",
                steps: effectiveSteps,
                learningRate: input.learningRate ?? 0.0001,
                isStyle: input.isStyle,
                imageUrls,
                videoUrls,
                falModelId: resolvedFalModel,
              }).catch(err => {
                console.error(
                  `[FalTrainer] Background job failed for model ${modelId}:`,
                  err
                );
              });
            }
          );
        }
      } else {
        // ── Replicate training path (existing) ──
        if (!process.env.REPLICATE_API_TOKEN) {
          console.warn(
            `[LoraTrainer] REPLICATE_API_TOKEN not set — model ${modelId} will remain queued`
          );
        } else if (imageUrls.length >= 3) {
          import("../services/loraTrainer").then(({ runLoraTrainingJob }) => {
            runLoraTrainingJob({
              userId: ctx.user.id,
              modelId,
              jobId,
              modelName: input.name,
              triggerWord: input.triggerWord || "",
              epochs: input.epochs ?? 20,
              learningRate: input.learningRate ?? 0.0001,
              imageUrls,
            }).catch(err => {
              console.error(
                `[LoraTrainer] Background job failed for model ${modelId}:`,
                err
              );
            });
          });
        }
      }

      return { id: modelId, jobId };
    }),

  captionImages: protectedProcedure
    .input(
      z.object({
        images: z
          .array(
            z.object({
              url: z.string(),
              angle: z.enum(["front", "side", "back", "expression", "other"]),
            })
          )
          .max(30),
      })
    )
    .mutation(async ({ input }) => {
      const captions: string[] = [];
      for (const img of input.images) {
        try {
          const result = await withTimeout(
            invokeLLM({
              runName: "lora-image-captioner",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a professional image captioner for LoRA training datasets. Generate a concise English description (20-40 words) that captures the subject's appearance, pose, expression, and clothing. Be specific and descriptive. Only output the caption text, nothing else.",
                },
                {
                  role: "user",
                  content: [
                    {
                      type: "text" as const,
                      text: `Angle: ${img.angle}. Generate a training caption for this image.`,
                    },
                    {
                      type: "image_url" as const,
                      image_url: { url: img.url },
                    },
                  ],
                },
              ],
            }),
            20_000,
            "圖片標註"
          );
          const text = extractMessageText(
            result.choices[0]?.message?.content
          ).trim();
          captions.push(text || `${img.angle} view of the subject`);
        } catch {
          captions.push(`${img.angle} view of the subject`);
        }
      }
      return { captions };
    }),

  /**
   * autofillAngles — 以一張參考圖為基底，由 AI 補齊缺少的多角度資料集圖片
   *
   * 用途：降低 LoRA 訓練的入門門檻。使用者只要上傳一張角色照，AI 會自動
   * 生成「正面 / 側面 / 背面 / 表情 / 其他」缺少的角度，使用者可隨時替換
   * 或刪除任何一張 AI 生成的圖。
   *
   * 引擎：fal-ai/nano-banana/edit（Gemini 2.0 Flash 圖片語意編輯，主體保留佳）
   */
  autofillAngles: protectedProcedure
    .input(
      z.object({
        referenceImageUrl: z.string().url(),
        targets: z
          .array(
            z.object({
              angle: z.enum([
                "front",
                "side",
                "back",
                "expression",
                "other",
              ]),
              hint: z.string().max(200).optional(),
            })
          )
          .min(1)
          .max(5),
        subjectHint: z.string().max(200).optional(),
        strength: z.number().min(0.2).max(0.8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      ensureFalApiKeyConfigured();

      const ANGLE_PROMPTS: Record<
        "front" | "side" | "back" | "expression" | "other",
        string
      > = {
        front:
          "Rotate the subject to face the camera directly in a front view. IMPORTANT: Preserve exactly the same person/character, clothing, hairstyle, facial features, skin tone, and art style from the reference image. Only change the viewing angle to front-facing. Same lighting and background style.",
        side: "Rotate the subject 90 degrees to show a side profile view. IMPORTANT: Preserve exactly the same person/character, clothing, hairstyle, facial features, skin tone, and art style from the reference image. Only change the viewing angle to side profile. Same lighting and background style.",
        back: "Rotate the subject 180 degrees to show the back view. IMPORTANT: Preserve exactly the same person/character, clothing, hairstyle, body shape, and art style from the reference image. Only change the viewing angle to back. Same lighting and background style.",
        expression:
          "Show the same person with a different facial expression (warm smile or surprised look). IMPORTANT: Keep the exact same face, hairstyle, clothing, skin tone, and art style. Only change the facial expression. Same viewing angle, lighting and background.",
        other:
          "Rotate the subject to a three-quarter view at 45 degrees. IMPORTANT: Preserve exactly the same person/character, clothing, hairstyle, facial features, skin tone, and art style from the reference image. Only change the viewing angle to 45 degrees. Same lighting and background style.",
      };

      const subjectSuffix = input.subjectHint
        ? ` Subject context: ${input.subjectHint}.`
        : "";

      // 強度控制：數值越低，越能保留參考圖的特徵；越高，創意變化越大
      // 0.45 = 預設平衡值，在保留特徵與角度轉換間取得良好平衡
      const imageStrength = input.strength ?? 0.45;

      const generated: Array<{
        angle: "front" | "side" | "back" | "expression" | "other";
        url: string;
        fileKey: string;
        prompt: string;
      }> = [];
      const failures: Array<{ angle: string; error: string }> = [];

      for (const target of input.targets) {
        const basePrompt = ANGLE_PROMPTS[target.angle];
        const prompt =
          (target.hint ? `${target.hint}. ` : "") +
          basePrompt +
          subjectSuffix;

        try {
          const dispatch = await withTimeout(
            dispatchImageGeneration({
              modelId: "fal-ai/nano-banana/edit",
              prompt,
              imageUrl: input.referenceImageUrl,
              aspectRatio: "1:1",
              strength: imageStrength,
            }),
            120_000,
            `AI 補齊（${target.angle}）`
          );

          if (!dispatch.success) {
            failures.push({
              angle: target.angle,
              error: dispatch.error || "未知錯誤",
            });
            continue;
          }

          const data = dispatch.data as Record<string, unknown>;
          const remoteUrl =
            ((data.images as Array<{ url?: string }> | undefined)?.[0]
              ?.url as string | undefined) ??
            ((data.image as { url?: string } | undefined)?.url as
              | string
              | undefined) ??
            (data.url as string | undefined);

          if (!remoteUrl) {
            failures.push({
              angle: target.angle,
              error: "AI 未回傳圖片 URL",
            });
            continue;
          }

          // 持久化到本站儲存（fal CDN 連結有時效性，訓練時可能失效）
          const resp = await fetch(remoteUrl, {
            signal: AbortSignal.timeout(60_000),
          });
          if (!resp.ok) {
            failures.push({
              angle: target.angle,
              error: `下載 AI 圖片失敗（${resp.status}）`,
            });
            continue;
          }
          const buffer = Buffer.from(await resp.arrayBuffer());
          const contentType =
            resp.headers.get("content-type") || "image/png";
          const ext =
            contentType.includes("jpeg") || contentType.includes("jpg")
              ? "jpg"
              : contentType.includes("webp")
                ? "webp"
                : "png";
          const key = `lora-dataset/${ctx.user.id}/autofill/${target.angle}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}.${ext}`;
          const stored = await storagePut(key, buffer, contentType);

          generated.push({
            angle: target.angle,
            url: stored.url,
            fileKey: stored.key,
            prompt,
          });
        } catch (err: unknown) {
          failures.push({
            angle: target.angle,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (generated.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `AI 補齊失敗：${failures.map(f => `${f.angle} (${f.error})`).join("；")}`,
        });
      }

      return { generated, failures };
    }),

  toggleVisibility: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        visibility: z.enum(["private", "team_shared"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }
      await db.updateFineTunedModel(input.id, {
        visibility: input.visibility,
      });
      // Reward 3 quota for sharing a ready model (only on first share — prevent toggle exploit)
      // Skip in demo mode: demo users don't have real quota
      // Track reward via configJson.shareRewarded to prevent double-granting
      if (
        !isDemoMode() &&
        input.visibility === "team_shared" &&
        model.visibility !== "team_shared"
      ) {
        const cfg = (model.configJson ?? {}) as Record<string, unknown>;
        const alreadyRewarded = cfg.shareRewarded === true;
        if (model.status === "ready" && !alreadyRewarded) {
          await db.refundUserQuota(ctx.user.id, 3);
          await db.updateFineTunedModel(input.id, {
            configJson: {
              ...cfg,
              shareRewarded: true,
            } as typeof model.configJson,
          });
          console.log(
            `[Reward] User ${ctx.user.id} earned 3 pts for sharing model ${input.id}`
          );
        }
      }
      return { success: true };
    }),

  // ── 更新模型資訊（名稱、描述、觸發詞）──────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        triggerWord: z.string().max(50).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }
      const updates: Record<string, unknown> = {};
      if (input.name) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description;
      if (input.triggerWord !== undefined) {
        // Update triggerWord in configJson
        const config = (model.configJson as Record<string, unknown>) || {};
        updates.configJson = { ...config, triggerWord: input.triggerWord };
      }
      await db.updateFineTunedModel(
        input.id,
        updates as Partial<typeof model>
      );
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
      }
      await db.deleteFineTunedModel(input.id);
      return { success: true };
    }),

  // ── 增加使用計數（生成時呼叫）────────────────────────────────────────
  incrementUsage: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const model = await db.getFineTunedModel(input.id);
      if (!model || model.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await db.incrementModelUsage(input.id);
      return { success: true };
    }),
});
