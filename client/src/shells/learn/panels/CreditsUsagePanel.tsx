// ============================================================================
// shells/learn/panels/CreditsUsagePanel.tsx — 積分 & API 用量
// ----------------------------------------------------------------------------
// 對映盤點 §3-16：積分餘額 + 取得方式 + 安全保障；用量紀錄。
// 真實接點（皆 protectedProcedure；未登入時優雅顯示 — ）：
//   credits.myBalance() → { remaining, topModel, totalSpentPoints, usedPct }   ✅
//   dashboard.myStats() → { remainingGenerations, totalRequests, totalCost, recentLogs[], modalityBreakdown[], dailyTrend[] } ✅
//   dashboard.myUsageLogs({limit}) → 個人用量紀錄                               ✅
//   credits.pricingCatalog() → 各模型定價（public）                            ✅
// 註：扣點＝伺服器內部（credits 無 spend）；用量寫入＝apiUsage.upsert（admin）。
// ============================================================================
import { Coins, TrendingUp, Receipt } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export function CreditsUsagePanel() {
  const balanceQ = trpc.credits.myBalance.useQuery(undefined, { retry: false });
  const statsQ = trpc.dashboard.myStats.useQuery(undefined, { retry: false });
  const logsQ = trpc.dashboard.myUsageLogs.useQuery({ limit: 20 }, { retry: false });

  const b: any = balanceQ.data ?? {};
  const stats: any = statsQ.data ?? {};
  const logs: any[] = (logsQ.data as any[]) ?? [];

  const remaining = b.remaining ?? stats.remainingGenerations ?? 0;
  const usedPct = Number(b.usedPct ?? 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_1.6fr] gap-4">
      {/* 餘額 + 月成本 */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Coins className="h-4 w-4" />方案 · 積分</div>
        {balanceQ.isLoading ? (
          <Skeleton className="h-12 w-32" />
        ) : (
          <div>
            <div className={`text-4xl font-bold ${remaining < 120 ? "text-destructive" : "text-amber-500"}`}>
              {Number(remaining).toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">可用積分 · pts</div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>已用比例</span><span>{usedPct}%</span>
          </div>
          <Progress value={usedPct} className="h-2" />
        </div>

        {b.topModel && (
          <div className="text-[11px] text-muted-foreground">近 30 天高耗模型：<b>{b.topModel}</b></div>
        )}

        <div className="rounded-lg bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
          先扣後生成 · 失敗全額退還 · 最小扣 1 pts / 安全上限 500 pts · 積分永久有效，不需信用卡。
        </div>
      </Card>

      {/* 用量紀錄 */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Receipt className="h-4 w-4" />用量紀錄</div>
          <span className="text-[11px] text-muted-foreground">api_usage_logs · ai_usage_events</span>
        </div>

        {/* 成本概覽 */}
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="本期請求" value={stats.totalRequests ?? "—"} />
          <MiniStat label="本期成本" value={stats.totalCost != null ? `$${Number(stats.totalCost).toFixed(3)}` : "—"} />
          <MiniStat label="剩餘配額" value={Number(remaining).toLocaleString()} />
        </div>

        {logsQ.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">尚無用量紀錄（或未登入）。</div>
        ) : (
          <div className="max-h-72 overflow-auto divide-y">
            {logs.map((u, i) => {
              const ts = u.createdAt ?? u.ts ?? u.date;
              const kind = u.requestType ?? u.kind ?? u.type ?? "—";
              const model = u.model ?? u.modelId ?? "";
              const cost = Number(u.cost ?? u.totalCost ?? u.costUsd ?? 0);
              return (
                <div key={u.id ?? i} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0">
                    {ts ? new Date(ts).toLocaleDateString("zh-TW") : "—"}
                  </span>
                  <span className="flex-1 truncate">{kind}{model ? <span className="text-muted-foreground"> · {model}</span> : null}</span>
                  <span className="text-amber-600 tabular-nums">${cost.toFixed(3)}</span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
          <TrendingUp className="h-3 w-3" />全站供應商用量分析在 /settings → 管理後台 → 成本金流（admin）。
        </div>
      </Card>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

export default CreditsUsagePanel;
