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
import { usePersonalSettings } from "./PersonalSettingsContext";
import { ProactiveEventBus } from "@/lib/proactiveEventBus";
import { getRecentPlatformMention } from "@/lib/spiritWatchers";
import { describeBgSubmitError } from "./bgSubmitError";

// 總總（chief-orchestrator）觀察「同時跑的精靈數」用：每種 studioType 對應
// 哪位精靈正在工作。值是該精靈的暱稱（顯示用），key 對齊 StudioJobType。
const STUDIO_TYPE_TO_SPIRIT_NICKNAME: Record<string, string> = {
  image: "圖圖",
  video: "影影",
  audio: "音音",
  voice: "聲聲",
};

// 財財（accountant）警示用的「需要警告的高成本模型 prefix」。
// 點數本身不寫死 — submitTask 會用 trpc.accountant.estimate 拉真實 catalog
// 數字，這份表只回答「這個 modelId 是否值得跳一張 blocking 卡片」。
// 之前用 EXPENSIVE_MODEL_HINTS 把點數一起寫死，導致 modelPricing 改了之後
// 通知卡片永遠停留在舊數字；改成只判斷 prefix + 在 submitTask 內非同步
// fetch 真實點數，數字才不會漂移。
const EXPENSIVE_MODEL_PREFIXES: ReadonlyArray<{ pattern: string; label: string }> = [
  // 影片：Kling Pro / Standard / Runway / PixVerse / Hailuo 都值得警示
  { pattern: "kling-video/v2.1/pro", label: "Kling 2.1 Pro 影片" },
  { pattern: "kling-video/v2.1", label: "Kling 2.1 影片" },
  { pattern: "runway-gen4-turbo", label: "Runway Gen4 Turbo 影片" },
  { pattern: "pixverse/v4.5", label: "PixVerse v4.5 影片" },
  { pattern: "minimax/hailuo-02/pro", label: "Hailuo Pro 影片" },
  // 圖像：FLUX Pro 較貴
  { pattern: "flux-pro/v1.1", label: "FLUX Pro 1.1 圖像" },
  // 訓練：LoRA 最貴
  { pattern: "train", label: "LoRA 訓練" },
  // 音樂：Suno
  { pattern: "suno", label: "Suno V4 歌曲" },
];

function lookupExpensiveModel(modelId: string): { label: string } | null {
  const low = modelId.toLowerCase();
  for (const entry of EXPENSIVE_MODEL_PREFIXES) {
    if (low.includes(entry.pattern)) {
      return { label: entry.label };
    }
  }
  return null;
}

// 任務完成 / 失敗時的提示音；使用 Web Audio API 即時合成，不需要音檔資產。
// success=true 兩個上行音（C5→E5），success=false 兩個下行音（A4→E4），時長約 280ms。
function playCompletionTone(success: boolean) {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const freqs = success ? [523.25, 659.25] : [440, 329.63];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.13;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    // 無聲降級：使用者可能尚未與頁面互動造成 AudioContext 被擋
  }
}

// 透過瀏覽器 Notification API 發送桌面通知；權限/支援檢查在呼叫端。
function sendDesktopNotification(opts: {
  title: string;
  body: string;
  tag: string;
  onClick?: () => void;
}) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: "/favicon.ico",
      tag: opts.tag,
    });
    if (opts.onClick) {
      n.onclick = () => {
        window.focus();
        opts.onClick?.();
        n.close();
      };
    }
  } catch {
    // 部分行動瀏覽器禁用建構式 Notification；忽略即可
  }
}

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
  /** SSE 即時推送是否正常連線（false = 降級到 5s 輪詢） */
  sseConnected: boolean;
  /** Preview URLs captured from SSE complete events, keyed by jobId — available immediately, before DB refetch */
  previewUrls: Record<number, string>;
  /** 通知 context 一個已在 DB 的 job 剛開始（例如 DirectorAI 伺服器端建立的任務），
   *  立即觸發 activeJobs 重抓並啟動 5s 輪詢，讓 drawer badge 即時反映。 */
  notifyJobStarted: (jobId: number) => void;
}

