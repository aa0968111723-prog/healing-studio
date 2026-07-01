/**
 * server/video-project-list-pagination.test.ts — AIDV-307
 *
 * 釘住游標分頁的兩個風險點（純函式，無需 live MySQL）：
 *   1. escapeLikePattern：使用者搜尋字串的 MySQL LIKE 萬用字元跳脫，
 *      避免「%」「_」被當萬用字元造成誤命中。
 *   2. sliceVideoProjectsPage：「多取一筆」判斷 hasMore / nextCursor 的邊界，
 *      剛好 limit 筆、超過一筆、空集合三種情況。
 */
import { describe, it, expect } from "vitest";
import {
  escapeLikePattern,
  sliceVideoProjectsPage,
  encodeVideoProjectCursor,
  decodeVideoProjectCursor,
} from "./db";
import type { VideoProject } from "../drizzle/schema";

// AIDV-576：updatedAt 固定可控，便於斷言複合游標 `${updatedAtMs}_${id}`。
function mkProject(id: number, updatedAtMs = 1_700_000_000_000 + id * 1000): VideoProject {
  return {
    id,
    userId: 7,
    creativeProjectId: null,
    title: `影片${id}`,
    aspectRatio: "16:9",
    outputSpec: null,
    version: 0,
    deadlineAt: null,
    priorityClass: "standard",
    createdAt: new Date(updatedAtMs),
    updatedAt: new Date(updatedAtMs),
  } as VideoProject;
}

describe("AIDV-307 escapeLikePattern", () => {
  it("跳脫 % _ \\ 萬用字元", () => {
    expect(escapeLikePattern("a%b")).toBe("a\\%b");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("100%_test\\")).toBe("100\\%\\_test\\\\");
  });

  it("一般字元（含中文）不受影響", () => {
    expect(escapeLikePattern("品牌影片")).toBe("品牌影片");
    expect(escapeLikePattern("brand video")).toBe("brand video");
  });
});

describe("AIDV-307/576 sliceVideoProjectsPage", () => {
  it("rows 多於 limit → 切掉多的一筆，nextCursor = 本頁最後一筆的複合游標 (updatedAt,id)", () => {
    const rows = [mkProject(50), mkProject(40), mkProject(30)]; // limit=2 多取 1
    const page = sliceVideoProjectsPage(rows, 2);
    expect(page.items.map(p => p.id)).toEqual([50, 40]);
    // 本頁最後一筆 id=40 → 游標需同時帶其 updatedAt，純 id 不足以做穩定邊界（AIDV-576）
    expect(page.nextCursor).toBe(encodeVideoProjectCursor(mkProject(40)));
    expect(decodeVideoProjectCursor(page.nextCursor)).toEqual({
      updatedAtMs: 1_700_000_000_000 + 40 * 1000,
      id: 40,
    });
  });

  it("rows 剛好等於 limit → 無下一頁，nextCursor=null", () => {
    const rows = [mkProject(50), mkProject(40)];
    const page = sliceVideoProjectsPage(rows, 2);
    expect(page.items.map(p => p.id)).toEqual([50, 40]);
    expect(page.nextCursor).toBeNull();
  });

  it("rows 少於 limit → 全回傳，nextCursor=null", () => {
    const rows = [mkProject(50)];
    const page = sliceVideoProjectsPage(rows, 20);
    expect(page.items.map(p => p.id)).toEqual([50]);
    expect(page.nextCursor).toBeNull();
  });

  it("空集合 → items 空、nextCursor=null", () => {
    const page = sliceVideoProjectsPage([], 20);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("AIDV-576 video project 複合游標 codec", () => {
  it("encode → decode 往返保真 (updatedAt 毫秒 + id)", () => {
    const p = mkProject(42, 1_711_000_000_000);
    const raw = encodeVideoProjectCursor(p);
    expect(raw).toBe("1711000000000_42");
    expect(decodeVideoProjectCursor(raw)).toEqual({ updatedAtMs: 1_711_000_000_000, id: 42 });
  });

  it("encode 接受 Date 或可轉 Date 的 updatedAt", () => {
    expect(encodeVideoProjectCursor({ updatedAt: new Date(1000), id: 3 })).toBe("1000_3");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["空字串", ""],
    ["缺 id", "1700000000000"],
    ["缺 updatedAt", "_42"],
    ["非數字", "abc_def"],
    ["負 id", "1700000000000_-5"],
    ["id=0", "1700000000000_0"],
    ["多餘分隔", "1700_42_9"],
  ])("decode 格式不符（%s）回 null＝視為第一頁", (_label, raw) => {
    expect(decodeVideoProjectCursor(raw as string | null | undefined)).toBeNull();
  });
});
