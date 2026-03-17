import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Sparkles, Lightbulb, Blocks, Focus, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { VIBE_CARDS } from "@shared/types";
import { cn } from "@/lib/utils";

// ─── Vibe Card Icons ───────────────────────────────────────────────────────

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

// ─── Visual Blocks Data ────────────────────────────────────────────────────

type BlockCategory = {
  id: string;
  label: string;
  icon: string;
  color: string;        // tailwind ring/bg color
  glowRgb: string;      // for glow effects
  items: { id: string; label: string; prompt: string }[];
};

// ─── Visual blocks for image/video modalities ─────────────────────────────
// NOTE: "mood" category removed because Vibe Cards already cover atmosphere

const VISUAL_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "subject", label: "主體", icon: "👤", color: "rose", glowRgb: "255,100,130",
    items: [
      { id: "s1", label: "少女", prompt: "a young girl" },
      { id: "s2", label: "武士", prompt: "a samurai warrior" },
      { id: "s3", label: "貓咪", prompt: "a cat" },
      { id: "s4", label: "機器人", prompt: "a robot" },
      { id: "s5", label: "龍", prompt: "a dragon" },
      { id: "s6", label: "精靈", prompt: "an elf" },
      { id: "s7", label: "老人", prompt: "an elderly sage" },
      { id: "s8", label: "花朵", prompt: "flowers" },
    ],
  },
  {
    id: "style", label: "風格", icon: "🎨", color: "violet", glowRgb: "160,100,255",
    items: [
      { id: "st1", label: "賽博龐克", prompt: "cyberpunk style" },
      { id: "st2", label: "水彩畫", prompt: "watercolor painting" },
      { id: "st3", label: "油畫", prompt: "oil painting" },
      { id: "st4", label: "浮世繪", prompt: "ukiyo-e style" },
      { id: "st5", label: "像素藝術", prompt: "pixel art" },
      { id: "st6", label: "超現實", prompt: "surrealism" },
      { id: "st7", label: "極簡主義", prompt: "minimalist" },
      { id: "st8", label: "蒸汽龐克", prompt: "steampunk" },
    ],
  },
  {
    id: "scene", label: "場景", icon: "🏔️", color: "emerald", glowRgb: "80,220,150",
    items: [
      { id: "sc1", label: "森林", prompt: "in a dense forest" },
      { id: "sc2", label: "城市", prompt: "in a futuristic city" },
      { id: "sc3", label: "海洋", prompt: "by the ocean" },
      { id: "sc4", label: "太空", prompt: "in outer space" },
      { id: "sc5", label: "廢墟", prompt: "in ancient ruins" },
      { id: "sc6", label: "花園", prompt: "in a beautiful garden" },
      { id: "sc7", label: "雪山", prompt: "on a snowy mountain" },
      { id: "sc8", label: "沙漠", prompt: "in a vast desert" },
    ],
  },
  {
    id: "lighting", label: "光線", icon: "💡", color: "sky", glowRgb: "80,200,255",
    items: [
      { id: "l1", label: "黃金時刻", prompt: "golden hour lighting" },
      { id: "l2", label: "霓虹燈", prompt: "neon lighting" },
      { id: "l3", label: "月光", prompt: "moonlight" },
      { id: "l4", label: "逆光", prompt: "backlit, rim lighting" },
      { id: "l5", label: "柔光", prompt: "soft diffused light" },
      { id: "l6", label: "戲劇光", prompt: "dramatic chiaroscuro" },
      { id: "l7", label: "燭光", prompt: "candlelight" },
      { id: "l8", label: "極光", prompt: "aurora borealis light" },
    ],
  },
  {
    id: "camera", label: "鏡頭", icon: "📐", color: "orange", glowRgb: "255,140,50",
    items: [
      { id: "c1", label: "特寫", prompt: "close-up shot" },
      { id: "c2", label: "全景", prompt: "wide angle panoramic" },
      { id: "c3", label: "俯瞰", prompt: "bird's eye view" },
      { id: "c4", label: "仰拍", prompt: "low angle shot" },
      { id: "c5", label: "微距", prompt: "macro photography" },
      { id: "c6", label: "淺景深", prompt: "shallow depth of field, bokeh" },
      { id: "c7", label: "魚眼", prompt: "fisheye lens" },
      { id: "c8", label: "長焦", prompt: "telephoto lens compression" },
    ],
  },
];

