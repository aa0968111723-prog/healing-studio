/**
 * AgentCodexPage — 光球 AI 代理代碼大全
 *
 * 把 shared/agent-codex 的條目以卡片清單呈現。支援：
 *   - 上方搜尋框（同步進 URL ?q=）
 *   - 左側分類 chip（一鍵切換 / 跳到分類錨點）
 *   - 條目卡片：title + summary + aliases + examples（點 example 帶回光球輸入框）
 *   - 上方「複製為 markdown」按鈕（給 LLM 當 system prompt 補丁用）
 *
 * 設計重點：
 *   - 純前端讀取共用大全資料；無 backend 呼叫，可離線顯示
 *   - 跟 /command-palette 一致的鍵盤可用性（Esc 清搜尋、Enter 跳第一個條目）
 *   - 條目順序與 CODEX_CATEGORY_ORDER 對齊，UI 永遠跟 source-of-truth 同步
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  BookOpen,
  Copy,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import {
  CODEX_CATEGORY_LABELS,
  CODEX_CATEGORY_ORDER,
  buildCodexMarkdown,
  getAllCodexEntries,
  getCodexStats,
  searchCodex,
  type CodexCategory,
  type CodexEntry,
} from "../../../shared/agent-codex";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const PAGE_TITLE = "光球 AI 代理・代碼大全";
const PAGE_SUBTITLE =
  "把 25 位精靈、36 個頁面、所有 / 指令、接棒網絡、主動觸發收攏成一份可搜尋的全圖。打 /codex 也能進來。";

function readInitialQuery(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("q")?.trim() ?? "";
}

export default function AgentCodexPage() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState(readInitialQuery);
  const [activeCategory, setActiveCategory] = useState<CodexCategory | "all">("all");

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
    const nextUrl = next ? `/codex?${next}` : "/codex";
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [query]);

  const stats = useMemo(() => getCodexStats(), []);

  // 搜尋結果（query 為空時退回 all）
  const filteredEntries = useMemo<readonly CodexEntry[]>(() => {
    const base = query.trim() ? searchCodex(query, 500) : getAllCodexEntries();
    if (activeCategory === "all") return base;
    return base.filter(e => e.category === activeCategory);
  }, [query, activeCategory]);

  // 依分類分群（保留 CODEX_CATEGORY_ORDER 順序）
  const grouped = useMemo(() => {
    const byCat = new Map<CodexCategory, CodexEntry[]>();
    for (const entry of filteredEntries) {
      const list = byCat.get(entry.category) ?? [];
      list.push(entry);
      byCat.set(entry.category, list);
    }
    return CODEX_CATEGORY_ORDER
      .map(cat => ({ category: cat, entries: byCat.get(cat) ?? [] }))
      .filter(g => g.entries.length > 0);
  }, [filteredEntries]);

  const handleCopyMarkdown = async () => {
    try {
      const md = buildCodexMarkdown(
        query.trim() ? { entries: filteredEntries } : undefined
      );
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(md);
        toast.success("已複製大全 markdown 到剪貼簿");
      } else {
        toast.error("此瀏覽器不支援剪貼簿 API");
      }
    } catch (err) {
      toast.error(`複製失敗：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleNavigateExample = (example: string, entry: CodexEntry) => {
    // 若是 navigate 類，直接跳；否則把例子塞進 chat 輸入框（透過 hash event）
    if (entry.refs.pagePath) {
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

  return (
    <div className="flex-1 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 max-w-7xl mx-auto w-full">
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <BookOpen className="h-8 w-8 text-violet-500" />
          <h1 className="hs-h1 text-foreground">{PAGE_TITLE}</h1>
        </div>
        <p className="hs-p text-muted-foreground">{PAGE_SUBTITLE}</p>
      </header>

      <CodexStatsBar stats={stats} />

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
              count={filteredEntries.length}
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

      {filteredEntries.length === 0 ? (
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
                    onPickExample={handleNavigateExample}
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

function EntryCard({
  entry,
  onPickExample,
}: {
  entry: CodexEntry;
  onPickExample: (example: string, entry: CodexEntry) => void;
}) {
  return (
    <Card className="h-full hover:shadow-md transition-shadow">
      <CardContent className="py-4 px-4 space-y-2">
        <div className="font-medium text-sm leading-snug break-words">
          {entry.title}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {entry.summary}
        </p>
        {entry.aliases.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.aliases.slice(0, 5).map(alias => (
              <Badge key={alias} variant="outline" className="text-[10px] py-0">
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
      </CardContent>
    </Card>
  );
}
