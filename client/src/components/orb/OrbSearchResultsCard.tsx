/**
 * OrbSearchResultsCard.tsx — Rich rendering for site-wide search results.
 *
 * Displays a kind-tagged grid of results returned by `orbProxy.unifiedSearch`.
 * Click → SPA navigation via wouter. Avoids markdown plumbing because chat
 * renderers don't run a full markdown parser (only URL → anchor in
 * ChatMessageText).
 *
 * Used by ProactiveOrbWidget + AgentChat alongside the prose message body.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowDownAZ,
  ArrowUpRight,
  BookOpen,
  CalendarRange,
  Clock,
  Database,
  FileText,
  ImageIcon,
  Mic,
  Music,
  Notebook,
  TrendingUp,
  Video,
} from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { ChatSearchResultItem } from "@/contexts/GlobalOrbChatContext";

export type SearchKindFilter = "all" | ChatSearchResultItem["kind"];
export type SearchSortMode = "relevance" | "recent";

export const ORB_SEARCH_PAGE_SIZE = 6;

interface Props {
  query?: string;
  items: ChatSearchResultItem[];
  /** Compact density for the floating widget (smaller paddings + 1 col on narrow). */
  compact?: boolean;
}

const KIND_META: Record<
  ChatSearchResultItem["kind"],
  { label: string; icon: typeof ImageIcon; tone: string }
> = {
  asset: { label: "素材", icon: ImageIcon, tone: "text-cyan-700 bg-cyan-100/70 border-cyan-200" },
  note: { label: "筆記", icon: Notebook, tone: "text-emerald-700 bg-emerald-100/70 border-emerald-200" },
  history: { label: "生成記錄", icon: Clock, tone: "text-amber-700 bg-amber-100/70 border-amber-200" },
  tutorial: { label: "教學", icon: BookOpen, tone: "text-violet-700 bg-violet-100/70 border-violet-200" },
  teaching: { label: "資料庫", icon: Database, tone: "text-indigo-700 bg-indigo-100/70 border-indigo-200" },
};

const MODALITY_ICON: Partial<Record<NonNullable<ChatSearchResultItem["modality"]>, typeof ImageIcon>> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  voice: Mic,
  script: FileText,
};

