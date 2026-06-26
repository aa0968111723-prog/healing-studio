import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Zap, Brain, Dices, RotateCcw, X } from "lucide-react";
import { ZenTooltip } from "./ZenCoPilot";
import type { GenerationMode } from "@shared/types";
import { getModelFeature } from "@shared/falModelCapabilities";

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
  seedOnly?: boolean;
  /** 當前選用的 fal 模型 ID，用來判斷是否支援 seed。未提供時假設支援。 */
  selectedModelId?: string;
  /** 上一次生成回傳的 seed，提供「沿用上次」按鈕。 */
  lastSeed?: string;
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
  seedOnly = false,
  selectedModelId,
  lastSeed,
}: GenerationControlsProps) {
  // 未指定模型 → 預設假設支援（避免在還沒選到模型時就 disable）
  const seedSupported = selectedModelId
    ? getModelFeature(selectedModelId, "seed")
    : true;
  const showReuseLast = !!lastSeed && lastSeed !== seed && seedSupported;

  return (
    <div className="space-y-5">
      {/* Fast-First Toggle */}
      {!seedOnly && (
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
              onCheckedChange={checked =>
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
      )}

      {!seedOnly && <div className="h-px bg-border/50" />}

      {/* Temperature Slider */}
      {!seedOnly && (
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
      )}

      {/* LoRA Weight Slider */}
      {!seedOnly && showLoraWeight && onLoraWeightChange && (
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

      {!seedOnly && <div className="h-px bg-border/50" />}

      {/* Seed Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <ZenTooltip tooltipKey="seed">
            <Label className="text-sm font-medium">種子碼</Label>
          </ZenTooltip>
          {!seedSupported && (
            <span className="text-[10px] text-amber-600/80">
              此模型不支援，填了也會忽略
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Input
            type="text"
            inputMode="numeric"
            placeholder={
              seedSupported ? "留空則隨機生成" : "此模型 API 不支援種子碼"
            }
            value={seed}
            disabled={!seedSupported}
            onChange={e => {
              // 只接受整數（含負號），其他字元自動忽略，避免後端 parseInt 收到 NaN
              const v = e.target.value;
              if (v === "" || /^-?\d*$/.test(v)) onSeedChange(v);
            }}
            className="rounded-xl bg-muted/30 border-border/50 text-sm flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            disabled={!seedSupported}
            aria-label="隨機產生一組種子碼"
            onClick={() => {
              const next = Math.floor(Math.random() * 2_147_483_647);
              onSeedChange(String(next));
            }}
            className="px-2 h-9 rounded-md border border-border/50 bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Dices className="w-3.5 h-3.5" aria-hidden />
          </button>
          {showReuseLast && (
            <button
              type="button"
              aria-label={`沿用上次種子碼：${lastSeed}`}
              onClick={() => onSeedChange(lastSeed!)}
              className="px-2 h-9 rounded-md border border-border/50 bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
          {seed && seedSupported && (
            <button
              type="button"
              aria-label="清空種子碼（恢復隨機）"
              onClick={() => onSeedChange("")}
              className="px-2 h-9 rounded-md border border-border/50 bg-background hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
          {seedSupported
            ? "固定此數字，搭配相同提示詞可重現一樣的結果"
            : "此模型每次都會隨機生成（底層 API 不接受 seed 參數）"}
        </p>
      </div>
    </div>
  );
}
