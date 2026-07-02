/**
 * segmentProgress — AIDV-589 分段 SSE 進度純函式測試
 *
 * 窮盡矩陣：正常序、亂序、重複、缺欄位、0 段、單一分段、clamp、
 * 型別汙染輸入、永不 throw、reference 穩定性、格式化。
 */
import { describe, it, expect } from "vitest";
import {
  applySegmentEvent,
  deriveSegmentProgressFromJobMeta,
  formatSegmentProgress,
  isSegmentEventType,
  type SegmentProgressState,
} from "./segmentProgress";

const started = (segmentIndex: unknown, of: unknown, extra: Record<string, unknown> = {}) => ({
  type: "segment_started",
  segmentId: `seg-${String(segmentIndex)}`,
  segmentIndex,
  of,
  stage: "video",
  userId: 1,
  at: Date.now(),
  ...extra,
});

const completed = (segmentIndex: unknown, of: unknown, extra: Record<string, unknown> = {}) => ({
  type: "segment_completed",
  segmentId: `seg-${String(segmentIndex)}`,
  segmentIndex,
  of,
  stage: "video",
  duration_ms: 1234,
  userId: 1,
  at: Date.now(),
  ...extra,
});

const state = (
  currentSegment: number,
  totalSegments: number,
  isCompleted: boolean
): SegmentProgressState => ({ currentSegment, totalSegments, completed: isCompleted });

describe("isSegmentEventType (AIDV-589)", () => {
  it("只認 segment_started / segment_completed", () => {
    expect(isSegmentEventType("segment_started")).toBe(true);
    expect(isSegmentEventType("segment_completed")).toBe(true);
    expect(isSegmentEventType("complete")).toBe(false);
    expect(isSegmentEventType("progress")).toBe(false);
    expect(isSegmentEventType(undefined)).toBe(false);
    expect(isSegmentEventType(null)).toBe(false);
    expect(isSegmentEventType(42)).toBe(false);
  });
});

describe("applySegmentEvent — 正常序（3 段批次）", () => {
  it("started(0/3) → 第 1/3 段未完成", () => {
    expect(applySegmentEvent(undefined, started(0, 3))).toEqual(state(1, 3, false));
  });

  it("完整 started→completed 交錯序列走到 3/3 完成", () => {
    let s: SegmentProgressState | undefined;
    s = applySegmentEvent(s, started(0, 3));
    s = applySegmentEvent(s, completed(0, 3));
    expect(s).toEqual(state(1, 3, true));
    s = applySegmentEvent(s, started(1, 3));
    expect(s).toEqual(state(2, 3, false));
    s = applySegmentEvent(s, completed(1, 3));
    s = applySegmentEvent(s, started(2, 3));
    s = applySegmentEvent(s, completed(2, 3));
    expect(s).toEqual(state(3, 3, true));
  });
});

describe("applySegmentEvent — 亂序", () => {
  it("較舊分段的 started 晚到 → 不倒退", () => {
    const prev = state(3, 3, false);
    expect(applySegmentEvent(prev, started(0, 3))).toBe(prev);
    expect(applySegmentEvent(prev, started(1, 3))).toBe(prev);
  });

  it("較舊分段的 completed 晚到 → 不倒退", () => {
    const prev = state(3, 3, false);
    expect(applySegmentEvent(prev, completed(0, 3))).toBe(prev);
  });

  it("completed 先於 started 抵達 → 直接記為該分段已完成", () => {
    expect(applySegmentEvent(undefined, completed(1, 3))).toEqual(state(2, 3, true));
  });

  it("跳段（started 0 之後直接 started 2）→ 前進到 3/3", () => {
    const s1 = applySegmentEvent(undefined, started(0, 3));
    expect(applySegmentEvent(s1, started(2, 3))).toEqual(state(3, 3, false));
  });
});

