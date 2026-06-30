// ============================================================================
// shells/video/canvas/RoughCutCanvas.tsx — 中欄畫布：S4 初剪打包（時間軸總覽 + zip_export 估算）
// ----------------------------------------------------------------------------
// 北極星 S4：把已生成・已核准的鏡頭依序打包成初剪 → zip_export → MP4。
//   • 時間軸雛形：鏡頭依鏡號排序的分段總覽（trim/配對/拖排序為 S4-2，先佔位）。
//   • 鐵則：未核准鏡頭不打包 → 偵測到已生成但未核准時，頂部出未核准 banner、停用打包鈕。
//   • zip_export 估算：固定 EXPORT_PTS 點（對映 background_jobs.zip_export）。
// 真實接點：實際打包走 background_jobs 的 zip_export worker —— **worker 實作待後端**，
//   故點打包只先把估算與佇列佔位化（honest「待後端」，不偽裝成已完成）。零新後端 procedure。
// ============================================================================
import { useMemo, useState } from "react";
import { Clapperboard, AlertTriangle, Check, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
// U-5（AIDV-95）採用片 · /video S4 初剪：旗標 ON 時頂部改用 design-kit 亮色暖光「確認門摘要」
// （可打包/待核准/未生成＝ready/partial/blocked 三態大數字 + Pill），把「未核准不打包」
// 的品管脊椎視覺化；OFF（預設）＝沿用既有 amber banner＝零變化。動作接點（setQueued/打包）不變。
// 設計門依 ui-ux-pro-max「色彩非唯一資訊（High）」：三態皆保留文字標籤，非僅靠顏色。
import { ENABLE_VIDEO_GATE_KIT } from "@/config/videoFlags";
import { AidvKit, Card, Pill } from "@/components/design-kit";

/** zip_export 估算點數（固定；對映 background_jobs.zip_export → MP4 1080p）。 */
export const EXPORT_PTS = 50;

/** 初剪確認門摘要（design-kit 暖光）：把「可打包/待核准/未生成」三態以大數字 + Pill 呈現。
 *  純呈現、無自有狀態；ready=可打包（已核准）/ partial=待核准（已生成未核准）/ blocked=未生成。 */
function PackGateSummary({ ready, partial, blocked }: { ready: number; partial: number; blocked: number }) {
  const Big = ({ kind, n, label }: { kind: "ok" | "warn" | "bad"; n: number; label: string }) => {
    const col = kind === "ok" ? "text-[var(--ok)]" : kind === "warn" ? "text-[var(--gold-deep)]" : "text-[var(--bad)]";
    return (
      <div className={`flex-1 min-w-[78px] text-center p-3 rounded-[14px] border ${kind === "ok" ? "border-[rgba(92,138,85,.26)] bg-[var(--ok-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}>
        <b className={`block font-serif text-[24px] leading-[1.05] font-semibold ${col}`}>{n}</b>
        <span className="text-[10.5px] text-[var(--text-mute)]">{label}</span>
      </div>
    );
  };
  return (
    <AidvKit>
      <Card className="overflow-hidden border-[var(--gold-soft)] bg-[linear-gradient(160deg,var(--gold-tint),var(--surface-3))]" role="status" aria-live="polite" aria-label="初剪確認門">
        <div className="flex items-center gap-2 px-[14px] py-[10px] text-[12.5px] font-semibold text-[var(--gold-deep)] border-b border-[rgba(200,146,47,.22)]">
          <Package className="size-4" aria-hidden /> 確認門 · 初剪打包就緒度
        </div>
        <div className="p-[14px]">
          <div className="flex gap-[9px] flex-wrap">
            <Big kind="ok" n={ready} label="可打包" />
            <Big kind="warn" n={partial} label="待核准" />
            <Big kind="bad" n={blocked} label="未生成" />
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12px]">
            {partial > 0 ? (
              <><Pill kind="warn">阻擋</Pill><span className="flex-1 text-[var(--text-soft)]">{partial} 個鏡頭已生成但未核准 — 打包前先到「分鏡」核准。</span></>
            ) : ready > 0 ? (
              <><Pill kind="ok">就緒</Pill><span className="flex-1 text-[var(--ok)]">所有已生成鏡頭皆已核准 · 可打包初剪。</span></>
            ) : (
              <><Pill kind="mute">部分</Pill><span className="flex-1 text-[var(--text-soft)]">尚無已生成鏡頭 — 先到「分鏡」生成並核准。</span></>
            )}
          </div>
          <p className="mt-3 pt-3 border-t border-dashed border-[var(--line-strong)] font-mono text-[9.5px] leading-[1.7] text-[var(--muted-2)] tracking-[.02em]">
            未核准鏡頭不打包 · 打包前先估 zip_export 成本（{EXPORT_PTS} pt → MP4 1080p）
          </p>
        </div>
      </Card>
    </AidvKit>
  );
}

export function RoughCutCanvas() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const [queued, setQueued] = useState(false);

  // 分段＝鏡頭依鏡號排序（時間軸雛形；trim/配對/拖排序＝S4-2）。
  const segments = useMemo(() => [...p.shots].sort((a, b) => a.no.localeCompare(b.no)), [p.shots]);
  const doneCount = segments.filter((s) => s.gen.status === "done").length;
  const unapproved = segments.filter((s) => s.gen.status === "done" && s.approval !== "approved");
  const canPack = doneCount > 0 && unapproved.length === 0;
  // 確認門三態（與 amber banner 同事實基準；旗標 ON 時餵 design-kit PackGateSummary）。
  const readyCount = segments.filter((s) => s.gen.status === "done" && s.approval === "approved").length;
  const blockedCount = segments.filter((s) => s.gen.status !== "done").length;

  if (segments.length === 0) {
    return (
      <div role="status" className="flex h-full flex-col items-center justify-center gap-1.5 py-10 text-center text-muted-foreground">
        <Clapperboard className="size-6" />
        <div className="text-sm">尚無分鏡可打包</div>
        <div className="text-[11px]">先到「分鏡」生成並核准鏡頭，再回來打包初剪。</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clapperboard className="size-3.5 text-primary" /> 初剪打包 · 時間軸（{segments.length} 段 · 已生成 {doneCount}）
      </div>

      {/* 確認門：旗標 ON → design-kit 暖光摘要（三態大數字）；OFF（預設）→ 既有 amber banner。 */}
      {ENABLE_VIDEO_GATE_KIT ? (
        <PackGateSummary ready={readyCount} partial={unapproved.length} blocked={blockedCount} />
      ) : (
        unapproved.length > 0 && (
          <div role="alert" aria-atomic="true" className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">{unapproved.length} 個鏡頭已生成但未核准 — 打包前請先到「分鏡」核准。</span>
          </div>
        )
      )}

      {/* 時間軸雛形：依鏡號排序的分段 */}
      <ol className="space-y-1.5">
        {segments.map((s, i) => {
          const status = s.gen.status;
          const approved = s.approval === "approved";
          return (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border p-2">
              <span className="font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] text-primary">{s.no}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.title}</span>
              {status === "done" ? (
                approved ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]"><Check className="size-2.5" /> 已核准</Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">待核准</Badge>
                )
              ) : status === "generating" ? (
                <Badge variant="outline" className="shrink-0 text-[10px]"><Loader2 className="size-2.5 animate-spin" /> 生成中</Badge>
              ) : status === "error" ? (
                <Badge variant="destructive" className="shrink-0 text-[10px]">失敗</Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 text-[10px]">未生成</Badge>
              )}
            </li>
          );
        })}
      </ol>

      {/* zip_export 估算 + 打包 */}
      <div className="mt-auto rounded-xl border bg-card/60 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">zip_export 估算</span>
          <span className="font-mono">{EXPORT_PTS} pt → MP4 1080p</span>
        </div>
        <Button size="sm" className="mt-2 w-full" disabled={!canPack || queued} onClick={() => setQueued(true)}>
          <Package className="size-4" /> 打包初剪（{EXPORT_PTS} pt）
        </Button>
        {!canPack && !queued && (
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {doneCount === 0 ? "尚無已生成鏡頭可打包。" : `尚有 ${unapproved.length} 個未核准鏡頭，先核准再打包。`}
          </p>
        )}
        {queued && (
          <div className="mt-2 rounded-lg border border-dashed bg-card/40 p-2.5 text-center">
            <Badge variant="outline" className="mb-1 text-[10px]">待後端</Badge>
            <p className="text-[11px] text-muted-foreground">
              已排入 zip_export（{EXPORT_PTS} pt）· background_jobs.zip_export worker 實作待補 · 完成後輸出 MP4 1080p。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoughCutCanvas;
