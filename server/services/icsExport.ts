/**
 * icsExport.ts — Build a RFC 5545–compliant iCalendar feed from project notes.
 *
 * Two correctness details that mainstream calendar apps (Apple Calendar,
 * Outlook, Notion Calendar, Fantastical, Google Calendar import) actually
 * enforce in the wild:
 *
 * 1. **Line folding is by OCTET**, not codepoint. RFC 5545 §3.1 caps each
 *    physical line at 75 octets excluding the line break; long lines are
 *    folded by inserting CRLF + a single SP. JavaScript's `string.length`
 *    counts UTF-16 code units, so a 75-character Chinese title is ~225
 *    UTF-8 bytes — strict parsers reject the resulting line. We walk
 *    codepoints (so multi-byte sequences never split mid-byte) and budget
 *    75 bytes for the first segment but 74 for continuations (the leading
 *    SP on the wrapped line counts toward the octet limit).
 *
 * 2. **All-day events use VALUE=DATE**, not midnight datetimes. RFC 5545
 *    §3.6.1: a day-only event is `DTSTART;VALUE=DATE:YYYYMMDD` with the
 *    DTEND being the *exclusive* next day. If we always emit
 *    `DTSTART:YYYYMMDDT000000Z` + `DTEND = start + 1h`, importers render
 *    the entry as a 1-hour midnight slot — visibly broken on iOS Calendar.
 */

export interface ExportableScheduleNote {
  id: number;
  title: string;
  content?: string | null;
  scheduledDate: Date | string;
  status?: "todo" | "in_progress" | "done" | null;
  tags?: string[] | null;
}

export interface BuildIcsOptions {
  /** Calendar name shown in calendar apps that honour X-WR-CALNAME. */
  calendarName?: string;
  /** Stamp written to every VEVENT's DTSTAMP; defaults to "now". */
  now?: Date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

const fmtUtc = (d: Date) =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const fmtLocalDate = (d: Date) =>
  `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

const utf8Len = (s: string) =>
  typeof Buffer !== "undefined"
    ? Buffer.byteLength(s, "utf8")
    : new TextEncoder().encode(s).length;

/**
 * RFC 5545 §3.3.11 escape: order matters — `\\` must be substituted first
 * so we don't double-escape the backslashes we just inserted.
 */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Fold a single content line so each physical line stays ≤ 75 octets.
 * Splits between codepoints, never inside a multi-byte UTF-8 sequence.
 */
export function foldIcsLine(line: string): string {
  if (utf8Len(line) <= 75) return line;
  const parts: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  let isFirst = true;
  for (const ch of line) {
    const chBytes = utf8Len(ch);
    // Continuations carry a leading SP that itself eats one octet.
    const limit = isFirst ? 75 : 74;
    if (chunkBytes + chBytes > limit) {
      parts.push(chunk);
      chunk = ch;
      chunkBytes = chBytes;
      isFirst = false;
    } else {
      chunk += ch;
      chunkBytes += chBytes;
    }
  }
  if (chunk) parts.push(chunk);
  return parts.join("\r\n ");
}

/**
 * A scheduledDate is treated as "all-day" when stored as exact midnight
 * local time. Matches what NewEventForm + the drag-to-date / 排到今天 paths
 * persist when no HH:mm is selected.
 */
export function isAllDaySchedule(d: Date): boolean {
  return (
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  );
}

export function buildIcsFeed(
  notes: ExportableScheduleNote[],
  options: BuildIcsOptions = {}
): string {
  const calendarName = options.calendarName ?? "Healing Studio 創作排程";
  const stampDate = options.now ?? new Date();
  const dtStamp = fmtUtc(stampDate);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HealingStudio//Notes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldIcsLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
  ];

  for (const n of notes) {
    const start =
      n.scheduledDate instanceof Date
        ? n.scheduledDate
        : new Date(n.scheduledDate);
    if (Number.isNaN(start.getTime())) continue;

    const status = n.status ?? "todo";
    const xStatus =
      status === "done"
        ? "COMPLETED"
        : status === "in_progress"
          ? "IN-PROCESS"
          : "NEEDS-ACTION";

    const desc =
      (n.content ?? "") +
      (n.tags && n.tags.length ? `\n\n#${n.tags.join(" #")}` : "");

    lines.push(
      "BEGIN:VEVENT",
      `UID:healing-studio-note-${n.id}@healing-studio`,
      `DTSTAMP:${dtStamp}`
    );

    if (isAllDaySchedule(start)) {
      const endDate = new Date(start);
      endDate.setDate(endDate.getDate() + 1);
      lines.push(
        `DTSTART;VALUE=DATE:${fmtLocalDate(start)}`,
        `DTEND;VALUE=DATE:${fmtLocalDate(endDate)}`
      );
    } else {
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      lines.push(`DTSTART:${fmtUtc(start)}`, `DTEND:${fmtUtc(end)}`);
    }

    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(n.title)}`));
    if (desc.trim()) {
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(desc)}`));
    }
    lines.push(
      `STATUS:${status === "done" ? "CONFIRMED" : "TENTATIVE"}`,
      `X-HEALING-STUDIO-STATUS:${xStatus}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
