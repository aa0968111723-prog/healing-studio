// ============================================================================
// shells/video/drawers/RealEarthResearch.tsx — I-5 真實地球研究面板（AIDV-83）
// ----------------------------------------------------------------------------
// realEarth 後端（13 procedure）LIVE 但完全沒有前端。本面板把它接上導演台：
//   • 對主題跑 realEarth.search（唯讀 query）→ inline 顯示真實參照卡。
//   • 「用此參照接地」＝複製一行真實參照，貼進腳本／提示詞（手動接地）。
// Phase 1＝零後端：只調既有 realEarth.search query。
//   直接「注入生成上下文」＋ director.directorResearch wrapper ＝後端待補（Phase 2）。
// 全程在 ENABLE_4SHELL=ON 之下才可達（drawer 由 ConsoleDrawers 掛載、光球選單開啟）。
// ============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { CATEGORY_LABELS, type RealEarthEntry } from "@shared/real-earth-types";
import { toast } from "sonner";

const CREDIBILITY_LABEL: Record<NonNullable<RealEarthEntry["quality"]>["credibility"], string> = {
  low: "可信度低",
  medium: "可信度中",
  high: "可信度高",
  verified: "已驗證",
};

/** 壓成一行可貼進腳本／提示詞的真實參照（Phase 1 手動接地；Phase 2 直接注入生成上下文）。 */
function refLine(e: RealEarthEntry): string {
  const meta = [CATEGORY_LABELS[e.category], e.historicalPeriod, e.location?.region].filter(Boolean);
  return `【真實參照】${e.title}（${meta.join(" · ")}）— ${e.summary}`;
}

export function RealEarthResearchBody() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [taiwanOnly, setTaiwanOnly] = useState(false);

  const res = trpc.realEarth.search.useQuery(
    { query: submitted || undefined, taiwanOnly: taiwanOnly || undefined, page: 1, perPage: 20 },
    { staleTime: 60_000 },
  );
  const entries = res.data?.entries ?? [];

  const copyRef = async (e: RealEarthEntry) => {
    const line = refLine(e);
    // 守門：Clipboard API 不存在（非 HTTPS／舊瀏覽器）時，optional chaining 會無聲 no-op，
    // 故先確認 API 在、寫入成功才報「已複製」；否則落到手動複製 fallback（不謊報成功）。
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(line);
        toast.success("已複製真實參照", { description: "可貼進腳本／提示詞，為這段接地。" });
        return;
      } catch {
        // 寫入失敗 → 落到下方 fallback
      }
    }
    toast.message("真實參照（請手動複製）", { description: line });
  };

  return (
    <div className="space-y-4 pt-4">
      {/* 搜尋列 */}
      <form onSubmit={(ev) => { ev.preventDefault(); setSubmitted(query.trim()); }} className="space-y-2">
        <div className="flex gap-1.5">
          <input
            aria-label="搜尋真實地球資料"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋真實歷史 / 地理 / 文化…（空白＝全部）"
            className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs"
          />
          <Button type="submit" size="sm" className="h-8 text-xs">搜尋</Button>
        </div>
        <label className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs">
          <span>只看台灣重點資料</span>
          <Switch checked={taiwanOnly} onCheckedChange={setTaiwanOnly} />
        </label>
      </form>

      {/* 結果（四態） */}
      {res.isLoading ? (
        <PanelLoading count={4} className="h-20 rounded-lg" label="搜尋真實地球資料…" />
      ) : res.isError ? (
        <PanelError message="真實地球搜尋失敗（realEarth.search）。" onRetry={() => void res.refetch()} />
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          沒有符合的真實參照{submitted ? `（「${submitted}」）` : ""}。換個關鍵字試試，或請管理員先初始化資料庫。
        </p>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] text-muted-foreground">
            共 {res.data?.total ?? entries.length} 筆
            {(res.data?.totalPages ?? 1) > 1 ? `（顯示第 1 / ${res.data?.totalPages} 頁）` : ""}
          </div>
          {entries.map((e) => (
            <article key={e.id} className="rounded-lg border bg-card/60 px-2.5 py-2">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium">{e.title}</span>
                <Badge variant="outline" className="text-[9px]">{CATEGORY_LABELS[e.category]}</Badge>
                {e.isTaiwanFocused && <Badge variant="secondary" className="text-[9px]">台灣</Badge>}
                {e.quality && <Badge variant="outline" className="text-[9px]">{CREDIBILITY_LABEL[e.quality.credibility]}</Badge>}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{e.summary}</p>
              {(e.historicalPeriod || e.location?.region) && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {[e.historicalPeriod, e.location?.region].filter(Boolean).join(" · ")}
                </div>
              )}
              {e.tags && e.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.tags.slice(0, 6).map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">#{t}</span>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void copyRef(e)}>
                  用此參照接地（複製）
                </Button>
                {e.externalLinks?.[0] && (
                  <a href={e.externalLinks[0].url} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">
                    來源 ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
        Phase 1（零後端）：唯讀查 realEarth 真實資料、複製參照手動接地。直接「注入生成上下文」＋
        <span className="font-mono"> director.directorResearch</span> ＝後端待補（Phase 2）。
      </p>
    </div>
  );
}

export default RealEarthResearchBody;
