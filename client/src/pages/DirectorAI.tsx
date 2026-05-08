import { useState, useCallback, useEffect, useMemo, memo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import LazyStreamdown from "@/components/LazyStreamdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Clapperboard,
  Send,
  Image,
  Music,
  Mic,
  Brain,
  Palette,
  Wrench,
  MessageCircleQuestion,
  BookTemplate,
  Save,
  FolderOpen,
  Trash2,
  Pencil,
  Copy,
  ChevronDown,
  ChevronUp,
  X,
  Upload,
  FileText,
  Download,
  CheckCircle2,
  MessageSquare,
  Zap,
  Heart,
  Timer,
  Shuffle,
  Settings,
  Wand2,
  Sun,
  Volume2,
  Headphones,
  Camera,
  Sparkles,
  Eye,
  Play,
  ChevronRight,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Layers,
  Users,
  MapPin,
  Tag,
  Lightbulb,
  BookOpen,
  Film,
  ThermometerSun,
  CalendarDays,
  CircleDot,
  Milestone,
  Search,
  Package,
} from "lucide-react";
import { GlassCard } from "@/components/ZenCoPilot";
import { useAssetsDrawer } from "@/contexts/AssetsDrawerContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import VisualSoul from "@/components/VisualSoul";
import { BatchGenerationDialog } from "./DirectorAI_batch_dialog";
import { useAIState } from "@/contexts/AIStateContext";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";
import {
  readAndClearDirectorHandoff,
  type DirectorHandoffPayload,
} from "@/lib/director-handoff";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type {
  CoStarScript,
  ScriptSegment,
  ScriptOverview,
  QuickAction,
  PlanningPhase,
  PlanningMessage,
  ScriptPlanningSession,
  ScenePlan,
  EmotionalBeat,
} from "@shared/types";

// Local draft of the active planning session — persisted to localStorage on
// every edit so a page reload mid-edit doesn't lose work that hasn't yet been
// flushed to the 3s DB auto-save. Versioned so we can evolve the shape later.
const PLANNING_DRAFT_KEY = "hs.director.planningDraft.v1";

/** Derive ScenePlan rows from imported script segments for the scene-planning phase. */
function scenesFromSegments(segments: ScriptSegment[]): ScenePlan[] {
  return segments.map((seg, i) => {
    const sb = seg.storyboard;
    const noteParts = [
      sb.dialogue ? `對白：${sb.dialogue}` : "",
      sb.cameraDirection ? `鏡頭：${sb.cameraDirection}` : "",
      sb.soundDesign ? `音效：${sb.soundDesign}` : "",
    ].filter(Boolean);
    return {
      id: seg.id || `scene-${i}-${Date.now()}`,
      title: sb.sceneHeading || `場景 ${i + 1}`,
      description: sb.visualDescription || seg.rawText.slice(0, 200),
      mood: sb.mood || "",
      emotionalGoal: "",
      characters: seg.characters ?? [],
      location: seg.locations?.[0] ?? "",
      duration: sb.duration || "",
      notes: noteParts.join("\n"),
    };
  });
}

// ─── Personality Config ────────────────────────────────────────────────────

const PERSONALITIES = [
  {
    id: "calm" as const,
    label: "沉穩型",
    icon: Brain,
    description: "重邏輯、結構與可行性分析",
    color: "from-slate-500 to-blue-600",
    bgActive: "bg-slate-50 ring-slate-400",
    textColor: "text-slate-700",
  },
  {
    id: "creative" as const,
    label: "創意型",
    icon: Palette,
    description: "重氛圍、情緒與視覺衝擊力",
    color: "from-purple-500 to-pink-500",
    bgActive: "bg-purple-50 ring-purple-400",
    textColor: "text-purple-700",
  },
  {
    id: "technical" as const,
    label: "技術型",
    icon: Wrench,
    description: "重參數精確度與技術最佳實踐",
    color: "from-emerald-500 to-teal-600",
    bgActive: "bg-emerald-50 ring-emerald-400",
    textColor: "text-emerald-700",
  },
];

type Personality = "calm" | "creative" | "technical";

// ─── Template Category Labels ──────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  "short-film": "短片",
  ad: "廣告",
  meditation: "冥想",
  "music-video": "MV",
  tutorial: "教學",
  brand: "品牌",
};

const DIRECTOR_QUICK_GUIDE = [
  {
    id: "brief",
    title: "先說任務再說風格",
    tips: [
      "先描述用途、受眾、時長與平台（例如 Reels / YouTube）。",
      "再補風格與情緒（寫實、夢幻、懸疑、療癒等）。",
      "最後才加限制（預算、素材、交付時間）。",
    ],
  },
  {
    id: "pipeline",
    title: "分鏡與生成的推薦順序",
    tips: [
      "先用模板快速出分鏡，再逐段微調對白與鏡頭語言。",
      "先經濟模型確認節奏，再切高品質模型做定稿。",
      "卡住時可先做 1-2 段 POC，再擴展到全片。",
    ],
  },
] as const;

// ─── Quick Action Icon Map ──────────────────────────────────────────────────

const QUICK_ACTION_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  image: Image,
  video: Camera,
  palette: Palette,
  sparkles: Sparkles,
  volume: Volume2,
  mic: Mic,
  headphones: Headphones,
  timer: Timer,
  heart: Heart,
  shuffle: Shuffle,
  settings: Settings,
  wand: Wand2,
  sun: Sun,
  zap: Zap,
  eye: Eye,
};

const QUICK_ACTION_CATEGORY_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  visual: { label: "視覺", color: "bg-blue-100 text-blue-700" },
  audio: { label: "音頻", color: "bg-purple-100 text-purple-700" },
  narrative: { label: "敘事", color: "bg-amber-100 text-amber-700" },
  technical: { label: "技術", color: "bg-emerald-100 text-emerald-700" },
  mood: { label: "氛圍", color: "bg-pink-100 text-pink-700" },
};

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: { label: "待分析", color: "bg-gray-100 text-gray-600", icon: Timer },
  draft: {
    label: "草稿",
    color: "bg-yellow-100 text-yellow-700",
    icon: Pencil,
  },
  refined: { label: "已優化", color: "bg-blue-100 text-blue-700", icon: Eye },
  approved: {
    label: "已確認",
    color: "bg-green-100 text-green-700",
    icon: CheckCircle2,
  },
};

// ─── Planning Phase Config ──────────────────────────────────────────────────

const PLANNING_PHASES: Array<{
  id: PlanningPhase;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  activeColor: string;
}> = [
  {
    id: "concept",
    label: "核心概念",
    description: "釐清主題、觀眾、核心情感與願景",
    icon: Lightbulb,
    color: "text-amber-500",
    activeColor: "bg-amber-50 ring-amber-300 text-amber-700",
  },
  {
    id: "outline",
    label: "故事大綱",
    description: "建構故事弧線、角色與轉折點",
    icon: BookOpen,
    color: "text-blue-500",
    activeColor: "bg-blue-50 ring-blue-300 text-blue-700",
  },
  {
    id: "scene-planning",
    label: "場景規劃",
    description: "逐場景設計細節、氛圍與情感目標",
    icon: Film,
    color: "text-purple-500",
    activeColor: "bg-purple-50 ring-purple-300 text-purple-700",
  },
  {
    id: "emotional-depth",
    label: "情感深度",
    description: "分析溫度、共鳴點、療癒元素",
    icon: ThermometerSun,
    color: "text-rose-500",
    activeColor: "bg-rose-50 ring-rose-300 text-rose-700",
  },
  {
    id: "schedule",
    label: "排程整合",
    description: "建立製作里程碑與時間規劃",
    icon: CalendarDays,
    color: "text-teal-500",
    activeColor: "bg-teal-50 ring-teal-300 text-teal-700",
  },
];

const FORMAT_OPTIONS = [
  { value: "plaintext", label: "純文字" },
  { value: "screenplay", label: "劇本格式" },
  { value: "srt", label: "SRT 字幕" },
  { value: "fdx", label: "Final Draft (.fdx)" },
  { value: "novel", label: "小說/散文" },
  { value: "storyboard", label: "分鏡表" },
  { value: "custom", label: "自訂格式" },
];

const EXPORT_FORMATS = [
  { value: "markdown", label: "Markdown", ext: ".md" },
  { value: "csv", label: "CSV 試算表", ext: ".csv" },
  { value: "json", label: "JSON", ext: ".json" },
  { value: "srt", label: "SRT 字幕", ext: ".srt" },
  { value: "fdx", label: "Final Draft", ext: ".fdx" },
  { value: "custom", label: "自訂模板", ext: ".txt" },
];

// ─── Script Import Panel ───────────────────────────────────────────────────

const ScriptImportPanel = memo(function ScriptImportPanel({
  onImport,
  isImporting,
  personality,
}: {
  onImport: (content: string, title: string, format: string) => void;
  isImporting: boolean;
  personality: Personality;
}) {
  const [scriptContent, setScriptContent] = useState("");
  const [scriptTitle, setScriptTitle] = useState("");
  const [sourceFormat, setSourceFormat] = useState("plaintext");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const text = ev.target?.result;
        if (typeof text === "string") {
          setScriptContent(text);
          if (!scriptTitle) {
            // Extract filename without extension, handling edge cases like hidden files
            const dotIdx = file.name.lastIndexOf(".");
            const baseName =
              dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
            setScriptTitle(baseName || "未命名腳本");
          }
          // Auto-detect format
          if (file.name.endsWith(".srt")) setSourceFormat("srt");
          else if (file.name.endsWith(".fdx")) setSourceFormat("fdx");
          else if (file.name.endsWith(".fountain"))
            setSourceFormat("screenplay");
          toast.success(`已載入 ${file.name}`);
        }
      };
      reader.onerror = () => {
        toast.error("檔案讀取失敗，請確認檔案格式正確");
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [scriptTitle]
  );

  const handleSubmit = useCallback(() => {
    if (!scriptContent.trim()) {
      toast.error("請輸入或上傳腳本內容");
      return;
    }
    if (!scriptTitle.trim()) {
      toast.error("請輸入腳本標題");
      return;
    }
    onImport(scriptContent, scriptTitle, sourceFormat);
  }, [scriptContent, scriptTitle, sourceFormat, onImport]);

  return (
    <GlassCard hover={false} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="hs-h3 !mb-0 flex items-center gap-2">
          <Upload className="w-4 h-4" />
          匯入腳本
        </h3>
        <span className="text-[10px] text-muted-foreground">
          支援純文字、劇本、字幕、Final Draft 等格式
        </span>
      </div>

      {/* Title */}
      <div className="space-y-1.5">
        <Label className="text-xs">腳本標題</Label>
        <input
          type="text"
          value={scriptTitle}
          onChange={e => setScriptTitle(e.target.value)}
          placeholder="例：品牌宣傳短片 V2"
          className="w-full rounded-lg border border-border/50 bg-white/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Format selector */}
      <div className="space-y-1.5">
        <Label className="text-xs">來源格式</Label>
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_OPTIONS.map(fmt => (
            <button
              key={fmt.value}
              onClick={() => setSourceFormat(fmt.value)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all",
                sourceFormat === fmt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/50 border-border/50 hover:bg-white/80 text-muted-foreground"
              )}
            >
              {fmt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">腳本內容</Label>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {scriptContent.length.toLocaleString()} 字
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.srt,.fdx,.fountain,.md,.csv,.json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-[10px] h-6 px-2 gap-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileText className="w-3 h-3" />
              上傳檔案
            </Button>
          </div>
        </div>
        <Textarea
          value={scriptContent}
          onChange={e => setScriptContent(e.target.value)}
          placeholder="貼上你的腳本內容... 可以是任何格式的長腳本文字"
          className="min-h-[200px] text-xs leading-relaxed resize-y bg-white/50"
        />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isImporting || !scriptContent.trim() || !scriptTitle.trim()}
        className="w-full rounded-xl gap-2"
      >
        {isImporting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            AI 正在分析腳本...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            開始分析 — 自動拆分為分鏡
          </>
        )}
      </Button>
    </GlassCard>
  );
});

// ─── Quick Action Chip ──────────────────────────────────────────────────────

const QuickActionChip = memo(function QuickActionChip({
  action,
  onClick,
  disabled,
}: {
  action: QuickAction;
  onClick: (action: QuickAction) => void;
  disabled?: boolean;
}) {
  const IconComp = QUICK_ACTION_ICONS[action.icon] ?? Sparkles;
  const catConfig = QUICK_ACTION_CATEGORY_LABELS[action.category];

  return (
    <button
      onClick={() => onClick(action)}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all",
        "hover:shadow-sm hover:scale-[1.02] active:scale-[0.98]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        catConfig?.color ?? "bg-gray-100 text-gray-700",
        "border-current/10"
      )}
      title={action.promptTemplate}
    >
      <IconComp className="w-3 h-3" />
      {action.labelZh}
    </button>
  );
});

// ─── Segment Discussion Panel ───────────────────────────────────────────────

