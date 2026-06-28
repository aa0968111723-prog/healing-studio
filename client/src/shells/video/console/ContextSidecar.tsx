// ============================================================================
// shells/video/console/ContextSidecar.tsx — 右欄：Context Sidecar
// ----------------------------------------------------------------------------
// Context Packet（token 計量 + TTL + 重建）｜確認門 readiness（ConfirmGate）｜成本儀表
//（credits 餘額 + 退款政策）｜版本 diff（過期待重生彙整 + deep-link）｜評論（筆記快速新增）。
// 成本「模型階梯 / 估點」常駐儀表在頂部 CreationFlowBar；此處放餘額 + 退款風險。
// ============================================================================
import { useMemo, useState } from "react";
import {
  Database, RefreshCw, Cloud, HardDrive, Coins, History, MessageSquarePlus, Layers, Link2,
  MoreVertical, Copy, RotateCcw, Film,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { ConfirmGate } from "../ConfirmGate";
import { AgentProgressPanel } from "./AgentProgressPanel";
import { trpc } from "@/lib/trpc";
import { PanelError } from "@/shells/_shared/PanelState";

const CLOUD_RE = /教材|Drive|發佈|選題|品牌|news/i;

export function ContextSidecar() {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;
  const packet = p.packet;
  const tokenPct = Math.min(100, (packet.tokenEstimate / 8000) * 100);

  const [note, setNote] = useState("");

  const staleShots = useMemo(() => p.shots.filter((s) => s.stale), [p.shots]);

  return (
    <div className="space-y-4 self-start">
      {/* Context Packet */}
      <Card className="glass-card-static">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="size-4 text-primary" /> Context Packet
            <Badge variant="outline" className="ml-auto text-[10px]">
              {spine.mode === "mock" ? "mock" : "機 + 雲"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {packet.sourceRefs.length > 0 && (
            <ul className="space-y-1">
              {packet.sourceRefs.slice(0, 4).map((r, i) => {
                const cloud = CLOUD_RE.test(r.kind);
                return (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1">
                    {cloud ? <Cloud className="size-3 shrink-0 text-sky-500" /> : <HardDrive className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate text-[11px]">{r.kind}</span>
                    <Badge variant={r.fresh ? "secondary" : "outline"} className="shrink-0 text-[9px]">
                      {r.fresh ? "新鮮" : "過期"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="rounded-xl border bg-card/60 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">壓縮上下文</span>
              <span className="font-mono text-primary">{packet.tokenEstimate.toLocaleString()} tok</span>
            </div>
            <Progress value={tokenPct} className="mt-2 h-1.5" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">
                TTL {Math.round(packet.ttlSec / 60)} 分 · {packet.permissions}
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => spine.rebuildPacket()}>
                <RefreshCw className="size-3" /> 重建
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 確認門 readiness */}
      <ConfirmGate />

      {/* 成本儀表（餘額 + 退款風險） */}
      <CostMeter />

      {/* 代理即時狀態 — AIDV-358 */}
      <AgentProgressPanel />

      {/* AIDV-253: 影片專案三點選單（複製）＋版本歷程 */}
      <VideoProjectLifecycleCard />

      {/* 版本 diff（過期待重生） */}
      <Card className="glass-card-static">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4 text-primary" /> 版本 · 過期
            <Badge variant="outline" className="ml-auto text-[10px]">{staleShots.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {staleShots.length === 0 ? (
            <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
              <Layers className="size-3.5" /> 無過期鏡 · 角色改設定會連動標記。
            </div>
          ) : (
            <ul className="space-y-1">
              {staleShots.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => console_.deepLinkToShot(s.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-left transition-healing hover:bg-amber-500/10"
                  >
                    <RefreshCw className="size-3.5 shrink-0 text-amber-500" />
                    <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">{s.no}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{s.title}</span>
                    <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">重生</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">過期＝角色改設定的版本連動；資產血統詳見下方。</p>
        </CardContent>
      </Card>

      {/* 資產血統 (W3-F AIDV-51) */}
      <AssetLineageCard />

      {/* 評論 / 筆記 */}
      <Card className="glass-card-static">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageSquarePlus className="size-4 text-primary" /> 評論 · 筆記
            <Badge variant="outline" className="ml-auto text-[10px]">{p.notes.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={console_.focusShot ? `對 ${console_.focusShot.no} 加註…` : "加一條筆記…"}
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && note.trim()) {
                  void spine.addNote(note.trim(), console_.focusShot?.no);
                  setNote("");
                }
              }}
            />
            <Button
              size="sm"
              className="h-8 shrink-0 px-2"
              disabled={!note.trim()}
              onClick={() => {
                if (!note.trim()) return;
                void spine.addNote(note.trim(), console_.focusShot?.no);
                setNote("");
              }}
            >
              新增
            </Button>
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {p.notes.slice(0, 8).map((n) => (
              <li key={n.id} className="rounded-lg bg-muted/40 px-2 py-1.5 text-[11px]">
                {n.shotNo && <span className="mr-1 font-mono text-[9px] text-primary">{n.shotNo}</span>}
                {n.text}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** 成本儀表：credits 餘額 + 原子扣退政策（先估→先扣→失敗全額退）。 */
function CostMeter() {
  const balance = trpc.credits.myBalance.useQuery(undefined, { staleTime: 30_000 });
  return (
    <Card className="glass-card-static">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Coins className="size-4 text-primary" /> 成本 · 積分
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {balance.isLoading ? (
          <div className="text-xs text-muted-foreground">讀取餘額…</div>
        ) : balance.isError ? (
          <PanelError compact message="積分餘額讀取失敗" onRetry={() => balance.refetch()} />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-bold tabular-nums text-primary">
              {(balance.data?.remaining ?? 0).toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">pts 可用</span>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          先估成本 → 先扣後生成（原子）· 失敗 <span className="text-emerald-600 dark:text-emerald-400">全額退還</span> ·
          斷路器 3 連敗開路、冷卻 10 分 · 1–500 pts，不涉真實金錢。
        </p>
      </CardContent>
    </Card>
  );
}

const RELATION_LABEL: Record<string, string> = {
  derived: "衍生",
  variant: "變體",
  rewrite: "改寫",
  extended: "延長",
};

/** W3-F 血統檢視 v1（AIDV-51）：最近有 prompt 連結的資產，唯讀。 */
function AssetLineageCard() {
  const q = trpc.assets.recentLineage.useQuery(undefined, { staleTime: 60_000, retry: 1 });

  if (q.isLoading) return null;
  if (q.isError || !q.data?.length) return null;

  return (
    <Card className="glass-card-static">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Link2 className="size-4 text-primary" /> 資產血統 · 生成溯源
          <Badge variant="outline" className="ml-auto text-[10px]">{q.data.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {q.data.map((row, i) => (
            <li key={i} className="rounded-lg border border-border/50 bg-muted/30 p-2 text-[11px] space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-foreground/80 truncate flex-1">{row.assetTitle}</span>
                <Badge variant="secondary" className="text-[9px] shrink-0">{row.assetType}</Badge>
                <Badge variant="outline" className="text-[9px] shrink-0 text-violet-600 dark:text-violet-400">
                  {RELATION_LABEL[row.relation] ?? row.relation}
                </Badge>
              </div>
              <div className="text-muted-foreground/70 truncate">
                ← {row.promptTitle || row.promptContent?.slice(0, 60) || "（無標題）"}
              </div>
              {row.sourceStudio && (
                <div className="text-[10px] text-muted-foreground/50">{row.sourceStudio}{row.modelId ? ` · ${row.modelId.split("/").pop()}` : ""}</div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-muted-foreground/60">僅顯示已連結到提示詞庫的最近 5 筆；完整血統樹待 M2。</p>
      </CardContent>
    </Card>
  );
}

/** AIDV-253: 影片專案生命週期 — 三點選單「複製專案」＋版本歷程。 */
export function VideoProjectLifecycleCard() {
  const utils = trpc.useUtils();
  // AIDV-307：改用游標分頁的 infinite query，避免重度用戶一次載入上百支影片。
  const projectsQ = trpc.videoProject.list.useInfiniteQuery(
    { limit: 20 },
    {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    },
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const projects = projectsQ.data?.pages.flatMap(p => p.items) ?? [];
  const project = projects.find(p => p.id === selectedId) ?? projects[0] ?? null;

  const duplicateMut = trpc.videoProject.duplicate.useMutation({
    onSuccess: (data) => {
      toast.success(`已複製為新專案 (id: ${data.id})`);
      utils.videoProject.list.invalidate();
    },
    onError: () => toast.error("複製失敗，請稍後再試"),
  });

  if (projectsQ.isError) return <PanelError compact message="影片專案讀取失敗" onRetry={() => projectsQ.refetch()} />;
  if (!project) return null;

  return (
    <Card className="glass-card-static">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Film className="size-4 text-primary" /> 影片專案
          <div className="ml-auto flex items-center gap-1">
            {projects.length > 1 && (
              <select
                aria-label="切換影片專案"
                value={selectedId ?? project.id}
                onChange={e => setSelectedId(Number(e.target.value))}
                className="rounded border bg-background px-1.5 py-0.5 text-[10px]"
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
            {projectsQ.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                aria-label="載入更多影片專案"
                disabled={projectsQ.isFetchingNextPage}
                onClick={() => projectsQ.fetchNextPage()}
              >
                {projectsQ.isFetchingNextPage ? "載入中…" : "載入更多"}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6" aria-label="專案選項">
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => duplicateMut.mutate({ sourceId: project.id })}
                  disabled={duplicateMut.isPending}
                >
                  <Copy className="mr-2 size-3.5" /> 複製專案
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium truncate flex-1">{project.title}</span>
          <Badge variant="outline" className="text-[9px] shrink-0">{project.aspectRatio}</Badge>
          <span className="text-muted-foreground shrink-0">v{project.version}</span>
        </div>
        <VersionHistoryPanel projectId={project.id} />
      </CardContent>
    </Card>
  );
}

/** AIDV-253/227: 版本歷程面板（listSnapshots + restoreSnapshot）。 */
function VersionHistoryPanel({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const snapsQ = trpc.videoProject.listSnapshots.useQuery(
    { projectId, limit: 8 },
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const restoreMut = trpc.videoProject.restoreSnapshot.useMutation({
    onSuccess: () => {
      toast.success("已回溯至選定版本，並備份當前狀態為 pre-restore 快照");
      utils.videoProject.listSnapshots.invalidate({ projectId });
      utils.videoProject.list.invalidate();
    },
    onError: () => toast.error("回溯失敗，請稍後再試"),
  });

  const snaps = snapsQ.data ?? [];

  if (snapsQ.isLoading) {
    return <div className="text-[10px] text-muted-foreground animate-pulse">讀取版本歷程…</div>;
  }
  if (snapsQ.isError) {
    return <PanelError compact message="版本歷程讀取失敗" onRetry={() => snapsQ.refetch()} />;
  }
  if (snaps.length === 0) {
    return <div className="text-[10px] text-muted-foreground">尚無版本快照</div>;
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <History className="size-3" /> 版本歷程
        <Badge variant="outline" className="ml-auto text-[9px]">{snaps.length}</Badge>
      </div>
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {snaps.map(snap => (
          <li key={snap.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5 text-[10px]">
            <div className="flex-1 min-w-0">
              <span className="font-mono text-primary mr-1.5">#{snap.id}</span>
              <Badge variant="secondary" className="text-[8px] mr-1">{snap.source}</Badge>
              <span className="text-muted-foreground">
                {new Date(snap.createdAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[9px] shrink-0"
              disabled={restoreMut.isPending}
              onClick={() => restoreMut.mutate({ projectId, snapshotId: snap.id })}
              title="回溯至此版本"
            >
              <RotateCcw className="size-2.5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ContextSidecar;
