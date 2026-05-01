/**
 * Three reusable cards used by the Config tab:
 *  - BrainSlotCard:   one of 5 reasoning brains (model + temp + topP + system prompt)
 *  - EngineSlotCard:  one of 4 generation engines (engine + JSON params)
 *  - FalTaskCard:     one of 16 Fal task engines (collapsible per-task selector)
 */
import { useState, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  type SlotCatalog,
  type HealthStatus,
  type FalTaskKey,
} from "../_shared";
import { HealthDot, TierBadge, ProviderBadge } from "./Badges";

type TextareaChangeEvent = ChangeEvent<HTMLTextAreaElement>;

function withTextareaValue(handler?: (value: string) => void) {
  return (e: TextareaChangeEvent) => {
    handler?.(e.target.value);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BrainSlotCard
// ═══════════════════════════════════════════════════════════════════════════

export function BrainSlotCard({
  catalog,
  icon: Icon,
  currentModel,
  temperature,
  topP,
  enabled,
  health,
  systemPrompt,
  onModelChange,
  onTemperatureChange,
  onTopPChange,
  onEnabledChange,
  onSystemPromptChange,
  onNavigateTarget,
}: {
  catalog: SlotCatalog;
  icon: React.ComponentType<{ className?: string }>;
  currentModel: string;
  temperature: number;
  topP: number;
  enabled: boolean;
  health: HealthStatus | undefined;
  systemPrompt?: string;
  onModelChange: (model: string) => void;
  onTemperatureChange: (temp: number) => void;
  onTopPChange: (topP: number) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSystemPromptChange?: (prompt: string) => void;
  onNavigateTarget?: (path: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 transition-all ${
        enabled
          ? "bg-white/50 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm"
          : "bg-muted/30 border-muted/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {catalog.label}
              </h3>
              <HealthDot model={currentModel} health={health} />
            </div>
            <p className="hs-small !mb-0 text-muted-foreground">
              {catalog.description}
            </p>
            {catalog.targetPath && onNavigateTarget && (
              <button
                type="button"
                onClick={() => onNavigateTarget(catalog.targetPath!)}
                className="mt-1 text-[10px] text-primary/80 hover:text-primary inline-flex items-center gap-1"
              >
                前往頁面
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              模型選擇
            </Label>
            <Select value={currentModel} onValueChange={onModelChange}>
              <SelectTrigger className="h-9 text-xs bg-white/40 dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <HealthDot model={opt.value} health={health} />
                      <span>{opt.label}</span>
                      <ProviderBadge value={opt.value} />
                      <TierBadge tier={opt.tier} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">
                溫度 (Temperature)
              </Label>
              <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
                {temperature.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[temperature]}
              onValueChange={(vals: number[]) => onTemperatureChange(vals[0])}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">精確</span>
              <span className="text-[9px] text-muted-foreground/50">創意</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">Top P</Label>
              <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
                {topP.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[topP]}
              onValueChange={(vals: number[]) => onTopPChange(vals[0])}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">集中</span>
              <span className="text-[9px] text-muted-foreground/50">多樣</span>
            </div>
          </div>

          {onSystemPromptChange && (
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                系統提示詞(選填)
              </Label>
              <Textarea
                value={systemPrompt || ""}
                onChange={withTextareaValue(onSystemPromptChange)}
                placeholder="為此推理大腦設定自訂的系統提示詞,留空則使用預設值"
                className="min-h-[80px] text-xs bg-white/40 dark:bg-white/5 resize-none"
              />
              <p className="text-[9px] text-muted-foreground/70 mt-1">
                自訂系統提示詞可影響大腦的行為風格與輸出品質
              </p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EngineSlotCard
// ═══════════════════════════════════════════════════════════════════════════

export function EngineSlotCard({
  catalog,
  icon: Icon,
  currentEngine,
  enabled,
  health,
  engineParams,
  onEngineChange,
  onEnabledChange,
  onEngineParamsChange,
  onNavigateTarget,
}: {
  catalog: SlotCatalog;
  icon: React.ComponentType<{ className?: string }>;
  currentEngine: string;
  enabled: boolean;
  health: HealthStatus | undefined;
  engineParams?: string;
  onEngineChange: (engine: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onEngineParamsChange?: (params: string) => void;
  onNavigateTarget?: (path: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 transition-all ${
        enabled
          ? "bg-white/50 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm"
          : "bg-muted/30 border-muted/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {catalog.label}
              </h3>
              <HealthDot model={currentEngine} health={health} />
            </div>
            <p className="hs-small !mb-0 text-muted-foreground">
              {catalog.description}
            </p>
            {catalog.targetPath && onNavigateTarget && (
              <button
                type="button"
                onClick={() => onNavigateTarget(catalog.targetPath!)}
                className="mt-1 text-[10px] text-primary/80 hover:text-primary inline-flex items-center gap-1"
              >
                前往頁面
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              引擎選擇
            </Label>
            <Select value={currentEngine} onValueChange={onEngineChange}>
              <SelectTrigger className="h-9 text-xs bg-white/40 dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <HealthDot model={opt.value} health={health} />
                      <span>{opt.label}</span>
                      <ProviderBadge value={opt.value} />
                      <TierBadge tier={opt.tier} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {onEngineParamsChange && (
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                引擎參數(JSON,選填)
              </Label>
              <Textarea
                value={engineParams || ""}
                onChange={withTextareaValue(onEngineParamsChange)}
                placeholder={'例如:{"num_images": 4, "guidance_scale": 7.5}'}
                className="min-h-[80px] text-xs bg-white/40 dark:bg-white/5 resize-none font-mono"
              />
              <p className="text-[9px] text-muted-foreground/70 mt-1">
                以 JSON 格式設定引擎專屬參數,留空則使用預設值
              </p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FalTaskCard
// ═══════════════════════════════════════════════════════════════════════════

export function FalTaskCard({
  taskKey: _taskKey,
  icon: Icon,
  catalog,
  currentModel,
  health,
  onModelChange,
}: {
  taskKey: FalTaskKey;
  /** Icon for this Fal task category — supplied by the parent so this file
      doesn't need to know about all 16 lucide icons. */
  icon: React.ComponentType<{ className?: string }>;
  catalog: SlotCatalog;
  currentModel: string;
  health: HealthStatus | undefined;
  onModelChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOpt = catalog.options.find(o => o.value === currentModel);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-white/40 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/20 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-600">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {catalog.label}
              </span>
              <HealthDot model={currentModel} health={health} />
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-32 block">
              {selectedOpt?.label ?? currentModel.split("/").pop()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedOpt && <TierBadge tier={selectedOpt.tier} />}
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/20 dark:border-white/10"
          >
            <div className="p-3 space-y-2">
              <p className="hs-small !mb-0 text-muted-foreground">
                {catalog.description}
              </p>
              <Select value={currentModel} onValueChange={onModelChange}>
                <SelectTrigger className="h-8 text-xs bg-white/40 dark:bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.options.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <HealthDot model={opt.value} health={health} />
                        <span className="flex-1">{opt.label}</span>
                        <TierBadge tier={opt.tier} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedOpt?.description && (
                <p className="hs-small !mb-0 text-muted-foreground/70">
                  {selectedOpt.description}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
