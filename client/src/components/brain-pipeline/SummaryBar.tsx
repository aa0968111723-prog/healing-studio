import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type {
  PipelineSummary,
  PipelineNodeStatus,
} from "@shared/brain-pipeline";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusFilter = "all" | PipelineNodeStatus | "issues";

/**
 * 視圖模式：
 * - site：站點視圖（只顯示 page / page-group），給「全站關係圖」場景。
 * - brain：大腦視圖（router / brain / engine / provider / orb / director），
 *          當前 admin 監控頁的預設行為。
 * - full：完整視圖，把瀏覽器→頁面→API→中介層→服務→tRPC→大腦→引擎→外部 Provider
 *          →資料表→基礎設施→建構流水線→品質閘全部畫進來，適合深度排查。
 * - infra：「網站如何運作」視圖；強調 client / api / data / infrastructure，
 *          隱藏 brain/engine 細節。給主管或非工程同仁看「請求是怎麼走的」。
 * - data：資料視圖；強調 DB 表、repository、service、storage，協助理解資料流向。
 */
export type ViewMode = "site" | "brain" | "full" | "infra" | "data";

interface Props {
  summary: PipelineSummary | undefined;
  isFetching: boolean;
  autoRefresh: boolean;
  onAutoRefreshChange: (next: boolean) => void;
  onRefresh: () => void;
  /** 目前的狀態篩選；不傳 = 不啟用篩選功能 */
  statusFilter?: StatusFilter;
  onStatusFilterChange?: (next: StatusFilter) => void;
  /** 視圖模式；不傳 = 不顯示切換器（給 personal /my-brain 頁用） */
  viewMode?: ViewMode;
  onViewModeChange?: (next: ViewMode) => void;
}

const formatCount = (value: number | undefined) =>
  typeof value === "number" ? value.toString() : "—";

/** 把絕對時間轉成「N 分鐘前」白話描述。 */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "剛剛";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  return `${Math.round(hr / 24)} 天前`;
}

export function SummaryBar({
  summary,
  isFetching,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  statusFilter = "all",
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
}: Props) {
  const showViewToggle =
    typeof viewMode === "string" && typeof onViewModeChange === "function";
  const filterable = typeof onStatusFilterChange === "function";
  const handleFilter = (next: StatusFilter) => {
    if (!filterable) return;
    // 同一徽章再點一次 = 取消篩選
    onStatusFilterChange!(statusFilter === next ? "all" : next);
  };
  const issuesCount =
    (summary?.needsOptimization ?? 0) +
    (summary?.broken ?? 0) +
    (summary?.abnormal ?? 0);

  return (
    <div className="flex items-center gap-3 flex-wrap p-4 rounded-2xl surface-2 backdrop-blur border border-border">
      {showViewToggle && (
        <>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={value => {
              // ToggleGroup 在「再點同一個」時會回傳空字串，這時不切換。
              if (
                value === "site" ||
                value === "brain" ||
                value === "full" ||
                value === "infra" ||
                value === "data"
              ) {
                onViewModeChange!(value);
              }
            }}
            className="h-7 rounded-md border border-border surface-2"
          >
            <ToggleGroupItem
              value="site"
              className="h-7 px-2.5 text-xs"
              aria-label="站點視圖"
            >
              站點
            </ToggleGroupItem>
            <ToggleGroupItem
              value="brain"
              className="h-7 px-2.5 text-xs"
              aria-label="大腦視圖"
            >
              大腦
            </ToggleGroupItem>
            <ToggleGroupItem
              value="infra"
              className="h-7 px-2.5 text-xs"
              aria-label="運作視圖"
              title="瀏覽器 → API → 資料庫 → 部署平台的端到端關係圖"
            >
              運作
            </ToggleGroupItem>
            <ToggleGroupItem
              value="data"
              className="h-7 px-2.5 text-xs"
              aria-label="資料視圖"
              title="DB 表、Repository、Service、Storage 的資料流向"
            >
              資料
            </ToggleGroupItem>
            <ToggleGroupItem
              value="full"
              className="h-7 px-2.5 text-xs"
              aria-label="完整視圖"
            >
              完整
            </ToggleGroupItem>
          </ToggleGroup>
          <span className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
        </>
      )}

      <FilterBadge
        active={statusFilter === "healthy"}
        clickable={filterable}
        className="bg-emerald-500 text-white"
        onClick={() => handleFilter("healthy")}
        data-testid="filter-healthy"
      >
        正常 {formatCount(summary?.healthy)}
      </FilterBadge>
      <FilterBadge
        active={statusFilter === "needs_optimization"}
        clickable={filterable}
        className="bg-yellow-500 text-white"
        onClick={() => handleFilter("needs_optimization")}
        data-testid="filter-needs-optimization"
      >
        需優化 {formatCount(summary?.needsOptimization)}
      </FilterBadge>
      <FilterBadge
        active={statusFilter === "broken"}
        clickable={filterable}
        className="bg-red-500 text-white"
        onClick={() => handleFilter("broken")}
        data-testid="filter-broken"
      >
        損壞 {formatCount(summary?.broken)}
      </FilterBadge>
      <FilterBadge
        active={statusFilter === "abnormal"}
        clickable={filterable}
        className="bg-orange-500 text-white"
        onClick={() => handleFilter("abnormal")}
        data-testid="filter-abnormal"
      >
        異常 {formatCount(summary?.abnormal)}
      </FilterBadge>

      {filterable && (
        <Button
          size="sm"
          variant={statusFilter === "issues" ? "default" : "outline"}
          onClick={() => handleFilter("issues")}
          className="h-7 text-xs"
          disabled={issuesCount === 0}
          data-testid="filter-issues"
        >
          只看問題 {issuesCount > 0 ? `(${issuesCount})` : ""}
        </Button>
      )}

      <span className="text-xs text-slate-500 ml-2">
        共 {formatCount(summary?.totalNodes)} 個節點
        {summary?.lastUpdatedAt ? (
          <>
            {" "}
            · 最後更新{" "}
            <span title={new Date(summary.lastUpdatedAt).toLocaleString("zh-TW")}>
              {formatRelative(summary.lastUpdatedAt)}
            </span>
          </>
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

interface FilterBadgeProps {
  active: boolean;
  clickable: boolean;
  className: string;
  onClick: () => void;
  children: React.ReactNode;
  "data-testid"?: string;
}

function FilterBadge({
  active,
  clickable,
  className,
  onClick,
  children,
  ...rest
}: FilterBadgeProps) {
  if (!clickable) {
    return <Badge className={className}>{children}</Badge>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={rest["data-testid"]}
      className={cn(
        "transition-all rounded-md outline-none",
        active
          ? "ring-2 ring-offset-1 ring-slate-900 dark:ring-slate-100 scale-105"
          : "opacity-90 hover:opacity-100 hover:scale-105"
      )}
    >
      <Badge className={cn(className, "cursor-pointer")}>{children}</Badge>
    </button>
  );
}
