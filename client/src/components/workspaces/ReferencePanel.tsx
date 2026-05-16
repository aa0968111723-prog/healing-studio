import { useState } from "react";
import { type ReferenceItem, type Modality } from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import {
  Upload,
  X,
  Sliders,
  Tag,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Reference types per modality ─────────────────────────────────────────
type ReferenceTypeInfo = { value: string; label: string };

const REFERENCE_TYPES: Record<Modality, ReferenceTypeInfo[]> = {
  image: [
    { value: "character", label: "角色" },
    { value: "style", label: "風格" },
    { value: "composition", label: "構圖" },
    { value: "texture", label: "材質" },
  ],
  video: [
    { value: "startFrame", label: "起始幀" },
    { value: "motionStyle", label: "動態風格" },
    { value: "endFrame", label: "結束幀" },
  ],
  music: [{ value: "referenceTrack", label: "參考曲目" }],
  voice: [{ value: "voiceSample", label: "聲音樣本" }],
};

// ─── Selective usage options per modality ──────────────────────────────────
const SELECTIVE_USAGE_OPTIONS: Record<Modality, string[]> = {
  image: ["風格", "構圖", "色彩", "材質"],
  video: ["運鏡", "動態", "節奏"],
  music: ["旋律", "節拍", "編曲"],
  voice: ["語氣", "語速", "音色"],
};

// ─── Props ────────────────────────────────────────────────────────────────
type ReferencePanelProps = {
  references: ReferenceItem[];
  onChange: (refs: ReferenceItem[]) => void;
  modality: Modality;
};

// ─── Helpers ──────────────────────────────────────────────────────────────
function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url);
}

let nextId = 0;
function generateId(): string {
  nextId += 1;
  return `ref-${Date.now()}-${nextId}`;
}

// ─── Reference Card ───────────────────────────────────────────────────────
type ReferenceCardProps = {
  item: ReferenceItem;
  modality: Modality;
  onUpdate: (updated: ReferenceItem) => void;
  onRemove: () => void;
};

function ReferenceCard({
  item,
  modality,
  onUpdate,
  onRemove,
}: ReferenceCardProps) {
  const [expanded, setExpanded] = useState(true);
  const types = REFERENCE_TYPES[modality];
  const usageOptions = SELECTIVE_USAGE_OPTIONS[modality];

  const handleUsageToggle = (option: string, checked: boolean) => {
    const next = checked
      ? [...item.selectiveUsage, option]
      : item.selectiveUsage.filter(u => u !== option);
    onUpdate({ ...item, selectiveUsage: next });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-xl border border-white/50 bg-card/30 backdrop-blur-sm p-3 space-y-3"
    >
      {/* Card header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isImageUrl(item.url) && (
            <img
              src={item.url}
              alt={item.purpose || "參考素材"}
              className="w-10 h-10 rounded-lg object-cover border border-white/40 shrink-0"
              loading="lazy"
            />
          )}
          <span className="text-xs text-muted-foreground truncate">
            {item.url}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="p-1 rounded-md text-muted-foreground hover:bg-card/40 transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expandable details */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-3"
          >
            {/* Type selector + Purpose */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  類型
                </Label>
                <Select
                  value={item.type}
                  onValueChange={v => onUpdate({ ...item, type: v })}
                >
                  <SelectTrigger size="sm" className="h-8 text-xs bg-card/50">
                    <SelectValue placeholder="選擇類型" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map(t => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  用途
                </Label>
                <Input
                  value={item.purpose}
                  onChange={e => onUpdate({ ...item, purpose: e.target.value })}
                  placeholder="描述用途"
                  className="h-8 text-xs bg-card/50"
                />
              </div>
            </div>

            {/* Influence weight slider */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Sliders className="w-3 h-3" />
                影響力權重
                <span className="ml-auto font-mono text-[10px]">
                  {item.weight.toFixed(2)}
                </span>
              </Label>
              <Slider
                value={[item.weight]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={([v]) => onUpdate({ ...item, weight: v })}
                className="w-full"
              />
            </div>

            {/* Selective usage checkboxes */}
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">
                選擇性套用
              </Label>
              <div className="flex flex-wrap gap-2">
                {usageOptions.map(option => {
                  const checked = item.selectiveUsage.includes(option);
                  return (
                    <label
                      key={option}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors cursor-pointer",
                        checked
                          ? "bg-primary/10 text-primary"
                          : "bg-card/40 text-muted-foreground hover:bg-card/60"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={c =>
                          handleUsageToggle(option, c === true)
                        }
                        className="size-3"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────
export function ReferencePanel({
  references,
  onChange,
  modality,
}: ReferencePanelProps) {
  const [newUrl, setNewUrl] = useState("");
  const [newType, setNewType] = useState("");

  const types = REFERENCE_TYPES[modality];

  const handleAdd = () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    const typeToUse = newType || types[0].value;
    const item: ReferenceItem = {
      id: generateId(),
      url: trimmed,
      type: typeToUse,
      purpose: "",
      weight: 0.5,
      selectiveUsage: [],
    };
    onChange([...references, item]);
    setNewUrl("");
    setNewType("");
  };

  const handleUpdate = (idx: number, updated: ReferenceItem) => {
    const next = [...references];
    next[idx] = updated;
    onChange(next);
  };

  const handleRemove = (idx: number) => {
    onChange(references.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ImageIcon className="w-3.5 h-3.5" />
        <span>參考素材</span>
        {references.length > 0 && (
          <span className="ml-auto text-[10px] tabular-nums">
            {references.length}
          </span>
        )}
      </div>

      {/* Add reference row */}
      <div className="flex items-center gap-2">
        <Input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder="輸入參考素材 URL…"
          className="flex-1 h-8 text-xs bg-card/50"
        />
        <Select value={newType} onValueChange={setNewType}>
          <SelectTrigger size="sm" className="w-24 h-8 text-xs bg-card/50">
            <SelectValue placeholder="類型" />
          </SelectTrigger>
          <SelectContent>
            {types.map(t => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleAdd}
          disabled={!newUrl.trim()}
          className="h-8 text-xs gap-1"
        >
          <Upload className="w-3.5 h-3.5" />
          新增
        </Button>
      </div>

      {/* Reference cards */}
      <AnimatePresence mode="popLayout">
        {references.map((ref, idx) => (
          <ReferenceCard
            key={ref.id}
            item={ref}
            modality={modality}
            onUpdate={updated => handleUpdate(idx, updated)}
            onRemove={() => handleRemove(idx)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
