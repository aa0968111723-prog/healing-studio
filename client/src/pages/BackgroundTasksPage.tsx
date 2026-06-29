/**
 * BackgroundTasksPage — 背景任務中心
 *
 * 彙整所有生成（圖片/影片/音樂/語音）與訓練任務。
 * 支援即時狀態輪詢、結果預覽、任務篩選與搜尋。
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { AssetModelSubpageGuide } from "@/components/AssetModelSubpageGuide";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Image,
  Film,
  Music,
  Mic,
  Cpu,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Search,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Filter,
  LayoutGrid,
  List,
  Download,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentAction, AgentActionResult, AgentCapability } from "../../../shared/agent-actions";

// ─── Types & Constants ────────────────────────────────────────────────────────

type JobFilter =
  | "all"
  | "active"
  | "completed"
  | "failed"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "model_training";

interface JobRow {
  id: number;
  jobType: string;
  status: string;
  progress: number;
  progressMessage: string | null;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

const FILTER_TABS: {
  value: JobFilter;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "all", label: "全部", icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  {
    value: "active",
    label: "進行中",
    icon: <Loader2 className="w-3.5 h-3.5" />,
  },
  {
    value: "completed",
    label: "已完成",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  { value: "failed", label: "失敗", icon: <XCircle className="w-3.5 h-3.5" /> },
  { value: "image", label: "圖片", icon: <Image className="w-3.5 h-3.5" /> },
  { value: "video", label: "影片", icon: <Film className="w-3.5 h-3.5" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-3.5 h-3.5" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-3.5 h-3.5" /> },
  {
    value: "model_training",
    label: "模型訓練",
    icon: <Cpu className="w-3.5 h-3.5" />,
  },
];

const JOB_TYPE_ICON: Record<string, React.ReactNode> = {
  image: <Image className="w-5 h-5" />,
  video: <Film className="w-5 h-5" />,
  audio: <Music className="w-5 h-5" />,
  voice: <Mic className="w-5 h-5" />,
  multimodal: <LayoutGrid className="w-5 h-5" />,
  model_training: <Cpu className="w-5 h-5" />,
  zip_export: <Download className="w-5 h-5" />,
};

const JOB_TYPE_LABEL: Record<string, string> = {
  image: "圖片生成",
  video: "影片生成",
  audio: "音樂生成",
  voice: "語音生成",
  multimodal: "多模態生成",
  model_training: "模型訓練",
  zip_export: "匯出",
};

const STATUS_CONFIG: Record<
  string,
  { color: string; bgColor: string; label: string; icon: React.ReactNode }
> = {
  queued: {
    color: "text-amber-600",
    bgColor: "bg-amber-50 border-amber-200",
    label: "排隊中",
    icon: <Clock className="w-4 h-4" />,
  },
  processing: {
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200",
    label: "處理中",
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
  },
  completed: {
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200",
    label: "已完成",
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  failed: {
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200",
    label: "失敗",
    icon: <XCircle className="w-4 h-4" />,
  },
  cancelled: {
    color: "text-muted-foreground",
    bgColor: "bg-muted/50 border-muted",
    label: "已取消",
    icon: <XCircle className="w-4 h-4" />,
  },
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "剛剛";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// ─── Result Preview Component ─────────────────────────────────────────────────

function ResultPreview({ job }: { job: JobRow }) {
  const meta = job.resultJson as Record<string, unknown> | null;
  if (!meta) return null;

  const resultUrl = (meta.resultUrl as string) ?? null;
  // Also check nested result data for URLs
  const resultData = meta.result as Record<string, unknown> | null;
  const imageUrl =
    resultUrl ??
    (resultData?.images as any)?.[0]?.url ??
    (resultData?.image as any)?.url ??
    null;
  const videoUrl =
    (job.jobType === "video" ? resultUrl : null) ??
    (resultData?.video as any)?.url ??
    (resultData as any)?.video_url ??
    null;
  const audioUrl =
    (job.jobType === "audio" || job.jobType === "voice" ? resultUrl : null) ??
    (resultData?.audio as any)?.url ??
    (resultData as any)?.audio_url ??
    null;

  if (job.jobType === "image" && imageUrl) {
    return (
      <div className="mt-3">
        <img
          src={imageUrl}
          alt="生成結果"
          className="w-full max-w-xs rounded-lg border shadow-sm"
          loading="lazy"
        />
      </div>
    );
  }

  if (job.jobType === "video" && videoUrl) {
    return (
      <div className="mt-3">
        <video
          src={videoUrl}
          controls
          className="w-full max-w-sm rounded-lg border shadow-sm"
          preload="metadata"
        />
      </div>
    );
  }

  if ((job.jobType === "audio" || job.jobType === "voice") && audioUrl) {
    return (
      <div className="mt-3">
        <audio
          src={audioUrl}
          controls
          className="w-full max-w-sm"
          preload="metadata"
        />
      </div>
    );
  }

  // For model training — show training info
  if (job.jobType === "model_training" && meta.modelName) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        <span className="font-medium">模型:</span> {String(meta.modelName)}
        {!!meta.engine && (
          <>
            {" "}
            · <span className="font-medium">引擎:</span> {String(meta.engine)}
          </>
        )}
      </div>
    );
  }

  return null;
}

// ─── Job Card Component ───────────────────────────────────────────────────────

function JobCard({
  job,
  onCheckStatus,
}: {
  job: JobRow;
  onCheckStatus: (jobId: number) => void;
}) {
  const meta = job.resultJson as Record<string, unknown> | null;
  const label =
    (meta?.label as string) || JOB_TYPE_LABEL[job.jobType] || job.jobType;
  const cfg = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.processing;
  const resultUrl = (meta?.resultUrl as string) ?? null;
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`rounded-xl border p-4 transition-all hover:shadow-sm ${cfg.bgColor}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`flex-shrink-0 p-2 rounded-lg bg-background/80 ${cfg.color}`}
        >
          {JOB_TYPE_ICON[job.jobType] ?? <LayoutGrid className="w-5 h-5" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="hs-h3 !mb-0 truncate">{label}</h3>
            <Badge
              variant="outline"
              className={`text-[10px] h-5 ${cfg.color} border-current/30`}
            >
              {cfg.icon}
              <span className="ml-1">{cfg.label}</span>
            </Badge>
          </div>

          {/* Progress message */}
          {job.progressMessage && (
            <p className="hs-small !mb-0 text-muted-foreground mt-1 truncate">
              {job.progressMessage}
            </p>
          )}

          {/* Error message */}
          {job.errorMessage && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-destructive">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{job.errorMessage}</span>
            </div>
          )}

          {/* Progress bar */}
          {(job.status === "processing" || job.status === "queued") && (
            <div className="mt-2 h-1.5 rounded-full bg-background/60 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.status === "queued"
                    ? "bg-amber-400 animate-pulse w-[15%]"
                    : "bg-blue-500"
                }`}
                style={
                  job.status === "processing"
                    ? { width: `${Math.max(job.progress, 10)}%` }
                    : undefined
                }
              />
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
            <span title={formatDateTime(job.createdAt)}>
              建立: {getRelativeTime(job.createdAt)}
            </span>
            {job.updatedAt !== job.createdAt && (
              <span title={formatDateTime(job.updatedAt)}>
                更新: {getRelativeTime(job.updatedAt)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {(job.status === "processing" || job.status === "queued") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onCheckStatus(job.id)}
              title="重新整理狀態"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}
          {job.status === "completed" && resultUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() =>
                window.open(resultUrl, "_blank", "noopener,noreferrer")
              }
              title="開啟結果"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起" : "展開"}
          </Button>
        </div>
      </div>

      {/* Expandable result preview */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ResultPreview job={job} />

            {/* Raw metadata (for debugging / model training) */}
            {meta && (
              <details className="mt-3">
                <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                  詳細資訊
                </summary>
                <pre className="mt-1 text-[10px] bg-background/60 rounded-lg p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(
                    { ...meta, result: meta.result ? "(已省略)" : undefined },
                    null,
                    2
                  )}
                </pre>
              </details>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ jobs }: { jobs: JobRow[] }) {
  const stats = useMemo(() => {
    const s = {
      total: jobs.length,
      active: 0,
      completed: 0,
      failed: 0,
      image: 0,
      video: 0,
      audio: 0,
      voice: 0,
      model_training: 0,
    };
    for (const j of jobs) {
      if (j.status === "queued" || j.status === "processing") s.active++;
      if (j.status === "completed") s.completed++;
      if (j.status === "failed") s.failed++;
      if (j.jobType === "image") s.image++;
      if (j.jobType === "video") s.video++;
      if (j.jobType === "audio") s.audio++;
      if (j.jobType === "voice") s.voice++;
      if (j.jobType === "model_training") s.model_training++;
    }
    return s;
  }, [jobs]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      <StatCard
        label="全部任務"
        count={stats.total}
        icon={<LayoutGrid className="w-4 h-4" />}
        color="text-foreground"
      />
      <StatCard
        label="進行中"
        count={stats.active}
        icon={<Loader2 className="w-4 h-4 animate-spin" />}
        color="text-blue-600"
      />
      <StatCard
        label="已完成"
        count={stats.completed}
        icon={<CheckCircle2 className="w-4 h-4" />}
        color="text-green-600"
      />
      <StatCard
        label="失敗"
        count={stats.failed}
        icon={<XCircle className="w-4 h-4" />}
        color="text-red-600"
      />
      <StatCard
        label="模型訓練"
        count={stats.model_training}
        icon={<Cpu className="w-4 h-4" />}
        color="text-purple-600"
      />
    </div>
  );
}

function StatCard({
  label,
  count,
  icon,
  color,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl border bg-background/50 p-3 flex items-center gap-3">
      <div className={`${color}`}>{icon}</div>
      <div>
        <p className="hs-h3-lg !mb-0 tabular-nums">{count}</p>
        <p className="hs-small !mb-0 text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BackgroundTasksPage() {
  usePageTour("background-tasks");

  const [filter, setFilter] = useState<JobFilter>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const utils = trpc.useUtils();

  // ── Query: all active + recent jobs ─────────────────────────────────────
  const activeJobsQuery = trpc.generate.activeJobs.useQuery(undefined, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: 2,
  });

  // ── Also include all jobs (including older ones) for a complete view ─────
  const allJobsQuery = trpc.generate.myJobs.useQuery(undefined, {
    retry: 2,
  });

  // Merge: active jobs (recent + in-progress) take priority, then older completed jobs
  const allJobs: JobRow[] = useMemo(() => {
    const activeJobs = (activeJobsQuery.data ?? []) as unknown as JobRow[];
    const olderJobs = (allJobsQuery.data ?? []) as unknown as JobRow[];
    const seen = new Set<number>();
    const merged: JobRow[] = [];

    // Active jobs first (most recent + in-progress)
    for (const j of activeJobs) {
      seen.add(j.id);
      merged.push(j);
    }
    // Then older jobs not already included
    for (const j of olderJobs) {
      if (!seen.has(j.id)) {
        seen.add(j.id);
        merged.push(j);
      }
    }
    return merged;
  }, [activeJobsQuery.data, allJobsQuery.data]);

  const activeJobIds = useMemo(
    () => allJobs.filter(j => j.status === "queued" || j.status === "processing").map(j => j.id),
    [allJobs]
  );

  // ── Filter & search ─────────────────────────────────────────────────────
  const filteredJobs = useMemo(() => {
    let list = allJobs;

    // Filter by tab
    switch (filter) {
      case "active":
        list = list.filter(
          j => j.status === "queued" || j.status === "processing"
        );
        break;
      case "completed":
        list = list.filter(j => j.status === "completed");
        break;
      case "failed":
        list = list.filter(j => j.status === "failed");
        break;
      case "image":
      case "video":
      case "audio":
      case "voice":
      case "model_training":
        list = list.filter(j => j.jobType === filter);
        break;
      default:
        break;
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j => {
        const meta = j.resultJson as Record<string, unknown> | null;
        const label = ((meta?.label as string) || "").toLowerCase();
        const modelId = ((meta?.modelId as string) || "").toLowerCase();
        const modelName = ((meta?.modelName as string) || "").toLowerCase();
        const msg = (j.progressMessage || "").toLowerCase();
        return (
          label.includes(q) ||
          modelId.includes(q) ||
          modelName.includes(q) ||
          msg.includes(q) ||
          j.jobType.includes(q)
        );
      });
    }

    return list;
  }, [allJobs, filter, search]);

  // ── Check individual job status ─────────────────────────────────────────
  const handleCheckStatus = useCallback(
    async (jobId: number) => {
      try {
        await utils.generate.checkStudioJob.fetch({ jobId });
        activeJobsQuery.refetch();
        toast.success("狀態已更新");
      } catch {
        toast.error("查詢狀態失敗");
      }
    },
    [utils, activeJobsQuery]
  );

  const isLoading = activeJobsQuery.isLoading && allJobsQuery.isLoading;

  const TASK_FILTER_OPTIONS = useMemo<AgentCapability["options"]>(
    () =>
      FILTER_TABS.map(tab => ({
        id: tab.value,
        label: tab.label,
        meta: {
          bestFor:
            tab.value === "active"
              ? "優先追蹤進行中任務"
              : tab.value === "failed"
                ? "快速排查異常"
                : "任務盤點",
          tip: "可再搭配搜尋欄輸入模型名或任務標籤",
        },
      })),
    []
  );

  const tasksAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "任務篩選",
        currentId: filter,
        options: TASK_FILTER_OPTIONS,
        hint: "切換 all/active/completed/failed/image/video/audio/voice/model_training",
      },
      {
        action: "search",
        label: "搜尋任務",
        hint: "搜尋模型名、任務類型、進度訊息",
      },
      {
        action: "reset",
        label: "重置篩選",
        hint: "回到全部任務並清空搜尋字串",
      },
    ],
    [filter, TASK_FILTER_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "background-tasks",
    pageLabel: "背景任務中心",
    pagePath: "/background-tasks",
    capabilities: tasksAgentCapabilities,
    state: {
      filter,
      search,
      activeCount: activeJobIds.length,
      visibleCount: filteredJobs.length,
      totalCount: allJobs.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const valid = FILTER_TABS.map(t => t.value);
          if (!valid.includes(action.tabId as JobFilter)) {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setFilter(action.tabId as JobFilter);
          return { ok: true, message: `切到「${action.tabId}」` };
        }
        case "search": {
          setSearch(action.query);
          return { ok: true, message: "已套用搜尋" };
        }
        case "reset": {
          setFilter("all");
          setSearch("");
          return { ok: true, message: "已重置條件" };
        }
        default:
          return { ok: false, reason: `unsupported on background-tasks: ${action.type}` };
      }
    },
  });

  return (
    <div className="page-shell space-y-6" id="background-tasks-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="page-eyebrow">Background Tasks</p>
          <h1 className="page-title flex items-center gap-2 !mb-0">
            <Loader2 className="w-6 h-6 text-primary" />
            背景任務中心
          </h1>
          <p className="page-subtitle mt-1">
            所有生成與訓練任務一覽，支援背景執行與即時追蹤
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            activeJobsQuery.refetch();
            allJobsQuery.refetch();
          }}
          disabled={activeJobsQuery.isFetching}
          className="h-9"
        >
          <RefreshCw
            className={`w-4 h-4 mr-1.5 ${activeJobsQuery.isFetching ? "animate-spin" : ""}`}
          />
          重新整理
        </Button>
      </div>

      <AssetModelSubpageGuide page="background-tasks" />

      {/* Stats */}
      <StatsBar jobs={allJobs} />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Tab filters */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === tab.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜尋任務..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {/* Job List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="hs-small !mb-0 text-muted-foreground">
            載入任務列表...
          </p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
          <Filter className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <p className="hs-small !mb-0 font-medium text-muted-foreground">
              {filter === "all" && !search
                ? "目前沒有任何背景任務"
                : "沒有符合條件的任務"}
            </p>
            <p className="hs-small !mb-0 text-muted-foreground/70 mt-1">
              在創作工作室或專業工作室提交生成任務，即可在此追蹤進度
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="hs-small !mb-0 text-muted-foreground">
            共 {filteredJobs.length} 筆任務
            {activeJobIds.length > 0 && (
              <span className="ml-2 text-primary font-medium">
                · {activeJobIds.length} 筆進行中
              </span>
            )}
          </p>

          <AnimatePresence mode="popLayout">
            {filteredJobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                onCheckStatus={handleCheckStatus}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
