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
import { PanelError } from "@/shells/_shared/PanelState";
// U-2（AIDV-92）逐殼採用 · /learn：旗標 ON 時情報新聞列改用 design-kit 亮色暖光 IntelItem
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有外連卡＝零變化。
// 設計門依 ui-ux-pro-max「外連可辨識」：兩版皆於新分頁開啟原文（noopener）、來源/日期/標籤可見。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, IntelItem as DkIntelItem } from "@/components/design-kit";

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
          <p className="text-xs text-muted-foreground mt-0.5">最新情報 · /social 時事選題同步自此來源</p>
        </div>
        <Badge variant="secondary">{q.isLoading ? "…" : `${items.length} 則`}</Badge>
      </div>

      {q.isError ? (
        <PanelError message="讀取情報失敗，請稍後重試。" onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          目前沒有情報（news 來源未設或 DB 不可用）。
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n, i) => <NewsItem key={n.id ?? i} item={n} />)}
        </div>
      )}
    </Card>
  );
}

/**
 * 單則情報新聞列：旗標 ON 時改用 design-kit 亮色暖光 IntelItem（title＋來源/日期行＋#tag chip），
 * 點擊以新分頁開原文；OFF（預設）＝既有外連卡＝逐像素零變化。欄位容錯沿用既有多鍵 fallback。
 */
export function NewsItem({ item }: { item: any }) {
  const title = item.title ?? item.headline ?? "未命名";
  const source = item.source ?? item.publisher ?? item.category ?? "—";
  const ts = item.publishedAt ?? item.ts ?? item.createdAt;
  const tag = item.tag ?? item.category;
  const url = item.url ?? item.link ?? "#";
  const dateStr = ts ? ` · ${new Date(ts).toLocaleDateString("zh-TW")}` : "";

  if (ENABLE_AIDV_CHROME) {
    // 來源行＝來源＋日期（與 OFF 版同資訊）；標籤以 IntelItem 右側 Tag chip 呈現。
    return (
      <AidvKit>
        <DkIntelItem
          title={title}
          source={`${source}${dateStr}`}
          tag={tag ? `#${tag}` : undefined}
          onClick={url !== "#" ? () => window.open(url, "_blank", "noopener,noreferrer") : undefined}
        />
      </AidvKit>
    );
  }

  return (
    <a
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
        {source}{dateStr}{tag ? ` · #${tag}` : ""}
      </div>
    </a>
  );
}

export default NewsPanel;
