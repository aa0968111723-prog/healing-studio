import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { buildIcsFeed } from "../services/icsExport";

// Shared schema for calendar event location — mirrors the column type in DB.
const scheduleLocationSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().max(512).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

// ─── scriptJson 邊界驗證（AIDV-652） ─────────────────────────────────────────
// 序列化後 ≤256KB、巢狀深度 ≤20，超限回 400。保守值確保現存歷史筆記不受影響。
const SCRIPT_JSON_MAX_BYTES = 256 * 1024; // 256 KB
const SCRIPT_JSON_MAX_DEPTH = 20;

function jsonDepth(v: unknown, d = 0): number {
  if (d > SCRIPT_JSON_MAX_DEPTH) return d;
  if (Array.isArray(v)) return Math.max(d, ...v.map(i => jsonDepth(i, d + 1)));
  if (v !== null && typeof v === "object")
    return Math.max(d, ...Object.values(v as object).map(i => jsonDepth(i, d + 1)));
  return d;
}

const scriptJsonSchema = z
  .record(z.string(), z.unknown())
  .superRefine((val, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(val), "utf8");
    if (bytes > SCRIPT_JSON_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scriptJson 序列化後超過 ${SCRIPT_JSON_MAX_BYTES} bytes 上限（實際 ${bytes} bytes）`,
      });
    }
    if (jsonDepth(val) > SCRIPT_JSON_MAX_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scriptJson 巢狀深度超過 ${SCRIPT_JSON_MAX_DEPTH} 層上限`,
      });
    }
  });

// ─── Project Notes ────────────────────────────────────────────────────────────

