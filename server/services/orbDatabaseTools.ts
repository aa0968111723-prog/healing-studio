/**
 * server/services/orbDatabaseTools.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Safe database query tools for the Orb Agent.
 *
 * Security-first design:
 * - All queries are user-scoped (userId filtering)
 * - Predefined query templates only (no arbitrary SQL)
 * - Read-only operations (SELECT only)
 * - Rate limiting via orbQuota integration
 * - Full audit trail via orbTaskTracer
 *
 * Architecture:
 * - Uses existing Drizzle ORM for type safety
 * - Integrates with repository layer when available
 * - Exports structured data for LLM consumption
 */

import { eq, desc, and, like, sql, gt } from "drizzle-orm";
import { getDb } from "../db";
import {
  digitalAssetLibrary,
  projectNotesCalendar,
  generationHistory,
  backgroundJobs,
  fineTunedModels,
  orbScheduledJobs,
  userAiBrain,
  promptLibrary,
} from "../../drizzle/schema";

// ─── Query Result Types ───────────────────────────────────────────────────

export interface DbQueryResult {
  success: boolean;
  data?: unknown[];
  error?: string;
  rowCount?: number;
  queryName: string;
  executionTimeMs?: number;
}

// ─── Available Query Templates ─────────────────────────────────────────────

/**
 * Registry of safe, predefined database queries.
 * Each query is user-scoped and returns structured data.
 */
export const DB_QUERY_TEMPLATES = {
  // ── Digital Assets ──────────────────────────────────────────────────────
  "list_my_assets": {
    description: "列出我的數位資產（圖片、影片、音訊等）",
    params: ["userId", "assetType?", "limit?"] as const,
    example: { userId: 1, assetType: "image", limit: 20 },
  },
  "search_my_assets": {
    description: "搜尋我的資產庫",
    params: ["userId", "searchQuery", "limit?"] as const,
    example: { userId: 1, searchQuery: "landscape", limit: 10 },
  },
  "get_recent_assets": {
    description: "取得最近建立的資產",
    params: ["userId", "days?", "limit?"] as const,
    example: { userId: 1, days: 7, limit: 10 },
  },

  // ── Project Notes ───────────────────────────────────────────────────────
  "list_my_notes": {
    description: "列出我的專案筆記",
    params: ["userId", "noteType?", "limit?"] as const,
    example: { userId: 1, noteType: "note", limit: 20 },
  },
  "search_my_notes": {
    description: "搜尋我的筆記內容",
    params: ["userId", "searchQuery", "limit?"] as const,
    example: { userId: 1, searchQuery: "meeting", limit: 10 },
  },
  "get_calendar_events": {
    description: "取得行事曆事件",
    params: ["userId", "fromDate?", "limit?"] as const,
    example: { userId: 1, fromDate: "2026-05-01", limit: 20 },
  },

  // ── Generation History ──────────────────────────────────────────────────
  "get_generation_history": {
    description: "取得我的生成歷史記錄",
    params: ["userId", "modality?", "limit?"] as const,
    example: { userId: 1, modality: "image", limit: 20 },
  },
  "get_recent_generations": {
    description: "取得最近的生成記錄",
    params: ["userId", "days?", "limit?"] as const,
    example: { userId: 1, days: 7, limit: 10 },
  },

  // ── Background Jobs ─────────────────────────────────────────────────────
  "list_my_jobs": {
    description: "列出我的背景任務",
    params: ["userId", "status?", "limit?"] as const,
    example: { userId: 1, status: "processing", limit: 20 },
  },
  "get_active_jobs": {
    description: "取得進行中的任務",
    params: ["userId"] as const,
    example: { userId: 1 },
  },

  // ── AI Models ───────────────────────────────────────────────────────────
  "list_my_models": {
    description: "列出我訓練的模型",
    params: ["userId", "limit?"] as const,
    example: { userId: 1, limit: 20 },
  },
  "get_my_brain_config": {
    description: "取得我的 AI 大腦組態",
    params: ["userId"] as const,
    example: { userId: 1 },
  },

  // ── Scheduled Jobs ──────────────────────────────────────────────────────
  "list_my_scheduled_jobs": {
    description: "列出我的排程任務",
    params: ["userId", "enabled?", "limit?"] as const,
    example: { userId: 1, enabled: true, limit: 20 },
  },

  // ── Prompt Library ──────────────────────────────────────────────────────
  "search_prompts": {
    description: "搜尋提示詞庫",
    params: ["userId?", "searchQuery", "category?", "limit?"] as const,
    example: { searchQuery: "portrait", category: "image", limit: 10 },
  },
} as const;

