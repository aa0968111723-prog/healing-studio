import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VaultDropzone } from "@/components/ConsistencyVault";
import { ZenTooltip } from "@/components/ZenCoPilot";
import { Plus } from "lucide-react";

export type ImageWorkspaceState = {
  aspectRatio: string;
  negativePrompt: string;
  styleReferenceUrl: string | null;
  vibeReferenceUrl: string | null;
};

type ImageWorkspaceProps = {
  value: ImageWorkspaceState;
  onChange: (state: ImageWorkspaceState) => void;
  compactMode?: boolean;
};

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 正方形" },
  { value: "16:9", label: "16:9 寬螢幕" },
  { value: "9:16", label: "9:16 直式" },
  { value: "4:3", label: "4:3 傳統" },
  { value: "3:2", label: "3:2 相片" },
  { value: "21:9", label: "21:9 超寬" },
];

// ─── Quick chips for Negative Prompt ──────────────────────────────────────
const NEGATIVE_CHIPS = [
  "模糊",
  "低品質",
  "變形",
  "多餘肢體",
  "噪點",
  "過曝",
  "水印",
  "文字",
  "低解析度",
  "扭曲臉部",
];

// ─── Style description quick presets ──────────────────────────────────────
const STYLE_PRESETS = [
  { label: "🖼️ 油畫", value: "oil painting style, impasto brushwork" },
  { label: "📷 寫實", value: "photorealistic, 8K, cinematic lighting" },
  { label: "✏️ 手繪", value: "hand-drawn illustration, pencil sketch" },
  { label: "🎨 水彩", value: "watercolor painting, soft edges" },
  { label: "🌸 動漫", value: "anime style, vibrant colors, clean lines" },
  {
    label: "🏙️ 賽博龐克",
    value: "cyberpunk aesthetic, neon lights, futuristic",
  },
  { label: "🌿 吉卜力", value: "Studio Ghibli inspired, soft lighting, lush" },
  { label: "🖤 暗黑", value: "dark fantasy, moody, dramatic shadows" },
];

export function createDefaultImageState(): ImageWorkspaceState {
  return {
    aspectRatio: "16:9",
    negativePrompt: "",
    styleReferenceUrl: null,
    vibeReferenceUrl: null,
  };
}

export function ImageWorkspace({ value, onChange, compactMode = false }: ImageWorkspaceProps) {
  const update = (partial: Partial<ImageWorkspaceState>) =>
    onChange({ ...value, ...partial });

  // Append a negative chip (avoid duplicates)
  const appendNegativeChip = (chip: string) => {
    const current = value.negativePrompt.trim();
    if (current.includes(chip)) return; // already present
    update({ negativePrompt: current ? `${current}, ${chip}` : chip });
  };

  return (
    <div className="space-y-4">
      {/* Aspect Ratio */}
      <div className="space-y-2">
        <ZenTooltip tooltipKey="aspectRatio">
          <Label className="text-xs font-medium text-muted-foreground">
            畫面比例
          </Label>
        </ZenTooltip>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {ASPECT_RATIOS.map(ar => (
            <button
              key={ar.value}
              onClick={() => update({ aspectRatio: ar.value })}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all ${
                value.aspectRatio === ar.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card/40 text-muted-foreground hover:bg-card/60"
              }`}
            >
              {ar.label}
            </button>
          ))}
        </div>
      </div>

      {/* Style & Vibe Reference */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">
          參考圖片
        </Label>
        <div className="grid grid-cols-2 gap-3">
          <VaultDropzone
            label="風格參考 (Style)"
            value={value.styleReferenceUrl}
            onDrop={url => update({ styleReferenceUrl: url })}
            onClear={() => update({ styleReferenceUrl: null })}
          />
          <VaultDropzone
            label="氛圍參考 (Vibe)"
            value={value.vibeReferenceUrl}
            onDrop={url => update({ vibeReferenceUrl: url })}
            onClear={() => update({ vibeReferenceUrl: null })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          從一致性保險庫拖放角色或場景，上傳檔案，或貼上圖片 URL 作為風格參考
        </p>
      </div>

      {/* Style Description Quick Presets */}
      {!compactMode && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            風格描述快選
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {STYLE_PRESETS.map(preset => (
              <button
                key={preset.value}
                onClick={e => {
                  // Dispatch a custom event so Studio/parent can inject this into the prompt
                  const event = new CustomEvent("apply-style-preset", {
                    detail: preset.value,
                    bubbles: true,
                  });
                  (e.currentTarget as HTMLElement).dispatchEvent(event);
                }}
                title={preset.value}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-card/40 text-muted-foreground hover:bg-primary/10 hover:text-primary border border-white/60 hover:border-primary/30 transition-all"
                data-style-preset={preset.value}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            點擊快選風格標籤，自動附加到提示詞結尾
          </p>
        </div>
      )}

      {/* Negative Prompt */}
      {!compactMode && (
        <div className="space-y-2">
          <ZenTooltip tooltipKey="negativePrompt">
            <Label className="text-xs font-medium text-muted-foreground">
              排除描述 (Negative Prompt)
            </Label>
          </ZenTooltip>
          {/* Quick chips */}
          <div className="flex flex-wrap gap-1">
            {NEGATIVE_CHIPS.map(chip => {
              const active = value.negativePrompt.includes(chip);
              return (
                <button
                  key={chip}
                  onClick={() => appendNegativeChip(chip)}
                  disabled={active}
                  className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border ${
                    active
                      ? "bg-destructive/10 text-destructive border-destructive/30 cursor-default"
                      : "bg-card/40 text-muted-foreground border-white/60 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                  }`}
                >
                  {!active && <Plus className="w-2.5 h-2.5" />}
                  {chip}
                </button>
              );
            })}
          </div>
          <Textarea
            placeholder="描述你不想出現的元素（例：模糊、變形、低品質）"
            value={value.negativePrompt}
            onChange={e => update({ negativePrompt: e.target.value })}
            rows={2}
            className="rounded-xl bg-card/40 border-white/60 resize-none text-xs placeholder:text-muted-foreground/35"
          />
        </div>
      )}
    </div>
  );
}
