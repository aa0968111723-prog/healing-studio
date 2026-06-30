// ============================================================================
// pages/social/SocialCockpitPage.tsx — /social cockpit（index；重用 /video 三欄殼）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §1.3（旅程）/ §7.1（三欄 cockpit）。
//   左＝專案 + 品牌面板摘要｜中＝brief + 文案（Commander/Claude）+ 進入生成｜右＝風格庫 + 選題。
// 旅程：意圖 → 套品牌 → 內容（文案+選題）→（轉圖像台）生成 → 多尺寸 → 發佈。
// 接縫：commander.directorReply（文案草稿）、dataStore.listTemplates/listNews（風格/選題，讀脊椎）。
// ============================================================================
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, ArrowRight, Newspaper, Wand2, FolderOpen, Tv } from "lucide-react";
import { trpc } from "@/lib/trpc";
// U-14 Phase 2（AIDV-146）：Flow TV 放映入口（/social）。旗標 OFF＝完全不掛載。
import { FLOW_TV_ENABLED, FlowTvOverlay } from "@/components/flow-tv";
import type { FlowTvItem } from "@/components/flow-tv";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpine } from "@/providers/SpineProvider";
import { useCreativeProject } from "@/spine/useCreativeProject";
import { useBrandKit } from "@/social/useBrandKit";
import { evaluateBrandGate } from "@/social/brandKit";
import { SocialNav } from "@/components/social/SocialNav";
import { SocialJourneyStepper } from "@/components/social/SocialJourneyStepper";
import { SOCIAL_JOURNEY_STEPPER } from "@/social/socialFlags";
import { TemplatePicker } from "@/components/social/TemplatePicker";
import { SocialNewsList } from "@/components/social/SocialNewsList";
import { BrandLockBadge } from "@/components/social/BrandLockBadge";
import type { NewsItem } from "@/spine/types";

/** Flow TV 放映入口：懶載入 promptLibrary.list，open 時才發請求。旗標 OFF 時不掛載。 */
function SocialFlowTvMount() {
  const [open, setOpen] = useState(false);
  const list = trpc.promptLibrary.list.useQuery(
    { pageSize: 50 },
    { enabled: open, staleTime: 30_000 },
  );
  const items: FlowTvItem[] = (list.data?.items ?? []).map((it) => ({
    id: String(it.id),
    prompt: it.content,
    source: "social" as const,
    tags: it.tags as string[],
    model: it.modelHint ?? undefined,
  }));
  const tvState = list.isFetching ? "loading" : list.isError ? "error" : "ready";
  return (
    <>
      <button
        type="button"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        aria-label="開啟 Flow TV 放映"
      >
        <Tv className="h-4 w-4" aria-hidden /> Flow TV 放映
      </button>
      <FlowTvOverlay
        items={items}
        open={open}
        onClose={() => setOpen(false)}
        state={tvState}
        onRetry={() => { void list.refetch(); }}
      />
    </>
  );
}

