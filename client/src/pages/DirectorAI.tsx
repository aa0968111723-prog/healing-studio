import { useState, useCallback, useEffect, useMemo, memo } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { AIChatBox, type Message } from "@/components/AIChatBox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Clapperboard, Send, Image, Music, Mic,
  Brain, Palette, Wrench, MessageCircleQuestion,
  BookTemplate, Save, FolderOpen, Trash2,
  Pencil, Copy, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import type { CoStarScript } from "@shared/types";

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

  // ─── Preferences persistence (DB) ─────────────────────────────────────────
  const prefsQuery = trpc.director.preferences.get.useQuery(undefined, { retry: false });
  const updatePrefs = trpc.director.preferences.update.useMutation({
    onSuccess: () => prefsQuery.refetch(),
    onError: (err) => toast.error("偏好儲存失敗：" + err.message),
  });
  const [preferredFormat, setPreferredFormat] = useState<"co-star" | "sslcm" | "selcm" | "free">("co-star");

  // Sync DB → local state on first load
  useEffect(() => {
    if (prefsQuery.data) {
      const dbPersonality = (prefsQuery.data.personality as Personality) || "creative";
      setPersonality(dbPersonality);
      setGlobalPersonality(dbPersonality);
      setPreferredFormat((prefsQuery.data.preferredFormat as typeof preferredFormat) || "co-star");
    }
  }, [prefsQuery.data, setGlobalPersonality]);

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

  // ─── Memoized values ─────────────────────────────────────────────────────

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

      {/* Personality Selector + Preferred Format */}
      <GlassCard hover={false} className="space-y-4">
        <h3 className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
          <Palette className="w-3.5 h-3.5" />
          導演偏好
        </h3>
        <div className={cn("flex gap-2", isMobile && "flex-col")}>
          {PERSONALITIES.map((p) => {
            const isActive = personality === p.id;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setPersonality(p.id);
                  setGlobalPersonality(p.id);
                  updatePrefs.mutate({ personality: p.id });
                }}
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

        {/* Preferred Framework */}
        <div>
          <span className="text-[10px] font-medium text-muted-foreground block mb-2">偏好框架</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              { value: "co-star", label: "CO-STAR" },
              { value: "sslcm", label: "SSLCM" },
              { value: "selcm", label: "SELCM" },
              { value: "free", label: "自由格式" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setPreferredFormat(opt.value);
                  updatePrefs.mutate({ preferredFormat: opt.value });
                }}
                className={cn(
                  "p-2.5 rounded-lg text-center text-xs font-medium transition-all border",
                  preferredFormat === opt.value
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-white/30 text-muted-foreground border-white/50 hover:bg-white/50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      <p className="text-xs text-muted-foreground">
        雙引擎 RAG（事實研究 + CO-STAR 創意編排）— 腳本可一鍵發送到工作室，也可微調修改
      </p>

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
