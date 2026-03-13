import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sparkles, Lightbulb } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { VIBE_CARDS } from "@shared/types";
import { cn } from "@/lib/utils";

// ─── Vibe Card Icons (inline SVG for professional look) ─────────────────────

const vibeIcons: Record<string, React.ReactNode> = {
  serene: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M3 15c2.483 0 4.345-3 6-3s3.517 3 6 3 4.345-3 6-3" /><path d="M3 9c2.483 0 4.345-3 6-3s3.517 3 6 3 4.345-3 6-3" /></svg>,
  warm: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>,
  dreamy: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
  nature: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 17 3.5s1.5 2 2.8 5.5A7 7 0 0 1 11 20z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 12 13" /></svg>,
  vintage: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><circle cx="18" cy="8" r="1" /></svg>,
  minimal: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>,
  joyful: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>,
  mystical: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
};

// ─── Advanced Prompt Fields ─────────────────────────────────────────────────

type AdvancedFields = {
  subject: string;
  action: string;
  environment: string;
  lighting: string;
  cameraAngle: string;
};

const ADVANCED_FIELD_CONFIG = [
  { key: "subject" as const, label: "主體", placeholder: "描述主要角色或物件（例：一位穿著白色洋裝的女性）", icon: "👤" },
  { key: "action" as const, label: "動作", placeholder: "角色正在做什麼（例：在花園中漫步）", icon: "🎬" },
  { key: "environment" as const, label: "環境", placeholder: "場景與背景（例：日落時分的薰衣草田）", icon: "🌍" },
  { key: "lighting" as const, label: "光線", placeholder: "光線風格（例：golden hour 暖色調側光）", icon: "💡" },
  { key: "cameraAngle" as const, label: "鏡頭角度", placeholder: "拍攝角度（例：低角度仰拍、特寫）", icon: "📐" },
];

// ─── Types ──────────────────────────────────────────────────────────────────

export type PromptBuilderOutput = {
  rawPrompt: string;
  vibeCardIds: string[];
  advancedFields: AdvancedFields;
  compiledPrompt: string;
};

type ProgressivePromptBuilderProps = {
  value: PromptBuilderOutput;
  onChange: (output: PromptBuilderOutput) => void;
  modality?: string;
};

// ─── Compile prompt from all fields ─────────────────────────────────────────

