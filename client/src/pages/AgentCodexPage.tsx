/**
 * AgentCodexPage — 光球 AI 代理代碼大全（深度版）
 *
 * 把 shared/agent-codex 的 ~480 條目以卡片清單呈現。支援：
 *   - 上方搜尋框（同步進 URL ?q=；同義詞展開）
 *   - 上方分類 chip（一鍵切換）
 *   - 「今日特輯」隨機條目（每日固定一條）
 *   - 條目卡片：title + summary + aliases + examples + 相關條目 chips
 *   - 命中欄位高亮（title 命中標粗體 / underline）
 *   - 上方「複製為 markdown」按鈕
 *   - URL hash 深連結（/codex#spirit#director → 滾動到該卡片並 highlight）
 *
 * 設計重點：
 *   - 純前端讀取共用大全資料；無 backend 呼叫，可離線顯示
 *   - 條目順序與 CODEX_CATEGORY_ORDER 對齊，UI 永遠跟 source-of-truth 同步
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  BookOpen,
  Copy,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";

import {
  CODEX_CATEGORY_LABELS,
  CODEX_CATEGORY_ORDER,
  buildCodexMarkdown,
  getAllCodexEntries,
  getCodexEntry,
  getCodexStats,
  getRelatedEntries,
  pickFeatureOfTheDay,
  searchCodexDetailed,
  type CodexCategory,
  type CodexEntry,
  type SearchHit,
} from "../../../shared/agent-codex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const PAGE_TITLE = "光球 AI 代理・代碼大全";
const PAGE_SUBTITLE =
  "25 精靈・25 技能・36 頁面・6 工作流・148 工具・126 接棒・16 主動觸發 — 一份可搜尋的全圖。打 /codex 也能進來。";

function readInitialQuery(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("q")?.trim() ?? "";
}

function readInitialHash(): string {
  if (typeof window === "undefined") return "";
  return decodeURIComponent(window.location.hash.replace(/^#/, ""));
}

export default function AgentCodexPage() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState(readInitialQuery);
  const [activeCategory, setActiveCategory] = useState<CodexCategory | "all">("all");
  const [highlightedId, setHighlightedId] = useState<string>(readInitialHash);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // URL <-> state 同步：搜尋字串變化時更新 ?q=（不污染 history）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    const next = params.toString();
    const hash = highlightedId ? `#${encodeURIComponent(highlightedId)}` : window.location.hash;
    const nextUrl = `/codex${next ? `?${next}` : ""}${hash}`;
    if (window.location.pathname + window.location.search + window.location.hash !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [query, highlightedId]);

  // 進站時若有 hash → 捲到對應卡片
  useEffect(() => {
    if (!highlightedId) return;
    const el = cardRefs.current.get(highlightedId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // 5 秒後解除 highlight（避免長期紅框）
      const t = setTimeout(() => setHighlightedId(""), 5000);
      return () => clearTimeout(t);
    }
  }, [highlightedId]);

  const stats = useMemo(() => getCodexStats(), []);
  const featureOfDay = useMemo(() => pickFeatureOfTheDay(), []);

  // 搜尋結果含命中欄位資訊
  const searchHits = useMemo<readonly SearchHit[]>(() => {
    if (!query.trim()) {
      return getAllCodexEntries().map(entry => ({
        entry,
        score: 0,
        matchedFields: [] as readonly ("title" | "alias" | "summary" | "details")[],
      }));
    }
    return searchCodexDetailed(query, 500);
  }, [query]);

  const filteredHits = useMemo(() => {
    if (activeCategory === "all") return searchHits;
    return searchHits.filter(h => h.entry.category === activeCategory);
  }, [searchHits, activeCategory]);

  const matchedFieldsById = useMemo(() => {
    const m = new Map<string, readonly ("title" | "alias" | "summary" | "details")[]>();
    for (const h of searchHits) m.set(h.entry.id, h.matchedFields);
    return m;
  }, [searchHits]);

  // 依分類分群（保留 CODEX_CATEGORY_ORDER 順序）
  const grouped = useMemo(() => {
    const byCat = new Map<CodexCategory, CodexEntry[]>();
    for (const hit of filteredHits) {
      const list = byCat.get(hit.entry.category) ?? [];
      list.push(hit.entry);
      byCat.set(hit.entry.category, list);
    }
    return CODEX_CATEGORY_ORDER
      .map(cat => ({ category: cat, entries: byCat.get(cat) ?? [] }))
      .filter(g => g.entries.length > 0);
  }, [filteredHits]);

  const handleCopyMarkdown = async () => {
    try {
      const md = buildCodexMarkdown(
        query.trim() ? { entries: filteredHits.map(h => h.entry) } : undefined
      );
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(md);
        toast.success(`已複製大全 markdown 到剪貼簿（${filteredHits.length} 條）`);
      } else {
        toast.error("此瀏覽器不支援剪貼簿 API");
      }
    } catch (err) {
      toast.error(`複製失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleNavigateExample = (example: string, entry: CodexEntry) => {
    if (entry.refs.pagePath && !entry.refs.quickAction) {
      setLocation(entry.refs.pagePath);
      return;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("orb-prefill-input", { detail: { text: example } })
      );
    }
    toast.info(`已預填到光球輸入框：${example}`);
  };

  const handleJumpToEntry = (id: string) => {
    setHighlightedId(id);
    setActiveCategory("all"); // 確保跳過去能看到
  };

  const registerCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.current.set(id, el);
    } else {
      cardRefs.current.delete(id);
    }
  };

  return (
    <div className="page-shell page-shell-wide w-full">
      <header className="page-header">
        <p className="page-eyebrow">Agent Codex</p>
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-violet-500" />
          <h1 className="page-title !mb-0">{PAGE_TITLE}</h1>
        </div>
        <p className="page-subtitle">{PAGE_SUBTITLE}</p>
      </header>

      <CodexStatsBar stats={stats} />

      {featureOfDay && !query.trim() && (
        <Card className="mb-4 border-violet-200 dark:border-violet-900 bg-gradient-to-r from-violet-50/50 to-pink-50/50 dark:from-violet-950/30 dark:to-pink-950/30">
          <CardContent className="py-3 px-4 flex items-start gap-3">
            <Star className="h-5 w-5 text-violet-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase text-violet-600 dark:text-violet-300 mb-1">
                今日特輯
              </div>
              <button
                type="button"
                className="text-sm font-medium hover:underline text-left"
                onClick={() => handleJumpToEntry(featureOfDay.id)}
              >
                {featureOfDay.title}
              </button>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {featureOfDay.summary}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-md py-3 mb-4 border-b">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
              placeholder="搜尋功能、精靈暱稱、頁面、指令…（例如「影片」「成本」「@導導」）"
              className="pl-9 pr-9"
              aria-label="搜尋大全"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground"
                aria-label="清除搜尋"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleCopyMarkdown}
            className="shrink-0"
          >
            <Copy className="h-4 w-4 mr-2" />
            複製為 markdown
          </Button>
        </div>

        <ScrollArea className="mt-3">
          <div className="flex gap-2 pb-1">
            <CategoryChip
              label="全部"
              active={activeCategory === "all"}
              count={filteredHits.length}
              onClick={() => setActiveCategory("all")}
            />
            {CODEX_CATEGORY_ORDER.map(cat => {
              const count = stats.byCategory[cat];
              if (!count) return null;
              return (
                <CategoryChip
                  key={cat}
                  label={CODEX_CATEGORY_LABELS[cat]}
                  active={activeCategory === cat}
                  count={count}
                  onClick={() => setActiveCategory(cat)}
                />
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {filteredHits.length === 0 ? (
        <Card className="bg-muted/30">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="hs-p">沒找到符合「{query}」的功能。試試「影片 / 成本 / 跳頁 / @導導」這類關鍵字。</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <section key={group.category} id={`codex-${group.category}`}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="hs-h2 text-foreground">
                  {CODEX_CATEGORY_LABELS[group.category]}
                </h2>
                <Badge variant="secondary" className="text-xs">
                  {group.entries.length}
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {group.entries.map(entry => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    matchedFields={matchedFieldsById.get(entry.id) ?? []}
                    isHighlighted={entry.id === highlightedId}
                    onPickExample={handleNavigateExample}
                    onJumpToEntry={handleJumpToEntry}
                    registerRef={registerCardRef(entry.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 子元件 ────────────────────────────────────────────────────────────────

function CodexStatsBar({ stats }: { stats: ReturnType<typeof getCodexStats> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      <StatTile label="條目總數" value={stats.total} />
      <StatTile label="精靈" value={stats.byCategory.spirit} />
      <StatTile label="頁面" value={stats.byCategory.page} />
      <StatTile label="主動觸發" value={stats.byCategory.trigger} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="bg-card/60">
      <CardContent className="py-3 px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function CategoryChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors",
        active
          ? "bg-violet-500 text-white border-violet-500"
          : "bg-background hover:bg-muted text-foreground border-border"
      )}
    >
      {label}
      <span className={cn("ml-1.5", active ? "text-white/70" : "text-muted-foreground")}>
        {count}
      </span>
    </button>
  );
}

type MatchField = "title" | "alias" | "summary" | "details";

function EntryCard({
  entry,
  matchedFields,
  isHighlighted,
  onPickExample,
  onJumpToEntry,
  registerRef,
}: {
  entry: CodexEntry;
  matchedFields: readonly MatchField[];
  isHighlighted: boolean;
  onPickExample: (example: string, entry: CodexEntry) => void;
  onJumpToEntry: (id: string) => void;
  registerRef: (el: HTMLDivElement | null) => void;
}) {
  const titleMatched = matchedFields.includes("title");
  const aliasMatched = matchedFields.includes("alias");
  const related = entry.related.length > 0 ? getRelatedEntries(entry.id, 6) : [];

  return (
    <div ref={registerRef} className="h-full">
      <Card
        className={cn(
          "h-full hover:shadow-md transition-shadow",
          isHighlighted &&
            "ring-2 ring-violet-500 ring-offset-2 ring-offset-background animate-pulse"
        )}
      >
        <CardContent className="py-4 px-4 space-y-2">
          <div
            className={cn(
              "font-medium text-sm leading-snug break-words",
              titleMatched && "underline decoration-violet-500 decoration-2 underline-offset-2"
            )}
          >
            {entry.title}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {entry.summary}
          </p>
          {entry.aliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.aliases.slice(0, 5).map(alias => (
                <Badge
                  key={alias}
                  variant="outline"
                  className={cn(
                    "text-[10px] py-0",
                    aliasMatched && "border-violet-500/60 text-violet-700 dark:text-violet-300"
                  )}
                >
                  {alias}
                </Badge>
              ))}
            </div>
          )}
          {entry.examples.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {entry.examples.slice(0, 3).map(ex => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => onPickExample(ex, entry)}
                  className="text-[11px] px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/70 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          )}
          {entry.details && entry.details !== entry.summary && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground py-1">
                展開細節
              </summary>
              <div className="mt-1 pl-2 border-l border-border whitespace-pre-line leading-relaxed">
                {entry.details}
              </div>
            </details>
          )}
          {related.length > 0 && (
            <div className="pt-2 border-t border-border/40">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">相關</div>
              <div className="flex flex-wrap gap-1">
                {related.map(rel => (
                  <button
                    key={rel.id}
                    type="button"
                    onClick={() => onJumpToEntry(rel.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground transition-colors max-w-[180px] truncate"
                    title={rel.title}
                  >
                    {rel.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
