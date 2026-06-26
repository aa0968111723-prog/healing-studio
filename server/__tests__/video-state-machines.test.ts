/**
 * AIDV-44 W2-F G7: segment/session 狀態機單元測試
 *
 * 驗收：
 *   ✅ 合法 6 條 segment 轉移全通過
 *   ✅ 非法轉移全拒（canTransitionSegment 回傳 false）
 *   ✅ session 合法轉移通過、非法轉移拒
 */

import { describe, it, expect } from "vitest";
import {
  canTransitionSegment,
  canTransitionSession,
  SEGMENT_STATUSES,
  SESSION_STATUSES,
} from "../../shared/video-state-machines";

describe("canTransitionSegment — 6 條合法轉移", () => {
  it("1. queued → running（START）", () => {
    expect(canTransitionSegment("queued", "running")).toBe(true);
  });

  it("2. queued → skipped（SKIP）", () => {
    expect(canTransitionSegment("queued", "skipped")).toBe(true);
  });

  it("3. running → success（COMPLETE）", () => {
    expect(canTransitionSegment("running", "success")).toBe(true);
  });

  it("4. running → failed（FAIL）", () => {
    expect(canTransitionSegment("running", "failed")).toBe(true);
  });

  it("5. failed → queued（RETRY）", () => {
    expect(canTransitionSegment("failed", "queued")).toBe(true);
  });

  it("6. skipped → queued（REQUEUE）", () => {
    expect(canTransitionSegment("skipped", "queued")).toBe(true);
  });
});

describe("canTransitionSegment — 非法轉移全拒（422 守門）", () => {
  it("success → running（已完成不可重跑）", () => {
    expect(canTransitionSegment("success", "running")).toBe(false);
  });

  it("success → queued（已完成不可重排）", () => {
    expect(canTransitionSegment("success", "queued")).toBe(false);
  });

  it("running → queued（執行中不可直接回排）", () => {
    expect(canTransitionSegment("running", "queued")).toBe(false);
  });

  it("failed → success（失敗不可直接標成功）", () => {
    expect(canTransitionSegment("failed", "success")).toBe(false);
  });

  it("skipped → running（略過不可直接開始）", () => {
    expect(canTransitionSegment("skipped", "running")).toBe(false);
  });
});

describe("SEGMENT_STATUSES 完整性", () => {
  it("包含全部 5 個狀態字串", () => {
    expect(SEGMENT_STATUSES).toEqual(["queued", "running", "success", "failed", "skipped"]);
  });
});

describe("canTransitionSession — 合法轉移", () => {
  it("planning → in_progress（START）", () => {
    expect(canTransitionSession("planning", "in_progress")).toBe(true);
  });

  it("in_progress → paused（PAUSE）", () => {
    expect(canTransitionSession("in_progress", "paused")).toBe(true);
  });

  it("in_progress → completed（COMPLETE）", () => {
    expect(canTransitionSession("in_progress", "completed")).toBe(true);
  });

  it("paused → in_progress（RESUME）", () => {
    expect(canTransitionSession("paused", "in_progress")).toBe(true);
  });

  it("failed → in_progress（RETRY）", () => {
    expect(canTransitionSession("failed", "in_progress")).toBe(true);
  });

  it("planning → cancelled（CANCEL）", () => {
    expect(canTransitionSession("planning", "cancelled")).toBe(true);
  });
});

describe("canTransitionSession — 非法轉移全拒", () => {
  it("completed → in_progress（已完成不可重啟）", () => {
    expect(canTransitionSession("completed", "in_progress")).toBe(false);
  });

  it("cancelled → planning（已取消不可回到規劃）", () => {
    expect(canTransitionSession("cancelled", "planning")).toBe(false);
  });

  it("planning → completed（不可跳過 in_progress）", () => {
    expect(canTransitionSession("planning", "completed")).toBe(false);
  });
});

describe("SESSION_STATUSES 完整性", () => {
  it("包含全部 6 個狀態字串", () => {
    expect(SESSION_STATUSES).toEqual([
      "planning",
      "in_progress",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ]);
  });
});
