import { useState } from "react";
import type {
  SavedRecipe,
  Modality,
  StructuredBlock,
  ThoughtIsland,
  PromptStrengthLevel,
  ReferenceItem,
} from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Save,
  Trash2,
  ChevronDown,
  ChevronUp,
  Image,
  Video,
  Music,
  Mic,
  Sparkles,
  FolderOpen,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _blockId = 0;
let _islandId = 0;
function makeBlock(
  fieldKey: string,
  label: string,
  value: string,
  category: StructuredBlock["category"] = "required"
): StructuredBlock {
  return {
    id: `tpl-block-${++_blockId}`,
    fieldKey,
    label,
    value,
    category,
    enabled: true,
  };
}

function makeIsland(
  category: ThoughtIsland["category"],
  content: string,
  hint: string
): ThoughtIsland {
  return { id: `tpl-island-${++_islandId}`, category, content, hint };
}

// ─── Starter Template Type ────────────────────────────────────────────────────

interface StarterTemplate {
  name: string;
  description: string;
  icon: string;
  recipe: Omit<SavedRecipe, "id" | "name" | "createdAt">;
}

// ─── Starter Template Data ────────────────────────────────────────────────────

const STARTER_TEMPLATES: Record<Modality, StarterTemplate[]> = {
  image: [
    {
      name: "商品圖",
      description: "適合電商、產品目錄的乾淨商品攝影",
      icon: "📦",
      recipe: {
        modality: "image",
        blocks: [
          makeBlock("subject", "主題", "product shot", "required"),
          makeBlock(
            "lighting",
            "光線",
            "studio lighting, soft shadows",
            "control"
          ),
          makeBlock(
            "style",
            "風格",
            "commercial photography, high resolution",
            "control"
          ),
          makeBlock(
            "composition",
            "構圖",
            "centered, clean white background",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "生成專業商品展示圖", "描述你想呈現的商品效果"),
          makeIsland("subject", "產品特寫", "描述產品外觀與細節"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "角色圖",
      description: "角色設計與立繪，適合遊戲或插畫",
      icon: "🧑‍🎨",
      recipe: {
        modality: "image",
        blocks: [
          makeBlock(
            "subject",
            "主題",
            "character design, full body",
            "required"
          ),
          makeBlock("style", "風格", "anime illustration, detailed", "control"),
          makeBlock("lighting", "光線", "dramatic rim lighting", "control"),
          makeBlock(
            "pose",
            "姿態",
            "dynamic pose, three-quarter view",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "設計獨特角色立繪", "描述角色的整體形象"),
          makeIsland("style", "動漫風格插畫", "選擇你偏好的畫風"),
        ],
        promptStrength: "high",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "海報",
      description: "活動海報、宣傳視覺設計",
      icon: "🪧",
      recipe: {
        modality: "image",
        blocks: [
          makeBlock(
            "subject",
            "主題",
            "event poster mockup, bold typography, realistic print texture, subtle paper grain",
            "required"
          ),
          makeBlock(
            "style",
            "風格",
            "graphic design, vibrant but harmonious palette, text color matched to background tones",
            "control"
          ),
          makeBlock(
            "composition",
            "構圖",
            "vertical layout, eye-catching hierarchy, clear title-subtitle-detail information structure",
            "control"
          ),
          makeBlock("mood", "氛圍", "energetic, modern", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作引人注目的宣傳海報", "描述海報的用途與主題"),
          makeIsland("constraints", "垂直版面、文字空間預留", "考慮排版需求"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "社群封面",
      description: "社群媒體橫幅、封面圖片",
      icon: "🖼️",
      recipe: {
        modality: "image",
        blocks: [
          makeBlock("subject", "主題", "social media banner", "required"),
          makeBlock("style", "風格", "clean, modern, minimalist", "control"),
          makeBlock(
            "composition",
            "構圖",
            "wide aspect ratio, rule of thirds",
            "control"
          ),
          makeBlock(
            "color",
            "色調",
            "brand-aligned, harmonious palette",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作社群媒體封面圖", "描述平台與用途"),
          makeIsland("output", "16:9 橫幅比例", "根據平台選擇尺寸"),
        ],
        promptStrength: "low",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
  ],

  video: [
    {
      name: "文生影",
      description: "從文字描述直接生成影片片段",
      icon: "✍️",
      recipe: {
        modality: "video",
        blocks: [
          makeBlock(
            "scene",
            "場景",
            "cinematic scene, smooth camera motion",
            "required"
          ),
          makeBlock("style", "風格", "photorealistic, 4K", "control"),
          makeBlock("duration", "時長", "4 seconds", "control"),
          makeBlock("camera", "鏡頭", "slow dolly forward", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "從文字描述生成影片", "描述你想看到的畫面"),
          makeIsland("style", "電影感寫實風", "選擇影片風格"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "圖生影",
      description: "以參考圖片為基礎生成動態影片",
      icon: "🖼️",
      recipe: {
        modality: "video",
        blocks: [
          makeBlock(
            "motion",
            "動態",
            "subtle animation from reference image",
            "required"
          ),
          makeBlock("style", "風格", "consistent with source image", "control"),
          makeBlock("duration", "時長", "3 seconds", "control"),
          makeBlock("transition", "轉場", "smooth fade in", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "將靜態圖片轉為動態影片", "描述期望的動態效果"),
          makeIsland("subject", "參考圖片內容", "上傳參考圖後描述重點"),
        ],
        promptStrength: "high",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "廣告短片",
      description: "產品或品牌廣告短片",
      icon: "📺",
      recipe: {
        modality: "video",
        blocks: [
          makeBlock(
            "scene",
            "場景",
            "product showcase, dynamic cuts",
            "required"
          ),
          makeBlock(
            "style",
            "風格",
            "commercial, sleek transitions",
            "control"
          ),
          makeBlock("duration", "時長", "6 seconds", "control"),
          makeBlock("mood", "氛圍", "upbeat, professional", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作短版廣告影片", "描述廣告主題與賣點"),
          makeIsland("constraints", "6 秒內傳達核心訊息", "保持簡潔有力"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "分鏡片段",
      description: "影片分鏡預覽與故事板",
      icon: "🎬",
      recipe: {
        modality: "video",
        blocks: [
          makeBlock(
            "scene",
            "場景",
            "storyboard frame, rough sketch style",
            "required"
          ),
          makeBlock(
            "camera",
            "鏡頭",
            "establishing shot, medium close-up",
            "control"
          ),
          makeBlock("action", "動作", "character enters from left", "control"),
          makeBlock("notes", "備註", "scene transition marker", "correction"),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作分鏡預覽", "描述這一幕的場景"),
          makeIsland("subject", "角色與場景描述", "描述畫面中的關鍵元素"),
        ],
        promptStrength: "low",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
  ],

  music: [
    {
      name: "背景音樂",
      description: "影片或簡報用的氛圍背景音樂",
      icon: "🎵",
      recipe: {
        modality: "music",
        blocks: [
          makeBlock("genre", "曲風", "ambient, lo-fi", "required"),
          makeBlock("mood", "情緒", "calm, relaxing, warm", "control"),
          makeBlock("tempo", "節奏", "80 BPM, steady", "control"),
          makeBlock(
            "instruments",
            "樂器",
            "piano, soft pads, light percussion",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "生成適合背景播放的音樂", "描述使用場景"),
          makeIsland("style", "輕鬆氛圍", "選擇偏好的曲風"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "片頭曲",
      description: "節目或影片的開場主題曲",
      icon: "🎬",
      recipe: {
        modality: "music",
        blocks: [
          makeBlock("genre", "曲風", "orchestral, cinematic", "required"),
          makeBlock("mood", "情緒", "epic, uplifting, grand", "control"),
          makeBlock("tempo", "節奏", "120 BPM, building crescendo", "control"),
          makeBlock(
            "instruments",
            "樂器",
            "strings, brass, timpani",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作令人印象深刻的片頭曲", "描述節目風格"),
          makeIsland("style", "管弦樂電影感", "選擇氣勢磅礴的風格"),
        ],
        promptStrength: "high",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "片尾曲",
      description: "影片結尾的收場音樂",
      icon: "🌙",
      recipe: {
        modality: "music",
        blocks: [
          makeBlock("genre", "曲風", "acoustic, folk", "required"),
          makeBlock("mood", "情緒", "reflective, gentle, nostalgic", "control"),
          makeBlock("tempo", "節奏", "70 BPM, decrescendo ending", "control"),
          makeBlock(
            "instruments",
            "樂器",
            "acoustic guitar, cello, light vocals",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作溫暖的片尾曲", "描述收尾的氛圍"),
          makeIsland("style", "原聲民謠風", "偏好的結尾風格"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "情緒配樂",
      description: "配合特定情緒場景的配樂",
      icon: "🎭",
      recipe: {
        modality: "music",
        blocks: [
          makeBlock("genre", "曲風", "cinematic score, emotional", "required"),
          makeBlock("mood", "情緒", "tension, suspense, release", "control"),
          makeBlock("tempo", "節奏", "variable, dynamic shifts", "control"),
          makeBlock(
            "instruments",
            "樂器",
            "synth pads, solo violin, deep bass",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "為情緒場景量身打造配樂", "描述場景的情緒變化"),
          makeIsland("constraints", "配合畫面節奏", "注意情緒轉折點"),
        ],
        promptStrength: "high",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
  ],

  voice: [
    {
      name: "旁白",
      description: "影片旁白、紀錄片解說",
      icon: "🎙️",
      recipe: {
        modality: "voice",
        blocks: [
          makeBlock("tone", "語氣", "calm, authoritative narrator", "required"),
          makeBlock("pace", "語速", "moderate, clear enunciation", "control"),
          makeBlock("style", "風格", "documentary narration", "control"),
          makeBlock("language", "語言", "Mandarin Chinese, formal", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "生成專業旁白語音", "描述旁白的用途"),
          makeIsland("style", "穩重解說風", "選擇旁白風格"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "角色配音",
      description: "動畫或遊戲角色語音",
      icon: "🎭",
      recipe: {
        modality: "voice",
        blocks: [
          makeBlock("tone", "語氣", "expressive, character-driven", "required"),
          makeBlock("emotion", "情緒", "playful, energetic", "control"),
          makeBlock("style", "風格", "anime voice acting", "control"),
          makeBlock("age", "年齡感", "youthful, bright", "control"),
        ],
        thoughtIslands: [
          makeIsland("goal", "為角色生成配音", "描述角色個性"),
          makeIsland("subject", "角色設定", "描述角色背景與性格"),
        ],
        promptStrength: "high",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "廣告口播",
      description: "廣告旁白、品牌宣傳配音",
      icon: "📢",
      recipe: {
        modality: "voice",
        blocks: [
          makeBlock("tone", "語氣", "confident, persuasive", "required"),
          makeBlock("pace", "語速", "upbeat, slightly fast", "control"),
          makeBlock("style", "風格", "commercial voiceover", "control"),
          makeBlock(
            "emphasis",
            "強調",
            "brand name and key features",
            "correction"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "製作廣告配音", "描述品牌與產品"),
          makeIsland("constraints", "30 秒內完成", "控制時長"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
    {
      name: "對白",
      description: "影視對話、劇本台詞配音",
      icon: "💬",
      recipe: {
        modality: "voice",
        blocks: [
          makeBlock("tone", "語氣", "natural, conversational", "required"),
          makeBlock("emotion", "情緒", "contextual, varied", "control"),
          makeBlock("style", "風格", "dramatic dialogue", "control"),
          makeBlock(
            "interaction",
            "互動",
            "responsive, with pauses",
            "control"
          ),
        ],
        thoughtIslands: [
          makeIsland("goal", "生成自然的對白語音", "描述對話情境"),
          makeIsland("subject", "角色對話內容", "提供台詞與情境"),
        ],
        promptStrength: "medium",
        advancedPrompt: "",
        references: [],
        generationParams: {},
      },
    },
  ],
};

// ─── Modality icons for saved recipe cards ────────────────────────────────────

const MODALITY_ICONS: Record<
  Modality,
  React.ComponentType<{ className?: string }>
> = {
  image: Image,
  video: Video,
  music: Music,
  voice: Mic,
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface RecipeLibraryPanelProps {
  modality: Modality;
  savedRecipes: SavedRecipe[];
  onApplyRecipe: (recipe: SavedRecipe) => void;
  onSaveRecipe: (name: string) => void;
  onDeleteRecipe: (recipeId: string) => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onApply,
}: {
  template: StarterTemplate;
  onApply: (template: StarterTemplate) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "bg-white/30 rounded-xl border border-white/40 p-3",
        "hover:bg-white/50 transition-colors cursor-pointer group"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-2xl shrink-0"
          role="img"
          aria-label={template.name}
        >
          {template.icon}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-800 truncate">
            {template.name}
          </h4>
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
            {template.description}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full mt-2 text-xs opacity-70 group-hover:opacity-100 transition-opacity"
        onClick={() => onApply(template)}
      >
        套用
      </Button>
    </motion.div>
  );
}

function SavedRecipeCard({
  recipe,
  onApply,
  onDelete,
}: {
  recipe: SavedRecipe;
  onApply: (recipe: SavedRecipe) => void;
  onDelete: (recipeId: string) => void;
}) {
  const ModalityIcon = MODALITY_ICONS[recipe.modality];
  const dateStr = new Date(recipe.createdAt).toLocaleDateString("zh-TW", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg",
        "bg-white/20 border border-white/30 hover:bg-white/40 transition-colors"
      )}
    >
      <ModalityIcon className="w-4 h-4 text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">
          {recipe.name}
        </p>
        <p className="text-xs text-slate-400">
          {dateStr} · {recipe.blocks.length} 個區塊
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={() => onApply(recipe)}>
          <BookOpen className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-red-400 hover:text-red-600"
          onClick={() => onDelete(recipe.id)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RecipeLibraryPanel({
  modality,
  savedRecipes,
  onApplyRecipe,
  onSaveRecipe,
  onDeleteRecipe,
}: RecipeLibraryPanelProps) {
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [savedOpen, setSavedOpen] = useState(true);
  const [newRecipeName, setNewRecipeName] = useState("");

  const templates = STARTER_TEMPLATES[modality];
  const filteredRecipes = savedRecipes.filter(r => r.modality === modality);

  const handleApplyTemplate = (template: StarterTemplate) => {
    const recipe: SavedRecipe = {
      id: `tpl-${Date.now()}`,
      name: template.name,
      createdAt: Date.now(),
      ...template.recipe,
    };
    onApplyRecipe(recipe);
  };

  const handleSave = () => {
    const trimmed = newRecipeName.trim();
    if (!trimmed) return;
    onSaveRecipe(trimmed);
    setNewRecipeName("");
  };

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-indigo-500" />
        <h3 className="text-base font-bold text-slate-800">配方庫</h3>
      </div>

      {/* ── Starter Templates ──────────────────────────────────── */}
      <section>
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-left mb-2"
          onClick={() => setTemplatesOpen(o => !o)}
        >
          <Sparkles className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-slate-700 flex-1">
            推薦模板
          </span>
          {templatesOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {templatesOpen && (
            <motion.div
              key="templates"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-2 gap-2">
                {templates.map(t => (
                  <TemplateCard
                    key={t.name}
                    template={t}
                    onApply={handleApplyTemplate}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* ── Saved Recipes ──────────────────────────────────────── */}
      <section>
        <button
          type="button"
          className="flex items-center gap-1.5 w-full text-left mb-2"
          onClick={() => setSavedOpen(o => !o)}
        >
          <FolderOpen className="w-4 h-4 text-teal-500" />
          <span className="text-sm font-semibold text-slate-700 flex-1">
            已保存配方
          </span>
          {savedOpen ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        <AnimatePresence initial={false}>
          {savedOpen && (
            <motion.div
              key="saved"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {/* Save new recipe input */}
              <div className="flex items-center gap-2 mb-3">
                <Input
                  placeholder="輸入配方名稱…"
                  value={newRecipeName}
                  onChange={e => setNewRecipeName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSave();
                  }}
                  className="flex-1 text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!newRecipeName.trim()}
                  onClick={handleSave}
                >
                  <Save className="w-3.5 h-3.5 mr-1" />
                  儲存
                </Button>
              </div>

              {/* Saved list */}
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {filteredRecipes.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-3">
                      尚無已保存配方
                    </p>
                  ) : (
                    filteredRecipes.map(r => (
                      <SavedRecipeCard
                        key={r.id}
                        recipe={r}
                        onApply={onApplyRecipe}
                        onDelete={onDeleteRecipe}
                      />
                    ))
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
