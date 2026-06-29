// ============================================================================
// shells/video/canvas/CompletionCanvas.tsx — AIDV-282 成片交付畫布
// ----------------------------------------------------------------------------
// 「完成專案」步驟的中欄畫布：
//   • outputUrl 有值 → <video controls> 線上播放器（AIDV-278 P0）
//   • outputUrl 無值（組合中）→ 組合中佔位 + 已核准分鏡縮圖走廊
// 純前端、零新後端、零金鑰；自動通過設計門。
// WCAG 2.1 AA：video 有 aria-label；controls 可鍵盤操作。
// ============================================================================
import { useState } from "react";
import { Download, PlayCircle, CheckCircle2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { frameStyle } from "@/spine/seedVisual";
import type { Shot } from "@/spine/types";
import { trpc } from "@/lib/trpc";

export function CompletionCanvas() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const outputUrl = p.outputUrl ?? null;

  const approvedShots: Shot[] = p.shots
    .filter((s) => s.gen.status === "done" && s.approval === "approved")
    .sort((a, b) => a.no.localeCompare(b.no));

  const totalShots = p.shots.length;
  const doneShots = p.shots.filter((s) => s.gen.status === "done").length;
  const approvedCount = approvedShots.length;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* 標題列 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PlayCircle className="size-3.5 text-primary" />
        <span className="font-medium text-foreground">{p.name}</span>
        <Badge variant="secondary" className="text-[10px]">
          {approvedCount}/{totalShots} 鏡已核准
        </Badge>
      </div>

      {/* 主播放器 / 組合中佔位 */}
      {outputUrl ? (
        <VideoPlayer url={outputUrl} title={p.name} />
      ) : (
        <AssemblingPlaceholder doneShots={doneShots} totalShots={totalShots} />
      )}

      {/* 已核准分鏡縮圖走廊（無論是否有 outputUrl 皆顯示） */}
      {approvedShots.length > 0 && (
        <ShotStrip shots={approvedShots} />
      )}
    </div>
  );
}

// ── 線上播放器（outputUrl 存在時）────────────────────────────────────────────
function VideoPlayer({ url, title }: { url: string; title: string }) {
  const isVideo = /\.(mp4|webm|mov|ogg)(\?.*)?$/i.test(url);
  const requestDownload = trpc.videoProject.requestDownloadByUrl.useMutation();
  const [isDownloading, setIsDownloading] = useState(false);

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const result = await requestDownload.mutateAsync({ assetUrl: url });
      window.open(result.downloadUrl, "_blank");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-card/60 p-3">
      {isVideo ? (
        <video
          key={url}
          src={url}
          controls
          muted
          autoPlay
          loop
          playsInline
          className="w-full rounded-lg"
          aria-label={`${title} 成片預覽`}
        />
      ) : (
        <img
          src={url}
          alt={`${title} 成片預覽`}
          className="w-full rounded-lg object-cover"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">成片已就緒 · 可下載或分享</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2.5 text-xs"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          <Download className="size-3" /> {isDownloading ? "準備中…" : "下載"}
        </Button>
      </div>
    </div>
  );
}

// ── 組合中佔位（outputUrl 尚無值）───────────────────────────────────────────
function AssemblingPlaceholder({ doneShots, totalShots }: { doneShots: number; totalShots: number }) {
  const allDone = doneShots === totalShots && totalShots > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="成片組合進度"
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-muted bg-muted/20 p-8 text-center"
    >
      <Clock className="size-7 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">成片組合中</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {doneShots}/{totalShots} 個鏡頭已生成
          {allDone
            ? "，前往「打包初剪」步驟啟動 zip_export。"
            : "，待全部核准後可啟動打包。"}
        </p>
      </div>
      <Badge variant="outline" className="text-[10px]">待後端 · zip_export</Badge>
    </div>
  );
}

// ── 已核准分鏡縮圖走廊 ───────────────────────────────────────────────────────
function ShotStrip({ shots }: { shots: Shot[] }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-green-500" />
        已核准分鏡（{shots.length} 個）
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {shots.map((s) => {
          const assetUrl = s.gen.assetUrl;
          const isVideo = !!assetUrl && /\.(mp4|webm|mov|ogg)(\?.*)?$/i.test(assetUrl);
          return (
            <div
              key={s.id}
              className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg border bg-muted"
            >
              {assetUrl ? (
                isVideo ? (
                  <video
                    src={assetUrl}
                    muted
                    autoPlay
                    loop
                    playsInline
                    className="absolute inset-0 h-full w-full object-cover"
                    aria-label={s.title}
                  />
                ) : (
                  <img
                    src={assetUrl}
                    alt={s.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )
              ) : (
                <div
                  className={cn("absolute inset-0")}
                  style={{ background: frameStyle(s.seed, s.gen.variant) }}
                  aria-label={s.title}
                />
              )}
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[9px] text-white">
                {s.no}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CompletionCanvas;
