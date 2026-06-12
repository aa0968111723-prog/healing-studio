// ============================================================================
// shells/video/console/ContextSidecar.tsx — 右欄：Context Sidecar
// ----------------------------------------------------------------------------
// Context Packet（token 計量 + TTL + 重建）｜確認門 readiness（ConfirmGate）｜成本儀表
//（credits 餘額 + 退款政策）｜版本 diff（過期待重生彙整 + deep-link）｜評論（筆記快速新增）。
// 成本「模型階梯 / 估點」常駐儀表在頂部 CreationFlowBar；此處放餘額 + 退款風險。
// ============================================================================
import { useMemo, useState } from "react";
import {
  Database, RefreshCw, Cloud, HardDrive, Coins, History, MessageSquarePlus, Layers,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { ConfirmGate } from "../ConfirmGate";
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
          <p className="mt-2 text-[10px] text-muted-foreground">過期＝角色改設定的版本連動；完整逐欄 diff／資產血統檢視待後端。</p>
        </CardContent>
      </Card>

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

export default ContextSidecar;