export const notesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          noteType: z
            .enum(["note", "script", "calendar_event", "all"])
            .default("all"),
          status: z
            .enum(["todo", "in_progress", "done", "all", "open"])
            .default("all"),
          search: z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const all = await db.getProjectNotesByUser(ctx.user.id);
      let result = all;
      if (input?.noteType && input.noteType !== "all") {
        result = result.filter(n => n.noteType === input.noteType);
      }
      if (input?.status && input.status !== "all") {
        if (input.status === "open") {
          result = result.filter(n => (n.status ?? "todo") !== "done");
        } else {
          result = result.filter(n => (n.status ?? "todo") === input.status);
        }
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          n =>
            n.title.toLowerCase().includes(q) ||
            (n.content || "").toLowerCase().includes(q)
        );
      }
      if (input?.tags && input.tags.length > 0) {
        result = result.filter(n => {
          const noteTags = (n.tags as string[] | null) || [];
          return input.tags!.some(t => noteTags.includes(t));
        });
      }
      return result;
    }),

  // Aggregated planning view: overdue / today / upcoming / unscheduled
  // buckets so the user lands on the page and immediately sees what to do.
  summary: protectedProcedure
    .input(
      z
        .object({
          // Client passes the start-of-day epoch in its own timezone so the
          // server doesn't have to guess the user's locale.
          todayStart: z.number().optional(),
          upcomingDays: z.number().int().min(1).max(60).default(7),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const all = await db.getProjectNotesByUser(ctx.user.id);
      const now = Date.now();
      const todayStart =
        input?.todayStart ??
        (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })();
      const todayEnd = todayStart + 24 * 60 * 60 * 1000;
      const upcomingEnd =
        todayStart + (input?.upcomingDays ?? 7) * 24 * 60 * 60 * 1000;

      const open = all.filter(n => (n.status ?? "todo") !== "done");
      const overdue: typeof all = [];
      const today: typeof all = [];
      const upcoming: typeof all = [];
      const unscheduled: typeof all = [];
      for (const n of open) {
        if (!n.scheduledDate) {
          unscheduled.push(n);
          continue;
        }
        const ts = new Date(n.scheduledDate).getTime();
        if (ts < todayStart) overdue.push(n);
        else if (ts < todayEnd) today.push(n);
        else if (ts < upcomingEnd) upcoming.push(n);
      }

      const counts = {
        total: all.length,
        todo: all.filter(n => (n.status ?? "todo") === "todo").length,
        inProgress: all.filter(n => n.status === "in_progress").length,
        done: all.filter(n => n.status === "done").length,
        overdue: overdue.length,
        today: today.length,
        upcoming: upcoming.length,
        unscheduled: unscheduled.length,
      };

      return {
        generatedAt: now,
        counts,
        overdue,
        today,
        upcoming,
        unscheduled,
      };
    }),

  // Build an iCalendar (.ics) feed of the user's scheduled notes so they
  // can subscribe in any calendar app (Apple Calendar, Outlook, Notion
  // Calendar, etc.) — works fully offline and round-trips to other tools.
  exportIcs: protectedProcedure
    .input(
      z
        .object({
          includeDone: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const all = await db.getProjectNotesByUser(ctx.user.id);
      const includeDone = input?.includeDone ?? false;
      const events = all
        .filter(n => {
          if (!n.scheduledDate) return false;
          if (!includeDone && (n.status ?? "todo") === "done") return false;
          return true;
        })
        .map(n => ({
          id: n.id,
          title: n.title,
          content: n.content,
          scheduledDate: n.scheduledDate as Date,
          status: n.status,
          tags: n.tags as string[] | null,
        }));
      const content = buildIcsFeed(events);
      return {
        filename: `healing-studio-schedule-${new Date().toISOString().slice(0, 10)}.ics`,
        mime: "text/calendar",
        content,
        eventCount: events.length,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        content: z.string().optional(),
        scriptJson: scriptJsonSchema.optional(),
        noteType: z
          .enum(["note", "script", "calendar_event"])
          .default("note"),
        status: z.enum(["todo", "in_progress", "done"]).default("todo"),
        scheduledDate: z.number().optional(),
        endDate: z.number().optional(),
        reminderMinutes: z.number().int().min(0).max(60 * 24 * 7).optional(),
        location: scheduleLocationSchema.optional(),
        meetingUrl: z.string().url().max(512).optional(),
        tags: z.array(z.string().max(32)).max(10).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createProjectNote({
        userId: ctx.user.id,
        title: input.title,
        content: input.content,
        scriptJson: input.scriptJson,
        noteType: input.noteType,
        status: input.status,
        scheduledDate: input.scheduledDate
          ? new Date(input.scheduledDate)
          : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        reminderMinutes: input.reminderMinutes,
        location: input.location,
        meetingUrl: input.meetingUrl,
        tags: input.tags,
      });
      return { id };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).max(255).optional(),
        content: z.string().optional(),
        scriptJson: scriptJsonSchema.optional(),
        scheduledDate: z.number().nullable().optional(),
        endDate: z.number().nullable().optional(),
        reminderMinutes: z
          .number()
          .int()
          .min(0)
          .max(60 * 24 * 7)
          .nullable()
          .optional(),
        location: scheduleLocationSchema.nullable().optional(),
        meetingUrl: z.string().url().max(512).nullable().optional(),
        tags: z.array(z.string().max(32)).max(10).optional(),
        noteType: z.enum(["note", "script", "calendar_event"]).optional(),
        status: z.enum(["todo", "in_progress", "done"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
      }
      await db.updateProjectNote(input.id, {
        title: input.title,
        content: input.content,
        scriptJson: input.scriptJson,
        noteType: input.noteType,
        status: input.status,
        tags: input.tags,
        ...(input.scheduledDate !== undefined
          ? {
              scheduledDate: input.scheduledDate
                ? new Date(input.scheduledDate)
                : null,
            }
          : {}),
        ...(input.endDate !== undefined
          ? { endDate: input.endDate ? new Date(input.endDate) : null }
          : {}),
        ...(input.reminderMinutes !== undefined
          ? { reminderMinutes: input.reminderMinutes }
          : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.meetingUrl !== undefined
          ? { meetingUrl: input.meetingUrl }
          : {}),
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const note = await db.getProjectNote(input.id);
      if (!note || note.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
      }
      await db.deleteProjectNote(input.id);
      return { success: true };
    }),
});
