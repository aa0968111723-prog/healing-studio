import { useState } from "react";
import { useLocation } from "wouter";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PipelineCanvas } from "@/components/brain-pipeline/PipelineCanvas";
import {
  SummaryBar,
  type StatusFilter,
  type ViewMode,
} from "@/components/brain-pipeline/SummaryBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";

export default function AiBrainPipelinePage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("brain");
  const [, navigate] = useLocation();

  // 純展示頁；只給 navigate 並用 ALLOWLIST 限制目的地。
  const BRAIN_PIPELINE_NAV_ALLOWLIST = new Set<string>([
    "/admin",
    "/admin?section=brain",
    "/admin/api-usage",
    "/admin/brain-pipeline",
  ]);
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
    state: {
      autoRefresh,
      statusFilter,
      viewMode,
    },
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        if (!BRAIN_PIPELINE_NAV_ALLOWLIST.has(action.path)) {
          return {
            ok: false,
            reason: `admin-brain-pipeline: 不在允許跳轉清單：${action.path}`,
          };
        }
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

  // 「重新檢測」：先觸發後端真實 ping 巡檢，完成後再 refetch 取最新圖。
  // 巡檢期間按鈕保持 disabled 狀態，避免重複呼叫。
  const runPatrol = trpc.brainPipeline.runPatrol.useMutation();
  const handleRefresh = async () => {
    try {
      const result = await runPatrol.mutateAsync();
      toast.success(
        `已完成檢測：${result.checked} 個服務，${result.alerts} 筆新警報`
      );
    } catch (err) {
      toast.error(
        `檢測失敗：${err instanceof Error ? err.message : "未知錯誤"}`
      );
    } finally {
      graphQuery.refetch();
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 gap-4 h-[calc(100vh-4rem)] min-h-0">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground">
          🧠 AI 大腦組態管線 ＆ 全站關係圖
        </h1>
        <p className="text-sm text-muted-foreground">
          六層視覺化儀表板：瀏覽器 → 前端頁面 → API/tRPC → AI 大腦 / 光球代理 →
          外部模型 → 資料庫 / 部署平台 的即時健康狀態。可切換「站點 / 大腦 / 運作 / 完整」
          四種視圖；「運作」視圖適合向主管或新成員介紹網站如何運作。
        </p>
      </header>

      <SummaryBar
        summary={graphQuery.data?.summary}
        isFetching={graphQuery.isFetching || runPatrol.isPending}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={handleRefresh}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
                無法載入管線圖：{graphQuery.error?.message ?? "未知錯誤"}
              </p>
              <p className="text-xs text-muted-foreground">
                此頁面僅限 admin 存取。請確認你的帳號權限。
              </p>
            </div>
          </div>
        )}
        {graphQuery.data && (
          <PipelineCanvas
            graph={graphQuery.data}
            expandPageGroup={viewMode === "site"}
            statusFilter={statusFilter}
            viewMode={viewMode}
          />
        )}
      </div>
    </div>
  );
}
