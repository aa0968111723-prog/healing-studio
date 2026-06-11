// ============================================================================
// shells/video/canvas/ShotDetailCanvas.tsx — 中欄畫布：2-3 分鏡 GATE / ShotCard（修復點）
// ----------------------------------------------------------------------------
// S0X deep-link 的落點：聚焦單一鏡頭，顯示大圖 + 確認門待補原因 + 就地修復（上傳參考照）
//   + 生成/核准/重生動作。鐵則：角色未定版不進分鏡、關鍵影格未核准不跑 i2v、先估成本。
// 全走 useProjectSpine()；gate 由 spine/gate.ts 計算。
// ============================================================================
import { Bolt, RefreshCw, Check, Loader2, Upload, MapPin, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { computeGate } from "@/spine/gate";
import { frameStyle } from "@/spine/seedVisual";
import { ReadinessChip, ApprovedChip } from "../console/ReadinessChip";

export function ShotDetailCanvas() {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;
  const shot = console_.focusShot;

  if (!shot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <Film className="size-9" />
        <div className="text-sm font-medium">從左側 Story Spine 選一個鏡頭</div>
        <div className="max-w-xs text-xs">S0X 為導航主軸 · 點任一鏡（或 readiness chip）到這裡修復、生成、核准。</div>
      </div>
    );
  }

  const g = computeGate(shot, p.characters, p.scenes);
  const gen = shot.gen;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      {/* 標頭 */}
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">{shot.no}</span>
        <span className="text-sm font-semibold">{shot.title}</span>
        <span className="text-[10px] text-muted-foreground">第 {shot.act} 幕 · {shot.route === "text" ? "文字生圖" : "角色參考"}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <ReadinessChip state={g.state} />
          {shot.approval === "approved" && <ApprovedChip />}
        </div>
      </div>

      {/* 大圖 */}
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border bg-muted">
        {gen.status === "done" && (
          <>
            <div className="absolute inset-0" style={{ background: frameStyle(shot.seed, gen.variant) }} />
            <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 font-mono text-[10px] text-white">
              seed {shot.seed} · {gen.provider}
            </span>
            {shot.stale && (
              <div className="absolute inset-0 flex items-center justify-center bg-amber-950/50">
                <Badge variant="outline" className="border-amber-400 text-amber-100">過期待重生</Badge>
              </div>
            )}
          </>
        )}
        {gen.status === "generating" && (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-7 animate-spin" />
            <span className="text-xs">生成中…（掃光 + 輪詢 generate.jobStatus）</span>
          </div>
        )}
        {gen.status === "error" && <Badge variant="destructive">生成失敗 · 可重試或切 provider</Badge>}
        {(gen.status === "idle" || gen.status === "queued") && (
          <div className="text-center text-xs text-muted-foreground">
            {shot.route === "text" ? "🌄 空景 · 文字生成" : "🔒 角色 · 參考圖轉繪"}
            <div className="font-mono text-[10px]">seed {shot.seed}</div>
          </div>
        )}
      </div>

      {/* 確認門待補原因 + 就地修復 */}
      {g.reasons.length > 0 && (
        <div className="space-y-1.5 rounded-xl border bg-card/60 p-2.5">
          <div className="text-xs font-medium">確認門待補（{g.reasons.length}）</div>
          {g.reasons.map((r) => (
            <div key={`${r.kind}:${r.refId}`} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5">
              {r.kind === "scene-missing-location" ? <MapPin className="size-4 shrink-0 text-amber-500" /> : <Upload className="size-4 shrink-0 text-amber-500" />}
              <span className="min-w-0 flex-1 text-xs">
                <span className="font-medium">{r.refName}</span>
                <Badge variant="outline" className="ml-1.5 align-middle text-[10px]">{r.label}</Badge>
              </span>
              {r.unlockable ? (
                <Button size="sm" variant="secondary" className="h-7 shrink-0 px-2 text-xs" onClick={() => spine.uploadReference(r.refId)}>
                  <Upload className="size-3" /> 上傳參考照
                </Button>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">場景頁鎖定實景</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 動作（gate × status） */}
      <div className="flex flex-wrap items-center gap-2">
        {(gen.status === "idle" || gen.status === "queued") && g.state === "ready" && (
          <Button size="sm" onClick={() => spine.generateShot(shot.id)}>
            <Bolt className="size-4" /> 生成（先估成本）
          </Button>
        )}
        {(gen.status === "idle" || gen.status === "queued") && g.state !== "ready" && (
          <span className="text-xs text-muted-foreground">補齊待補項後即可生成（角色未定版不進分鏡）。</span>
        )}
        {gen.status === "done" && !shot.stale && (
          <Button size="sm" variant="outline" onClick={() => spine.generateShot(shot.id, { regen: true })}>
            <RefreshCw className="size-4" /> 同 seed 重生
          </Button>
        )}
        {gen.status === "done" && !shot.stale && shot.approval !== "approved" && (
          <Button size="sm" variant="secondary" onClick={() => spine.approveShot(shot.id)}>
            <Check className="size-4" /> 核准關鍵影格
          </Button>
        )}
        {gen.status === "done" && shot.stale && (
          <Button size="sm" variant="secondary" onClick={() => spine.generateShot(shot.id, { regen: true })}>
            <RefreshCw className="size-4" /> 重生（已過期）
          </Button>
        )}
        {gen.status === "error" && (
          <Button size="sm" variant="outline" onClick={() => spine.generateShot(shot.id)}>
            <RefreshCw className="size-4" /> 重試
          </Button>
        )}
      </div>
    </div>
  );
}

export default ShotDetailCanvas;
