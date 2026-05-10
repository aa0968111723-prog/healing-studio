import { describe, expect, it } from "vitest";
import {
  buildIcsFeed,
  escapeIcsText,
  foldIcsLine,
  isAllDaySchedule,
  type ExportableScheduleNote,
} from "./services/icsExport";

const STAMP = new Date("2026-05-10T00:00:00.000Z");

describe("foldIcsLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldIcsLine("SUMMARY:hello")).toBe("SUMMARY:hello");
  });

  it("folds an ASCII line that crosses 75 octets", () => {
    const line = "SUMMARY:" + "x".repeat(80);
    const folded = foldIcsLine(line);
    expect(folded).toContain("\r\n ");
    // First physical line must be ≤ 75 octets.
    const [first] = folded.split("\r\n ");
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(75);
    // Round-trip: unfolding (drop CRLF + leading SP) gives back the original.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("never splits inside a multi-byte UTF-8 sequence (Chinese)", () => {
    // Each 中文 codepoint is 3 UTF-8 bytes; 40 of them = 120 bytes which
    // forces folding even though the JS string length is only 48 chars.
    const cjk = "心".repeat(40);
    const line = `SUMMARY:${cjk}`;
    const folded = foldIcsLine(line);
    expect(folded).toContain("\r\n ");
    // Every physical line must be valid UTF-8 (each segment, including the
    // leading SP on continuations, ≤ 75 octets).
    const segments = folded.split("\r\n");
    for (const seg of segments) {
      expect(Buffer.byteLength(seg, "utf8")).toBeLessThanOrEqual(75);
    }
    // No segment may end mid-codepoint: re-joining + decoding round-trips.
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("budgets 1 byte for the leading SP on continuation lines", () => {
    // 75 ASCII chars → fits exactly; 76 → must fold once with first chunk
    // staying ≤ 75 and second chunk ≤ 74 bytes (because it carries a SP).
    const line = "x".repeat(76);
    const folded = foldIcsLine(line);
    const [first, ...rest] = folded.split("\r\n ");
    expect(Buffer.byteLength(first, "utf8")).toBeLessThanOrEqual(75);
    for (const cont of rest) {
      // The leading SP is implied by the fold marker; the *content* on the
      // continuation line plus that SP must stay within 75 octets total,
      // i.e. content alone ≤ 74.
      expect(Buffer.byteLength(cont, "utf8")).toBeLessThanOrEqual(74);
    }
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash before any other replacement", () => {
    expect(escapeIcsText("a\\b")).toBe("a\\\\b");
  });
  it("escapes commas, semicolons and newlines per RFC 5545", () => {
    expect(escapeIcsText("a,b;c\nd\r\ne")).toBe("a\\,b\\;c\\nd\\ne");
  });
});

describe("isAllDaySchedule", () => {
  it("returns true only for exact midnight local", () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    expect(isAllDaySchedule(midnight)).toBe(true);
    const tenAm = new Date();
    tenAm.setHours(10, 0, 0, 0);
    expect(isAllDaySchedule(tenAm)).toBe(false);
    const oneSec = new Date();
    oneSec.setHours(0, 0, 1, 0);
    expect(isAllDaySchedule(oneSec)).toBe(false);
  });
});

function makeNote(over: Partial<ExportableScheduleNote> = {}): ExportableScheduleNote {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return {
    id: 1,
    title: "創作排程",
    content: null,
    scheduledDate: midnight,
    status: "todo",
    tags: null,
    ...over,
  };
}