describe("applySegmentEvent — 重複", () => {
  it("同一 started 重複 → 回傳原 reference（免 re-render）", () => {
    const prev = state(2, 3, false);
    expect(applySegmentEvent(prev, started(1, 3))).toBe(prev);
  });

  it("同一 completed 重複 → 回傳原 reference", () => {
    const prev = state(2, 3, true);
    expect(applySegmentEvent(prev, completed(1, 3))).toBe(prev);
  });

  it("completed 後又收到同分段 started（重送）→ 不降級回未完成", () => {
    const prev = state(2, 3, true);
    expect(applySegmentEvent(prev, started(1, 3))).toBe(prev);
  });

  it("同分段 started 後收到 completed → 標記完成", () => {
    const prev = state(2, 3, false);
    expect(applySegmentEvent(prev, completed(1, 3))).toEqual(state(2, 3, true));
  });
});

describe("applySegmentEvent — 缺欄位 / 型別汙染（永不 throw）", () => {
  it("缺 segmentIndex → 忽略，維持 prev", () => {
    const prev = state(1, 3, false);
    expect(applySegmentEvent(prev, started(undefined, 3))).toBe(prev);
    expect(applySegmentEvent(undefined, started(undefined, 3))).toBeUndefined();
  });

  it("segmentIndex 型別錯誤（string / NaN / 負數 / Infinity）→ 忽略", () => {
    const prev = state(1, 3, false);
    expect(applySegmentEvent(prev, started("2", 3))).toBe(prev);
    expect(applySegmentEvent(prev, started(NaN, 3))).toBe(prev);
    expect(applySegmentEvent(prev, started(-1, 3))).toBe(prev);
    expect(applySegmentEvent(prev, started(Infinity, 3))).toBe(prev);
  });

  it("缺 of 但已有 prev → 沿用 prev.totalSegments", () => {
    const prev = state(1, 3, false);
    expect(applySegmentEvent(prev, started(1, undefined))).toEqual(state(2, 3, false));
  });

  it("缺 of 且無 prev → 無法得知總數，忽略", () => {
    expect(applySegmentEvent(undefined, started(0, undefined))).toBeUndefined();
    expect(applySegmentEvent(undefined, started(0, "3"))).toBeUndefined();
  });

  it("非物件 / null / 非分段事件 → 維持 prev", () => {
    const prev = state(1, 3, false);
    expect(applySegmentEvent(prev, null)).toBe(prev);
    expect(applySegmentEvent(prev, undefined)).toBe(prev);
    expect(applySegmentEvent(prev, "segment_started")).toBe(prev);
    expect(applySegmentEvent(prev, 42)).toBe(prev);
    expect(applySegmentEvent(prev, { type: "complete" })).toBe(prev);
    expect(applySegmentEvent(undefined, { type: "progress", progress: 50 })).toBeUndefined();
  });

  it("小數 segmentIndex/of → floor 後採用", () => {
    expect(applySegmentEvent(undefined, started(1.9, 3.7))).toEqual(state(2, 3, false));
  });
});

describe("applySegmentEvent — 0 段 / 單一分段 / clamp", () => {
  it("of = 0 且無 prev → 忽略（不顯示 0 段）", () => {
    expect(applySegmentEvent(undefined, started(0, 0))).toBeUndefined();
  });

  it("of = 0 但已有 prev → 沿用 prev 總數，不會出現 X/0", () => {
    const prev = state(1, 3, false);
    expect(applySegmentEvent(prev, started(1, 0))).toEqual(state(2, 3, false));
  });

  it("單一分段（of = 1）→ 第 1/1 段，completed 正常收尾", () => {
    const s1 = applySegmentEvent(undefined, started(0, 1));
    expect(s1).toEqual(state(1, 1, false));
    expect(applySegmentEvent(s1, completed(0, 1))).toEqual(state(1, 1, true));
  });

  it("segmentIndex 超過總數 → clamp 到 totalSegments", () => {
    expect(applySegmentEvent(undefined, started(5, 3))).toEqual(state(3, 3, false));
  });
});

