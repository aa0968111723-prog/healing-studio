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

import { useLocation } from "wouter";
import { ImageIcon, Notebook, Clock, BookOpen, ArrowUpRight } from "lucide-react";
import type { ChatSearchResultItem } from "@/contexts/GlobalOrbChatContext";

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

export default function OrbSearchResultsCard({ query, items, compact }: Props) {
  const [, navigate] = useLocation();

  if (!items || items.length === 0) return null;

  // Group results by kind for the legend; kept in same order as items.
  const counts: Partial<Record<ChatSearchResultItem["kind"], number>> = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;

  return (
    <div
      data-testid="orb-search-results-card"
      className={`mt-2 rounded-2xl border border-cyan-200/50 bg-white/90 backdrop-blur-sm ${
        compact ? "p-2" : "p-3"
      } shadow-sm`}
    >
      <div className="flex flex-wrap items-center gap-1.5 mb-2 px-1">
        {query ? (
          <span className="text-[11px] font-medium text-gray-700">「{query}」</span>
        ) : null}
        {Object.entries(counts).map(([kind, count]) => {
          const meta = KIND_META[kind as ChatSearchResultItem["kind"]];
          return (
            <span
              key={kind}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${meta.tone}`}
            >
              <meta.icon className="w-3 h-3" />
              {meta.label} · {count}
            </span>
          );
        })}
      </div>
      <ul className={`grid gap-1.5 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
        {items.map(item => {
          const meta = KIND_META[item.kind];
          const Icon = meta.icon;
          const relative = formatRelative(item.at);
          return (
            <li key={item.id}>
              <button
                type="button"
                data-testid="orb-search-result-link"
                onClick={() => navigate(item.path)}
                className="group relative w-full text-left flex gap-2 rounded-xl border border-gray-200/80 hover:border-cyan-300 hover:bg-cyan-50/40 transition px-2.5 py-2"
              >
                <span
                  className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md ${meta.tone}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="text-[12px] font-semibold text-gray-800 truncate">
                      {item.title}
                    </span>
                    {item.badge ? (
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-gray-400">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.snippet ? (
                    <span className="block text-[11px] leading-snug text-gray-500 line-clamp-2 mt-0.5">
                      {item.snippet}
                    </span>
                  ) : null}
                  {relative ? (
                    <span className="block text-[10px] text-gray-400 mt-0.5">{relative}</span>
                  ) : null}
                </span>
                <ArrowUpRight className="shrink-0 w-3.5 h-3.5 text-gray-300 group-hover:text-cyan-500 mt-1" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
