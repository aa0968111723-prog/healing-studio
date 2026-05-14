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
    const [result] = await db.insert(projectNotesCalendar).values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      tags: input.tags ? JSON.stringify(input.tags) : null,
      category: input.category || "general",
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

    const results = await db
      .select()
      .from(projectNotesCalendar)
      .where(
        and(
          eq(projectNotesCalendar.userId, input.userId),
          or(
            like(projectNotesCalendar.title, `%${input.query}%`),
            like(projectNotesCalendar.content, `%${input.query}%`),
            like(projectNotesCalendar.tags, `%${input.query}%`)
          )
        )
      )
      .orderBy(desc(projectNotesCalendar.updatedAt))
      .limit(limit);

    const notes = results.map(note => ({
      id: note.id,
      title: note.title,
      content: note.content,
      tags: note.tags ? JSON.parse(note.tags as string) : [],
      category: note.category || "general",
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
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const scheduledDate = new Date(input.scheduledFor);
    if (isNaN(scheduledDate.getTime())) {
      return {
        success: false,
        message: "無效的時間格式",
      };
    }

    const [result] = await db.insert(orbScheduledJobs).values({
      userId: input.userId,
      jobName: input.taskName,
      scheduledFor: scheduledDate,
      status: "pending",
      description: input.description || "",
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date(),
    });

    logger.info("task_scheduled", {
      userId: input.userId,
      jobId: result.insertId,
      taskName: input.taskName,
      scheduledFor: input.scheduledFor,
    });

    return {
      success: true,
      jobId: Number(result.insertId),
      message: `任務「${input.taskName}」已排程至 ${scheduledDate.toLocaleString("zh-TW")}`,
    };
  } catch (error) {
    logger.error("schedule_task_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `排程失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Organize asset library by adding tags
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
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    let updated = 0;

    for (const assetId of input.assetIds) {
      const [asset] = await db
        .select()
        .from(digitalAssetLibrary)
        .where(
          and(
            eq(digitalAssetLibrary.id, assetId),
            eq(digitalAssetLibrary.userId, input.userId)
          )
        )
        .limit(1);

      if (!asset) continue;

      const currentTags: string[] = asset.tags ? JSON.parse(asset.tags as string) : [];
      let newTags: string[];

      switch (input.action) {
        case "add":
          newTags = [...new Set([...currentTags, ...input.tags])];
          break;
        case "remove":
          newTags = currentTags.filter(tag => !input.tags.includes(tag));
          break;
        case "replace":
          newTags = input.tags;
          break;
        default:
          newTags = currentTags;
      }

      await db
        .update(digitalAssetLibrary)
        .set({
          tags: JSON.stringify(newTags),
          updatedAt: new Date(),
        })
        .where(eq(digitalAssetLibrary.id, assetId));

      updated++;
    }

    logger.info("assets_tagged", {
      userId: input.userId,
      updated,
      action: input.action,
      tags: input.tags,
    });

    return {
      success: true,
      updated,
      message: `已更新 ${updated} 個素材的標籤`,
    };
  } catch (error) {
    logger.error("tag_assets_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      updated: 0,
      message: `標籤更新失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get asset statistics and organization suggestions
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
    // Get total assets
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(digitalAssetLibrary)
      .where(eq(digitalAssetLibrary.userId, userId));

    const totalAssets = totalResult?.count || 0;

    // Get untagged assets
    const [untaggedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(digitalAssetLibrary)
      .where(
        and(
          eq(digitalAssetLibrary.userId, userId),
          or(
            eq(digitalAssetLibrary.tags, "null"),
            eq(digitalAssetLibrary.tags, "[]"),
            sql`${digitalAssetLibrary.tags} IS NULL`
          )
        )
      );

    const untaggedAssets = untaggedResult?.count || 0;

    // Generate suggestions
    const suggestions: string[] = [];
    if (untaggedAssets > 0) {
      suggestions.push(`還有 ${untaggedAssets} 個素材未加標籤，建議整理`);
    }
    if (totalAssets > 100) {
      suggestions.push("素材數量較多，建議建立分類資料夾");
    }
    if (totalAssets > 0 && untaggedAssets / totalAssets > 0.5) {
      suggestions.push("超過一半的素材未分類，建議批次加上標籤");
    }

    logger.debug("asset_statistics_retrieved", {
      userId,
      totalAssets,
      untaggedAssets,
    });

    return {
      success: true,
      statistics: {
        totalAssets,
        untaggedAssets,
        topTags: [], // Could be enhanced with tag frequency analysis
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
