/**
 * SegmentProgressLabel — AIDV-589 分段進度文案
 *
 * 從 BackgroundTasksContext 讀取該 jobId 的分段進度（segment_started /
 * segment_completed SSE），顯示「第 X/N 段」進度文案（zh-TW，跟既有
 * 任務卡進度文案風格一致）。
 *
 * 未收到任何分段事件（segmentProgress 無此 jobId entry）或資料不合法時
 * render null → 與現行 UI 100% 一致（零回歸）。
 */
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import { formatSegmentProgress } from "@/contexts/segmentProgress";

export function SegmentProgressLabel({ jobId }: { jobId: number }) {
  const { segmentProgress } = useBackgroundTasks();
  // optional chaining：舊 context shape（測試 mock / 漸進部署）缺欄位時靜默降級
  const text = formatSegmentProgress(segmentProgress?.[jobId]);
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