// ─── Audio-specific blocks for music modality ─────────────────────────────

const AUDIO_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "instrument", label: "樂器", icon: "🎹", color: "violet", glowRgb: "160,100,255",
    items: [
      { id: "ai1", label: "鋼琴", prompt: "piano" },
      { id: "ai2", label: "吉他", prompt: "acoustic guitar" },
      { id: "ai3", label: "合成器", prompt: "synthesizer" },
      { id: "ai4", label: "管弦樂", prompt: "orchestral ensemble" },
      { id: "ai5", label: "小提琴", prompt: "violin" },
      { id: "ai6", label: "長笛", prompt: "flute" },
      { id: "ai7", label: "鼓組", prompt: "drums and percussion" },
      { id: "ai8", label: "豎琴", prompt: "harp" },
    ],
  },
  {
    id: "genre", label: "曲風", icon: "🎵", color: "rose", glowRgb: "255,100,130",
    items: [
      { id: "ag1", label: "環境音", prompt: "ambient music" },
      { id: "ag2", label: "Lo-Fi", prompt: "lo-fi chill beats" },
      { id: "ag3", label: "流行", prompt: "pop music" },
      { id: "ag4", label: "爵士", prompt: "jazz" },
      { id: "ag5", label: "古典", prompt: "classical music" },
      { id: "ag6", label: "電子", prompt: "electronic music" },
      { id: "ag7", label: "民謠", prompt: "folk music" },
      { id: "ag8", label: "R&B", prompt: "R&B soul" },
    ],
  },
  {
    id: "tempo", label: "節奏", icon: "⏱️", color: "amber", glowRgb: "255,180,50",
    items: [
      { id: "at1", label: "慢板", prompt: "slow tempo, adagio" },
      { id: "at2", label: "中等", prompt: "moderate tempo" },
      { id: "at3", label: "快節奏", prompt: "fast tempo, upbeat" },
      { id: "at4", label: "漸快", prompt: "gradually accelerating tempo" },
      { id: "at5", label: "自由節奏", prompt: "free tempo, rubato" },
      { id: "at6", label: "搖擺", prompt: "swing rhythm" },
    ],
  },
  {
    id: "ambiance", label: "環境質感", icon: "🌊", color: "sky", glowRgb: "80,200,255",
    items: [
      { id: "aa1", label: "空間感", prompt: "spacious reverb, wide soundstage" },
      { id: "aa2", label: "溫暖", prompt: "warm analog tone" },
      { id: "aa3", label: "復古雜音", prompt: "vintage vinyl crackle, lo-fi noise" },
      { id: "aa4", label: "空靈", prompt: "ethereal, dreamy atmosphere" },
      { id: "aa5", label: "深沉", prompt: "deep bass, sub-bass" },
      { id: "aa6", label: "清透", prompt: "crystal clear, bright mix" },
    ],
  },
];

// ─── Helper: get blocks by modality ───────────────────────────────────────

function getBlocksForModality(modality?: string): BlockCategory[] {
  if (modality === "audio") return AUDIO_BLOCK_CATEGORIES;
  // image & video share visual blocks (mood removed to avoid overlap with Vibe Cards)
  return VISUAL_BLOCK_CATEGORIES;
}

// ─── Token Weight Types ────────────────────────────────────────────────────

export type TokenWeight = {
  id: string;
  text: string;
  weight: number;
  category?: string; // from which block category
};

// ─── Token Parser ──────────────────────────────────────────────────────────

