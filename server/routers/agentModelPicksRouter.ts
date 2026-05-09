/**
 * server/routers/agentModelPicksRouter.ts
 *
 * tRPC surface for the shared `agent_model_picks` table — the bridge that
 * lets 導演 AI, 全站光球, and the various 工作室 pages all read/write the
 * same model-preference signal.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  PICK_SOURCES,
  getPreferredModelsForModality,
  getRecentPicks,
  recordModelPick,
  updateLatestPickAcceptance,
} from "../services/agentModelPicks";

const ModalityInput = z.string().min(1).max(64);
const ModelIdInput = z.string().min(1).max(128);

export const agentModelPicksRouter = router({
  /**
   * Record a (modality, modelId) pick. Called by:
   *   - DirectorAI.handleGenerate / handleGenerateAll when sendToStudio fires
   *   - HistoryPage / SharedSpace's "重新生成" / "發送到工作室" dispatches
   *   - The orb when the user accepts a model the orb suggested
   *
   * Best-effort by design — the mutation never throws even if the DB is
   * down, so a pick failing to persist won't block the user-facing
   * navigation.
   */
  recordPick: protectedProcedure
    .input(
      z.object({
        modality: ModalityInput,
        modelId: ModelIdInput,
        source: z.enum(PICK_SOURCES),
        accepted: z.boolean().optional(),
        context: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await recordModelPick({
        userId: ctx.user.id,
        modality: input.modality,
        modelId: input.modelId,
        source: input.source,
        accepted: input.accepted,
        context: input.context,
      });
      return { ok: id !== null, id };
    }),

  /**
   * Mark the most recent pick `(modality, modelId)` as accepted/rejected
   * after the studio finishes (or rejects) the resulting generation. Drives
   * the `acceptedCount` weight in `getPreferredModelsForModality`.
   */
  markAcceptance: protectedProcedure
    .input(
      z.object({
        modality: ModalityInput,
        modelId: ModelIdInput,
        accepted: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ok = await updateLatestPickAcceptance({
        userId: ctx.user.id,
        modality: input.modality,
        modelId: input.modelId,
        accepted: input.accepted,
      });
      return { ok };
    }),

  /**
   * Top-N preferred models for a modality, computed across the user's
   * full pick history (last 30d window). Used by the client's
   * `usePreferredStudioModel` hook so sendToStudio dispatches everywhere
   * pre-fill `overrideEngine` with the user's actual habit.
   */
  getPreferredForModality: protectedProcedure
    .input(
      z.object({
        modality: ModalityInput,
        topK: z.number().int().min(1).max(10).optional(),
        windowDays: z.number().int().min(1).max(365).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const entries = await getPreferredModelsForModality({
        userId: ctx.user.id,
        modality: input.modality,
        topK: input.topK,
        windowDays: input.windowDays,
      });
      return { entries };
    }),

  /**
   * Recent raw picks — exposed so the settings page's "光球已經記得" inspector
   * can show a unified pick history across director + orb.
   */
  getRecent: protectedProcedure
    .input(
      z.object({ limit: z.number().int().min(1).max(100).optional() }).optional()
    )
    .query(async ({ ctx, input }) => {
      const rows = await getRecentPicks(ctx.user.id, input?.limit ?? 20);
      return {
        picks: rows.map(row => ({
          id: row.id,
          modality: row.modality,
          modelId: row.modelId,
          source: row.source,
          accepted: row.accepted,
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.getTime()
              : new Date(row.createdAt as unknown as string).getTime(),
        })),
      };
    }),
});