function compilePrompt(raw: string, vibes: string[], fields: AdvancedFields): string {
  const parts: string[] = [];

  // Advanced fields first (structured)
  if (fields.subject) parts.push(fields.subject);
  if (fields.action) parts.push(fields.action);
  if (fields.environment) parts.push(`in ${fields.environment}`);
  if (fields.lighting) parts.push(`with ${fields.lighting} lighting`);
  if (fields.cameraAngle) parts.push(`shot from ${fields.cameraAngle}`);

  // Raw prompt
  if (raw) parts.push(raw);

  // Vibe descriptions
  if (vibes.length > 0) {
    const vibeLabels = vibes.map(id => VIBE_CARDS.find(v => v.id === id)?.label).filter(Boolean);
    if (vibeLabels.length > 0) {
      parts.push(`Style: ${vibeLabels.join(", ")}`);
    }
  }

  return parts.join(". ").trim() || raw;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProgressivePromptBuilder({ value, onChange, modality }: ProgressivePromptBuilderProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updateField = useCallback((key: keyof PromptBuilderOutput, val: unknown) => {
    const next = { ...value, [key]: val };
    // Recompile
    const compiled = compilePrompt(
      key === "rawPrompt" ? (val as string) : next.rawPrompt,
      key === "vibeCardIds" ? (val as string[]) : next.vibeCardIds,
      key === "advancedFields" ? (val as AdvancedFields) : next.advancedFields,
    );
    onChange({ ...next, compiledPrompt: compiled });
  }, [value, onChange]);

  const toggleVibe = useCallback((id: string) => {
    const next = value.vibeCardIds.includes(id)
      ? value.vibeCardIds.filter(v => v !== id)
      : [...value.vibeCardIds, id];
    updateField("vibeCardIds", next);
  }, [value.vibeCardIds, updateField]);

  const updateAdvanced = useCallback((key: keyof AdvancedFields, val: string) => {
    const next = { ...value.advancedFields, [key]: val };
    updateField("advancedFields", next);
  }, [value.advancedFields, updateField]);

  const hasAdvancedContent = useMemo(() =>
    Object.values(value.advancedFields).some(v => v.trim()),
    [value.advancedFields]
  );

  return (
    <div className="space-y-4">
      {/* Main Prompt Textarea */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium text-foreground">創作描述</Label>
          {value.compiledPrompt && value.compiledPrompt !== value.rawPrompt && (
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              已自動編譯進階提示詞
            </span>
          )}
        </div>
        <Textarea
          placeholder={
            modality === "audio"
              ? "描述你想要的音樂風格與情感..."
              : modality === "voice"
              ? "輸入要轉換為語音的文字..."
              : "描述你想要創作的畫面..."
          }
          value={value.rawPrompt}
          onChange={(e) => updateField("rawPrompt", e.target.value)}
          rows={3}
          className="rounded-xl bg-white/40 border-white/60 resize-none text-sm placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/30"
        />
      </div>

      {/* Visual Vibe Cards (Top Level) */}
      <div className="space-y-2.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">氛圍風格</Label>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {VIBE_CARDS.map((card) => {
            const isSelected = value.vibeCardIds.includes(card.id);
            return (
              <motion.button
                key={card.id}
                whileTap={{ scale: 0.93 }}
                onClick={() => toggleVibe(card.id)}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-all",
                  "hover:shadow-md active:scale-95",
                  isSelected
                    ? "ring-2 ring-primary/40 shadow-md"
                    : "hover:ring-1 hover:ring-border/50"
                )}
                style={{
                  background: isSelected
                    ? `linear-gradient(135deg, ${card.color}50, ${card.color}30)`
                    : `${card.color}20`,
                }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground"
                  style={{ backgroundColor: `${card.color}40` }}
                >
                  {vibeIcons[card.id] || <Sparkles className="w-4 h-4" />}
                </div>
                <span className="text-[10px] font-medium text-foreground leading-tight">{card.labelZh}</span>
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
                  >
                    <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Advanced Accordion (Progressive Disclosure) */}
      <div className="rounded-xl overflow-hidden" style={{
        background: "rgba(255,255,255,0.35)",
        border: "1px solid rgba(255,255,255,0.5)",
      }}>
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">進階提示詞建構器</span>
            {hasAdvancedContent && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">已填寫</span>
            )}
          </div>
          <motion.div
            animate={{ rotate: advancedOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  填寫以下欄位，系統會自動將它們編譯成專業級提示詞。留空的欄位會被忽略。
                </p>
                {ADVANCED_FIELD_CONFIG.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <span className="text-sm">{field.icon}</span>
                      {field.label}
                    </Label>
                    <Input
                      placeholder={field.placeholder}
                      value={value.advancedFields[field.key]}
                      onChange={(e) => updateAdvanced(field.key, e.target.value)}
                      className="rounded-lg bg-white/50 border-white/60 text-sm h-9 placeholder:text-muted-foreground/35 focus-visible:ring-1 focus-visible:ring-primary/30"
                    />
                  </div>
                ))}

                {/* Preview compiled prompt */}
                {value.compiledPrompt && (
                  <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">
                      編譯後提示詞預覽
                    </p>
                    <p className="text-xs text-foreground leading-relaxed">{value.compiledPrompt}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Default empty state ────────────────────────────────────────────────────

export function createEmptyPromptOutput(): PromptBuilderOutput {
  return {
    rawPrompt: "",
    vibeCardIds: [],
    advancedFields: { subject: "", action: "", environment: "", lighting: "", cameraAngle: "" },
    compiledPrompt: "",
  };
}
