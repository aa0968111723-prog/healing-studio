import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProgressivePromptBuilder, createEmptyPromptOutput, type PromptBuilderOutput } from "@/components/ProgressivePromptBuilder";
import { ImageWorkspace, createDefaultImageState, type ImageWorkspaceState } from "@/components/workspaces/ImageWorkspace";
import { VideoWorkspace, createDefaultVideoState, type VideoWorkspaceState } from "@/components/workspaces/VideoWorkspace";
import { AudioWorkspace, createDefaultAudioState, type AudioWorkspaceState } from "@/components/workspaces/AudioWorkspace";
import { VoiceWorkspace, createDefaultVoiceState, type VoiceWorkspaceState } from "@/components/workspaces/VoiceWorkspace";
import { ConsistencyVault, type VaultItem } from "@/components/ConsistencyVault";
import { GenerationControls } from "@/components/GenerationControls";
import { ZenProgressOverlay, GlassCard, BottomSheet } from "@/components/ZenCoPilot";
import { toast } from "sonner";
import {
  Image, Video, Music, Mic, Wand2, Download,
  PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose,
  Layers, Settings2, Clock, Package, X, Star, Bookmark, BookmarkCheck,
  Send, RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { PROGRESS_MESSAGES } from "@shared/types";
import { PromptStrengthBar } from "@/components/PromptStrengthBar";
import ThoughtIslandChain, { type ThoughtNode } from "@/components/ThoughtIslandChain";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";
import { useLocation } from "wouter";
import type { GenerationMode, GenerationType } from "@shared/types";

// ─── Tab Config ─────────────────────────────────────────────────────────────

const MODALITY_TABS: { value: GenerationType; label: string; icon: React.ReactNode }[] = [
  { value: "image", label: "圖片", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-4 h-4" /> },
];

// ─── Mini History Panel (embedded in right drawer) ──────────────────────────

function MiniHistoryPanel({ onSendToStudio }: { onSendToStudio: (prompt: string, type: GenerationType) => void }) {
  const historyQuery = trpc.history.list.useQuery(
    { limit: 20 },
    { retry: false }
  );
  const toggleBookmark = trpc.history.toggleBookmark.useMutation({
    onSuccess: () => historyQuery.refetch(),
  });
  const rateHistory = trpc.history.rate.useMutation({
    onSuccess: () => historyQuery.refetch(),
  });

  const MODALITY_ICONS: Record<string, React.ReactNode> = {
    image: <Image className="w-3 h-3" />,
    video: <Video className="w-3 h-3" />,
    audio: <Music className="w-3 h-3" />,
    voice: <Mic className="w-3 h-3" />,
  };

  if (historyQuery.isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const items = historyQuery.data || [];

  if (!items.length) {
    return (
      <div className="p-6 text-center">
        <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">尚無生成歷史</p>
        <p className="text-xs text-muted-foreground/60 mt-1">開始創作後，歷史紀錄將顯示在這裡</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 p-2">
      {items.map((item: any) => (
        <div
          key={item.id}
          className="group rounded-lg p-2 hover:bg-accent/30 transition-colors cursor-pointer"
        >
          <div className="flex items-start gap-2">
            {/* Thumbnail */}
            {item.resultUrl && item.generationType === "image" ? (
              <img
                src={item.resultUrl}
                alt=""
                className="w-10 h-10 rounded-md object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-muted/30 flex items-center justify-center shrink-0">
                {MODALITY_ICONS[item.generationType] || <Image className="w-3 h-3" />}
              </div>
            )}

            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate leading-tight">
                {item.prompt?.slice(0, 40) || "無提示詞"}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
                {item.rating && (
                  <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
                    <Star className="w-2.5 h-2.5 fill-current" />
                    {item.rating}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBookmark.mutate({ id: item.id, isBookmarked: !item.bookmarked });
                }}
                className="p-1 rounded hover:bg-accent/50 transition-colors"
                title={item.bookmarked ? "取消收藏" : "收藏"}
              >
                {item.bookmarked ? (
                  <BookmarkCheck className="w-3 h-3 text-primary" />
                ) : (
                  <Bookmark className="w-3 h-3 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSendToStudio(item.prompt || "", item.generationType as GenerationType);
                }}
                className="p-1 rounded hover:bg-accent/50 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Drawer Shell ───────────────────────────────────────────────────────────

function DrawerPanel({
  open,
  side,
  title,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  side: "left" | "right";
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 300, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeInOut" }}
          className={`shrink-0 overflow-hidden ${side === "left" ? "order-first" : "order-last"}`}
        >
          <div
            className="h-full rounded-xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(255,255,255,0.5)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.5)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/20">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {icon}
                {title}
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-accent/50 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Studio Page ────────────────────────────────────────────────────────────

export default function Studio() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const { aiState, setAIState } = useAIState();
  const [, navigate] = useLocation();

  // ── Shared state ──
  const [activeModality, setActiveModality] = useState<GenerationType>("image");
  const [mode, setMode] = useState<GenerationMode>("lightning");
  const [promptBuilder, setPromptBuilder] = useState<PromptBuilderOutput>(createEmptyPromptOutput);
  const [temperature, setTemperature] = useState(0.5);
  const [seed, setSeed] = useState("");
  const [loraWeight, setLoraWeight] = useState(0.7);

  // ── Modality-specific state ──
  const [imageState, setImageState] = useState<ImageWorkspaceState>(createDefaultImageState);
  const [videoState, setVideoState] = useState<VideoWorkspaceState>(createDefaultVideoState);
  const [audioState, setAudioState] = useState(createDefaultAudioState);
  const [voiceState, setVoiceState] = useState(createDefaultVoiceState);

  // ── UI state ──
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [leftDrawerTab, setLeftDrawerTab] = useState<"vault" | "assets">("vault");
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [mobileDrawerSheet, setMobileDrawerSheet] = useState<"left" | "right" | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);
  const [thoughtChain, setThoughtChain] = useState<ThoughtNode[]>([]);

  // ── Progress ──
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  // ── Mutation ──
  const utils = trpc.useUtils();
  const generateMutation = trpc.generate.multimodal.useMutation({
    onMutate: () => {
      setAIState("generating");
    },
    onSuccess: (data) => {
      setResultUrl(data.resultUrl || null);
      setResultData(data.resultData);
      setThoughtChain((data as any).thoughtChain || []);
      setProgress(100);
      setProgressMessage("生成完成");
      setTimeout(() => { setProgress(0); setAIState("idle"); }, 1500);
      toast.success("生成完成");
      utils.auth.me.invalidate();
    },
    onError: (error) => {
      setProgress(0);
      setProgressMessage("");
      setAIState("idle");
      toast.error(error.message);
    },
  });

  // ── Progress simulation ──
  useEffect(() => {
    if (!generateMutation.isPending) return;
    const messages = PROGRESS_MESSAGES[activeModality] || PROGRESS_MESSAGES.image;
    let step = 0;
    const interval = setInterval(() => {
      if (step < messages.length) {
        const pct = Math.min(10 + (step + 1) * (80 / messages.length), 90);
        setProgress(Math.round(pct));
        setProgressMessage(messages[step]);
        step++;
      }
    }, 2000);
    setProgress(5);
    setProgressMessage("初始化...");
    return () => clearInterval(interval);
  }, [generateMutation.isPending, activeModality]);

  // ── Populate from Director AI ──
  useEffect(() => {
    const studioData = sessionStorage.getItem("sendToStudio");
    if (studioData) {
      try {
        const data = JSON.parse(studioData);
        if (data.prompt) {
          setPromptBuilder(prev => ({
            ...prev,
            rawPrompt: data.prompt,
            compiledPrompt: data.prompt,
          }));
        }
        if (data.generationType) setActiveModality(data.generationType);
        if (data.musicStyle) setAudioState(prev => ({ ...prev, musicStyle: data.musicStyle }));
        if (data.voiceText) setVoiceState(prev => ({ ...prev, text: data.voiceText }));
        if (data.audioScript) setVoiceState(prev => ({ ...prev, text: data.audioScript }));
        sessionStorage.removeItem("sendToStudio");
        toast.success("已從導演 AI 載入腳本");
      } catch { /* ignore */ }
    }
  }, []);

  // ── Handle Generate ──
  const handleGenerate = useCallback(() => {
    const prompt = promptBuilder.compiledPrompt || promptBuilder.rawPrompt;
    if (!prompt.trim() && activeModality !== "voice") {
      toast.error("請輸入創作描述");
      return;
    }
    if (activeModality === "voice" && !voiceState.text.trim()) {
      toast.error("請輸入要轉換為語音的文字");
      return;
    }

    generateMutation.mutate({
      prompt: activeModality === "voice" ? voiceState.text : prompt,
      generationType: activeModality,
      mode,
      vibeCardIds: promptBuilder.vibeCardIds,
      temperature,
      seed: seed ? parseInt(seed) : undefined,
      ...(activeModality === "image" && {
        aspectRatio: imageState.aspectRatio,
        negativePrompt: imageState.negativePrompt || undefined,
        styleReferenceUrl: imageState.styleReferenceUrl,
        vibeReferenceUrl: imageState.vibeReferenceUrl,
      }),
      ...(activeModality === "video" && {
        videoDurationSeconds: parseInt(videoState.duration),
        firstFrameUrl: videoState.firstFrameUrl,
        lastFrameUrl: videoState.lastFrameUrl,
        characterRefUrl: videoState.characterRefUrl,
        cameraMotion: videoState.cameraMotion,
      }),
      ...(activeModality === "audio" && {
        musicStyle: audioState.musicStyle,
        isInstrumental: audioState.isInstrumental,
        lyrics: audioState.lyrics || undefined,
        audioDuration: audioState.duration,
        audioEnergy: audioState.energy,
      }),
      ...(activeModality === "voice" && {
        voiceModelId: voiceState.voiceActorId,
        voiceText: voiceState.text,
        voiceSpeed: voiceState.speed,
        voiceStability: voiceState.stability,
        voiceEmotionType: voiceState.emotionType,
        voiceEmotionIntensity: voiceState.emotionIntensity,
      }),
    });
  }, [promptBuilder, activeModality, mode, temperature, seed, imageState, videoState, audioState, voiceState, generateMutation]);

  // ── Vault select handler ──
  const handleVaultSelect = useCallback((item: VaultItem) => {
    if (activeModality === "video") {
      if (!videoState.firstFrameUrl) {
        setVideoState(prev => ({ ...prev, firstFrameUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為首幀`);
      } else if (!videoState.characterRefUrl) {
        setVideoState(prev => ({ ...prev, characterRefUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為角色參考`);
      } else {
        toast.info("首幀和角色參考已設定，請先清除再載入");
      }
    } else if (activeModality === "image") {
      if (!imageState.styleReferenceUrl) {
        setImageState(prev => ({ ...prev, styleReferenceUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為風格參考`);
      } else {
        toast.info("風格參考已設定，請先清除再載入");
      }
    }
    if (isMobile) setMobileDrawerSheet(null);
  }, [activeModality, videoState, imageState, isMobile]);

  // ── History → Studio handler ──
  const handleHistoryToStudio = useCallback((prompt: string, type: GenerationType) => {
    setPromptBuilder(prev => ({ ...prev, rawPrompt: prompt, compiledPrompt: prompt }));
    setActiveModality(type);
    setRightDrawerOpen(false);
    toast.success("已載入歷史提示詞");
  }, []);

  const showLoraWeight = activeModality === "video"
    ? !!(videoState.firstFrameUrl || videoState.characterRefUrl)
    : activeModality === "image"
    ? !!(imageState.styleReferenceUrl)
    : false;

  return (
    <div className="space-y-4">
      <ZenProgressOverlay
        visible={generateMutation.isPending}
        progress={progress}
        message={progressMessage}
      />

      {/* ── Header with drawer toggles ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <VisualSoul size="sm" state={aiState} />
          <div>
            <h1 className="text-lg font-semibold text-foreground tracking-tight">創作工作室</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              配額 <span className="tabular-nums font-medium">{user?.remainingGenerations ?? 0}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Left drawer toggle: Vault + Assets */}
          <Button
            variant={leftDrawerOpen ? "default" : "outline"}
            size="sm"
            className="rounded-xl gap-1.5 text-xs h-8"
            onClick={() => isMobile ? setMobileDrawerSheet("left") : setLeftDrawerOpen(!leftDrawerOpen)}
          >
            {leftDrawerOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">素材庫</span>
          </Button>

          {/* Controls (mobile only) */}
          {isMobile && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1.5 text-xs h-8"
              onClick={() => setControlsSheetOpen(true)}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
          )}

          {/* Right drawer toggle: History */}
          <Button
            variant={rightDrawerOpen ? "default" : "outline"}
            size="sm"
            className="rounded-xl gap-1.5 text-xs h-8"
            onClick={() => isMobile ? setMobileDrawerSheet("right") : setRightDrawerOpen(!rightDrawerOpen)}
          >
            {rightDrawerOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">歷史</span>
          </Button>
        </div>
      </div>

      {/* ── Main Layout with Drawers ── */}
      <div className="flex gap-4">
        {/* ── Left Drawer: Vault + Assets ── */}
        {!isMobile && (
          <DrawerPanel
            open={leftDrawerOpen}
            side="left"
            title={leftDrawerTab === "vault" ? "一致性保險庫" : "數位資產"}
            icon={leftDrawerTab === "vault" ? <Layers className="w-4 h-4 text-primary" /> : <Package className="w-4 h-4 text-primary" />}
            onClose={() => setLeftDrawerOpen(false)}
          >
            {/* Tab switcher inside drawer */}
            <div className="px-2 pt-2">
              <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30">
                <button
                  onClick={() => setLeftDrawerTab("vault")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "vault" ? "bg-white shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Layers className="w-3 h-3 inline mr-1" />
                  保險庫
                </button>
                <button
                  onClick={() => setLeftDrawerTab("assets")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "assets" ? "bg-white shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Package className="w-3 h-3 inline mr-1" />
                  資產
                </button>
              </div>
            </div>

            {leftDrawerTab === "vault" ? (
              <ConsistencyVault onSelect={handleVaultSelect} compact />
            ) : (
              <MiniAssetsPanel />
            )}
          </DrawerPanel>
        )}

        {/* ── Center: Main Canvas ── */}
        <div className="flex-1 space-y-4 min-w-0">
          {/* Modality Tabs */}
          <Tabs
            value={activeModality}
            onValueChange={(v) => setActiveModality(v as GenerationType)}
          >
            <TabsList className="w-full grid grid-cols-4 h-auto rounded-xl p-1" style={{
              background: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.5)",
            }}>
              {MODALITY_TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm flex items-center gap-1.5 text-xs py-2.5 transition-all"
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Progressive Prompt Builder */}
          {activeModality !== "voice" && (
            <GlassCard hover={false}>
              <ProgressivePromptBuilder
                value={promptBuilder}
                onChange={setPromptBuilder}
                modality={activeModality}
              />
              <div className="mt-3 pt-3 border-t border-border/20">
                <PromptStrengthBar
                  prompt={promptBuilder.compiledPrompt || promptBuilder.rawPrompt}
                  modality={activeModality as "image" | "video" | "audio" | "voice"}
                  onApplyOptimized={(optimized) => {
                    setPromptBuilder(prev => ({
                      ...prev,
                      rawPrompt: optimized,
                      compiledPrompt: optimized,
                    }));
                    toast.success("已套用 AI 優化提示詞");
                  }}
                />
              </div>
            </GlassCard>
          )}

          {/* Modality-Specific Workspace */}
          <GlassCard hover={false}>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {activeModality === "image" && <><Image className="w-4 h-4 text-primary" /> 圖片工作區</>}
                {activeModality === "video" && <><Video className="w-4 h-4 text-primary" /> 影片工作區 (Veo 3.1)</>}
                {activeModality === "audio" && <><Music className="w-4 h-4 text-primary" /> 音樂工作區 (Suno)</>}
                {activeModality === "voice" && <><Mic className="w-4 h-4 text-primary" /> 語音工作區 (ElevenLabs)</>}
              </h3>
              <div className="h-px bg-border/30 my-3" />

              {activeModality === "image" && (
                <ImageWorkspace value={imageState} onChange={setImageState} />
              )}
              {activeModality === "video" && (
                <VideoWorkspace value={videoState} onChange={setVideoState} />
              )}
              {activeModality === "audio" && (
                <AudioWorkspace value={audioState} onChange={setAudioState} />
              )}
              {activeModality === "voice" && (
                <VoiceWorkspace value={voiceState} onChange={setVoiceState} />
              )}
            </div>
          </GlassCard>

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full h-12 rounded-xl text-sm font-medium gap-2 shadow-md hover:shadow-lg transition-all"
          >
            <Wand2 className="w-4 h-4" />
            {generateMutation.isPending ? "生成中..." : "開始創作"}
          </Button>

          {/* Thought Island Chain - elevated visibility */}
          <AnimatePresence>
            {(thoughtChain.length > 0 || generateMutation.isPending) && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.4 }}
              >
                <ThoughtIslandChain
                  nodes={thoughtChain.length > 0 ? thoughtChain : [
                    { id: "safety", label: "安全檢查", status: "processing", detail: "正在驗證...", timestamp: Date.now() },
                    { id: "compile", label: "提示詞編譯", status: "queued", detail: "等待中...", timestamp: Date.now() },
                    { id: "generate", label: "AI 生成", status: "queued", detail: "等待中...", timestamp: Date.now() },
                  ]}
                  isVisible={true}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result Preview */}
          <AnimatePresence>
            {(resultUrl || resultData) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground">生成結果</h3>
                  {resultUrl && (
                    <div className="rounded-xl overflow-hidden shadow-sm">
                      <img src={resultUrl} alt="Generated" className="w-full object-cover" />
                    </div>
                  )}
                  {resultData && (
                    <div className="text-xs text-muted-foreground space-y-1.5 p-3 rounded-lg bg-muted/20">
                      {resultData.videoStatus != null && (
                        <p className="flex items-center gap-2">
                          <Video className="w-3 h-3" />
                          影片：{String(resultData.videoStatus)}
                        </p>
                      )}
                      {resultData.audioStatus != null && (
                        <p className="flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          音樂：{String(resultData.audioStatus)}
                        </p>
                      )}
                      {resultData.voiceStatus != null && (
                        <p className="flex items-center gap-2">
                          <Mic className="w-3 h-3" />
                          語音：{String(resultData.voiceStatus)}
                        </p>
                      )}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    className="w-full rounded-xl gap-2 text-sm"
                    onClick={() => toast.info("ZIP 匯出功能即將推出")}
                  >
                    <Download className="w-4 h-4" />
                    匯出 ZIP 包
                  </Button>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right Panel: Controls (desktop) ── */}
        {!isMobile && (
          <div className="hidden lg:block w-64 shrink-0 space-y-4">
            <GlassCard hover={false}>
              <GenerationControls
                temperature={temperature}
                onTemperatureChange={setTemperature}
                seed={seed}
                onSeedChange={setSeed}
                mode={mode}
                onModeChange={setMode}
                loraWeight={loraWeight}
                onLoraWeightChange={setLoraWeight}
                showLoraWeight={showLoraWeight}
              />
            </GlassCard>
          </div>
        )}

        {/* ── Right Drawer: History ── */}
        {!isMobile && (
          <DrawerPanel
            open={rightDrawerOpen}
            side="right"
            title="生成歷史"
            icon={<Clock className="w-4 h-4 text-primary" />}
            onClose={() => setRightDrawerOpen(false)}
          >
            <MiniHistoryPanel onSendToStudio={handleHistoryToStudio} />
          </DrawerPanel>
        )}
      </div>

      {/* ── Mobile Bottom Sheets ── */}
      {isMobile && (
        <>
          <BottomSheet
            open={controlsSheetOpen}
            onClose={() => setControlsSheetOpen(false)}
            title="生成參數"
          >
            <GenerationControls
              temperature={temperature}
              onTemperatureChange={setTemperature}
              seed={seed}
              onSeedChange={setSeed}
              mode={mode}
              onModeChange={setMode}
              loraWeight={loraWeight}
              onLoraWeightChange={setLoraWeight}
              showLoraWeight={showLoraWeight}
            />
          </BottomSheet>

          <BottomSheet
            open={mobileDrawerSheet === "left"}
            onClose={() => setMobileDrawerSheet(null)}
            title="素材庫"
          >
            <div className="flex gap-1 p-2 mb-2">
              <button
                onClick={() => setLeftDrawerTab("vault")}
                className={`flex-1 text-xs py-2 rounded-lg transition-colors ${
                  leftDrawerTab === "vault" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground"
                }`}
              >
                保險庫
              </button>
              <button
                onClick={() => setLeftDrawerTab("assets")}
                className={`flex-1 text-xs py-2 rounded-lg transition-colors ${
                  leftDrawerTab === "assets" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground"
                }`}
              >
                資產
              </button>
            </div>
            {leftDrawerTab === "vault" ? (
              <ConsistencyVault onSelect={handleVaultSelect} />
            ) : (
              <MiniAssetsPanel />
            )}
          </BottomSheet>

          <BottomSheet
            open={mobileDrawerSheet === "right"}
            onClose={() => setMobileDrawerSheet(null)}
            title="生成歷史"
          >
            <MiniHistoryPanel onSendToStudio={handleHistoryToStudio} />
          </BottomSheet>
        </>
      )}
    </div>
  );
}

// ─── Mini Assets Panel (embedded in left drawer) ────────────────────────────

function MiniAssetsPanel() {
  const myAssetsQuery = trpc.assets.myAssets.useQuery(undefined, { retry: false });

  if (myAssetsQuery.isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const assets = myAssetsQuery.data || [];

  if (!assets.length) {
    return (
      <div className="p-6 text-center">
        <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">尚無數位資產</p>
        <p className="text-xs text-muted-foreground/60 mt-1">生成作品後會自動保存至此</p>
      </div>
    );
  }

  const ASSET_ICONS: Record<string, React.ReactNode> = {
    image: <Image className="w-3 h-3" />,
    video: <Video className="w-3 h-3" />,
    audio: <Music className="w-3 h-3" />,
    voice: <Mic className="w-3 h-3" />,
  };

  return (
    <div className="space-y-1 p-2">
      {assets.slice(0, 20).map((asset: any) => (
        <div
          key={asset.id}
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/30 transition-colors cursor-pointer"
        >
          {asset.thumbnailUrl ? (
            <img src={asset.thumbnailUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
              {ASSET_ICONS[asset.type] || <Package className="w-3 h-3" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground truncate">{asset.name || "未命名"}</p>
            <p className="text-[10px] text-muted-foreground">{asset.type}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
