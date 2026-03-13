import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VaultDropzone } from "@/components/ConsistencyVault";
import { ZenTooltip } from "@/components/ZenCoPilot";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ImageWorkspaceState = {
  aspectRatio: string;
  negativePrompt: string;
  styleReferenceUrl: string | null;
  vibeReferenceUrl: string | null;
};

type ImageWorkspaceProps = {
  value: ImageWorkspaceState;
  onChange: (state: ImageWorkspaceState) => void;
};

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "16:9", label: "16:9 寬螢幕" },
  { value: "9:16", label: "9:16 直式" },
  { value: "4:3", label: "4:3 傳統" },
  { value: "3:2", label: "3:2 相片" },
  { value: "21:9", label: "21:9 超寬" },
];

export function createDefaultImageState(): ImageWorkspaceState {
  return { aspectRatio: "16:9", negativePrompt: "", styleReferenceUrl: null, vibeReferenceUrl: null };
}

export function ImageWorkspace({ value, onChange }: ImageWorkspaceProps) {
  const update = (partial: Partial<ImageWorkspaceState>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-4">
      {/* Aspect Ratio */}
      <div className="space-y-2">
        <ZenTooltip tooltipKey="aspectRatio">
          <Label className="text-xs font-medium text-muted-foreground">畫面比例</Label>
        </ZenTooltip>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar.value}
              onClick={() => update({ aspectRatio: ar.value })}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all ${
                value.aspectRatio === ar.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-white/40 text-muted-foreground hover:bg-white/60"
              }`}
            >
              {ar.label}
            </button>
          ))}
        </div>
      </div>

      {/* Style & Vibe Reference */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">參考圖片</Label>
        <div className="grid grid-cols-2 gap-3">
          <VaultDropzone
            label="風格參考 (Style)"
            value={value.styleReferenceUrl}
            onDrop={(url) => update({ styleReferenceUrl: url })}
            onClear={() => update({ styleReferenceUrl: null })}
          />
          <VaultDropzone
            label="氛圍參考 (Vibe)"
            value={value.vibeReferenceUrl}
            onDrop={(url) => update({ vibeReferenceUrl: url })}
            onClear={() => update({ vibeReferenceUrl: null })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          從一致性保險庫拖放角色或場景，或上傳新圖片作為風格參考
        </p>
      </div>

      {/* Negative Prompt */}
      <div className="space-y-2">
        <ZenTooltip tooltipKey="negativePrompt">
          <Label className="text-xs font-medium text-muted-foreground">排除描述 (Negative Prompt)</Label>
        </ZenTooltip>
        <Textarea
          placeholder="描述你不想出現的元素（例：模糊、變形、低品質）"
          value={value.negativePrompt}
          onChange={(e) => update({ negativePrompt: e.target.value })}
          rows={2}
          className="rounded-xl bg-white/40 border-white/60 resize-none text-xs placeholder:text-muted-foreground/35"
        />
      </div>
    </div>
  );
}
