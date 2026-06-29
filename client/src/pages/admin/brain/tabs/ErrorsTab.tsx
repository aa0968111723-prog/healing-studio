/**
 * AI 大腦組態 — 錯誤線索(Errors)分頁
 * Owns errors / diagnosis queries + resolve mutation. Receives `focusedTraceId`
 * (jump-target from summary panel) and `onJumpToResearch` (callback that
 * flips the parent's activeTab to "research" and seeds the search box).
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bug,
  Search,
  Check,
  AlertTriangle,
  Lightbulb,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import {
  ERROR_CATEGORY_LABEL_MAP,
  ERROR_CATEGORY_COLOR_MAP,
} from "../_shared";

export function ErrorsTab({
  active,
  focusedTraceId,
  onJumpToResearch,
}: {
  active: boolean;
  focusedTraceId: string | null;
  onJumpToResearch: (query: string) => void;
}) {
  const utils = trpc.useUtils();
  const [expandedDiagnosisId, setExpandedDiagnosisId] = useState<string | null>(
    null
  );

  // Auto-expand the trace when parent focuses on one (jump-from-summary).
  useEffect(() => {
    if (active && focusedTraceId) {
      setExpandedDiagnosisId(focusedTraceId);
    }
  }, [active, focusedTraceId]);

  const errorsQuery = trpc.brain.errorTraces.useQuery(undefined, {
    enabled: active,
    staleTime: 12_000,
    refetchInterval: 15_000,
  });
  const diagnosisQuery = trpc.brain.diagnoseError.useQuery(
    { traceId: expandedDiagnosisId ?? "" },
    {
      enabled: !!expandedDiagnosisId && active,
      // Diagnosis is deterministic for a given trace — keep it warm.
      staleTime: 5 * 60_000,
    }
  );
  const resolveErrorMut = trpc.brain.resolveError.useMutation({
    onSuccess: () => {
      void utils.brain.errorTraces.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`標記失敗:${err.message}`),
  });

  return (
    <div className="space-y-4">
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Bug className="w-4 h-4 text-red-500" />
          生成錯誤線索系統
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          追蹤所有失敗的生成任務,自動分析根因、爬網搜尋修復方案,並提供步驟式解決指南。
        </p>
        {errorsQuery.isLoading ? (
          <ZenSkeleton lines={4} />
        ) : errorsQuery.isError ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-2 py-4 text-center text-xs text-red-600"
          >
            <p>錯誤記錄載入失敗，無法確認是否真的沒有錯誤。</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void errorsQuery.refetch()}
            >
              <Search className="w-3 h-3 mr-1" />
              重試
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {(errorsQuery.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                ✅ 目前沒有錯誤記錄
              </p>
            )}
            {(errorsQuery.data ?? []).map(trace => {
              const isExpanded = expandedDiagnosisId === trace.id;
              const categoryLabel = trace.errorCategory
                ? (ERROR_CATEGORY_LABEL_MAP[trace.errorCategory] ??
                  trace.errorCategory)
                : null;
              const categoryColor = trace.errorCategory
                ? (ERROR_CATEGORY_COLOR_MAP[trace.errorCategory] ?? "")
                : "";
              return (
                <div
                  key={trace.id}
                  id={`error-trace-${trace.id}`}
                  className={`rounded-lg border p-3 text-xs transition-all scroll-mt-24 ${
                    trace.resolvedAt
                      ? "opacity-50 border-muted"
                      : "border-red-500/20 bg-red-500/5"
                  } ${
                    focusedTraceId === trace.id
                      ? "ring-2 ring-amber-500 shadow-lg"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <Badge variant="outline" className="text-[9px]">
                          {trace.modality}
                        </Badge>
                        <span className="font-medium">{trace.engine}</span>
                        {trace.errorCode && (
                          <Badge variant="secondary" className="text-[9px]">
                            {trace.errorCode}
                          </Badge>
                        )}
                        {categoryLabel && (
                          <Badge
                            variant="secondary"
                            className={`text-[9px] ${categoryColor}`}
                          >
                            {categoryLabel}
                          </Badge>
                        )}
                        {trace.rootCauseConfidence != null &&
                          trace.rootCauseConfidence > 0 && (
                            <span className="text-[9px] text-muted-foreground">
                              信心度 {trace.rootCauseConfidence}%
                            </span>
                          )}
                        {trace.resolvedAt && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] bg-emerald-500/10 text-emerald-600"
                          >
                            已解決
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground break-all">
                        {trace.errorMessage.slice(0, 200)}
                      </p>
                      {trace.rootCause && (
                        <p className="text-[10px] text-amber-600 mt-1">
                          🔍 根因:{trace.rootCause.slice(0, 150)}
                        </p>
                      )}
                      {trace.webSearchResult && (
                        <p className="text-[10px] text-blue-500/80 mt-1">
                          🌐 {trace.webSearchResult.slice(0, 150)}...
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {new Date(trace.createdAt).toLocaleString("zh-TW")}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {!trace.resolvedAt && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`text-[10px] h-7 ${isExpanded ? "border-blue-500 text-blue-600" : ""}`}
                            onClick={() =>
                              setExpandedDiagnosisId(isExpanded ? null : trace.id)
                            }
                          >
                            <Search className="w-3 h-3 mr-1" />
                            {isExpanded ? "收起" : "診斷"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-7"
                            onClick={() =>
                              resolveErrorMut.mutate({
                                traceId: trace.id,
                                resolution: "手動標記已解決",
                              })
                            }
                            disabled={resolveErrorMut.isPending}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            解決
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-blue-500/20">
                      {diagnosisQuery.isLoading ? (
                        <ZenSkeleton lines={3} />
                      ) : diagnosisQuery.data ? (
                        <div className="space-y-3">
                          <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5">
                            <p className="text-[10px] font-semibold text-amber-700 mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              根因分析(信心度{" "}
                              {diagnosisQuery.data.rootCauseConfidence}%)
                            </p>
                            <p className="text-[11px] text-amber-900/80">
                              {diagnosisQuery.data.rootCause}
                            </p>
                          </div>

                          {diagnosisQuery.data.relatedTraceIds.length > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              🔗 發現{" "}
                              {diagnosisQuery.data.relatedTraceIds.length}{" "}
                              筆相關錯誤(同一引擎或分類)
                            </p>
                          )}

                          <div>
                            <p className="text-[10px] font-semibold text-foreground mb-2 flex items-center gap-1">
                              <Lightbulb className="w-3 h-3 text-yellow-500" />
                              步驟式解決方案
                            </p>
                            <div className="space-y-2">
                              {diagnosisQuery.data.suggestedSteps.map(s => (
                                <div
                                  key={s.step}
                                  className={`rounded-md border p-2 ${
                                    s.action === "check"
                                      ? "border-blue-500/20 bg-blue-500/5"
                                      : s.action === "fix"
                                        ? "border-emerald-500/20 bg-emerald-500/5"
                                        : s.action === "verify"
                                          ? "border-indigo-500/20 bg-indigo-500/5"
                                          : "border-orange-500/20 bg-orange-500/5"
                                  }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                        s.action === "check"
                                          ? "bg-blue-500/20 text-blue-700"
                                          : s.action === "fix"
                                            ? "bg-emerald-500/20 text-emerald-700"
                                            : s.action === "verify"
                                              ? "bg-indigo-500/20 text-indigo-700"
                                              : "bg-orange-500/20 text-orange-700"
                                      }`}
                                    >
                                      {s.step}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-medium">
                                        {s.title}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {s.description}
                                      </p>
                                      {s.command && (
                                        <pre className="mt-1 text-[9px] bg-black/5 dark:bg-white/5 rounded px-2 py-1 whitespace-pre-wrap font-mono text-muted-foreground">
                                          {s.command}
                                        </pre>
                                      )}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={`text-[8px] shrink-0 ${
                                        s.action === "check"
                                          ? "text-blue-600"
                                          : s.action === "fix"
                                            ? "text-emerald-600"
                                            : s.action === "verify"
                                              ? "text-indigo-600"
                                              : "text-orange-600"
                                      }`}
                                    >
                                      {s.action === "check"
                                        ? "檢查"
                                        : s.action === "fix"
                                          ? "修復"
                                          : s.action === "verify"
                                            ? "驗證"
                                            : "備援"}
                                    </Badge>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {diagnosisQuery.data.searchQueries.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-foreground mb-1.5 flex items-center gap-1">
                                <Globe className="w-3 h-3 text-blue-500" />
                                建議搜尋關鍵字
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {diagnosisQuery.data.searchQueries.map((q, i) => (
                                  <Button
                                    key={i}
                                    size="sm"
                                    variant="outline"
                                    className="text-[9px] h-6 border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-600"
                                    onClick={() => onJumpToResearch(q)}
                                  >
                                    <Search className="w-2.5 h-2.5 mr-0.5" />
                                    {q.slice(0, 40)}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          無法取得診斷資訊
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
