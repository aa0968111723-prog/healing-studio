// ============================================================================
// shells/video/panels/ShotPanel.tsx — 分鏡卡（確認門全狀態 + 生成全狀態）
// ----------------------------------------------------------------------------
// 每張分鏡卡顯示：seed 決定的影格佔位（同 seed 一致）/ 生成狀態（idle·queued·generating·
// done·error·stale）/ 確認門徽章（可量產·部分待補·全待補）/ 核准徽章 / 對應動作：
//   ready+idle → 生成 ｜ blocked/partial+idle → 顯示待補項 ｜ done → 同 seed 重生 / 核准 ｜
//   stale → 重生（已過期）｜ error → 重試
// 動作走 useProjectSpine().generateShot / approveShot（→ P0 generation adapter，generate.* 真實串法）。
// ============================================================================
import { Bolt, RefreshCw, Check, Loader2 } from "lucide-react";
import { PanelEmpty } from "@/shells/_shared/PanelState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { computeGate, GATE_STATE_LABEL } from "@/spine/gate";
import { frameStyle } from "@/spine/seedVisual";
import type { Shot } from "@/spine/types";

export function ShotPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  if (p.shots.length === 0) {
    return <Empty icon="🎞" title="尚無分鏡" desc="用引導式創作或導演台建立。" />;
  }
  return (
    <div className="space-y-2">
      {p.shots.map((sh) => <ShotCard key={sh.id} shot={sh} />)}
    </div>
  );
}

function ShotCard({ shot }: { shot: Shot }) {
  const spine = useProjectSpine();
  const p = spine.project!;
  const g = computeGate(shot, p.characters, p.scenes);
  const gen = shot.gen;
  const blocked = g.reasons[0];
  const gateTone = g.state === "ready" ? "secondary" : g.state === "partial" ? "outline" : "destructive";

  return (
    <div className={cn("overflow-hidden rounded-xl border", shot.stale && "border-amber-500/40", gen.status === "error" && "border-destructive/40")}>
      {/* 縮圖 */}
      <div className="relative flex h-24 items-center justify-center bg-muted">
        {gen.status === "done" && (
          <>
            <div className="absolute inset-0" style={{ background: frameStyle(shot.seed, gen.variant) }} />
            <span className="absolute bottom-1 left-1 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[9px] text-white">
              seed {shot.seed} · {gen.provider}
            </span>
            {shot.stale && (
              <div className="absolute inset-0 flex items-center justify-center bg-amber-950/60">
                <Badge variant="outline" className="border-amber-400 text-amber-200">過期待重生</Badge>
              </div>
            )}
          </>
        )}
        {gen.status === "generating" && (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-[10px]">生成中…</span>
          </div>
        )}
        {gen.status === "error" && <Badge variant="destructive">生成失敗</Badge>}
        {(gen.status === "idle" || gen.status === "queued") && (
          <div className="text-center text-[10px] text-muted-foreground">
            {shot.route === "text" ? "🌄 空景 · 文字生" : "🔒 角色 · 參考圖轉繪"}
            <div className="font-mono text-[9px]">seed {shot.seed}</div>
          </div>
        )}
      </div>

      {/* 中繼資料 + 動作 */}
      <div className="space-y-1.5 p-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{shot.no}</span>
          <span className="truncate">{shot.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={gateTone} className="text-[10px]">{GATE_STATE_LABEL[g.state]}</Badge>
          {shot.approval === "approved" && <Badge variant="secondary" className="text-[10px]">已核准</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(gen.status === "idle" || gen.status === "queued") && g.state === "ready" && (
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => spine.generateShot(shot.id)}>
              <Bolt className="size-3" /> 生成
            </Button>
          )}
          {(gen.status === "idle" || gen.status === "queued") && g.state !== "ready" && (
            <span className="text-[10px] text-muted-foreground">待補：{blocked ? `${blocked.refName}（${blocked.label}）` : "—"}</span>
          )}
          {gen.status === "done" && !shot.stale && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => spine.generateShot(shot.id, { regen: true })}>
              <RefreshCw className="size-3" /> 同 seed 重生
            </Button>
          )}
          {gen.status === "done" && !shot.stale && shot.approval !== "approved" && (
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => spine.approveShot(shot.id)}>
              <Check className="size-3" /> 核准
            </Button>
          )}
          {gen.status === "done" && shot.stale && (
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => spine.generateShot(shot.id, { regen: true })}>
              <RefreshCw className="size-3" /> 重生（已過期）
            </Button>
          )}
          {gen.status === "error" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => spine.generateShot(shot.id)}>
              <RefreshCw className="size-3" /> 重試
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 面板空態：委派共用 PanelEmpty（role="status"，報讀器不會把空誤判成壞）。 */
export function Empty({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <PanelEmpty
      icon={<span className="text-3xl">{icon}</span>}
      title={<span className="font-medium text-foreground">{title}</span>}
      hint={desc}
    />
  );
}

export default ShotPanel;
