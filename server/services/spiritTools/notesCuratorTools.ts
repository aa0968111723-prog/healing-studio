/**
 * server/services/spiritTools/notesCuratorTools.ts
 *
 * 記記（notes-curator）— 筆記、待辦、行事曆、素材庫的全套管家。
 *
 * 設計原則：
 * - 筆記 / 待辦 / 行事曆同源：都存在 `project_notes_calendar`，差別只在
 *   `noteType`（note / script / calendar_event）。calendar_event 必須帶
 *   `scheduledDate`，否則無從排序與提醒。
 * - 待辦狀態（todo / in_progress / done）由 `status` 欄位驅動；done 之後
 *   仍保留紀錄，列表只是預設過濾掉。
 * - 素材標籤 / 分類存在 `digital_asset_library.tags`（json string[]） 與
 *   `digital_asset_library.category`（varchar）— 0045 migration 後上線。
 * - 工具回傳一律 { success, message, …payload }；任何失敗都回 success:false
 *   並用 logger 記下 root cause，避免 silent breakage。
 */

import { logger } from "../../_core/logger";
import { getDb, escapeLikePattern } from "../../db";
import {
  projectNotesCalendar,
  digitalAssetLibrary,
  type ProjectNote,
} from "../../../drizzle/schema";
import { and, eq, like, or, desc, asc, sql, gte, lte, inArray } from "drizzle-orm";

type NoteType = "note" | "script" | "calendar_event";
type NoteStatus = "todo" | "in_progress" | "done";

