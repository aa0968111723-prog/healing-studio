// ============================================================================
// shells/settings/admin/ContentTab.tsx — 內容治理（新聞 / 學習文件 / 模型情報）
// ----------------------------------------------------------------------------
// 對映盤點 §3-17 後台「AI 全站研究 / 內容」+ §3-12 模型自動研究。
// 真實接點（唯讀統計；策展動作走既有頁面，不在此重造寫入）：
//   aiModels.list() → { meta:{ total, verifiedCount, staleCount, coverage, lastResearchAt } } ✅ public
//   news.list({limit}) → 情報則數                                                             ✅ public
//   learnHub.categories() → 文件分類數量                                                       ✅ public
// 內容「編輯 / 刪除 / 匯入」維持走既有 /learn、/ai-models-hub 頁（盤點既有功能），本分頁是
// 治理總覽 + 入口，避免與既有寫入路徑重複（嚴格加法）。
// ============================================================================
import { FileText, Newspaper, Cpu, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ContentTab() {
  const [, navigate] = useLocation();
  const modelsQ = trpc.aiModels.list.useQuery({ modality: "all", provider: "all", tier: "all" }, { retry: false, staleTime: 60_000 });
  const newsQ = trpc.news.list.useQuery({ limit: 50 }, { retry: false, staleTime: 120_000 });
  const catsQ = trpc.learnHub.categories.useQuery(undefined, { retry: false, staleTime: 300_000 });

  const meta: any = (modelsQ.data as any)?.meta ?? {};
  const newsCount = ((newsQ.data as any)?.items ?? []).length;
  const cats: Record<string, number> = (catsQ.data as any) ?? {};
  const docCount = Object.values(cats).reduce((n, c) => n + Number(c || 0), 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <ContentCard
        icon={<Cpu className="h-4 w-4" />}
        title="模型情報"
        rows={[
          ["模型總數", meta.total ?? "—"],
          ["已驗證", meta.verifiedCount ?? "—"],
          ["待刷新(stale)", meta.staleCount ?? "—"],
        ]}
        footer={meta.lastResearchAt ? `上次研究 ${new Date(meta.lastResearchAt).toLocaleString("zh-TW")}` : "自動研究每天 03:30"}
        onOpen={() => navigate("/learn/ai-models")}
      />
      <ContentCard
        icon={<FileText className="h-4 w-4" />}
        title="學習文件"
        rows={[
          ["文件總數", docCount || "—"],
          ["分類數", Object.keys(cats).length || "—"],
        ]}
        footer="編輯 / 匯入 / 新增於學習中心"
        onOpen={() => navigate("/learn/docs")}
      />
      <ContentCard
        icon={<Newspaper className="h-4 w-4" />}
        title="情報新聞"
        rows={[["最近則數", newsCount || "—"]]}
        footer="news_articles · sense"
        onOpen={() => navigate("/learn/news")}
      />
    </div>
  );
}

function ContentCard({ icon, title, rows, footer, onOpen }: {
  icon: React.ReactNode; title: string; rows: [string, React.ReactNode][]; footer: string; onOpen: () => void;
}) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
      <div className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{k}</span>
            <Badge variant="outline">{v}</Badge>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground">{footer}</div>
      <Button size="sm" variant="outline" className="w-full" onClick={onOpen}>
        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />前往管理
      </Button>
    </Card>
  );
}

export default ContentTab;
