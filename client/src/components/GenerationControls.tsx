import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Zap, Brain } from "lucide-react";
import type { GenerationMode } from "@shared/types";

type GenerationControlsProps = {
  temperature: number;
  onTemperatureChange: (val: number) => void;
  seed: string;
  onSeedChange: (val: string) => void;
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
};

export function GenerationControls({
  temperature,
  onTemperatureChange,
  seed,
  onSeedChange,
  mode,
  onModeChange,
}: GenerationControlsProps) {
  return (
    <div className="space-y-5">
      {/* Fast-First Toggle */}
      <div className="healing-card bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === "lightning" ? (
              <Zap className="w-4 h-4 text-amber-500" />
            ) : (
              <Brain className="w-4 h-4 text-primary" />
            )}
            <Label className="text-sm font-medium">
              {mode === "lightning" ? "閃電模式" : "深度精準模式"}
            </Label>
          </div>
          <Switch
            checked={mode === "deep_precision"}
            onCheckedChange={(checked) =>
              onModeChange(checked ? "deep_precision" : "lightning")
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {mode === "lightning"
            ? "使用 Gemini Flash，速度快、適合快速迭代"
            : "使用 Gemini Pro + CO-STAR 框架，品質更高、細節更豐富"}
        </p>
      </div>

      {/* Temperature Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">AI 的冒險度</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
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
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>保守精確</span>
          <span>大膽創新</span>
        </div>
      </div>

      {/* Seed Input */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">平行宇宙存檔密碼</Label>
        <Input
          type="text"
          placeholder="輸入種子碼（選填）"
          value={seed}
          onChange={(e) => onSeedChange(e.target.value)}
          className="rounded-[25px] bg-muted/50"
        />
        <p className="text-xs text-muted-foreground">
          相同的種子碼會產生相似的結果，留空則隨機生成
        </p>
      </div>
    </div>
  );
}
