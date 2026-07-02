/**
 * BackgroundTasksDrawer — 全域背景任務面板
 *
 * 顯示所有進行中 + 近 24 小時已完成/失敗的背景任務。
 * 固定在側邊欄底部，點擊 badge 展開/收起。
 */

import {
  useBackgroundTasks,
  type BackgroundTask,
  type StudioJobType,
} from "@/contexts/BackgroundTasksContext";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Image,
  Film,
  Music,
  Mic,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Clock,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefundStatusBadge,
  useJobRefundStatuses,
  type JobRefundInfo,
} from "@/components/RefundStatusBadge";
import { SegmentProgressLabel } from "@/components/SegmentProgressLabel";
import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STUDIO_ROUTE: Record<StudioJobType, string> = {
  image: "/image-studio",
  video: "/video-studio",
  audio: "/pro-studio",
  voice: "/pro-studio",
};

const STUDIO_ICON: Record<StudioJobType, React.ReactNode> = {
  image: <Image className="w-4 h-4" />,
  video: <Film className="w-4 h-4" />,
  audio: <Music className="w-4 h-4" />,
  voice: <Mic className="w-4 h-4" />,
};

const STUDIO_LABEL: Record<StudioJobType, string> = {
  image: "圖片",
  video: "影片",
  audio: "音樂",
  voice: "語音",
};

const STATUS_CONFIG: Record<
  string,
  { icon: React.ReactNode; className: string; label: string }
> = {
  queued: {
    icon: <Clock className="w-3.5 h-3.5" />,
    className: "text-muted-foreground",
    label: "等待中",
  },
  processing: {
    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
    className: "text-primary",
    label: "生成中",
  },
  completed: {
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    className: "text-green-500",
    label: "已完成",
  },
  failed: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    className: "text-destructive",
    label: "失敗",
  },
  cancelled: {
    icon: <XCircle className="w-3.5 h-3.5" />,
    className: "text-muted-foreground",
    label: "已取消",
  },
};

function formatTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