function parseTokens(text: string): TokenWeight[] {
  if (!text.trim()) return [];

  // Match existing weighted tokens like (word: 1.5) and regular words
  const weightedPattern = /\(([^:]+):\s*([\d.]+)\)/g;
  const existingWeights: Record<string, number> = {};
  let match;
  while ((match = weightedPattern.exec(text)) !== null) {
    existingWeights[match[1].trim()] = parseFloat(match[2]);
  }

  // Remove weighted syntax for clean parsing
  const cleanText = text.replace(/\(([^:]+):\s*[\d.]+\)/g, "$1");

  // Split into meaningful tokens (nouns, adjectives, phrases)
  const tokenPattern = /[\u4e00-\u9fff\u3400-\u4dbf]+|[a-zA-Z]+(?:\s+[a-zA-Z]+){0,2}/g;
  const rawTokens = cleanText.match(tokenPattern) || [];

  // Deduplicate and create token objects
  const seen = new Set<string>();
  return rawTokens
    .filter(t => t.trim().length > 1) // skip single chars
    .filter(t => {
      const key = t.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t, i) => ({
      id: `token-${i}`,
      text: t.trim(),
      weight: existingWeights[t.trim()] || 1.0,
    }));
}

function compileWithWeights(tokens: TokenWeight[], vibes: string[], rawPrompt: string): string {
  if (tokens.length === 0) return rawPrompt;

  const weightedParts = tokens.map(t => {
    if (Math.abs(t.weight - 1.0) < 0.05) return t.text;
    return `(${t.text}: ${t.weight.toFixed(1)})`;
  });

  const vibeLabels = vibes
    .map(id => VIBE_CARDS.find(v => v.id === id)?.label)
    .filter(Boolean);

  const parts = [...weightedParts];
  if (vibeLabels.length > 0) {
    parts.push(`Style: ${vibeLabels.join(", ")}`);
  }

  return parts.join(", ").trim();
}

// ─── Advanced Prompt Fields ────────────────────────────────────────────────

type AdvancedFields = {
  subject: string;
  action: string;
  environment: string;
  lighting: string;
  cameraAngle: string;
};

const ADVANCED_FIELD_CONFIG = [
  { key: "subject" as const, label: "主體", placeholder: "描述主要角色或物件", icon: "👤" },
  { key: "action" as const, label: "動作", placeholder: "角色正在做什麼", icon: "🎬" },
  { key: "environment" as const, label: "環境", placeholder: "場景與背景", icon: "🌍" },
  { key: "lighting" as const, label: "光線", placeholder: "光線風格", icon: "💡" },
  { key: "cameraAngle" as const, label: "鏡頭角度", placeholder: "拍攝角度", icon: "📐" },
];

// ─── Types ─────────────────────────────────────────────────────────────────

export type PromptBuilderOutput = {
  rawPrompt: string;
  vibeCardIds: string[];
  advancedFields: AdvancedFields;
  compiledPrompt: string;
  tokenWeights?: TokenWeight[];
};

type ProgressivePromptBuilderProps = {
  value: PromptBuilderOutput;
  onChange: (output: PromptBuilderOutput) => void;
  modality?: string;
};

// ─── Self-Attention Token Chip ─────────────────────────────────────────────