export type QueryTemplateName = keyof typeof DB_QUERY_TEMPLATES;

// ─── Query Executor Functions ──────────────────────────────────────────────

/**
 * Execute a predefined database query with user scoping.
 */
export async function executeDbQuery(
  queryName: QueryTemplateName,
  params: Record<string, unknown>
): Promise<DbQueryResult> {
  const startTime = Date.now();

  try {
    const template = DB_QUERY_TEMPLATES[queryName];
    if (!template) {
      return {
        success: false,
        error: `Unknown query template: ${queryName}`,
        queryName,
      };
    }

    const db = getDb();
    let data: unknown[] = [];

    // Execute the appropriate query based on template name
    switch (queryName) {
      // ── Digital Assets ────────────────────────────────────────────────
      case "list_my_assets": {
        const userId = params.userId as number;
        const assetType = params.assetType as string | undefined;
        const limit = (params.limit as number) ?? 50;

        const conditions = [eq(digitalAssetLibrary.userId, userId)];
        if (assetType && assetType !== "all") {
          conditions.push(eq(digitalAssetLibrary.assetType, assetType as any));
        }

        data = await db
          .select({
            id: digitalAssetLibrary.id,
            title: digitalAssetLibrary.title,
            description: digitalAssetLibrary.description,
            assetType: digitalAssetLibrary.assetType,
            url: digitalAssetLibrary.url,
            thumbnailUrl: digitalAssetLibrary.thumbnailUrl,
            createdAt: digitalAssetLibrary.createdAt,
          })
          .from(digitalAssetLibrary)
          .where(and(...conditions))
          .orderBy(desc(digitalAssetLibrary.createdAt))
          .limit(Math.min(limit, 100));
        break;
      }

      case "search_my_assets": {
        const userId = params.userId as number;
        const searchQuery = params.searchQuery as string;
        const limit = (params.limit as number) ?? 20;

        data = await db
          .select({
            id: digitalAssetLibrary.id,
            title: digitalAssetLibrary.title,
            description: digitalAssetLibrary.description,
            assetType: digitalAssetLibrary.assetType,
            url: digitalAssetLibrary.url,
            createdAt: digitalAssetLibrary.createdAt,
          })
          .from(digitalAssetLibrary)
          .where(
            and(
              eq(digitalAssetLibrary.userId, userId),
              like(digitalAssetLibrary.title, `%${searchQuery}%`)
            )
          )
          .orderBy(desc(digitalAssetLibrary.createdAt))
          .limit(Math.min(limit, 50));
        break;
      }

      case "get_recent_assets": {
        const userId = params.userId as number;
        const days = (params.days as number) ?? 7;
        const limit = (params.limit as number) ?? 20;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        data = await db
          .select({
            id: digitalAssetLibrary.id,
            title: digitalAssetLibrary.title,
            assetType: digitalAssetLibrary.assetType,
            url: digitalAssetLibrary.url,
            createdAt: digitalAssetLibrary.createdAt,
          })
          .from(digitalAssetLibrary)
          .where(
            and(
              eq(digitalAssetLibrary.userId, userId),
              gt(digitalAssetLibrary.createdAt, cutoffDate)
            )
          )
          .orderBy(desc(digitalAssetLibrary.createdAt))
          .limit(Math.min(limit, 50));
        break;
      }

      // ── Project Notes ─────────────────────────────────────────────────
      case "list_my_notes": {
        const userId = params.userId as number;
        const noteType = params.noteType as string | undefined;
        const limit = (params.limit as number) ?? 50;

        const conditions = [eq(projectNotesCalendar.userId, userId)];
        if (noteType) {
          conditions.push(eq(projectNotesCalendar.noteType, noteType as any));
        }

        data = await db
          .select({
            id: projectNotesCalendar.id,
            title: projectNotesCalendar.title,
            content: projectNotesCalendar.content,
            noteType: projectNotesCalendar.noteType,
            scheduledDate: projectNotesCalendar.scheduledDate,
            tags: projectNotesCalendar.tags,
            createdAt: projectNotesCalendar.createdAt,
          })
          .from(projectNotesCalendar)
          .where(and(...conditions))
          .orderBy(desc(projectNotesCalendar.createdAt))
          .limit(Math.min(limit, 100));
        break;
      }

      case "search_my_notes": {
        const userId = params.userId as number;
        const searchQuery = params.searchQuery as string;
        const limit = (params.limit as number) ?? 20;

        data = await db
          .select({
            id: projectNotesCalendar.id,
            title: projectNotesCalendar.title,
            content: projectNotesCalendar.content,
            noteType: projectNotesCalendar.noteType,
            createdAt: projectNotesCalendar.createdAt,
          })
          .from(projectNotesCalendar)
          .where(
            and(
              eq(projectNotesCalendar.userId, userId),
              like(projectNotesCalendar.title, `%${searchQuery}%`)
            )
          )
          .orderBy(desc(projectNotesCalendar.createdAt))
          .limit(Math.min(limit, 50));
        break;
      }

      case "get_calendar_events": {
        const userId = params.userId as number;
        const fromDate = params.fromDate
          ? new Date(params.fromDate as string)
          : new Date();
        const limit = (params.limit as number) ?? 50;

        data = await db
          .select({
            id: projectNotesCalendar.id,
            title: projectNotesCalendar.title,
            content: projectNotesCalendar.content,
            scheduledDate: projectNotesCalendar.scheduledDate,
            tags: projectNotesCalendar.tags,
          })
          .from(projectNotesCalendar)
          .where(
            and(
              eq(projectNotesCalendar.userId, userId),
              eq(projectNotesCalendar.noteType, "calendar_event"),
              gt(projectNotesCalendar.scheduledDate, fromDate)
            )
          )
          .orderBy(projectNotesCalendar.scheduledDate)
          .limit(Math.min(limit, 100));
        break;
      }

      // ── Generation History ────────────────────────────────────────────
      case "get_generation_history": {
        const userId = params.userId as number;
        const modality = params.modality as string | undefined;
        const limit = (params.limit as number) ?? 50;

        const conditions = [eq(generationHistory.userId, userId)];
        if (modality) {
          conditions.push(eq(generationHistory.modality, modality as any));
        }

        data = await db
          .select({
            id: generationHistory.id,
            modality: generationHistory.modality,
            prompt: generationHistory.prompt,
            modelId: generationHistory.modelId,
            resultUrl: generationHistory.resultUrl,
            createdAt: generationHistory.createdAt,
          })
          .from(generationHistory)
          .where(and(...conditions))
          .orderBy(desc(generationHistory.createdAt))
          .limit(Math.min(limit, 100));
        break;
      }

      case "get_recent_generations": {
        const userId = params.userId as number;
        const days = (params.days as number) ?? 7;
        const limit = (params.limit as number) ?? 20;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        data = await db
          .select({
            id: generationHistory.id,
            modality: generationHistory.modality,
            prompt: generationHistory.prompt,
            resultUrl: generationHistory.resultUrl,
            createdAt: generationHistory.createdAt,
          })
          .from(generationHistory)
          .where(
            and(
              eq(generationHistory.userId, userId),
              gt(generationHistory.createdAt, cutoffDate)
            )
          )
          .orderBy(desc(generationHistory.createdAt))
          .limit(Math.min(limit, 50));
        break;
      }

      // ── Background Jobs ───────────────────────────────────────────────
      case "list_my_jobs": {
        const userId = params.userId as number;
        const status = params.status as string | undefined;
        const limit = (params.limit as number) ?? 50;

        const conditions = [eq(backgroundJobs.userId, userId)];
        if (status) {
          conditions.push(eq(backgroundJobs.status, status as any));
        }

        data = await db
          .select({
            id: backgroundJobs.id,
            jobType: backgroundJobs.jobType,
            status: backgroundJobs.status,
            progress: backgroundJobs.progress,
            progressMessage: backgroundJobs.progressMessage,
            errorMessage: backgroundJobs.errorMessage,
            createdAt: backgroundJobs.createdAt,
            updatedAt: backgroundJobs.updatedAt,
          })
          .from(backgroundJobs)
          .where(and(...conditions))
          .orderBy(desc(backgroundJobs.updatedAt))
          .limit(Math.min(limit, 100));
        break;
      }

      case "get_active_jobs": {
        const userId = params.userId as number;

        data = await db
          .select({
            id: backgroundJobs.id,
            jobType: backgroundJobs.jobType,
            status: backgroundJobs.status,
            progress: backgroundJobs.progress,
            progressMessage: backgroundJobs.progressMessage,
            createdAt: backgroundJobs.createdAt,
          })
          .from(backgroundJobs)
          .where(
            and(
              eq(backgroundJobs.userId, userId),
              sql`${backgroundJobs.status} IN ('queued', 'processing')`
            )
          )
          .orderBy(desc(backgroundJobs.updatedAt))
          .limit(50);
        break;
      }

      // ── AI Models ─────────────────────────────────────────────────────
      case "list_my_models": {
        const userId = params.userId as number;
        const limit = (params.limit as number) ?? 50;

        data = await db
          .select({
            id: fineTunedModels.id,
            modelName: fineTunedModels.modelName,
            modelType: fineTunedModels.modelType,
            status: fineTunedModels.status,
            replicateModelId: fineTunedModels.replicateModelId,
            createdAt: fineTunedModels.createdAt,
          })
          .from(fineTunedModels)
          .where(eq(fineTunedModels.userId, userId))
          .orderBy(desc(fineTunedModels.createdAt))
          .limit(Math.min(limit, 100));
        break;
      }

      case "get_my_brain_config": {
        const userId = params.userId as number;

        data = await db
          .select({
            imageEngine: userAiBrain.imageEngine,
            videoEngine: userAiBrain.videoEngine,
            audioEngine: userAiBrain.audioEngine,
            voiceEngine: userAiBrain.voiceEngine,
            defaultLLM: userAiBrain.defaultLLM,
            updatedAt: userAiBrain.updatedAt,
          })
          .from(userAiBrain)
          .where(eq(userAiBrain.userId, userId))
          .limit(1);
        break;
      }

      // ── Scheduled Jobs ────────────────────────────────────────────────
      case "list_my_scheduled_jobs": {
        const userId = params.userId as number;
        const enabled = params.enabled as boolean | undefined;
        const limit = (params.limit as number) ?? 50;

        const conditions = [eq(orbScheduledJobs.userId, userId)];
        if (enabled !== undefined) {
          conditions.push(eq(orbScheduledJobs.enabled, enabled));
        }

        data = await db
          .select({
            id: orbScheduledJobs.id,
            name: orbScheduledJobs.name,
            cronExpression: orbScheduledJobs.cronExpression,
            enabled: orbScheduledJobs.enabled,
            lastRunAt: orbScheduledJobs.lastRunAt,
            nextRunAt: orbScheduledJobs.nextRunAt,
            createdAt: orbScheduledJobs.createdAt,
          })
          .from(orbScheduledJobs)
          .where(and(...conditions))
          .orderBy(desc(orbScheduledJobs.createdAt))
          .limit(Math.min(limit, 100));
        break;
      }

      // ── Prompt Library ────────────────────────────────────────────────
      case "search_prompts": {
        const searchQuery = params.searchQuery as string;
        const category = params.category as string | undefined;
        const limit = (params.limit as number) ?? 20;

        const conditions = [
          eq(promptLibrary.isPublic, true),
          like(promptLibrary.title, `%${searchQuery}%`),
        ];
        if (category) {
          conditions.push(eq(promptLibrary.category, category as any));
        }

        data = await db
          .select({
            id: promptLibrary.id,
            title: promptLibrary.title,
            description: promptLibrary.description,
            category: promptLibrary.category,
            promptText: promptLibrary.promptText,
            tags: promptLibrary.tags,
            usageCount: promptLibrary.usageCount,
          })
          .from(promptLibrary)
          .where(and(...conditions))
          .orderBy(desc(promptLibrary.usageCount))
          .limit(Math.min(limit, 50));
        break;
      }

      default:
        return {
          success: false,
          error: `Query ${queryName} not implemented`,
          queryName,
        };
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      success: true,
      data,
      rowCount: data.length,
      queryName,
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[orbDatabaseTools] Query ${queryName} failed:`, errorMessage);

    return {
      success: false,
      error: errorMessage,
      queryName,
      executionTimeMs,
    };
  }
}

/**
 * Get all available query templates with descriptions.
 * Used by the Orb system prompt to describe database capabilities.
 */
export function listAvailableQueries(): Array<{
  name: string;
  description: string;
  params: readonly string[];
  example: Record<string, unknown>;
}> {
  return Object.entries(DB_QUERY_TEMPLATES).map(([name, template]) => ({
    name,
    description: template.description,
    params: template.params,
    example: template.example,
  }));
}

/**
 * Validate query parameters before execution.
 */
export function validateQueryParams(
  queryName: QueryTemplateName,
  params: Record<string, unknown>
): { valid: boolean; error?: string } {
  const template = DB_QUERY_TEMPLATES[queryName];
  if (!template) {
    return { valid: false, error: `Unknown query: ${queryName}` };
  }

  // Check userId is present (required for all queries except search_prompts)
  if (queryName !== "search_prompts" && typeof params.userId !== "number") {
    return { valid: false, error: "userId is required and must be a number" };
  }

  // Validate specific parameter requirements
  const requiredParams = template.params.filter(p => !p.endsWith("?"));
  for (const param of requiredParams) {
    if (!(param in params)) {
      return { valid: false, error: `Missing required parameter: ${param}` };
    }
  }

  return { valid: true };
}
