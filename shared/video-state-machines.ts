/**
 * AIDV-44 W2-F G7: segment / session 狀態機（shared）
 *
 * segmentMachine — 追蹤每個渲染 step 的生命週期
 *   queued → running → success | failed
 *   queued → skipped（略過）
 *   failed → queued（重試）
 *
 * sessionMachine — 追蹤整個影片工作階段（storyboard productionStatus）
 *   planning → in_progress → completed | failed | cancelled
 *   in_progress → paused → in_progress
 *   failed → in_progress（重跑）
 *
 * XState machine 供 client 驅動（@xstate/react useMachine）；
 * canTransitionSegment / canTransitionSession 供 server 驗證（非法轉移拒 422）。
 */

import { createMachine } from "xstate";

// ── Segment（渲染步驟）狀態 ─────────────────────────────────────────────────

export const SEGMENT_STATUSES = [
  "queued",
  "running",
  "success",
  "failed",
  "skipped",
] as const;

export type SegmentJobStatus = (typeof SEGMENT_STATUSES)[number];

/**
 * 每個 segment step 的允許下一狀態（用於 server-side 422 守門）。
 * 與 segmentMachine 的 on: 定義保持一致。
 *
 * 6 條合法轉移：
 *   1. queued  → running  (START)
 *   2. queued  → skipped  (SKIP)
 *   3. running → success  (COMPLETE)
 *   4. running → failed   (FAIL)
 *   5. failed  → queued   (RETRY)
 *   6. skipped → queued   (REQUEUE)
 */
export const SEGMENT_NEXT_STATES: Readonly<Record<SegmentJobStatus, readonly SegmentJobStatus[]>> = {
  queued: ["running", "skipped"],
  running: ["success", "failed"],
  success: [],
  failed: ["queued"],
  skipped: ["queued"],
};

/** XState 5 machine：供 client 以 useMachine 驅動 UI 狀態。 */
export const segmentMachine = createMachine({
  id: "segment",
  initial: "queued" as SegmentJobStatus,
  states: {
    queued: { on: { START: "running", SKIP: "skipped" } },
    running: { on: { COMPLETE: "success", FAIL: "failed" } },
    success: { type: "final" as const },
    failed: { on: { RETRY: "queued" } },
    skipped: { on: { REQUEUE: "queued" } },
  },
});

/** Server: 驗證 segment step 狀態轉移是否合法。 */
export function canTransitionSegment(from: SegmentJobStatus, to: SegmentJobStatus): boolean {
  return (SEGMENT_NEXT_STATES[from] as readonly string[]).includes(to);
}

// ── Session（影片工作階段）狀態 ─────────────────────────────────────────────

export const SESSION_STATUSES = [
  "planning",
  "in_progress",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;

export type VideoSessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_NEXT_STATES: Readonly<Record<VideoSessionStatus, readonly VideoSessionStatus[]>> = {
  planning: ["in_progress", "cancelled"],
  in_progress: ["paused", "completed", "failed", "cancelled"],
  paused: ["in_progress", "cancelled"],
  completed: [],
  failed: ["in_progress"],
  cancelled: [],
};

export const sessionMachine = createMachine({
  id: "videoSession",
  initial: "planning" as VideoSessionStatus,
  states: {
    planning: { on: { START: "in_progress", CANCEL: "cancelled" } },
    in_progress: {
      on: {
        PAUSE: "paused",
        COMPLETE: "completed",
        FAIL: "failed",
        CANCEL: "cancelled",
      },
    },
    paused: { on: { RESUME: "in_progress", CANCEL: "cancelled" } },
    completed: { type: "final" as const },
    failed: { on: { RETRY: "in_progress" } },
    cancelled: { type: "final" as const },
  },
});

/** Server: 驗證 session 狀態轉移是否合法。 */
export function canTransitionSession(from: VideoSessionStatus, to: VideoSessionStatus): boolean {
  return (SESSION_NEXT_STATES[from] as readonly string[]).includes(to);
}
