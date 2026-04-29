/**
 * BackgroundTasksContext — 全域背景任務追蹤
 *
 * 當使用者在 ImageStudio / VideoStudio / ProStudio 提交非同步任務時，
 * 透過此 context 將任務登錄到 background_jobs 表，並在任意頁面持續輪詢狀態。
 * 任務完成時自動發出 toast 通知。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StudioJobType = "image" | "video" | "audio" | "voice";

export interface BackgroundTask {
  jobId: number;
  studioType: StudioJobType;
  label?: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  progressMessage?: string;
  resultUrl?: string;
  resultJson?: Record<string, unknown>;
  errorMessage?: string;
  createdAt?: string;
}

interface BackgroundTasksContextValue {
  /** 所有背景任務（進行中 + 近 24hr 已完成） */
  tasks: BackgroundTask[];
  /** 進行中的任務數量 */
  activeCount: number;
  /** 提交一個新的工作室背景任務 */
  submitTask: (params: {
    studioType: StudioJobType;
    requestId: string;
    modelId: string;
    label?: string;
    prompt?: string;
  }) => Promise<number | null>;
  /** 是否展開背景任務面板 */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const BackgroundTasksContext =
  createContext<BackgroundTasksContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000; // 5 秒輪詢一次

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const utils = trpc.useUtils();

  // 追蹤進行中的 jobId，用於逐一 checkStudioJob
  const [activeJobIds, setActiveJobIds] = useState<number[]>([]);

  // ─── 查詢所有活躍任務 ──────────────────────────────────────────────────────
  const activeJobsQuery = trpc.generate.activeJobs.useQuery(undefined, {
    refetchInterval: activeJobIds.length > 0 ? POLL_INTERVAL : 30_000,
    refetchIntervalInBackground: true,
    retry: 2,
  });

  const tasks: BackgroundTask[] = useMemo(() => {
    const jobs = activeJobsQuery.data ?? [];
    return jobs.map(j => {
      const meta = j.resultJson as Record<string, unknown> | null;
      return {
        jobId: j.id,
        studioType:
          (meta?.studioType as StudioJobType) ?? (j.jobType as StudioJobType),
        label: meta?.label as string | undefined,
        status: j.status,
        progress: j.progress,
        progressMessage: j.progressMessage ?? undefined,
        resultUrl: meta?.resultUrl as string | undefined,
        resultJson: meta ?? undefined,
        errorMessage: j.errorMessage ?? undefined,
        createdAt: j.createdAt
          ? new Date(j.createdAt).toISOString()
          : undefined,
      };
    });
  }, [activeJobsQuery.data]);

  const activeCount = useMemo(
    () =>
      tasks.filter(t => t.status === "queued" || t.status === "processing")
        .length,
    [tasks]
  );

  // ─── 逐一輪詢進行中任務（觸發 server 端 fal.ai 狀態同步）──────────────────
  const prevStatusRef = useRef<Record<number, string>>({});

  useEffect(() => {
    const processing = tasks
      .filter(t => t.status === "queued" || t.status === "processing")
      .map(t => t.jobId);
    setActiveJobIds(processing);
  }, [tasks]);

  // 為每個 activeJobId 定期 checkStudioJob（保險路徑：webhook 漏 / SSE 斷掉時仍會跑）
  useEffect(() => {
    if (activeJobIds.length === 0) return;

    const check = async () => {
      for (const jobId of activeJobIds) {
        try {
          const result = await utils.generate.checkStudioJob.fetch({ jobId });
          if (!result) continue;

          const prev = prevStatusRef.current[jobId];
          if (result.status === "completed" && prev !== "completed") {
            const meta = result.resultJson as Record<string, unknown> | null;
            const label = (meta?.label as string) || "任務";
            toast.success(`✅ ${label} 已完成！`, {
              description: "點擊查看結果",
              action: {
                label: "查看",
                onClick: () => setDrawerOpen(true),
              },
            });
            // 刷新 activeJobs 列表
            activeJobsQuery.refetch();
          } else if (result.status === "failed" && prev !== "failed") {
            const meta = result.resultJson as Record<string, unknown> | null;
            const label = (meta?.label as string) || "任務";
            toast.error(`❌ ${label} 失敗`, {
              description: result.errorMessage || "請重試",
            });
            activeJobsQuery.refetch();
          }
          prevStatusRef.current[jobId] = result.status;
        } catch {
          // 忽略查詢失敗
        }
      }
    };

    check(); // 立即檢查一次
    const timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [activeJobIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── SSE 訂閱：webhook 抵達時立即收到完成/失敗事件，免等下一輪 5s 輪詢 ──
  useEffect(() => {
    if (activeJobIds.length === 0 || typeof EventSource === "undefined") return;

    const sources: EventSource[] = activeJobIds.map(jobId => {
      const es = new EventSource(`/api/generation-events/${jobId}`);
      es.onmessage = ev => {
        try {
          const event = JSON.parse(ev.data) as {
            type: string;
            message?: string;
          };
          if (event.type === "complete" || event.type === "error") {
            // 立即觸發 activeJobs 重抓 + checkStudioJob 同步狀態
            void activeJobsQuery.refetch();
            void utils.generate.checkStudioJob.fetch({ jobId });
            es.close();
          }
        } catch {
          // 忽略 heartbeat / 格式不符的訊息
        }
      };
      es.onerror = () => {
        // SSE 斷線就靠輪詢 fallback；這裡不主動重連避免風暴
        es.close();
      };
      return es;
    });

    return () => {
      sources.forEach(es => es.close());
    };
  }, [activeJobIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 提交新任務 ────────────────────────────────────────────────────────────
  const submitMutation = trpc.generate.submitStudioJob.useMutation();

  const submitTask = useCallback(
    async (params: {
      studioType: StudioJobType;
      requestId: string;
      modelId: string;
      label?: string;
      prompt?: string;
    }): Promise<number | null> => {
      try {
        const result = await submitMutation.mutateAsync(params);
        // 刷新活躍任務列表
        activeJobsQuery.refetch();
        return result.jobId;
      } catch {
        return null;
      }
    },
    [submitMutation, activeJobsQuery]
  );

  const value = useMemo<BackgroundTasksContextValue>(
    () => ({
      tasks,
      activeCount,
      submitTask,
      drawerOpen,
      setDrawerOpen,
    }),
    [tasks, activeCount, submitTask, drawerOpen]
  );

  return (
    <BackgroundTasksContext.Provider value={value}>
      {children}
    </BackgroundTasksContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx)
    throw new Error(
      "useBackgroundTasks must be used within BackgroundTasksProvider"
    );
  return ctx;
}

/**
 * useRegisterBgTask — 方便各工作室元件快速登錄背景任務。
 * 回傳 register(result, studioType, label, prompt)，適用於任何 fal.ai async mutation 結果。
 */
export function useRegisterBgTask() {
  const ctx = useContext(BackgroundTasksContext);
  return useCallback(
    async (result: unknown, studioType: StudioJobType, label?: string, prompt?: string) => {
      if (!ctx) return;
      const r = result as Record<string, unknown> | null;
      // 提取 request_id 和 model_id（支援直接和 raw 嵌套格式）
      const requestId =
        (r?.request_id as string) ??
        ((r?.raw as Record<string, unknown>)?.request_id as string) ??
        null;
      const modelId =
        (r?.raw_model_id as string) ??
        ((r?.raw as Record<string, unknown>)?.raw_model_id as string) ??
        (r?.model as string) ??
        null;
      if (requestId && modelId) {
        await ctx.submitTask({ studioType, requestId, modelId, label, prompt });
      }
    },
    [ctx]
  );
}
