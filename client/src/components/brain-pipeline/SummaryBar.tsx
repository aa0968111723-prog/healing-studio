import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { PipelineSummary } from "@shared/brain-pipeline";
import { RefreshCw } from "lucide-react";

interface Props {
  summary: PipelineSummary | undefined;
  isFetching: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (next: boolean) => void;
  onRefresh: () => void;
}

const formatCount = (value: number | undefined) =>
  typeof value === "number" ? value.toString() : "—";

export function SummaryBar({
  summary,
  isFetching,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
}: Props) {
  return (
    <div className="flex items-center gap-3 flex-wrap p-4 rounded-2xl bg-white/60 dark:bg-slate-900/60 backdrop-blur border border-slate-200 dark:border-slate-800">
      <Badge className="bg-emerald-500 text-white">
        正常 {formatCount(summary?.healthy)}
      </Badge>
      <Badge className="bg-yellow-500 text-white">
        需優化 {formatCount(summary?.needsOptimization)}
      </Badge>
      <Badge className="bg-red-500 text-white">
        損壞 {formatCount(summary?.broken)}
      </Badge>
      <Badge className="bg-orange-500 text-white">
        異常 {formatCount(summary?.abnormal)}
      </Badge>

      <span className="text-xs text-slate-500 ml-2">
        共 {formatCount(summary?.totalNodes)} 個節點
        {summary?.lastUpdatedAt ? (
          <> · 最後更新 {new Date(summary.lastUpdatedAt).toLocaleTimeString("zh-TW")}</>
        ) : (
          <> · 尚未取得即時資料</>
        )}
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <Switch
          id="auto-refresh"
          checked={autoRefresh}
          onCheckedChange={onAutoRefreshChange}
        />
        <Label htmlFor="auto-refresh" className="text-xs cursor-pointer">
          每 30 秒自動更新
        </Label>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={isFetching}
        className="gap-1.5"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        重新檢測
      </Button>
    </div>
  );
}
