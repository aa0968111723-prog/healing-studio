// ============================================================================
// components/social/SizeExportGrid.tsx — 多尺寸匯出格（master → variants）
// ----------------------------------------------------------------------------
// 設計依據：AI-Director_社群圖文系統設計.md §3.4。
//   一張 master 合成 → 依預設集 re-frame/re-layout → 每尺寸一份資產。每個變體用
//   composeLayout 依該 preset 的 orientation「重排版面」（非粗暴拉伸）即時預覽。
//   匯出即資產：每變體寫 digital_asset_library（real → Storage 接縫 recordGenResult，
//   sourceStudio:'social'、provider、ratioPreset）。STEP 4 of the flow。
// ============================================================================
import { useMemo, useState } from "react";
import { Download, DownloadCloud, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 視覺實裝第 2 片：
//   匯出尺寸的「群組濾鏡列」（社群/限動/訊息/印刷）旗標 ON 時改用 design-kit SubTabs，
//   OFF（預設）＝沿用既有 pill 按鈕＝零變化（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, SubTabs } from "@/components/design-kit";
import {
  SIZE_PRESETS, GROUP_LABEL, presetsByGroup, getPreset, aspectRatio,
  type PresetGroup, type SizePreset,
} from "@/social/sizePresets";
import { composeLayout, svgToDataUrl } from "@/social/composeLayout";
import type { ComposeLayoutReq } from "@/social/composeLayout";

type BaseReq = Omit<ComposeLayoutReq, "preset">;

export interface ExportedVariant {
  presetId: string;
  dataUrl: string;
  contentHash: string;
}

interface SizeExportGridProps extends BaseReq {
  /** 已勾選要匯出的 preset ids。 */
  selected: string[];
  onToggle: (presetId: string) => void;
  /** 匯出單一尺寸（呼叫端寫 digital_asset_library / 記到貼文）。 */
  onExport: (preset: SizePreset, variant: ExportedVariant) => void;
  /** 是否禁用（如：單張未核准 / 品牌未鎖）。 */
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

const GROUPS: PresetGroup[] = ["social", "story", "messaging", "print"];

/**
 * 匯出尺寸的群組濾鏡列（社群/限動/訊息/印刷）。U-6/AIDV-96 逐殼採用第 2 片：
 *   旗標 ON＝design-kit SubTabs（殼內子分頁語意，自帶 tablist/tab + aria-selected）；
 *   OFF（預設）＝既有 pill 按鈕＝零變化。純展示、純選取（無導覽、無後端）＝可回滾。
 *   設計門 ui-ux-pro-max「色彩非唯一資訊(High)」：兩版皆保留文字標籤＋選取態語意。
 */
export function ExportGroupTabs({ group, onSelect }: { group: PresetGroup; onSelect: (g: PresetGroup) => void }) {
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="div">
        <SubTabs
          tabs={GROUPS.map((g) => ({ id: g, label: GROUP_LABEL[g] }))}
          active={group}
          onSelect={(id) => onSelect(id as PresetGroup)}
        />
      </AidvKit>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {GROUPS.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onSelect(g)}
          className={cn(
            "rounded-full px-3 py-1 text-xs transition",
            group === g ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
          )}
        >
          {GROUP_LABEL[g]}
        </button>
      ))}
    </div>
  );
}

export function SizeExportGrid({
  selected, onToggle, onExport, disabled, disabledReason, className, ...base
}: SizeExportGridProps) {
  const [group, setGroup] = useState<PresetGroup>("social");
  const presets = useMemo(() => presetsByGroup(group), [group]);

  const buildVariant = (preset: SizePreset): ExportedVariant => {
    const { svg, contentHash } = composeLayout({ ...base, preset });
    return { presetId: preset.id, dataUrl: svgToDataUrl(svg), contentHash };
  };

  const exportOne = (preset: SizePreset) => {
    if (disabled) return;
    onExport(preset, buildVariant(preset));
  };

  const exportSelected = () => {
    if (disabled) return;
    selected.forEach((id) => {
      const p = getPreset(id);
      if (p) onExport(p, buildVariant(p));
    });
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ExportGroupTabs group={group} onSelect={setGroup} />
        <Button size="sm" variant="secondary" onClick={exportSelected} disabled={disabled || selected.length === 0}>
          <DownloadCloud className="h-4 w-4" /> 匯出已選 {selected.length} 個
        </Button>
      </div>

      {disabled && disabledReason && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{disabledReason}</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {presets.map((preset) => {
          const isSel = selected.includes(preset.id);
          const { svg, warnings } = composeLayout({ ...base, preset });
          const dataUrl = svgToDataUrl(svg);
          return (
            <div key={preset.id} className={cn("overflow-hidden rounded-lg border", isSel && "ring-2 ring-primary")}>
              <button
                type="button"
                onClick={() => onToggle(preset.id)}
                className="relative block w-full bg-muted"
                style={{ aspectRatio: String(aspectRatio(preset)) }}
                aria-pressed={isSel}
                aria-label={`選取 ${preset.platform}`}
              >
                <img src={dataUrl} alt={preset.platform} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                {isSel && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-0.5 text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                {warnings.includes("low_contrast") && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-amber-500/90 px-1 text-[9px] text-black">對比低</span>
                )}
              </button>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{preset.platform}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {preset.ratioLabel} · {preset.print ? `${preset.dpi}dpi` : `${preset.width}px`}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => exportOne(preset)} disabled={disabled} aria-label={`匯出 ${preset.platform}`}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        共 {SIZE_PRESETS.length} 種預設。比例變化大時（1:1↔9:16）由 composeLayout 重排版面而非拉伸；
        匯出每變體寫 <Badge variant="outline" className="px-1 py-0 text-[10px]">digital_asset_library</Badge>（sourceStudio:'social'）。
      </p>
    </div>
  );
}

export default SizeExportGrid;
