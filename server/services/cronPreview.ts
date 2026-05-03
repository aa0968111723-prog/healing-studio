/**
 * cronPreview — calculate the next fire times of a cron expression.
 * ────────────────────────────────────────────────────────────────────────────
 * node-cron only validates and runs cron expressions; it does not expose a
 * "next fire times" API. Hand-roll a small forward iterator so the
 * 代理設定 panel can show the user `Next 3 runs: 2026-04-30 09:00, ...`
 * before they save the schedule.
 *
 * Supports the standard 5-field POSIX cron form:
 *   minute(0-59) hour(0-23) dayOfMonth(1-31) month(1-12) dayOfWeek(0-6)
 * Each field accepts: `*`, exact `n`, range `a-b`, list `a,b,c`, step `*​/k`
 * or `a-b/k`. We treat day-of-month AND day-of-week as logical AND (matches
 * node-cron's behaviour for the practical schedules users hit).
 *
 * Timezone: cron expressions are interpreted as Asia/Taipei wall-clock time
 * (UTC+8, no DST). The actual scheduler also passes timezone: "Asia/Taipei"
 * to node-cron so the preview and the real fire times stay in lockstep.
 */

export const SCHEDULER_TIMEZONE = "Asia/Taipei";

// Asia/Taipei is a fixed UTC+8 zone (no DST), so we can do all the cron
// matching arithmetic against Date objects whose UTC fields represent
// Taipei wall-clock time, then translate back to true UTC at the end.
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function expandField(field: string, min: number, max: number): Set<number> | "ANY" {
  if (field === "*") return "ANY";
  const allowed = new Set<number>();
  for (const item of field.split(",")) {
    if (!item) continue;
    const [base, stepStr] = item.split("/");
    const step = stepStr ? Math.max(1, parseInt(stepStr, 10) || 1) : 1;
    let start: number;
    let end: number;
    if (base === "*" || base === "") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const [s, e] = base.split("-").map(n => parseInt(n, 10));
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      start = s;
      end = e;
    } else {
      const exact = parseInt(base, 10);
      if (Number.isNaN(exact)) continue;
      start = exact;
      end = stepStr ? max : exact;
    }
    if (start < min) start = min;
    if (end > max) end = max;
    for (let n = start; n <= end; n += step) allowed.add(n);
  }
  return allowed;
}

function matches(value: number, mask: Set<number> | "ANY"): boolean {
  return mask === "ANY" || mask.has(value);
}

export interface CronPreviewResult {
  ok: boolean;
  nextRuns: Date[];
  error?: string;
}

/**
 * Return the next `count` fire times for a 5-field cron expression starting
 * from `fromDate` (exclusive — we always advance at least one minute so
 * `nextFireTimes("* * * * *")` returns 1 minute, 2 minutes, 3 minutes from
 * now rather than echoing the start date).
 *
 * Returned `Date` objects are real UTC instants — call `.toISOString()` for
 * transport, or format with `timeZone: "Asia/Taipei"` for display.
 *
 * Returns `ok: false` and an `error` string for malformed input rather than
 * throwing, so the client can render the message inline.
 */
export function nextFireTimes(
  cron: string,
  count = 3,
  fromDate: Date = new Date()
): CronPreviewResult {
  const trimmed = cron.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      nextRuns: [],
      error: `cron 必須是 5 欄（分 時 日 月 週）— 收到 ${parts.length} 欄`,
    };
  }
  const minute = expandField(parts[0], 0, 59);
  const hour = expandField(parts[1], 0, 23);
  const dayOfMonth = expandField(parts[2], 1, 31);
  const month = expandField(parts[3], 1, 12);
  const dayOfWeek = expandField(parts[4], 0, 6);

  for (const [field, mask, name] of [
    [parts[0], minute, "minute"],
    [parts[1], hour, "hour"],
    [parts[2], dayOfMonth, "dayOfMonth"],
    [parts[3], month, "month"],
    [parts[4], dayOfWeek, "dayOfWeek"],
  ] as const) {
    if (mask !== "ANY" && mask.size === 0) {
      return { ok: false, nextRuns: [], error: `cron 第 ${name} 欄無效：${field}` };
    }
  }

  const result: Date[] = [];
  // Shift into Taipei wall-clock space: a Date whose UTC fields read as
  // Taipei local. From here we iterate using getUTC*/setUTC* and translate
  // each match back to a real UTC instant before returning.
  const cur = new Date(fromDate.getTime() + TAIPEI_OFFSET_MS);
  cur.setUTCSeconds(0, 0);
  cur.setUTCMinutes(cur.getUTCMinutes() + 1);

  // Cap the search at ~370 days. Yearly schedules (e.g. `0 0 1 1 *`) still
  // resolve within this window for any starting date.
  const cap = new Date(cur.getTime() + 370 * 24 * 60 * 60 * 1000);

  while (cur < cap && result.length < count) {
    if (!matches(cur.getUTCMonth() + 1, month)) {
      cur.setUTCMonth(cur.getUTCMonth() + 1, 1);
      cur.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (
      !matches(cur.getUTCDate(), dayOfMonth) ||
      !matches(cur.getUTCDay(), dayOfWeek)
    ) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      cur.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!matches(cur.getUTCHours(), hour)) {
      cur.setUTCHours(cur.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (matches(cur.getUTCMinutes(), minute)) {
      result.push(new Date(cur.getTime() - TAIPEI_OFFSET_MS));
    }
    cur.setUTCMinutes(cur.getUTCMinutes() + 1);
  }

  return { ok: true, nextRuns: result };
}

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: SCHEDULER_TIMEZONE,
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Format a UTC instant as a Taiwan wall-clock label, e.g.
 *   "05/04（週一）下午 09:00"
 * Used by the panel so the user sees the time in their own timezone
 * without the client doing any timezone math.
 */
export function formatTaipeiLabel(date: Date): string {
  // `formatToParts` lets us reorder regardless of locale-default arrangement
  // (zh-TW puts weekday first in some Node builds and last in others).
  const parts = TAIPEI_DATE_FMT.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(p => p.type === type)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const weekday = get("weekday");
  const hour = get("hour").padStart(2, "0");
  const minute = get("minute").padStart(2, "0");
  const dayPeriod = get("dayPeriod");
  return `${month}/${day}（${weekday}）${dayPeriod} ${hour}:${minute}`;
}

/**
 * Human-readable "in 4 小時 32 分" / "在 8 分鐘後" style relative label.
 * Returns "已過" if the target is in the past (which shouldn't happen for
 * preview output but guards against clock skew).
 */
export function formatRelativeFromNow(target: Date, now: Date = new Date()): string {
  let diff = Math.round((target.getTime() - now.getTime()) / 60000); // minutes
  if (diff < 0) return "已過";
  if (diff === 0) return "馬上";
  if (diff < 60) return `${diff} 分鐘後`;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  if (hours < 24) {
    return mins === 0 ? `${hours} 小時後` : `${hours} 小時 ${mins} 分後`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days} 天後` : `${days} 天 ${remHours} 小時後`;
}