describe("formatSegmentProgress", () => {
  it("正常 state → 「第 X/N 段」", () => {
    expect(formatSegmentProgress(state(2, 5, false))).toBe("第 2/5 段");
    expect(formatSegmentProgress(state(1, 1, true))).toBe("第 1/1 段");
  });

  it("state 缺失 → null（零回歸）", () => {
    expect(formatSegmentProgress(undefined)).toBeNull();
    expect(formatSegmentProgress(null)).toBeNull();
  });

  it("不合法 state（0 / 負數 / NaN / 型別錯誤）→ null", () => {
    expect(formatSegmentProgress(state(0, 3, false))).toBeNull();
    expect(formatSegmentProgress(state(1, 0, false))).toBeNull();
    expect(formatSegmentProgress(state(-1, 3, false))).toBeNull();
    expect(formatSegmentProgress(state(NaN, 3, false))).toBeNull();
    expect(
      formatSegmentProgress({ currentSegment: "2", totalSegments: 3 } as unknown as SegmentProgressState)
    ).toBeNull();
  });

  it("current > total（防禦）→ clamp 顯示", () => {
    expect(formatSegmentProgress(state(9, 3, false))).toBe("第 3/3 段");
  });
});

describe("deriveSegmentProgressFromJobMeta — resultJson fallback（輪詢路徑）", () => {
  const meta = (overrides: Record<string, unknown> = {}) => ({
    sourceStudio: "director",
    segmentIndex: 1,
    totalTasks: 5,
    segmentId: "seg-1",
    studioType: "video",
    prompt: "p",
    ...overrides,
  });

  it("director 分段任務 → 推導出第 2/5 段（0-based +1，completed=false）", () => {
    expect(deriveSegmentProgressFromJobMeta(meta())).toEqual(state(2, 5, false));
  });

  it("推導結果可直接餵 formatSegmentProgress → 「第 X/N 段」", () => {
    expect(formatSegmentProgress(deriveSegmentProgressFromJobMeta(meta()))).toBe(
      "第 2/5 段"
    );
  });

  it("非 director 任務（一般工作室 job）→ null（零回歸）", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ sourceStudio: "video" }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ sourceStudio: undefined }))).toBeNull();
  });

  it("meta 非物件 / 缺失 → null、永不 throw", () => {
    expect(deriveSegmentProgressFromJobMeta(undefined)).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(null)).toBeNull();
    expect(deriveSegmentProgressFromJobMeta("director")).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(42)).toBeNull();
  });

  it("缺 totalTasks（建 job 當下、dispatch 前）→ null（安靜不顯示）", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ totalTasks: undefined }))).toBeNull();
  });

  it("totalTasks < 1 或型別錯誤 → null", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ totalTasks: 0 }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ totalTasks: "5" }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ totalTasks: NaN }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ totalTasks: -3 }))).toBeNull();
  });

  it("segmentIndex 缺失或不合法 → null", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: undefined }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: "1" }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: -1 }))).toBeNull();
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: Infinity }))).toBeNull();
  });

  it("segmentIndex 超過總數 → clamp 到 totalSegments", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: 9, totalTasks: 3 }))).toEqual(
      state(3, 3, false)
    );
  });

  it("單一分段（totalTasks=1, segmentIndex=0）→ 第 1/1 段", () => {
    expect(
      formatSegmentProgress(
        deriveSegmentProgressFromJobMeta(meta({ segmentIndex: 0, totalTasks: 1 }))
      )
    ).toBe("第 1/1 段");
  });

  it("小數 → floor 後採用", () => {
    expect(deriveSegmentProgressFromJobMeta(meta({ segmentIndex: 1.9, totalTasks: 3.7 }))).toEqual(
      state(2, 3, false)
    );
  });
});
