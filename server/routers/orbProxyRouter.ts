/**
 * orbProxyRouter.ts — 全站光球代理新增能力的 tRPC 端點。
 *
 * 目前只暴露 `unifiedSearch`：把使用者一句話「找我之前做的森林圖／我的筆記
 * 提到 X／教學文件 Y」變成跨資產／筆記／生成歷史／學習中心的單一查詢，
 * 回傳一份可直接渲染為跳轉卡片的清單。
 *
 * 端點故意保留為 protectedProcedure，因為跨表搜尋會曝露使用者私人資產。
 * 學習中心是公開內容，但與私資料同行為一致路徑（要求登入）較清楚。
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { orbUnifiedSearch } from "../services/orbUnifiedSearch";
import {
  recordOrbMemory,
  getRecentOrbMemories,
  clearOrbMemoryByType,
  removeMetadataValue,
} from "../services/orbMemory";
import { aggregatePreferenceProfile } from "../../shared/orb-memory";
import {
  buildClarificationPickMemory,
  CLARIFICATION_DIMENSION_SCHEMA,
} from "../../shared/orb-clarification-memory";
import {
  analyzeIntentForOrchestrator,
  getTeamStatusSummary,
} from "../services/spiritTools/orchestratorTools";
import { getEnhancedSpiritPrompt } from "../services/spiritPromptEnhancer";
import type { AgentRole } from "../../shared/orb-agent-roles";

const SEARCH_KIND_SCHEMA = z.enum(["asset", "note", "history", "tutorial"]);
const PREFERENCE_KEY_SCHEMA = z.enum(["styles", "platforms", "outputs", "models"]);

export const orbProxyRouter = router({
  /**
   * Surface what the orb currently remembers about the user — the
   * memory-dashboard card consumes this to render the "光球記得你" panel
   * with per-chip remove buttons.
   */
  getRememberedPreferences: protectedProcedure.query(async ({ ctx }) => {
    const memories = getRecentOrbMemories({
      userId: ctx.user.id,
      limit: 100,
      types: ["user_preference", "style_preference", "model_preference"],
    });
    const profile = aggregatePreferenceProfile(memories);
    return {
      profile,
      hasMemory: profile.evidenceCount > 0,
    };
  }),

  /**
   * Remove a single chip (e.g. "電影感" out of styles, "IG Reel" out of
   * platforms). Walks every preference memory and surgically removes the
   * value from metadata + tags — keeps the memory rows around so the
   * remaining values still aggregate.
   */
  removePreferenceValue: protectedProcedure
    .input(
      z.object({
        key: PREFERENCE_KEY_SCHEMA,
        value: z.string().min(1).max(120),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const removed = removeMetadataValue({ userId: ctx.user.id }, input.key, input.value);
      return { ok: true, removed };
    }),

  /**
   * Wipe ALL preference-type memories for the user. Used by the dashboard's
   * "全部清掉" button — drops style / model / user preference rows so the
   * orb starts asking from scratch again.
   */
  clearAllPreferenceMemory: protectedProcedure.mutation(async ({ ctx }) => {
    const removed = clearOrbMemoryByType({ userId: ctx.user.id }, [
      "user_preference",
      "style_preference",
      "model_preference",
    ]);
    return { ok: true, removed };
  }),

  /**
   * Persist a batch of multi-dimension wizard picks as a `user_preference`
   * memory so future turns can skip re-asking the same dimensions. Uses the
   * existing `aggregatePreferenceProfile` aggregation path — we only have to
   * feed it metadata + tags in the shape it already understands.
   */
  persistClarificationPicks: protectedProcedure
    .input(
      z.object({
        picks: z.array(
          z.object({
            dimension: CLARIFICATION_DIMENSION_SCHEMA,
            value: z.string().min(1).max(160),
          })
        ).min(1).max(8),
        traceId: z.string().min(1).max(120).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const draft = buildClarificationPickMemory(input.picks);
      if (!draft) {
        return { ok: false, reason: "no-durable-picks", recorded: 0 };
      }
      const memory = recordOrbMemory({
        userId: ctx.user.id,
        traceId: input.traceId ?? `clarify_${Date.now()}`,
        type: "user_preference",
        summary: draft.summary,
        source: "orb-multi-dim-clarification",
        confidence: 0.85,
        tags: draft.tags,
        metadata: draft.metadata,
      });
      if (!memory) {
        return { ok: false, reason: "memory-disabled-or-redacted", recorded: 0 };
      }
      return {
        ok: true,
        memoryId: memory.memoryId,
        recorded: Object.keys(draft.metadata).length,
        captured: draft.metadata,
      };
    }),

  unifiedSearch: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        types: z.array(SEARCH_KIND_SCHEMA).max(4).optional(),
        perTypeLimit: z.number().int().min(1).max(10).optional(),
        totalLimit: z.number().int().min(1).max(20).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await orbUnifiedSearch({
        userId: ctx.user.id,
        query: input.query,
        types: input.types,
        perTypeLimit: input.perTypeLimit,
        totalLimit: input.totalLimit,
      });
      return {
        query: input.query,
        items,
        countByKind: items.reduce<Record<string, number>>((acc, it) => {
          acc[it.kind] = (acc[it.kind] ?? 0) + 1;
          return acc;
        }, {}),
      };
    }),

  /**
   * Analyze user intent for chief-orchestrator.
   * Returns whether clarification is needed and suggested questions.
   */
  analyzeOrchestratorIntent: protectedProcedure
    .input(
      z.object({
        userMessage: z.string().min(1).max(1000),
        sessionId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const analysis = await analyzeIntentForOrchestrator({
        userId: ctx.user.id,
        userMessage: input.userMessage,
        sessionId: input.sessionId,
      });

      return analysis;
    }),

  /**
   * Get enhanced system prompt for a spirit including learned memories.
   * Used by chat router to personalize spirit responses.
   */
  getEnhancedSpiritPrompt: protectedProcedure
    .input(
      z.object({
        role: z.string() as z.ZodType<AgentRole>,
        sessionId: z.string().optional(),
        currentPage: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const enhancedPrompt = await getEnhancedSpiritPrompt(input.role, {
        userId: ctx.user.id,
        sessionId: input.sessionId,
        currentPage: input.currentPage,
      });

      return {
        role: input.role,
        prompt: enhancedPrompt,
      };
    }),

  /**
   * Get team status summary for chief-orchestrator.
   * Shows current state of all active spirits and collaborations.
   */
  getTeamStatus: protectedProcedure.query(async ({ ctx }) => {
    const status = await getTeamStatusSummary(ctx.user.id);
    return status;
  }),
});

export type OrbProxyRouter = typeof orbProxyRouter;
