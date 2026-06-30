// ============================================================================
// shells/video/drawers/TeachingArchiveGrounding.tsx — I-4 教材庫接地（AIDV-82）
// ----------------------------------------------------------------------------
// teachingArchive（15 procedure＋RAG）LIVE 但座艙沒入口。用你自己的教材「接地」劇本：
//   • teachingArchive.search（唯讀；向量為主、DB LIKE 後援 → 無金鑰也能用）
//   • 「用此教材接地（複製）」複製一行教材參照，貼進腳本／精修指示。
// Phase 1＝零後端：只調既有 search query。把參照直接注入 director.refineScript＝
//   Phase 2 後端待補（refineScript 已存在，Phase 2 加 groundingContext 欄一行接上）。
// drawer 由 ConsoleDrawers 掛載、光球選單開啟；ENABLE_4SHELL 之下才可達。
// ============================================================================
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

type Hit = {
  id: number;
  title: string;
  mediaType: string;
  sourceType: string;
  lineage: string | null;
  topic: string | null;
  speaker: string | null;
  fileUrl: string | null;
  snippet: string;
  matchedBy: "vector" | "fts";
  score: number;
};

/** 壓成一行可貼進腳本／精修指示的教材參照（Phase 1 手動接地；Phase 2 直接注入 refineScript）。 */
function refLine(h: Hit): string {
  const meta = [h.lineage, h.topic, h.speaker].filter(Boolean);
  return `【教材參照】${h.title}${meta.length ? `（${meta.join(" · ")}）` : ""} — ${h.snippet}`;
}

export function TeachingArchiveGroundingBody() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const res = trpc.teachingArchive.search.useQuery(
    { query: submitted, limit: 10 },
    { enabled: submitted.length > 0, staleTime: 60_000 },
  );
  const hits = (res.data ?? []) as Hit[];

  const copyRef = async (h: Hit) => {
    const line = refLine(h);
    try {
      await copyToClipboard(line);
      toast.success("已複製教材參照", { description: "可貼進腳本／精修指示，用你的教材接地。" });
    } catch {
      toast.message("教材參照（請手動複製）", { description: line });
    }
  };

  return (
    <div className="space-y-4 pt-4">
      {/* 搜尋列 */}
      <form onSubmit={(ev) => { ev.preventDefault(); setSubmitted(query.trim()); }} className="flex gap-1.5">
        <input
          aria-label="搜尋教材庫"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋你的教材（師父開示、品牌語氣…）"
          className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={res.isLoading}>搜尋</Button>
      </form>

      {/* 結果（含未搜尋的引導態） */}
      {submitted.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          輸入關鍵字搜尋你的教材庫，挑一段「接地」這支劇本（向量檢索為主、找不到時退關鍵字比對）。
        </p>
      ) : res.isLoading ? (
        <PanelLoading count={4} className="h-20 rounded-lg" label="搜尋教材庫…" />
      ) : res.isError ? (
        <PanelError message="教材庫搜尋失敗（teachingArchive.search）。" onRetry={() => void res.refetch()} />
      ) : hits.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          沒有符合的教材（「{submitted}」）。換個關鍵字，或先到 <span className="font-mono">/teaching-archive</span> 上傳教材。
        </p>
      ) : (
        <div className="space-y-2">
          {hits.map((h) => (
            <article key={h.id} className="rounded-lg border bg-card/60 px-2.5 py-2">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium">{h.title}</span>
                <Badge variant="outline" className="text-[9px]">{h.mediaType}</Badge>
                <Badge variant="secondary" className="text-[9px]">{h.matchedBy === "vector" ? "語意" : "關鍵字"}</Badge>
              </div>
              {(h.lineage || h.topic || h.speaker) && (
                <div className="mb-0.5 text-[10px] text-muted-foreground">
                  {[h.lineage, h.topic, h.speaker].filter(Boolean).join(" · ")}
                </div>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">{h.snippet}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void copyRef(h)}>
                  用此教材接地（複製）
                </Button>
                {h.fileUrl && (
                  <a href={h.fileUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">
                    開啟原始教材 ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
        Phase 1（零後端）：唯讀檢索教材、複製參照手動接地。「以我的教材接地」一鍵注入精修
        （<span className="font-mono">director.refineScript</span>）＋開關＝Phase 2 後端待補。
      </p>
    </div>
  );
}

export default TeachingArchiveGroundingBody;
