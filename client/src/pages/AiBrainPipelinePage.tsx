import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PipelineCanvas } from "@/components/brain-pipeline/PipelineCanvas";
import { SummaryBar } from "@/components/brain-pipeline/SummaryBar";
import { Skeleton } from "@/components/ui/skeleton";

export default function AiBrainPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const graphQuery = trpc.brainPipeline.getGraph.useQuery(undefined, {
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 h-[calc(100vh-4rem)] min-h-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          🧠 AI 大腦組態管線
        </h1>
        <p className="text-sm text-slate-500">
          全站視覺化儀表板：前端頁面 → 後端路由 → AI 大腦 / 光球代理 → 外部模型 API
          的即時健康狀態。點擊任何節點查看詳細原因與修復建議。
        </p>
      </header>

      <SummaryBar
        summary={graphQuery.data?.summary}
        isFetching={graphQuery.isFetching}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => graphQuery.refetch()}
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
          <PipelineCanvas graph={graphQuery.data} expandPageGroup={false} />
        )}
      </div>
    </div>
  );
}