export interface NoteSummary {
  id: number;
  title: string;
  content: string;
  noteType: NoteType;
  status: NoteStatus;
  tags: string[];
  category: string | null;
  scheduledDate: string | null;
  endDate: string | null;
  reminderMinutes: number | null;
  location: ProjectNote["location"];
  meetingUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function toNoteSummary(row: ProjectNote): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    content: row.content ?? "",
    noteType: row.noteType,
    status: row.status,
    tags: (row.tags ?? []) as string[],
    category: (row as { category?: string | null }).category ?? null,
    scheduledDate: row.scheduledDate ? row.scheduledDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    reminderMinutes: row.reminderMinutes ?? null,
    location: row.location ?? null,
    meetingUrl: row.meetingUrl ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function failure(message: string, error?: unknown): {
  success: false;
  message: string;
} {
  if (error !== undefined) {
    return {
      success: false,
      message: `${message}：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { success: false, message };
}

/**
 * Build the optional category SQL filter used by listNotes / listTasks /
 * searchNotes. Returns `undefined` (not a no-op SQL) when the column is
 * blank, so callers can compose with `and(...)` without checking shape.
 */
function categoryFilter(category: string | undefined | null) {
  if (!category) return undefined;
  return sql`${projectNotesCalendar.category} = ${category}`;
}

// ─── Notes / Tasks ───────────────────────────────────────────────────────

/**
 * Create a note, script, or calendar event. The same table backs all three;
 * `noteType` chooses which. For calendar_event, `scheduledDate` is required
 * so the entry surfaces in listUpcoming / ICS feed.
 */
export async function createNote(input: {
  userId: number;
  title: string;
  content: string;
  tags?: string[];
  category?: string;
  noteType?: NoteType;
  status?: NoteStatus;
  scheduledDate?: string;
  endDate?: string;
  reminderMinutes?: number;
  location?: ProjectNote["location"];
  meetingUrl?: string;
}): Promise<{ success: boolean; noteId?: number; message: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const noteType: NoteType = input.noteType ?? "note";
    if (noteType === "calendar_event" && !input.scheduledDate) {
      return failure("行事曆事件必須附 scheduledDate（ISO 字串），否則排不進日曆");
    }

    const [result] = await db.insert(projectNotesCalendar).values({
      userId: input.userId,
      title: input.title,
      content: input.content,
      noteType,
      status: input.status ?? "todo",
      tags: input.tags ?? null,
      category: input.category ?? null,
      scheduledDate: input.scheduledDate ? new Date(input.scheduledDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      reminderMinutes: input.reminderMinutes ?? null,
      location: input.location ?? null,
      meetingUrl: input.meetingUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    logger.info("note_created", {
      userId: input.userId,
      noteId: result.insertId,
      noteType,
      title: input.title,
    });

    return {
      success: true,
      noteId: Number(result.insertId),
      message: `${noteType === "calendar_event" ? "行事曆事件" : noteType === "script" ? "腳本" : "筆記"}「${input.title}」已建立`,
    };
  } catch (error) {
    logger.error("create_note_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure("建立筆記失敗", error);
  }
}

/**
 * Search notes by title, content, tags, or category. Optional `noteType` /
 * `status` filters narrow the scan; default returns all kinds ordered by
 * most-recently-updated.
 */
export async function searchNotes(input: {
  userId: number;
  query: string;
  limit?: number;
  noteType?: NoteType;
  status?: NoteStatus;
  category?: string;
}): Promise<{ success: boolean; notes: NoteSummary[]; total: number }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    const conditions = [
      eq(projectNotesCalendar.userId, input.userId),
      or(
        like(projectNotesCalendar.title, `%${escapeLikePattern(input.query)}%`),
        like(projectNotesCalendar.content, `%${escapeLikePattern(input.query)}%`),
        sql`CAST(${projectNotesCalendar.tags} AS CHAR) LIKE ${`%${escapeLikePattern(input.query)}%`}`
      ),
    ];
    if (input.noteType) {
      conditions.push(eq(projectNotesCalendar.noteType, input.noteType));
    }
    if (input.status) {
      conditions.push(eq(projectNotesCalendar.status, input.status));
    }
    const catFilter = categoryFilter(input.category);
    if (catFilter) conditions.push(catFilter);

    const results = await db
      .select()
      .from(projectNotesCalendar)
      .where(and(...conditions))
      .orderBy(desc(projectNotesCalendar.updatedAt))
      .limit(limit);

    const notes = results.map(toNoteSummary);

    logger.debug("notes_searched", {
      userId: input.userId,
      query: input.query,
      noteType: input.noteType,
      found: notes.length,
    });

    return { success: true, notes, total: notes.length };
  } catch (error) {
    logger.error("search_notes_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, notes: [], total: 0 };
  }
}

/**
 * List notes ordered by recency, with optional filters. Used when 記記 needs
 * to surface "what have I been working on" without a specific query.
 */
export async function listNotes(input: {
  userId: number;
  limit?: number;
  noteType?: NoteType;
  status?: NoteStatus;
  category?: string;
  tag?: string;
}): Promise<{ success: boolean; notes: NoteSummary[]; total: number }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    const conditions = [eq(projectNotesCalendar.userId, input.userId)];
    if (input.noteType) {
      conditions.push(eq(projectNotesCalendar.noteType, input.noteType));
    }
    if (input.status) {
      conditions.push(eq(projectNotesCalendar.status, input.status));
    }
    const catFilter = categoryFilter(input.category);
    if (catFilter) conditions.push(catFilter);
    if (input.tag) {
      conditions.push(
        sql`CAST(${projectNotesCalendar.tags} AS CHAR) LIKE ${`%"${escapeLikePattern(input.tag)}"%`}`
      );
    }

    const results = await db
      .select()
      .from(projectNotesCalendar)
      .where(and(...conditions))
      .orderBy(desc(projectNotesCalendar.updatedAt))
      .limit(limit);

    return {
      success: true,
      notes: results.map(toNoteSummary),
      total: results.length,
    };
  } catch (error) {
    logger.error("list_notes_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, notes: [], total: 0 };
  }
}

/**
 * Patch an existing note. Pass only the fields you want to change.
 * Returns the updated note so the caller doesn't need a follow-up read.
 */
export async function updateNote(input: {
  userId: number;
  noteId: number;
  title?: string;
  content?: string;
  tags?: string[];
  category?: string | null;
  status?: NoteStatus;
  noteType?: NoteType;
  scheduledDate?: string | null;
  endDate?: string | null;
  reminderMinutes?: number | null;
  location?: ProjectNote["location"];
  meetingUrl?: string | null;
}): Promise<{ success: boolean; note?: NoteSummary; message: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined) patch.content = input.content;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.category !== undefined) patch.category = input.category;
    if (input.status !== undefined) patch.status = input.status;
    if (input.noteType !== undefined) patch.noteType = input.noteType;
    if (input.scheduledDate !== undefined) {
      patch.scheduledDate = input.scheduledDate ? new Date(input.scheduledDate) : null;
    }
    if (input.endDate !== undefined) {
      patch.endDate = input.endDate ? new Date(input.endDate) : null;
    }
    if (input.reminderMinutes !== undefined) {
      patch.reminderMinutes = input.reminderMinutes;
    }
    if (input.location !== undefined) patch.location = input.location;
    if (input.meetingUrl !== undefined) patch.meetingUrl = input.meetingUrl;

    // Only `updatedAt` was set → nothing to patch.
    if (Object.keys(patch).length === 1) {
      return failure("沒有提供要更新的欄位");
    }

    const updateResult = await db
      .update(projectNotesCalendar)
      .set(patch)
      .where(
        and(
          eq(projectNotesCalendar.id, input.noteId),
          eq(projectNotesCalendar.userId, input.userId)
        )
      );

    // mysql2 returns ResultSetHeader; affectedRows tells us whether the
    // note belongs to the user. 0 means either wrong id or wrong owner —
    // either way the caller can't see it, so we treat them the same.
    const affected =
      (updateResult as unknown as { affectedRows?: number; rowsAffected?: number })
        .affectedRows ??
      (updateResult as unknown as { rowsAffected?: number }).rowsAffected ??
      0;
    if (!affected) {
      return failure(`找不到 noteId=${input.noteId}（或不屬於目前使用者）`);
    }

    const [row] = await db
      .select()
      .from(projectNotesCalendar)
      .where(eq(projectNotesCalendar.id, input.noteId))
      .limit(1);

    logger.info("note_updated", {
      userId: input.userId,
      noteId: input.noteId,
      fields: Object.keys(patch).filter(k => k !== "updatedAt"),
    });

    return {
      success: true,
      note: row ? toNoteSummary(row) : undefined,
      message: `筆記 #${input.noteId} 已更新`,
    };
  } catch (error) {
    logger.error("update_note_failed", {
      userId: input.userId,
      noteId: input.noteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure("更新筆記失敗", error);
  }
}

/**
 * Hard delete a note. We don't soft-delete because 記記 needs the storage
 * to stay reasonable and the workflow is "I changed my mind, drop this".
 * If the caller wanted a soft delete, they'd set status=done.
 */
export async function deleteNote(input: {
  userId: number;
  noteId: number;
}): Promise<{ success: boolean; message: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const deleteResult = await db
      .delete(projectNotesCalendar)
      .where(
        and(
          eq(projectNotesCalendar.id, input.noteId),
          eq(projectNotesCalendar.userId, input.userId)
        )
      );
    const affected =
      (deleteResult as unknown as { affectedRows?: number; rowsAffected?: number })
        .affectedRows ??
      (deleteResult as unknown as { rowsAffected?: number }).rowsAffected ??
      0;
    if (!affected) {
      return failure(`找不到 noteId=${input.noteId}（或不屬於目前使用者）`);
    }

    logger.info("note_deleted", { userId: input.userId, noteId: input.noteId });
    return { success: true, message: `筆記 #${input.noteId} 已刪除` };
  } catch (error) {
    logger.error("delete_note_failed", {
      userId: input.userId,
      noteId: input.noteId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure("刪除筆記失敗", error);
  }
}

/**
 * Convenience for the common todo lifecycle: bump status to in_progress /
 * done. Delegates to updateNote so the underlying invariants stay in one
 * place.
 */
export async function updateNoteStatus(input: {
  userId: number;
  noteId: number;
  status: NoteStatus;
}): Promise<{ success: boolean; note?: NoteSummary; message: string }> {
  const result = await updateNote({
    userId: input.userId,
    noteId: input.noteId,
    status: input.status,
  });
  if (!result.success) return result;
  return {
    ...result,
    message: `任務 #${input.noteId} 標記為「${
      input.status === "todo"
        ? "待辦"
        : input.status === "in_progress"
          ? "進行中"
          : "完成"
    }」`,
  };
}

// ─── Scheduling / Calendar ────────────────────────────────────────────────

/**
 * Schedule a calendar event. The original implementation stubbed this out
 * because it was wired against orb_scheduled_jobs (a CRON-style recurring
 * schedule). The correct backing table is project_notes_calendar with
 * noteType=calendar_event — which already powers the on-page calendar UI
 * and ICS feed (see 0036 migration).
 */
export async function scheduleEvent(input: {
  userId: number;
  title: string;
  scheduledFor: string; // ISO datetime
  endDate?: string;
  description?: string;
  reminderMinutes?: number;
  location?: ProjectNote["location"];
  meetingUrl?: string;
  tags?: string[];
  category?: string;
}): Promise<{ success: boolean; eventId?: number; message: string }> {
  const result = await createNote({
    userId: input.userId,
    title: input.title,
    content: input.description ?? "",
    noteType: "calendar_event",
    status: "todo",
    scheduledDate: input.scheduledFor,
    endDate: input.endDate,
    reminderMinutes: input.reminderMinutes,
    location: input.location,
    meetingUrl: input.meetingUrl,
    tags: input.tags,
    category: input.category,
  });
  if (!result.success) return { success: false, message: result.message };
  return {
    success: true,
    eventId: result.noteId,
    message: `行事曆事件「${input.title}」已排在 ${new Date(input.scheduledFor).toLocaleString("zh-TW")}`,
  };
}

/**
 * Back-compat shim for the old API surface (notesCurator.scheduleTask).
 * Kept so existing chat history / saved tool calls keep working; internally
 * just calls scheduleEvent.
 */
export async function scheduleTask(input: {
  userId: number;
  taskName: string;
  scheduledFor: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ success: boolean; jobId?: number; message: string }> {
  const result = await scheduleEvent({
    userId: input.userId,
    title: input.taskName,
    scheduledFor: input.scheduledFor,
    description: input.description,
  });
  return {
    success: result.success,
    jobId: result.eventId,
    message: result.message,
  };
}

/**
 * Return calendar events / pending tasks happening within the next N days
 * (default 7), ordered by scheduledDate ascending. Past events are
 * excluded — the use case is "what's coming up?".
 */
export async function listUpcoming(input: {
  userId: number;
  withinDays?: number;
  limit?: number;
  includeStatuses?: NoteStatus[];
}): Promise<{
  success: boolean;
  events: NoteSummary[];
  windowStart: string;
  windowEnd: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const windowDays = Math.min(Math.max(input.withinDays ?? 7, 1), 90);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

    const start = new Date();
    const end = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000);
    const statuses = input.includeStatuses ?? ["todo", "in_progress"];

    const conditions = [
      eq(projectNotesCalendar.userId, input.userId),
      eq(projectNotesCalendar.noteType, "calendar_event"),
      gte(projectNotesCalendar.scheduledDate, start),
      lte(projectNotesCalendar.scheduledDate, end),
      inArray(projectNotesCalendar.status, statuses),
    ];

    const results = await db
      .select()
      .from(projectNotesCalendar)
      .where(and(...conditions))
      .orderBy(asc(projectNotesCalendar.scheduledDate))
      .limit(limit);

    return {
      success: true,
      events: results.map(toNoteSummary),
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
    };
  } catch (error) {
    logger.error("list_upcoming_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      events: [],
      windowStart: new Date().toISOString(),
      windowEnd: new Date().toISOString(),
    };
  }
}

/**
 * Quick win the team will actually call: "what did I save recently?"
 * Returns a compact roll-up suitable for a chat reply — counts by kind /
 * status, plus the most-recent 5 titles.
 */
export async function summarizeRecentActivity(input: {
  userId: number;
  sinceDays?: number;
}): Promise<{
  success: boolean;
  sinceDays: number;
  counts: { notes: number; tasks: number; calendar: number; scripts: number };
  byStatus: Record<NoteStatus, number>;
  recentTitles: Array<{ id: number; title: string; noteType: NoteType; updatedAt: string }>;
}> {
  const empty = {
    notes: 0,
    tasks: 0,
    calendar: 0,
    scripts: 0,
  };
  const emptyStatus: Record<NoteStatus, number> = {
    todo: 0,
    in_progress: 0,
    done: 0,
  };
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const sinceDays = Math.min(Math.max(input.sinceDays ?? 7, 1), 90);
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        id: projectNotesCalendar.id,
        title: projectNotesCalendar.title,
        noteType: projectNotesCalendar.noteType,
        status: projectNotesCalendar.status,
        updatedAt: projectNotesCalendar.updatedAt,
      })
      .from(projectNotesCalendar)
      .where(
        and(
          eq(projectNotesCalendar.userId, input.userId),
          gte(projectNotesCalendar.updatedAt, since)
        )
      )
      .orderBy(desc(projectNotesCalendar.updatedAt))
      .limit(200);

    const counts = { ...empty };
    const byStatus = { ...emptyStatus };
    for (const row of rows) {
      if (row.noteType === "calendar_event") counts.calendar += 1;
      else if (row.noteType === "script") counts.scripts += 1;
      else if (row.status === "todo" || row.status === "in_progress") counts.tasks += 1;
      else counts.notes += 1;
      byStatus[row.status] += 1;
    }

    return {
      success: true,
      sinceDays,
      counts,
      byStatus,
      recentTitles: rows.slice(0, 5).map(r => ({
        id: r.id,
        title: r.title,
        noteType: r.noteType,
        updatedAt: r.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    logger.error("summarize_recent_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      sinceDays: input.sinceDays ?? 7,
      counts: empty,
      byStatus: emptyStatus,
      recentTitles: [],
    };
  }
}

// ─── Assets ──────────────────────────────────────────────────────────────

function dedupeTags(tags: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!tag) continue;
    const trimmed = String(tag).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Add / remove / replace tags on one or more assets. Owner check is in the
 * WHERE clause so we can't accidentally tag someone else's assets even if
 * the caller supplied stale ids.
 */
export async function tagAssets(input: {
  userId: number;
  assetIds: number[];
  tags: string[];
  action?: "add" | "remove" | "replace";
}): Promise<{ success: boolean; updated: number; message: string }> {
  try {
    if (!input.assetIds.length) {
      return { success: false, updated: 0, message: "assetIds 不能為空" };
    }
    const action = input.action ?? "add";
    const incoming = dedupeTags(input.tags);
    if (action !== "remove" && !incoming.length) {
      return { success: false, updated: 0, message: "tags 不能為空" };
    }

    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    const existing = await db
      .select({
        id: digitalAssetLibrary.id,
        tags: digitalAssetLibrary.tags,
      })
      .from(digitalAssetLibrary)
      .where(
        and(
          eq(digitalAssetLibrary.userId, input.userId),
          inArray(digitalAssetLibrary.id, input.assetIds)
        )
      );

    let updated = 0;
    for (const row of existing) {
      const current = ((row.tags ?? []) as string[]).filter(Boolean);
      let next: string[];
      if (action === "replace") {
        next = incoming;
      } else if (action === "remove") {
        const removeSet = new Set(incoming.map(t => t.toLowerCase()));
        next = current.filter(t => !removeSet.has(String(t).toLowerCase()));
      } else {
        next = dedupeTags([...current, ...incoming]);
      }
      // Skip the write when nothing actually changed — saves an UPDATE per
      // unchanged asset on bulk batches.
      const same =
        next.length === current.length &&
        next.every((t, i) => t === current[i]);
      if (same) continue;
      await db
        .update(digitalAssetLibrary)
        .set({ tags: next, updatedAt: new Date() })
        .where(
          and(
            eq(digitalAssetLibrary.id, row.id),
            eq(digitalAssetLibrary.userId, input.userId)
          )
        );
      updated += 1;
    }

    logger.info("assets_tagged", {
      userId: input.userId,
      action,
      requested: input.assetIds.length,
      updated,
    });

    return {
      success: true,
      updated,
      message: `已${action === "remove" ? "移除" : action === "replace" ? "覆蓋" : "新增"}標籤到 ${updated} / ${input.assetIds.length} 個素材`,
    };
  } catch (error) {
    logger.error("tag_assets_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      updated: 0,
      message: `素材標籤失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Set / clear a category on a single asset. Categories are a flat string
 * dimension (e.g. "外拍"、"商案"、"個人") orthogonal to tags.
 */
export async function categorizeAsset(input: {
  userId: number;
  assetId: number;
  category: string | null;
}): Promise<{ success: boolean; message: string }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const result = await db
      .update(digitalAssetLibrary)
      .set({ category: input.category, updatedAt: new Date() })
      .where(
        and(
          eq(digitalAssetLibrary.id, input.assetId),
          eq(digitalAssetLibrary.userId, input.userId)
        )
      );
    const affected =
      (result as unknown as { affectedRows?: number; rowsAffected?: number })
        .affectedRows ??
      (result as unknown as { rowsAffected?: number }).rowsAffected ??
      0;
    if (!affected) {
      return failure(`找不到 assetId=${input.assetId}（或不屬於目前使用者）`);
    }
    return {
      success: true,
      message: input.category
        ? `素材 #${input.assetId} 分類設為「${input.category}」`
        : `素材 #${input.assetId} 已清除分類`,
    };
  } catch (error) {
    logger.error("categorize_asset_failed", {
      userId: input.userId,
      assetId: input.assetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return failure("設定素材分類失敗", error);
  }
}

export interface AssetSummary {
  id: number;
  title: string;
  description: string | null;
  assetType: string;
  thumbnailUrl: string | null;
  fileUrl: string | null;
  tags: string[];
  category: string | null;
  createdAt: string;
}

/**
 * Find assets matching any combination of title/description text, tag,
 * category, or asset type. Empty query + no filters returns the most
 * recent N assets so 記記 can show "latest first" without a separate
 * endpoint.
 */
export async function searchAssets(input: {
  userId: number;
  query?: string;
  tag?: string;
  category?: string;
  assetType?: "image" | "video" | "audio" | "voice" | "script" | "zip_bundle";
  limit?: number;
}): Promise<{ success: boolean; assets: AssetSummary[]; total: number }> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

    const conditions = [eq(digitalAssetLibrary.userId, input.userId)];
    if (input.query) {
      conditions.push(
        or(
          like(digitalAssetLibrary.title, `%${escapeLikePattern(input.query)}%`),
          like(digitalAssetLibrary.description, `%${escapeLikePattern(input.query)}%`),
          sql`CAST(${digitalAssetLibrary.tags} AS CHAR) LIKE ${`%${escapeLikePattern(input.query)}%`}`
        )!
      );
    }
    if (input.tag) {
      conditions.push(
        sql`CAST(${digitalAssetLibrary.tags} AS CHAR) LIKE ${`%"${escapeLikePattern(input.tag)}"%`}`
      );
    }
    if (input.category) {
      conditions.push(eq(digitalAssetLibrary.category, input.category));
    }
    if (input.assetType) {
      conditions.push(eq(digitalAssetLibrary.assetType, input.assetType));
    }

    const results = await db
      .select()
      .from(digitalAssetLibrary)
      .where(and(...conditions))
      .orderBy(desc(digitalAssetLibrary.createdAt))
      .limit(limit);

    const assets: AssetSummary[] = results.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      assetType: row.assetType,
      thumbnailUrl: row.thumbnailUrl ?? null,
      fileUrl: row.fileUrl ?? null,
      tags: ((row.tags ?? []) as string[]) ?? [],
      category: row.category ?? null,
      createdAt: row.createdAt.toISOString(),
    }));

    return { success: true, assets, total: assets.length };
  } catch (error) {
    logger.error("search_assets_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, assets: [], total: 0 };
  }
}

/**
 * Asset library overview: total count, untagged count, top tags, and a
 * handful of actionable suggestions so 記記 doesn't reply with only raw
 * numbers.
 */
export async function getAssetStatistics(userId: number): Promise<{
  success: boolean;
  statistics: {
    totalAssets: number;
    untaggedAssets: number;
    topTags: Array<{ tag: string; count: number }>;
    byType: Array<{ assetType: string; count: number }>;
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
    const totalAssets = Number(totalResult?.count ?? 0);

    const [untaggedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(digitalAssetLibrary)
      .where(
        and(
          eq(digitalAssetLibrary.userId, userId),
          sql`(${digitalAssetLibrary.tags} IS NULL OR JSON_LENGTH(${digitalAssetLibrary.tags}) = 0)`
        )
      );
    const untaggedAssets = Number(untaggedResult?.count ?? 0);

    const tagRows = await db
      .select({
        id: digitalAssetLibrary.id,
        tags: digitalAssetLibrary.tags,
      })
      .from(digitalAssetLibrary)
      .where(
        and(
          eq(digitalAssetLibrary.userId, userId),
          sql`JSON_LENGTH(${digitalAssetLibrary.tags}) > 0`
        )
      );

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      for (const tag of (row.tags ?? []) as string[]) {
        const key = String(tag).trim();
        if (!key) continue;
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const typeRows = await db
      .select({
        assetType: digitalAssetLibrary.assetType,
        count: sql<number>`count(*)`,
      })
      .from(digitalAssetLibrary)
      .where(eq(digitalAssetLibrary.userId, userId))
      .groupBy(digitalAssetLibrary.assetType);
    const byType = typeRows.map(row => ({
      assetType: row.assetType,
      count: Number(row.count),
    }));

    const suggestions: string[] = [];
    if (totalAssets === 0) {
      suggestions.push("素材庫還是空的，先去工作室出一張看看");
    } else {
      if (untaggedAssets > 0) {
        const ratio = Math.round((untaggedAssets / totalAssets) * 100);
        suggestions.push(
          `有 ${untaggedAssets} 個素材（${ratio}%）還沒標籤 — 喊我「幫我把最近幾張上標籤」我可以一次處理`
        );
      }
      if (totalAssets >= 50 && topTags.length === 0) {
        suggestions.push("素材累積到 50+ 但完全沒分類，建議先從用途切（外拍 / 商案 / 練習）");
      }
      if (topTags.length > 0) {
        suggestions.push(`目前最常用的標籤：${topTags.slice(0, 3).map(t => t.tag).join("、")}`);
      }
    }

    return {
      success: true,
      statistics: {
        totalAssets,
        untaggedAssets,
        topTags,
        byType,
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
        byType: [],
        suggestions: ["無法取得素材統計"],
      },
    };
  }
}
