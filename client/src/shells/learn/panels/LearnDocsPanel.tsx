// ============================================================================
// shells/learn/panels/LearnDocsPanel.tsx — 學習文件中心（learnHub）
// ----------------------------------------------------------------------------
// 對映盤點 §3-11：80 篇文件 6 分類，難度 入門/進階/高級，搜尋 + 分類籤。
// 真實接點：
//   learnHub.list({category?,search?,difficulty?,limit,offset}) → { items[], total } ✅
//   learnHub.categories() → { [category]: count }                                    ✅
// learnHub 無資料（DB 不可用）時退回 learnContent.METHODOLOGY_DOCS 精選 fallback。
// ============================================================================
import { useState } from "react";
import { BookOpen, Search, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelError } from "@/shells/_shared/PanelState";
import { METHODOLOGY_DOCS, LEARN_DIFFICULTIES } from "../learnContent";
// U-2（AIDV-92）逐殼採用 · /learn：旗標 ON 時文件卡改用 design-kit 亮色暖光 ArticleCard
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有卡＝零變化。
// 設計門已拍板（2026-06-16）：接受 design-kit ArticleCard 刻意較精簡（僅 category＋title）。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, ArticleCard as DkArticleCard } from "@/components/design-kit";

// 中文難度 ↔ 後端 enum
const DIFF_MAP: Record<string, "beginner" | "intermediate" | "advanced"> = {
  入門: "beginner", 進階: "intermediate", 高級: "advanced",
};

export function LearnDocsPanel() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");

  const catsQ = trpc.learnHub.categories.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const listQ = trpc.learnHub.list.useQuery(
    {
      search: search.trim() || undefined,
      category: category || undefined,
      difficulty: difficulty ? DIFF_MAP[difficulty] : undefined,
      limit: 60,
      offset: 0,
    },
    { retry: false, staleTime: 60_000 },
  );

  const data: any = listQ.data ?? {};
  const items: any[] = data.items ?? [];
  const total: number = data.total ?? 0;
  const useFallback = !listQ.isLoading && items.length === 0;
  const cats: Record<string, number> = (catsQ.data as any) ?? {};

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2"><BookOpen className="h-4 w-4" />學習中心 LearnHub</h3>
          <p className="text-xs text-muted-foreground mt-0.5">方法論與教學文件，同時餵 RAG 與供人閱讀</p>
        </div>
        <Badge variant="secondary">{listQ.isLoading ? "…" : `${total || items.length} 篇`}</Badge>
      </div>

      {/* 搜尋 + 篩選 */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋文件…" className="pl-8 h-9" />
        </div>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs">
          <option value="">全部難度</option>
          {LEARN_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* 分類籤 */}
      <div className="flex flex-wrap gap-1.5">
        <CatChip label="全部" active={!category} onClick={() => setCategory("")} />
        {Object.entries(cats).map(([c, n]) => (
          <CatChip key={c} label={`${c} ${n}`} active={category === c} onClick={() => setCategory(c)} />
        ))}
      </div>

      {/* 文件列表 */}
      {listQ.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : useFallback ? (
        <div className="space-y-2">
          {listQ.isError && (
            <PanelError compact message="讀取學習文件失敗，暫顯示內建精選方法論。" onRetry={() => listQ.refetch()} />
          )}
          <FallbackDocs />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((d) => <DocCard key={d.id} doc={d} />)}
        </div>
      )}
    </Card>
  );
}

/**
 * 學習文件卡：旗標 ON 時改用 design-kit 亮色暖光 ArticleCard（category＋title，設計刻意精簡）；
 * OFF（預設）＝既有卡（標題＋精選星＋摘要＋分類/難度徽章）＝逐像素零變化。
 */
export function DocCard({ doc }: { doc: any }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit>
        <DkArticleCard title={doc.title} category={doc.category} />
      </AidvKit>
    );
  }
  return (
    <div className="rounded-xl border p-3 hover:bg-muted/40 transition-colors">
      <div className="flex items-start justify-between gap-1">
        <b className="text-xs leading-tight">{doc.title}</b>
        {doc.featured && <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{doc.summary}</div>
      <div className="flex flex-wrap gap-1 mt-2">
        {doc.category && <Badge variant="outline" className="text-[10px]">{doc.category}</Badge>}
        {doc.difficulty && <Badge variant="secondary" className="text-[10px]">{doc.difficulty}</Badge>}
      </div>
    </div>
  );
}

function FallbackDocs() {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-2">（learnHub 暫無資料，顯示內建精選方法論）</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {METHODOLOGY_DOCS.map((d) => (
          <div key={d.id} className="rounded-xl border p-3">
            <b className="text-xs">{d.title}</b>
            <div className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{d.summary}</div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="outline" className="text-[10px]">{d.category}</Badge>
              <Badge variant="secondary" className="text-[10px]">{d.difficulty} · {d.minutes}分</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CatChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
    >
      {label}
    </button>
  );
}

export default LearnDocsPanel;
