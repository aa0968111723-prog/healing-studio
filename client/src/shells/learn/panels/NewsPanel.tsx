// ============================================================================
// shells/learn/panels/NewsPanel.tsx — 情報新聞（news）
// ----------------------------------------------------------------------------
// 對映盤點：站內無獨立 /news，新聞流在 /learn（AI 新聞分類）+ 模型情報專區。
//   /social 的「時事選題」也是經脊椎讀這份 news（§1.5.4），不另開頁。
// 真實接點：
//   news.list({limit,cursor?,category?}) → { items[], nextCursor }  ✅
// DB 不可用時後端優雅降級回 { items: [] }；本面板顯示空狀態。
// ============================================================================
import { useState } from "react";
import { Newspaper, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function NewsPanel() {
  const [limit] = useState(20);
  const q = trpc.news.list.useQuery({ limit }, { retry: false, staleTime: 120_000 });

  const data: any = q.data ?? {};
  const items: any[] = Array.isArray(data) ? data : data.items ?? [];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2"><Newspaper className="h-4 w-4" />情報新聞</h3>
          <p className="text-xs text-muted-foreground mt-0.5">news_articles · sense（/social 時事選題經脊椎讀此份）</p>
        </div>
        <Badge variant="secondary">{q.isLoading ? "…" : `${items.length} 則`}</Badge>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          目前沒有情報（news 來源未設或 DB 不可用）。
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n, i) => {
            const title = n.title ?? n.headline ?? "未命名";
            const source = n.source ?? n.publisher ?? n.category ?? "—";
            const ts = n.publishedAt ?? n.ts ?? n.createdAt;
            const tag = n.tag ?? n.category;
            const url = n.url ?? n.link ?? "#";
            return (
              <a
                key={n.id ?? i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Newspaper className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {title}
                  {url !== "#" && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {source}{ts ? ` · ${new Date(ts).toLocaleDateString("zh-TW")}` : ""}{tag ? ` · #${tag}` : ""}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default NewsPanel;
