/**
 * Public ICS calendar feed.
 *
 * `GET /api/ics/<token>.ics` returns a VCALENDAR with one VEVENT per
 * scheduled event in the user's project_notes_calendar. The token is the
 * opaque value stored on `users.icsFeedToken`; rotating it instantly
 * revokes existing phone-side subscriptions.
 *
 * The endpoint is intentionally unauthenticated (no cookie / bearer) so
 * native phone calendars (Apple Calendar, Google Calendar, Outlook,
 * stock Android Calendar) can poll it directly. Knowledge of the token
 * IS the credential — keep nanoid length ≥ 32 chars.
 */

import { Router, type Request, type Response } from "express";
import * as db from "../db";
import {
  escapeIcsText,
  foldIcsLine,
  isAllDaySchedule,
} from "../services/icsExport";

export const icsFeedRouter = Router();

const PROD_ID = "-//Healing Studio//Schedule//ZH-TW";

function formatUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function formatLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function buildIcs(
  events: Awaited<ReturnType<typeof db.getCalendarEventsByUser>>,
  userId: number
): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PROD_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:創作排程",
    "X-WR-TIMEZONE:UTC",
  ];

  for (const ev of events) {
    if (!ev.scheduledDate) continue;
    const start = new Date(ev.scheduledDate);
    if (Number.isNaN(start.getTime())) continue;

    const loc = ev.location as
      | { name?: string; address?: string; lat?: number; lng?: number }
      | null;
    const locText = loc
      ? [loc.name, loc.address].filter(Boolean).join(" — ")
      : "";

    const descriptionParts = [ev.content ?? "", ev.meetingUrl ? `\n會議連結：${ev.meetingUrl}` : ""].filter(Boolean);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:hs-note-${ev.id}-u${userId}@healing-studio`);
    lines.push(`DTSTAMP:${formatUtc(now)}`);

    // Treat midnight-with-no-endDate as an all-day event so phone calendars
    // render a banner instead of a 1h block at 00:00.
    if (isAllDaySchedule(start) && !ev.endDate) {
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${formatLocalDate(start)}`);
      lines.push(`DTEND;VALUE=DATE:${formatLocalDate(endDate)}`);
    } else {
      const end = ev.endDate
        ? new Date(ev.endDate)
        : new Date(start.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${formatUtc(start)}`);
      lines.push(`DTEND:${formatUtc(end)}`);
    }

    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(ev.title)}`));
    if (descriptionParts.length > 0) {
      lines.push(
        foldIcsLine(`DESCRIPTION:${escapeIcsText(descriptionParts.join(""))}`)
      );
    }
    if (locText) lines.push(foldIcsLine(`LOCATION:${escapeIcsText(locText)}`));
    if (loc?.lat != null && loc?.lng != null) {
      lines.push(`GEO:${loc.lat};${loc.lng}`);
    }
    if (ev.meetingUrl) lines.push(foldIcsLine(`URL:${escapeIcsText(ev.meetingUrl)}`));

    if (typeof ev.reminderMinutes === "number" && ev.reminderMinutes > 0) {
      lines.push("BEGIN:VALARM");
      lines.push("ACTION:DISPLAY");
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(ev.title)}`));
      lines.push(`TRIGGER:-PT${ev.reminderMinutes}M`);
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

icsFeedRouter.get("/api/ics/:token.ics", async (req: Request, res: Response) => {
  const token = String(req.params.token || "").trim();
  if (!token || token.length < 16) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  const user = await db.getUserByIcsFeedToken(token);
  if (!user) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  const events = await db.getCalendarEventsByUser(user.id);
  const body = buildIcs(events, user.id);

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'inline; filename="healing-studio-schedule.ics"'
  );
  // Phone calendars typically poll every 15-60 min; a short cache helps.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(body);
});
