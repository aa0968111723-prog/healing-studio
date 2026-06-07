// ============================================================================
// components/social/PosterPreview.tsx — composeLayout 確定性預覽
// ----------------------------------------------------------------------------
// 渲染 social/composeLayout.ts 產生的確定性 SVG（文字層）。SVG 由我們自己逃逸
// (escapeXml) 後產生，無外部 HTML 注入；以 <img src=dataUrl> 呈現（最安全、可右鍵存）。
// 低對比 / overflow 警告以行內提示呈現（不報錯、不白屏）。
// ============================================================================
import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { composeLayout, svgToDataUrl, type ComposeLayoutReq } from "@/social/composeLayout";
import { aspectRatio } from "@/social/sizePresets";

interface PosterPreviewProps extends ComposeLayoutReq {
  className?: string;
  /** 顯示確定性雜湊（除錯/驗收用）。 */
  showHash?: boolean;
}

export function PosterPreview({ className, showHash, ...req }: PosterPreviewProps) {
  const { svg, warnings, contentHash } = useMemo(() => composeLayout(req), [req]);
  const dataUrl = useMemo(() => svgToDataUrl(svg), [svg]);
  const ratio = aspectRatio(req.preset);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="relative overflow-hidden rounded-xl border bg-muted"
        style={{ aspectRatio: String(ratio) }}
      >
        {/* 確定性 SVG 文字層（背景＋文字皆在 SVG 內）。 */}
        <img
          src={dataUrl}
          alt={req.slots.headline ?? "社群圖預覽"}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {req.preset.platform} · {req.preset.ratioLabel} · {req.preset.width}×{req.preset.height}
        </span>
        {showHash && <span className="font-mono">#{contentHash}</span>}
      </div>

      {warnings.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {warnings.includes("low_contrast") && "品牌中性色在此底色對比未達 WCAG AA，已自動替代為高對比色（建議調整品牌色票）。"}
            {warnings.includes("overflow") && " 文字超出安全區（建議精簡或換較大版型）。"}
          </span>
        </div>
      )}
    </div>
  );
}

export default PosterPreview;
