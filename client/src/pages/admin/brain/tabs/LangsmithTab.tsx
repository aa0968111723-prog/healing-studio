/**
 * AI 大腦組態 — LangSmith 監控分頁
 * Owns its own `trpc.langsmith.stats` query (30s refresh) and renders
 * KPI cards + recent runs table. Receives no props.
 */
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, RefreshCw } from "lucide-react";

export function LangsmithTab({ active }: { active: boolean }) {
  const statsQuery = trpc.langsmith.stats.useQuery(
    { limit: 50 },
    {
      enabled: active,
      refetchInterval: active ? 30_000 : false,
      retry: false,
    }
  );
  const stats = statsQuery.data;
  const loading = statsQuery.isFetching;
  const error = statsQuery.error
    ? statsQuery.error.message
    : !statsQuery.isLoading && statsQuery.data?.configured === false
      ? "LANGSMITH_API_KEY 未設定"
      : null;

  return (
    <div className="space-y-4">
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            LangSmith 監控
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => void statsQuery.refetch()}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            重新整理
          </Button>
        </div>

        {loading && !stats && <ZenSkeleton lines={6} />}

        {!loading && error && (
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-700 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              無法載入 LangSmith 資料
            </p>
            <p className="text-xs">{error}</p>
            {error.includes("LANGSMITH_API_KEY") && (
              <p className="text-xs mt-2">
                前往{" "}
                <a
                  href="https://smith.langchain.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  smith.langchain.com
                </a>{" "}
                取得 API Key,並在伺服器環境變數中設定{" "}
                <code className="bg-amber-500/20 px-1 rounded">
                  LANGSMITH_API_KEY
                </code>
                。
              </p>
            )}
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                {
                  label: "總呼叫次數",
                  value: stats.summary.totalRuns,
                  unit: "",
                },
                {
                  label: "平均延遲",
                  value: stats.summary.avgLatency,
                  unit: "ms",
                },
                {
                  label: "錯誤率",
                  value: stats.summary.errorRate,
                  unit: "%",
                },
                {
                  label: "Token 用量",
                  value: stats.summary.totalTokens.toLocaleString(),
                  unit: "",
                },
              ].map(kpi => (
                <div
                  key={kpi.label}
                  className="rounded-lg bg-muted/30 border border-white/10 p-3 text-center"
                >
                  <p className="text-[10px] text-muted-foreground mb-1">
                    {kpi.label}
                  </p>
                  <p className="text-lg font-bold text-foreground">
                    {kpi.value}
                    {kpi.unit && (
                      <span className="text-xs font-normal text-muted-foreground ml-0.5">
                        {kpi.unit}
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium">時間</th>
                    <th className="text-left py-2 pr-3 font-medium">名稱</th>
                    <th className="text-left py-2 pr-3 font-medium">狀態</th>
                    <th className="text-right py-2 pr-3 font-medium">延遲</th>
                    <th className="text-right py-2 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.runs.slice(0, 10).map(run => (
                    <tr
                      key={run.id}
                      className="border-b border-white/5 hover:bg-muted/20 transition-colors"
                    >
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {run.startTime
                          ? new Date(run.startTime).toLocaleString("zh-TW", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td
                        className="py-2 pr-3 max-w-[160px] truncate"
                        title={run.name}
                      >
                        {run.name || "—"}
                      </td>
                      <td className="py-2 pr-3">
                        {run.error || run.status === "error" ? (
                          <Badge
                            variant="secondary"
                            className="text-[9px] bg-red-500/10 text-red-600 border-red-500/20"
                          >
                            錯誤
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          >
                            成功
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right text-muted-foreground">
                        {run.latency != null
                          ? `${run.latency.toLocaleString()} ms`
                          : "—"}
                      </td>
                      <td className="py-2 text-right text-muted-foreground">
                        {run.totalTokens > 0
                          ? run.totalTokens.toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {stats.runs.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        尚無追蹤記錄
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}