const BackgroundTasksContext =
  createContext<BackgroundTasksContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 5000; // 5 秒輪詢一次

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const utils = trpc.useUtils();
  const { settings } = usePersonalSettings();
  // 使用 ref 讓非同步輪詢/SSE 回呼能讀到最新設定，無需把 effect 加到依賴
  const notifyPrefsRef = useRef({
    soundEnabled: settings.soundEnabled,
    desktopNotif: settings.desktopNotif,
  });
  useEffect(() => {
    notifyPrefsRef.current = {
      soundEnabled: settings.soundEnabled,
      desktopNotif: settings.desktopNotif,
    };
  }, [settings.soundEnabled, settings.desktopNotif]);

  // 追蹤進行中的 jobId，用於逐一 checkStudioJob
  const [activeJobIds, setActiveJobIds] = useState<number[]>([]);

  // AIDV-353：SSE 連線狀態。false = 降級到 REST polling（5 秒輪詢已常態啟動）。
  const [sseConnected, setSseConnected] = useState(true);
  const sseDisconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AIDV-431：從 SSE complete 事件即時取得 preview_url，無需等 DB refetch。
  const [previewUrlsByJobId, setPreviewUrlsByJobId] = useState<Record<number, string>>({});

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

  // ─── 總總（chief-orchestrator）watchdog ────────────────────────────────
  // 當同時有 ≥3 個不同模態的精靈在跑任務時，總總冒出 toast 給團隊現況摘要：
  // 進行中 / 排隊 / 剛完成的數量 + 建議下一棒。這是 ProactiveTriggerEvent
  // `team_status_overview` 對應的 publisher（之前沒人發 → 總總靜默）。
  // dedupe 5 分鐘並依「同時跑的精靈集合」做 key — 集合一變才重新通知，避免
  // 同樣三位輪流刷新時連續跳。
  const completedRef = useRef<number>(0);
  const lastTeamSnapshotRef = useRef<string>("");
  useEffect(() => {
    const running = tasks.filter(
      t => t.status === "queued" || t.status === "processing",
    );
    const justCompleted = tasks.filter(
      t => t.status === "completed",
    ).length;
    // 用 distinct studioType 數量代理「不同精靈」數，因為一個 studio 對一位精靈。
    const distinctSpirits = new Set(
      running.map(t => STUDIO_TYPE_TO_SPIRIT_NICKNAME[t.studioType])
        .filter(Boolean),
    );
    if (distinctSpirits.size < 3) return;
    const queuedCount = running.filter(t => t.status === "queued").length;
    const runningCount = running.filter(t => t.status === "processing").length;
    // 建議「下一棒」：找一個還沒被佔用的常用精靈來收尾。如果圖/影/音/聲全在跑，
    // 建議交給品品（critic）做整體性收尾。
    const candidatePool = ["品品", "巧巧", "記記"]; // 收尾型角色
    const nextSpirit =
      candidatePool.find(c => !distinctSpirits.has(c)) ?? "品品";
    const snapshot = Array.from(distinctSpirits).sort().join(",");
    if (snapshot === lastTeamSnapshotRef.current) return;
    lastTeamSnapshotRef.current = snapshot;
    ProactiveEventBus.publish(
      "team_status_overview",
      {
        runningCount,
        queuedCount,
        completedCount: Math.max(0, justCompleted - completedRef.current),
        nextSpirit,
      },
      { dedupeKey: `team:${snapshot}`, dedupeMs: 5 * 60_000 },
    );
    completedRef.current = justCompleted;
  }, [tasks]);

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
            const prefs = notifyPrefsRef.current;
            if (prefs.soundEnabled) playCompletionTone(true);
            if (prefs.desktopNotif && document.visibilityState !== "visible") {
              sendDesktopNotification({
                title: `${label} 已完成`,
                body: "點擊回到 Healing Studio 查看結果",
                tag: `bg-task-${jobId}-completed`,
                onClick: () => setDrawerOpen(true),
              });
            }
            // 群群 (community-manager)：剛完成的素材 + 最近 30 分鐘內有提過
            // 社群平台 → 主動提案配標題、hashtag、排程。30 分鐘窗口是
            // notePlatformMention 在 spiritWatchers.ts 設定的 TTL。
            const platform = getRecentPlatformMention();
            if (platform) {
              const studioType = (meta?.studioType as string) ?? "media";
              const assetType =
                studioType === "image"
                  ? "圖片"
                  : studioType === "video"
                    ? "短影音"
                    : studioType === "audio"
                      ? "音樂"
                      : studioType === "voice"
                        ? "配音"
                        : "素材";
              ProactiveEventBus.publish(
                "social_post_ready",
                {
                  assetType,
                  platform: platform.platform,
                  timing: platform.timing,
                },
                {
                  dedupeKey: `social:${jobId}:${platform.platform}`,
                  dedupeMs: 30 * 60_000,
                },
              );
            }
            // 刷新 activeJobs 列表
            activeJobsQuery.refetch();
          } else if (result.status === "failed" && prev !== "failed") {
            const meta = result.resultJson as Record<string, unknown> | null;
            const label = (meta?.label as string) || "任務";
            toast.error(`❌ ${label} 失敗`, {
              description: result.errorMessage || "請重試",
            });
            const prefs = notifyPrefsRef.current;
            if (prefs.soundEnabled) playCompletionTone(false);
            if (prefs.desktopNotif && document.visibilityState !== "visible") {
              sendDesktopNotification({
                title: `${label} 失敗`,
                body: result.errorMessage || "請重試",
                tag: `bg-task-${jobId}-failed`,
                onClick: () => setDrawerOpen(true),
              });
            }
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
  // AIDV-353：追蹤 SSE 連線狀態；斷線 5 秒後標記 sseConnected=false，觸發 banner。
  // REST polling（5s）已由 activeJobsQuery.refetchInterval 常態啟動，不需另外開。
  useEffect(() => {
    if (activeJobIds.length === 0 || typeof EventSource === "undefined") {
      if (sseDisconnectTimer.current) {
        clearTimeout(sseDisconnectTimer.current);
        sseDisconnectTimer.current = null;
      }
      setSseConnected(true);
      return;
    }

    const clearDisconnectTimer = () => {
      if (sseDisconnectTimer.current) {
        clearTimeout(sseDisconnectTimer.current);
        sseDisconnectTimer.current = null;
      }
    };

    const sources: EventSource[] = activeJobIds.map(jobId => {
      const es = new EventSource(`/api/generation-events/${jobId}`);
      es.onopen = () => {
        clearDisconnectTimer();
        setSseConnected(true);
      };
      es.onmessage = ev => {
        clearDisconnectTimer();
        setSseConnected(true);
        try {
          const event = JSON.parse(ev.data) as {
            type: string;
            message?: string;
            preview_url?: string;
          };
          if (event.type === "complete" || event.type === "error") {
            // AIDV-431：cache preview_url immediately before DB refetch completes
            if (event.type === "complete" && event.preview_url) {
              setPreviewUrlsByJobId(prev => ({ ...prev, [jobId]: event.preview_url! }));
            }
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
        // 5 秒內若無其他連線成功，標記斷線
        if (!sseDisconnectTimer.current) {
          sseDisconnectTimer.current = setTimeout(() => {
            setSseConnected(false);
            sseDisconnectTimer.current = null;
          }, 5000);
        }
      };
      return es;
    });

    return () => {
      sources.forEach(es => es.close());
      clearDisconnectTimer();
      setSseConnected(true);
    };
  }, [activeJobIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 提交新任務 ────────────────────────────────────────────────────────────
  const submitMutation = trpc.generate.submitStudioJob.useMutation();
  // 財財警示用：拿到剩餘點數估算「這次大概會花多少 %」
  const balanceQuery = trpc.credits.myBalance.useQuery(undefined, {
    staleTime: 60_000,
    retry: 1,
  });

  const submitTask = useCallback(
    async (params: {
      studioType: StudioJobType;
      requestId: string;
      modelId: string;
      label?: string;
      prompt?: string;
    }): Promise<number | null> => {
      // 財財 (accountant)：高成本動作預警。publish 是 blocking 等級事件，
      // 通知中心會顯示「這個動作大概會花 N 點」卡片由使用者確認；不阻擋
      // 實際提交（避免使用者按了又被卡，反而體驗差）。dedupe 用 modelId
      // 60 秒，避免使用者連點時連續跳。
      //
      // 之前用 EXPENSIVE_MODEL_HINTS 的 approxPoints 寫死數字 → modelPricing
      // 改了之後通知卡片永遠是舊的。改成走 accountant.estimate tRPC 拉真實
      // catalog 數字；fetch 失敗才 fallback 到 prefix 表只給「label + 0 pts」
      // 提示，至少 UI 不會因網路錯誤而吃下整次警示。
      const expensive = lookupExpensiveModel(params.modelId);
      if (expensive) {
        let predicted = 0;
        try {
          const est = await utils.accountant.estimate.fetch({
            modelId: params.modelId,
          });
          predicted = est.totalPoints;
        } catch {
          // tRPC fetch 失敗 — predicted 留 0，至少 opLabel 會顯示，
          // 使用者仍能看到「這個動作會貴」這個訊號。
        }
        const remaining = balanceQuery.data?.remaining;
        const pctOfRemaining =
          typeof remaining === "number" && remaining > 0 && predicted > 0
            ? Math.min(100, Math.round((predicted / remaining) * 100))
            : 0;
        ProactiveEventBus.publish(
          "expensive_op_about_to_run",
          {
            predicted,
            pctOfRemaining,
            opLabel: expensive.label,
          },
          { dedupeKey: `cost:${params.modelId}`, dedupeMs: 60_000 },
        );
      }
      try {
        const result = await submitMutation.mutateAsync(params);
        // 刷新活躍任務列表
        activeJobsQuery.refetch();
        return result.jobId;
      } catch (err) {
        // 之前這裡只 `return null` 把送出失敗整個吞掉；而唯一呼叫端
        // useRegisterBgTask 又丟棄回傳值，使用者端完全沒有任何回饋——沒有
        // toast、沒有 log，看起來像成功了。改成一致地 console.error + toast.error
        // 把失敗顯性化，同時保留 `return null` 契約（呼叫端對 null 的判斷不變）。
        const { title, description } = describeBgSubmitError(err);
        console.error("[BackgroundTasks] submitTask 失敗", err);
        toast.error(title, description ? { description } : undefined);
        return null;
      }
    },
    [submitMutation, activeJobsQuery, balanceQuery.data?.remaining, utils]
  );

  const notifyJobStarted = useCallback((jobId: number) => {
    setActiveJobIds(prev => (prev.includes(jobId) ? prev : [...prev, jobId]));
    void activeJobsQuery.refetch();
  }, [activeJobsQuery]);

  const value = useMemo<BackgroundTasksContextValue>(
    () => ({
      tasks,
      activeCount,
      submitTask,
      drawerOpen,
      setDrawerOpen,
      sseConnected,
      previewUrls: previewUrlsByJobId,
      notifyJobStarted,
    }),
    [tasks, activeCount, submitTask, drawerOpen, sseConnected, previewUrlsByJobId, notifyJobStarted]
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
