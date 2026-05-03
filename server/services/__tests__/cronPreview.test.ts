import { describe, expect, it } from "vitest";
import {
  describeCron,
  formatRelativeFromNow,
  formatTaipeiLabel,
  nextFireTimes,
} from "../cronPreview";

// Helper: format an instant as Taipei wall-clock yyyy-mm-dd HH:MM, useful
// for assertions that don't care about the exact label format.
function taipeiYmdHm(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

describe("nextFireTimes (Asia/Taipei)", () => {
  it("returns 3 daily 09:00 Taiwan-time runs starting from any time of day", () => {
    // 2026-04-29 03:30 Taipei == 2026-04-28 19:30 UTC
    const from = new Date("2026-04-28T19:30:00Z");
    const result = nextFireTimes("0 9 * * *", 3, from);
    expect(result.ok).toBe(true);
    expect(result.nextRuns.map(taipeiYmdHm)).toEqual([
      "2026-04-29, 09:00",
      "2026-04-30, 09:00",
      "2026-05-01, 09:00",
    ]);
  });

  it("interprets hour-of-day as Taipei wall-clock, not UTC", () => {
    // The bug from the screenshots: cron `0 12 * * *` was firing at 12:00 UTC
    // (= 20:00 Taipei). It must fire at 12:00 Taipei (= 04:00 UTC).
    const from = new Date("2026-05-03T00:00:00Z");
    const result = nextFireTimes("0 12 * * *", 3, from);
    expect(result.ok).toBe(true);
    // Each instant must be 12:00 in Taipei
    for (const d of result.nextRuns) {
      expect(taipeiYmdHm(d).slice(-5)).toBe("12:00");
    }
    // First run: 2026-05-03 12:00 Taipei == 2026-05-03 04:00 UTC
    expect(result.nextRuns[0].toISOString()).toBe("2026-05-03T04:00:00.000Z");
  });

  it("interprets `0 21 * * *` as 21:00 Taipei (== 13:00 UTC)", () => {
    const from = new Date("2026-05-03T00:00:00Z");
    const result = nextFireTimes("0 21 * * *", 3, from);
    expect(result.ok).toBe(true);
    expect(result.nextRuns[0].toISOString()).toBe("2026-05-03T13:00:00.000Z");
    expect(result.nextRuns[1].toISOString()).toBe("2026-05-04T13:00:00.000Z");
  });

  it("respects weekday-only ranges (1-5 = Mon-Fri) in Taipei calendar", () => {
    // Wed 2026-04-29 12:00 Taipei
    const from = new Date("2026-04-29T04:00:00Z");
    const result = nextFireTimes("0 9 * * 1-5", 3, from);
    expect(result.ok).toBe(true);
    expect(result.nextRuns.length).toBe(3);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
    });
    const dows = result.nextRuns.map(d => fmt.format(d));
    for (const dow of dows) {
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(dow);
    }
  });

  it("handles step expressions (*/15 every quarter hour)", () => {
    // 10:07 Taipei == 02:07 UTC
    const from = new Date("2026-04-29T02:07:00Z");
    const result = nextFireTimes("*/15 * * * *", 3, from);
    expect(result.ok).toBe(true);
    const minutes = result.nextRuns.map(d =>
      Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Taipei",
          minute: "2-digit",
        }).format(d)
      )
    );
    expect(minutes).toEqual([15, 30, 45]);
  });

  it("rejects malformed cron expressions with a helpful message", () => {
    const result = nextFireTimes("not a cron", 3);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects cron with wrong number of fields", () => {
    const result = nextFireTimes("0 9 *", 3);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/5 欄/);
  });
});

describe("formatTaipeiLabel", () => {
  it("renders a Taiwan wall-clock date with weekday + AM/PM", () => {
    // 2026-05-04 21:00 Taipei == 2026-05-04 13:00 UTC, weekday Mon
    const label = formatTaipeiLabel(new Date("2026-05-04T13:00:00Z"));
    expect(label).toMatch(/^05\/04（週一）/);
    expect(label).toMatch(/(下午|晚上|PM)/);
    expect(label).toContain("09:00");
  });

  it("uses Taipei calendar for the date even when UTC is the previous day", () => {
    // 2026-05-04 01:00 Taipei == 2026-05-03 17:00 UTC
    const label = formatTaipeiLabel(new Date("2026-05-03T17:00:00Z"));
    expect(label.startsWith("05/04")).toBe(true);
  });
});

describe("describeCron", () => {
  it("describes the daily morning preset", () => {
    expect(describeCron("0 9 * * *")).toBe("每天 早上 09:00 執行（台灣時間）");
  });
  it("describes daily noon as 中午", () => {
    expect(describeCron("0 12 * * *")).toBe("每天 中午 12:00 執行（台灣時間）");
  });
  it("describes daily evening as 晚上", () => {
    expect(describeCron("0 21 * * *")).toBe("每天 晚上 09:00 執行（台灣時間）");
  });
  it("describes weekday-only ranges", () => {
    expect(describeCron("0 9 * * 1-5")).toBe(
      "工作日（週一至週五）早上 09:00 執行（台灣時間）"
    );
  });
  it("describes a single weekday", () => {
    // 18:00 falls in the 傍晚 bucket (18-20) per describePeriod.
    expect(describeCron("0 18 * * 5")).toBe(
      "每週五 傍晚 06:00 執行（台灣時間）"
    );
  });
  it("describes monthly schedules", () => {
    expect(describeCron("0 9 1 * *")).toBe(
      "每月 1 號 早上 09:00 執行（台灣時間）"
    );
  });
  it("describes step expressions", () => {
    expect(describeCron("*/30 * * * *")).toBe("每 30 分鐘執行（台灣時間）");
    expect(describeCron("* * * * *")).toBe("每分鐘執行（台灣時間）");
  });
  it("describes hourly minute markers", () => {
    expect(describeCron("0 * * * *")).toBe(
      "每小時的第 0 分鐘執行（台灣時間）"
    );
  });
  it("falls back for shapes it can't summarise", () => {
    expect(describeCron("15,45 * * * *")).toBe(
      "依 cron 規則 `15,45 * * * *` 執行（台灣時間）"
    );
  });
  it("flags malformed input", () => {
    expect(describeCron("not a cron")).toMatch(/格式不正確|cron/);
  });
});

describe("formatRelativeFromNow", () => {
  const now = new Date("2026-05-04T00:00:00Z");
  it("shows minute granularity under 1 hour", () => {
    expect(formatRelativeFromNow(new Date("2026-05-04T00:30:00Z"), now)).toBe(
      "30 分鐘後"
    );
  });
  it("shows hours+minutes under a day", () => {
    expect(formatRelativeFromNow(new Date("2026-05-04T04:15:00Z"), now)).toBe(
      "4 小時 15 分後"
    );
  });
  it("shows days for multi-day distances", () => {
    expect(formatRelativeFromNow(new Date("2026-05-06T00:00:00Z"), now)).toBe(
      "2 天後"
    );
  });
  it("clamps past times to 已過", () => {
    expect(formatRelativeFromNow(new Date("2026-05-03T23:00:00Z"), now)).toBe(
      "已過"
    );
  });
});
