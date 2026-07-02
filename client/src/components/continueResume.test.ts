// @vitest-environment jsdom
/**
 * continueResume — AIDV-967 純函式窮盡測試
 * deriveResumeState(pathDoneIds, projects)：
 * - 路徑 slot：done=0 → null；1..4 → {done,5}；5 → null（已完成不用接）
 * - 專案 slot：draft/active 取 updatedAt 最新；completed/archived/isPending 排除
 * - 兩者皆無 → visible=false（真新手完全不渲染）
 * localStorage 讀寫：壞 JSON／非陣列／私密模式（throw）→ 安全降級
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { Project } from "@/types/projects";
import {
  BEGINNER_PATH_DONE_KEY,
  BEGINNER_PATH_STEP_IDS,
  BEGINNER_PATH_TOTAL,
  CONTINUE_CARD_DISMISS_KEY,
  deriveResumeState,
  readBeginnerPathDoneIds,
  readContinueCardDismissed,
  writeContinueCardDismissed,
} from "./continueResume";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "1",
    title: "測試專案",
    type: "video",
    status: "draft",
    progress: 20,
    currentStep: "剛建立",
    nextAction: "到導演工作室綁定世界觀",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("deriveResumeState — 路徑 slot", () => {
  it("done=0（空 ids）→ path null", () => {
    expect(deriveResumeState([], []).path).toBeNull();
  });

  it("只有未知步驟 id → 不計入，path null", () => {
    expect(deriveResumeState(["nope", "unknown-step"], []).path).toBeNull();
  });

  it("done=1..4 → path {done, 5}", () => {
    for (let n = 1; n < BEGINNER_PATH_TOTAL; n++) {
      const ids = BEGINNER_PATH_STEP_IDS.slice(0, n);
      const { path } = deriveResumeState(ids, []);
      expect(path).toEqual({ done: n, total: BEGINNER_PATH_TOTAL });
    }
  });

  it("done=5（全部完成）→ path null（不需要「接著上次」）", () => {
    expect(deriveResumeState([...BEGINNER_PATH_STEP_IDS], []).path).toBeNull();
  });

  it("重複 id 只算一次；未知 id 混入不影響", () => {
    const { path } = deriveResumeState(
      ["read-prompt", "read-prompt", "junk", "first-image"],
      [],
    );
    expect(path).toEqual({ done: 2, total: BEGINNER_PATH_TOTAL });
  });
});

describe("deriveResumeState — 專案 slot", () => {
  it("無專案 → project null", () => {
    expect(deriveResumeState([], []).project).toBeNull();
  });

  it("draft 專案 → 顯示 id/title/nextAction/progress", () => {
    const { project } = deriveResumeState([], [makeProject()]);
    expect(project).toEqual({
      id: "1",
      title: "測試專案",
      nextAction: "到導演工作室綁定世界觀",
      progress: 20,
    });
  });

  it("active 專案也算未完成", () => {
    const { project } = deriveResumeState(
      [],
      [makeProject({ status: "active" })],
    );
    expect(project?.id).toBe("1");
  });

  it("completed / archived 排除", () => {
    const { project } = deriveResumeState(
      [],
      [
        makeProject({ id: "c", status: "completed" }),
        makeProject({ id: "a", status: "archived" }),
      ],
    );
    expect(project).toBeNull();
  });

  it("樂觀 pending 臨時列排除（負數 id 尚無真實路由）", () => {
    const { project } = deriveResumeState(
      [],
      [makeProject({ id: "-123", isPending: true })],
    );
    expect(project).toBeNull();
  });

  it("多個可續編 → 取 updatedAt 最新", () => {
    const { project } = deriveResumeState(
      [],
      [
        makeProject({ id: "old", updatedAt: "2026-06-01T00:00:00.000Z" }),
        makeProject({ id: "new", updatedAt: "2026-06-20T00:00:00.000Z" }),
        makeProject({ id: "mid", updatedAt: "2026-06-10T00:00:00.000Z", status: "active" }),
      ],
    );
    expect(project?.id).toBe("new");
  });

  it("最新的是 completed → 退而取最新的可續編", () => {
    const { project } = deriveResumeState(
      [],
      [
        makeProject({ id: "done", status: "completed", updatedAt: "2026-06-30T00:00:00.000Z" }),
        makeProject({ id: "draft", updatedAt: "2026-06-05T00:00:00.000Z" }),
      ],
    );
    expect(project?.id).toBe("draft");
  });

  it("不改動傳入的 projects 陣列（順序不變）", () => {
    const list = [
      makeProject({ id: "b", updatedAt: "2026-06-02T00:00:00.000Z" }),
      makeProject({ id: "a", updatedAt: "2026-06-01T00:00:00.000Z" }),
      makeProject({ id: "c", updatedAt: "2026-06-03T00:00:00.000Z" }),
    ];
    deriveResumeState([], list);
    expect(list.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
});

describe("deriveResumeState — visible 組合", () => {
  it("全空（真新手）→ visible=false，兩 slot 皆 null", () => {
    expect(deriveResumeState([], [])).toEqual({
      visible: false,
      path: null,
      project: null,
    });
  });

  it("只有路徑進度 → visible=true, project null", () => {
    const s = deriveResumeState(["read-prompt"], []);
    expect(s.visible).toBe(true);
    expect(s.path).not.toBeNull();
    expect(s.project).toBeNull();
  });

  it("只有未完成專案 → visible=true, path null", () => {
    const s = deriveResumeState([], [makeProject()]);
    expect(s.visible).toBe(true);
    expect(s.path).toBeNull();
    expect(s.project).not.toBeNull();
  });

  it("路徑 5/5 但仍有 draft → 只剩專案 slot，仍 visible", () => {
    const s = deriveResumeState([...BEGINNER_PATH_STEP_IDS], [makeProject()]);
    expect(s.visible).toBe(true);
    expect(s.path).toBeNull();
    expect(s.project?.id).toBe("1");
  });

  it("路徑 5/5 且只有 completed 專案 → visible=false", () => {
    const s = deriveResumeState(
      [...BEGINNER_PATH_STEP_IDS],
      [makeProject({ status: "completed" })],
    );
    expect(s).toEqual({ visible: false, path: null, project: null });
  });

  it("兩者皆有 → 兩 slot 齊全", () => {
    const s = deriveResumeState(["read-prompt", "first-image"], [makeProject()]);
    expect(s.visible).toBe(true);
    expect(s.path).toEqual({ done: 2, total: BEGINNER_PATH_TOTAL });
    expect(s.project?.id).toBe("1");
  });
});

describe("localStorage 讀寫（私密模式安全）", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("readBeginnerPathDoneIds：未設定 → []", () => {
    expect(readBeginnerPathDoneIds()).toEqual([]);
  });

  it("readBeginnerPathDoneIds：正常陣列 → 過濾出字串", () => {
    window.localStorage.setItem(
      BEGINNER_PATH_DONE_KEY,
      JSON.stringify(["read-prompt", 42, null, "first-image"]),
    );
    expect(readBeginnerPathDoneIds()).toEqual(["read-prompt", "first-image"]);
  });

  it("readBeginnerPathDoneIds：壞 JSON → []", () => {
    window.localStorage.setItem(BEGINNER_PATH_DONE_KEY, "{not-json");
    expect(readBeginnerPathDoneIds()).toEqual([]);
  });

  it("readBeginnerPathDoneIds：非陣列 JSON → []", () => {
    window.localStorage.setItem(BEGINNER_PATH_DONE_KEY, '{"a":1}');
    expect(readBeginnerPathDoneIds()).toEqual([]);
  });

  it("readBeginnerPathDoneIds：getItem throw（私密模式）→ []", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readBeginnerPathDoneIds()).toEqual([]);
  });

  it("dismiss 記憶：write 後 read 為 true", () => {
    expect(readContinueCardDismissed()).toBe(false);
    writeContinueCardDismissed();
    expect(window.localStorage.getItem(CONTINUE_CARD_DISMISS_KEY)).toBe("1");
    expect(readContinueCardDismissed()).toBe(true);
  });

  it("dismiss 讀寫 throw（私密模式）→ 不拋錯、read 回 false", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeContinueCardDismissed()).not.toThrow();
    expect(readContinueCardDismissed()).toBe(false);
  });
});
