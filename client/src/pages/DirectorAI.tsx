import { useState, useCallback, useEffect, useMemo, memo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Clapperboard, Send, Image, Music, Mic,
  Brain, Palette, Wrench, MessageCircleQuestion,
  BookTemplate, Save, FolderOpen, Trash2,
  Pencil, Copy, ChevronDown, ChevronUp, X,
  Upload, FileText, Download, CheckCircle2,
  MessageSquare, Zap, Heart, Timer, Shuffle,
  Settings, Wand2, Sun, Volume2, Headphones,
  Camera, Sparkles, Eye, Play, ChevronRight,
  BarChart3, ArrowUp, ArrowDown, Layers, Users,
  MapPin, Tag,
} from "lucide-react";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { CoStarScript, ScriptSegment, ScriptOverview, QuickAction } from "@shared/types";

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
  "ad": "廣告",
  "meditation": "冥想",
  "music-video": "MV",
  "tutorial": "教學",
  "brand": "品牌",
};

// ─── Quick Action Icon Map ──────────────────────────────────────────────────

const QUICK_ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
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

const QUICK_ACTION_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  visual: { label: "視覺", color: "bg-blue-100 text-blue-700" },
  audio: { label: "音頻", color: "bg-purple-100 text-purple-700" },
  narrative: { label: "敘事", color: "bg-amber-100 text-amber-700" },
  technical: { label: "技術", color: "bg-emerald-100 text-emerald-700" },
  mood: { label: "氛圍", color: "bg-pink-100 text-pink-700" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: "待分析", color: "bg-gray-100 text-gray-600", icon: Timer },
  draft: { label: "草稿", color: "bg-yellow-100 text-yellow-700", icon: Pencil },
  refined: { label: "已優化", color: "bg-blue-100 text-blue-700", icon: Eye },
  approved: { label: "已確認", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
};

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

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setScriptContent(text);
        if (!scriptTitle) {
          // Extract filename without extension, handling edge cases like hidden files
          const dotIdx = file.name.lastIndexOf(".");
          const baseName = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
          setScriptTitle(baseName || "未命名腳本");
        }
        // Auto-detect format
        if (file.name.endsWith(".srt")) setSourceFormat("srt");
        else if (file.name.endsWith(".fdx")) setSourceFormat("fdx");
        else if (file.name.endsWith(".fountain")) setSourceFormat("screenplay");
        toast.success(`已載入 ${file.name}`);
      }
    };
    reader.onerror = () => {
      toast.error("檔案讀取失敗，請確認檔案格式正確");
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [scriptTitle]);

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
        <h3 className="text-sm font-semibold flex items-center gap-2">
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
          onChange={(e) => setScriptTitle(e.target.value)}
          placeholder="例：品牌宣傳短片 V2"
          className="w-full rounded-lg border border-border/50 bg-white/50 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Format selector */}
      <div className="space-y-1.5">
        <Label className="text-xs">來源格式</Label>
        <div className="flex flex-wrap gap-1.5">
          {FORMAT_OPTIONS.map((fmt) => (
            <button
              key={fmt.value}
              onClick={() => setSourceFormat(fmt.value)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all",
                sourceFormat === fmt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/50 border-border/50 hover:bg-white/80 text-muted-foreground",
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
          onChange={(e) => setScriptContent(e.target.value)}
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
        "border-current/10",
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
  const [selectedAction, setSelectedAction] = useState<QuickAction | null>(null);
  const [showAllActions, setShowAllActions] = useState(false);
  const [showGenPipeline, setShowGenPipeline] = useState(false);
  const [showCostar, setShowCostar] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const config = PERSONALITIES.find((p) => p.id === personality) ?? PERSONALITIES[1];

  const discussMut = trpc.director.discussSegment.useMutation({
    onSuccess: (data) => {
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
    onError: (e) => toast.error("討論失敗：" + e.message),
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
      prevSegment: adjacentSegments?.prev ? { index: adjacentSegments.prev.index, storyboard: adjacentSegments.prev.storyboard } : undefined,
      nextSegment: adjacentSegments?.next ? { index: adjacentSegments.next.index, storyboard: adjacentSegments.next.storyboard } : undefined,
    });

    setInputMessage("");
    setSelectedAction(null);
  }, [inputMessage, selectedAction, segment, personality, discussMut, onUpdateSegment, adjacentSegments]);

  const handleQuickAction = useCallback((action: QuickAction) => {
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
      prevSegment: adjacentSegments?.prev ? { index: adjacentSegments.prev.index, storyboard: adjacentSegments.prev.storyboard } : undefined,
      nextSegment: adjacentSegments?.next ? { index: adjacentSegments.next.index, storyboard: adjacentSegments.next.storyboard } : undefined,
    });
  }, [segment, personality, discussMut, onUpdateSegment, adjacentSegments]);

  // Group quick actions by category
  const groupedActions = useMemo(() => {
    const groups: Record<string, QuickAction[]> = {};
    quickActions.forEach(a => {
      if (!groups[a.category]) groups[a.category] = [];
      groups[a.category].push(a);
    });
    return groups;
  }, [quickActions]);

  const displayedActions = showAllActions ? quickActions : quickActions.slice(0, 6);
  const statusCfg = STATUS_CONFIG[segment.status];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
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
          <span className="text-xs font-bold text-muted-foreground">#{segment.index + 1}</span>
          <span className="text-sm font-semibold truncate max-w-[200px]">{segment.storyboard.sceneHeading}</span>
          {statusCfg && (
            <span className={cn("inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium", statusCfg.color)}>
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
                  : "text-muted-foreground/50 border-transparent hover:border-border/50",
              )}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Character & location tags */}
      {((segment.characters?.length ?? 0) > 0 || (segment.locations?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {segment.characters?.map(c => (
            <span key={c} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
              <Users className="w-2.5 h-2.5" />{c}
            </span>
          ))}
          {segment.locations?.map(l => (
            <span key={l} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
              <MapPin className="w-2.5 h-2.5" />{l}
            </span>
          ))}
        </div>
      )}

      {/* Storyboard info */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {[
          { label: "視覺", value: segment.storyboard.visualDescription, icon: Eye },
          { label: "對白", value: segment.storyboard.dialogue, icon: MessageSquare },
          { label: "音效", value: segment.storyboard.soundDesign, icon: Volume2 },
          { label: "鏡頭", value: segment.storyboard.cameraDirection, icon: Camera },
          { label: "時長", value: segment.storyboard.duration, icon: Timer },
          { label: "氛圍", value: segment.storyboard.mood, icon: Heart },
        ].map((item) => (
          <div key={item.label} className="flex items-start gap-1.5 p-2 rounded-lg bg-muted/20">
            <item.icon className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <span className="text-muted-foreground font-medium">{item.label}</span>
              <p className="text-foreground/80 leading-relaxed line-clamp-2">{item.value || "—"}</p>
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
              <Badge variant="secondary" className="text-[8px] h-4 px-1 bg-green-100 text-green-700">已生成</Badge>
            ) : (
              <Badge variant="outline" className="text-[8px] h-4 px-1 text-amber-600 border-amber-300">未生成</Badge>
            )}
            {showCostar ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
                  { label: "R 回應", value: segment.costar.proactiveQuestion ?? "" },
                ].map((item) => (
                  <div key={item.label} className="flex gap-2 text-[10px]">
                    <span className="font-bold text-primary/70 w-12 shrink-0">{item.label}</span>
                    <span className="text-foreground/70 leading-relaxed line-clamp-2">{item.value || "—"}</span>
                  </div>
                ))}
                {segment.costar.visualPrompt && (
                  <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100 mt-1">
                    <span className="text-[9px] font-bold text-blue-600 block mb-0.5">Visual Prompt</span>
                    <p className="text-[10px] text-blue-800/70 leading-relaxed line-clamp-3">{segment.costar.visualPrompt}</p>
                  </div>
                )}
                {segment.costar.musicVibe && (
                  <div className="p-2 rounded-lg bg-purple-50/50 border border-purple-100">
                    <span className="text-[9px] font-bold text-purple-600 block mb-0.5">Music Vibe</span>
                    <p className="text-[10px] text-purple-800/70 leading-relaxed line-clamp-2">{segment.costar.musicVibe}</p>
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
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">快選動作</span>
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
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 inline-block", catCfg?.color)}>
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
                  : "bg-muted/30 border border-border/30 mr-4",
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
              <VisualSoul size="sm" personality={personality} state="thinking" />
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
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="輸入討論內容，或直接點擊快選動作..."
          disabled={discussMut.isPending}
          className="flex-1 rounded-lg border border-border/50 bg-white/50 px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={discussMut.isPending || (!inputMessage.trim() && !selectedAction)}
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
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
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
  const modelOptions = useMemo(() => {
    const data = modelsQuery.data;
    if (!data) return {};
    return {
      image: data["text-to-image"] ?? [],
      video: data["text-to-video"] ?? [],
      audio: data["text-to-audio"] ?? [],
      voice: data["text-to-speech"] ?? [],
    } as Record<string, Array<{
      modelId: string;
      label: string;
      provider: string;
      tier: string;
      basePoints: number;
      unit: string;
      available: boolean;
      pointsPerSecond?: number;
      pointsPer1kChars?: number;
    }>>;
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

  // Set default model selections when models load
  useEffect(() => {
    if (!modelsQuery.data) return;
    const defaults: Record<string, string> = {};
    for (const [modality, models] of Object.entries(modelOptions)) {
      if (!selectedModels[modality] && models.length > 0) {
        // Pick first available model, or first model
        const avail = models.find(m => m.available);
        defaults[modality] = avail?.modelId ?? models[0].modelId;
      }
    }
    if (Object.keys(defaults).length > 0) {
      setSelectedModels(prev => ({ ...prev, ...defaults }));
    }
  }, [modelsQuery.data, modelOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback((task: GenerationTask) => {
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
    sessionStorage.setItem("sendToStudio", JSON.stringify({
      prompt: task.prompt,
      generationType: task.modality,
      overrideEngine: modelId,
      // Include context metadata for studio
      musicStyle: task.modality === "audio" ? task.prompt : undefined,
      audioScript: task.modality === "voice" ? task.prompt : undefined,
      segmentContext: {
        sceneHeading: segment.storyboard.sceneHeading,
        mood: segment.storyboard.mood,
        duration: segment.storyboard.duration,
      },
    }));
    navigate("/studio");
    toast.success(`已發送「${task.labelZh}」到工作室（${selectedModels[task.modality]}）`);
  }, [selectedModels, segment, navigate]);

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

    sessionStorage.setItem("sendToStudio", JSON.stringify({
      prompt: activeTasks[0].prompt,
      generationType: activeTasks[0].modality,
      overrideEngine: selectedModels[activeTasks[0].modality],
      musicStyle: activeTasks.find(t => t.modality === "audio")?.prompt,
      audioScript: activeTasks.find(t => t.modality === "voice")?.prompt,
      batchTasks: batch,
      segmentContext: {
        sceneHeading: segment.storyboard.sceneHeading,
        mood: segment.storyboard.mood,
        duration: segment.storyboard.duration,
      },
    }));
    navigate("/studio");
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
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scene context */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-2.5 py-1.5">
        <Clapperboard className="w-3 h-3 shrink-0" />
        <span className="truncate">
          #{segment.index + 1} {segment.storyboard.sceneHeading} · {segment.storyboard.mood} · {segment.storyboard.duration}
        </span>
        {!segment.costar && (
          <Badge variant="outline" className="text-[8px] h-4 px-1 shrink-0 text-amber-600 border-amber-300">
            建議先生成 CO-STAR
          </Badge>
        )}
      </div>

      {/* Generation tasks */}
      <div className="space-y-2.5">
        {tasks.map((task) => {
          const TaskIcon = task.icon;
          const models = modelOptions[task.modality] ?? [];
          const selectedModel = models.find(m => m.modelId === selectedModels[task.modality]);
          const hasPrompt = !!task.prompt.trim();

          return (
            <div
              key={task.modality}
              className={cn(
                "rounded-xl border p-3 transition-all",
                task.enabled
                  ? "border-border/50 bg-white/40"
                  : "border-transparent bg-muted/10 opacity-50",
              )}
            >
              {/* Task header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEnabledTasks(prev => ({ ...prev, [task.modality]: !prev[task.modality] }))}
                    className={cn(
                      "w-5 h-5 rounded-md border flex items-center justify-center transition-all",
                      task.enabled
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border/50 bg-white/30",
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
                  <span className={cn("text-[10px] font-medium", TIER_COLORS[selectedModel.tier] ?? "text-muted-foreground")}>
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
                    <Label className="text-[10px] text-muted-foreground">選擇模型</Label>
                    {modelsQuery.isLoading ? (
                      <div className="text-[10px] text-muted-foreground animate-pulse">載入模型中...</div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {models.map(m => {
                          const isSelected = selectedModels[task.modality] === m.modelId;
                          return (
                            <button
                              key={m.modelId}
                              onClick={() => setSelectedModels(prev => ({ ...prev, [task.modality]: m.modelId }))}
                              disabled={!m.available}
                              className={cn(
                                "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all",
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                  : m.available
                                    ? "bg-white/50 border-border/40 hover:bg-white/80 text-muted-foreground hover:text-foreground"
                                    : "bg-muted/20 border-border/20 text-muted-foreground/40 cursor-not-allowed line-through",
                              )}
                              title={`${m.label} — ${m.basePoints} pts/${m.unit}${!m.available ? " (不可用)" : ""}`}
                            >
                              <span>{m.label}</span>
                              <span className={cn("text-[9px]", TIER_COLORS[m.tier] ?? "")}>
                                {m.basePoints}pt
                              </span>
                            </button>
                          );
                        })}
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
          <span className="font-medium">{enabledCount}</span> 個任務 ·
          預估 <span className="font-semibold text-foreground">{totalCost}</span> pts
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
    onSuccess: (data) => {
      const fmtInfo = EXPORT_FORMATS.find(f => f.value === data.format);
      const ext = fmtInfo?.ext ?? ".txt";
      const blob = new Blob([data.content], { type: "text/plain;charset=utf-8" });
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
    onError: (e) => toast.error("匯出失敗：" + e.message),
  });

  const handleExport = useCallback(() => {
    exportMut.mutate({
      segments,
      format: selectedFormat as "json" | "csv" | "markdown" | "fdx" | "srt" | "custom",
      includeDiscussion,
      includeCostar,
      ...(selectedFormat === "custom" ? { customTemplate } : {}),
      ...(selectedFormat === "csv" ? { customColumns } : {}),
    });
  }, [segments, selectedFormat, includeDiscussion, includeCostar, customTemplate, customColumns, exportMut]);

  return (
    <GlassCard hover={false} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Download className="w-4 h-4" />
          匯出腳本
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Format selector */}
      <div className="space-y-1.5">
        <Label className="text-xs">匯出格式</Label>
        <div className="flex flex-wrap gap-1.5">
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt.value}
              onClick={() => setSelectedFormat(fmt.value)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                selectedFormat === fmt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white/50 border-border/50 hover:bg-white/80 text-muted-foreground",
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
          <Label htmlFor="inc-discussion" className="text-xs">含討論紀錄</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="inc-costar"
            checked={includeCostar}
            onCheckedChange={setIncludeCostar}
          />
          <Label htmlFor="inc-costar" className="text-xs">含 CO-STAR</Label>
        </div>
      </div>

      {/* Custom template editor */}
      {selectedFormat === "custom" && (
        <div className="space-y-1.5">
          <Label className="text-xs">自訂模板（可用變數：{'{{index}}, {{sceneHeading}}, {{visualDescription}}, {{dialogue}}, {{soundDesign}}, {{cameraDirection}}, {{duration}}, {{mood}}'}）</Label>
          <Textarea
            value={customTemplate}
            onChange={(e) => setCustomTemplate(e.target.value)}
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
                  onChange={(e) => {
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
                  onChange={(e) => {
                    const next = [...customColumns];
                    next[i] = { ...next[i], field: e.target.value };
                    setCustomColumns(next);
                  }}
                  className="flex-1 rounded border border-border/50 px-2 py-1 text-[11px] bg-white/50"
                  placeholder="欄位名（如 sceneHeading）"
                />
                <button
                  onClick={() => setCustomColumns(customColumns.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setCustomColumns([...customColumns, { header: "", field: "" }])}
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
  personality,
  onDismiss,
  onUse,
}: {
  question: string;
  personality: Personality;
  onDismiss: () => void;
  onUse: (q: string) => void;
}) {
  const config = PERSONALITIES.find((p) => p.id === personality) ?? PERSONALITIES[1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={cn(
        "rounded-xl p-3.5 border shadow-sm",
        config.bgActive,
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br text-white",
          config.color,
        )}>
          <MessageCircleQuestion className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wider", config.textColor)}>
            導演主動提問
          </span>
          <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
            {question}
          </p>
          <button
            onClick={() => onUse(question)}
            className={cn(
              "mt-2 text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors",
              "hover:bg-white/60 border-current/20",
              config.textColor,
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
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
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
              ].map((item) => (
                <div key={item.label} className="flex gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground w-8 shrink-0">{item.label}</span>
                  <span className="text-xs text-foreground leading-relaxed">{item.value}</span>
                </div>
              ))}
            </div>

            {/* Visual prompt preview */}
            {script.visualPrompt && (
              <div className="mt-2 p-2 rounded-lg bg-muted/30 border border-border/30">
                <span className="text-[10px] font-medium text-muted-foreground block mb-1">Visual Prompt</span>
                <p className="text-[11px] text-foreground/70 leading-relaxed line-clamp-3">{script.visualPrompt}</p>
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
  const [, navigate] = useLocation();
  const { setAIState, personality: globalPersonality, setPersonality: setGlobalPersonality } = useAIState();
  const [personality, setPersonality] = useState<Personality>(globalPersonality);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "system",
      content: PERSONALITY_SYSTEM_PROMPTS[globalPersonality] ?? PERSONALITY_SYSTEM_PROMPTS.creative,
    },
  ]);

  // When personality changes, update the system prompt
  useEffect(() => {
    setMessages((prev) => {
      const nonSystem = prev.filter((m) => m.role !== "system");
      return [
        { role: "system", content: PERSONALITY_SYSTEM_PROMPTS[personality] ?? PERSONALITY_SYSTEM_PROMPTS.creative },
        ...nonSystem,
      ];
    });
  }, [personality]);

  const [saveToNotes, setSaveToNotes] = useState(false);
  const [scripts, setScripts] = useState<CoStarScript[]>([]);
  const [showStoryboard, setShowStoryboard] = useState(!isMobile);
  const [proactiveQuestion, setProactiveQuestion] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [refiningIdx, setRefiningIdx] = useState<number | null>(null);

  // ─── Script Analysis State ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [importedSegments, setImportedSegments] = useState<ScriptSegment[]>([]);
  const [importedTitle, setImportedTitle] = useState("");
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState<number | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [scriptOverview, setScriptOverview] = useState<ScriptOverview | null>(null);
  const [showOverview, setShowOverview] = useState(false);

  // ─── tRPC hooks ──────────────────────────────────────────────────────────

  const templatesQuery = trpc.director.templates.useQuery(undefined, { staleTime: Infinity });
  const sessionsQuery = trpc.director.listSessions.useQuery(undefined, { enabled: showSessions });
  const saveSessionMut = trpc.director.saveSession.useMutation({
    onSuccess: () => {
      toast.success("對話已儲存");
      sessionsQuery.refetch();
    },
    onError: (e) => toast.error("儲存失敗：" + e.message),
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
    onSuccess: (data) => {
      setImportedSegments(data.segments);
      setImportedTitle(data.title);
      if (data.segments.length > 0) {
        setSelectedSegmentIdx(0);
      }
      toast.success(`已匯入「${data.title}」— 分析出 ${data.segments.length} 個分鏡段落`);
    },
    onError: (e) => toast.error("匯入失敗：" + e.message),
  });

  // CO-STAR generation for individual segments
  const generateCostarMut = trpc.director.generateSegmentCostar.useMutation({
    onSuccess: (data, vars) => {
      setImportedSegments(prev => prev.map(s =>
        s.id === vars.segment.id ? { ...s, costar: data as CoStarScript } : s
      ));
      toast.success("CO-STAR 已生成");
    },
    onError: (e) => toast.error("CO-STAR 生成失敗：" + e.message),
  });

  // Batch CO-STAR generation
  const batchCostarMut = trpc.director.batchGenerateCostar.useMutation({
    onSuccess: (data) => {
      const results = data.results ?? {};
      setImportedSegments(prev => prev.map(s => {
        const entry = results[s.id];
        if (!entry || typeof entry !== "object" || !("context" in entry)) return s;
        return { ...s, costar: entry as unknown as CoStarScript };
      }));
      const count = Object.keys(results).length;
      toast.success(`已批次生成 ${count} 個 CO-STAR`);
    },
    onError: (e) => toast.error("批次生成失敗：" + e.message),
  });

  // Script overview analysis
  const overviewMut = trpc.director.analyzeScriptOverview.useMutation({
    onSuccess: (data) => {
      setScriptOverview(data as ScriptOverview);
      setShowOverview(true);
      toast.success("腳本全局分析完成");
    },
    onError: (e) => toast.error("分析失敗：" + e.message),
  });

  const chatMutation = trpc.director.chat.useMutation({
    onMutate: () => setAIState("thinking"),
    onSuccess: (data) => {
      setAIState("idle");
      const scriptSummary = data.script
        ? `\n\n---\n**CO-STAR 腳本已生成**\n\n| 欄位 | 內容 |\n|------|------|\n| 背景 | ${data.script.context} |\n| 情境 | ${data.script.situation} |\n| 任務 | ${data.script.task} |\n| 行動 | ${data.script.action} |\n| 結果 | ${data.script.result} |\n\n**視覺提示詞：** ${data.script.visualPrompt}\n\n**語音腳本：** ${data.script.audioScript}\n\n**音樂風格：** ${data.script.musicVibe}`
        : "";

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: (data.research || "已完成分析。") + scriptSummary,
        },
      ]);
      if (data.script) {
        setScripts((prev) => [...prev, data.script as CoStarScript]);
        if (!showStoryboard && !isMobile) setShowStoryboard(true);
        if (data.script.proactiveQuestion) {
          setProactiveQuestion(data.script.proactiveQuestion);
        }
      }
      if (saveToNotes) {
        toast.success("腳本已儲存至專案筆記");
      }
    },
    onError: (error) => {
      setAIState("idle");
      toast.error(error.message);
    },
  });

  const refineMutation = trpc.director.refineScript.useMutation({
    onSuccess: (data, vars) => {
      if (refiningIdx !== null) {
        setScripts((prev) => {
          const next = [...prev];
          next[refiningIdx] = data as CoStarScript;
          return next;
        });
        toast.success("腳本已更新");
      }
      setRefiningIdx(null);
    },
    onError: (e) => {
      toast.error("微調失敗：" + e.message);
      setRefiningIdx(null);
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleSend = useCallback((content: string) => {
    setProactiveQuestion(null);
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content },
    ];
    setMessages(newMessages);
    chatMutation.mutate({
      messages: newMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      saveToNotes,
      personality,
    });
  }, [messages, saveToNotes, personality, chatMutation]);

  const handleSendToStudio = useCallback((script: CoStarScript) => {
    sessionStorage.setItem("sendToStudio", JSON.stringify({
      prompt: script.visualPrompt,
      generationType: "multimodal",
      musicStyle: script.musicVibe,
      audioScript: script.audioScript,
    }));
    navigate("/studio");
    toast.success("腳本已發送到工作室");
  }, [navigate]);

  const handleRefineScript = useCallback((script: CoStarScript, idx: number) => {
    const instruction = window.prompt("請輸入修改指示（例如：讓氛圍更溫暖、加入慢動作鏡頭）");
    if (!instruction?.trim()) return;
    setRefiningIdx(idx);
    refineMutation.mutate({ script, instruction, personality });
  }, [personality, refineMutation]);

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
    navigator.clipboard.writeText(text).then(() => toast.success("已複製到剪貼簿"));
  }, []);

  const handleSaveSession = useCallback(() => {
    const title = window.prompt("為這段對話命名", `導演對話 ${new Date().toLocaleDateString("zh-TW")}`);
    if (!title?.trim()) return;
    const sessionData = JSON.stringify({
      messages: messages.filter(m => m.role !== "system"),
      scripts,
      personality,
    });
    saveSessionMut.mutate({ title, sessionData, personality });
  }, [messages, scripts, personality, saveSessionMut]);

  const handleLoadSession = useCallback((sessionData: string) => {
    try {
      const data = JSON.parse(sessionData);
      if (data.personality) {
        setPersonality(data.personality);
        setGlobalPersonality(data.personality);
      }
      if (Array.isArray(data.messages)) {
        setMessages([
          { role: "system", content: PERSONALITY_SYSTEM_PROMPTS[data.personality as Personality] ?? PERSONALITY_SYSTEM_PROMPTS.creative },
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
  }, [setGlobalPersonality]);

  const handleUseTemplate = useCallback((prompt: string, templatePersonality: Personality) => {
    setPersonality(templatePersonality);
    setGlobalPersonality(templatePersonality);
    setShowTemplates(false);
    // Trigger send after a short delay so personality state settles
    setTimeout(() => handleSend(prompt), 50);
  }, [setGlobalPersonality, handleSend]);

  // ─── Script Analysis Handlers ───────────────────────────────────────────

  const handleImportScript = useCallback((content: string, title: string, format: string) => {
    importScriptMut.mutate({
      rawContent: content,
      title,
      sourceFormat: format,
      personality,
    });
  }, [personality, importScriptMut]);

  const handleUpdateSegment = useCallback((updated: ScriptSegment) => {
    setImportedSegments(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, []);

  const handleSegmentStatusChange = useCallback((segId: string, status: ScriptSegment["status"]) => {
    setImportedSegments(prev => prev.map(s => s.id === segId ? { ...s, status } : s));
  }, []);

  const handleNavigateSegment = useCallback((direction: "prev" | "next") => {
    setSelectedSegmentIdx(prev => {
      if (prev === null) return null;
      const next = direction === "prev" ? prev - 1 : prev + 1;
      if (next < 0 || next >= importedSegments.length) return prev;
      return next;
    });
  }, [importedSegments.length]);

  const handleGenerateCostar = useCallback((segmentId: string) => {
    const seg = importedSegments.find(s => s.id === segmentId);
    if (!seg) return;
    generateCostarMut.mutate({
      segment: {
        id: seg.id,
        index: seg.index,
        rawText: seg.rawText,
        storyboard: seg.storyboard,
        discussion: seg.discussion.map(d => ({ role: d.role, content: d.content })),
        characters: seg.characters,
        locations: seg.locations,
      },
      personality,
    });
  }, [importedSegments, personality, generateCostarMut]);

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

  const handleMoveSegment = useCallback((fromIdx: number, direction: "up" | "down") => {
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
  }, [importedSegments.length, selectedSegmentIdx]);

  // ─── Memoized values ─────────────────────────────────────────────────────

  const scriptStats = useMemo(() => {
    if (importedSegments.length === 0) return null;
    const approved = importedSegments.filter(s => s.status === "approved").length;
    const refined = importedSegments.filter(s => s.status === "refined").length;
    const withCostar = importedSegments.filter(s => !!s.costar).length;
    const moods = new Map<string, number>();
    importedSegments.forEach(s => {
      const m = s.storyboard.mood;
      if (m) moods.set(m, (moods.get(m) ?? 0) + 1);
    });
    return { approved, refined, withCostar, total: importedSegments.length, moods };
  }, [importedSegments]);

  const currentPersonality = useMemo(
    () => PERSONALITIES.find((p) => p.id === personality) ?? PERSONALITIES[1],
    [personality],
  );

  const suggestedPrompts = useMemo(() => [
    "幫我構思一部創意短片",
    "我想製作一段冥想引導音頻",
    "設計一個品牌宣傳影片腳本",
  ], []);

  const hasConversation = messages.filter(m => m.role !== "system").length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Clapperboard className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">導演 AI</h1>
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
            currentPersonality.bgActive, currentPersonality.textColor,
          )}>
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
            onClick={() => { setShowTemplates(!showTemplates); setShowSessions(false); }}
          >
            <BookTemplate className="w-3.5 h-3.5" />
            {isMobile ? "" : "模板"}
          </Button>
          {/* Session Management */}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1"
            onClick={() => { setShowSessions(!showSessions); setShowTemplates(false); }}
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
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <BookTemplate className="w-4 h-4" />
                  模板庫 — 快速開始
                </h3>
                <button onClick={() => setShowTemplates(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className={cn("grid gap-2", isMobile ? "grid-cols-1" : "grid-cols-2 lg:grid-cols-3")}>
                {(templatesQuery.data ?? []).map((t) => {
                  const pConfig = PERSONALITIES.find(p => p.id === t.personality) ?? PERSONALITIES[1];
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleUseTemplate(t.prompt, t.personality as Personality)}
                      className="text-left rounded-xl border border-border/50 p-3 hover:bg-white/60 transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded",
                          pConfig.bgActive, pConfig.textColor,
                        )}>
                          {CATEGORY_LABELS[t.category] ?? t.category}
                        </span>
                        <span className="text-xs font-semibold group-hover:text-primary transition-colors">
                          {t.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                        {t.description}
                      </p>
                    </button>
                  );
                })}
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
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <FolderOpen className="w-4 h-4" />
                  已儲存對話
                </h3>
                <button onClick={() => setShowSessions(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {sessionsQuery.isLoading && (
                <p className="text-xs text-muted-foreground py-4 text-center">載入中...</p>
              )}
              {sessionsQuery.data?.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  還沒有儲存的對話。對話後點擊「儲存」按鈕來保存。
                </p>
              )}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {(sessionsQuery.data ?? []).map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    onLoad={handleLoadSession}
                    onDelete={(id) => deleteSessionMut.mutate({ id })}
                  />
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Personality Selector */}
      <div className={cn("flex gap-2", isMobile && "flex-col")}>
        {PERSONALITIES.map((p) => {
          const isActive = personality === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => { setPersonality(p.id); setGlobalPersonality(p.id); }}
              className={cn(
                "flex-1 rounded-xl p-3 transition-all border text-left",
                isActive
                  ? cn(p.bgActive, "ring-2 shadow-sm")
                  : "bg-white/40 border-white/60 hover:bg-white/60",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className={cn(
                  "w-6 h-6 rounded-lg flex items-center justify-center bg-gradient-to-br text-white",
                  p.color,
                )}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className={cn(
                  "text-xs font-semibold",
                  isActive ? p.textColor : "text-foreground",
                )}>
                  {p.label}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {p.description}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        雙引擎 RAG（事實研究 + CO-STAR 創意編排）— 腳本可一鍵發送到工作室，也可微調修改
      </p>

      {/* Main Tab System */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-white/50 border border-border/30 rounded-xl p-1">
          <TabsTrigger value="chat" className="rounded-lg text-xs gap-1.5 data-[state=active]:shadow-sm">
            <MessageSquare className="w-3.5 h-3.5" />
            對話模式
          </TabsTrigger>
          <TabsTrigger value="script" className="rounded-lg text-xs gap-1.5 data-[state=active]:shadow-sm">
            <FileText className="w-3.5 h-3.5" />
            腳本分析
            {importedSegments.length > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-1">
                {importedSegments.length}
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
                onUse={(q) => { setProactiveQuestion(null); handleSend(q); }}
              />
            )}
          </AnimatePresence>

          {/* Split-Screen Layout */}
          <div className="flex gap-5">
            {/* Left: Chat Panel */}
            <div className={`flex-1 transition-all ${showStoryboard && !isMobile ? "max-w-[55%]" : ""}`}>
              {/* Orb thinking indicator above chat */}
              {chatMutation.isPending && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 mb-2 px-1"
                >
                  <VisualSoul size="sm" personality={personality} state="thinking" />
                  <span className="text-xs text-muted-foreground animate-pulse">導演 AI 正在思考中...</span>
                </motion.div>
              )}
              <AIChatBox
                messages={messages}
                onSendMessage={handleSend}
                isLoading={chatMutation.isPending}
                placeholder="描述你的創作構想...（Ctrl+Enter 發送）"
                height={isMobile ? "calc(100vh - 480px)" : "calc(100vh - 400px)"}
                emptyStateMessage="告訴導演 AI 你的創作構想，或從模板庫選擇一個起點"
                suggestedPrompts={suggestedPrompts}
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
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <VisualSoul size="sm" personality={personality} />
                        Storyboard
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        {scripts.length} 個腳本
                      </span>
                    </div>

                    <ScrollArea className="h-[calc(100vh-480px)]">
                      {scripts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <VisualSoul size="md" personality={personality} />
                          <p className="text-sm text-muted-foreground mt-4">
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
                              isRefining={refiningIdx === idx && refineMutation.isPending}
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
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <VisualSoul size="sm" personality={personality} />
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
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                        {scriptStats.approved} 已確認
                      </Badge>
                      <Badge variant="outline" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
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
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          全局分析
                        </h3>
                        <button onClick={() => setShowOverview(false)} className="text-muted-foreground hover:text-foreground">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                        <div className="p-2 rounded-lg bg-blue-50/50 border border-blue-100">
                          <span className="text-blue-600 font-semibold block text-[10px]">總時長</span>
                          <span className="text-blue-800 font-bold">{scriptOverview.totalDuration}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-purple-50/50 border border-purple-100">
                          <span className="text-purple-600 font-semibold block text-[10px]">核心主題</span>
                          <span className="text-purple-800">{scriptOverview.themes.join("、")}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-green-50/50 border border-green-100">
                          <span className="text-green-600 font-semibold block text-[10px]">角色數</span>
                          <span className="text-green-800 font-bold">{scriptOverview.characters.length}</span>
                        </div>
                        <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-100">
                          <span className="text-amber-600 font-semibold block text-[10px]">場景數</span>
                          <span className="text-amber-800 font-bold">{scriptOverview.locations.length}</span>
                        </div>
                      </div>
                      {/* Characters */}
                      {scriptOverview.characters.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> 角色分佈</span>
                          <div className="flex flex-wrap gap-1.5">
                            {scriptOverview.characters.map(c => (
                              <span key={c.name} className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                                {c.name} <span className="text-blue-400">({c.segmentIndices.length}段)</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Mood distribution */}
                      {Object.keys(scriptOverview.moodDistribution).length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1"><Tag className="w-3 h-3" /> 氛圍分佈</span>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(scriptOverview.moodDistribution).map(([mood, count]) => (
                              <span key={mood} className="text-[10px] px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 border border-pink-200">
                                {mood} ×{count}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Pacing notes */}
                      {scriptOverview.pacingNotes && (
                        <div className="p-2.5 rounded-lg bg-muted/20 text-[11px] leading-relaxed text-foreground/80">
                          <span className="font-semibold text-muted-foreground block mb-1">節奏分析</span>
                          {scriptOverview.pacingNotes}
                        </div>
                      )}
                      {/* Overall suggestion */}
                      {scriptOverview.overallSuggestion && (
                        <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/10 text-[11px] leading-relaxed text-foreground/80">
                          <span className="font-semibold text-primary/70 block mb-1">改善建議</span>
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
                <div className={cn("shrink-0", isMobile ? "w-full" : "w-[280px]")}>
                  <GlassCard hover={false} className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      分鏡列表
                    </h4>
                    <ScrollArea className={isMobile ? "max-h-[200px]" : "h-[calc(100vh-420px)]"}>
                      <div className="space-y-1.5 pr-1">
                        {importedSegments.map((seg, idx) => {
                          const sCfg = STATUS_CONFIG[seg.status];
                          const isSelected = selectedSegmentIdx === idx;
                          return (
                            <div key={seg.id} className="flex items-stretch gap-0.5">
                              {/* Reorder controls */}
                              <div className="flex flex-col justify-center gap-0.5 opacity-0 hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleMoveSegment(idx, "up"); }}
                                  disabled={idx === 0}
                                  className="p-0.5 rounded hover:bg-muted/40 disabled:opacity-20 text-muted-foreground"
                                  title="上移"
                                >
                                  <ArrowUp className="w-2.5 h-2.5" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleMoveSegment(idx, "down"); }}
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
                                    : "bg-white/30 border-transparent hover:bg-white/60 hover:border-border/30",
                                )}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-bold text-muted-foreground">
                                      #{idx + 1}
                                    </span>
                                    {seg.costar && (
                                      <span title="已有 CO-STAR"><Layers className="w-2.5 h-2.5 text-green-500" /></span>
                                    )}
                                  </div>
                                  {sCfg && (
                                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium", sCfg.color)}>
                                      {sCfg.label}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-medium truncate">{seg.storyboard.sceneHeading}</p>
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                  {seg.storyboard.mood} · {seg.storyboard.duration}
                                </p>
                                {/* Character tags in segment list */}
                                {(seg.characters?.length ?? 0) > 0 && (
                                  <div className="flex flex-wrap gap-0.5 mt-1">
                                    {seg.characters!.slice(0, 3).map(c => (
                                      <span key={c} className="text-[8px] px-1 py-0 rounded bg-blue-50 text-blue-600">{c}</span>
                                    ))}
                                    {(seg.characters?.length ?? 0) > 3 && (
                                      <span className="text-[8px] text-muted-foreground">+{seg.characters!.length - 3}</span>
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
                  {selectedSegmentIdx !== null && importedSegments[selectedSegmentIdx] ? (
                    <GlassCard hover={false}>
                      <SegmentDiscussionPanel
                        key={importedSegments[selectedSegmentIdx].id}
                        segment={importedSegments[selectedSegmentIdx]}
                        personality={personality}
                        quickActions={quickActionsQuery.data ?? []}
                        onUpdateSegment={handleUpdateSegment}
                        onStatusChange={(status) =>
                          handleSegmentStatusChange(importedSegments[selectedSegmentIdx].id, status)
                        }
                        onNavigate={handleNavigateSegment}
                        adjacentSegments={{
                          prev: selectedSegmentIdx > 0 ? importedSegments[selectedSegmentIdx - 1] : undefined,
                          next: selectedSegmentIdx < importedSegments.length - 1 ? importedSegments[selectedSegmentIdx + 1] : undefined,
                        }}
                        onGenerateCostar={() => handleGenerateCostar(importedSegments[selectedSegmentIdx].id)}
                        isGeneratingCostar={generateCostarMut.isPending}
                      />
                    </GlassCard>
                  ) : (
                    <GlassCard hover={false}>
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        <Play className="w-8 h-8 text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">
                          從左側選擇一個分鏡段落開始討論
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">
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
      </Tabs>
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
    { enabled: false },
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
      <button
        onClick={handleLoad}
        className="flex-1 text-left min-w-0"
      >
        <span className="text-xs font-medium truncate block">{session.title}</span>
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