export default function SocialCockpitPage() {
  const spine = useSpine();
  const active = useCreativeProject() as { activeProject?: { name?: string } | null };
  const brand = useBrandKit();
  const gate = evaluateBrandGate(brand.kit);
  const [, navigate] = useLocation();

  const [brief, setBrief] = useState("本週主題：放下。給一句溫暖的開示金句，附 2 個 hashtag。");
  const [template, setTemplate] = useState<string | null>("tpl_quote");
  const [copy, setCopy] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [news, setNews] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    spine.adapters.dataStore.listNews().then((n) => alive && setNews(n)).catch(() => alive && setNews([]));
    return () => {
      alive = false;
    };
  }, [spine.adapters.dataStore]);

  async function suggestCopy() {
    setDrafting(true);
    try {
      // 委派 Commander（OpenRouter→Claude）：依品牌 voice 出文案草稿（§4.1）。
      const reply = await spine.adapters.commander.directorReply({
        persona: "calm",
        message: `品牌口吻=${brand.kit.voice.tone}；brief=${brief}`,
      });
      setCopy(reply.text);
      toast.success("文案草稿已出", { description: `${reply.agent} · 依品牌 voice 約束` });
    } catch {
      toast.error("文案生成失敗", { description: "可切 COMMANDER_ADAPTER=mock 或稍後重試" });
    } finally {
      setDrafting(false);
    }
  }

  const goStudio = () => navigate("/social/studio");

  // 由 cockpit 既有狀態推導旅程目前步（S1–S9，純展示；旗標 OFF 時不掛載）：
  //   套品牌(S2)→有文案/選題(S3/4)→選版型(S5)→進圖像台前止於 S5；後段（生成/尺寸/發佈）在他頁。
  const journeyStep = copy ? (template ? 5 : 3) : 2;

  const cite = (n: NewsItem) => {
    setBrief((b) => `${b}\n蹭熱點：「${n.title}」轉成品牌口吻。`);
    toast.message("已帶入選題", { description: n.title });
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <SocialNav />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">社群工作台</h1>
          <p className="text-sm text-muted-foreground">意圖 → 套品牌 → 文案/選題 → 生成 → 多尺寸 → 發佈</p>
          {/* U-6/AIDV-96：旗標 ON 時，純文字旅程升級為 design-kit 九步步進指示（目前第幾步/就緒態）。
              OFF（預設）＝不掛載＝零變化。 */}
          {SOCIAL_JOURNEY_STEPPER && (
            <SocialJourneyStepper current={journeyStep} className="mt-2 max-w-3xl" />
          )}
        </div>
        <Badge variant="outline" className="gap-1">
          <FolderOpen className="h-3.5 w-3.5" /> {active?.activeProject?.name ?? "未選專案（跨頁共用）"}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 左：專案 + 品牌摘要 */}
        <Card className="lg:row-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">品牌（套用至所有產物）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{brand.kit.name}</span>
              <BrandLockBadge locked={brand.locked} lockState={brand.kit.lockState} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {brand.kit.palette.map((s) => (
                <div key={s.role} className="h-8 w-8 rounded-md border" style={{ background: s.hex }} title={`${s.role} ${s.hex}`} />
              ))}
            </div>
            {gate.flags.length > 0 && (
              <div className="text-xs text-amber-600 dark:text-amber-400">閘門：{gate.flags.join("、")}</div>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("/social/brand")}>
              管理品牌庫 <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        {/* 中：brief + 文案 + 進入生成 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4" /> 內容草稿
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="貼 brief 或一句話…" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={suggestCopy} disabled={drafting} variant="secondary">
                <Sparkles className="h-4 w-4" /> {drafting ? "撰寫中…" : "AI 出文案（依品牌 voice）"}
              </Button>
              <Button onClick={goStudio}>
                進入圖像台生成 <ArrowRight className="h-4 w-4" />
              </Button>
              {FLOW_TV_ENABLED && <SocialFlowTvMount />}
            </div>
            {copy && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="mb-1 text-xs font-medium text-muted-foreground">文案草稿（可改/挑/確認）</div>
                {copy}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 右：選題（讀 news，不開 /learn） */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Newspaper className="h-4 w-4" /> 時事選題（同步自 /learn 的新聞來源）
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!news ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : news.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前無情報。可在 /learn 維護新聞來源。</p>
            ) : (
              <SocialNewsList news={news.slice(0, 4)} onCite={cite} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 風格庫（block_combos） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">風格版型庫</CardTitle>
        </CardHeader>
        <CardContent>
          <TemplatePicker value={template} onChange={(id) => { setTemplate(id); toast.message("已選版型", { description: id }); }} />
          <Separator className="my-3" />
          <Button className="w-full sm:w-auto" onClick={goStudio}>
            用此版型進入圖像台 <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