function formatRelative(at?: number): string | null {
  if (!at) return null;
  const ageMs = Date.now() - at;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 30) return `${Math.floor(days / 7)} 週前`;
  if (days < 365) return `${Math.floor(days / 30)} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** Pure helper — filter + sort items per the user's chip selection. Exported
 *  so the unit tests can pin the exact precedence (filter before sort, sort
 *  ties broken by score desc). */
export function applySearchRefinement(
  items: ChatSearchResultItem[],
  options: { kind: SearchKindFilter; thisWeekOnly: boolean; sort: SearchSortMode },
  now: number = Date.now()
): ChatSearchResultItem[] {
  const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;
  let filtered = items;
  if (options.kind !== "all") {
    filtered = filtered.filter(i => i.kind === options.kind);
  }
  if (options.thisWeekOnly) {
    filtered = filtered.filter(i => typeof i.at === "number" && i.at >= weekCutoff);
  }
  if (options.sort === "recent") {
    return [...filtered].sort((a, b) => {
      const aAt = a.at ?? 0;
      const bAt = b.at ?? 0;
      if (aAt !== bAt) return bAt - aAt;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }
  // "relevance" preserves the server's score-desc order with recent tie-break.
  return [...filtered].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    return (b.at ?? 0) - (a.at ?? 0);
  });
}

export default function OrbSearchResultsCard({ query, items, compact }: Props) {
  const [, navigate] = useLocation();
  const [kindFilter, setKindFilter] = useState<SearchKindFilter>("all");
  const [thisWeekOnly, setThisWeekOnly] = useState(false);
  const [sort, setSort] = useState<SearchSortMode>("relevance");
  const [page, setPage] = useState(1);

  // Group BEFORE filtering so chip counts always reflect the full result set
  // (otherwise clicking "素材" would zero out every other chip).
  const counts = useMemo(() => {
    const out: Partial<Record<ChatSearchResultItem["kind"], number>> = {};
    for (const item of items) out[item.kind] = (out[item.kind] ?? 0) + 1;
    return out;
  }, [items]);

  const refined = useMemo(
    () => applySearchRefinement(items, { kind: kindFilter, thisWeekOnly, sort }),
    [items, kindFilter, thisWeekOnly, sort]
  );

  // Refinement changes can shrink the result set out from under the current
  // page (e.g. user paged to 2/2, then enabled "本週" leaving only 3 items).
  // Reset to page 1 on any input or refinement change.
  useEffect(() => {
    setPage(1);
  }, [items, kindFilter, thisWeekOnly, sort]);

  const totalPages = Math.max(1, Math.ceil(refined.length / ORB_SEARCH_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () =>
      refined.slice(
        (safePage - 1) * ORB_SEARCH_PAGE_SIZE,
        safePage * ORB_SEARCH_PAGE_SIZE
      ),
    [refined, safePage]
  );

  if (!items || items.length === 0) return null;

  // Only show the "本週" toggle when at least one item carries a timestamp;
  // tutorials don't have createdAt, so for tutorial-only result sets the
  // toggle would silently zero everything and be useless.
  const hasAnyAt = items.some(i => typeof i.at === "number");

  const kindOrder: SearchKindFilter[] = ["all"];
  for (const k of ["asset", "note", "history", "tutorial"] as const) {
    if (counts[k]) kindOrder.push(k);
  }

  return (
    <div
      data-testid="orb-search-results-card"
      className={`mt-2 rounded-2xl border border-cyan-200/50 bg-card/90 backdrop-blur-sm ${
        compact ? "p-2" : "p-3"
      } shadow-sm`}
    >
      {/* Header line: query echo + filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5 px-1">
        {query ? (
          <span className="text-[11px] font-medium text-foreground/90">「{query}」</span>
        ) : null}
        {kindOrder.map(kind => {
          const isActive = kindFilter === kind;
          if (kind === "all") {
            return (
              <button
                key="all"
                type="button"
                onClick={() => setKindFilter("all")}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                  isActive
                    ? "border-border bg-muted text-white"
                    : "border-border bg-card text-muted-foreground hover:border-border"
                }`}
                data-testid="orb-search-filter-chip"
                data-chip-kind="all"
                data-chip-active={isActive}
              >
                全部 · {items.length}
              </button>
            );
          }
          const meta = KIND_META[kind];
          return (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(isActive ? "all" : kind)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                isActive
                  ? `${meta.tone} ring-2 ring-offset-1 ring-current/20 font-medium`
                  : `${meta.tone} opacity-60 hover:opacity-100`
              }`}
              data-testid="orb-search-filter-chip"
              data-chip-kind={kind}
              data-chip-active={isActive}
            >
              <meta.icon className="w-3 h-3" />
              {meta.label} · {counts[kind]}
            </button>
          );
        })}
      </div>

      {/* Second line: this-week toggle + sort mode */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 px-1">
        <div className="flex items-center gap-1.5">
          {hasAnyAt ? (
            <button
              type="button"
              onClick={() => setThisWeekOnly(prev => !prev)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition ${
                thisWeekOnly
                  ? "border-cyan-500 bg-cyan-50 text-cyan-700"
                  : "border-border bg-card text-muted-foreground hover:border-border"
              }`}
              data-testid="orb-search-week-toggle"
              data-active={thisWeekOnly}
            >
              <CalendarRange className="w-3 h-3" />
              {thisWeekOnly ? "只看本週" : "包含過去全部"}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setSort("relevance")}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition ${
              sort === "relevance"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/90"
            }`}
            data-testid="orb-search-sort-relevance"
            data-active={sort === "relevance"}
          >
            <TrendingUp className="w-3 h-3" />
            相關度
          </button>
          <button
            type="button"
            onClick={() => setSort("recent")}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition ${
              sort === "recent"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/90"
            }`}
            data-testid="orb-search-sort-recent"
            data-active={sort === "recent"}
          >
            <ArrowDownAZ className="w-3 h-3" />
            時間
          </button>
        </div>
      </div>

      {refined.length === 0 ? (
        <div
          className="text-[11px] text-muted-foreground/70 px-2 py-3 text-center"
          data-testid="orb-search-no-results"
        >
          這個篩選條件下沒有結果。
          {thisWeekOnly ? (
            <button
              type="button"
              onClick={() => setThisWeekOnly(false)}
              className="ml-1 underline hover:text-foreground/90"
            >
              關掉「只看本週」
            </button>
          ) : null}
          {kindFilter !== "all" ? (
            <button
              type="button"
              onClick={() => setKindFilter("all")}
              className="ml-1 underline hover:text-foreground/90"
            >
              改看「全部」
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <ul className={`grid gap-1.5 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
            {pageItems.map(item => (
              <li key={item.id}>
                <SearchResultRow item={item} onOpen={() => navigate(item.path)} />
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <SearchResultsPagination
              page={safePage}
              totalPages={totalPages}
              onChange={setPage}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function SearchResultsPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
}) {
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;
  const disabledClass = "pointer-events-none opacity-40";
  return (
    <Pagination
      className="mt-2"
      data-testid="orb-search-pagination"
    >
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={prevDisabled}
            tabIndex={prevDisabled ? -1 : undefined}
            className={prevDisabled ? disabledClass : undefined}
            data-testid="orb-search-pagination-prev"
            onClick={e => {
              e.preventDefault();
              if (!prevDisabled) onChange(page - 1);
            }}
          />
        </PaginationItem>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => {
          const isActive = n === page;
          return (
            <PaginationItem key={n}>
              <PaginationLink
                href="#"
                isActive={isActive}
                data-testid="orb-search-pagination-page"
                data-page-index={n}
                onClick={e => {
                  e.preventDefault();
                  if (!isActive) onChange(n);
                }}
              >
                {n}
              </PaginationLink>
            </PaginationItem>
          );
        })}
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={nextDisabled}
            tabIndex={nextDisabled ? -1 : undefined}
            className={nextDisabled ? disabledClass : undefined}
            data-testid="orb-search-pagination-next"
            onClick={e => {
              e.preventDefault();
              if (!nextDisabled) onChange(page + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function SearchResultRow({
  item,
  onOpen,
}: {
  item: ChatSearchResultItem;
  onOpen: () => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;
  const relative = formatRelative(item.at);
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumbnail = Boolean(item.thumbnailUrl) && !thumbFailed;

  return (
    <button
      type="button"
      data-testid="orb-search-result-link"
      onClick={onOpen}
      className="group relative w-full text-left flex gap-2 rounded-xl border border-border/70 hover:border-cyan-300 hover:bg-cyan-50/40 transition px-2.5 py-2 hover:shadow-md"
    >
      {showThumbnail ? (
        <span className="shrink-0 mt-0.5 relative w-10 h-10 rounded-lg overflow-hidden border border-border bg-muted">
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setThumbFailed(true)}
          />
          {item.modality && MODALITY_ICON[item.modality] ? (
            <span className="absolute bottom-0.5 right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-card/80 backdrop-blur shadow-sm">
              {(() => {
                const ModIcon = MODALITY_ICON[item.modality]!;
                return <ModIcon className="w-2.5 h-2.5 text-foreground/90" />;
              })()}
            </span>
          ) : null}
        </span>
      ) : (
        <span
          className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md ${meta.tone}`}
        >
          <Icon className="w-3.5 h-3.5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="text-[12px] font-semibold text-foreground truncate">
                      {item.title}
                    </span>
                    {item.badge ? (
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/70">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.snippet ? (
                    <span className="block text-[11px] leading-snug text-muted-foreground line-clamp-2 mt-0.5">
                      {item.snippet}
                    </span>
                  ) : null}
                  {relative ? (
                    <span className="block text-[10px] text-muted-foreground/70 mt-0.5">{relative}</span>
                  ) : null}
                </span>
      <ArrowUpRight className="shrink-0 w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-cyan-500 mt-1" />
    </button>
  );
}
