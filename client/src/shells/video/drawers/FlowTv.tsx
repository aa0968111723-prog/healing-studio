// ============================================================================
// shells/video/drawers/FlowTv.tsx — 2-12 Flow 電視牆（W1-4 放映皮）
// ----------------------------------------------------------------------------
// Wave 0 的重用迴圈（promptLibrary.list/create/delete/incrementUseCount＋再生成）
// 之上，加「純展示皮」：全屏沉浸播放器＋prompt 疊層（Hide Prompt）＋模型徽章＋
// 頻道（category/最愛＝真實後端篩選）＋循環自動換頁＋瀏覽器全屏＋格狀/清單切換。
// 不動後端：prompt_library 無 seed 欄，播放視覺以 id 決定性導出 seed 餵
// seedVisual.frameStyle（同 id 永遠同畫面）；血統素材檢視等 G9（Wave 2）。
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, Copy, Eye, EyeOff, LayoutGrid, List as ListIcon,
  Loader2, Maximize2, Minimize2, Pause, Play, Plus, RefreshCw, Search, Star,
  Trash2, Tv, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useSpine } from "@/providers/SpineProvider";
import { frameStyle } from "@/spine/seedVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/shells/_shared/PanelState";
// AIDV-160：成本守門中止（免費引擎不可用、不無聲跨界扣付費點）非硬失敗 → 顯示冷靜的
// 「未扣點」toast 而非紅色「再生成失敗」，與其他生成入口（GenerationConsole 等）一致。
import { isCostBlockedError } from "@/adapters/genErrorToast";

// ── 頻道（= list 的真實後端篩選參數；不是前端假分組）──────────────────────────
const CHANNELS = [
  { id: "all", label: "全部" },
  { id: "fav", label: "⭐ 最愛" },
  { id: "image", label: "圖像" },
  { id: "video", label: "影片" },
  { id: "audio", label: "音訊" },
  { id: "voice", label: "配音" },
  { id: "story", label: "故事" },
  { id: "general", label: "通用" },
] as const;
type ChannelId = (typeof CHANNELS)[number]["id"];

/** prompt_library 沒有 seed 欄（denormalized 顯示）：以 id 決定性導出，同 id 同畫面。 */
export function seedOf(id: number): number {
  return 1000 + ((id * 9301 + 49297) % 8999);
}

type PromptItem = {
  id: number;
  title: string;
  content: string;
  category: string;
  isFavorite: boolean;
  useCount: number;
  modelHint: string | null;
  generationMode: string | null;
};

/** 自動換頁間隔（循環模式）。 */
const AUTO_ADVANCE_MS = 6000;