describe("buildIcsFeed", () => {
  it("emits a valid VCALENDAR header + footer with CRLF line endings", () => {
    const ics = buildIcsFeed([], { now: STAMP });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("\r\nVERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//HealingStudio//Notes//EN");
  });

  it("uses VALUE=DATE for midnight schedules so they render as all-day", () => {
    const midnight = new Date(2026, 4, 12, 0, 0, 0, 0); // local midnight
    const ics = buildIcsFeed([makeNote({ scheduledDate: midnight })], {
      now: STAMP,
    });
    // YYYYMMDD in the user's local timezone — never with a 'T' time component.
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20260512\b/);
    // DTEND is exclusive: next day.
    expect(ics).toMatch(/DTEND;VALUE=DATE:20260513\b/);
    // No timed DTSTART/DTEND alongside.
    expect(ics).not.toMatch(/^DTSTART:\d{8}T/m);
  });

  it("emits timed DTSTART/DTEND with a one-hour block for non-midnight slots", () => {
    const tenAm = new Date(2026, 4, 12, 10, 0, 0, 0);
    const ics = buildIcsFeed([makeNote({ scheduledDate: tenAm })], {
      now: STAMP,
    });
    expect(ics).toMatch(/^DTSTART:\d{8}T\d{6}Z$/m);
    expect(ics).toMatch(/^DTEND:\d{8}T\d{6}Z$/m);
    expect(ics).not.toMatch(/DTSTART;VALUE=DATE:/);
  });

  it("escapes commas / newlines in summary and description", () => {
    const tenAm = new Date(2026, 4, 12, 10, 0, 0, 0);
    const ics = buildIcsFeed(
      [
        makeNote({
          title: "Hello, World",
          content: "line1\nline2",
          scheduledDate: tenAm,
        }),
      ],
      { now: STAMP }
    );
    expect(ics).toContain("SUMMARY:Hello\\, World");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });

  it("folds long Chinese summaries without splitting mid-codepoint", () => {
    const tenAm = new Date(2026, 4, 12, 10, 0, 0, 0);
    const longTitle = "深度研究筆記用於規劃整個季度的創作流程".repeat(3);
    const ics = buildIcsFeed(
      [makeNote({ title: longTitle, scheduledDate: tenAm })],
      { now: STAMP }
    );
    // Pull just the SUMMARY line(s) and make sure each physical line is valid UTF-8 ≤ 75 octets.
    const summaryBlock = ics
      .split("\r\n")
      .reduce<string[]>((acc, line, idx, arr) => {
        if (line.startsWith("SUMMARY:")) {
          const block = [line];
          for (let i = idx + 1; i < arr.length; i += 1) {
            if (arr[i].startsWith(" ")) block.push(arr[i]);
            else break;
          }
          return block;
        }
        return acc;
      }, []);
    expect(summaryBlock.length).toBeGreaterThan(1);
    for (const seg of summaryBlock) {
      expect(Buffer.byteLength(seg, "utf8")).toBeLessThanOrEqual(75);
    }
    // Unfold round-trip recovers the original payload.
    const unfolded = summaryBlock
      .map((seg, i) => (i === 0 ? seg : seg.slice(1)))
      .join("");
    expect(unfolded).toBe(`SUMMARY:${longTitle}`);
  });

  it("maps statuses to STATUS + X-HEALING-STUDIO-STATUS values", () => {
    const tenAm = new Date(2026, 4, 12, 10, 0, 0, 0);
    const cases: Array<{
      status: ExportableScheduleNote["status"];
      ical: string;
      x: string;
    }> = [
      { status: "todo", ical: "TENTATIVE", x: "NEEDS-ACTION" },
      { status: "in_progress", ical: "TENTATIVE", x: "IN-PROCESS" },
      { status: "done", ical: "CONFIRMED", x: "COMPLETED" },
    ];
    for (const c of cases) {
      const ics = buildIcsFeed(
        [makeNote({ status: c.status, scheduledDate: tenAm })],
        { now: STAMP }
      );
      expect(ics).toContain(`STATUS:${c.ical}`);
      expect(ics).toContain(`X-HEALING-STUDIO-STATUS:${c.x}`);
    }
  });

  it("appends tags as inline #hashtags inside DESCRIPTION", () => {
    const tenAm = new Date(2026, 4, 12, 10, 0, 0, 0);
    const ics = buildIcsFeed(
      [
        makeNote({
          title: "T",
          content: "body",
          tags: ["alpha", "beta"],
          scheduledDate: tenAm,
        }),
      ],
      { now: STAMP }
    );
    expect(ics).toMatch(/DESCRIPTION:body\\n\\n#alpha #beta/);
  });

  it("skips entries whose scheduledDate is invalid", () => {
    const ics = buildIcsFeed(
      [makeNote({ scheduledDate: new Date("not a date") })],
      { now: STAMP }
    );
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
