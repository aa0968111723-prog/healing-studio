import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Zap, Brain } from "lucide-react";
import { ZenTooltip } from "./ZenCoPilot";
import type { GenerationMode } from "@shared/types";

type GenerationControlsProps = {
  temperature: number;
  onTemperatureChange: (val: number) => void;
  seed: string;
  onSeedChange: (val: string) => void;
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
  loraWeight?: number;
  onLoraWeightChange?: (val: number) => void;
  showLoraWeight?: boolean;
};

export function GenerationControls({
  temperature,
  onTemperatureChange,
  seed,
  onSeedChange,
  mode,
  onModeChange,
  loraWeight = 0.7,
  onLoraWeightChange,
  showLoraWeight = false,
}: GenerationControlsProps) {
  return (
    <div className="space-y-5">
      {/* Fast-First Toggle */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <ZenTooltip tooltipKey="mode">
            <div className="flex items-center gap-2">
              {mode === "lightning" ? (
                <Zap className="w-4 h-4 text-amber-500" />
              ) : (
                <Brain className="w-4 h-4 text-muted-foreground" />
              )}
              <Label className="text-sm font-medium">
                {mode === "lightning" ? "閃電模式" : "深度精修模式"}
              </Label>
            </div>
          </ZenTooltip>
          <Switch
            checked={mode === "deep_precision"}
            onCheckedChange={(checked) =>
              onModeChange(checked ? "deep_precision" : "lightning")
            }
          />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {mode === "lightning"
            ? "Gemini Flash — 快速迭代，適合探索方向"
            : "Gemini Pro + CO-STAR — 高品質輸出，細節豐富"}
        </p>
      </div>

      <div className="h-px bg-border/50" />

      {/* Temperature Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <ZenTooltip tooltipKey="temperature">
            <Label className="text-sm font-medium">創意溫度</Label>
          </ZenTooltip>
          <span className="text-xs text-muted-foreground tabular-nums font-mono">
            {temperature.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[temperature]}
          onValueChange={([val]) => onTemperatureChange(val)}
          min={0}
          max={1}
          step={0.05}
          className="w-full"
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>精確穩定</span>
          <span>大膽創新</span>
        </div>
      </div>

      {/* LoRA Weight Slider */}
      {showLoraWeight && onLoraWeightChange && (
        <>
          <div className="h-px bg-border/50" />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <ZenTooltip tooltipKey="loraWeight">
                <Label className="text-sm font-medium">LoRA 權重</Label>
              </ZenTooltip>
              <span className="text-xs text-muted-foreground tabular-nums font-mono">
                {loraWeight.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[loraWeight]}
              onValueChange={([val]) => onLoraWeightChange(val)}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>自然融合</span>
              <span>完全套用</span>
            </div>
          </div>
        </>
      )}

      <div className="h-px bg-border/50" />

      {/* Seed Input */}
      <div className="space-y-2">
        <ZenTooltip tooltipKey="seed">
          <Label className="text-sm font-medium">種子碼</Label>
        </ZenTooltip>
        <Input
          type="text"
          placeholder="留空則隨機生成"
          value={seed}
          onChange={(e) => onSeedChange(e.target.value)}
          className="rounded-xl bg-muted/30 border-border/50 text-sm"
        />
      </div>
    </div>
  );
}
