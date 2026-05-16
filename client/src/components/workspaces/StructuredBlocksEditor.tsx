import { useState, useMemo } from "react";
import type {
  StructuredBlock,
  Modality,
  WorkspaceMode,
} from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ToggleRight,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { motion, AnimatePresence } from "framer-motion";

interface StructuredBlocksEditorProps {
  blocks: StructuredBlock[];
  onChange: (blocks: StructuredBlock[]) => void;
  modality: Modality;
  workspaceMode: WorkspaceMode;
}

type CategoryKey = "required" | "correction";

interface CategoryMeta {
  key: CategoryKey;
  label: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryMeta[] = [
  {
    key: "required",
    label: "必要條件",
    icon: <Blocks className="h-3.5 w-3.5" />,
  },
  {
    key: "correction",
    label: "修正條件",
    icon: <ToggleRight className="h-3.5 w-3.5" />,
  },
];

const PLACEHOLDER_MAP: Record<Modality, Record<string, string>> = {
  image: {
    subject: "描述主體（例：一位少女、一隻貓）",
    scene: "描述場景環境",
    composition: "構圖方式（例：中心構圖、三分法）",
    lighting: "光線描述（例：黃金時刻、柔光）",
    style: "藝術風格（例：油畫、水彩、賽博龐克）",
    aspectRatio: "1:1, 16:9, 9:16",
  },
  video: {
    subjectAction: "主體動作（例：女孩轉身微笑）",
    scene: "場景描述",
    duration: "時長（秒）",
    cameraMovement: "鏡頭運動（例：緩慢推進、環繞）",
    motionPacing: "動作節奏（例：慢動作、正常、快節奏）",
    visualStyle: "視覺風格",
  },
  music: {
    useCase: "用途（例：背景音樂、片頭曲）",
    mood: "情緒（例：平靜、歡快、緊張）",
    duration: "時長（秒）",
    genre: "曲風（例：古典、電子、爵士）",
    bpm: "BPM節奏（例：120）",
    instrumentation: "樂器配置（例：鋼琴、弦樂、電吉他）",
  },
  voice: {
    script: "語音文稿內容",
    speakerIdentity: "說話者身份（例：溫暖女聲、專業旁白）",
    language: "語言/口音",
    tone: "語氣（例：溫柔、嚴肅、興奮）",
    pace: "語速（例：慢速、正常、快速）",
    deliveryStyle: "表達方式（例：敘事、對白、廣播）",
  },
};

const LONG_TEXT_FIELDS = new Set([
  "subject",
  "scene",
  "subjectAction",
  "script",
]);

function getPlaceholder(modality: Modality, fieldKey: string): string {
  return PLACEHOLDER_MAP[modality]?.[fieldKey] ?? "";
}

export function StructuredBlocksEditor({
  blocks,
  onChange,
  modality,
  workspaceMode,
}: StructuredBlocksEditorProps) {
  const [collapsedSections, setCollapsedSections] = useState<
    Record<CategoryKey, boolean>
  >({
    required: false,
    correction: true,
  });

  const grouped = useMemo(() => {
    const map: Record<CategoryKey, StructuredBlock[]> = {
      required: [],
      correction: [],
    };
    for (const block of blocks) {
      if (block.category in map) {
        map[block.category as CategoryKey]?.push(block);
      }
    }
    return map;
  }, [blocks]);

  const visibleCategories = useMemo(() => {
    return CATEGORIES.filter(c => c.key !== "required");
  }, []);

  function updateBlock(
    blockId: string,
    patch: Partial<Pick<StructuredBlock, "value" | "enabled">>
  ) {
    const next = blocks.map(b => (b.id === blockId ? { ...b, ...patch } : b));
    onChange(next);
  }

  function toggleSection(key: CategoryKey) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      {visibleCategories.map(category => {
        const categoryBlocks = grouped[category.key];
        if (categoryBlocks.length === 0) return null;

        const isCollapsed = collapsedSections[category.key];
        const isCollapsible = category.key !== "required";

        return (
          <div key={category.key} className="space-y-2">
            {/* Category Header */}
            <button
              type="button"
              onClick={() => isCollapsible && toggleSection(category.key)}
              className={cn(
                "flex w-full items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                isCollapsible &&
                  "cursor-pointer hover:text-foreground transition-colors",
                !isCollapsible && "cursor-default"
              )}
            >
              {category.icon}
              <span>{category.label}</span>
              {isCollapsible && (
                <span className="ml-auto">
                  {isCollapsed ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronUp className="h-3.5 w-3.5" />
                  )}
                </span>
              )}
            </button>

            {/* Block Rows */}
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5">
                    {categoryBlocks.map(block => (
                      <BlockRow
                        key={block.id}
                        block={block}
                        modality={modality}
                        onValueChange={value =>
                          updateBlock(block.id, { value })
                        }
                        onToggle={enabled => updateBlock(block.id, { enabled })}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

interface BlockRowProps {
  block: StructuredBlock;
  modality: Modality;
  onValueChange: (value: string) => void;
  onToggle: (enabled: boolean) => void;
}

function BlockRow({ block, modality, onValueChange, onToggle }: BlockRowProps) {
  const placeholder = getPlaceholder(modality, block.fieldKey);
  const isLongText = LONG_TEXT_FIELDS.has(block.fieldKey);
  const inputId = `block-${block.id}`;

  return (
    <div
      className={cn(
        "p-2 rounded-lg hover:bg-card/20 transition-colors",
        !block.enabled && "opacity-50"
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Label
          htmlFor={inputId}
          className={cn(
            "text-xs font-medium flex-1 cursor-pointer",
            !block.enabled && "text-muted-foreground"
          )}
        >
          {block.enabled ? (
            <Eye className="inline h-3 w-3 mr-1 opacity-50" />
          ) : (
            <EyeOff className="inline h-3 w-3 mr-1 opacity-50" />
          )}
          {block.label}
        </Label>
        <Switch
          checked={block.enabled}
          onCheckedChange={onToggle}
          className="scale-75"
        />
      </div>

      {isLongText ? (
        <Textarea
          id={inputId}
          value={block.value}
          onChange={e => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={!block.enabled}
          rows={2}
          className="rounded-xl bg-card/40 border-white/60 text-xs resize-none"
        />
      ) : (
        <Input
          id={inputId}
          value={block.value}
          onChange={e => onValueChange(e.target.value)}
          placeholder={placeholder}
          disabled={!block.enabled}
          className="rounded-xl bg-card/40 border-white/60 text-xs"
        />
      )}
    </div>
  );
}
