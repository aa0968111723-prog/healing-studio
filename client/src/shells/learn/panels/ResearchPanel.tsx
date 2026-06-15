// ============================================================================
// shells/learn/panels/ResearchPanel.tsx — 研究代理（Perplexity / Sonar + Brave）
// ----------------------------------------------------------------------------
// 對映盤點：/learn 含研究/grounding 入口（站內無獨立 /news，研究與情報都在 /learn）。
// 接縫：Research adapter（adapters/research.ts，**mock-default**）。要接真實 Sonar+Brave
//   設 VITE_RESEARCH_PROVIDER=trpc → orbProxy.unifiedSearch。
// 故障注入：讀 SpineProvider.faults.research（/settings 故障面板可打開）→ 503 / 重試 demo。
// 降級鏈：Sonar → Brave-only → 無 grounding（掛「未經即時查證」橫幅，計畫 §3.4）。
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, RefreshCw, AlertTriangle, Globe, Loader2, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useSpine } from "@/providers/SpineProvider";
import { createResearchAdapter, type ResearchEvent } from "@/adapters/research";
import type { ResearchResult } from "@/spine/types";
// U-2（AIDV-92）逐殼採用 · /learn：旗標 ON 時引用來源列改用 design-kit 亮色暖光 SourceCite
//（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝既有外連卡＝零變化。
// 外連行為兩版皆保留：ON 版把 SourceCite 包在原本的 <a target=_blank rel=noreferrer> 內。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SourceCite as DkSourceCite } from "@/components/design-kit";

type RunState = "idle" | "loading" | "done" | "error";

export function ResearchPanel() {
  const spine = useSpine();
  const faultsRef = useRef(spine.faults);
  faultsRef.current = spine.faults;

  // 研究 adapter 只建一次；故障旗標用 ref 讀最新值（不重建 adapter）。
  const { adapter, mode } = useMemo(
    () => createResearchAdapter({ getFault: () => Boolean(faultsRef.current?.research) }),
    [],
  );

  const [q, setQ] = useState("影片跨鏡角色一致性怎麼做？");
  const [state, setState] = useState<RunState>("idle");
  const [res, setRes] = useState<ResearchResult | null>(null);
  const [degraded, setDegraded] = useState<{ reason: string; mode: string } | null>(null);
  const [httpErr, setHttpErr] = useState<number | undefined>(undefined);

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    setState("loading");
    setDegraded(null);
    setHttpErr(undefined);
    try {
      const r = await adapter.run(query, (e: ResearchEvent) => {
        if (e.type === "degraded") setDegraded({ reason: e.reason, mode: e.mode });
        if (e.type === "error") setHttpErr(e.http);
      });
      setRes(r);
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">研究代理 · Sonar + Brave</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            grounded · 帶引用（Perplexity 過渡/備援）
          </p>
        </div>
        <Badge variant={mode === "trpc" ? "default" : "secondary"}>
          {mode === "trpc" ? "real · orbProxy.unifiedSearch" : "mock（預設）"}
        </Badge>
      </div>

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="問一個需要上網查證的問題…"
          onKeyDown={(e) => { if (e.key === "Enter") run(); }}
        />
        <Button onClick={run} disabled={state === "loading"}>
          {state === "loading"
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <><Search className="h-4 w-4 mr-1.5" />研究</>}
        </Button>
      </div>

      {degraded && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <span>
            降級模式（{degraded.mode === "no-grounding" ? "未經即時查證" : "Brave-only"}）：{degraded.reason}。
            以下答案可能未經即時查證來源。
          </span>
        </div>
      )}

      {state === "idle" && (
        <EmptyState
          icon={<Globe className="h-7 w-7" />}
          title="輸入問題開始研究"
          desc="回傳會附上引用來源並扣積分（成本階梯：Sonar 屬中段）。可在 /settings 注入「研究上游故障」看錯誤/重試。"
        />
      )}
      {state === "loading" && (
        <EmptyState
          icon={<Loader2 className="h-7 w-7 animate-spin" />}
          title="Sonar 研究中…"
          desc="web grounding → 彙整 → 附引用…"
        />
      )}
      {state === "error" && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-10 text-center">
          <AlertTriangle className="h-7 w-7 text-destructive" />
          <div className="text-sm font-medium">研究失敗</div>
          <div className="text-xs text-muted-foreground max-w-sm">
            研究上游暫時無回應{httpErr ? `（HTTP ${httpErr}）` : ""}。可重試或稍後再試。
          </div>
          <Button variant="outline" size="sm" onClick={run}>
            <RefreshCw className="h-4 w-4 mr-1.5" />重試
          </Button>
        </div>
      )}

      {state === "done" && res && (
        <div className="space-y-4">
          <Card className="p-4 bg-muted/40">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">彙整答案</div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{res.answer}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="secondary">{res.model}</Badge>
              <Badge variant="outline">{res.tokens.toLocaleString()} tokens</Badge>
              <Badge variant="outline" className="text-amber-600 border-amber-500/40">
                -{Math.round(res.costUsd * 1000)} 積分
              </Badge>
            </div>
          </Card>

          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            引用來源（{res.sources.length}）
          </div>
          <div className="space-y-2">
            {res.sources.map((src, i) => (
              <SourceItem key={i} src={src} index={i} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * 單筆引用來源：旗標 ON 時改用 design-kit 亮色暖光 SourceCite（標題＋摘要＋來源網址），
 * 仍包在原本的外連 <a target=_blank rel=noreferrer> 內保留「點擊開原文」；
 * OFF（預設）＝既有外連卡（含序號徽章）＝逐像素零變化。
 */
export function SourceItem({ src, index }: { src: { title: string; url: string; snip?: string }; index: number }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <a href={src.url} target="_blank" rel="noreferrer" className="block">
        <AidvKit>
          <DkSourceCite title={src.title} url={src.url} snippet={src.snip} />
        </AidvKit>
      </a>
    );
  }
  return (
    <a
      href={src.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] text-primary">
          {index + 1}
        </span>
        {src.title}
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="text-[11px] text-muted-foreground mt-1 truncate">{src.url}</div>
      {src.snip && <div className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{src.snip}</div>}
    </a>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground max-w-md">{desc}</div>
    </div>
  );
}

export default ResearchPanel;
