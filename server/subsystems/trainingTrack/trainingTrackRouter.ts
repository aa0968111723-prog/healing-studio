/**
 * trainingTrack / router — M 訓練 track：團隊專屬模型
 * ────────────────────────────────────────────────────────────────────────────
 * teamTraining：previewDataset（query）、startTraining（mutation）、listModels（query）。
 * 全 protected；權限與治理檢查在 service，typed error → TRPCError。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  previewTeamTrainingDataset,
  startTeamModelTraining,
  listTeamModels,
  TrainingTrackError,
} from "./trainingTrackService";

function mapError(error: unknown): never {
  if (error instanceof TrainingTrackError) {
    throw new TRPCError({
      code:
        error.reason === "forbidden"
          ? "FORBIDDEN"
          : error.reason === "not_found"
            ? "NOT_FOUND"
            : "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  throw error;
}

const TRAINABLE_MODEL_TYPES = [
  "image_subject",
  "style_lora",
  "scene_lora",
  "portrait_lora",
] as const;

export const teamTrainingRouter = router({
  /** 預覽某 team/project 可作訓練來源的圖片數（任一成員可看）。 */
  previewDataset: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        return await previewTeamTrainingDataset(ctx.user.id, {
          teamId: input.teamId,
          projectId: input.projectId ?? null,
        });
      } catch (error) {
        mapError(error);
      }
    }),

  /** 用團隊資料發起 LoRA 訓練（需 owner/admin + 授權確認）。 */
  startTraining: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable().optional(),
        modelName: z.string().trim().min(1).max(255),
        triggerWord: z.string().trim().min(1).max(64),
        modelType: z.enum(TRAINABLE_MODEL_TYPES).default("style_lora"),
        steps: z.number().int().min(100).max(10000).optional(),
        learningRate: z.number().positive().optional(),
        baseModel: z.string().optional(),
        consentAcknowledged: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await startTeamModelTraining(ctx.user.id, {
          teamId: input.teamId,
          projectId: input.projectId ?? null,
          modelName: input.modelName,
          triggerWord: input.triggerWord,
          modelType: input.modelType,
          steps: input.steps,
          learningRate: input.learningRate,
          baseModel: input.baseModel,
          consentAcknowledged: input.consentAcknowledged,
        });
      } catch (error) {
        mapError(error);
      }
    }),

  /** 列出某團隊的 team_shared 模型（任一成員可看）。 */
  listModels: protectedProcedure
    .input(z.object({ teamId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await listTeamModels(ctx.user.id, input.teamId);
      } catch (error) {
        mapError(error);
      }
    }),
});