// ─── Task Row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  previewUrl,
  refundInfo,
}: {
  task: BackgroundTask;
  previewUrl?: string;
  refundInfo?: JobRefundInfo;
}) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const isDispatchFailed =
    task.status === "failed" &&
    (task.errorMessage?.startsWith("queued_timeout") ?? false);
  const cfg = isDispatchFailed
    ? {
        icon: <AlertTriangle className="w-3.5 h-3.5" />,
        className: "text-amber-500",
        label: "排程失敗",
      }
    : (STATUS_CONFIG[task.status] ?? STATUS_CONFIG.processing);
  const resultUrl = task.resultUrl;
  // AIDV-431: prefer SSE-immediate preview_url, fall back to DB resultUrl
  const videoPreviewUrl = previewUrl || resultUrl;
  const isCompletedVideo =
    task.status === "completed" && task.studioType === "video";
  const [, navigate] = useLocation();

  const handleOpenResult = useCallback(() => {
    if (resultUrl) {
      window.open(resultUrl, "_blank", "noopener,noreferrer");
    }
  }, [resultUrl]);

  const handleRetry = useCallback(() => {
    navigate(STUDIO_ROUTE[task.studioType] ?? "/studio");
  }, [navigate, task.studioType]);

  return (
    <div className="rounded-lg hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Icon */}
        <div className={`flex-shrink-0 ${cfg.className}`}>
          {STUDIO_ICON[task.studioType] ?? STUDIO_ICON.image}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">
            {task.label ||
              `${STUDIO_LABEL[task.studioType] ?? task.studioType} 生成`}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`flex items-center gap-1 text-[10px] ${cfg.className}`}
            >
              {cfg.icon}
              {cfg.label}
            </span>
            {task.createdAt && (
              <span className="text-[10px] text-muted-foreground">
                {formatTime(task.createdAt)}
              </span>
            )}
            {/* AIDV-589：影片任務的分段進度「第 X/N 段」（無 segment 事件時不渲染） */}
            {task.studioType === "video" &&
              (task.status === "processing" || task.status === "queued") && (
                <SegmentProgressLabel jobId={task.jobId} />
              )}
            {/* AIDV-650: 失敗任務的退款狀態徽章（無資料時安靜不顯示） */}
            {task.status === "failed" && (
              <RefundStatusBadge info={refundInfo} />
            )}
          </div>
          {/* F010: show failure reason so users know what went wrong */}
          {task.status === "failed" && task.errorMessage && (
            <p
              className="text-[10px] text-destructive mt-0.5 truncate"
              title={task.errorMessage}
            >
              {task.errorMessage}
            </p>
          )}
        </div>

        {/* Result link (non-video or as additional open button) */}
        {task.status === "completed" && resultUrl && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="在新分頁開啟結果"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleOpenResult}
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </Button>
        )}

        {/* F010: retry button for failed tasks — navigates to the relevant studio */}
        {task.status === "failed" && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="前往工作室重新生成"
            className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleRetry}
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
          </Button>
        )}

        {/* F011: real progress when available, indeterminate pulse when 0 */}
        {task.status === "processing" && (
          <div className="w-8 h-1 rounded-full bg-muted overflow-hidden flex-shrink-0">
            {task.progress > 0 ? (
              <div
                className={`h-full bg-primary rounded-full${prefersReducedMotion ? "" : " transition-all duration-500"}`}
                style={{ width: `${task.progress}%` }}
              />
            ) : (
              <div className="h-full w-full bg-primary/50 rounded-full animate-pulse" />
            )}
          </div>
        )}
      </div>

      {/* AIDV-431: inline video preview for completed video jobs */}
      {isCompletedVideo && (
        <div className="px-3 pb-2.5">
          {videoPreviewUrl ? (
            <video
              src={videoPreviewUrl}
              controls
              preload="metadata"
              className="w-full rounded-md max-h-40 bg-black"
            />
          ) : (
            <p className="text-[10px] text-muted-foreground italic">
              Preview unavailable — export to view
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BackgroundTasksDrawer() {
  const { tasks, activeCount, drawerOpen, setDrawerOpen, previewUrls } =
    useBackgroundTasks();
  const prefersReducedMotion = useReducedMotion();

  // AIDV-650: 批次查詢失敗任務的退款狀態（單一查詢；空清單時不發）
  const failedJobIds = useMemo(
    () =>
      tasks
        .filter(t => t.status === "failed")
        .map(t => t.jobId)
        .sort((a, b) => a - b),
    [tasks]
  );
  const refundInfoByJobId = useJobRefundStatuses(failedJobIds);

  // 不顯示 badge 如果沒有任何任務
  if (tasks.length === 0 && !drawerOpen) return null;

  const activeTasks = tasks.filter(
    t => t.status === "queued" || t.status === "processing"
  );
  const completedTasks = tasks.filter(
    t =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "cancelled"
  );

  return (
    <div className="w-full">
      {/* Toggle Button */}
      <button
        onClick={() => setDrawerOpen(!drawerOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg hover:bg-accent/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Loader2
            className={`w-4 h-4 flex-shrink-0 ${activeCount > 0 ? "animate-spin text-primary" : "text-muted-foreground"}`}
          />
          <span className="text-sm font-medium truncate">背景任務</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {activeCount > 0 && (
            <Badge
              variant="default"
              className="h-5 px-1.5 text-[10px] font-bold"
            >
              {activeCount}
            </Badge>
          )}
          {drawerOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Drawer Content */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto no-scrollbar py-1 space-y-0.5">
              {/* Active Tasks */}
              {activeTasks.length > 0 && (
                <div>
                  <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    進行中 ({activeTasks.length})
                  </p>
                  {activeTasks.map(t => (
                    <TaskRow key={t.jobId} task={t} previewUrl={previewUrls[t.jobId]} />
                  ))}
                </div>
              )}

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div>
                  <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    最近完成 ({completedTasks.length})
                  </p>
                  {completedTasks.map(t => (
                    <TaskRow
                      key={t.jobId}
                      task={t}
                      previewUrl={previewUrls[t.jobId]}
                      refundInfo={refundInfoByJobId[t.jobId]}
                    />
                  ))}
                </div>
              )}

              {tasks.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  目前沒有背景任務
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
