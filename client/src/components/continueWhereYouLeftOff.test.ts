// @vitest-environment jsdom
/**
 * AIDV-967 — deriveResumeState 純函式窮盡測試 + localStorage 讀寫安全測試。
 *
 * 驗收條件：
 * - 全空（真新手）→ visible=false（元件層據此完全不渲染）。
 * - 路徑 slot：0 < doneCount < 5 才出現；0（沒開始）與 5（已完成）都不出現；
 *   越界／非有限值夾回 [0, 5]。
 * - 專案 slot：只取「未完成」（draft/active），排除 isPending 樂觀臨時列，
 *   多個未完成取 updatedAt 最新；目的地對齊 AIDV-961（/projects/:id）。
 * - localStorage 讀寫全部私密模式安全（getItem/setItem 擲例外不炸）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { Project } from "@/types/projects";
import {
  BEGINNER_PATH_HREF,
  BEGINNER_PATH_LS_KEY,
  BEGINNER_PATH_TOTAL,
  DISMISS_LS_KEY,
  deriveResumeState,
  readBeginnerPathDoneCount,
  readDismissed,
  writeDismissed,
} from "./continueWhereYouLeftOff";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "1",
    title: "測試專案",
    type: "video",
    status: "draft",
    progress: 10,
    currentStep: "分鏡到一半",
    nextAction: "回導演工作室補分鏡。",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("deriveResumeState — 顯示條件（AIDV-967）", () => {
  it("全空（真新手）→ 兩 slot 皆 null、visible=false", () => {
    const s = deriveResumeState(0, []);
    expect(s.path).toBeNull();
    expect(s.project).toBeNull();
    expect(s.visible).toBe(false);
  });

  it("只有路徑進度 → 只有路徑 slot、visible=true", () => {
    const s = deriveResumeState(2, []);
    expect(s.path).toEqual({
      doneCount: 2,
      total: BEGINNER_PATH_TOTAL,
      href: BEGINNER_PATH_HREF,
    });
    expect(s.project).toBeNull();
    expect(s.visible).toBe(true);
  });

  it("只有未完成專案 → 只有專案 slot、visible=true", () => {
    const s = deriveResumeState(0, [makeProject({ id: "7" })]);
    expect(s.path).toBeNull();
    expect(s.project).toMatchObject({ id: "7", href: "/projects/7" });
    expect(s.visible).toBe(true);
  });

  it("兩者都有 → 兩 slot 同時出現", () => {
    const s = deriveResumeState(3, [makeProject()]);
    expect(s.path).not.toBeNull();
    expect(s.project).not.toBeNull();
    expect(s.visible).toBe(true);
  });
});

describe("deriveResumeState — 路徑 slot 邊界", () => {
  it.each([1, 2, 3, 4])("doneCount=%i（0<x<5）→ 顯示對應進度", n => {
    expect(deriveResumeState(n, []).path?.doneCount).toBe(n);
  });

  it("doneCount=0（沒開始）→ 不顯示路徑 slot", () => {
    expect(deriveResumeState(0, []).path).toBeNull();
  });

  it("doneCount=5（已完成）→ 不顯示路徑 slot（沒有可接續的下一步）", () => {
    expect(deriveResumeState(5, []).path).toBeNull();
  });

  it("負數 → 夾回 0 → 不顯示", () => {
    expect(deriveResumeState(-3, []).path).toBeNull();
  });

  it("超過 5 → 夾回 5 → 不顯示", () => {
    expect(deriveResumeState(99, []).path).toBeNull();
  });

  it("非整數 → floor（2.9 → 2）", () => {
    expect(deriveResumeState(2.9, []).path?.doneCount).toBe(2);
  });

  it("NaN / Infinity → 視為 0 → 不顯示", () => {
    expect(deriveResumeState(Number.NaN, []).path).toBeNull();
    expect(deriveResumeState(Number.POSITIVE_INFINITY, []).path).toBeNull();
  });
});

describe("deriveResumeState — 專案 slot 篩選", () => {
  it("draft 與 active 都算未完成", () => {
    expect(deriveResumeState(0, [makeProject({ status: "draft" })]).project).not.toBeNull();
    expect(deriveResumeState(0, [makeProject({ status: "active" })]).project).not.toBeNull();
  });

  it("completed / archived 不算 → slot 為 null", () => {
    const s = deriveResumeState(0, [
      makeProject({ id: "1", status: "completed" }),
      makeProject({ id: "2", status: "archived" }),
    ]);
    expect(s.project).toBeNull();
    expect(s.visible).toBe(false);
  });

  it("排除 isPending 樂觀臨時列（負數 id 導頁會 404）", () => {
    const s = deriveResumeState(0, [
      makeProject({ id: "-1755", isPending: true }),
    ]);
    expect(s.project).toBeNull();
  });

  it("多個未完成 → 取 updatedAt 最新", () => {
    const s = deriveResumeState(0, [
      makeProject({ id: "old", updatedAt: "2026-05-01T00:00:00.000Z" }),
      makeProject({ id: "new", updatedAt: "2026-06-20T00:00:00.000Z" }),
      makeProject({ id: "mid", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(s.project?.id).toBe("new");
  });

  it("較新的 completed 不會蓋過較舊的未完成", () => {
    const s = deriveResumeState(0, [
      makeProject({ id: "done", status: "completed", updatedAt: "2026-06-30T00:00:00.000Z" }),
      makeProject({ id: "wip", status: "draft", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ]);
    expect(s.project?.id).toBe("wip");
  });

  it("slot 內容：title / nextAction 透傳、href 對齊 AIDV-961 的 /projects/:id", () => {
    const s = deriveResumeState(0, [
      makeProject({ id: "42", title: "療癒短片", nextAction: "去補配音。" }),
    ]);
    expect(s.project).toEqual({
      id: "42",
      title: "療癒短片",
      nextAction: "去補配音。",
      href: "/projects/42",
    });
  });
});

describe("readBeginnerPathDoneCount — localStorage 讀取安全", () => {
  it("key 不存在 → 0", () => {
    expect(readBeginnerPathDoneCount()).toBe(0);
  });

  it("正常陣列 → 去重計數並夾在 5 以內", () => {
    window.localStorage.setItem(
      BEGINNER_PATH_LS_KEY,
      JSON.stringify(["a", "b", "a"]),
    );
    expect(readBeginnerPathDoneCount()).toBe(2);
    window.localStorage.setItem(
      BEGINNER_PATH_LS_KEY,
      JSON.stringify(["a", "b", "c", "d", "e", "f", "g"]),
    );
    expect(readBeginnerPathDoneCount()).toBe(5);
  });

  it("非字串元素被過濾", () => {
    window.localStorage.setItem(
      BEGINNER_PATH_LS_KEY,
      JSON.stringify(["a", 1, null, { x: 1 }]),
    );
    expect(readBeginnerPathDoneCount()).toBe(1);
  });

  it("壞 JSON / 非陣列 → 0", () => {
    window.localStorage.setItem(BEGINNER_PATH_LS_KEY, "{oops");
    expect(readBeginnerPathDoneCount()).toBe(0);
    window.localStorage.setItem(BEGINNER_PATH_LS_KEY, JSON.stringify({ a: 1 }));
    expect(readBeginnerPathDoneCount()).toBe(0);
  });

  it("私密模式（getItem 擲例外）→ 0，不炸", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readBeginnerPathDoneCount()).toBe(0);
  });
});

describe("readDismissed / writeDismissed — 關閉記憶", () => {
  it("預設未關閉；寫入後記住", () => {
    expect(readDismissed()).toBe(false);
    writeDismissed();
    expect(window.localStorage.getItem(DISMISS_LS_KEY)).toBe("1");
    expect(readDismissed()).toBe(true);
  });

  it("私密模式（getItem/setItem 擲例外）→ 讀回 false、寫入不炸", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(readDismissed()).toBe(false);
    expect(() => writeDismissed()).not.toThrow();
  });
});
