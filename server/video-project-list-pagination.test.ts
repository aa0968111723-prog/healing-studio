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
import { escapeLikePattern, sliceVideoProjectsPage } from "./db";
import type { VideoProject } from "../drizzle/schema";

function mkProject(id: number): VideoProject {
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
    createdAt: new Date(),
    updatedAt: new Date(),
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

describe("AIDV-307 sliceVideoProjectsPage", () => {
  it("rows 多於 limit → 切掉多的一筆，nextCursor = 本頁最後一筆 id", () => {
    const rows = [mkProject(50), mkProject(40), mkProject(30)]; // limit=2 多取 1
    const page = sliceVideoProjectsPage(rows, 2);
    expect(page.items.map(p => p.id)).toEqual([50, 40]);
    expect(page.nextCursor).toBe(40);
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
