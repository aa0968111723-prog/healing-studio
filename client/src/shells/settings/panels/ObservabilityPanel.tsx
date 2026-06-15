// ============================================================================
// shells/settings/panels/ObservabilityPanel.tsx — 觀測（LangSmith / 背景任務）
// ----------------------------------------------------------------------------
// 對映開發計畫 §P6「/settings/observability 看 langsmith/process/tasks」+ 盤點背景任務。
// 真實接點：
//   langsmith.status() / langsmith.stats({...}) → AI 監控狀態 / 統計（protectedProcedure）✅
//   admin.allBackgroundJobs({limit}) → 全站背景任務（adminProcedure → 僅 admin/leader 顯示）✅
//   admin.systemStats() → 系統概覽（adminProcedure）                                        ✅
// RBAC：langsmith 任何登入者可看；背景任務 / 系統統計僅 admin（前端隱藏，後端再守）。
// ============================================================================
import { Gauge, Activity, ServerCog } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useRole, roleAtLeast } from "../rbac";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelError } from "@/shells/_shared/PanelState";
// U-8（AIDV-98 / 傘卡 U-2·AIDV-92）逐殼採用 · /settings：旗標 ON 時系統概覽的統計卡改用
// design-kit 亮色暖光 StatCard（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有版＝零變化。
// 純展示、label/value 1:1 忠實對映、無控制項＝零功能損失（與 /learn CreditsUsagePanel·MiniStat 同寫法）。
// 設計門（ui-ux-pro-max --domain ux）命中「Number Formatting：數值由呼叫端格式化後傳入」→ 兩版皆原樣呈現。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, StatCard as DkStatCard } from "@/components/design-kit";

export function ObservabilityPanel() {
  const role = useRole();
  const isAdmin = role === "admin";

  const lsQ = trpc.langsmith.status.useQuery(undefined, { retry: false });
  const jobsQ = trpc.admin.allBackgroundJobs.useQuery({ limit: 30 }, { retry: false, enabled: isAdmin });
  const statsQ = trpc.admin.systemStats.useQuery(undefined, { retry: false, enabled: isAdmin });

  const ls: any = lsQ.data ?? {};
  const jobs: any[] = (jobsQ.data as any[]) ?? (jobsQ.data as any)?.items ?? [];
  const stats: any = statsQ.data ?? {};

  return (
    <div className="space-y-4">
      {/* LangSmith */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4" />LangSmith（AI 監控）</div>
          {lsQ.isLoading
            ? <Skeleton className="h-5 w-16" />
            : <Badge variant={ls.connected || ls.enabled || ls.ok ? "secondary" : "outline"}>
                {ls.connected || ls.enabled || ls.ok ? "已連接" : "未設定"}
              </Badge>}
        </div>
        <p className="text-[11px] text-muted-foreground">追蹤 LLM 呼叫鏈、延遲、成本（langsmith.status / stats）。未設金鑰時為 no-op。</p>
      </Card>

      {/* 系統概覽（admin） */}
      {isAdmin && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><ServerCog className="h-4 w-4" />系統概覽</div>
          {statsQ.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="總使用者" value={stats.totalUsers ?? stats.userCount ?? "—"} />
              <Stat label="總生成" value={stats.totalGenerations ?? stats.generationCount ?? "—"} />
              <Stat label="總成本" value={stats.totalCost != null ? `$${Number(stats.totalCost).toFixed(2)}` : "—"} />
              <Stat label="數位資產" value={stats.totalAssets ?? stats.assetCount ?? "—"} />
            </div>
          )}
        </Card>
      )}

      {/* 背景任務（admin） */}
      {isAdmin ? (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4" />背景任務</div>
            <span className="text-[11px] text-muted-foreground">background_jobs</span>
          </div>
          {jobsQ.isError ? (
            <PanelError compact message="讀取背景任務失敗（需管理員權限）。" onRetry={() => jobsQ.refetch()} />
          ) : jobsQ.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
          ) : jobs.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">無背景任務。</div>
          ) : (
            <div className="max-h-72 overflow-auto divide-y">
              {jobs.map((j, i) => {
                const status = j.status ?? "—";
                const variant = status === "done" || status === "completed" ? "secondary"
                  : status === "failed" ? "destructive" : "outline";
                return (
                  <div key={j.id ?? i} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="flex-1 truncate">{j.label ?? j.kind ?? j.type ?? "任務"}</span>
                    <Badge variant={variant as any} className="text-[10px]">{status}</Badge>
                    <span className="text-[10px] text-muted-foreground">{j.createdAt ? new Date(j.createdAt).toLocaleDateString("zh-TW") : ""}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-5 text-xs text-muted-foreground">背景任務 / 系統統計需管理員權限。</Card>
      )}
    </div>
  );
}

/** 統計卡：旗標 ON 時改用 design-kit 亮色暖光 StatCard；OFF（預設）＝既有版＝零變化。value 由呼叫端先格式化。 */
export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkStatCard label={label} value={value} />
      </AidvKit>
    );
  }
  return (
    <div className="rounded-lg border p-2.5 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}

export default ObservabilityPanel;
