/**
 * server/services/spiritTools/notesCuratorTools.ts
 *
 * Tools for notes-curator (記記) spirit.
 * Handles notes, assets, scheduling, and organization tasks.
 */

import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { projectNotesCalendar, digitalAssetLibrary, orbScheduledJobs } from "../../../drizzle/schema";
import { and, eq, like, or, desc, sql } from "drizzle-orm";

/**
 * Create a new note
 */
export async function createNote(input: {
  userId: number;
  title: string;
  content: string;
  tags?: string[];
  category?: string;
}): Promise<{
  success: boolean;
  noteId?: number;
  message: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    // The schema's notes table has no `category` column — input.category is
    // accepted but not persisted. Tags are a json() column so we pass the
    // array directly; drizzle handles serialisation.
    const [result] = await db.insert(projectNotesCalendar).values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      tags: input.tags ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    logger.info("note_created", {
      userId: input.userId,
      noteId: result.insertId,
      title: input.title,
    });

    return {
      success: true,
      noteId: Number(result.insertId),
      message: `筆記「${input.title}」已建立`,
    };
  } catch (error) {
    logger.error("create_note_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `建立筆記失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Search notes by title, content, or tags
 */
export async function searchNotes(input: {
  userId: number;
  query: string;
  limit?: number;
}): Promise<{
  success: boolean;
  notes: Array<{
    id: number;
    title: string;
    content: string;
    tags: string[];
    category: string;
    createdAt: string;
    updatedAt: string;
  }>;
  total: number;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const limit = Math.min(input.limit || 10, 50);

    // Use a LIKE on the JSON-encoded tags column via a raw SQL expression
    // because drizzle's `like()` helper expects a string column.
    const results = await db
      .select()
      .from(projectNotesCalendar)
      .where(
        and(
          eq(projectNotesCalendar.userId, input.userId),
          or(
            like(projectNotesCalendar.title, `%${input.query}%`),
            like(projectNotesCalendar.content, `%${input.query}%`),
            sql`CAST(${projectNotesCalendar.tags} AS CHAR) LIKE ${`%${input.query}%`}`
          )
        )
      )
      .orderBy(desc(projectNotesCalendar.updatedAt))
      .limit(limit);

    const notes = results.map(note => ({
      id: note.id,
      title: note.title,
      content: note.content ?? "",
      tags: (note.tags ?? []) as string[],
      // Notes schema has no category column; surface noteType so callers
      // can still group by kind (note / script / calendar_event).
      category: note.noteType ?? "general",
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    }));

    logger.debug("notes_searched", {
      userId: input.userId,
      query: input.query,
      found: notes.length,
    });

    return {
      success: true,
      notes,
      total: notes.length,
    };
  } catch (error) {
    logger.error("search_notes_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      notes: [],
      total: 0,
    };
  }
}

/**
 * Schedule a task for later execution
 */
export async function scheduleTask(input: {
  userId: number;
  taskName: string;
  scheduledFor: string; // ISO datetime string
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  jobId?: number;
  message: string;
}> {
  // The orb_scheduled_jobs table is a CRON-style recurring schedule
  // (cronExpression / taskDescription / enabled / lastRun*), not a
  // one-shot calendar entry. The original implementation here was
  // written against a different schema. Until a one-shot job table
  // exists (or a /scheduled-jobs page can map this into a real cron),
  // surface a clear error rather than attempt a half-working insert.
  logger.warn("schedule_task_not_supported", {
    userId: input.userId,
    taskName: input.taskName,
  });
  return {
    success: false,
    message: "目前只支援 cron 排程，還沒有單次任務排程功能。請改用 /scheduled-jobs 設定週期任務，或在筆記中加入提醒時間。",
  };
}

/**
 * Organize asset library by adding tags.
 *
 * Stubbed: the digital_asset_library schema has no `tags` column, so the
 * original tagging logic was working against a non-existent shape. Until
 * a migration adds tags (or this tool is rewired to a real tag table),
 * surface a clear "not yet supported" message rather than silently
 * failing on every call.
 */
export async function tagAssets(input: {
  userId: number;
  assetIds: number[];
  tags: string[];
  action: "add" | "remove" | "replace";
}): Promise<{
  success: boolean;
  updated: number;
  message: string;
}> {
  logger.warn("tag_assets_not_supported", {
    userId: input.userId,
    assetCount: input.assetIds.length,
    action: input.action,
  });
  return {
    success: false,
    updated: 0,
    message: "素材標籤功能尚未上線（digital_asset_library 表沒有 tags 欄位）。請改用素材描述（description）作為臨時分類。",
  };
}

/**
 * Get asset statistics. The tag-related fields surface as 0 / empty
 * because the underlying schema has no tags column (see tagAssets above).
 * Total count is real.
 */
export async function getAssetStatistics(userId: number): Promise<{
  success: boolean;
  statistics: {
    totalAssets: number;
    untaggedAssets: number;
    topTags: Array<{ tag: string; count: number }>;
    suggestions: string[];
  };
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(digitalAssetLibrary)
      .where(eq(digitalAssetLibrary.userId, userId));

    const totalAssets = totalResult?.count || 0;

    const suggestions: string[] = [];
    if (totalAssets > 100) {
      suggestions.push("素材數量較多，建議建立分類資料夾");
    }
    suggestions.push("標籤功能尚未上線，目前只能顯示素材總數");

    return {
      success: true,
      statistics: {
        totalAssets,
        untaggedAssets: 0,
        topTags: [],
        suggestions,
      },
    };
  } catch (error) {
    logger.error("get_asset_statistics_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      statistics: {
        totalAssets: 0,
        untaggedAssets: 0,
        topTags: [],
        suggestions: ["無法取得素材統計"],
      },
    };
  }
}
