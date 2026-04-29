import { describe, expect, it } from "vitest";
import { nextFireTimes } from "../cronPreview";

describe("nextFireTimes", () => {
  it("returns 3 daily 09:00 runs starting from any time of day", () => {
    const from = new Date("2026-04-29T03:30:00");
    const result = nextFireTimes("0 9 * * *", 3, from);
    expect(result.ok).toBe(true);
    expect(result.nextRuns.map(d => d.toISOString())).toEqual([
      new Date("2026-04-29T09:00:00").toISOString(),
      new Date("2026-04-30T09:00:00").toISOString(),
      new Date("2026-05-01T09:00:00").toISOString(),
    ]);
  });

  it("respects weekday-only ranges (1-5 = Mon-Fri)", () => {
    // 2026-04-29 is a Wednesday. Asking for Mon-Fri 09:00 from 12:00 same day
    // should return Thu, Fri, Mon.
    const from = new Date("2026-04-29T12:00:00");
    const result = nextFireTimes("0 9 * * 1-5", 3, from);
    expect(result.ok).toBe(true);
    const dows = result.nextRuns.map(d => d.getDay());
    // dow 0=Sunday, 1=Monday, ... 6=Saturday
    expect(dows.every(dow => dow >= 1 && dow <= 5)).toBe(true);
    expect(result.nextRuns.length).toBe(3);
  });

  it("handles step expressions (*/15 every quarter hour)", () => {
    const from = new Date("2026-04-29T10:07:00");
    const result = nextFireTimes("*/15 * * * *", 3, from);
    expect(result.ok).toBe(true);
    expect(result.nextRuns.map(d => d.getMinutes())).toEqual([15, 30, 45]);
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
