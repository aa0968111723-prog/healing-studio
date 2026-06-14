// ============================================================================
// shells/video/drawers/PromptWorkbench.tsx — I-8 提示詞跨庫組合（AIDV-86）
// ----------------------------------------------------------------------------
// 兩套提示詞系統各自獨立、使用者不知能合用：
//   • promptLibrary（庫，FlowTv 已用）   • promptCollection（收藏，座艙無 UI）
// 本工坊把兩者並列、可跨庫多選 → 客戶端合成「組合提示詞」→ 複製貼進腳本／提示詞。
// Phase 1＝零後端：只調既有 query（promptLibrary.list / promptCollection.listMine /
//   listTeam）＋客戶端合併。生成面板「主動建議」內嵌＋use-count/評分回饋＝Phase 2。
// drawer 由 ConsoleDrawers 掛載、光球選單開啟；ENABLE_4SHELL 之下才可達。
// ============================================================================
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { PanelError, PanelLoading } from "@/shells/_shared/PanelState";
import { toast } from "sonner";

type Source = "library" | "mine" | "team";
const TABS: { key: Source; label: string }[] = [
  { key: "library", label: "我的提示詞庫" },
  { key: "mine", label: "我的收藏" },
  { key: "team", label: "團隊收藏" },
];

/** 兩套系統的共通欄位（庫／收藏 item 都有 id/title/content）。 */
type Promptish = {
  id: number | string;
  title: string;
  content: string;
  category?: string | null;
  tags?: string[] | null;
  isFavorite?: boolean | null;
  useCount?: number | null;
};
type Picked = { key: string; source: Source; title: string; content: string };

export function PromptWorkbenchBody() {
  const [tab, setTab] = useState<Source>("library");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [picked, setPicked] = useState<Record<string, Picked>>({});

  const args = { search: submitted || undefined, page: 1, pageSize: 50 } as const;
  const lib = trpc.promptLibrary.list.useQuery(args, { enabled: tab === "library", staleTime: 60_000 });
  const mine = trpc.promptCollection.listMine.useQuery(args, { enabled: tab === "mine", staleTime: 60_000 });
  const team = trpc.promptCollection.listTeam.useQuery(args, { enabled: tab === "team", staleTime: 60_000 });
  const active = tab === "library" ? lib : tab === "mine" ? mine : team;
  const items = (active.data?.items ?? []) as Promptish[];

  const merged = useMemo(
    () => Object.values(picked).map((p) => p.content).join("\n\n"),
    [picked],
  );
  const pickedList = Object.values(picked);

  const toggle = (it: Promptish) => {
    const key = `${tab}:${it.id}`;
    setPicked((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = { key, source: tab, title: it.title, content: it.content };
      return next;
    });
  };

  const copyMerged = async () => {
    if (!merged) return;
    try {
      await navigator.clipboard?.writeText(merged);
      toast.success("已複製組合提示詞", { description: `合併 ${pickedList.length} 段，可貼進腳本／提示詞。` });
    } catch {
      toast.message("組合提示詞", { description: merged });
    }
  };

  return (
    <div className="space-y-4 pt-4">
      {/* 來源分頁 */}
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs transition-healing",
              tab === t.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 搜尋 */}
      <form onSubmit={(ev) => { ev.preventDefault(); setSubmitted(query.trim()); }} className="flex gap-1.5">
        <input
          aria-label="搜尋提示詞"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋提示詞…（空白＝全部）"
          className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 text-xs">搜尋</Button>
      </form>

      {/* 列表（四態） */}
      {active.isLoading ? (
        <PanelLoading count={4} className="h-16 rounded-lg" label="讀取提示詞…" />
      ) : active.isError ? (
        <PanelError message="提示詞讀取失敗。" onRetry={() => void active.refetch()} />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
          這個來源沒有提示詞{submitted ? `（「${submitted}」）` : ""}。換來源或關鍵字試試。
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const key = `${tab}:${it.id}`;
            const on = Boolean(picked[key]);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(it)}
                aria-pressed={on}
                className={cn(
                  "block w-full rounded-lg border px-2.5 py-2 text-left transition-healing",
                  on ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-muted/40",
                )}
              >
                <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium">{on ? "✓ " : ""}{it.title}</span>
                  {it.category && <Badge variant="outline" className="text-[9px]">{it.category}</Badge>}
                  {it.isFavorite && <Badge variant="secondary" className="text-[9px]">★</Badge>}
                  {typeof it.useCount === "number" && it.useCount > 0 && (
                    <span className="text-[9px] text-muted-foreground">用過 {it.useCount}</span>
                  )}
                </div>
                <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{it.content}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* 組合區 */}
      <div className="rounded-lg border bg-card/60 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium">組合提示詞</span>
          <span className="text-[10px] text-muted-foreground">已選 {pickedList.length} 段（可跨庫）</span>
        </div>
        {pickedList.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">點上面的提示詞卡加入組合（再點一次移除）。</p>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {pickedList.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPicked((prev) => { const n = { ...prev }; delete n[p.key]; return n; })}
                  className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted/70"
                >
                  {p.title} ✕
                </button>
              ))}
            </div>
            <textarea
              aria-label="組合提示詞"
              readOnly
              value={merged}
              rows={4}
              className="w-full resize-none rounded-md border bg-background px-2 py-1 text-[11px] leading-relaxed"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void copyMerged()}>
                複製組合提示詞
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPicked({})}>
                清空
              </Button>
            </div>
          </>
        )}
      </div>

      <p className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
        Phase 1（零後端）：跨庫多選 → 客戶端合成 → 複製貼上。生成面板「主動建議」內嵌＋
        use-count／評分排序回饋（接 AIDV-62 H8b）＝Phase 2 後端待補。
      </p>
    </div>
  );
}

export default PromptWorkbenchBody;
