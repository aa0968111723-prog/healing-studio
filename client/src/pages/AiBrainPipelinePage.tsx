import { useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { PipelineCanvas } from "@/components/brain-pipeline/PipelineCanvas";
import { SummaryBar, type StatusFilter } from "@/components/brain-pipeline/SummaryBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";

export default function AiBrainPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [, navigate] = useLocation();

  useRegisterPageAgent({
    pageId: "admin-brain-pipeline",
    pageLabel: "大腦推理鏈視覺化",
    pagePath: "/admin/brain-pipeline",
    capabilities: [
      {
        action: "navigate",
        label: "前往管理子頁",
        options: [
          { id: "/admin", label: "管理後台首頁" },
          { id: "/admin?section=brain", label: "AI 大腦組態" },
          { id: "/admin/api-usage", label: "API 用量分析" },
          { id: "/admin/brain-pipeline", label: "推理鏈視覺化" },
        ],
      },
    ],
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        navigate(action.path);
        return { ok: true };
      }
      return { ok: false, reason: `admin-brain-pipeline: unsupported action "${action.type}"` };
    },
  });

  const graphQuery = trpc.brainPipeline.getGraph.useQuery(undefined, {
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
    // 重新 fetch 時保留上一筆資料，避免畫布閃爍／重新跑 dagre 佈局
    placeholderData: keepPreviousData,
    // 與 refetchInterval 對齊，避免 mount/Tab 切換造成額外 fetch
    staleTime: 25_000,
  });

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 h-[calc(100vh-4rem)] min-h-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          🧠 AI 大腦組態管線
        </h1>
        <p className="text-sm text-slate-500">
          全站視覺化儀表板：前端頁面 → 後端路由 → AI 大腦 / 光球代理 → 外部模型 API
          的即時健康狀態。僅顯示系統實測資料，不使用預設假數值。點擊任何節點查看詳細原因與修復建議。
        </p>
      </header>

      <SummaryBar
        summary={graphQuery.data?.summary}
        isFetching={graphQuery.isFetching}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => graphQuery.refetch()}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <div className="flex-1 min-h-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-950/40 overflow-hidden">
        {graphQuery.isLoading && (
          <div className="p-6 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {graphQuery.isError && (
          <div className="flex items-center justify-center h-full p-6 text-center">
            <div className="space-y-2 max-w-md">
              <div className="text-3xl">⚠</div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                無法載入管線圖：{graphQuery.error?.message ?? "未知錯誤"}
              </p>
              <p className="text-xs text-slate-500">
                此頁面僅限 admin 存取。請確認你的帳號權限。
              </p>
            </div>
          </div>
        )}
        {graphQuery.data && (
          <PipelineCanvas
            graph={graphQuery.data}
            expandPageGroup={false}
            statusFilter={statusFilter}
          />
        )}
      </div>
    </div>
  );
}
