/**
 * taskCheckpoint.test.ts — AIDV-526 任務段落 checkpoint 邏輯
 *
 * 測試場景（純邏輯層，不依賴真實 DB）：
 *   1. 空 checkpoint：completed_segments=[]
 *   2. 段落逐步累積（1 → 1,2 → 1,2,3）
 *   3. 重複寫入同一段落不重複計算（idempotent）
 *   4. 部分失敗後恢復：skipCompletedSegments 正確略過已完成段落
 *   5. 全段完成後 remainingSegments=0
 *   6. 亂序段落正確排序並合併
 *   7. segment_uris 正確對應段落 URI
 *   8. 恢復後執行的段落數 = totalSegments - completedCount
 *   9. resume events 數量 = already-completed 段落數
 *  10. 從無 checkpoint 重試 → 全段重跑（retry-from-scratch fallback）
 */

import { describe, it, expect } from "vitest";

// ── Checkpoint 資料結構 ───────────────────────────────────────────────────────

type CheckpointData = {
  completed_segments: number[];
  segment_uris: Record<string, string>;
  total_segments: number;
  last_updated?: string;
};

const EMPTY_CHECKPOINT: CheckpointData = {
  completed_segments: [],
  segment_uris: {},
  total_segments: 0,
};

// ── 純函數：模擬 update_task_checkpoint 的核心邏輯 ──────────────────────────

function updateCheckpoint(
  current: CheckpointData,
  segmentIndex: number,
  segmentUri: string,
  totalSegments: number
): CheckpointData {
  const completedSet = new Set(current.completed_segments);
  completedSet.add(segmentIndex);
  return {
    completed_segments: Array.from(completedSet).sort((a, b) => a - b),
    segment_uris: { ...current.segment_uris, [segmentIndex]: segmentUri },
    total_segments: totalSegments,
    last_updated: new Date().toISOString(),
  };
}

// ── 純函數：模擬 dispatcher 的 skip 邏輯 ─────────────────────────────────────

function skipCompletedSegments(
  allSegments: number[],
  checkpoint: CheckpointData
): { toRun: number[]; skipped: number[] } {
  const done = new Set(checkpoint.completed_segments);
  return {
    toRun: allSegments.filter(s => !done.has(s)),
    skipped: allSegments.filter(s => done.has(s)),
  };
}

// ── 純函數：模擬 emit_segment_resume_events 回傳的事件清單 ────────────────────

type ResumeEvent = { event: "segment_resumed"; segment: number; of: number };

function buildResumeEvents(checkpoint: CheckpointData): ResumeEvent[] {
  return checkpoint.completed_segments.map(seg => ({
    event: "segment_resumed" as const,
    segment: seg,
    of: checkpoint.total_segments,
  }));
}

// ── 測試 ─────────────────────────────────────────────────────────────────────

describe("taskCheckpoint（AIDV-526 段落恢復邏輯）", () => {
  it("空 checkpoint：completed_segments 為空陣列", () => {
    expect(EMPTY_CHECKPOINT.completed_segments).toEqual([]);
    expect(EMPTY_CHECKPOINT.segment_uris).toEqual({});
  });

  it("段落逐步累積：1 → [1] → [1,2] → [1,2,3]", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", 5);
    expect(cp.completed_segments).toEqual([1]);

    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);
    expect(cp.completed_segments).toEqual([1, 2]);

    cp = updateCheckpoint(cp, 3, "https://cdn/seg3.mp4", 5);
    expect(cp.completed_segments).toEqual([1, 2, 3]);
    expect(cp.total_segments).toBe(5);
  });

  it("重複寫入同一段落不重複計算（idempotent）", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2-retry.mp4", 5);
    expect(cp.completed_segments).toEqual([2]);
    expect(cp.completed_segments.length).toBe(1);
  });

  it("部分失敗後恢復：skipCompletedSegments 正確略過已完成段落", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", 5);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);

    const all = [1, 2, 3, 4, 5];
    const { toRun, skipped } = skipCompletedSegments(all, cp);

    expect(skipped).toEqual([1, 2]);
    expect(toRun).toEqual([3, 4, 5]);
  });

  it("全段完成後 toRun=[]", () => {
    let cp = EMPTY_CHECKPOINT;
    for (let i = 1; i <= 3; i++) {
      cp = updateCheckpoint(cp, i, `https://cdn/seg${i}.mp4`, 3);
    }
    const { toRun, skipped } = skipCompletedSegments([1, 2, 3], cp);
    expect(toRun).toEqual([]);
    expect(skipped).toEqual([1, 2, 3]);
  });

  it("亂序段落正確排序並合併（segment 4 先完成，再 2）", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 4, "https://cdn/seg4.mp4", 5);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);
    expect(cp.completed_segments).toEqual([2, 4]);
  });

  it("segment_uris 正確對應各段落 URI", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", 3);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 3);

    expect(cp.segment_uris["1"]).toBe("https://cdn/seg1.mp4");
    expect(cp.segment_uris["2"]).toBe("https://cdn/seg2.mp4");
    expect(cp.segment_uris["3"]).toBeUndefined();
  });

  it("恢復後執行的段落數 = totalSegments - completedCount", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", 5);
    cp = updateCheckpoint(cp, 3, "https://cdn/seg3.mp4", 5);

    const all = [1, 2, 3, 4, 5];
    const { toRun } = skipCompletedSegments(all, cp);

    expect(toRun.length).toBe(5 - cp.completed_segments.length);
    expect(toRun).toEqual([2, 4, 5]);
  });

  it("resume events 數量 = 已完成段落數，且格式正確", () => {
    let cp = EMPTY_CHECKPOINT;
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", 5);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", 5);

    const events = buildResumeEvents(cp);
    expect(events.length).toBe(2);
    expect(events[0]).toEqual({ event: "segment_resumed", segment: 1, of: 5 });
    expect(events[1]).toEqual({ event: "segment_resumed", segment: 2, of: 5 });
  });

  it("從無 checkpoint 重試 → toRun 包含全部段落（retry-from-scratch fallback）", () => {
    const { toRun, skipped } = skipCompletedSegments([1, 2, 3, 4, 5], EMPTY_CHECKPOINT);
    expect(skipped).toEqual([]);
    expect(toRun).toEqual([1, 2, 3, 4, 5]);
  });

  it("部分失敗後恢復：最終輸出段落數 = totalSegments（完整性驗收）", () => {
    const totalSegments = 5;
    let cp = EMPTY_CHECKPOINT;
    // 模擬：任務跑到 2/5，第 3 段失敗
    cp = updateCheckpoint(cp, 1, "https://cdn/seg1.mp4", totalSegments);
    cp = updateCheckpoint(cp, 2, "https://cdn/seg2.mp4", totalSegments);

    // retry：跳過已完成，繼續跑第 3、4、5 段
    const all = Array.from({ length: totalSegments }, (_, i) => i + 1);
    const { toRun } = skipCompletedSegments(all, cp);

    // 模擬 retry 完成剩餘段落
    for (const seg of toRun) {
      cp = updateCheckpoint(cp, seg, `https://cdn/seg${seg}.mp4`, totalSegments);
    }

    expect(cp.completed_segments.length).toBe(totalSegments);
    expect(cp.completed_segments).toEqual([1, 2, 3, 4, 5]);
    expect(Object.keys(cp.segment_uris).length).toBe(totalSegments);
  });
});
