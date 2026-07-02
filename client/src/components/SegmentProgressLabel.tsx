/**
 * SegmentProgressLabel — AIDV-589 分段進度文案
 *
 * 資料來源（優先序）：
 * 1. BackgroundTasksContext.segmentProgress —— 該 jobId 的分段 SSE 事件
 *    （segment_started / segment_completed），有事件時即時更新。
 * 2. task.resultJson fallback —— director 在 job resultJson 持久化的
 *    segmentIndex / totalTasks（deriveSegmentProgressFromJobMeta）。這是
 *    現行 server 下唯一保證可達的路徑：兩個 segment SSE 事件分別因
 *    「訂閱晚於 emit」與「complete 後 emit / 連線已關」而結構性漏接，
 *    詳見 segmentProgress.ts 的說明。
 *
 * 兩個來源皆缺或資料不合法時 render null → 與現行 UI 100% 一致（零回歸）。
 */
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import {
  deriveSegmentProgressFromJobMeta,
  formatSegmentProgress,
} from "@/contexts/segmentProgress";

export function SegmentProgressLabel({
  jobId,
  resultJson,
}: {
  jobId: number;
  /** activeJobs 輪詢帶回的 job resultJson（SSE 缺席時的 fallback 來源） */
  resultJson?: Record<string, unknown>;
}) {
  const { segmentProgress } = useBackgroundTasks();
  // optional chaining：舊 context shape（測試 mock / 漸進部署）缺欄位時靜默降級
  const state =
    segmentProgress?.[jobId] ?? deriveSegmentProgressFromJobMeta(resultJson);
  const text = formatSegmentProgress(state);
  if (!text) return null;
  return (
    <span
      className="text-[10px] text-primary/80"
      aria-label={`分段進度：${text}`}
    >
      {text}
    </span>
  );
}