const SegmentDiscussionPanel = memo(function SegmentDiscussionPanel({
  segment,
  personality,
  quickActions,
  onUpdateSegment,
  onStatusChange,
  onNavigate,
  adjacentSegments,
  onGenerateCostar,
  isGeneratingCostar,
}: {
  segment: ScriptSegment;
  personality: Personality;
  quickActions: QuickAction[];
  onUpdateSegment: (updated: ScriptSegment) => void;
  onStatusChange: (status: ScriptSegment["status"]) => void;
  onNavigate?: (direction: "prev" | "next") => void;
  adjacentSegments?: { prev?: ScriptSegment; next?: ScriptSegment };
  onGenerateCostar?: () => void;
  isGeneratingCostar?: boolean;
}) {
  const [inputMessage, setInputMessage] = useState("");
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(
    null
  );
  const [showAllActions, setShowAllActions] = useState(false);
  const [showGenPipeline, setShowGenPipeline] = useState(false);
  const [showCostar, setShowCostar] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const config =
    PERSONALITIES.find(p => p.id === personality) ?? PERSONALITIES[1];

  const discussMut = trpc.director.discussSegment.useMutation({
    onSuccess: data => {
      const newDiscussionEntry: ScriptSegment["discussion"][number] = {
        role: "assistant",
        content: data.reply,
        timestamp: new Date().toISOString(),
      };

      const updatedSegment: ScriptSegment = {
        ...segment,
        discussion: [...segment.discussion, newDiscussionEntry],
        storyboard: data.updatedStoryboard ?? segment.storyboard,
        status: data.updatedStoryboard ? "refined" : segment.status,
      };
      onUpdateSegment(updatedSegment);
      setSelectedAction(null);
    },
    onError: e => toast.error("討論失敗：" + e.message),
  });

  const handleSend = useCallback(() => {
    if (!inputMessage.trim() && !selectedAction) return;

    const userEntry: ScriptSegment["discussion"][number] = {
      role: "user",
      content: inputMessage || selectedAction?.labelZh || "",
      quickAction: selectedAction?.id,
      timestamp: new Date().toISOString(),
    };

    const updatedSeg: ScriptSegment = {
      ...segment,
      discussion: [...segment.discussion, userEntry],
    };
    onUpdateSegment(updatedSeg);

    discussMut.mutate({
      segment: {
        ...updatedSeg,
        status: updatedSeg.status,
      },
      message: inputMessage || "",
      personality,
      quickActionId: selectedAction?.id,
      prevSegment: adjacentSegments?.prev
        ? {
            index: adjacentSegments.prev.index,
            storyboard: adjacentSegments.prev.storyboard,
          }
        : undefined,
      nextSegment: adjacentSegments?.next
        ? {
            index: adjacentSegments.next.index,
            storyboard: adjacentSegments.next.storyboard,
          }
        : undefined,
    });

    setInputMessage("");
    setSelectedAction(null);
  }, [
    inputMessage,
    selectedAction,
    segment,
    personality,
    discussMut,
    onUpdateSegment,
    adjacentSegments,
  ]);

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      setSelectedAction(action);
      // Auto-send if no extra message needed
      const userEntry: ScriptSegment["discussion"][number] = {
        role: "user",
        content: action.labelZh,
        quickAction: action.id,
        timestamp: new Date().toISOString(),
      };

      const updatedSeg: ScriptSegment = {
        ...segment,
        discussion: [...segment.discussion, userEntry],
      };
      onUpdateSegment(updatedSeg);

      discussMut.mutate({
        segment: {
          ...updatedSeg,
          status: updatedSeg.status,
        },
        message: "",
        personality,
        quickActionId: action.id,
        prevSegment: adjacentSegments?.prev
          ? {
              index: adjacentSegments.prev.index,
              storyboard: adjacentSegments.prev.storyboard,
            }
          : undefined,
        nextSegment: adjacentSegments?.next
          ? {
              index: adjacentSegments.next.index,
              storyboard: adjacentSegments.next.storyboard,
            }
          : undefined,
      });
    },
    [segment, personality, discussMut, onUpdateSegment, adjacentSegments]
  );

  // Group quick actions by category
  const groupedActions = useMemo(() => {
    const groups: Record<string, QuickAction[]> = {};
    quickActions.forEach(a => {
      if (!groups[a.category]) groups[a.category] = [];
      groups[a.category].push(a);
    });
    return groups;
  }, [quickActions]);

  const displayedActions = showAllActions
    ? quickActions
    : quickActions.slice(0, 6);
  const statusCfg = STATUS_CONFIG[segment.status];

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [segment.discussion.length]);

  return (
    <div className="space-y-3">
      {/* Segment header with navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onNavigate && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onNavigate("prev")}
                disabled={!adjacentSegments?.prev}
                className="p-0.5 rounded hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed"
                title="上一段"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onNavigate("next")}
                disabled={!adjacentSegments?.next}
                className="p-0.5 rounded hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed"
                title="下一段"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <span className="text-xs font-bold text-muted-foreground">
            #{segment.index + 1}
          </span>
          <span className="text-sm font-semibold truncate max-w-[200px]">
            {segment.storyboard.sceneHeading}
          </span>
          {statusCfg && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium",
                statusCfg.color
              )}
            >
              <statusCfg.icon className="w-3 h-3" />
              {statusCfg.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(["draft", "refined", "approved"] as const).map(s => (
            <button
              key={s}
              onClick={() => onStatusChange(s)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-md border transition-all",
                segment.status === s
                  ? STATUS_CONFIG[s].color + " border-current/20"
                  : "text-muted-foreground/50 border-transparent hover:border-border/50"
              )}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Character & location tags */}
      {((segment.characters?.length ?? 0) > 0 ||
        (segment.locations?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {segment.characters?.map(c => (
            <span
              key={c}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200"
            >
              <Users className="w-2.5 h-2.5" />
              {c}
            </span>
          ))}
          {segment.locations?.map(l => (
            <span
              key={l}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200"
            >
              <MapPin className="w-2.5 h-2.5" />
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Storyboard info */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {[
          {
            label: "視覺",
            value: segment.storyboard.visualDescription,
            icon: Eye,
          },
          {
            label: "對白",
            value: segment.storyboard.dialogue,
            icon: MessageSquare,
          },
          {
            label: "音效",
            value: segment.storyboard.soundDesign,
            icon: Volume2,
          },
          {
            label: "鏡頭",
            value: segment.storyboard.cameraDirection,
            icon: Camera,
          },
          { label: "時長", value: segment.storyboard.duration, icon: Timer },
          { label: "氛圍", value: segment.storyboard.mood, icon: Heart },
        ].map(item => (
          <div
            key={item.label}
            className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/20"
          >
            <item.icon className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <span className="text-muted-foreground font-medium">
                {item.label}
              </span>
              <p className="hs-p !mb-0 text-foreground/80 line-clamp-2">
                {item.value || "—"}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* CO-STAR Section */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowCostar(!showCostar)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
          >
            <Layers className="w-3 h-3" />
            CO-STAR 結構
            {segment.costar ? (
              <Badge
                variant="secondary"
                className="text-[8px] h-4 px-1 bg-green-100 text-green-700"
              >
                已生成
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[8px] h-4 px-1 text-amber-600 border-amber-300"
              >
                未生成
              </Badge>
            )}
            {showCostar ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
          {onGenerateCostar && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg text-[10px] h-6 px-2 gap-1"
              onClick={onGenerateCostar}
              disabled={isGeneratingCostar}
            >
              {isGeneratingCostar ? (
                <div className="w-3 h-3 border border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              {segment.costar ? "重新生成" : "生成 CO-STAR"}
            </Button>
          )}
        </div>

        <AnimatePresence>
          {showCostar && segment.costar && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="space-y-1.5 pt-1">
                {[
                  { label: "C 背景", value: segment.costar.context },
                  { label: "O 目標", value: segment.costar.situation },
                  { label: "S 風格", value: segment.costar.task },
                  { label: "T 語調", value: segment.costar.action },
                  { label: "A 觀眾", value: segment.costar.result },
                  {
                    label: "R 回應",
                    value: segment.costar.proactiveQuestion ?? "",
                  },
                ].map(item => (
                  <div key={item.label} className="flex gap-2 text-[10px]">
                    <span className="font-bold text-primary/70 w-12 shrink-0">
                      {item.label}
                    </span>
                    <span className="text-foreground/70 leading-relaxed line-clamp-2">
                      {item.value || "—"}
                    </span>
                  </div>
                ))}
                {segment.costar.visualPrompt && (
                  <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100 mt-1">
                    <span className="text-[9px] font-bold text-blue-600 block mb-0.5">
                      Visual Prompt
                    </span>
                    <p className="hs-small !mb-0 text-blue-800/70 line-clamp-3">
                      {segment.costar.visualPrompt}
                    </p>
                  </div>
                )}
                {segment.costar.musicVibe && (
                  <div className="p-2 rounded-lg bg-purple-50/50 border border-purple-100">
                    <span className="text-[9px] font-bold text-purple-600 block mb-0.5">
                      Music Vibe
                    </span>
                    <p className="hs-small !mb-0 text-purple-800/70 line-clamp-2">
                      {segment.costar.musicVibe}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            快選動作
          </span>
          <button
            onClick={() => setShowAllActions(!showAllActions)}
            className="text-[10px] text-primary hover:underline"
          >
            {showAllActions ? "收起" : `顯示全部 (${quickActions.length})`}
          </button>
        </div>

        {showAllActions ? (
          <div className="space-y-2">
            {Object.entries(groupedActions).map(([cat, actions]) => {
              const catCfg = QUICK_ACTION_CATEGORY_LABELS[cat];
              return (
                <div key={cat}>
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 inline-block",
                      catCfg?.color
                    )}
                  >
                    {catCfg?.label}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {actions.map(a => (
                      <QuickActionChip
                        key={a.id}
                        action={a}
                        onClick={handleQuickAction}
                        disabled={discussMut.isPending}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {displayedActions.map(a => (
              <QuickActionChip
                key={a.id}
                action={a}
                onClick={handleQuickAction}
                disabled={discussMut.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Discussion history */}
      {segment.discussion.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[200px] overflow-y-auto space-y-2 pr-1 no-scrollbar"
        >
          {segment.discussion.map((d, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg p-2.5 text-xs leading-relaxed",
                d.role === "user"
                  ? "bg-primary/5 border border-primary/10 ml-4"
                  : "bg-muted/30 border border-border/30 mr-4"
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-semibold text-muted-foreground">
                  {d.role === "user" ? "你" : "導演 AI"}
                </span>
                {d.quickAction && (
                  <Badge variant="secondary" className="text-[9px] h-4 px-1">
                    {d.quickAction}
                  </Badge>
                )}
              </div>
              <p className="whitespace-pre-wrap">{d.content}</p>
            </div>
          ))}
          {discussMut.isPending && (
            <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground animate-pulse">
              <VisualSoul
                size="sm"
                personality={personality}
                state="thinking"
              />
              導演 AI 思考中...
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="flex gap-2">
        <input
          type="text"
          value={inputMessage}
          onChange={e => setInputMessage(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="輸入討論內容，或直接點擊快選動作..."
          disabled={discussMut.isPending}
          className="flex-1 rounded-lg border border-border/50 bg-white/50 px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={
            discussMut.isPending || (!inputMessage.trim() && !selectedAction)
          }
          className="rounded-lg h-9 px-3"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Quick Generate toggle */}
      <div className="pt-2 border-t border-border/20">
        <Button
          variant={showGenPipeline ? "default" : "outline"}
          size="sm"
          className="w-full rounded-xl gap-1.5 text-xs"
          onClick={() => setShowGenPipeline(!showGenPipeline)}
        >
          <Zap className="w-3.5 h-3.5" />
          {showGenPipeline ? "收起生成管道" : "快速生成 — 選擇模型並生成"}
        </Button>
      </div>

      {/* Generation Pipeline */}
      <AnimatePresence>
        {showGenPipeline && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <GenerationPipelinePanel
                segment={segment}
                personality={personality}
                onClose={() => setShowGenPipeline(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Generation Pipeline Panel ──────────────────────────────────────────────

type GenerationTask = {
  modality: "image" | "video" | "audio" | "voice";
  label: string;
  labelZh: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
  enabled: boolean;
};

const TIER_COLORS: Record<string, string> = {
  free: "text-gray-500",
  economy: "text-green-600",
  standard: "text-blue-600",
  premium: "text-purple-600",
  ultra: "text-amber-600",
};

const GenerationPipelinePanel = memo(function GenerationPipelinePanel({
  segment,
  personality,
  onClose,
}: {
  segment: ScriptSegment;
  personality: Personality;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();

  // Model selections per modality
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(
    {}
  );
  const [enabledTasks, setEnabledTasks] = useState<Record<string, boolean>>({
    image: true,
    video: false,
    audio: true,
    voice: true,
  });

  // Fetch available models
  const modelsQuery = trpc.director.generationModels.useQuery(undefined, {
    staleTime: 60_000,
  });

  // Build generation tasks from segment data
  const tasks = useMemo((): GenerationTask[] => {
    const costar = segment.costar;
    const sb = segment.storyboard;

    return [
      {
        modality: "image",
        label: "Image",
        labelZh: "圖像生成",
        icon: Image,
        prompt: costar?.visualPrompt || sb.visualDescription || "",
        enabled: enabledTasks.image,
      },
      {
        modality: "video",
        label: "Video",
        labelZh: "影片生成",
        icon: Camera,
        prompt: costar?.visualPrompt || sb.visualDescription || "",
        enabled: enabledTasks.video,
      },
      {
        modality: "audio",
        label: "Music / Audio",
        labelZh: "音樂生成",
        icon: Music,
        prompt: costar?.musicVibe || sb.soundDesign || sb.mood || "",
        enabled: enabledTasks.audio,
      },
      {
        modality: "voice",
        label: "Voice / TTS",
        labelZh: "語音合成",
        icon: Mic,
        prompt: costar?.audioScript || sb.dialogue || "",
        enabled: enabledTasks.voice,
      },
    ];
  }, [segment, enabledTasks]);

  // Get model options per category
  type GenerationModelOption = {
    modelId: string;
    label: string;
    provider: string;
    tier: string;
    basePoints: number;
    unit: string;
    available: boolean;
    pointsPerSecond?: number;
    pointsPer1kChars?: number;
  };

  const getModelCoaching = useCallback(
    (modality: GenerationTask["modality"], model: GenerationModelOption) => {
      const provider = model.provider.toLowerCase();
      const label = model.label.toLowerCase();
      const isPremium = model.tier === "premium" || model.tier === "ultra";
      if (modality === "image") {
        return {
          bestFor: isPremium ? "高質感分鏡主視覺" : "快速分鏡草圖",
          tip: isPremium
            ? "用於關鍵鏡頭定稿；先用經濟模型草擬，再切高階模型可省成本。"
            : "先大量出圖找構圖，再把入選鏡頭升級到高品質模型。",
          advantages: [
            provider.includes("openai") ? "語意理解強" : "生成穩定",
            model.basePoints <= 3 ? "成本友善" : "畫質優先",
          ],
        };
      }
      if (modality === "video") {
        return {
          bestFor: isPremium ? "關鍵敘事鏡頭" : "節奏預演與動態草稿",
          tip: label.includes("veo") || label.includes("sora")
            ? "高階模型適合最終鏡頭，建議先用經濟模型確認節奏與運鏡。"
            : "先用此模型確認動態方向，再上高階模型做成片。",
          advantages: [
            isPremium ? "敘事質感高" : "速度快",
            model.basePoints <= 6 ? "迭代效率高" : "成片品質強",
          ],
        };
      }
      if (modality === "audio") {
        return {
          bestFor: "情緒配樂與聲音氛圍",
          tip: "先明確 BPM/情緒關鍵字，可提升配樂貼合度。",
          advantages: ["情緒導向", model.basePoints <= 2 ? "低成本試稿" : "細節層次佳"],
        };
      }
      return {
        bestFor: "角色旁白與台詞導演",
        tip: "長句先測 1-2 句確認語氣，再批量生成可降低重工。",
        advantages: ["口條穩定", provider.includes("eleven") ? "情緒表現佳" : "中文友善"],
      };
    },
    []
  );

  const modelOptions = useMemo(() => {
    const data = modelsQuery.data;
    if (!data) return {};
    const models = data.models ?? {};
    return {
      image: models["text-to-image"] ?? [],
      video: models["text-to-video"] ?? [],
      audio: models["text-to-audio"] ?? [],
      voice: models["text-to-speech"] ?? [],
    } as Record<string, GenerationModelOption[]>;
  }, [modelsQuery.data]);

  /**
   * AI 大腦組態的偏好引擎（per modality）。後端 brainProcedure 注入 ctx.brain
   * 後讀 imageEngine / videoEngine / audioEngine / voiceEngine 四個插槽。
   */
  const brainDefaults = useMemo(() => {
    const raw = modelsQuery.data?.brainDefaults ?? {};
    return {
      image: raw["text-to-image"],
      video: raw["text-to-video"],
      audio: raw["text-to-audio"],
      voice: raw["text-to-speech"],
    } as Record<string, string | undefined>;
  }, [modelsQuery.data]);

  // Get estimated total cost
  const totalCost = useMemo(() => {
    let total = 0;
    for (const task of tasks) {
      if (!task.enabled || !task.prompt) continue;
      const modelId = selectedModels[task.modality];
      if (!modelId) continue;
      const options = modelOptions[task.modality] ?? [];
      const model = options.find(m => m.modelId === modelId);
      if (model) total += model.basePoints;
    }
    return total;
  }, [tasks, selectedModels, modelOptions]);

  // Set default model selections when models load.
  // 優先順序：(1) 大腦組態偏好引擎且仍可用 → (2) 第一個可用 → (3) 第一個。
  useEffect(() => {
    if (!modelsQuery.data) return;
    const defaults: Record<string, string> = {};
    for (const [modality, models] of Object.entries(modelOptions)) {
      if (selectedModels[modality] || models.length === 0) continue;
      const brainPref = brainDefaults[modality];
      const brainMatch = brainPref
        ? models.find(m => m.modelId === brainPref && m.available)
        : null;
      if (brainMatch) {
        defaults[modality] = brainMatch.modelId;
      } else {
        const avail = models.find(m => m.available);
        defaults[modality] = avail?.modelId ?? models[0].modelId;
      }
    }
    if (Object.keys(defaults).length > 0) {
      setSelectedModels(prev => ({ ...prev, ...defaults }));
    }
  }, [modelsQuery.data, modelOptions, brainDefaults]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback(
    (task: GenerationTask) => {
      if (!task.prompt.trim()) {
        toast.error(`${task.labelZh}缺少提示詞內容`);
        return;
      }
      const modelId = selectedModels[task.modality];
      if (!modelId) {
        toast.error(`請先選擇${task.labelZh}模型`);
        return;
      }

      // Send to studio with the specific model override
      sessionStorage.setItem(
        "sendToStudio",
        JSON.stringify({
          prompt: task.prompt,
          generationType: task.modality,
          overrideEngine: modelId,
          source: "director_ai",
          sceneName: segment.storyboard.sceneHeading,
          // Include context metadata for studio
          musicStyle: task.modality === "audio" ? task.prompt : undefined,
          audioScript: task.modality === "voice" ? task.prompt : undefined,
          segmentContext: {
            sceneHeading: segment.storyboard.sceneHeading,
            mood: segment.storyboard.mood,
            duration: segment.storyboard.duration,
          },
        })
      );
      const targetPath =
        task.modality === "image"
          ? "/image-studio"
          : task.modality === "video"
            ? "/video-studio"
            : task.modality === "audio" || task.modality === "voice"
              ? "/pro-studio"
            : "/studio";
      navigate(targetPath);
      toast.success(
        `已發送「${task.labelZh}」到工作室（${selectedModels[task.modality]}）`
      );
    },
    [selectedModels, segment, navigate]
  );

  const handleGenerateAll = useCallback(() => {
    const activeTasks = tasks.filter(t => t.enabled && t.prompt.trim());
    if (activeTasks.length === 0) {
      toast.error("沒有可生成的任務");
      return;
    }

    // Pack all tasks for studio
    const batch = activeTasks.map(t => ({
      prompt: t.prompt,
      generationType: t.modality,
      overrideEngine: selectedModels[t.modality],
      musicStyle: t.modality === "audio" ? t.prompt : undefined,
      audioScript: t.modality === "voice" ? t.prompt : undefined,
    }));

    sessionStorage.setItem(
      "sendToStudio",
      JSON.stringify({
        prompt: activeTasks[0].prompt,
        generationType: activeTasks[0].modality,
        overrideEngine: selectedModels[activeTasks[0].modality],
        source: "director_ai",
        sceneName: segment.storyboard.sceneHeading,
        musicStyle: activeTasks.find(t => t.modality === "audio")?.prompt,
        audioScript: activeTasks.find(t => t.modality === "voice")?.prompt,
        batchTasks: batch,
        segmentContext: {
          sceneHeading: segment.storyboard.sceneHeading,
          mood: segment.storyboard.mood,
          duration: segment.storyboard.duration,
        },
      })
    );
    const onlyImage = activeTasks.every(t => t.modality === "image");
    const onlyVideo = activeTasks.every(t => t.modality === "video");
    const onlyAudioFamily = activeTasks.every(
      t => t.modality === "audio" || t.modality === "voice"
    );
    navigate(
      onlyImage
        ? "/image-studio"
        : onlyVideo
          ? "/video-studio"
          : onlyAudioFamily
            ? "/pro-studio"
            : "/studio"
    );
    toast.success(`已發送 ${activeTasks.length} 個任務到工作室`);
  }, [tasks, selectedModels, segment, navigate]);

  const enabledCount = tasks.filter(t => t.enabled && t.prompt.trim()).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          快速生成管道
        </h4>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scene context */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-2.5 py-1.5">
        <Clapperboard className="w-3 h-3 shrink-0" />
        <span className="truncate">
          #{segment.index + 1} {segment.storyboard.sceneHeading} ·{" "}
          {segment.storyboard.mood} · {segment.storyboard.duration}
        </span>
        {!segment.costar && (
          <Badge
            variant="outline"
            className="text-[8px] h-4 px-1 shrink-0 text-amber-600 border-amber-300"
          >
            建議先生成 CO-STAR
          </Badge>
        )}
      </div>

      {/* Generation tasks */}
      <div className="space-y-2.5">
        {tasks.map(task => {
          const TaskIcon = task.icon;
          const models = modelOptions[task.modality] ?? [];
          const selectedModel = models.find(
            m => m.modelId === selectedModels[task.modality]
          );
          const hasPrompt = !!task.prompt.trim();

          return (
            <div
              key={task.modality}
              className={cn(
                "rounded-xl border p-3 transition-all",
                task.enabled
                  ? "border-border/50 bg-white/40"
                  : "border-transparent bg-muted/10 opacity-50"
              )}
            >
              {/* Task header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setEnabledTasks(prev => ({
                        ...prev,
                        [task.modality]: !prev[task.modality],
                      }))
                    }
                    className={cn(
                      "w-5 h-5 rounded-md border flex items-center justify-center transition-all",
                      task.enabled
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border/50 bg-white/30"
                    )}
                  >
                    {task.enabled && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                  <TaskIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">{task.labelZh}</span>
                  {!hasPrompt && task.enabled && (
                    <span className="text-[9px] text-red-400">缺少內容</span>
                  )}
                </div>
                {task.enabled && selectedModel && (
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      TIER_COLORS[selectedModel.tier] ?? "text-muted-foreground"
                    )}
                  >
                    {selectedModel.basePoints} pts
                  </span>
                )}
              </div>

              {task.enabled && (
                <>
                  {/* Prompt preview */}
                  {hasPrompt && (
                    <div className="text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-2.5 py-1.5 mb-2 line-clamp-2 leading-relaxed">
                      {task.prompt}
                    </div>
                  )}

                  {/* Model selector */}
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      選擇模型
                    </Label>
                    {modelsQuery.isLoading ? (
                      <div className="text-[10px] text-muted-foreground animate-pulse">
                        載入模型中...
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {models.map(m => {
                          const isSelected =
                            selectedModels[task.modality] === m.modelId;
                          const isBrainDefault =
                            brainDefaults[task.modality] === m.modelId;
                          const coaching = getModelCoaching(task.modality, m);
                          return (
                            <button
                              key={m.modelId}
                              onClick={() =>
                                setSelectedModels(prev => ({
                                  ...prev,
                                  [task.modality]: m.modelId,
                                }))
                              }
                              disabled={!m.available}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all",
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : m.available
                                    ? "bg-white/50 border-border/40 hover:bg-white/80 text-muted-foreground hover:text-foreground"
                                    : "bg-muted/20 border-border/20 text-muted-foreground/40 cursor-not-allowed line-through"
                              )}
                              title={`${m.label} · ${coaching.bestFor} · ${m.basePoints} pts/${m.unit}${!m.available ? " (不可用)" : ""}${isBrainDefault ? " · 你的 AI 大腦組態預設" : ""}`}
                            >
                              {isBrainDefault && (
                                <span aria-label="AI 大腦組態預設">🧠</span>
                              )}
                              <span>{m.label}</span>
                              <span
                                className={cn(
                                  "text-[9px]",
                                  TIER_COLORS[m.tier] ?? ""
                                )}
                              >
                                {m.basePoints}pt
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {selectedModel && (
                      <div className="rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2 mt-2">
                        {(() => {
                          const coaching = getModelCoaching(
                            task.modality,
                            selectedModel
                          );
                          return (
                            <>
                              <p className="text-[10px] font-medium text-foreground">
                                適合：{coaching.bestFor}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                                建議：{coaching.tip}
                              </p>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {coaching.advantages.map(adv => (
                                  <span
                                    key={adv}
                                    className="text-[9px] rounded-full border border-primary/20 bg-white/70 px-1.5 py-0.5 text-primary/80"
                                  >
                                    {adv}
                                  </span>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Single task generate button */}
                  {hasPrompt && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 rounded-lg text-[10px] h-7 gap-1 w-full"
                      onClick={() => handleGenerate(task)}
                      disabled={!selectedModels[task.modality]}
                    >
                      <Play className="w-3 h-3" />
                      單獨生成 {task.labelZh}
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: total cost + batch generate */}
      <div className="flex items-center justify-between pt-2 border-t border-border/30">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium">{enabledCount}</span> 個任務 · 預估{" "}
          <span className="font-semibold text-foreground">{totalCost}</span> pts
        </div>
        <Button
          size="sm"
          className="rounded-xl gap-1.5 text-xs"
          onClick={handleGenerateAll}
          disabled={enabledCount === 0}
        >
          <Zap className="w-3.5 h-3.5" />
          一鍵生成全部
        </Button>
      </div>
    </div>
  );
});

// ─── Generation Progress Panel ──────────────────────────────────────────────
//
// 跟著 autoGenerateFromSegments 的任務一起出現的「批次生成進度面板」：
//   - 每個任務一行（GenerationTaskRow），自帶 trpc.director.pollGenerationTask
//     輪詢（refetchInterval = 3s）
//   - 任務完成時，把 resultUrl 上拋給父層；父層 useEffect 偵測到 image 任務完成
//     後會自動觸發對應的 i2v video 任務（透過 executeTaskMut）
//   - 失敗時顯示錯誤訊息，使用者可重試

type DirectorGenTaskRow = {
  segmentId: string;
  segmentIndex: number;
  modality: "image" | "video" | "audio" | "voice" | "sfx";
  modelId: string;
  prompt: string;
  voiceText?: string;
  params: Record<string, unknown>;
  estimatedPoints: number;
  dependsOn?: { segmentId: string; modality: string };
  jobId?: number;
  requestId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  resultUrl?: string | null;
  errorMessage?: string | null;
};

const MODALITY_BADGES: Record<
  DirectorGenTaskRow["modality"],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  image: { label: "圖像", icon: Image, color: "bg-blue-100 text-blue-700" },
  video: { label: "影片", icon: Camera, color: "bg-purple-100 text-purple-700" },
  audio: { label: "音樂", icon: Music, color: "bg-amber-100 text-amber-700" },
  voice: { label: "語音", icon: Mic, color: "bg-emerald-100 text-emerald-700" },
  sfx: { label: "音效", icon: Volume2, color: "bg-pink-100 text-pink-700" },
};

const GenerationTaskRow = memo(function GenerationTaskRow({
  task,
  onUpdate,
  onRetry,
}: {
  task: DirectorGenTaskRow;
  onUpdate: (
    segmentId: string,
    modality: DirectorGenTaskRow["modality"],
    patch: Partial<DirectorGenTaskRow>
  ) => void;
  onRetry?: (
    segmentId: string,
    modality: DirectorGenTaskRow["modality"]
  ) => void;
}) {
  const isPolling =
    task.status === "processing" && typeof task.jobId === "number";
  const pollQuery = trpc.director.pollGenerationTask.useQuery(
    { jobId: task.jobId ?? 0 },
    {
      enabled: isPolling,
      refetchInterval: isPolling ? 3000 : false,
      retry: 1,
    }
  );

  // 把輪詢結果同步回 state — onUpdate 被父層 useCallback 包起來，
  // 才能避免每輪輪詢觸發無限 setState 迴圈。
  useEffect(() => {
    const data = pollQuery.data;
    if (!data) return;
    if (data.status === "COMPLETED") {
      onUpdate(task.segmentId, task.modality, {
        status: "completed",
        resultUrl: data.resultUrl ?? null,
      });
    } else if (data.status === "FAILED") {
      onUpdate(task.segmentId, task.modality, {
        status: "failed",
        errorMessage: data.errorMessage ?? "fal.ai 回報任務失敗",
      });
    }
  }, [pollQuery.data, task.segmentId, task.modality, onUpdate]);

  const badge = MODALITY_BADGES[task.modality];
  const Icon = badge.icon;
  const statusLabel =
    task.status === "pending"
      ? task.dependsOn
        ? "等待上游"
        : "排隊中"
      : task.status === "processing"
        ? "生成中..."
        : task.status === "completed"
          ? "已完成"
          : "失敗";
  const statusColor =
    task.status === "completed"
      ? "text-emerald-600"
      : task.status === "failed"
        ? "text-rose-600"
        : task.status === "processing"
          ? "text-blue-600"
          : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-white/60 border border-border/40 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-medium shrink-0",
          badge.color
        )}
      >
        <Icon className="w-3 h-3" />
        {badge.label}
      </span>
      <span className="font-semibold text-muted-foreground shrink-0">
        #{task.segmentIndex + 1}
      </span>
      <span className="flex-1 truncate text-muted-foreground">
        {task.prompt.slice(0, 60) || "(無提示詞)"}
      </span>
      {task.status === "processing" && (
        <div className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin shrink-0" />
      )}
      {task.status === "completed" && task.resultUrl && (
        <a
          href={task.resultUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-emerald-700 hover:underline shrink-0"
        >
          查看成品
        </a>
      )}
      {task.status === "failed" && onRetry && (
        <button
          type="button"
          onClick={() => onRetry(task.segmentId, task.modality)}
          title={task.errorMessage ?? "重試"}
          className="text-[10px] font-medium text-rose-700 hover:text-rose-900 underline-offset-2 hover:underline shrink-0"
        >
          重試
        </button>
      )}
      <span className={cn("text-[10px] font-medium shrink-0", statusColor)}>
        {statusLabel}
      </span>
    </div>
  );
});

const GenerationProgressPanel = memo(function GenerationProgressPanel({
  tasks,
  onUpdate,
  onClear,
  onRetry,
}: {
  tasks: DirectorGenTaskRow[];
  onUpdate: (
    segmentId: string,
    modality: DirectorGenTaskRow["modality"],
    patch: Partial<DirectorGenTaskRow>
  ) => void;
  onClear: () => void;
  onRetry?: (
    segmentId: string,
    modality: DirectorGenTaskRow["modality"]
  ) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = tasks.filter(t => t.status === "completed").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  const processing = tasks.filter(t => t.status === "processing").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const allDone =
    tasks.length > 0 && completed + failed === tasks.length;

  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(420px,calc(100vw-2rem))] rounded-xl border border-border/50 bg-white/95 backdrop-blur-sm shadow-2xl">
      <div className="flex items-center gap-2 p-3 border-b border-border/40">
        <Zap className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-semibold">批次生成進度</span>
        <span className="text-[10px] text-muted-foreground">
          {completed}/{tasks.length} 完成
          {processing > 0 ? ` · ${processing} 進行中` : ""}
          {pending > 0 ? ` · ${pending} 等待中` : ""}
          {failed > 0 ? ` · ${failed} 失敗` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1 rounded hover:bg-muted/40"
            title={collapsed ? "展開" : "收合"}
          >
            {collapsed ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {allDone && (
            <button
              onClick={onClear}
              className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
              title="關閉面板"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <ScrollArea className="max-h-[40vh]">
          <div className="p-2 space-y-1.5">
            {tasks.map(t => (
              <GenerationTaskRow
                key={`${t.segmentId}-${t.modality}`}
                task={t}
                onUpdate={onUpdate}
                onRetry={onRetry}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
});

// ─── Export Panel ────────────────────────────────────────────────────────────

const ExportPanel = memo(function ExportPanel({
  segments,
  onClose,
}: {
  segments: ScriptSegment[];
  onClose: () => void;
}) {
  const [selectedFormat, setSelectedFormat] = useState("markdown");
  const [includeDiscussion, setIncludeDiscussion] = useState(false);
  const [includeCostar, setIncludeCostar] = useState(false);
  const [customTemplate, setCustomTemplate] = useState(
    "【分鏡 {{index}}】{{sceneHeading}}\n視覺：{{visualDescription}}\n對白：{{dialogue}}\n鏡頭：{{cameraDirection}}\n時長：{{duration}}"
  );
  const [customColumns, setCustomColumns] = useState([
    { header: "序號", field: "index" },
    { header: "場景", field: "sceneHeading" },
    { header: "視覺描述", field: "visualDescription" },
    { header: "對白", field: "dialogue" },
    { header: "鏡頭", field: "cameraDirection" },
    { header: "時長", field: "duration" },
    { header: "氛圍", field: "mood" },
  ]);

  const exportMut = trpc.director.exportScript.useMutation({
    onSuccess: data => {
      const fmtInfo = EXPORT_FORMATS.find(f => f.value === data.format);
      const ext = fmtInfo?.ext ?? ".txt";
      const blob = new Blob([data.content], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `script-export${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`已匯出為 ${fmtInfo?.label ?? data.format} 格式`);
    },
    onError: e => toast.error("匯出失敗：" + e.message),
  });

  const handleExport = useCallback(() => {
    exportMut.mutate({
      segments,
      format: selectedFormat as
        | "json"
        | "csv"
        | "markdown"
        | "fdx"
        | "srt"
        | "custom",
      includeDiscussion,
      includeCostar,
      ...(selectedFormat === "custom" ? { customTemplate } : {}),
      ...(selectedFormat === "csv" ? { customColumns } : {}),
    });
  }, [
    segments,
    selectedFormat,
    includeDiscussion,
    includeCostar,
    customTemplate,
    customColumns,
    exportMut,
  ]);

  return (
    <GlassCard hover={false} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="hs-h3 !mb-0 flex items-center gap-2">
          <Download className="w-4 h-4" />
          匯出腳本
        </h3>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Format selector */}
      <div className="space-y-1.5">
        <Label className="text-xs">匯出格式</Label>
        <div className="flex flex-wrap gap-1.5">
          {EXPORT_FORMATS.map(fmt => (
            <button
              key={fmt.value}
              onClick={() => setSelectedFormat(fmt.value)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                selectedFormat === fmt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/50 border-border/50 hover:bg-white/80 text-muted-foreground"
              )}
            >
              {fmt.label} ({fmt.ext})
            </button>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id="inc-discussion"
            checked={includeDiscussion}
            onCheckedChange={setIncludeDiscussion}
          />
          <Label htmlFor="inc-discussion" className="text-xs">
            含討論紀錄
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="inc-costar"
            checked={includeCostar}
            onCheckedChange={setIncludeCostar}
          />
          <Label htmlFor="inc-costar" className="text-xs">
            含 CO-STAR
          </Label>
        </div>
      </div>

      {/* Custom template editor */}
      {selectedFormat === "custom" && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            自訂模板（可用變數：
            {
              "{{index}}, {{sceneHeading}}, {{visualDescription}}, {{dialogue}}, {{soundDesign}}, {{cameraDirection}}, {{duration}}, {{mood}}"
            }
            ）
          </Label>
          <Textarea
            value={customTemplate}
            onChange={e => setCustomTemplate(e.target.value)}
            className="text-xs min-h-[100px] bg-white/50"
          />
        </div>
      )}

      {/* Custom CSV columns editor */}
      {selectedFormat === "csv" && (
        <div className="space-y-1.5">
          <Label className="text-xs">自訂欄位（CSV 表頭 → 資料欄位）</Label>
          <div className="space-y-1">
            {customColumns.map((col, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={col.header}
                  onChange={e => {
                    const next = [...customColumns];
                    next[i] = { ...next[i], header: e.target.value };
                    setCustomColumns(next);
                  }}
                  className="flex-1 rounded border border-border/50 px-2 py-1 text-[11px] bg-white/50"
                  placeholder="表頭名稱"
                />
                <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={col.field}
                  onChange={e => {
                    const next = [...customColumns];
                    next[i] = { ...next[i], field: e.target.value };
                    setCustomColumns(next);
                  }}
                  className="flex-1 rounded border border-border/50 px-2 py-1 text-[11px] bg-white/50"
                  placeholder="欄位名（如 sceneHeading）"
                />
                <button
                  onClick={() =>
                    setCustomColumns(customColumns.filter((_, j) => j !== i))
                  }
                  className="text-muted-foreground hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setCustomColumns([...customColumns, { header: "", field: "" }])
              }
              className="text-[10px] text-primary hover:underline"
            >
              + 新增欄位
            </button>
          </div>
        </div>
      )}

      <Button
        onClick={handleExport}
        disabled={exportMut.isPending}
        className="w-full rounded-xl gap-2"
      >
        <Download className="w-4 h-4" />
        {exportMut.isPending ? "匯出中..." : "匯出"}
      </Button>
    </GlassCard>
  );
});

// ─── Proactive Question Bubble (memoized) ──────────────────────────────────

const ProactiveQuestionBubble = memo(function ProactiveQuestionBubble({
  question,
  intentCard,
  personality,
  onDismiss,
  onUse,
}: {
  question: string;
  intentCard?: {
    intent: string;
    whyAsk: string;
    options: string[];
  } | null;
  personality: Personality;
  onDismiss: () => void;
  onUse: (q: string) => void;
}) {
  const config =
    PERSONALITIES.find(p => p.id === personality) ?? PERSONALITIES[1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={cn("rounded-xl p-3.5 border shadow-sm", config.bgActive)}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br text-white",
            config.color
          )}
        >
          <MessageCircleQuestion className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider",
              config.textColor
            )}
          >
            導演主動提問
          </span>
          {intentCard?.intent ? (
            <div className="mt-1 rounded-md border border-current/15 bg-white/60 p-2">
              <p className="text-[11px] font-medium">意圖：{intentCard.intent}</p>
              <p className="text-[10px] text-foreground/70 mt-0.5">
                為何先問：{intentCard.whyAsk}
              </p>
              {intentCard.options?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {intentCard.options.map(opt => (
                    <button
                      key={opt}
                      onClick={() => onUse(opt)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-current/20 hover:bg-white/70"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <p className="hs-small !mb-0 text-foreground/80 mt-1">{question}</p>
          <button
            onClick={() => onUse(question)}
            className={cn(
              "mt-2 text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors",
              "hover:bg-white/60 border-current/20",
              config.textColor
            )}
          >
            用這個問題繼續對話 →
          </button>
        </div>
        <button
          onClick={onDismiss}
          className="text-muted-foreground/50 hover:text-muted-foreground text-xs shrink-0"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
});

// ─── Script Card (memoized) ────────────────────────────────────────────────

const ScriptCard = memo(function ScriptCard({
  script,
  index,
  onSendToStudio,
  onRefine,
  onCopy,
  isRefining,
}: {
  script: CoStarScript;
  index: number;
  onSendToStudio: (s: CoStarScript) => void;
  onRefine: (s: CoStarScript, idx: number) => void;
  onCopy: (s: CoStarScript) => void;
  isRefining: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          腳本 #{index + 1}
          {expanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg text-xs h-7 px-2"
            onClick={() => onCopy(script)}
            title="複製腳本"
          >
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-lg text-xs h-7 px-2"
            onClick={() => onRefine(script, index)}
            disabled={isRefining}
            title="微調腳本"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            size="sm"
            className="rounded-lg gap-1 text-xs h-7"
            onClick={() => onSendToStudio(script)}
          >
            <Send className="w-3 h-3" />
            發送到工作室
          </Button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* CO-STAR Summary */}
            <div className="space-y-1.5">
              {[
                { label: "背景", value: script.context },
                { label: "情境", value: script.situation },
                { label: "任務", value: script.task },
                { label: "行動", value: script.action },
                { label: "結果", value: script.result },
              ].map(item => (
                <div key={item.label} className="flex gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground w-8 shrink-0">
                    {item.label}
                  </span>
                  <span className="text-xs text-foreground leading-relaxed">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Visual prompt preview */}
            {script.visualPrompt && (
              <div className="mt-2 p-2 rounded-lg bg-muted/30 border border-border/30">
                <span className="text-[10px] font-medium text-muted-foreground block mb-1">
                  Visual Prompt
                </span>
                <p className="hs-small !mb-0 text-foreground/70 line-clamp-3">
                  {script.visualPrompt}
                </p>
              </div>
            )}

            {/* Dispatch Targets */}
            <div className="flex gap-2 pt-2 mt-2 border-t border-border/30">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                <Image className="w-3 h-3" /> Veo 2.0
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                <Music className="w-3 h-3" /> Suno V4
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/30 px-2 py-1 rounded-md">
                <Mic className="w-3 h-3" /> ElevenLabs
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ─── Per-personality system prompts ─────────────────────────────────────────

const PERSONALITY_SYSTEM_PROMPTS: Record<Personality, string> = {
  calm: `你是「導演 AI」（沉穩型），一位注重邏輯、結構與可行性分析的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供有條理、有依據的建議，著重可執行性與結構完整性。`,
  creative: `你是「導演 AI」（創意型），一位充滿熱情、重視氛圍與視覺衝擊力的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供富有想像力、充滿情緒感染力的建議，著重視覺美感與情感共鳴。`,
  technical: `你是「導演 AI」（技術型），一位精通參數與技術最佳實踐的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供精確、專業的技術建議，著重參數設定、工作流程與最佳化策略。`,
};

// ─── Main Component ────────────────────────────────────────────────────────

export default function DirectorAI() {
  const isMobile = useIsMobile();

  // 全站新手引導
  usePageTour("director");
  const { openDrawer: openAssetsDrawer } = useAssetsDrawer();
  const [, navigate] = useLocation();
  const {
    setAIState,
    personality: globalPersonality,
    setPersonality: setGlobalPersonality,
  } = useAIState();
  const [personality, setPersonality] =
    useState<Personality>(globalPersonality);

  // ─── Preferences persistence (DB) ─────────────────────────────────────────
  const prefsQuery = trpc.director.preferences.get.useQuery(undefined, {
    retry: false,
  });
  const updatePrefs = trpc.director.preferences.update.useMutation({
    onSuccess: () => prefsQuery.refetch(),
    onError: err => toast.error(`偏好儲存失敗：${err.message}`),
  });
  const [preferredFormat, setPreferredFormat] = useState<
    "co-star" | "sslcm" | "selcm" | "free"
  >("co-star");

  // Sync DB → local state on first load
  useEffect(() => {
    if (prefsQuery.data) {
      const dbPersonality =
        (prefsQuery.data.personality as Personality) || "creative";
      setPersonality(dbPersonality);
      setGlobalPersonality(dbPersonality);
      setPreferredFormat(
        (prefsQuery.data.preferredFormat as typeof preferredFormat) || "co-star"
      );
    }
  }, [prefsQuery.data, setGlobalPersonality]);

  // ── 接收 ImageStudio / VideoStudio / ProStudio 回填 ──
  // 進場時先把 payload 暫存，等使用者載入腳本（importedSegments 就緒）
  // 後再依 sceneName 比對，徵詢確認並回填 costar + notes。
  type DirectorReturnPayload = {
    source?: "image_studio" | "video_studio" | "pro_studio" | string;
    sceneName?: string;
    finalPrompt?: string;
    modelId?: string;
    resultUrl?: string | null;
  };
  const [pendingStudioReturn, setPendingStudioReturn] =
    useState<DirectorReturnPayload | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("directorReturn");
      if (!raw) return;
      sessionStorage.removeItem("directorReturn");
      const data = JSON.parse(raw) as DirectorReturnPayload;
      const isStudioSource =
        data.source === "image_studio" ||
        data.source === "video_studio" ||
        data.source === "pro_studio";
      if (!isStudioSource || !data.sceneName) return;
      setPendingStudioReturn(data);
    } catch {
      // silent
    }
  }, []);

  // ── 接收光球代理（/agent）的對話脈絡 ──
  // 光球提示「我帶你過去導演 AI」後，會把最後一輪的 userIntent + 最近幾段
  // 對話塞進 sessionStorage["directorHandoff"]。我們在這裡讀出來，稍後用
  // 來：(1) 在聊天頂端注入一段 assistant 開場，承接話題；(2) 把使用者最後
  // 一句話預填到輸入框，按 Enter 就能繼續；(3) 顯示一張「從光球延續討論」
  // 的小卡，預覽剛剛聊了什麼，並提供「先從三個方向開始」一鍵動作。
  //
  // sessionStorage 必須只讀一次（讀完即清），但兩個 useState 初始化器都需
  // 要這份 payload。先用 ref 抓一次、暫存，兩個 lazy initialiser 都從同一
  // 份 ref 讀，避免第二個 useState 拿到 null 然後在第一個 render 就把開場
  // 訊息漏掉。
  const handoffOnMountRef = useRef<DirectorHandoffPayload | null | undefined>(
    undefined,
  );
  if (handoffOnMountRef.current === undefined) {
    handoffOnMountRef.current = readAndClearDirectorHandoff();
  }
  const initialHandoff = handoffOnMountRef.current;

  const [agentHandoff, setAgentHandoff] = useState<DirectorHandoffPayload | null>(
    initialHandoff,
  );
  const [showHandoffDetails, setShowHandoffDetails] = useState(false);

  const buildHandoffOpening = useCallback(
    (payload: DirectorHandoffPayload): string => {
      const topic = payload.topic?.trim();
      const preview = topic ? `「${topic}」` : "你剛剛分享的構想";
      return [
        `🌿 我從光球那裡接到你${preview}。`,
        "",
        "我們可以這樣往下走：",
        "1. 我先給你 **三個方向**，挑一個最接近的我們再展開。",
        "2. 直接從你最想做的那一段開始，我陪你逐段拆。",
        "3. 把剛剛那段話整理成 **腳本大綱 / 分鏡** 給你過目。",
        "",
        "想先從哪一條開始？或者直接告訴我下一步，我來接手 ✨",
      ].join("\n");
    },
    [],
  );

  const handoffOpening = useMemo(
    () => (agentHandoff ? buildHandoffOpening(agentHandoff) : null),
    [agentHandoff, buildHandoffOpening],
  );

  const [messages, setMessages] = useState<Message[]>(() => {
    const baseSystem: Message = {
      role: "system",
      content:
        PERSONALITY_SYSTEM_PROMPTS[globalPersonality] ??
        PERSONALITY_SYSTEM_PROMPTS.creative,
    };
    if (!initialHandoff) return [baseSystem];
    return [
      baseSystem,
      { role: "assistant", content: buildHandoffOpening(initialHandoff) },
    ];
  });

  // Belt-and-braces: if `agentHandoff` is set later (e.g. HMR replays mount)
  // but the message wasn't already injected, add it now. De-duped against
  // existing content so it never doubles up.
  useEffect(() => {
    if (!handoffOpening) return;
    setMessages(prev => {
      const alreadyInjected = prev.some(
        m => m.role === "assistant" && m.content === handoffOpening,
      );
      if (alreadyInjected) return prev;
      const nonSystem = prev.filter(m => m.role !== "system");
      const system = prev.find(m => m.role === "system");
      return [
        ...(system ? [system] : []),
        { role: "assistant", content: handoffOpening },
        ...nonSystem,
      ];
    });
  }, [handoffOpening]);

  // When personality changes, update the system prompt
  useEffect(() => {
    setMessages(prev => {
      const nonSystem = prev.filter(m => m.role !== "system");
      return [
        {
          role: "system",
          content:
            PERSONALITY_SYSTEM_PROMPTS[personality] ??
            PERSONALITY_SYSTEM_PROMPTS.creative,
        },
        ...nonSystem,
      ];
    });
  }, [personality]);

  const [saveToNotes, setSaveToNotes] = useState(false);
  const [scripts, setScripts] = useState<CoStarScript[]>([]);
  const [showStoryboard, setShowStoryboard] = useState(!isMobile);
  const [proactiveQuestion, setProactiveQuestion] = useState<string | null>(
    null
  );
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [templateGuideOpen, setTemplateGuideOpen] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [refiningIdx, setRefiningIdx] = useState<number | null>(null);

  // ─── Script Analysis State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [importedSegments, setImportedSegments] = useState<ScriptSegment[]>([]);
  const [importedTitle, setImportedTitle] = useState("");
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState<number | null>(
    null
  );
  const [showExport, setShowExport] = useState(false);
  const [scriptOverview, setScriptOverview] = useState<ScriptOverview | null>(
    null
  );
  const [showOverview, setShowOverview] = useState(false);

  // ── Apply ImageStudio / VideoStudio / ProStudio return payload once segments are available ──
  useEffect(() => {
    if (!pendingStudioReturn) return;
    const data = pendingStudioReturn;
    const sceneName = data.sceneName ?? "";
    const isVideo = data.source === "video_studio";
    const isPro = data.source === "pro_studio";
    const sourceLabel = isPro
      ? "音樂配音創作室"
      : isVideo
        ? "影片創作室"
        : "圖片創作室";
    const sourceEmoji = isPro ? "🎵" : isVideo ? "🎬" : "🖼️";
    // ProStudio 的 modelId 是 tab id（music/sfx/tts/clone/...）
    const isVoice =
      isPro && (data.modelId === "tts" || data.modelId === "clone");
    const fillTarget = isPro
      ? isVoice
        ? "audioScript"
        : "musicVibe"
      : "visualPrompt";
    const fillTargetLabel = isPro
      ? isVoice
        ? "audioScript（語音腳本）"
        : "musicVibe（音樂風格）"
      : "visualPrompt";

    // No segments imported yet → keep waiting; if user never imports, fall
    // back to plain toast so the result link is at least surfaced.
    if (importedSegments.length === 0) return;

    const matchIdx = importedSegments.findIndex(
      s => s.storyboard.sceneHeading === sceneName
    );

    if (matchIdx === -1) {
      toast.info(
        `從${sourceLabel}收到「${sceneName}」成品，但目前腳本沒有對應分鏡`,
        {
          description: data.resultUrl ?? undefined,
          duration: 12_000,
        }
      );
      setPendingStudioReturn(null);
      return;
    }

    const ok = window.confirm(
      `導演 AI 收到${sourceLabel}的成品。\n要把 prompt / 成品連結回填到場景「${sceneName}」嗎？\n\n（會覆寫該場景的 ${fillTargetLabel}，並把成品連結附加到備註）`
    );
    if (!ok) {
      setPendingStudioReturn(null);
      toast(`已忽略「${sceneName}」的回填`);
      return;
    }

    setImportedSegments(prev =>
      prev.map((s, i) => {
        if (i !== matchIdx) return s;
        const baseCostar: CoStarScript = s.costar ?? {
          context: "",
          situation: "",
          task: "",
          action: "",
          result: "",
          visualPrompt: "",
          audioScript: "",
          musicVibe: "",
        };
        const value = data.finalPrompt ?? baseCostar[fillTarget];
        const newCostar: CoStarScript = {
          ...baseCostar,
          [fillTarget]: value,
        };
        const noteLine = [
          `${sourceEmoji} ${sourceLabel}成品`,
          data.modelId ? `model: ${data.modelId}` : null,
          data.resultUrl ? `url: ${data.resultUrl}` : null,
        ]
          .filter(Boolean)
          .join(" | ");
        const newNotes = s.notes ? `${s.notes}\n${noteLine}` : noteLine;
        return { ...s, costar: newCostar, notes: newNotes };
      })
    );
    setSelectedSegmentIdx(matchIdx);
    setPendingStudioReturn(null);
    toast.success(`已回填到場景「${sceneName}」`, {
      description: data.resultUrl ?? undefined,
      duration: 8_000,
    });
  }, [pendingStudioReturn, importedSegments]);

  // ─── Planning Mode State ────────────────────────────────────────────────
  const [planningSession, setPlanningSession] =
    useState<ScriptPlanningSession | null>(null);
  const [planningPhase, setPlanningPhase] = useState<PlanningPhase>("concept");
  const [planningInput, setPlanningInput] = useState("");
  const [showPlanningSessions, setShowPlanningSessions] = useState(false);
  // 已儲存的 planning note id：第一次儲存後設置，之後 auto-save 走 update
  const [currentPlanningId, setCurrentPlanningId] = useState<number | null>(
    null
  );
  // 規劃模式的反問氣泡（來自 planningDiscuss 結構化欄位）
  const [planningProactiveQuestion, setPlanningProactiveQuestion] =
    useState<string | null>(null);
  const [planningIntentCard, setPlanningIntentCard] = useState<{
    intent: string;
    whyAsk: string;
    options: string[];
  } | null>(null);
  // 「繼續上次規劃」橫幅
  const [resumePlanningCandidate, setResumePlanningCandidate] = useState<{
    id: number;
    title: string;
    updatedAt: Date | string;
  } | null>(null);
  // 規劃模式內的「貼上腳本」面板開關 + 草稿內容
  const [showPlanningPaste, setShowPlanningPaste] = useState(false);
  const [planningPasteContent, setPlanningPasteContent] = useState("");
  const [planningPasteTitle, setPlanningPasteTitle] = useState("");
  const [planningPasteFormat, setPlanningPasteFormat] = useState("plaintext");
  // 確保 localStorage 草稿只在掛載時還原一次
  const planningDraftRestoredRef = useRef(false);

  // ─── Batch Generation State ─────────────────────────────────────────────
  const [showBatchGeneration, setShowBatchGeneration] = useState(false);
  const [batchGenerationOptions, setBatchGenerationOptions] = useState({
    modalities: ["image"] as Array<"image" | "video" | "audio" | "voice" | "sfx">,
    imageSettings: { aspectRatio: "16:9", negativePrompt: "" },
    videoSettings: { useImageAsFirstFrame: false },
    audioSettings: { isInstrumental: true },
    voiceSettings: { voiceSpeed: 1.0, voiceStability: 0.5 },
    mode: "lightning" as "lightning" | "deep_precision",
  });
  // 每個任務的完整定義 + 執行狀態 — 必須在前端持久化（保留 modelId、prompt、
  // params、dependsOn 等）才能：
  //   1. 顯示生成進度面板（modality、progress、resultUrl）
  //   2. 在上游 image 任務完成後自動觸發 dependent video（i2v）
  //   3. 失敗時提供使用者重試入口
  // 使用模組層 DirectorGenTaskRow 作為共用形狀，避免父層／面板／列三處重複定義。
  const [generationTasks, setGenerationTasks] = useState<DirectorGenTaskRow[]>(
    []
  );

  // ─── tRPC hooks ──────────────────────────────────────────────────────────

  const templatesQuery = trpc.director.templates.useQuery(undefined, {
    staleTime: Infinity,
  });
  const filteredTemplates = useMemo(() => {
    const list = templatesQuery.data ?? [];
    const q = templateKeyword.trim().toLowerCase();
    if (!q) return list;
    return list.filter(t =>
      `${t.label} ${t.description ?? ""} ${t.category ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [templatesQuery.data, templateKeyword]);
  const sessionsQuery = trpc.director.listSessions.useQuery(undefined, {
    enabled: showSessions,
  });
  const saveSessionMut = trpc.director.saveSession.useMutation({
    onSuccess: () => {
      toast.success("對話已儲存");
      sessionsQuery.refetch();
    },
    onError: e => toast.error("儲存失敗：" + e.message),
  });
  const deleteSessionMut = trpc.director.deleteSession.useMutation({
    onSuccess: () => sessionsQuery.refetch(),
  });

  // Script analysis hooks
  const quickActionsQuery = trpc.director.quickActions.useQuery(undefined, {
    staleTime: Infinity,
    enabled: activeTab === "script",
  });
  const importScriptMut = trpc.director.importScript.useMutation({
    onSuccess: data => {
      setImportedSegments(data.segments);
      setImportedTitle(data.title);
      if (data.segments.length > 0) {
        setSelectedSegmentIdx(0);
      }
      toast.success(
        `已匯入「${data.title}」— 分析出 ${data.segments.length} 個分鏡段落`
      );
    },
    onError: e => toast.error("匯入失敗：" + e.message),
  });

  // CO-STAR generation for individual segments
  const generateCostarMut = trpc.director.generateSegmentCostar.useMutation({
    onSuccess: (data, vars) => {
      setImportedSegments(prev =>
        prev.map(s =>
          s.id === vars.segment.id ? { ...s, costar: data as CoStarScript } : s
        )
      );
      toast.success("CO-STAR 已生成");
    },
    onError: e => toast.error("CO-STAR 生成失敗：" + e.message),
  });

  // Batch CO-STAR generation
  const batchCostarMut = trpc.director.batchGenerateCostar.useMutation({
    onSuccess: data => {
      const results = data.results ?? {};
      setImportedSegments(prev =>
        prev.map(s => {
          const entry = results[s.id];
          if (!entry || typeof entry !== "object" || !("context" in entry))
            return s;
          return { ...s, costar: entry as unknown as CoStarScript };
        })
      );
      const count = Object.keys(results).length;
      toast.success(`已批次生成 ${count} 個 CO-STAR`);
    },
    onError: e => toast.error("批次生成失敗：" + e.message),
  });

  // Script overview analysis
  const overviewMut = trpc.director.analyzeScriptOverview.useMutation({
    onSuccess: data => {
      setScriptOverview(data as ScriptOverview);
      setShowOverview(true);
      toast.success("腳本全局分析完成");
    },
    onError: e => toast.error("分析失敗：" + e.message),
  });

  // ─── Planning Mode Hooks ────────────────────────────────────────────────
  const planningDiscussMut = trpc.director.planningDiscuss.useMutation({
    onSuccess: data => {
      if (!planningSession) return;
      const aiMsg: PlanningMessage = {
        role: "assistant",
        content: data.reply,
        timestamp: new Date().toISOString(),
        phase: planningPhase,
      };
      setPlanningSession(prev => {
        if (!prev) return prev;
        const updated = { ...prev, updatedAt: new Date().toISOString() };
        updated.phases = updated.phases.map(p =>
          p.phase === planningPhase
            ? {
                ...p,
                status: "in-progress" as const,
                discussion: [...p.discussion, aiMsg],
                summary: data.phaseSummary ?? p.summary,
              }
            : p
        );
        // Try to extract structured data from phaseSummary
        if (data.phaseSummary) {
          try {
            const parsed = JSON.parse(data.phaseSummary);
            if (planningPhase === "concept" && parsed.theme) {
              updated.concept = parsed;
            } else if (planningPhase === "outline" && parsed.synopsis) {
              updated.outline = parsed;
            } else if (
              planningPhase === "scene-planning" &&
              Array.isArray(parsed.scenes)
            ) {
              updated.scenes = parsed.scenes;
            }
          } catch {
            // Not structured — just text summary
          }
        }
        return updated;
      });
      // 規劃模式的反問：把結構化的 proactiveQuestion 推給氣泡顯示
      if (data.proactiveQuestion?.trim()) {
        setPlanningProactiveQuestion(data.proactiveQuestion.trim());
      }
      setPlanningIntentCard(data.intentCard ?? null);
    },
    onError: e => toast.error("規劃討論失敗：" + e.message),
  });

  const planningDepthMut = trpc.director.planningAnalyzeDepth.useMutation({
    onSuccess: data => {
      setPlanningSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          emotionalBeats: data.emotionalBeats as EmotionalBeat[],
          warmthScore: data.warmthScore,
          depthAnalysis: data.depthAnalysis,
          updatedAt: new Date().toISOString(),
        };
      });
      toast.success("情感深度分析完成 🌿");
    },
    onError: e => toast.error("分析失敗：" + e.message),
  });

  const savePlanningMut = trpc.director.savePlanningSession.useMutation({
    onSuccess: data => {
      // 第一次儲存記住 id，之後 auto-save 都走 update（不會產生重複 note）
      if (typeof data?.id === "number") {
        setCurrentPlanningId(data.id);
      }
      planningSessionsQuery.refetch();
    },
    onError: e => toast.error("儲存失敗：" + e.message),
  });

  const planningSessionsQuery = trpc.director.listPlanningSessions.useQuery(
    undefined,
    { enabled: showPlanningSessions }
  );

  // 進站時 query 一次最近的規劃 sessions，若有就提示「繼續上次規劃」
  const recentSessionsQuery = trpc.director.listPlanningSessions.useQuery();
  useEffect(() => {
    if (planningSession || resumePlanningCandidate) return; // 已在工作或已提示過
    const list = recentSessionsQuery.data;
    if (!list || list.length === 0) return;
    const dismissed = (() => {
      try {
        return localStorage.getItem("director-resume-dismissed") === "1";
      } catch {
        return false;
      }
    })();
    if (dismissed) return;
    const sorted = [...list].sort(
      (a, b) =>
        new Date(b.updatedAt ?? b.createdAt).getTime() -
        new Date(a.updatedAt ?? a.createdAt).getTime()
    );
    setResumePlanningCandidate(sorted[0]);
  }, [recentSessionsQuery.data, planningSession, resumePlanningCandidate]);

  // ─── Batch Generation Hooks ─────────────────────────────────────────────
  const autoGenerateMut = trpc.director.autoGenerateFromSegments.useMutation({
    onSuccess: data => {
      toast.success(
        `已規劃 ${data.totalTasks} 個生成任務，預估 ${data.totalPoints} pts`
      );
      setShowBatchGeneration(false);
      // 把完整的任務定義（含 modelId/prompt/params/dependsOn）存入 state，
      // 讓 GenerationProgressPanel 能輪詢狀態 + 在上游 image 完成後自動觸發
      // 對應的 i2v video 任務。
      const tasksWithDef: DirectorGenTaskRow[] = data.tasks.map(t => ({
        segmentId: t.segmentId,
        segmentIndex: t.segmentIndex,
        modality: t.modality as DirectorGenTaskRow["modality"],
        modelId: t.modelId,
        prompt: t.prompt,
        voiceText: t.voiceText,
        params: (t.params ?? {}) as Record<string, unknown>,
        estimatedPoints: t.estimatedPoints,
        dependsOn: t.dependsOn,
        status: "pending" as const,
      }));
      setGenerationTasks(tasksWithDef);

      // Fire independent tasks (image / audio / voice / sfx). Tasks with
      // dependsOn (i2v video relying on a generated image) stay pending —
      // GenerationProgressPanel 的 useEffect 會在上游 image 完成時自動觸發。
      const independent = tasksWithDef.filter(t => !t.dependsOn);
      for (const t of independent) {
        executeTaskMut.mutate({
          segmentId: t.segmentId,
          segmentIndex: t.segmentIndex,
          modality: t.modality,
          modelId: t.modelId,
          prompt: t.prompt,
          voiceText: t.voiceText,
          params: t.params,
          mode: batchGenerationOptions.mode,
        });
      }
      const deferred = tasksWithDef.length - independent.length;
      if (deferred > 0) {
        toast.info(`${deferred} 個 i2v 影片任務將在上游圖像完成後自動觸發`);
      }
    },
    onError: e => toast.error("規劃失敗：" + e.message),
  });

  const executeTaskMut = trpc.director.executeGenerationTask.useMutation({
    onSuccess: data => {
      setGenerationTasks(prev =>
        prev.map(t =>
          t.segmentId === data.segmentId && t.modality === data.modality
            ? {
                ...t,
                jobId: data.jobId,
                requestId: data.requestId,
                status: "processing" as const,
              }
            : t
        )
      );
      toast.success(`${data.label} 已開始生成`);
    },
    onError: (e, vars) => {
      // 把對應任務標記為 failed，前端面板可顯示錯誤並提供重試
      setGenerationTasks(prev =>
        prev.map(t =>
          t.segmentId === vars.segmentId && t.modality === vars.modality
            ? { ...t, status: "failed" as const, errorMessage: e.message }
            : t
        )
      );
      toast.error("執行失敗：" + e.message);
    },
  });

  // GenerationTaskRow 用的 patch handler — 由父層持有，避免子元件重新訂閱輪詢
  const handleGenerationTaskUpdate = useCallback(
    (
      segmentId: string,
      modality: "image" | "video" | "audio" | "voice" | "sfx",
      patch: Partial<DirectorGenTaskRow>
    ) => {
      setGenerationTasks(prev =>
        prev.map(t =>
          t.segmentId === segmentId && t.modality === modality
            ? { ...t, ...patch }
            : t
        )
      );
    },
    []
  );

  const handleClearGenerationTasks = useCallback(() => {
    setGenerationTasks([]);
  }, []);

  // 失敗任務重試 — 從目前 state 取出原始 modelId / prompt / params，
  // 重新觸發 executeGenerationTask。對 i2v 影片任務，從上游已完成的 image
  // 任務取回 resultUrl 當 firstFrameUrl；若上游還沒完成就拒絕重試（避免
  // 在沒有首幀時送出 image-to-video 請求）。
  // 用 ref 持有最新的 generationTasks 快照，避免把 generationTasks 放進 useCallback
  // dependencies 而導致每次任務狀態變動就讓 GenerationProgressPanel/Row 重新訂閱
  // 這個 callback —— 進而觸發 GenerationTaskRow 內部 pollQuery 的重新註冊。
  const generationTasksRef = useRef<DirectorGenTaskRow[]>(generationTasks);
  useEffect(() => {
    generationTasksRef.current = generationTasks;
  }, [generationTasks]);

  const handleRetryGenerationTask = useCallback(
    (
      segmentId: string,
      modality: "image" | "video" | "audio" | "voice" | "sfx"
    ) => {
      const snapshot = generationTasksRef.current;
      const target = snapshot.find(
        t => t.segmentId === segmentId && t.modality === modality
      );
      if (!target || target.status !== "failed") return;

      let firstFrameUrl: string | undefined;
      if (
        target.dependsOn &&
        target.dependsOn.modality === "image" &&
        modality === "video"
      ) {
        const upstream = snapshot.find(
          t =>
            t.segmentId === target.dependsOn!.segmentId &&
            t.modality === "image" &&
            t.status === "completed" &&
            typeof t.resultUrl === "string" &&
            (t.resultUrl as string).length > 0
        );
        if (!upstream) {
          toast.error("無法重試 i2v：上游圖像尚未完成或失敗");
          return;
        }
        firstFrameUrl = upstream.resultUrl as string;
      }

      setGenerationTasks(prev =>
        prev.map(t =>
          t.segmentId === segmentId && t.modality === modality
            ? {
                ...t,
                status: "processing" as const,
                errorMessage: null,
                jobId: undefined,
                requestId: undefined,
              }
            : t
        )
      );

      executeTaskMut.mutate({
        segmentId: target.segmentId,
        segmentIndex: target.segmentIndex,
        modality: target.modality,
        modelId: target.modelId,
        prompt: target.prompt,
        voiceText: target.voiceText,
        params: target.params,
        mode: batchGenerationOptions.mode,
        ...(firstFrameUrl ? { firstFrameUrl } : {}),
      });
    },
    [executeTaskMut, batchGenerationOptions.mode]
  );

  // 自動觸發 i2v 影片任務 — 監聽 generationTasks，當 image 任務完成且 resultUrl
  // 可用時，找出依賴它的 video 任務（dependsOn.modality === "image"）並用
  // resultUrl 當 firstFrameUrl 觸發 executeGenerationTask。
  // 透過樂觀地把 dependent 任務狀態先設為 "processing"，避免 effect 在 mutate
  // 還沒回 onSuccess 前重複觸發。
  useEffect(() => {
    const completedImages = generationTasks.filter(
      t =>
        t.modality === "image" &&
        t.status === "completed" &&
        typeof t.resultUrl === "string" &&
        t.resultUrl.length > 0
    );
    if (completedImages.length === 0) return;

    const fired: Array<{ task: DirectorGenTaskRow; firstFrameUrl: string }> = [];
    for (const upstream of completedImages) {
      const url = upstream.resultUrl;
      if (!url) continue;
      const dependents = generationTasks.filter(
        t =>
          t.status === "pending" &&
          !!t.dependsOn &&
          t.dependsOn.segmentId === upstream.segmentId &&
          t.dependsOn.modality === "image"
      );
      for (const dep of dependents) {
        fired.push({ task: dep, firstFrameUrl: url });
      }
    }
    if (fired.length === 0) return;

    setGenerationTasks(prev =>
      prev.map(t => {
        const isFired = fired.some(
          f =>
            f.task.segmentId === t.segmentId && f.task.modality === t.modality
        );
        return isFired ? { ...t, status: "processing" as const } : t;
      })
    );

    for (const { task, firstFrameUrl } of fired) {
      executeTaskMut.mutate({
        segmentId: task.segmentId,
        segmentIndex: task.segmentIndex,
        modality: task.modality,
        modelId: task.modelId,
        prompt: task.prompt,
        voiceText: task.voiceText,
        params: task.params,
        mode: batchGenerationOptions.mode,
        firstFrameUrl,
      });
    }
    toast.info(`圖像完成，自動觸發 ${fired.length} 個 i2v 影片任務`);
    // executeTaskMut.mutate 在 react-query 中是穩定 reference；
    // batchGenerationOptions.mode 為 stable primitive。
    // 故只需依 generationTasks 變更觸發。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationTasks]);

  const deletePlanningMut = trpc.director.deletePlanningSession.useMutation({
    onSuccess: () => planningSessionsQuery.refetch(),
  });

  const planningMilestonesMut =
    trpc.director.planningCreateMilestones.useMutation({
      onSuccess: data => {
        toast.success(`已建立 ${data.ids.length} 個里程碑到行事曆 📅`);
      },
      onError: e => toast.error("建立里程碑失敗：" + e.message),
    });

  const chatMutation = trpc.director.chat.useMutation({
    onMutate: () => setAIState("thinking"),
    onSuccess: data => {
      setAIState("idle");
      const scriptSummary = data.script
        ? `\n\n---\n**CO-STAR 腳本已生成**\n\n| 欄位 | 內容 |\n|------|------|\n| 背景 | ${data.script.context} |\n| 情境 | ${data.script.situation} |\n| 任務 | ${data.script.task} |\n| 行動 | ${data.script.action} |\n| 結果 | ${data.script.result} |\n\n**視覺提示詞：** ${data.script.visualPrompt}\n\n**語音腳本：** ${data.script.audioScript}\n\n**音樂風格：** ${data.script.musicVibe}`
        : "";

      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: (data.research || "已完成分析。") + scriptSummary,
        },
      ]);
      if (data.script) {
        setScripts(prev => [...prev, data.script as CoStarScript]);
        if (!showStoryboard && !isMobile) setShowStoryboard(true);
        if (data.script.proactiveQuestion) {
          setProactiveQuestion(data.script.proactiveQuestion);
        }
      }
      if (saveToNotes && data.script) {
        toast.success("腳本已儲存至專案筆記");
      }
    },
    onError: error => {
      setAIState("idle");
      toast.error(error.message);
    },
  });

  const refineMutation = trpc.director.refineScript.useMutation({
    onSuccess: (data, vars) => {
      if (refiningIdx !== null) {
        setScripts(prev => {
          const next = [...prev];
          next[refiningIdx] = data as CoStarScript;
          return next;
        });
        toast.success("腳本已更新");
      }
      setRefiningIdx(null);
    },
    onError: e => {
      toast.error("微調失敗：" + e.message);
      setRefiningIdx(null);
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    (content: string) => {
      setProactiveQuestion(null);
      setPlanningIntentCard(null);
      const newMessages: Message[] = [...messages, { role: "user", content }];
      setMessages(newMessages);
      chatMutation.mutate({
        messages: newMessages
          .filter(m => m.role !== "system")
          .map(m => ({ role: m.role, content: m.content })),
        saveToNotes,
        personality,
      });
    },
    [messages, saveToNotes, personality, chatMutation]
  );

  const handleSendToStudio = useCallback(
    (script: CoStarScript) => {
      sessionStorage.setItem(
        "sendToStudio",
        JSON.stringify({
          prompt: script.visualPrompt,
          generationType: "image",
          source: "director_ai",
          musicStyle: script.musicVibe,
          audioScript: script.audioScript,
          batchTasks: [
            {
              generationType: "image",
              prompt: script.visualPrompt,
            },
            {
              generationType: "video",
              prompt: `${script.visualPrompt}\n\n場景敘事：${script.action}`,
            },
            {
              generationType: "audio",
              prompt: script.musicVibe || script.result || script.situation,
            },
          ],
        })
      );
      navigate("/image-studio");
      toast.success("腳本已發送到工作室");
    },
    [navigate]
  );

  const handleRefineScript = useCallback(
    (script: CoStarScript, idx: number) => {
      const instruction = window.prompt(
        "請輸入修改指示（例如：讓氛圍更溫暖、加入慢動作鏡頭）"
      );
      if (!instruction?.trim()) return;
      setRefiningIdx(idx);
      refineMutation.mutate({ script, instruction, personality });
    },
    [personality, refineMutation]
  );

  const handleCopyScript = useCallback((script: CoStarScript) => {
    const text = [
      `【背景】${script.context}`,
      `【情境】${script.situation}`,
      `【任務】${script.task}`,
      `【行動】${script.action}`,
      `【結果】${script.result}`,
      `\n【Visual Prompt】${script.visualPrompt}`,
      `【語音腳本】${script.audioScript}`,
      `【音樂風格】${script.musicVibe}`,
    ].join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("已複製到剪貼簿"));
  }, []);

  const handleSaveSession = useCallback(() => {
    const title = window.prompt(
      "為這段對話命名",
      `導演對話 ${new Date().toLocaleDateString("zh-TW")}`
    );
    if (!title?.trim()) return;
    const sessionData = JSON.stringify({
      messages: messages.filter(m => m.role !== "system"),
      scripts,
      personality,
    });
    saveSessionMut.mutate({ title, sessionData, personality });
  }, [messages, scripts, personality, saveSessionMut]);

  const handleLoadSession = useCallback(
    (sessionData: string) => {
      try {
        const data = JSON.parse(sessionData);
        if (data.personality) {
          setPersonality(data.personality);
          setGlobalPersonality(data.personality);
        }
        if (Array.isArray(data.messages)) {
          setMessages([
            {
              role: "system",
              content:
                PERSONALITY_SYSTEM_PROMPTS[data.personality as Personality] ??
                PERSONALITY_SYSTEM_PROMPTS.creative,
            },
            ...data.messages,
          ]);
        }
        if (Array.isArray(data.scripts)) {
          setScripts(data.scripts);
        }
        setShowSessions(false);
        toast.success("對話已載入");
      } catch {
        toast.error("載入失敗");
      }
    },
    [setGlobalPersonality]
  );

  const handleUseTemplate = useCallback(
    (prompt: string, templatePersonality: Personality) => {
      setPersonality(templatePersonality);
      setGlobalPersonality(templatePersonality);
      setShowTemplates(false);
      // Trigger send after a short delay so personality state settles
      setTimeout(() => handleSend(prompt), 50);
    },
    [setGlobalPersonality, handleSend]
  );

  // ─── Planning Mode Handlers ─────────────────────────────────────────────

  const handleStartPlanning = useCallback(() => {
    const newSession: ScriptPlanningSession = {
      id: `plan-${Date.now()}`,
      title: "新規劃",
      personality,
      scenes: [],
      emotionalBeats: [],
      milestones: [],
      phases: PLANNING_PHASES.map(p => ({
        phase: p.id,
        status: "not-started" as const,
        discussion: [],
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPlanningSession(newSession);
    setCurrentPlanningId(null);
    setPlanningPhase("concept");
  }, [personality]);

  // 在規劃模式內貼上腳本 → 直接呼叫 importScript，匯入後把分鏡掛上目前
  // 規劃 session（沒有 session 就先開一個），讓貼腳本 → 場景列表 → 分鏡編輯
  // 三步連貫，重整也不會掉。
  const handleImportScriptIntoPlanning = useCallback(async () => {
    const content = planningPasteContent.trim();
    if (!content) {
      toast.error("請先貼上腳本內容");
      return;
    }
    const title =
      planningPasteTitle.trim() ||
      `腳本 ${new Date().toLocaleDateString("zh-TW")}`;
    try {
      const data = await importScriptMut.mutateAsync({
        rawContent: content,
        title,
        sourceFormat: planningPasteFormat,
        personality,
      });
      // ScriptImportPanel 的全域 onSuccess 已經會更新 importedSegments / Title /
      // selectedSegmentIdx 並丟出 toast — 這裡只負責把腳本綁到 planningSession。
      const segs = data.segments;
      const derivedScenes = scenesFromSegments(segs);
      setPlanningSession(prev => {
        const base: ScriptPlanningSession =
          prev ?? {
            id: `plan-${Date.now()}`,
            title,
            personality,
            scenes: [],
            emotionalBeats: [],
            milestones: [],
            phases: PLANNING_PHASES.map(p => ({
              phase: p.id,
              status: "not-started" as const,
              discussion: [],
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        return {
          ...base,
          // 沒有手動填過場景時才以匯入結果填入，避免覆蓋既有規劃。
          scenes: base.scenes.length === 0 ? derivedScenes : base.scenes,
          linkedScript: {
            title,
            sourceFormat: planningPasteFormat,
            segments: segs,
          },
          phases: base.phases.map(p =>
            p.phase === "scene-planning" && p.status === "not-started"
              ? { ...p, status: "in-progress" as const }
              : p
          ),
          updatedAt: new Date().toISOString(),
        };
      });
      // 沒有現成 planningSession 時剛剛建了一個新的 → 重設 currentPlanningId 走 create 流程
      if (!planningSession) setCurrentPlanningId(null);
      setPlanningPhase("scene-planning");
      setShowPlanningPaste(false);
      setPlanningPasteContent("");
      setPlanningPasteTitle("");
      toast.success(
        `已將「${title}」載入規劃，可在『腳本分析』分頁逐段微調 🎬`
      );
    } catch {
      // importScriptMut.onError 已經顯示 toast
    }
  }, [
    planningPasteContent,
    planningPasteTitle,
    planningPasteFormat,
    personality,
    importScriptMut,
    planningSession,
  ]);

  const handlePlanningSubmit = useCallback(() => {
    if (!planningInput.trim() || !planningSession) return;

    const userMsg: PlanningMessage = {
      role: "user",
      content: planningInput,
      timestamp: new Date().toISOString(),
      phase: planningPhase,
    };

    // Add user message immediately
    setPlanningSession(prev => {
      if (!prev) return prev;
      const updated = { ...prev };
      updated.phases = updated.phases.map(p =>
        p.phase === planningPhase
          ? { ...p, discussion: [...p.discussion, userMsg] }
          : p
      );
      return updated;
    });

    const currentPhaseData = planningSession.phases.find(
      p => p.phase === planningPhase
    );

    planningDiscussMut.mutate({
      phase: planningPhase,
      message: planningInput,
      personality,
      previousMessages: (currentPhaseData?.discussion ?? []).map(d => ({
        role: d.role,
        content: d.content,
        timestamp: d.timestamp,
        phase: d.phase,
      })),
      sessionContext: {
        concept: planningSession.concept,
        outline: planningSession.outline,
        scenes: planningSession.scenes,
        emotionalBeats: planningSession.emotionalBeats,
      },
    });

    setPlanningInput("");
  }, [
    planningInput,
    planningSession,
    planningPhase,
    personality,
    planningDiscussMut,
  ]);

  const handlePlanningCompletePhase = useCallback(() => {
    setPlanningSession(prev => {
      if (!prev) return prev;
      const updated = { ...prev, updatedAt: new Date().toISOString() };
      updated.phases = updated.phases.map(p =>
        p.phase === planningPhase ? { ...p, status: "completed" as const } : p
      );
      return updated;
    });
    toast.success("階段完成 ✨");
  }, [planningPhase]);

  const handleAnalyzeDepth = useCallback(() => {
    if (!planningSession || planningSession.scenes.length === 0) {
      toast.error("請先完成場景規劃");
      return;
    }
    planningDepthMut.mutate({
      scenes: planningSession.scenes,
      concept: planningSession.concept,
      outline: planningSession.outline,
      personality,
    });
  }, [planningSession, personality, planningDepthMut]);

  const handleSavePlanning = useCallback(() => {
    if (!planningSession) return;
    const title =
      planningSession.concept?.theme || planningSession.title || "新規劃";
    savePlanningMut.mutate({
      id: currentPlanningId ?? undefined,
      title,
      sessionData: JSON.stringify(planningSession),
      personality,
    });
    toast.success("規劃已儲存 ✨");
  }, [planningSession, personality, savePlanningMut, currentPlanningId]);

  // ── 規劃 session 已連結腳本時，importedSegments 變更（refine / CO-STAR /
  // 重新排序）要同步回 session.linkedScript，讓 auto-save 把最新分鏡帶走，
  // 重整後一切照舊。
  useEffect(() => {
    if (!planningSession?.linkedScript) return;
    if (importedSegments.length === 0) return;
    setPlanningSession(prev => {
      if (!prev?.linkedScript) return prev;
      // 內容真的有變才更新，避免無窮迴圈
      const same =
        prev.linkedScript.segments.length === importedSegments.length &&
        prev.linkedScript.segments.every(
          (s, i) => s === importedSegments[i]
        );
      if (same) return prev;
      return {
        ...prev,
        linkedScript: { ...prev.linkedScript, segments: importedSegments },
        updatedAt: new Date().toISOString(),
      };
    });
    // 故意只盯 importedSegments；planningSession 變動會自己觸發 same-check。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedSegments]);

  // ── localStorage 草稿：每次 planningSession 變更 500ms 內寫入瀏覽器
  // 端，作為 3s DB auto-save 之前的安全網（重整/當機都不會掉）。
  useEffect(() => {
    if (!planningSession) {
      try {
        localStorage.removeItem(PLANNING_DRAFT_KEY);
      } catch {
        // ignore
      }
      return;
    }
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          PLANNING_DRAFT_KEY,
          JSON.stringify({
            session: planningSession,
            currentPlanningId,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        // 配額爆 / Safari private mode 都先靜默
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [planningSession, currentPlanningId]);

  // ── 進站時還原 localStorage 草稿（只跑一次）。若還原成功，連帶把
  // linkedScript 內的分鏡塞回 importedSegments 讓「腳本分析」分頁也接上。
  useEffect(() => {
    if (planningDraftRestoredRef.current) return;
    planningDraftRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(PLANNING_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        session?: ScriptPlanningSession;
        currentPlanningId?: number | null;
      };
      const session = parsed?.session;
      if (!session?.id || !Array.isArray(session.phases)) return;
      setPlanningSession(session);
      if (typeof parsed.currentPlanningId === "number") {
        setCurrentPlanningId(parsed.currentPlanningId);
      }
      if (session.linkedScript?.segments?.length) {
        setImportedSegments(session.linkedScript.segments);
        setImportedTitle(session.linkedScript.title);
        setSelectedSegmentIdx(0);
      }
      // 還原後不再彈「繼續上次規劃」橫幅
      setResumePlanningCandidate(null);
      toast.info("已還原上次未儲存的規劃 ✨");
    } catch {
      // 壞掉的草稿就丟掉
      try {
        localStorage.removeItem(PLANNING_DRAFT_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  // ── Auto-save：每次 planningSession 變更後 debounce 3s 自動儲存 ──
  // 第一次會走 create（並設定 currentPlanningId），之後一律 update。
  useEffect(() => {
    if (!planningSession) return;
    const handle = setTimeout(() => {
      const title =
        planningSession.concept?.theme || planningSession.title || "新規劃";
      savePlanningMut.mutate({
        id: currentPlanningId ?? undefined,
        title,
        sessionData: JSON.stringify(planningSession),
        personality,
      });
    }, 3000);
    return () => clearTimeout(handle);
    // savePlanningMut 是穩定 ref；故意不放進依賴，避免 mutation pending 影響 debounce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningSession, personality, currentPlanningId]);

  const handleLoadPlanningSession = useCallback(
    (sessionData: string, id?: number) => {
      try {
        const data = JSON.parse(sessionData) as ScriptPlanningSession;
        setPlanningSession(data);
        if (typeof id === "number") setCurrentPlanningId(id);
        if (data.personality) {
          setPersonality(data.personality as Personality);
          setGlobalPersonality(data.personality as Personality);
        }
        // 把附在 session 上的腳本分鏡塞回「腳本分析」分頁，讓貼過的劇本與
        // AI 生成的分鏡跟著規劃一起回來。
        if (data.linkedScript?.segments?.length) {
          setImportedSegments(data.linkedScript.segments);
          setImportedTitle(data.linkedScript.title);
          setSelectedSegmentIdx(0);
        }
        setShowPlanningSessions(false);
        toast.success("規劃已載入");
      } catch {
        toast.error("載入失敗");
      }
    },
    [setGlobalPersonality]
  );

  const trpcUtils = trpc.useUtils();
  const handleResumeLatestPlanning = useCallback(async () => {
    if (!resumePlanningCandidate) return;
    try {
      const res = await trpcUtils.director.loadPlanningSession.fetch({
        id: resumePlanningCandidate.id,
      });
      if (res?.sessionData) {
        handleLoadPlanningSession(res.sessionData, resumePlanningCandidate.id);
        setActiveTab("planning");
        setResumePlanningCandidate(null);
      } else {
        toast.error("無法載入上次規劃");
      }
    } catch {
      toast.error("無法載入上次規劃");
    }
  }, [resumePlanningCandidate, handleLoadPlanningSession, trpcUtils]);

  const handleDismissResumeBanner = useCallback(() => {
    try {
      localStorage.setItem("director-resume-dismissed", "1");
    } catch {
      // ignore
    }
    setResumePlanningCandidate(null);
  }, []);

  // ─── Script Analysis Handlers ───────────────────────────────────────────

  const handleImportScript = useCallback(
    (content: string, title: string, format: string) => {
      importScriptMut.mutate({
        rawContent: content,
        title,
        sourceFormat: format,
        personality,
      });
    },
    [personality, importScriptMut]
  );

  const handleUpdateSegment = useCallback((updated: ScriptSegment) => {
    setImportedSegments(prev =>
      prev.map(s => (s.id === updated.id ? updated : s))
    );
  }, []);

  const handleSegmentStatusChange = useCallback(
    (segId: string, status: ScriptSegment["status"]) => {
      setImportedSegments(prev =>
        prev.map(s => (s.id === segId ? { ...s, status } : s))
      );
    },
    []
  );

  const handleNavigateSegment = useCallback(
    (direction: "prev" | "next") => {
      setSelectedSegmentIdx(prev => {
        if (prev === null) return null;
        const next = direction === "prev" ? prev - 1 : prev + 1;
        if (next < 0 || next >= importedSegments.length) return prev;
        return next;
      });
    },
    [importedSegments.length]
  );

  const handleGenerateCostar = useCallback(
    (segmentId: string) => {
      const seg = importedSegments.find(s => s.id === segmentId);
      if (!seg) return;
      generateCostarMut.mutate({
        segment: {
          id: seg.id,
          index: seg.index,
          rawText: seg.rawText,
          storyboard: seg.storyboard,
          discussion: seg.discussion.map(d => ({
            role: d.role,
            content: d.content,
          })),
          characters: seg.characters,
          locations: seg.locations,
        },
        personality,
      });
    },
    [importedSegments, personality, generateCostarMut]
  );

  const handleBatchCostar = useCallback(() => {
    const segmentsWithoutCostar = importedSegments.filter(s => !s.costar);
    if (segmentsWithoutCostar.length === 0) {
      toast.info("所有分鏡已有 CO-STAR");
      return;
    }
    batchCostarMut.mutate({
      segments: segmentsWithoutCostar.map(s => ({
        id: s.id,
        index: s.index,
        rawText: s.rawText,
        storyboard: s.storyboard,
      })),
      personality,
    });
  }, [importedSegments, personality, batchCostarMut]);

  const handleStartBatchGeneration = useCallback(() => {
    if (importedSegments.length === 0) {
      toast.error("尚未匯入腳本分鏡");
      return;
    }
    if (batchGenerationOptions.modalities.length === 0) {
      toast.error("請至少選擇一種生成模態");
      return;
    }
    autoGenerateMut.mutate({
      segments: importedSegments.map(s => ({
        id: s.id,
        index: s.index,
        storyboard: s.storyboard,
        costar: s.costar,
      })),
      generationOptions: batchGenerationOptions,
    });
  }, [importedSegments, batchGenerationOptions, autoGenerateMut]);

  const handleAnalyzeOverview = useCallback(() => {
    overviewMut.mutate({
      segments: importedSegments.map(s => ({
        index: s.index,
        storyboard: s.storyboard,
        characters: s.characters,
        locations: s.locations,
      })),
      personality,
    });
  }, [importedSegments, personality, overviewMut]);

  const handleMoveSegment = useCallback(
    (fromIdx: number, direction: "up" | "down") => {
      const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
      if (toIdx < 0 || toIdx >= importedSegments.length) return;
      setImportedSegments(prev => {
        const next = [...prev];
        [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
        // Reassign indices
        return next.map((s, i) => ({ ...s, index: i }));
      });
      // Follow selection
      if (selectedSegmentIdx === fromIdx) setSelectedSegmentIdx(toIdx);
      else if (selectedSegmentIdx === toIdx) setSelectedSegmentIdx(fromIdx);
    },
    [importedSegments.length, selectedSegmentIdx]
  );

  // ─── Memoized values ─────────────────────────────────────────────────────

  const scriptStats = useMemo(() => {
    if (importedSegments.length === 0) return null;
    const approved = importedSegments.filter(
      s => s.status === "approved"
    ).length;
    const refined = importedSegments.filter(s => s.status === "refined").length;
    const withCostar = importedSegments.filter(s => !!s.costar).length;
    const moods = new Map<string, number>();
    importedSegments.forEach(s => {
      const m = s.storyboard.mood;
      if (m) moods.set(m, (moods.get(m) ?? 0) + 1);
    });
    return {
      approved,
      refined,
      withCostar,
      total: importedSegments.length,
      moods,
    };
  }, [importedSegments]);

  const currentPersonality = useMemo(
    () => PERSONALITIES.find(p => p.id === personality) ?? PERSONALITIES[1],
    [personality]
  );

  const suggestedPrompts = useMemo(
    () => [
      "幫我構思一部創意短片",
      "我想製作一段冥想引導音頻",
      "設計一個品牌宣傳影片腳本",
    ],
    []
  );

  const hasConversation = messages.filter(m => m.role !== "system").length > 0;

  // ── 光球代理人：導演 AI ────────────────────────────────────────────────
  const FORMAT_PRESETS = [
    { id: "format:co-star", label: "CO-STAR 格式", description: "脈絡/目的/風格/語氣/受眾/回應格式" },
    { id: "format:sslcm", label: "SSLCM 格式", description: "敘事結構框架" },
    { id: "format:selcm", label: "SELCM 格式", description: "情緒敘事框架" },
    { id: "format:free", label: "自由格式", description: "不套用結構、自由發揮" },
  ];
  const PERSONALITY_PRESETS = PERSONALITIES.map(p => ({
    id: `personality:${p.id}`,
    label: `${p.label}型導演`,
    description: p.description,
  }));
  const templateOptions = (templatesQuery.data ?? []).slice(0, 20).map(t => ({
    id: `template:${t.id}`,
    label: t.label,
    description: t.category ? CATEGORY_LABELS[t.category] ?? t.category : undefined,
  }));

  const directorCaps: AgentCapability[] = [
    {
      action: "setTab",
      label: "分頁",
      currentId: activeTab,
      options: [
        { id: "chat", label: "對話討論" },
        { id: "script", label: "腳本分析" },
      ],
      hint: "chat = 自由對話；script = 匯入劇本分段分析",
    },
    {
      action: "applyPreset",
      label: "預設（導演個性 + 回應格式 + 靈感模板）",
      currentId: `personality:${personality}`,
      options: [...PERSONALITY_PRESETS, ...FORMAT_PRESETS, ...templateOptions],
      hint: "presetId=personality:calm/creative/technical 切換導演個性；format:co-star/sslcm/selcm/free 切換回應格式；template:<id> 載入靈感模板",
    },
    {
      action: "fillPrompt",
      label: "直接提問",
      hint: "fillPrompt 會直接送出訊息給導演（不需再按送出），使用者會看到自己的發言",
    },
    {
      action: "setParam",
      label: "偏好參數",
      hint: "key=saveToNotes(boolean) / showStoryboard(boolean) / selectedSegmentIdx(number|null)",
    },
  ];

  useRegisterPageAgent({
    // pageId 對齊 shared/appRegistry.ts 的 "director" 條目；舊值 "director-ai"
    // 與 registry id 不一致導致光球無法 dispatch 動作到此頁。
    pageId: "director",
    pageLabel: "導演 AI",
    pagePath: "/director",
    capabilities: directorCaps,
    state: {
      activeTab,
      personality,
      preferredFormat,
      segments: importedSegments.length,
      messageCount: messages.filter(m => m.role !== "system").length,
      isChatting: chatMutation.isPending,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      const result = await runDirectorAction(action);
      // Agent loop v5/v6 — overlay structured `data` so the observer
      // sees what changed (active tab, applied preset, prompt sent
      // through to the chat). Backwards compatible.
      if (result.ok) {
        const data = synthesizeDirectorData(action);
        if (data) return { ...result, data };
      }
      return result;
    },
  });

  function synthesizeDirectorData(
    action: AgentAction
  ): Record<string, unknown> | null {
    switch (action.type) {
      case "setTab":
        return { activeTab: action.tabId };
      case "fillPrompt":
        return {
          promptSent: true,
          promptPreview: String(action.text).slice(0, 120),
        };
      case "applyPreset":
        return { presetId: action.presetId };
      case "setParam":
        return {
          paramKey: action.key,
          paramValueType: typeof action.value,
        };
      case "reset":
        return { reset: true };
      default:
        return null;
    }
  }

  async function runDirectorAction(
    action: AgentAction
  ): Promise<AgentActionResult> {
      switch (action.type) {
        case "setTab": {
          if (action.tabId !== "chat" && action.tabId !== "script") {
            return { ok: false, reason: `unknown tabId: ${action.tabId}` };
          }
          setActiveTab(action.tabId);
          return { ok: true };
        }
        case "fillPrompt": {
          if (!action.text.trim()) return { ok: false, reason: "empty text" };
          handleSend(action.text);
          return { ok: true, message: "已替你問導演" };
        }
        case "applyPreset": {
          const id = action.presetId;
          if (id.startsWith("personality:")) {
            const p = id.slice("personality:".length) as Personality;
            if (p === "calm" || p === "creative" || p === "technical") {
              setPersonality(p);
              setGlobalPersonality(p);
              updatePrefs.mutate({ personality: p });
              return { ok: true, message: `已切到「${p}」型導演` };
            }
            return { ok: false, reason: `unknown personality: ${p}` };
          }
          if (id.startsWith("format:")) {
            const f = id.slice("format:".length) as typeof preferredFormat;
            if (f === "co-star" || f === "sslcm" || f === "selcm" || f === "free") {
              setPreferredFormat(f);
              updatePrefs.mutate({ preferredFormat: f });
              return { ok: true, message: `已切到「${f}」格式` };
            }
            return { ok: false, reason: `unknown format: ${f}` };
          }
          if (id.startsWith("template:")) {
            const tid = id.slice("template:".length);
            const tpl = (templatesQuery.data ?? []).find(t => t.id === tid);
            if (!tpl) return { ok: false, reason: `unknown template: ${tid}` };
            setShowTemplates(true);
            return { ok: true, message: `已打開模板「${tpl.label}」` };
          }
          return { ok: false, reason: `unknown presetId: ${id}` };
        }
        case "setParam": {
          const { key, value } = action;
          switch (key) {
            case "saveToNotes":
              if (typeof value === "boolean") setSaveToNotes(value);
              return { ok: true };
            case "showStoryboard":
              if (typeof value === "boolean") setShowStoryboard(value);
              return { ok: true };
            case "selectedSegmentIdx":
              if (value === null || typeof value === "number") {
                setSelectedSegmentIdx(value as number | null);
              }
              return { ok: true };
            default:
              return { ok: false, reason: `unknown key: ${key}` };
          }
        }
        case "submit":
          return {
            ok: false,
            reason: "導演 AI 的送出透過 fillPrompt 直接送出；不需要獨立 submit",
          };
        case "reset":
          setMessages([
            {
              role: "system",
              content:
                PERSONALITY_SYSTEM_PROMPTS[personality] ??
                PERSONALITY_SYSTEM_PROMPTS.creative,
            },
          ]);
          setImportedSegments([]);
          setImportedTitle("");
          setSelectedSegmentIdx(null);
          return { ok: true };
        case "focusElement":
          return { ok: true };
        default:
          return { ok: false, reason: "unsupported action" };
      }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Clapperboard className="w-5 h-5 text-muted-foreground" />
          <h1 className="hs-h2 !mb-0">導演 AI</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
              currentPersonality.bgActive,
              currentPersonality.textColor
            )}
          >
            <currentPersonality.icon className="w-3 h-3" />
            {currentPersonality.label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Template Gallery Toggle */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1"
            onClick={() => {
              setShowTemplates(!showTemplates);
              setShowSessions(false);
            }}
          >
            <BookTemplate className="w-3.5 h-3.5" />
            {isMobile ? "" : "模板"}
          </Button>
          {/* Session Management */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1"
            onClick={() => {
              setShowSessions(!showSessions);
              setShowTemplates(false);
            }}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {isMobile ? "" : "對話紀錄"}
          </Button>
          {hasConversation && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1"
              onClick={handleSaveSession}
              disabled={saveSessionMut.isPending}
            >
              <Save className="w-3.5 h-3.5" />
              {isMobile ? "" : "儲存"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="hidden rounded-xl text-xs gap-1"
            onClick={() => openAssetsDrawer()}
            aria-label="開啟素材庫"
          >
            <Package className="w-3.5 h-3.5" />
            {isMobile ? "" : "素材"}
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              id="save-notes"
              checked={saveToNotes}
              onCheckedChange={setSaveToNotes}
            />
            <Label htmlFor="save-notes" className="text-xs">
              自動存筆記
            </Label>
          </div>
          {!isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1"
              onClick={() => setShowStoryboard(!showStoryboard)}
            >
              {showStoryboard ? "隱藏" : "顯示"} Storyboard
            </Button>
          )}
        </div>
      </div>

      <Collapsible
        open={templateGuideOpen}
        onOpenChange={setTemplateGuideOpen}
        className="rounded-2xl border border-border/40 bg-background/70 px-4 py-3"
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2"
          >
            <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              導演 AI 快速導覽
            </p>
            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-muted-foreground transition-transform",
                templateGuideOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {DIRECTOR_QUICK_GUIDE.map(block => (
              <div
                key={block.id}
                className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5"
              >
                <p className="text-xs font-medium text-foreground mb-1">
                  {block.title}
                </p>
                <ul className="space-y-1 list-disc pl-4">
                  {block.tips.map(tip => (
                    <li key={tip} className="text-[11px] text-muted-foreground">
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Template Gallery Overlay */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GlassCard hover={false} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                  <BookTemplate className="w-4 h-4" />
                  模板庫 — 快速開始
                </h3>
                <button
                  onClick={() => setShowTemplates(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/70 px-2.5 py-2 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={templateKeyword}
                  onChange={e => setTemplateKeyword(e.target.value)}
                  placeholder="搜尋模板主題、分類或用途..."
                  className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
                />
              </div>
              <div
                className={cn(
                  "grid gap-2",
                  isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3"
                )}
              >
                {filteredTemplates.map(t => {
                  const pConfig =
                    PERSONALITIES.find(p => p.id === t.personality) ??
                    PERSONALITIES[1];
                  return (
                    <button
                      key={t.id}
                      onClick={() =>
                        handleUseTemplate(
                          t.prompt,
                          t.personality as Personality
                        )
                      }
                      className="text-left rounded-xl border border-border/50 p-3 hover:bg-white/60 transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded",
                            pConfig.bgActive,
                            pConfig.textColor
                          )}
                        >
                          {CATEGORY_LABELS[t.category] ?? t.category}
                        </span>
                        <span className="text-xs font-semibold group-hover:text-primary transition-colors">
                          {t.label}
                        </span>
                      </div>
                      <p className="hs-small !mb-0 text-muted-foreground line-clamp-2">
                        {t.description}
                      </p>
                    </button>
                  );
                })}
                {filteredTemplates.length === 0 && (
                  <div className="col-span-full rounded-xl border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
                    沒有符合搜尋條件的模板，請換個關鍵字試試。
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Session List Overlay */}
      <AnimatePresence>
        {showSessions && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GlassCard hover={false} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" />
                  已儲存對話
                </h3>
                <button
                  onClick={() => setShowSessions(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {sessionsQuery.isLoading && (
                <p className="hs-small !mb-0 text-muted-foreground py-4 text-center">
                  載入中...
                </p>
              )}
              {sessionsQuery.data?.length === 0 && (
                <p className="hs-small !mb-0 text-muted-foreground py-4 text-center">
                  還沒有儲存的對話。對話後點擊「儲存」按鈕來保存。
                </p>
              )}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(sessionsQuery.data ?? []).map(s => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    onLoad={handleLoadSession}
                    onDelete={id => deleteSessionMut.mutate({ id })}
                  />
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Personality Selector + Preferred Format – hidden */}

      <p className="hs-small !mb-0 text-muted-foreground">
        雙引擎 RAG（事實研究 + CO-STAR 創意編排）—
        腳本可一鍵發送到工作室，也可微調修改
      </p>

      {/* ── 從光球代理延續討論 橫幅 ──
         * 觸發條件：使用者剛剛在 /agent 跟光球聊到「規劃腳本」之類的話題，
         * 光球已寫入 directorHandoff payload。我們把上下文做成可摺疊小卡：
         *   • 主訊息：承接話題 + 點明「我已經把脈絡帶過來了」
         *   • 三個一鍵動作：給三方向 / 整理大綱 / 從某段開始
         *   • 收合：預覽最近幾輪對話 + 完整 userIntent
         * 重點是讓使用者一眼知道 AI 沒丟掉脈絡，按 Enter 就能繼續。 */}
      {agentHandoff && (
        <div
          className="rounded-xl border border-emerald-300/40 bg-emerald-50/40 dark:bg-emerald-900/10 px-3 py-2.5 text-xs space-y-2"
          data-testid="director-agent-handoff-banner"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className="text-base leading-tight">🌿</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-emerald-800 dark:text-emerald-200 mb-0.5">
                從光球延續討論
              </p>
              <p className="text-emerald-700/80 dark:text-emerald-200/80 line-clamp-2">
                {agentHandoff.topic
                  ? `話題：${agentHandoff.topic}`
                  : "我已經把剛剛的對話脈絡帶過來了，可以接著聊。"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAgentHandoff(null)}
              className="rounded-lg px-1.5 py-1 text-emerald-700/70 hover:text-emerald-800 dark:hover:text-emerald-100 transition shrink-0"
              title="收起這張卡片"
              aria-label="收起從光球延續討論的提示"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pl-6">
            {agentHandoff.userIntent && (
              <button
                type="button"
                onClick={() => {
                  // 「不會幫我執行」← 使用者最痛的一點。把他在光球講的最
                  // 後一句直接塞回去送出，導演 AI 立刻接手往下做。
                  handleSend(agentHandoff.userIntent);
                  setAgentHandoff(null);
                }}
                className="rounded-lg border border-emerald-500/60 bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-800 dark:text-emerald-100 hover:bg-emerald-500/25 transition"
              >
                直接照剛剛說的開始 →
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                handleSend("先給我三個方向，每個一句話講重點。");
                setAgentHandoff(null);
              }}
              className="rounded-lg border border-emerald-400/40 bg-background/60 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/20 transition"
            >
              給我三個方向
            </button>
            <button
              type="button"
              onClick={() => {
                handleSend(
                  "把我剛剛跟光球聊的內容整理成腳本大綱，先列三幕結構就好。"
                );
                setAgentHandoff(null);
              }}
              className="rounded-lg border border-emerald-400/40 bg-background/60 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-200 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/20 transition"
            >
              整理成腳本大綱
            </button>
            {agentHandoff.recentTurns.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHandoffDetails(prev => !prev)}
                className="rounded-lg border border-transparent px-2.5 py-1 text-emerald-700/80 dark:text-emerald-200/80 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/20 transition"
                aria-expanded={showHandoffDetails}
              >
                {showHandoffDetails ? "收合對話脈絡" : "看剛剛聊了什麼"}
              </button>
            )}
          </div>
          {showHandoffDetails && agentHandoff.recentTurns.length > 0 && (
            <div className="rounded-lg bg-background/60 border border-emerald-300/30 p-2.5 space-y-1.5 max-h-48 overflow-y-auto">
              {agentHandoff.recentTurns.map((turn, idx) => (
                <div key={idx} className="flex gap-2 text-[11px] leading-relaxed">
                  <span
                    className={cn(
                      "shrink-0 font-medium",
                      turn.role === "user"
                        ? "text-emerald-800 dark:text-emerald-100"
                        : "text-emerald-600 dark:text-emerald-300"
                    )}
                  >
                    {turn.role === "user" ? "你" : "光球"}
                  </span>
                  <span className="text-foreground/80 whitespace-pre-wrap break-words">
                    {turn.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 繼續上次規劃橫幅 ── */}
      {resumePlanningCandidate && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-50/40 dark:bg-amber-900/10 px-3 py-2 text-xs">
          <span className="text-amber-700 dark:text-amber-300">
            🌿 你上次規劃到「{resumePlanningCandidate.title}」（
            {new Date(
              resumePlanningCandidate.updatedAt as string | number | Date
            ).toLocaleDateString("zh-TW")}
            ），要繼續嗎？
          </span>
          <button
            type="button"
            onClick={handleResumeLatestPlanning}
            className="ml-auto rounded-lg border border-amber-400/50 bg-background/60 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition"
          >
            繼續
          </button>
          <button
            type="button"
            onClick={handleDismissResumeBanner}
            className="rounded-lg px-1.5 py-1 text-amber-600/70 hover:text-amber-700 dark:hover:text-amber-200 transition"
            title="不再提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Tab System */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList className="bg-white/50 border border-border/30 rounded-xl p-1">
          <TabsTrigger
            value="chat"
            className="rounded-lg text-xs gap-1.5 data-[state=active]:shadow-sm"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            對話模式
          </TabsTrigger>
          <TabsTrigger
            value="script"
            className="rounded-lg text-xs gap-1.5 data-[state=active]:shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            腳本分析
            {importedSegments.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">
                {importedSegments.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="planning"
            className="rounded-lg text-xs gap-1.5 data-[state=active]:shadow-sm"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            規劃模式
            {planningSession && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">
                {planningSession.phases.filter(p => p.status === "completed").length}/{planningSession.phases.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ═══ Tab 1: Chat Mode (existing) ═══ */}
        <TabsContent value="chat" className="space-y-4 mt-0">
          {/* Proactive Question */}
          <AnimatePresence>
            {proactiveQuestion && (
              <ProactiveQuestionBubble
                question={proactiveQuestion}
                personality={personality}
                onDismiss={() => setProactiveQuestion(null)}
                onUse={q => {
                  setProactiveQuestion(null);
                  handleSend(q);
                }}
              />
            )}
          </AnimatePresence>

          {/* Split-Screen Layout */}
          <div className="flex gap-5">
            {/* Left: Chat Panel */}
            <div
              className={`flex-1 transition-all ${showStoryboard && !isMobile ? "max-w-[55%]" : ""}`}
            >
              {/* Orb thinking indicator above chat */}
              {chatMutation.isPending && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 mb-2 px-1"
                >
                  <VisualSoul
                    size="sm"
                    personality={personality}
                    state="thinking"
                  />
                  <span className="text-xs text-muted-foreground animate-pulse">
                    導演 AI 正在思考中...
                  </span>
                </motion.div>
              )}
              <AIChatBox
                messages={messages}
                onSendMessage={handleSend}
                isLoading={chatMutation.isPending}
                placeholder="描述你的創作構想...（Ctrl+Enter 發送）"
                height={
                  isMobile ? "calc(100vh - 480px)" : "calc(100vh - 400px)"
                }
                emptyStateMessage="告訴導演 AI 你的創作構想，或從模板庫選擇一個起點"
                suggestedPrompts={suggestedPrompts}
                initialInput={agentHandoff?.userIntent}
              />
            </div>

            {/* Right: Storyboard Panel (desktop) */}
            <AnimatePresence>
              {showStoryboard && !isMobile && (
                <motion.div
                  id="storyboard-panel"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "45%", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <GlassCard hover={false} className="h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                        Storyboard
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        {scripts.length} 個腳本
                      </span>
                    </div>

                    <ScrollArea className="h-[calc(100vh-480px)]">
                      {scripts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <p className="hs-small !mb-0 text-muted-foreground mt-4">
                            與導演 AI 對話後，腳本會自動出現在這裡
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4 pr-2">
                          {scripts.map((script, idx) => (
                            <ScriptCard
                              key={idx}
                              script={script}
                              index={idx}
                              onSendToStudio={handleSendToStudio}
                              onRefine={handleRefineScript}
                              onCopy={handleCopyScript}
                              isRefining={
                                refiningIdx === idx && refineMutation.isPending
                              }
                            />
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </GlassCard>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mobile: Storyboard as scrollable section below chat */}
          {isMobile && scripts.length > 0 && (
            <div className="space-y-3">
              <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                Storyboard ({scripts.length})
              </h3>
              {scripts.map((script, idx) => (
                <GlassCard key={idx} hover={false} className="space-y-3">
                  <ScriptCard
                    script={script}
                    index={idx}
                    onSendToStudio={handleSendToStudio}
                    onRefine={handleRefineScript}
                    onCopy={handleCopyScript}
                    isRefining={refiningIdx === idx && refineMutation.isPending}
                  />
                </GlassCard>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══ Tab 2: Script Analysis Mode ═══ */}
        <TabsContent value="script" className="space-y-4 mt-0">
          {importedSegments.length === 0 ? (
            /* Import panel when no script is loaded */
            <ScriptImportPanel
              onImport={handleImportScript}
              isImporting={importScriptMut.isPending}
              personality={personality}
            />
          ) : (
            /* Script analysis workspace */
            <div className="space-y-4">
              {/* Script header bar — enhanced with stats */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">{importedTitle}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {importedSegments.length} 個分鏡
                  </Badge>
                  {scriptStats && (
                    <>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-green-50 text-green-700 border-green-200"
                      >
                        {scriptStats.approved} 已確認
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-purple-50 text-purple-700 border-purple-200"
                      >
                        {scriptStats.withCostar}/{scriptStats.total} CO-STAR
                      </Badge>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1"
                    onClick={handleAnalyzeOverview}
                    disabled={overviewMut.isPending}
                  >
                    {overviewMut.isPending ? (
                      <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <BarChart3 className="w-3.5 h-3.5" />
                    )}
                    全局分析
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1"
                    onClick={handleBatchCostar}
                    disabled={batchCostarMut.isPending}
                  >
                    {batchCostarMut.isPending ? (
                      <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    ) : (
                      <Layers className="w-3.5 h-3.5" />
                    )}
                    批次 CO-STAR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-300/50 hover:from-purple-500/20 hover:to-pink-500/20"
                    onClick={() => setShowBatchGeneration(true)}
                    disabled={importedSegments.length === 0}
                  >
                    <Zap className="w-3.5 h-3.5 text-purple-600" />
                    批次生成
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1"
                    onClick={() => setShowExport(!showExport)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    匯出
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1 text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (window.confirm("確定要清除目前的腳本分析嗎？")) {
                        setImportedSegments([]);
                        setImportedTitle("");
                        setSelectedSegmentIdx(null);
                        setScriptOverview(null);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    清除
                  </Button>
                </div>
              </div>

              {/* Script overview panel */}
              <AnimatePresence>
                {showOverview && scriptOverview && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <GlassCard hover={false} className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          全局分析
                        </h3>
                        <button
                          onClick={() => setShowOverview(false)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                        <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100">
                          <span className="text-blue-600 font-semibold block text-[10px]">
                            總時長
                          </span>
                          <span className="text-blue-800 font-bold">
                            {scriptOverview.totalDuration}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-purple-50/50 border border-purple-100">
                          <span className="text-purple-600 font-semibold block text-[10px]">
                            核心主題
                          </span>
                          <span className="text-purple-800">
                            {scriptOverview.themes.join("、")}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-green-50/50 border border-green-100">
                          <span className="text-green-600 font-semibold block text-[10px]">
                            角色數
                          </span>
                          <span className="text-green-800 font-bold">
                            {scriptOverview.characters.length}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-100">
                          <span className="text-amber-600 font-semibold block text-[10px]">
                            場景數
                          </span>
                          <span className="text-amber-800 font-bold">
                            {scriptOverview.locations.length}
                          </span>
                        </div>
                      </div>
                      {/* Characters */}
                      {scriptOverview.characters.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" /> 角色分佈
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {scriptOverview.characters.map(c => (
                              <span
                                key={c.name}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200"
                              >
                                {c.name}{" "}
                                <span className="text-blue-400">
                                  ({c.segmentIndices.length}段)
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Mood distribution */}
                      {Object.keys(scriptOverview.moodDistribution).length >
                        0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                            <Tag className="w-3 h-3" /> 氛圍分佈
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(
                              scriptOverview.moodDistribution
                            ).map(([mood, count]) => (
                              <span
                                key={mood}
                                className="text-[10px] px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 border border-pink-200"
                              >
                                {mood} ×{count}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Pacing notes */}
                      {scriptOverview.pacingNotes && (
                        <div className="p-2.5 rounded-lg bg-muted/20 text-[11px] leading-relaxed text-foreground/80">
                          <span className="font-semibold text-muted-foreground block mb-1">
                            節奏分析
                          </span>
                          {scriptOverview.pacingNotes}
                        </div>
                      )}
                      {/* Overall suggestion */}
                      {scriptOverview.overallSuggestion && (
                        <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/10 text-[11px] leading-relaxed text-foreground/80">
                          <span className="font-semibold text-primary/70 block mb-1">
                            改善建議
                          </span>
                          {scriptOverview.overallSuggestion}
                        </div>
                      )}
                    </GlassCard>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Export panel */}
              <AnimatePresence>
                {showExport && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <ExportPanel
                      segments={importedSegments}
                      onClose={() => setShowExport(false)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Split layout: segment list + discussion */}
              <div className={cn("flex gap-4", isMobile && "flex-col")}>
                {/* Left: Segment list */}
                <div
                  className={cn("shrink-0", isMobile ? "w-full" : "w-[280px]")}
                >
                  <GlassCard hover={false} className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      分鏡列表
                    </h4>
                    <ScrollArea
                      className={
                        isMobile ? "max-h-[200px]" : "h-[calc(100vh-420px)]"
                      }
                    >
                      <div className="space-y-1.5 pr-1">
                        {importedSegments.map((seg, idx) => {
                          const sCfg = STATUS_CONFIG[seg.status];
                          const isSelected = selectedSegmentIdx === idx;
                          return (
                            <div
                              key={seg.id}
                              className="flex items-stretch gap-0.5"
                            >
                              {/* Reorder controls */}
                              <div className="flex flex-col justify-center gap-0.5 opacity-0 hover:opacity-100 transition-opacity">
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleMoveSegment(idx, "up");
                                  }}
                                  disabled={idx === 0}
                                  className="p-0.5 rounded hover:bg-muted/40 disabled:opacity-20 text-muted-foreground"
                                  title="上移"
                                >
                                  <ArrowUp className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleMoveSegment(idx, "down");
                                  }}
                                  disabled={idx === importedSegments.length - 1}
                                  className="p-0.5 rounded hover:bg-muted/40 disabled:opacity-20 text-muted-foreground"
                                  title="下移"
                                >
                                  <ArrowDown className="w-2.5 h-2.5" />
                                </button>
                              </div>
                              <button
                                onClick={() => setSelectedSegmentIdx(idx)}
                                className={cn(
                                  "flex-1 text-left rounded-lg p-2.5 transition-all border",
                                  isSelected
                                    ? "bg-primary/5 border-primary/30 shadow-sm"
                                    : "bg-white/30 border-transparent hover:bg-white/60 hover:border-border/30"
                                )}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-muted-foreground">
                                      #{idx + 1}
                                    </span>
                                    {seg.costar && (
                                      <span title="已有 CO-STAR">
                                        <Layers className="w-2.5 h-2.5 text-green-500" />
                                      </span>
                                    )}
                                  </div>
                                  {sCfg && (
                                    <span
                                      className={cn(
                                        "text-[9px] px-1.5 py-0.5 rounded-full font-medium",
                                        sCfg.color
                                      )}
                                    >
                                      {sCfg.label}
                                    </span>
                                  )}
                                </div>
                                <p className="hs-small !mb-0 truncate">
                                  {seg.storyboard.sceneHeading}
                                </p>
                                <p className="hs-small !mb-0 text-muted-foreground truncate mt-0.5">
                                  {seg.storyboard.mood} ·{" "}
                                  {seg.storyboard.duration}
                                </p>
                                {/* Character tags in segment list */}
                                {(seg.characters?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-0.5 mt-1">
                                    {seg.characters!.slice(0, 3).map(c => (
                                      <span
                                        key={c}
                                        className="text-[8px] px-1 py-0 rounded bg-blue-50 text-blue-600"
                                      >
                                        {c}
                                      </span>
                                    ))}
                                    {(seg.characters?.length ?? 0) > 3 && (
                                      <span className="text-[8px] text-muted-foreground">
                                        +{seg.characters!.length - 3}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {seg.discussion.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <MessageSquare className="w-2.5 h-2.5 text-muted-foreground" />
                                    <span className="text-[9px] text-muted-foreground">
                                      {seg.discussion.length} 則討論
                                    </span>
                                  </div>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </GlassCard>
                </div>

                {/* Right: Discussion panel */}
                <div className="flex-1 min-w-0">
                  {selectedSegmentIdx !== null &&
                  importedSegments[selectedSegmentIdx] ? (
                    <GlassCard hover={false}>
                      <SegmentDiscussionPanel
                        key={importedSegments[selectedSegmentIdx].id}
                        segment={importedSegments[selectedSegmentIdx]}
                        personality={personality}
                        quickActions={quickActionsQuery.data ?? []}
                        onUpdateSegment={handleUpdateSegment}
                        onStatusChange={status =>
                          handleSegmentStatusChange(
                            importedSegments[selectedSegmentIdx].id,
                            status
                          )
                        }
                        onNavigate={handleNavigateSegment}
                        adjacentSegments={{
                          prev:
                            selectedSegmentIdx > 0
                              ? importedSegments[selectedSegmentIdx - 1]
                              : undefined,
                          next:
                            selectedSegmentIdx < importedSegments.length - 1
                              ? importedSegments[selectedSegmentIdx + 1]
                              : undefined,
                        }}
                        onGenerateCostar={() =>
                          handleGenerateCostar(
                            importedSegments[selectedSegmentIdx].id
                          )
                        }
                        isGeneratingCostar={generateCostarMut.isPending}
                      />
                    </GlassCard>
                  ) : (
                    <GlassCard hover={false}>
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Play className="w-8 h-8 text-muted-foreground/30 mb-3" />
                        <p className="hs-small !mb-0 text-muted-foreground">
                          從左側選擇一個分鏡段落開始討論
                        </p>
                        <p className="hs-small !mb-0 text-muted-foreground/60 mt-1">
                          使用快選動作或自由輸入，與導演 AI 逐段優化你的腳本
                        </p>
                      </div>
                    </GlassCard>
                  )}
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ═══ Tab 3: Planning Mode ═══ */}
        <TabsContent value="planning" className="space-y-4 mt-0">
          {!planningSession ? (
            /* ── Start / Load Planning Session ── */
            <GlassCard hover={false} className="space-y-6">
              <div className="text-center py-8">
                <h3 className="hs-h3 mt-4">長腳本規劃模式</h3>
                <p className="hs-p text-muted-foreground max-w-lg mx-auto">
                  透過五個階段的深度對話，與 AI
                  一起打造更有溫度、更有深度的腳本。
                  <br />
                  每個階段都專注於不同面向，讓創作自然而然地成長
                  🌿
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
                  <Button
                    onClick={handleStartPlanning}
                    className="rounded-xl gap-2"
                  >
                    <Lightbulb className="w-4 h-4" />
                    開始新規劃
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2"
                    onClick={() => setShowPlanningPaste(prev => !prev)}
                  >
                    <FileText className="w-4 h-4" />
                    貼上現成腳本
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl gap-2"
                    onClick={() =>
                      setShowPlanningSessions(!showPlanningSessions)
                    }
                  >
                    <FolderOpen className="w-4 h-4" />
                    載入規劃
                  </Button>
                </div>

                {/* Inline paste panel — 從這裡可以直接貼整段劇本，AI 會
                    自動拆分成分鏡並把它們綁進規劃 session，後續可在
                    「腳本分析」分頁逐段微調。 */}
                <AnimatePresence>
                  {showPlanningPaste && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-6 text-left space-y-3 p-4 rounded-xl border border-border/40 bg-white/60">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary" />
                          <span className="text-sm font-semibold">
                            貼上你的腳本
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            AI 會拆成分鏡並放進規劃，腳本+規劃一起儲存
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <Input
                            value={planningPasteTitle}
                            onChange={e =>
                              setPlanningPasteTitle(e.target.value)
                            }
                            placeholder="腳本標題（選填）"
                            className="rounded-xl text-xs sm:col-span-2"
                          />
                          <select
                            value={planningPasteFormat}
                            onChange={e =>
                              setPlanningPasteFormat(e.target.value)
                            }
                            className="rounded-xl text-xs px-3 py-2 border bg-white"
                          >
                            {FORMAT_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <Textarea
                          value={planningPasteContent}
                          onChange={e =>
                            setPlanningPasteContent(e.target.value)
                          }
                          placeholder="貼上你的腳本內容…可以是任何格式的長腳本文字"
                          className="rounded-xl text-xs min-h-[160px] resize-y"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="rounded-xl text-xs"
                            onClick={() => {
                              setShowPlanningPaste(false);
                              setPlanningPasteContent("");
                            }}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            className="rounded-xl text-xs gap-1"
                            onClick={handleImportScriptIntoPlanning}
                            disabled={
                              importScriptMut.isPending ||
                              !planningPasteContent.trim()
                            }
                          >
                            {importScriptMut.isPending ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                AI 正在拆分鏡…
                              </>
                            ) : (
                              <>
                                <Wand2 className="w-3.5 h-3.5" />
                                匯入並產生分鏡
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Planning phase overview */}
                <div
                  className={cn(
                    "grid gap-3 mt-8",
                    isMobile ? "grid-cols-1" : "grid-cols-5"
                  )}
                >
                  {PLANNING_PHASES.map((phase, i) => (
                    <div
                      key={phase.id}
                      className="p-3 rounded-xl border border-border/40 bg-white/40 text-left"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <phase.icon
                          className={cn("w-4 h-4", phase.color)}
                        />
                        <span className="text-xs font-semibold">
                          {i + 1}. {phase.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {phase.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Saved planning sessions */}
              <AnimatePresence>
                {showPlanningSessions && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t pt-4 space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        已儲存的規劃
                      </h4>
                      {planningSessionsQuery.isLoading && (
                        <p className="hs-small !mb-0 text-muted-foreground text-center py-4">
                          載入中...
                        </p>
                      )}
                      {planningSessionsQuery.data?.length === 0 && (
                        <p className="hs-small !mb-0 text-muted-foreground text-center py-4">
                          還沒有儲存的規劃
                        </p>
                      )}
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {(planningSessionsQuery.data ?? []).map(s => (
                          <PlanningSessionItem
                            key={s.id}
                            session={s}
                            onLoad={handleLoadPlanningSession}
                            onDelete={id =>
                              deletePlanningMut.mutate({ id })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          ) : (
            /* ── Active Planning Workspace ── */
            <div className="space-y-4">
              {/* Planning header */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold">
                    {planningSession.concept?.theme ||
                      planningSession.title}
                  </span>
                  {planningSession.warmthScore != null && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-rose-50 text-rose-700 border-rose-200 gap-1"
                    >
                      <ThermometerSun className="w-3 h-3" />
                      溫度 {planningSession.warmthScore}/10
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1"
                    onClick={() => setShowPlanningPaste(prev => !prev)}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {planningSession.linkedScript ? "重新貼腳本" : "貼上腳本"}
                  </Button>
                  {(planningSession.linkedScript ||
                    importedSegments.length > 0) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl text-xs gap-1"
                      onClick={() => setActiveTab("script")}
                    >
                      <Film className="w-3.5 h-3.5" />
                      進入分鏡編輯
                      <Badge
                        variant="secondary"
                        className="text-[9px] h-4 px-1 ml-1"
                      >
                        {planningSession.linkedScript?.segments.length ??
                          importedSegments.length}
                      </Badge>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1"
                    onClick={handleSavePlanning}
                    disabled={savePlanningMut.isPending}
                  >
                    <Save className="w-3.5 h-3.5" />
                    儲存
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-xs gap-1 text-red-500 hover:text-red-600"
                    onClick={() => {
                      if (
                        window.confirm(
                          "確定要結束目前的規劃嗎？未儲存的內容將遺失。"
                        )
                      ) {
                        setPlanningSession(null);
                        setCurrentPlanningId(null);
                        try {
                          localStorage.removeItem(PLANNING_DRAFT_KEY);
                        } catch {
                          // ignore
                        }
                      }
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                    結束
                  </Button>
                </div>
              </div>

              {/* In-workspace paste panel — 同步到 session.linkedScript，重整不會掉 */}
              <AnimatePresence>
                {showPlanningPaste && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <GlassCard hover={false} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-primary" />
                        <span className="text-sm font-semibold">
                          貼上腳本 → 自動產生分鏡
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          會綁進這次規劃並一起儲存
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Input
                          value={planningPasteTitle}
                          onChange={e => setPlanningPasteTitle(e.target.value)}
                          placeholder={
                            planningSession.linkedScript?.title ||
                            "腳本標題（選填）"
                          }
                          className="rounded-xl text-xs sm:col-span-2"
                        />
                        <select
                          value={planningPasteFormat}
                          onChange={e =>
                            setPlanningPasteFormat(e.target.value)
                          }
                          className="rounded-xl text-xs px-3 py-2 border bg-white"
                        >
                          {FORMAT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Textarea
                        value={planningPasteContent}
                        onChange={e => setPlanningPasteContent(e.target.value)}
                        placeholder="貼上你的腳本內容…可以是任何格式的長腳本文字"
                        className="rounded-xl text-xs min-h-[140px] resize-y"
                      />
                      {planningSession.scenes.length > 0 && (
                        <p className="text-[11px] text-amber-600">
                          這次規劃已經有 {planningSession.scenes.length}{" "}
                          個場景；匯入的分鏡會放進「腳本分析」分頁，但不會覆蓋
                          現有場景列表。
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="rounded-xl text-xs"
                          onClick={() => {
                            setShowPlanningPaste(false);
                            setPlanningPasteContent("");
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          size="sm"
                          className="rounded-xl text-xs gap-1"
                          onClick={handleImportScriptIntoPlanning}
                          disabled={
                            importScriptMut.isPending ||
                            !planningPasteContent.trim()
                          }
                        >
                          {importScriptMut.isPending ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                              AI 正在拆分鏡…
                            </>
                          ) : (
                            <>
                              <Wand2 className="w-3.5 h-3.5" />
                              匯入並產生分鏡
                            </>
                          )}
                        </Button>
                      </div>
                    </GlassCard>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Phase navigation */}
              <div
                className={cn(
                  "flex gap-1.5 overflow-x-auto pb-1",
                  isMobile && "flex-nowrap"
                )}
              >
                {PLANNING_PHASES.map((phase, i) => {
                  const phaseData = planningSession.phases.find(
                    p => p.phase === phase.id
                  );
                  const isActive = planningPhase === phase.id;
                  const isCompleted = phaseData?.status === "completed";
                  return (
                    <button
                      key={phase.id}
                      onClick={() => setPlanningPhase(phase.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-medium transition-all whitespace-nowrap",
                        isActive
                          ? cn("ring-1 shadow-sm", phase.activeColor)
                          : isCompleted
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "bg-white/50 border-border/40 text-muted-foreground hover:bg-white/80"
                      )}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <phase.icon className="w-3.5 h-3.5" />
                      )}
                      {!isMobile && `${i + 1}.`} {phase.label}
                    </button>
                  );
                })}
              </div>

              {/* Phase content area */}
              <div className={cn("flex gap-4", isMobile && "flex-col")}>
                {/* Left: Discussion panel */}
                <div
                  className={cn(
                    "flex-1",
                    !isMobile &&
                      planningPhase === "emotional-depth" &&
                      "max-w-[60%]"
                  )}
                >
                  <GlassCard hover={false} className="space-y-3">
                    {(() => {
                      const phaseConfig = PLANNING_PHASES.find(
                        p => p.id === planningPhase
                      );
                      return (
                        <div className="flex items-center justify-between">
                          <h3 className="hs-h3 !mb-0 flex items-center gap-2">
                            {phaseConfig && (
                              <phaseConfig.icon
                                className={cn("w-4 h-4", phaseConfig.color)}
                              />
                            )}
                            {phaseConfig?.label ?? "規劃"}
                          </h3>
                          <div className="flex items-center gap-2">
                            {planningPhase === "emotional-depth" &&
                              planningSession.scenes.length > 0 && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="rounded-xl text-xs gap-1"
                                  onClick={handleAnalyzeDepth}
                                  disabled={planningDepthMut.isPending}
                                >
                                  {planningDepthMut.isPending ? (
                                    <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                  ) : (
                                    <ThermometerSun className="w-3.5 h-3.5" />
                                  )}
                                  分析溫度
                                </Button>
                              )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="rounded-xl text-xs gap-1 text-green-600"
                              onClick={handlePlanningCompletePhase}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              完成此階段
                            </Button>
                          </div>
                        </div>
                      );
                    })()}

                    <p className="hs-small !mb-0 text-muted-foreground">
                      {PLANNING_PHASES.find(p => p.id === planningPhase)?.description}
                    </p>

                    {/* Discussion messages */}
                    <ScrollArea className="h-[calc(100vh-520px)] min-h-[300px]">
                      <div className="space-y-3 pr-2">
                        {planningSession.phases
                          .find(p => p.phase === planningPhase)
                          ?.discussion.map((msg, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn(
                                "rounded-xl p-3 text-[12px] leading-relaxed",
                                msg.role === "user"
                                  ? "bg-primary/5 border border-primary/10 ml-8"
                                  : "bg-muted/30 border border-border/30 mr-8"
                              )}
                            >
                              <span className="text-[10px] font-semibold text-muted-foreground block mb-1">
                                {msg.role === "user" ? "你" : "導演 AI"}
                              </span>
                              <LazyStreamdown>{msg.content}</LazyStreamdown>
                            </motion.div>
                          )) ?? []}

                        {planningDiscussMut.isPending && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex items-center gap-2 p-3"
                          >
                            <VisualSoul
                              size="sm"
                              personality={personality}
                              state="thinking"
                            />
                            <span className="text-xs text-muted-foreground animate-pulse">
                              導演 AI 正在思考中...
                            </span>
                          </motion.div>
                        )}
                      </div>
                    </ScrollArea>

                    {/* Planning proactive question */}
                    <AnimatePresence>
                      {planningProactiveQuestion && (
              <ProactiveQuestionBubble
                question={planningProactiveQuestion}
                intentCard={planningIntentCard}
                personality={personality}
                onDismiss={() => setPlanningProactiveQuestion(null)}
                onUse={q => {
                            setPlanningProactiveQuestion(null);
                            setPlanningInput(q);
                          }}
                        />
                      )}
                    </AnimatePresence>

                    {/* Input area */}
                    <div className="flex gap-2">
                      <Textarea
                        value={planningInput}
                        onChange={e => setPlanningInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handlePlanningSubmit();
                          }
                        }}
                        placeholder={
                          planningPhase === "concept"
                            ? "告訴我你想創作什麼…你的靈感來自哪裡？"
                            : planningPhase === "outline"
                              ? "描述你的故事走向…主角會經歷什麼？"
                              : planningPhase === "scene-planning"
                                ? "讓我們一起設計場景…這個場景的氛圍是？"
                                : planningPhase === "emotional-depth"
                                  ? "哪些地方需要更多溫度？哪個時刻最打動你？"
                                  : "讓我們來安排製作時程…"
                        }
                        className="flex-1 min-h-[60px] max-h-[120px] rounded-xl resize-none text-[12px]"
                        disabled={planningDiscussMut.isPending}
                      />
                      <Button
                        onClick={handlePlanningSubmit}
                        disabled={
                          !planningInput.trim() || planningDiscussMut.isPending
                        }
                        size="sm"
                        className="rounded-xl self-end"
                      >
                        <Send className="w-4 h-4" />
                      </Button>
                    </div>
                  </GlassCard>
                </div>

                {/* Right: Context panel (desktop) */}
                {!isMobile && (
                  <div className="w-[40%] space-y-4">
                    {/* Concept summary */}
                    {planningSession.concept && (
                      <GlassCard hover={false} className="space-y-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                          核心概念
                        </h4>
                        <div className="space-y-1 text-[11px]">
                          <div className="p-2 rounded-lg bg-amber-50/50">
                            <span className="text-amber-600 font-medium">主題：</span>
                            {planningSession.concept.theme}
                          </div>
                          <div className="p-2 rounded-lg bg-amber-50/50">
                            <span className="text-amber-600 font-medium">核心情感：</span>
                            {planningSession.concept.coreEmotion}
                          </div>
                          <div className="p-2 rounded-lg bg-amber-50/50">
                            <span className="text-amber-600 font-medium">目標觀眾：</span>
                            {planningSession.concept.targetAudience}
                          </div>
                        </div>
                      </GlassCard>
                    )}

                    {/* Outline summary */}
                    {planningSession.outline && (
                      <GlassCard hover={false} className="space-y-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                          故事大綱
                        </h4>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {planningSession.outline.synopsis}
                        </p>
                        {planningSession.outline.keyTurningPoints.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold text-muted-foreground">
                              關鍵轉折
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {planningSession.outline.keyTurningPoints.map(
                                (tp, i) => (
                                  <span
                                    key={i}
                                    className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700"
                                  >
                                    {tp}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        )}
                      </GlassCard>
                    )}

                    {/* Scenes list */}
                    {planningSession.scenes.length > 0 && (
                      <GlassCard hover={false} className="space-y-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <Film className="w-3.5 h-3.5 text-purple-500" />
                          場景列表 ({planningSession.scenes.length})
                        </h4>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {planningSession.scenes.map((scene, i) => (
                            <div
                              key={scene.id}
                              className="p-2 rounded-lg bg-purple-50/40 text-[11px]"
                            >
                              <span className="font-medium">
                                #{i + 1} {scene.title}
                              </span>
                              <span className="text-muted-foreground ml-1.5">
                                — {scene.mood}
                              </span>
                            </div>
                          ))}
                        </div>
                      </GlassCard>
                    )}

                    {/* Emotional depth analysis */}
                    {planningSession.warmthScore != null && (
                      <GlassCard hover={false} className="space-y-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <ThermometerSun className="w-3.5 h-3.5 text-rose-500" />
                          情感深度分析
                        </h4>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">溫度</span>
                          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-rose-300 to-rose-500 transition-all"
                              style={{
                                width: `${(planningSession.warmthScore / 10) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs font-bold text-rose-600">
                            {planningSession.warmthScore}/10
                          </span>
                        </div>
                        {planningSession.emotionalBeats.length > 0 && (
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {planningSession.emotionalBeats.map((beat, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-rose-50/40"
                              >
                                <CircleDot className="w-3 h-3 text-rose-400 shrink-0" />
                                <span className="font-medium">{beat.label}</span>
                                <span className="text-muted-foreground">{beat.emotion}</span>
                                <span className="ml-auto text-rose-600 font-bold">
                                  {beat.intensity}/10
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {planningSession.depthAnalysis && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed p-2 rounded-lg bg-muted/20">
                            {planningSession.depthAnalysis}
                          </p>
                        )}
                      </GlassCard>
                    )}

                    {/* Milestones */}
                    {planningSession.milestones.length > 0 && (
                      <GlassCard hover={false} className="space-y-2">
                        <h4 className="text-xs font-semibold flex items-center gap-1.5">
                          <Milestone className="w-3.5 h-3.5 text-teal-500" />
                          里程碑
                        </h4>
                        <div className="space-y-1.5">
                          {planningSession.milestones.map(m => (
                            <div
                              key={m.id}
                              className="flex items-center gap-2 text-[11px]"
                            >
                              {m.completed ? (
                                <CheckCircle2 className="w-3 h-3 text-green-500" />
                              ) : (
                                <CircleDot className="w-3 h-3 text-teal-400" />
                              )}
                              <span
                                className={
                                  m.completed
                                    ? "line-through text-muted-foreground"
                                    : ""
                                }
                              >
                                {m.title}
                              </span>
                              {m.targetDate && (
                                <span className="text-[10px] text-muted-foreground ml-auto">
                                  {new Date(m.targetDate).toLocaleDateString("zh-TW")}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </GlassCard>
                    )}
                  </div>
                )}
              </div>

              {/* Mobile: Context panels below discussion */}
              {isMobile && planningSession.concept && (
                <GlassCard hover={false} className="space-y-2">
                  <h4 className="text-xs font-semibold flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                    概念摘要
                  </h4>
                  <div className="text-[11px] space-y-1">
                    <div>
                      <span className="font-medium text-amber-600">主題：</span>
                      {planningSession.concept.theme}
                    </div>
                    <div>
                      <span className="font-medium text-amber-600">核心情感：</span>
                      {planningSession.concept.coreEmotion}
                    </div>
                  </div>
                </GlassCard>
              )}

              {isMobile && planningSession.warmthScore != null && (
                <GlassCard hover={false} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ThermometerSun className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-semibold">溫度分數</span>
                    <span className="text-sm font-bold text-rose-600 ml-auto">
                      {planningSession.warmthScore}/10
                    </span>
                  </div>
                </GlassCard>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <BatchGenerationDialog
        open={showBatchGeneration}
        onClose={() => setShowBatchGeneration(false)}
        segments={importedSegments}
        options={batchGenerationOptions}
        onOptionsChange={setBatchGenerationOptions}
        onStartGeneration={handleStartBatchGeneration}
        isPending={autoGenerateMut.isPending}
      />

      <GenerationProgressPanel
        tasks={generationTasks}
        onUpdate={handleGenerationTaskUpdate}
        onClear={handleClearGenerationTasks}
        onRetry={handleRetryGenerationTask}
      />
    </div>
  );
}

// ─── Session Item ───────────────────────────────────────────────────────────

const SessionItem = memo(function SessionItem({
  session,
  onLoad,
  onDelete,
}: {
  session: { id: number; title: string; createdAt: Date | string };
  onLoad: (data: string) => void;
  onDelete: (id: number) => void;
}) {
  const loadQuery = trpc.director.loadSession.useQuery(
    { id: session.id },
    { enabled: false }
  );

  const handleLoad = async () => {
    const result = await loadQuery.refetch();
    if (result.data?.sessionData) {
      onLoad(result.data.sessionData);
    } else {
      toast.error("無法載入對話");
    }
  };

  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/40 transition-colors group">
      <button onClick={handleLoad} className="flex-1 text-left min-w-0">
        <span className="text-xs font-medium truncate block">
          {session.title}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(session.createdAt).toLocaleDateString("zh-TW")}
        </span>
      </button>
      <button
        onClick={() => onDelete(session.id)}
        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all shrink-0"
        title="刪除"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
});

// ─── Planning Session Item ──────────────────────────────────────────────────

const PlanningSessionItem = memo(function PlanningSessionItem({
  session,
  onLoad,
  onDelete,
}: {
  session: { id: number; title: string; createdAt: Date | string };
  onLoad: (data: string, id?: number) => void;
  onDelete: (id: number) => void;
}) {
  const loadQuery = trpc.director.loadPlanningSession.useQuery(
    { id: session.id },
    { enabled: false }
  );

  const handleLoad = async () => {
    const result = await loadQuery.refetch();
    if (result.data?.sessionData) {
      onLoad(result.data.sessionData, session.id);
    } else {
      toast.error("無法載入規劃");
    }
  };

  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/40 transition-colors group">
      <button onClick={handleLoad} className="flex-1 text-left min-w-0">
        <span className="text-xs font-medium truncate block">
          {session.title}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(session.createdAt).toLocaleDateString("zh-TW")}
        </span>
      </button>
      <button
        onClick={() => onDelete(session.id)}
        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all shrink-0"
        title="刪除"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
});
