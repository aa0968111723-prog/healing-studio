/**
 * AI 大腦組態 — 爬網研究(Research)分頁
 * Owns its research / errors queries (errors used for category quick-search) +
 * webSearch / addToLearnHub mutations.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Search,
  Bug,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { ERROR_CATEGORY_EMOJI_LABELS } from "../_shared";

export function ResearchTab({
  active,
  pendingQuery,
  onPendingQueryConsumed,
}: {
  active: boolean;
  /** When the parent jumps in from Errors tab with a search query */
  pendingQuery?: string | null;
  /** Called once `pendingQuery` has been seeded into the input + search fired */
  onPendingQueryConsumed?: () => void;
}) {
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");

  const errorsQuery = trpc.brain.errorTraces.useQuery(undefined, {
    enabled: active,
    staleTime: 60_000,
  });
  const researchQuery = trpc.brain.researchResults.useQuery(undefined, {
    enabled: active,
    staleTime: 30_000,
  });
  const webSearchMut = trpc.brain.webSearch.useMutation({
    onSuccess: () => {
      toast.success("搜尋完成");
      void utils.brain.researchResults.invalidate();
      void utils.brain.monitorSummary.invalidate();
    },
    onError: err => toast.error(`搜尋失敗:${err.message}`),
  });
  const addToLearnHubMut = trpc.brain.addResearchToLearnHub.useMutation({
    onSuccess: () => {
      toast.success("已加入學習庫");
      void utils.brain.researchResults.invalidate();
    },
    onError: err => toast.error(`加入失敗:${err.message}`),
  });

  // Consume parent-provided query when active (jump from Errors tab)
  useEffect(() => {
    if (active && pendingQuery && pendingQuery.trim()) {
      setSearchQuery(pendingQuery);
      webSearchMut.mutate({ query: pendingQuery.trim() });
      onPendingQueryConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingQuery]);

  return (
    <div className="space-y-4">
      <GlassCard>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-500" />
          爬網找資料功能
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          搜尋開源模型、程式碼、API 文件等資源。搜尋結果可直接加入學習文件庫供 AI
          使用。
        </p>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="搜尋 AI 模型、API 錯誤修復方案..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && searchQuery.trim()) {
                webSearchMut.mutate({ query: searchQuery.trim() });
              }
            }}
            className="text-xs"
          />
          <Button
            size="sm"
            onClick={() =>
              searchQuery.trim() &&
              webSearchMut.mutate({ query: searchQuery.trim() })
            }
            disabled={webSearchMut.isPending || !searchQuery.trim()}
            className="shrink-0"
          >
            <Search className="w-3.5 h-3.5 mr-1" />
            {webSearchMut.isPending ? "搜尋中..." : "搜尋"}
          </Button>
        </div>

        {(() => {
          const unresolvedErrors = (errorsQuery.data ?? []).filter(
            t => !t.resolvedAt
          );
          if (unresolvedErrors.length === 0) return null;

          const categoryGroups: Record<string, typeof unresolvedErrors> = {};
          for (const t of unresolvedErrors) {
            const cat = t.errorCategory ?? "unknown";
            if (!categoryGroups[cat]) categoryGroups[cat] = [];
            categoryGroups[cat].push(t);
          }

          return (
            <div className="mb-4 space-y-3">
              <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                <Bug className="w-3 h-3 text-red-400" />
                依錯誤分類搜尋修復方案:
              </p>
              {Object.entries(categoryGroups).map(([cat, traces]) => {
                const label = ERROR_CATEGORY_EMOJI_LABELS[cat] ?? cat;
                const uniqueEngines = Array.from(
                  new Set(traces.map(t => t.engine))
                );
                return (
                  <div key={cat} className="space-y-1">
                    <p className="text-[10px] font-medium text-foreground/80">
                      {label} ({traces.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {uniqueEngines.slice(0, 8).map(engine => {
                        const errorCount = traces.filter(
                          t => t.engine === engine
                        ).length;
                        const errMsg =
                          traces.find(t => t.engine === engine)?.errorMessage ??
                          "";
                        const query =
                          cat !== "unknown"
                            ? `${engine} ${cat.replace("_", " ")} error fix solution`
                            : `${engine} API error fix ${errMsg.slice(0, 60)}`;
                        return (
                          <Button
                            key={engine}
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-7 border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-600"
                            onClick={() => {
                              setSearchQuery(query);
                              webSearchMut.mutate({ query });
                            }}
                            disabled={webSearchMut.isPending}
                          >
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {engine.split("/").pop()}
                            {errorCount > 1 && (
                              <Badge
                                variant="secondary"
                                className="text-[8px] ml-1 px-1 py-0 h-3.5"
                              >
                                ×{errorCount}
                              </Badge>
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </GlassCard>

      <GlassCard>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          搜尋結果
        </h3>
        {researchQuery.isLoading ? (
          <ZenSkeleton lines={3} />
        ) : (
          <div className="space-y-2">
            {(researchQuery.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground/60 py-4 text-center">
                尚無搜尋結果,請在上方輸入搜尋詞
              </p>
            )}
            {(researchQuery.data ?? []).map(r => (
              <div
                key={r.id}
                className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[9px]">
                        {r.source}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        相關度 {r.relevance}%
                      </span>
                      {r.addedToLearnHub && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] bg-emerald-500/10 text-emerald-600"
                        >
                          已加入學習庫
                        </Badge>
                      )}
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {r.title}
                    </a>
                    <p className="text-muted-foreground mt-1">
                      {r.summary.slice(0, 200)}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(r.createdAt).toLocaleString("zh-TW")}
                    </p>
                  </div>
                  {!r.addedToLearnHub && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[10px] h-7 shrink-0"
                      onClick={() =>
                        addToLearnHubMut.mutate({ researchId: r.id })
                      }
                      disabled={addToLearnHubMut.isPending}
                    >
                      <BookOpen className="w-3 h-3 mr-1" />
                      加入學習庫
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
