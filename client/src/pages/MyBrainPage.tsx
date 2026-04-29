import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { PipelineCanvas } from "@/components/brain-pipeline/PipelineCanvas";
import { SummaryBar } from "@/components/brain-pipeline/SummaryBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";

export default function MyBrainPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, navigate] = useLocation();

  // 純展示頁：只給光球 navigate 能力，不允許動作直接改 brain 配置（那是 admin 範疇）。
  useRegisterPageAgent({
    pageId: "my-brain",
    pageLabel: "我的大腦",
    pagePath: "/my-brain",
    capabilities: [
      {
        action: "navigate",
        label: "前往大腦相關頁",
        options: [
          { id: "/my-brain", label: "我的大腦" },
          { id: "/admin?section=brain", label: "AI 大腦組態（需管理員）" },
          { id: "/admin/brain-pipeline", label: "推理鏈視覺化" },
        ],
      },
    ],
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        navigate(action.path);
        return { ok: true };
      }
      return { ok: false, reason: `my-brain: unsupported action "${action.type}"` };
    },
  });

  const graphQuery = trpc.brainPipeline.getMyGraph.useQuery(undefined, {
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 h-[calc(100vh-4rem)] min-h-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          🧠 我的腦組態狀態
        </h1>
        <p className="text-sm text-slate-500">
          看看你目前選用的 5 個推理大腦、4 個生成引擎，以及光球代理／導演 AI
          的即時運作狀況。點擊節點查看詳細說明與建議。
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
                無法載入：{graphQuery.error?.message ?? "未知錯誤"}
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
