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
 */

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
  const cur = new Date(fromDate);
  cur.setSeconds(0, 0);
  cur.setMinutes(cur.getMinutes() + 1);

  // Cap the search at ~370 days. Yearly schedules (e.g. `0 0 1 1 *`) still
  // resolve within this window for any starting date.
  const cap = new Date(cur.getTime() + 370 * 24 * 60 * 60 * 1000);

  while (cur < cap && result.length < count) {
    if (!matches(cur.getMonth() + 1, month)) {
      cur.setMonth(cur.getMonth() + 1, 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }
    if (
      !matches(cur.getDate(), dayOfMonth) ||
      !matches(cur.getDay(), dayOfWeek)
    ) {
      cur.setDate(cur.getDate() + 1);
      cur.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matches(cur.getHours(), hour)) {
      cur.setHours(cur.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (matches(cur.getMinutes(), minute)) {
      result.push(new Date(cur));
    }
    cur.setMinutes(cur.getMinutes() + 1);
  }

  return { ok: true, nextRuns: result };
}