function TokenChip({
  token,
  isSelected,
  onSelect,
  onWeightChange,
}: {
  token: TokenWeight;
  isSelected: boolean;
  onSelect: () => void;
  onWeightChange: (w: number) => void;
}) {
  const getTokenStyle = () => {
    if (token.weight > 1.2) {
      return {
        background: `rgba(255, 160, 50, ${0.15 + (token.weight - 1.0) * 0.15})`,
        border: `1.5px solid rgba(255, 160, 50, ${0.5 + (token.weight - 1.0) * 0.3})`,
        boxShadow: `0 0 ${8 + (token.weight - 1.0) * 12}px rgba(255, 160, 50, ${0.2 + (token.weight - 1.0) * 0.2})`,
        color: "rgb(255, 180, 80)",
      };
    }
    if (token.weight < 0.8) {
      return {
        background: "rgba(150, 150, 170, 0.08)",
        border: "1.5px solid rgba(150, 150, 170, 0.2)",
        boxShadow: "none",
        color: "rgba(150, 150, 170, 0.5)",
        opacity: 0.5 + token.weight * 0.5,
      };
    }
    return {
      background: "rgba(255, 255, 255, 0.08)",
      border: "1.5px solid rgba(255, 255, 255, 0.2)",
      boxShadow: "none",
      color: "inherit",
    };
  };

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onSelect}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer select-none",
          "backdrop-blur-sm",
          isSelected && "ring-2 ring-primary/60"
        )}
        style={getTokenStyle()}
      >
        <span>{token.text}</span>
        {Math.abs(token.weight - 1.0) >= 0.05 && (
          <span className="ml-1 text-[10px] opacity-70">{token.weight.toFixed(1)}</span>
        )}
      </motion.button>

      {/* Floating Weight Slider */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 w-56 p-3 rounded-xl shadow-xl"
            style={{
              background: "rgba(30, 30, 40, 0.92)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-white/80">注意力權重</span>
              <span className="text-[11px] font-mono text-amber-400">{token.weight.toFixed(2)}</span>
            </div>
            <Slider
              value={[token.weight]}
              min={0.5}
              max={2.0}
              step={0.05}
              onValueChange={([v]) => onWeightChange(v)}
              className="w-full"
            />
            <div className="flex justify-between mt-1.5 text-[9px] text-white/40">
              <span>淡化 0.5</span>
              <span>標準 1.0</span>
              <span>強調 2.0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Visual Block Chip ─────────────────────────────────────────────────────

function BlockChip({
  item,
  category,
  isSelected,
  onToggle,
}: {
  item: { id: string; label: string; prompt: string };
  category: BlockCategory;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.93 }}
      onClick={onToggle}
      className={cn(
        "px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
        "backdrop-blur-sm border",
        isSelected
          ? `ring-2 ring-${category.color}-400/50 border-${category.color}-400/40`
          : "border-white/10 hover:border-white/20"
      )}
      style={{
        background: isSelected
          ? `rgba(${category.glowRgb}, 0.15)`
          : "rgba(255, 255, 255, 0.04)",
        boxShadow: isSelected
          ? `0 0 12px rgba(${category.glowRgb}, 0.2)`
          : "none",
        color: isSelected ? `rgb(${category.glowRgb})` : "inherit",
      }}
    >
      {item.label}
      {isSelected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="ml-1 inline-block"
        >
          <X className="w-3 h-3 inline" />
        </motion.span>
      )}
    </motion.button>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function ProgressivePromptBuilder({ value, onChange, modality, onType }: ProgressivePromptBuilderProps & { onType?: (len: number) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(true);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<TokenWeight[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Get the correct block categories for the current modality
  const blockCategories = useMemo(() => getBlocksForModality(modality), [modality]);

  // Reset selected blocks when modality changes (blocks are different per modality)
  const prevModalityRef = useRef(modality);
  useEffect(() => {
    if (prevModalityRef.current !== modality) {
      setSelectedBlocks(new Set());
      prevModalityRef.current = modality;
    }
  }, [modality]);

  // Parse tokens when rawPrompt changes (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const newTokens = parseTokens(value.rawPrompt);
      // Preserve existing weights for tokens that still exist
      const merged = newTokens.map(nt => {
        const existing = tokens.find(et => et.text.toLowerCase() === nt.text.toLowerCase());
        return existing ? { ...nt, weight: existing.weight } : nt;
      });
      setTokens(merged);
      if (merged.length > 0 && !attentionOpen) {
        setAttentionOpen(true);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value.rawPrompt]);

  // Recompile when tokens change
  const recompile = useCallback((updatedTokens: TokenWeight[], vibes: string[]) => {
    const compiled = compileWithWeights(updatedTokens, vibes, value.rawPrompt);
    onChange({ ...value, compiledPrompt: compiled, tokenWeights: updatedTokens, vibeCardIds: vibes });
  }, [value, onChange]);

  const updateField = useCallback((key: keyof PromptBuilderOutput, val: unknown) => {
    const next = { ...value, [key]: val };
    if (key === "vibeCardIds") {
      recompile(tokens, val as string[]);
    } else if (key === "rawPrompt") {
      // Simple compile for raw prompt changes (tokens will update via effect)
      const vibeLabels = value.vibeCardIds.map(id => VIBE_CARDS.find(v => v.id === id)?.label).filter(Boolean);
      const parts = [val as string];
      if (vibeLabels.length > 0) parts.push(`Style: ${vibeLabels.join(", ")}`);
      onChange({ ...next, compiledPrompt: parts.join(". ").trim() });
    } else {
      onChange(next);
    }
  }, [value, onChange, tokens, recompile]);

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

  const handleTokenWeightChange = useCallback((tokenId: string, weight: number) => {
    const updated = tokens.map(t => t.id === tokenId ? { ...t, weight } : t);
    setTokens(updated);
    recompile(updated, value.vibeCardIds);
  }, [tokens, value.vibeCardIds, recompile]);

  const handleBlockToggle = useCallback((blockId: string, prompt: string) => {
    const next = new Set(selectedBlocks);
    if (next.has(blockId)) {
      next.delete(blockId);
      // Remove from rawPrompt
      const newRaw = value.rawPrompt.replace(prompt, "").replace(/,\s*,/g, ",").replace(/^,\s*|,\s*$/g, "").trim();
      updateField("rawPrompt", newRaw);
    } else {
      next.add(blockId);
      // Append to rawPrompt
      const separator = value.rawPrompt.trim() ? ", " : "";
      updateField("rawPrompt", value.rawPrompt.trim() + separator + prompt);
    }
    setSelectedBlocks(next);
  }, [selectedBlocks, value.rawPrompt, updateField]);

  const hasAdvancedContent = useMemo(() =>
    Object.values(value.advancedFields).some(v => v.trim()),
    [value.advancedFields]
  );

  // Close token slider when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-token-chip]") && !target.closest("[data-token-slider]")) {
        setSelectedTokenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Determine section label based on modality
  const blocksLabel = modality === "audio" ? "音樂靈感積木" : "靈感積木";
  const promptPlaceholder = modality === "audio"
    ? "描述你想要的音樂風格與情感...或從上方積木拼出靈感"
    : modality === "voice"
    ? "輸入要轉換為語音的文字..."
    : "描述你想要創作的畫面...或從上方積木拼出靈感";

  return (
    <div className="space-y-4">
      {/* ═══ Section 1: Visual / Audio Blocks (Onboarding) ═══ */}
      <div className="rounded-xl overflow-hidden" style={{
        background: "rgba(255,255,255,0.25)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.35)",
      }}>
        <button
          onClick={() => setBlocksOpen(!blocksOpen)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Blocks className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">{blocksLabel}</span>
            {selectedBlocks.size > 0 && (
              <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
                {selectedBlocks.size} 個已選
              </span>
            )}
          </div>
          <motion.div animate={{ rotate: blocksOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </motion.div>
        </button>

        <AnimatePresence>
          {blocksOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {/* Selected blocks preview */}
                {selectedBlocks.size > 0 && (
                  <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg" style={{
                    background: "rgba(255,255,255,0.1)",
                    border: "1px dashed rgba(255,255,255,0.25)",
                  }}>
                    <span className="text-[10px] text-muted-foreground/60 mr-1 self-center">已選組合:</span>
                    {blockCategories.flatMap(cat =>
                      cat.items
                        .filter(item => selectedBlocks.has(item.id))
                        .map(item => (
                          <motion.span
                            key={item.id}
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0 }}
                            className="px-2 py-0.5 rounded-md text-[10px] font-medium"
                            style={{
                              background: `rgba(${cat.glowRgb}, 0.15)`,
                              color: `rgb(${cat.glowRgb})`,
                              border: `1px solid rgba(${cat.glowRgb}, 0.3)`,
                            }}
                          >
                            {cat.icon} {item.label}
                          </motion.span>
                        ))
                    )}
                  </div>
                )}

                {/* Block categories */}
                {blockCategories.map((cat) => (
                  <div key={cat.id} className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                      <span>{cat.icon}</span>
                      {cat.label}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {cat.items.map((item) => (
                        <BlockChip
                          key={item.id}
                          item={item}
                          category={cat}
                          isSelected={selectedBlocks.has(item.id)}
                          onToggle={() => handleBlockToggle(item.id, item.prompt)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ═══ Section 2: Main Prompt Textarea ═══ */}
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
          placeholder={promptPlaceholder}
          value={value.rawPrompt}
          onChange={(e) => {
            updateField("rawPrompt", e.target.value);
            onType?.(e.target.value.length);
          }}
          rows={3}
          className="rounded-xl bg-white/40 border-white/60 resize-none text-sm placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/30"
        />
      </div>

      {/* ═══ Section 3: Self-Attention UI (Token Weights) ═══ */}
      {tokens.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{
          background: "rgba(255,255,255,0.25)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.35)",
        }}>
          <button
            onClick={() => setAttentionOpen(!attentionOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Focus className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-foreground">自注意力控制台</span>
              <span className="text-[10px] text-muted-foreground/60">
                {tokens.length} 個 Token
              </span>
              {tokens.some(t => Math.abs(t.weight - 1.0) >= 0.05) && (
                <span className="text-[10px] bg-amber-500/15 text-amber-500 px-2 py-0.5 rounded-full font-medium">
                  已調整權重
                </span>
              )}
            </div>
            <motion.div animate={{ rotate: attentionOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </motion.div>
          </button>

          <AnimatePresence>
            {attentionOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    點擊 Token 標籤調整 AI 注意力權重。權重越高，AI 越關注該元素。
                  </p>

                  {/* Token chips */}
                  <div className="flex flex-wrap gap-2" data-token-chip>
                    {tokens.map((token) => (
                      <TokenChip
                        key={token.id}
                        token={token}
                        isSelected={selectedTokenId === token.id}
                        onSelect={() => setSelectedTokenId(selectedTokenId === token.id ? null : token.id)}
                        onWeightChange={(w) => handleTokenWeightChange(token.id, w)}
                      />
                    ))}
                  </div>

                  {/* Compiled preview with weights */}
                  {value.compiledPrompt && (
                    <div className="p-3 rounded-lg" style={{
                      background: "rgba(255, 180, 50, 0.05)",
                      border: "1px solid rgba(255, 180, 50, 0.15)",
                    }}>
                      <p className="text-[10px] text-amber-500/60 uppercase tracking-wider mb-1.5 font-medium">
                        編譯後提示詞（含權重）
                      </p>
                      <p className="text-xs text-foreground/80 leading-relaxed font-mono">{value.compiledPrompt}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ Section 4: Visual Vibe Cards (only for image/video) ═══ */}
      {(modality === "image" || modality === "video" || !modality) && (
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
      )}

      {/* ═══ Section 5: Advanced Fields (Progressive Disclosure) ═══ */}
      <div className="rounded-xl overflow-hidden" style={{
        background: "rgba(255,255,255,0.25)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.35)",
      }}>
        <button
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">進階提示詞建構器</span>
            {hasAdvancedContent && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">已填寫</span>
            )}
          </div>
          <motion.div animate={{ rotate: advancedOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Default empty state ───────────────────────────────────────────────────

export function createEmptyPromptOutput(): PromptBuilderOutput {
  return {
    rawPrompt: "",
    vibeCardIds: [],
    advancedFields: { subject: "", action: "", environment: "", lighting: "", cameraAngle: "" },
    compiledPrompt: "",
    tokenWeights: [],
  };
}
