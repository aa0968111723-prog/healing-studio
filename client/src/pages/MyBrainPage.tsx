import { useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { PipelineCanvas } from "@/components/brain-pipeline/PipelineCanvas";
import { SummaryBar, type StatusFilter } from "@/components/brain-pipeline/SummaryBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";

export default function MyBrainPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [, navigate] = useLocation();

  // 純展示頁：只給光球 navigate 能力，不允許動作直接改 brain 配置（那是 admin 範疇）。
  // ALLOWLIST 與 capabilities.options 同步維護，光球只能跳到這 4 個目的地。
  const MY_BRAIN_NAV_ALLOWLIST = new Set<string>([
    "/my-brain",
    "/admin?section=brain",
    "/admin/brain-pipeline",
    "/settings/ai-brain",
  ]);
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
          { id: "/settings/ai-brain", label: "AI 大腦設定" },
        ],
      },
    ],
    state: {
      autoRefresh,
      statusFilter,
    },
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        if (!MY_BRAIN_NAV_ALLOWLIST.has(action.path)) {
          return {
            ok: false,
            reason: `my-brain: 不在允許跳轉清單：${action.path}`,
          };
        }
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
    placeholderData: keepPreviousData,
    staleTime: 25_000,
  });

  return (
    <div className="flex-1 flex flex-col gap-4 h-[calc(100vh-4rem)] min-h-0 page-shell page-shell-pad">
      <header className="page-header !mb-0">
        <p className="page-eyebrow">My Brain</p>
        <h1 className="page-title !mb-0">🧠 我的腦組態狀態</h1>
        <p className="page-subtitle">
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
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <div className="flex-1 min-h-0 rounded-2xl border border-border bg-card/40 overflow-hidden">
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
              <p className="text-sm text-muted-foreground">
                無法載入：{graphQuery.error?.message ?? "未知錯誤"}
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