export function FlowTvBody() {
  const sp = useSpine();
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<ChannelId>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [regenId, setRegenId] = useState<number | null>(null);
  /** 播放器：null＝關閉；數字＝目前放映的 items index。 */
  const [playIndex, setPlayIndex] = useState<number | null>(null);

  const list = trpc.promptLibrary.list.useQuery(
    {
      search: search || undefined,
      category: channel !== "all" && channel !== "fav" ? channel : undefined,
      favoritesOnly: channel === "fav" ? true : undefined,
    },
    { staleTime: 15_000 },
  );
  const create = trpc.promptLibrary.create.useMutation();
  const del = trpc.promptLibrary.delete.useMutation();
  const incUse = trpc.promptLibrary.incrementUseCount.useMutation();
  const toggleFav = trpc.promptLibrary.toggleFavorite.useMutation();

  const items = (list.data?.items ?? []) as PromptItem[];

  // 重用迴圈（§9）：再生成＝舊 prompt 重跑 Generation 接縫（先估→生成→落庫）＋ useCount+1。
  const regen = useCallback(async (id: number, prompt: string) => {
    if (regenId !== null) return;
    setRegenId(id);
    try {
      const res = await sp.adapters.generation.generate({
        kind: "image", prompt, seed: seedOf(id), provider: sp.provider,
      });
      incUse.mutate({ id }, { onSuccess: () => void list.refetch() });
      toast.success("已依舊提示詞再生成", { description: `${res.model} · seed ${res.seedUsed} · ${res.provider}` });
    } catch (e) {
      // AIDV-160：免費引擎不可用 → 守門中止（不扣點），不是硬失敗 → 冷靜提示、不紅。
      if (isCostBlockedError(e)) {
        toast.error("免費引擎暫時無法使用 · 未扣點", { description: e.message });
        return;
      }
      toast.error("再生成失敗（generate.submitStudioJob）", { description: e instanceof Error ? e.message : "Generation 接縫無回應" });
    } finally {
      setRegenId(null);
    }
  }, [regenId, sp, incUse, list]);

  // fork：把 prompt 帶進新增表單另存（player 內按下會同時關閉播放器）。
  const fork = useCallback((t: string, c: string) => {
    setTitle(t ? `${t}（複製）` : "");
    setContent(c);
    setPlayIndex(null);
    toast("已複製到新增表單 · 可編輯後另存");
  }, []);

  const toggleFavorite = useCallback((id: number) => {
    toggleFav.mutate({ id }, {
      onSuccess: () => void list.refetch(),
      onError: (e) => toast.error("收藏切換失敗（promptLibrary.toggleFavorite）", { description: e.message }),
    });
  }, [toggleFav, list]);

  return (
    <div className="space-y-4 pt-4">
      {/* 新增 */}
      <div className="space-y-2 rounded-xl border bg-card/60 p-2.5">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="標籤 / 標題（必填）" className="h-8 text-xs" />
        <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="prompt 內容（必填）" className="min-h-[56px] text-xs" />
        <Button
          size="sm"
          className="w-full"
          disabled={!title.trim() || !content.trim() || create.isPending}
          onClick={() => create.mutate(
            { title: title.trim(), content: content.trim(), category: "general" },
            { onSuccess: () => { toast.success("已存入提示詞庫"); setTitle(""); setContent(""); void list.refetch(); }, onError: (e) => toast.error("存庫失敗（promptLibrary.create）", { description: e.message }) },
          )}
        >
          <Plus className="size-4" /> 存入提示詞庫
        </Button>
      </div>

      {/* 頻道 ＋ 檢視切換 */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        {CHANNELS.map((ch) => (
          <Button
            key={ch.id}
            size="sm"
            variant={channel === ch.id ? "secondary" : "ghost"}
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => setChannel(ch.id)}
          >
            {ch.label}
          </Button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <Button size="icon" variant={view === "grid" ? "secondary" : "ghost"} className="size-6" aria-label="格狀檢視" onClick={() => setView("grid")}>
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button size="icon" variant={view === "list" ? "secondary" : "ghost"} className="size-6" aria-label="清單檢視" onClick={() => setView("list")}>
            <ListIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 搜尋 ＋ 一鍵放映 */}
      <div className="flex items-center gap-2">
        <Search className="size-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋標題…（後端僅比對 title，content 搜尋等 G9）" className="h-8 text-xs" />
        <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" disabled={items.length === 0} onClick={() => setPlayIndex(0)}>
          <Tv className="size-3.5" /> 放映
        </Button>
      </div>

      {/* 內容 */}
      {list.isLoading ? (
        <PanelLoading count={3} className="h-20 rounded-xl" label="載入提示詞庫…" />
      ) : list.isError ? (
        <PanelError message="提示詞庫讀取失敗（promptLibrary.list）" onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <PanelEmpty
          icon={<Tv className="size-6" />}
          title={<span className="text-xs">這個頻道還沒有提示詞</span>}
          hint="生成素材後存庫，或換個頻道；存庫後即可全屏放映、再生成、複製編輯。"
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-2">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              data-testid={`flowtv-card-${it.id}`}
              className="group overflow-hidden rounded-xl border text-left transition hover:border-primary/50"
              onClick={() => setPlayIndex(i)}
            >
              <div className="relative aspect-video" style={{ background: frameStyle(seedOf(it.id), 0) }}>
                <span className="absolute bottom-1 left-1.5 rounded bg-black/50 px-1 py-0.5 font-mono text-[9px] text-white">
                  seed {seedOf(it.id)}
                </span>
                {it.isFavorite && <Star className="absolute right-1.5 top-1.5 size-3.5 fill-amber-400 text-amber-400" />}
              </div>
              <div className="p-2">
                <div className="truncate text-xs font-medium">{it.title}</div>
                <div className="mt-0.5 flex items-center gap-1">
                  <Badge variant="outline" className="text-[9px]">{it.modelHint ?? it.generationMode ?? it.category}</Badge>
                  <span className="ml-auto font-mono text-[9px] text-muted-foreground">×{it.useCount ?? 0}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.id} className="rounded-xl border p-2.5">
              <div className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary" onClick={() => setPlayIndex(i)}>
                  {it.title}
                </button>
                <Button size="icon" variant="ghost" className="size-6" aria-label="收藏" onClick={() => toggleFavorite(it.id)}>
                  <Star className={cn("size-3.5", it.isFavorite && "fill-amber-400 text-amber-400")} />
                </Button>
                <Badge variant="outline" className="text-[9px]">{it.category}</Badge>
                <Button size="icon" variant="ghost" className="size-6 text-destructive" aria-label="刪除"
                  onClick={() => del.mutate({ id: it.id }, { onSuccess: () => { toast("已刪除"); void list.refetch(); }, onError: () => { void list.refetch(); } })}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{it.content}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={regenId !== null} onClick={() => void regen(it.id, it.content)}>
                  {regenId === it.id ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} 再生成
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => fork(it.title, it.content)}>
                  <Copy className="size-3" /> 複製編輯
                </Button>
                <span className="ml-auto font-mono text-[9px] text-muted-foreground">×{it.useCount ?? 0} 重用</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {playIndex !== null && items.length > 0 && (
        <FlowTvPlayer
          items={items}
          index={Math.min(playIndex, items.length - 1)}
          onIndex={setPlayIndex}
          onClose={() => setPlayIndex(null)}
          onRegen={regen}
          onFork={fork}
          onToggleFavorite={toggleFavorite}
          regenId={regenId}
        />
      )}
    </div>
  );
}

// ── 全屏沉浸播放器 ───────────────────────────────────────────────────────────
function FlowTvPlayer({
  items, index, onIndex, onClose, onRegen, onFork, onToggleFavorite, regenId,
}: {
  items: PromptItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRegen: (id: number, prompt: string) => Promise<void> | void;
  onFork: (title: string, content: string) => void;
  onToggleFavorite: (id: number) => void;
  regenId: number | null;
}) {
  const it = items[index];
  const [hidePrompt, setHidePrompt] = useState(false);
  const [looping, setLooping] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const next = useCallback(() => onIndex((index + 1) % items.length), [index, items.length, onIndex]);
  const prev = useCallback(() => onIndex((index - 1 + items.length) % items.length), [index, items.length, onIndex]);

  // 循環：自動換頁。
  useEffect(() => {
    if (!looping || items.length < 2) return;
    const t = setInterval(next, AUTO_ADVANCE_MS);
    return () => clearInterval(t);
  }, [looping, next, items.length]);

  // 鍵盤：← → 換頁、空白鍵切循環、Esc 關閉（Esc 同時會退出瀏覽器全屏，順勢全關）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") { e.preventDefault(); setLooping(l => !l); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  // 瀏覽器全屏（不支援或被拒就維持 overlay 全版面，不報錯干擾放映）。
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      void el.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      void document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!it) return null;
  const seed = seedOf(it.id);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Flow TV 放映"
      data-testid="flowtv-player"
      className="fixed inset-0 z-[100] flex flex-col bg-black"
    >
      {/* 畫面：seed 決定性視覺（與分鏡卡同一套 seedVisual，等 G9 後接真素材） */}
      <div className="absolute inset-0" style={{ background: frameStyle(seed, 0) }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

      {/* 頂列 */}
      <div className="relative z-10 flex items-center gap-2 p-3">
        <Badge variant="outline" className="border-white/30 bg-black/40 text-[10px] text-white">
          {index + 1} / {items.length}
        </Badge>
        <Badge variant="outline" className="border-white/30 bg-black/40 text-[10px] text-white">
          {it.modelHint ?? it.generationMode ?? it.category}
        </Badge>
        <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/80">seed {seed}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" className="size-8 text-white hover:bg-white/15" aria-label="收藏" onClick={() => onToggleFavorite(it.id)}>
            <Star className={cn("size-4", it.isFavorite && "fill-amber-400 text-amber-400")} />
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-white hover:bg-white/15" aria-label={hidePrompt ? "顯示 prompt" : "隱藏 prompt"} onClick={() => setHidePrompt(h => !h)}>
            {hidePrompt ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-white hover:bg-white/15" aria-label={looping ? "暫停循環" : "開始循環"} onClick={() => setLooping(l => !l)}>
            {looping ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-white hover:bg-white/15" aria-label={isFullscreen ? "離開全螢幕" : "全螢幕"} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-white hover:bg-white/15" aria-label="關閉放映" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* 左右換頁 */}
      <div className="relative z-10 flex flex-1 items-center justify-between px-2">
        <Button size="icon" variant="ghost" className="size-10 text-white hover:bg-white/15" aria-label="上一個" onClick={prev}>
          <ChevronLeft className="size-6" />
        </Button>
        <Button size="icon" variant="ghost" className="size-10 text-white hover:bg-white/15" aria-label="下一個" onClick={next}>
          <ChevronRight className="size-6" />
        </Button>
      </div>

      {/* prompt 疊層（Hide Prompt 可收） */}
      <div className="relative z-10 p-4 pb-5">
        {!hidePrompt && (
          <div className="mx-auto max-w-2xl rounded-2xl bg-black/55 p-4 backdrop-blur-sm" data-testid="flowtv-prompt-overlay">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{it.title}</span>
              <span className="font-mono text-[10px] text-white/60">×{it.useCount ?? 0} 重用</span>
            </div>
            <p className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-white/85">
              {it.content}
            </p>
          </div>
        )}
        <div className="mx-auto mt-3 flex max-w-2xl items-center justify-center gap-2">
          <Button size="sm" variant="secondary" className="h-8 text-xs" disabled={regenId !== null} onClick={() => void onRegen(it.id, it.content)}>
            {regenId === it.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} 一鍵重用（再生成）
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-white/30 bg-black/40 text-xs text-white hover:bg-white/15" onClick={() => onFork(it.title, it.content)}>
            <Copy className="size-3.5" /> fork 到編輯表單
          </Button>
        </div>
      </div>
    </div>
  );
}

export default FlowTvBody;
