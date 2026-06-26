// ============================================================================
// components/social/ExportRatioCard.tsx — S9 B 多尺寸匯出格子
// ----------------------------------------------------------------------------
// AIDV-96 U-6 · /social 九步旅程 S9-B 實裝。
// ExportRatioCard：單一比例匯出卡（IG/Stories/LinkedIn/TikTok/FB/Twitter）。
// ExportRatioGrid：六尺寸匯出格子（S9 B 完整）。
// Seam：Storage → vault.exportToAssets（目前以 mock 延遲模擬）。
// 旗標 ENABLE_AIDV_CHROME ON＝design-kit .aidv-kit scope + 暖光；OFF＝沿用既有樣式。
// ============================================================================
import { useState } from "react";
import { CheckCircle2, Download, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AidvKit, Pill } from "@/components/design-kit";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";

export interface ExportRatioSpec {
  id: string;
  platform: string;
  ratioLabel: string;
  width: number;
  height: number;
}

/** 社群六大主流尺寸（S9 B 完整規格）。 */
export const SOCIAL_EXPORT_RATIOS: ExportRatioSpec[] = [
  { id: "ig_square", platform: "Instagram", ratioLabel: "1:1", width: 1080, height: 1080 },
  { id: "ig_story", platform: "Stories", ratioLabel: "9:16", width: 1080, height: 1920 },
  { id: "linkedin", platform: "LinkedIn", ratioLabel: "4:5", width: 1080, height: 1350 },
  { id: "tiktok", platform: "TikTok", ratioLabel: "9:16", width: 1080, height: 1920 },
  { id: "fb_feed", platform: "Facebook", ratioLabel: "16:9", width: 1280, height: 720 },
  { id: "twitter_x", platform: "Twitter/X", ratioLabel: "16:9", width: 1280, height: 720 },
];

type ExportStatus = "idle" | "exporting" | "done" | "error";

interface ExportRatioCardProps {
  spec: ExportRatioSpec;
  status: ExportStatus;
  disabled?: boolean;
  onExport: (id: string) => void;
}

/** 單一比例匯出卡（含狀態反饋：idle/exporting/done/error）。 */
export function ExportRatioCard({ spec, status, disabled, onExport }: ExportRatioCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 transition-colors",
        status === "done"
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="text-sm font-medium">{spec.platform}</div>
          <div className="text-xs text-muted-foreground">
            {spec.ratioLabel} · {spec.width}×{spec.height}
          </div>
        </div>
        <div className="mt-0.5 shrink-0">
          {status === "exporting" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="匯出中" />}
          {status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="已完成" />}
          {status === "error" && <AlertTriangle className="h-4 w-4 text-destructive" aria-label="失敗" />}
        </div>
      </div>

      <Button
        size="sm"
        variant={status === "done" ? "secondary" : "default"}
        disabled={disabled || status === "exporting"}
        onClick={() => onExport(spec.id)}
        className={cn(
          "w-full",
          ENABLE_AIDV_CHROME && status !== "done"
            ? "border-transparent bg-[var(--clay)] text-[var(--on-clay)] hover:bg-[var(--clay-dark)]"
            : "",
        )}
      >
        <Download className="h-3.5 w-3.5" aria-hidden />
        {status === "exporting" ? "匯出中…" : status === "done" ? "重新匯出" : "匯出"}
      </Button>

      {status === "error" && (
        ENABLE_AIDV_CHROME ? (
          <Pill kind="bad">匯出失敗 · vault.exportToAssets</Pill>
        ) : (
          <span className="text-xs text-destructive">匯出失敗（請重試）</span>
        )
      )}
    </div>
  );
}

interface ExportRatioGridProps {
  disabled?: boolean;
  onExport?: (specId: string, dataUrl: string) => void;
  className?: string;
}

/** S9 B 多尺寸匯出格子（六平台）。 */
export function ExportRatioGrid({ disabled, onExport, className }: ExportRatioGridProps) {
  const [statuses, setStatuses] = useState<Record<string, ExportStatus>>({});

  function handleExport(id: string) {
    setStatuses((prev) => ({ ...prev, [id]: "exporting" }));
    // mock delay（真實接縫：vault.exportToAssets，待建）
    setTimeout(() => {
      setStatuses((prev) => ({ ...prev, [id]: "done" }));
      onExport?.(id, `data:image/png;mock,${id}`);
    }, 800);
  }

  const grid = (
    <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
      {SOCIAL_EXPORT_RATIOS.map((spec) => (
        <ExportRatioCard
          key={spec.id}
          spec={spec}
          status={statuses[spec.id] ?? "idle"}
          disabled={disabled}
          onExport={handleExport}
        />
      ))}
    </div>
  );

  if (ENABLE_AIDV_CHROME) {
    return <AidvKit>{grid}</AidvKit>;
  }
  return grid;
}
