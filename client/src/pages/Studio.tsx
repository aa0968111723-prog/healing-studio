import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
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
  Image, Video, Music, Mic, Wand2, Download, Copy,
  PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose,
  Layers, Settings2, Clock, Package, X, Star, Bookmark, BookmarkCheck,
  Send, RefreshCw, StickyNote, Cpu, Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { PROGRESS_MESSAGES } from "@shared/types";
import { PromptStrengthBar, type SuggestionAction } from "@/components/PromptStrengthBar";
import ThoughtIslandChain, { type ThoughtNode } from "@/components/ThoughtIslandChain";
import { useAIState } from "@/contexts/AIStateContext";
import { usePersonality } from "@/contexts/PersonalityContext";
import VisualSoul from "@/components/VisualSoul";
import { useLocation } from "wouter";
import { useShowcaseTransfer } from "@/contexts/ShowcaseTransferContext";
import type { GenerationMode, GenerationType } from "@shared/types";
import JSZip from "jszip";

import ProactiveOrbWidget from "@/components/ProactiveOrbWidget";
import OnboardingTour from "@/components/OnboardingTour";
import { useNotesDrawer } from "@/contexts/NotesDrawerContext";
import { requireAuth } from "@/components/AuthExpiredModal";

// ─── Tab Config ─────────────────────────────────────────────────────────────

const MODALITY_TABS: { value: GenerationType; label: string; icon: React.ReactNode }[] = [
  { value: "image", label: "圖片", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-4 h-4" /> },
];

// ─── Mini History Panel (embedded in right drawer) ──────────────────────────

function MiniHistoryPanel({ onSendToStudio }: { onSendToStudio: (prompt: string, type: GenerationType, parameterSnapshot?: Record<string, unknown>) => void }) {
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
                loading="lazy"
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
            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBookmark.mutate({ id: item.id, isBookmarked: !item.bookmarked });
                }}
                className="p-1.5 rounded hover:bg-accent/50 active:bg-accent/70 transition-colors"
                title={item.bookmarked ? "取消收藏" : "收藏"}
              >
                {item.bookmarked ? (
                  <BookmarkCheck className="w-4 h-4 text-primary" />
                ) : (
                  <Bookmark className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSendToStudio(item.prompt || "", item.generationType as GenerationType, item.parameterSnapshot as Record<string, unknown> | undefined);
                }}
                className="p-1.5 rounded hover:bg-accent/50 active:bg-accent/70 transition-colors"
                title="重新生成"
              >
                <RefreshCw className="w-4 h-4 text-muted-foreground" />
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
          animate={{ width: "min(300px, 85vw)", opacity: 1 }}
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
                className="p-2 rounded-md hover:bg-accent/50 active:bg-accent/70 transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
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

  // 全站新手引導
  usePageTour("studio");

  // ── Online status ──
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Style preset injection (from ImageWorkspace quick-select chips) ──
  useEffect(() => {
    const handleStylePreset = (e: Event) => {
      const preset = (e as CustomEvent<string>).detail;
      if (!preset) return;
      setPromptBuilder(prev => {
        const separator = prev.rawPrompt.trim() ? ", " : "";
        const newPrompt = prev.rawPrompt.trim() + separator + preset;
        return { ...prev, rawPrompt: newPrompt, compiledPrompt: newPrompt };
      });
      toast.success("已套用風格描述");
    };
    window.addEventListener("apply-style-preset", handleStylePreset);
    return () => window.removeEventListener("apply-style-preset", handleStylePreset);
  }, []);
  const { aiState, setAIState, personality, reportTyping, reportFailure, reportSuccess, resetIdle } = useAIState();
  const { onGenerationStart: notifyGenStart, onGenerationDone: notifyGenDone, onGenerationFail: notifyGenFail, onTyping: notifyTyping, onAdvancedParams: notifyAdvancedParams } = usePersonality();
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

  // ── Vault & Model injection state ──
  const [vaultCharacterId, setVaultCharacterId] = useState<number | undefined>(undefined);
  const [vaultSceneId, setVaultSceneId] = useState<number | undefined>(undefined);
  const [fineTunedModelId, setFineTunedModelId] = useState<number | undefined>(undefined);
  const [fineTunedModelName, setFineTunedModelName] = useState<string | undefined>(undefined);

  // ── UI state ──
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [leftDrawerTab, setLeftDrawerTab] = useState<"vault" | "assets" | "models">("vault");
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [controlsSheetOpen, setControlsSheetOpen] = useState(false);
  const [mobileDrawerSheet, setMobileDrawerSheet] = useState<"left" | "right" | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(null);
  const [thoughtChain, setThoughtChain] = useState<ThoughtNode[]>([]);

  // ── Progress ──
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  // ── Brain Pricing Summary (show engine name + cost in UI) ──
  const pricingSummaryQuery = trpc.brain.pricingSummary.useQuery(
    { durationSec: parseInt(videoState.duration) || 5, charCount: voiceState.text?.length || 100 },
    { retry: false, staleTime: 30_000 }
  );
  const currentEngine = pricingSummaryQuery.data?.[activeModality as "image" | "video" | "audio" | "voice"];

  // ── Mutation ──
  const utils = trpc.useUtils();
  const sseRef = useRef<EventSource | null>(null);
  const prepareJobMutation = trpc.generate.prepareJob.useMutation();
  const generateMutation = trpc.generate.multimodal.useMutation({
    onMutate: () => {
      setAIState("generating");
      notifyGenStart();
      setProgress(2);
      setProgressMessage("初始化...");
      setThoughtChain([]);
    },
    onSuccess: (data) => {
      setResultUrl(data.resultUrl || null);
      setResultData(data.resultData);
      // Final thoughtChain from server (authoritative) — merge with SSE updates
      if ((data as any).thoughtChain?.length) {
        setThoughtChain((data as any).thoughtChain);
      }
      setProgress(100);
      setProgressMessage("生成完成");
      setTimeout(() => { setProgress(0); setAIState("idle"); notifyGenDone(); }, 1500);
      toast.success("生成完成");
      reportSuccess();
      utils.auth.me.invalidate();
      // Close SSE connection
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    },
    onError: (error) => {
      setProgress(0);
      setProgressMessage("");
      setAIState("idle");
      notifyGenFail();
      // Zero-Anxiety error handling: classify error and show friendly message
      const msg = error.message || "";
      const isTimeout = /timeout|timed? ?out|ETIMEDOUT|aborted|abort/i.test(msg);
      const isNetwork = /network|fetch|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION/i.test(msg);
      const isQuota = /配額|不足|積分/i.test(msg);
      if (isQuota) {
        toast.error(msg);
      } else if (isTimeout) {
        toast.error("AI 服務回應超時\n\n我們並未扣除您的積分，請稍後重試", { duration: 6000 });
      } else if (isNetwork) {
        toast.error("網路連線稍微異常\n\n我們並未扣除您的積分，請檢查網路後重試", { duration: 6000 });
      } else {
        toast.error(`AI 服務連線稍微異常\n\n我們並未扣除您的積分，請稍後重試`, { duration: 6000 });
      }
      reportFailure();
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    },
  });

  // ── SSE connection for real-time thought chain updates ──
  const connectSSE = useCallback((jobId: number) => {
    if (sseRef.current) { sseRef.current.close(); }
    const es = new EventSource(`/api/generation-events/${jobId}`);
    sseRef.current = es;
    es.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type === "thought-update" && event.node) {
          setThoughtChain(prev => {
            const idx = prev.findIndex(n => n.id === event.node.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = event.node;
              return updated;
            }
            return [...prev, event.node];
          });
        } else if (event.type === "progress") {
          setProgress(event.progress);
          setProgressMessage(event.message);
        } else if (event.type === "complete" || event.type === "error") {
          es.close();
          sseRef.current = null;
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      // SSE connection lost — fall back to mutation result
      es.close();
      sseRef.current = null;
    };
  }, []);

  // Clean up SSE on unmount
  useEffect(() => {
    return () => { if (sseRef.current) { sseRef.current.close(); } };
  }, []);

  // ── Populate from Showcase Transfer (完全解構 JSON 還原) ──
  const { consumePayload } = useShowcaseTransfer();
  useEffect(() => {
    const showcaseData = consumePayload();
    if (showcaseData) {
      // Set modality
      setActiveModality(showcaseData.modality);

      // Restore compiled prompt
      if (showcaseData.originalPrompt || showcaseData.deconstructedBlocks?.compiledPrompt) {
        const prompt = showcaseData.deconstructedBlocks?.compiledPrompt || showcaseData.originalPrompt || "";
        setPromptBuilder(prev => ({
          ...prev,
          rawPrompt: prompt,
          compiledPrompt: prompt,
          // Restore vibe card selections
          ...(showcaseData.deconstructedBlocks?.vibeCards?.length && {
            vibeCardIds: showcaseData.deconstructedBlocks.vibeCards,
          }),
          // Restore freeform prompt
          ...(showcaseData.deconstructedBlocks?.freeformPrompt && {
            rawPrompt: showcaseData.deconstructedBlocks.freeformPrompt,
          }),
        }));
      }

      // Restore negative prompt for image modality
      if (showcaseData.modality === "image" && showcaseData.deconstructedBlocks?.negativePrompt) {
        setImageState(prev => ({
          ...prev,
          negativePrompt: showcaseData.deconstructedBlocks!.negativePrompt,
          // Use showcase image as style reference
          ...(showcaseData.imageUrl && { styleReferenceUrl: showcaseData.imageUrl }),
        }));
      }

      // Restore video first frame from showcase image
      if (showcaseData.modality === "video" && showcaseData.imageUrl) {
        setVideoState(prev => ({ ...prev, firstFrameUrl: showcaseData.imageUrl }));
      }

      // Restore technical parameters from deconstructed blocks
      if (showcaseData.deconstructedBlocks?.parameters) {
        const params = showcaseData.deconstructedBlocks.parameters;
        if (params.temperature != null) setTemperature(Number(params.temperature));
        if (params.seed != null) setSeed(String(params.seed));
        if (params.loraWeight != null) setLoraWeight(Number(params.loraWeight));
        if (params.mode === "lightning" || params.mode === "deep_precision") {
          setMode(params.mode as GenerationMode);
        }
        // Image-specific
        if (showcaseData.modality === "image") {
          setImageState(prev => ({
            ...prev,
            ...(params.aspectRatio != null && { aspectRatio: String(params.aspectRatio) }),
          }));
        }
        // Audio-specific
        if (showcaseData.modality === "audio") {
          setAudioState(prev => ({
            ...prev,
            ...(params.musicStyle != null && { musicStyle: String(params.musicStyle) }),
            ...(params.isInstrumental != null && { isInstrumental: Boolean(params.isInstrumental) }),
            ...(params.lyrics != null && { lyrics: String(params.lyrics) }),
          }));
        }
        // Voice-specific
        if (showcaseData.modality === "voice") {
          setVoiceState(prev => ({
            ...prev,
            ...(params.voiceText != null && { text: String(params.voiceText) }),
          }));
        }
      }

      toast.success(`已載入「${showcaseData.title}」的完整配方`, { duration: 4000 });
      return; // Skip sendToStudio check if showcase data was consumed
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Populate from Director AI ──
  useEffect(() => {
    const studioData = sessionStorage.getItem("sendToStudio");
    if (studioData) {
      try {
        const data = JSON.parse(studioData);
        // ── Restore prompts (prefer compiledPrompt as raw if available) ──
        if (data.prompt || data.compiledPrompt) {
          setPromptBuilder(prev => ({
            ...prev,
            rawPrompt: data.prompt || data.compiledPrompt || "",
            compiledPrompt: data.compiledPrompt || data.prompt || "",
          }));
        }
        if (data.generationType) setActiveModality(data.generationType);
        if (data.musicStyle) setAudioState(prev => ({ ...prev, musicStyle: data.musicStyle }));
        if (data.voiceText) setVoiceState(prev => ({ ...prev, text: data.voiceText }));
        if (data.audioScript) setVoiceState(prev => ({ ...prev, text: data.audioScript }));

        // ── Restore full parameter snapshot from history (cross-modal, 100% fidelity) ──
        if (data.parameterSnapshot) {
          const snap = data.parameterSnapshot as Record<string, unknown>;

          // ── Common params ──
          if (snap.temperature != null) setTemperature(Number(snap.temperature));
          if (snap.seed != null) setSeed(String(snap.seed));
          if (snap.vibeCardIds && Array.isArray(snap.vibeCardIds)) {
            setPromptBuilder(prev => ({ ...prev, vibeCardIds: snap.vibeCardIds as string[] }));
          }
          if (snap.mode === "lightning" || snap.mode === "deep_precision") setMode(snap.mode as GenerationMode);
          // ── LoRA weight ──
          if (snap.loraWeight != null) setLoraWeight(Number(snap.loraWeight));
          // ── Fine-tuned model embedded in snapshot ──
          if (snap.fineTunedModelId != null) {
            setFineTunedModelId(Number(snap.fineTunedModelId));
            if (snap.fineTunedModelName != null) setFineTunedModelName(String(snap.fineTunedModelName));
          }
          // ── Consistency Vault IDs ──
          if (snap.vaultCharacterId != null) setVaultCharacterId(Number(snap.vaultCharacterId));
          if (snap.vaultSceneId != null) setVaultSceneId(Number(snap.vaultSceneId));

          // ── Image-specific params ──
          if (data.generationType === "image") {
            setImageState(prev => ({
              ...prev,
              ...(snap.aspectRatio != null && { aspectRatio: String(snap.aspectRatio) }),
              ...(snap.negativePrompt != null && { negativePrompt: String(snap.negativePrompt) }),
              ...(snap.styleReferenceUrl != null && { styleReferenceUrl: String(snap.styleReferenceUrl) }),
              ...(snap.vibeReferenceUrl != null && { vibeReferenceUrl: String(snap.vibeReferenceUrl) }),
            }));
          }

          // ── Video-specific params ──
          if (data.generationType === "video") {
            setVideoState(prev => ({
              ...prev,
              ...(snap.videoDurationSeconds != null && { duration: String(snap.videoDurationSeconds) }),
              ...(snap.firstFrameUrl != null && { firstFrameUrl: String(snap.firstFrameUrl) }),
              ...(snap.lastFrameUrl != null && { lastFrameUrl: String(snap.lastFrameUrl) }),
              ...(snap.characterRefUrl != null && { characterRefUrl: String(snap.characterRefUrl) }),
              ...(snap.cameraMotion != null && typeof snap.cameraMotion === "object" && { cameraMotion: snap.cameraMotion as { pan: number; zoom: number; tilt: number } }),
            }));
          }

          // ── Audio-specific params ──
          if (data.generationType === "audio") {
            setAudioState(prev => ({
              ...prev,
              ...(snap.musicStyle != null && { musicStyle: String(snap.musicStyle) }),
              ...(snap.isInstrumental != null && { isInstrumental: Boolean(snap.isInstrumental) }),
              ...(snap.lyrics != null && { lyrics: String(snap.lyrics) }),
              ...(snap.audioDuration != null && { duration: Number(snap.audioDuration) }),
              ...(snap.audioEnergy != null && { energy: Number(snap.audioEnergy) }),
            }));
          }

          // ── Voice-specific params ──
          if (data.generationType === "voice") {
            setVoiceState(prev => ({
              ...prev,
              ...(snap.voiceModelId != null && { voiceActorId: String(snap.voiceModelId) }),
              ...(snap.voiceText != null && { text: String(snap.voiceText) }),
              ...(snap.voiceSpeed != null && { speed: Number(snap.voiceSpeed) }),
              ...(snap.voiceStability != null && { stability: Number(snap.voiceStability) }),
              ...(snap.voiceEmotionType != null && { emotionType: String(snap.voiceEmotionType) }),
              ...(snap.voiceEmotionIntensity != null && { emotionIntensity: Number(snap.voiceEmotionIntensity) }),
            }));
          }
        }

        // ── Restore video first frame from cross-modal reference ──
        if (data.referenceImageUrl && data.generationType === "video") {
          setVideoState(prev => ({ ...prev, firstFrameUrl: data.referenceImageUrl }));
        }

        // ── Restore image style reference from shared space ──
        if (data.referenceImageUrl && data.generationType === "image") {
          setImageState(prev => ({ ...prev, styleReferenceUrl: data.referenceImageUrl }));
        }

        // ── Restore fine-tuned model from top-level data (shared space / history) ──
        if (data.fineTunedModelId) {
          setFineTunedModelId(Number(data.fineTunedModelId));
          if (data.fineTunedModelName) setFineTunedModelName(String(data.fineTunedModelName));
        }

        sessionStorage.removeItem("sendToStudio");
        const sourceLabel = data.source === "shared_space"
          ? "已從共享空間載入素材"
          : data.source === "history" || data.source === "history_cross"
          ? "已 100% 還原生成配置，可直接重新生成"
          : "已載入參數與提示詞";
        toast.success(sourceLabel);
      } catch { /* ignore */ }
    }
  }, []);

  // ── Apply model from ModelsPage (applyModel sessionStorage) ──
  useEffect(() => {
    const applyModelData = sessionStorage.getItem("applyModel");
    if (applyModelData) {
      try {
        const data = JSON.parse(applyModelData);
        if (data.id) {
          setFineTunedModelId(Number(data.id));
          if (data.name) setFineTunedModelName(String(data.name));
          // Append triggerWord to prompt builder
          if (data.triggerWord) {
            setPromptBuilder(prev => ({
              ...prev,
              rawPrompt: prev.rawPrompt ? `${data.triggerWord}, ${prev.rawPrompt}` : data.triggerWord,
            }));
          }
        }
        sessionStorage.removeItem("applyModel");
        toast.success(`已套用模型「${data.name || "模型"}」，觸發詞已加入提示詞`);
      } catch { /* ignore */ }
    }
  }, []);

  // ── Populate from URL Query Params (光球一鍵轉接 URL 參數) ──
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const presetPrompt = params.get("preset_prompt");
      const presetModality = params.get("preset_modality");
      const presetAesthetics = params.get("preset_aesthetics");

      if (!presetPrompt && !presetModality && !presetAesthetics) return;

      // 設定模態
      if (presetModality) {
        const modalityMap: Record<string, GenerationType> = {
          image: "image", video: "video", music: "audio", audio: "audio", voice: "voice",
        };
        const target = modalityMap[presetModality.toLowerCase()];
        if (target) setActiveModality(target);
      }

      // 填入提示詞
      if (presetPrompt) {
        setPromptBuilder(prev => ({
          ...prev,
          rawPrompt: prev.rawPrompt || decodeURIComponent(presetPrompt),
        }));
      }

      // 映射美學標籤到 Vibe Cards
      if (presetAesthetics) {
        const tags = decodeURIComponent(presetAesthetics).split(",").map(t => t.trim().toLowerCase());
        const aestheticVibeMap: Record<string, string> = {
          serene: "serene", calm: "serene", warm: "warm", cozy: "warm",
          dreamy: "dreamy", ethereal: "dreamy", nature: "nature", organic: "nature",
          vintage: "vintage", retro: "vintage", minimal: "minimal", clean: "minimal",
          joyful: "joyful", happy: "joyful", mystical: "mystical", cosmic: "mystical",
        };
        const vibeIds = new Set<string>();
        for (const tag of tags) {
          if (aestheticVibeMap[tag]) vibeIds.add(aestheticVibeMap[tag]);
        }
        if (vibeIds.size > 0) {
          setPromptBuilder(prev => ({ ...prev, vibeCardIds: Array.from(vibeIds) }));
        }
      }

      // 清除 URL 參數（不觸發頁面重載）
      if (window.history.replaceState) {
        window.history.replaceState({}, "", window.location.pathname);
      }

      toast.success("光球已為你準備好創作參數", { duration: 3000, icon: "✨" });
    } catch {
      // silent
    }
  }, []);

  // ── Populate from Soul Invitation (光球推薦一鍵開局 sessionStorage) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("soul_invitation_payload");
      if (!raw) return;
      const payload = JSON.parse(raw) as {
        source: string;
        intentType: string;
        preferredModality: string;
        detectedAesthetics: string[];
        suggestedAction: string;
        actionDetail?: string;
        cardTitle?: string | null;
        confidence?: number;
      };
      if (payload.source !== "soul_invitation") return;

      // 1. 設定模態
      const modalityMap: Record<string, GenerationType> = {
        image: "image",
        video: "video",
        music: "audio",
        audio: "audio",
        voice: "voice",
      };
      const targetModality = modalityMap[payload.preferredModality];
      if (targetModality) {
        setActiveModality(targetModality);
      }

      // 2. 智慧映射 detectedAesthetics → Vibe Cards
      //    將推論出的美學標籤與 VIBE_CARDS 的 id/label/labelZh 做模糊匹配
      const aestheticToVibeMap: Record<string, string> = {
        // 直接匹配
        serene: "serene", calm: "serene", peaceful: "serene", tranquil: "serene",
        warm: "warm", cozy: "warm", comfortable: "warm", soft: "warm",
        dreamy: "dreamy", ethereal: "dreamy", surreal: "dreamy", fantasy: "dreamy",
        nature: "nature", organic: "nature", botanical: "nature", natural: "nature",
        vintage: "vintage", retro: "vintage", nostalgic: "vintage", classic: "vintage",
        minimal: "minimal", clean: "minimal", simple: "minimal", minimalist: "minimal",
        joyful: "joyful", happy: "joyful", vibrant: "joyful", colorful: "joyful", bright: "joyful",
        mystical: "mystical", mysterious: "mystical", dark: "mystical", gothic: "mystical", cosmic: "mystical",
        // 中文匹配
        "寧靜": "serene", "溫暖": "warm", "夢幻": "dreamy", "自然": "nature",
        "復古": "vintage", "極簡": "minimal", "歡愉": "joyful", "神秘": "mystical",
        // 擴展匹配
        cyberpunk: "mystical", neon: "joyful", cinematic: "mystical",
        watercolor: "dreamy", pastel: "serene", golden: "warm",
      };

      const matchedVibeIds = new Set<string>();
      if (payload.detectedAesthetics?.length) {
        for (const tag of payload.detectedAesthetics) {
          const lower = tag.toLowerCase().trim();
          // 精確匹配
          if (aestheticToVibeMap[lower]) {
            matchedVibeIds.add(aestheticToVibeMap[lower]);
          } else {
            // 模糊匹配：檢查標籤是否包含 vibe card 關鍵字
            for (const [keyword, vibeId] of Object.entries(aestheticToVibeMap)) {
              if (lower.includes(keyword) || keyword.includes(lower)) {
                matchedVibeIds.add(vibeId);
                break;
              }
            }
          }
        }
      }

      // 如果沒有匹配到任何 vibe card，根據意圖類型給一個預設
      if (matchedVibeIds.size === 0) {
        const intentDefaultVibe: Record<string, string> = {
          choice_paralysis: "dreamy",
          inspiration_seeking: "joyful",
          passive_browsing: "serene",
          aesthetic_preference: "mystical",
          exploration_mode: "joyful",
          goal_oriented: "minimal",
        };
        const defaultVibe = intentDefaultVibe[payload.intentType];
        if (defaultVibe) matchedVibeIds.add(defaultVibe);
      }

      // 3. 填充 Vibe Cards
      if (matchedVibeIds.size > 0) {
        setPromptBuilder(prev => ({
          ...prev,
          vibeCardIds: Array.from(matchedVibeIds),
        }));
      }

      // 4. 如果有 actionDetail，作為提示詞建議填入
      if (payload.actionDetail) {
        // 從 actionDetail 中提取有用的創作方向（移除指令性語句）
        const cleanedHint = payload.actionDetail
          .replace(/讓我幫你|我可以|要不要|試試看|我們/g, "")
          .replace(/^[，、。！？\s]+|[，、。！？\s]+$/g, "")
          .trim();
        if (cleanedHint.length > 2) {
          setPromptBuilder(prev => ({
            ...prev,
            rawPrompt: prev.rawPrompt || cleanedHint,
          }));
        }
      }

      // 5. 歡迎 Toast
      const cardMention = payload.cardTitle ? `「${payload.cardTitle}」` : "";
      const vibeNames = Array.from(matchedVibeIds).map(id => {
        const card = ["serene","warm","dreamy","nature","vintage","minimal","joyful","mystical"];
        const zhMap: Record<string, string> = {
          serene: "寧靜", warm: "溫暖", dreamy: "夢幻", nature: "自然",
          vintage: "復古", minimal: "極簡", joyful: "歡愉", mystical: "神秘",
        };
        return zhMap[id] || id;
      }).join("、");

      const toastMsg = cardMention
        ? `光球已為你準備好${cardMention}的創作起點${vibeNames ? ` · ${vibeNames}風格` : ""}`
        : `光球已根據你的瀏覽偏好準備好創作起點${vibeNames ? ` · ${vibeNames}風格` : ""}`;

      toast.success(toastMsg, {
        duration: 5000,
        icon: "✨",
      });

      // 6. 消費後清除 payload
      sessionStorage.removeItem("soul_invitation_payload");
    } catch {
      // silent — 不影響正常 Studio 使用
    }
  }, []);

  // ── Handle Generate ──
  const handleGenerate = useCallback(async () => {
    // Auth guard: show login modal instead of 500 error if session expired
    if (!requireAuth()) return;

    const prompt = promptBuilder.compiledPrompt || promptBuilder.rawPrompt;
    if (!prompt.trim() && activeModality !== "voice") {
      toast.error("請輸入創作描述");
      return;
    }
    if (activeModality === "voice" && !voiceState.text.trim()) {
      toast.error("請輸入要轉換為語音的文字");
      return;
    }

    const mutationInput = {
      prompt: activeModality === "voice" ? voiceState.text : prompt,
      generationType: activeModality,
      mode,
      vibeCardIds: promptBuilder.vibeCardIds,
      temperature,
      seed: seed.trim() ? (isNaN(parseInt(seed)) ? undefined : parseInt(seed)) : undefined,
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
      // Vault & Model injection
      vaultCharacterId,
      vaultSceneId,
      fineTunedModelId,
      loraWeight,
    };

    try {
      // Step 1: Pre-flight — create job + deduct points (model-based cost)
      const { jobId } = await prepareJobMutation.mutateAsync({
        generationType: activeModality,
        // Pass duration/charCount for more accurate cost estimation at deduction time
        durationSec: activeModality === "video" ? parseInt(videoState.duration) || 5
          : activeModality === "audio" ? (audioState as any).duration || 30
          : undefined,
        charCount: activeModality === "voice" ? voiceState.text?.length || undefined : undefined,
      });

      // Step 2: Connect SSE immediately so we receive real-time thought chain events
      connectSSE(jobId);

      // Step 3: Fire the actual generation mutation (SSE events stream during this call)
      await generateMutation.mutateAsync({ ...mutationInput, jobId });
    } catch {
      // Errors are handled by onError callbacks in the mutations
    }
  }, [promptBuilder, activeModality, mode, temperature, seed, imageState, videoState, audioState, voiceState, generateMutation, prepareJobMutation, connectSSE, vaultCharacterId, vaultSceneId, fineTunedModelId]);

  // ── Vault select handler ──
  const handleVaultSelect = useCallback((item: VaultItem) => {
    // Set vault ID for backend injection
    if (item.type === "character") {
      setVaultCharacterId(item.id);
    } else if (item.type === "scene") {
      setVaultSceneId(item.id);
    }

    if (activeModality === "video") {
      if (!videoState.firstFrameUrl) {
        setVideoState(prev => ({ ...prev, firstFrameUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為首幀（角色特徵將注入生成）`);
      } else if (!videoState.characterRefUrl) {
        setVideoState(prev => ({ ...prev, characterRefUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為角色參考`);
      } else {
        toast.info("首幀和角色參考已設定，請先清除再載入");
      }
    } else if (activeModality === "image") {
      if (!imageState.styleReferenceUrl) {
        setImageState(prev => ({ ...prev, styleReferenceUrl: item.imageUrl }));
        toast.success(`已將「${item.name}」設為風格參考（角色特徵將注入生成）`);
      } else {
        toast.info("風格參考已設定，請先清除再載入");
      }
    } else if (activeModality === "audio") {
      toast.success(`已綁定「${item.name}」角色特徵至音樂生成`);
    } else if (activeModality === "voice") {
      toast.success(`已綁定「${item.name}」角色特徵至語音生成`);
    }
    if (isMobile) setMobileDrawerSheet(null);
  }, [activeModality, videoState, imageState, isMobile]);

  // ── History → Studio handler (MiniHistoryPanel in right drawer) ──
  const handleHistoryToStudio = useCallback((prompt: string, type: GenerationType, parameterSnapshot?: Record<string, unknown>) => {
    setPromptBuilder(prev => ({
      ...prev,
      rawPrompt: prompt,
      compiledPrompt: prompt,
    }));
    setActiveModality(type);
    if (parameterSnapshot) {
      const snap = parameterSnapshot;
      // ── Common params ──
      if (snap.temperature != null) setTemperature(Number(snap.temperature));
      if (snap.seed != null) setSeed(String(snap.seed));
      if (snap.vibeCardIds && Array.isArray(snap.vibeCardIds)) {
        setPromptBuilder(prev => ({ ...prev, vibeCardIds: snap.vibeCardIds as string[] }));
      }
      if (snap.mode === "lightning" || snap.mode === "deep_precision") {
        setMode(snap.mode as GenerationMode);
      }
      // ── LoRA weight ──
      if (snap.loraWeight != null) setLoraWeight(Number(snap.loraWeight));
      // ── Fine-tuned model embedded in snapshot ──
      if (snap.fineTunedModelId != null) {
        setFineTunedModelId(Number(snap.fineTunedModelId));
        if (snap.fineTunedModelName != null) setFineTunedModelName(String(snap.fineTunedModelName));
      }
      // ── Consistency Vault IDs ──
      if (snap.vaultCharacterId != null) setVaultCharacterId(Number(snap.vaultCharacterId));
      if (snap.vaultSceneId != null) setVaultSceneId(Number(snap.vaultSceneId));

      // ── Image-specific params ──
      if (type === "image") {
        setImageState(prev => ({
          ...prev,
          ...(snap.aspectRatio != null && { aspectRatio: String(snap.aspectRatio) }),
          ...(snap.negativePrompt != null && { negativePrompt: String(snap.negativePrompt) }),
          ...(snap.styleReferenceUrl != null && { styleReferenceUrl: String(snap.styleReferenceUrl) }),
          ...(snap.vibeReferenceUrl != null && { vibeReferenceUrl: String(snap.vibeReferenceUrl) }),
        }));
      }

      // ── Video-specific params ──
      if (type === "video") {
        setVideoState(prev => ({
          ...prev,
          ...(snap.videoDurationSeconds != null && { duration: String(snap.videoDurationSeconds) }),
          ...(snap.firstFrameUrl != null && { firstFrameUrl: String(snap.firstFrameUrl) }),
          ...(snap.lastFrameUrl != null && { lastFrameUrl: String(snap.lastFrameUrl) }),
          ...(snap.characterRefUrl != null && { characterRefUrl: String(snap.characterRefUrl) }),
          ...(snap.cameraMotion != null && typeof snap.cameraMotion === "object" && { cameraMotion: snap.cameraMotion as { pan: number; zoom: number; tilt: number } }),
        }));
      }

      // ── Audio-specific params ──
      if (type === "audio") {
        setAudioState(prev => ({
          ...prev,
          ...(snap.musicStyle != null && { musicStyle: String(snap.musicStyle) }),
          ...(snap.isInstrumental != null && { isInstrumental: Boolean(snap.isInstrumental) }),
          ...(snap.lyrics != null && { lyrics: String(snap.lyrics) }),
          ...(snap.audioDuration != null && { duration: Number(snap.audioDuration) }),
          ...(snap.audioEnergy != null && { energy: Number(snap.audioEnergy) }),
        }));
      }

      // ── Voice-specific params ──
      if (type === "voice") {
        setVoiceState(prev => ({
          ...prev,
          ...(snap.voiceModelId != null && { voiceActorId: String(snap.voiceModelId) }),
          ...(snap.voiceText != null && { text: String(snap.voiceText) }),
          ...(snap.voiceSpeed != null && { speed: Number(snap.voiceSpeed) }),
          ...(snap.voiceStability != null && { stability: Number(snap.voiceStability) }),
          ...(snap.voiceEmotionType != null && { emotionType: String(snap.voiceEmotionType) }),
          ...(snap.voiceEmotionIntensity != null && { emotionIntensity: Number(snap.voiceEmotionIntensity) }),
        }));
      }
    }
    setRightDrawerOpen(false);
    toast.success("已 100% 還原歷史參數與提示詞");
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
          <VisualSoul size="sm" state={aiState} personality={personality} />
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
            title={leftDrawerTab === "vault" ? "一致性保險庫" : leftDrawerTab === "models" ? "角色鍛造所" : "數位資產"}
            icon={leftDrawerTab === "vault" ? <Layers className="w-4 h-4 text-primary" /> : leftDrawerTab === "models" ? <Cpu className="w-4 h-4 text-primary" /> : <Package className="w-4 h-4 text-primary" />}
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
                <button
                  onClick={() => setLeftDrawerTab("models")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "models" ? "bg-white shadow-sm text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Cpu className="w-3 h-3 inline mr-1" />
                  模型
                </button>
              </div>
            </div>

            {/* Active vault/model indicator */}
            {(vaultCharacterId || vaultSceneId || fineTunedModelId) && (
              <div className="px-3 py-1.5">
                <div className="flex flex-wrap gap-1">
                  {vaultCharacterId && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      角色已綁定
                      <button onClick={() => setVaultCharacterId(undefined)} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  )}
                  {vaultSceneId && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      場景已綁定
                      <button onClick={() => setVaultSceneId(undefined)} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  )}
                  {fineTunedModelId && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full">
                      <Cpu className="w-2.5 h-2.5" />
                      {fineTunedModelName || "微調模型"}
                      <button onClick={() => { setFineTunedModelId(undefined); setFineTunedModelName(undefined); }} className="hover:text-destructive"><X className="w-2.5 h-2.5" /></button>
                    </span>
                  )}
                </div>
              </div>
            )}

            {leftDrawerTab === "vault" ? (
              <ConsistencyVault onSelect={handleVaultSelect} compact />
            ) : leftDrawerTab === "models" ? (
              <MiniModelsPanel
                activeModelId={fineTunedModelId}
                onApply={(id, name) => { setFineTunedModelId(id); setFineTunedModelName(name); toast.success(`已套用模型「${name}」的觸發詞`); }}
                onRemove={() => { setFineTunedModelId(undefined); setFineTunedModelName(undefined); toast.info("已移除微調模型"); }}
              />
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
            <TabsList id="modality-tabs" className="w-full grid grid-cols-4 h-auto rounded-xl p-1" style={{
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

          {/* Progressive Prompt Builder — z-20 ensures Self-Attention sliders stay above ThoughtIslandChain D3 canvas */}
          {activeModality !== "voice" && (
            <GlassCard hover={false} id="prompt-builder-area" className="relative z-20">
              <ProgressivePromptBuilder
                value={promptBuilder}
                onChange={setPromptBuilder}
                modality={activeModality}
                onType={(len) => { reportTyping(len); notifyTyping(); }}
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
                  onApplyAction={(action: SuggestionAction) => {
                    switch (action.actionType) {
                      case "append_prompt": {
                        const separator = promptBuilder.rawPrompt.trim() ? ", " : "";
                        const newPrompt = promptBuilder.rawPrompt.trim() + separator + action.actionPayload;
                        setPromptBuilder(prev => ({
                          ...prev,
                          rawPrompt: newPrompt,
                          compiledPrompt: newPrompt,
                        }));
                        break;
                      }
                      case "replace_prompt": {
                        setPromptBuilder(prev => ({
                          ...prev,
                          rawPrompt: action.actionPayload,
                          compiledPrompt: action.actionPayload,
                        }));
                        break;
                      }
                      case "add_negative": {
                        if (activeModality === "image") {
                          setImageState(prev => ({
                            ...prev,
                            negativePrompt: prev.negativePrompt
                              ? prev.negativePrompt + ", " + action.actionPayload
                              : action.actionPayload,
                          }));
                        } else {
                          // For non-image modalities, append as negative context to prompt
                          const separator = promptBuilder.rawPrompt.trim() ? ", " : "";
                          const newPrompt = promptBuilder.rawPrompt.trim() + separator + "avoid: " + action.actionPayload;
                          setPromptBuilder(prev => ({
                            ...prev,
                            rawPrompt: newPrompt,
                            compiledPrompt: newPrompt,
                          }));
                        }
                        break;
                      }
                    }
                  }}
                />
              </div>
            </GlassCard>
          )}

          {/* Modality-Specific Workspace / Personality Selector */}
          <GlassCard hover={false} id="personality-selector">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {activeModality === "image" && <><Image className="w-4 h-4 text-primary" /> 圖片工作區</>}
                {activeModality === "video" && (
                  <>
                    <Video className="w-4 h-4 text-primary" /> 影片工作區
                    <span className="text-[10px] text-muted-foreground/40 font-normal" title="Powered by Veo 3.1">Veo 3.1</span>
                  </>
                )}
                {activeModality === "audio" && (
                  <>
                    <Music className="w-4 h-4 text-primary" /> 音樂工作區
                    <span className="text-[10px] text-muted-foreground/40 font-normal" title="Powered by Suno">Suno</span>
                  </>
                )}
                {activeModality === "voice" && (
                  <>
                    <Mic className="w-4 h-4 text-primary" /> 語音工作區
                    <span className="text-[10px] text-muted-foreground/40 font-normal" title="Powered by ElevenLabs">ElevenLabs</span>
                  </>
                )}
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

          {/* Engine + Cost Preview Badge */}
          {currentEngine && !generateMutation.isPending && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {currentEngine.label}
              </span>
              <span className={`flex items-center gap-1 font-medium ${
                currentEngine.estimatedPoints >= 30 ? "text-amber-500" :
                currentEngine.estimatedPoints >= 10 ? "text-blue-500" : "text-green-600"
              }`}>
                {currentEngine.estimatedPoints} pts
                {!currentEngine.available && (
                  <span className="text-destructive ml-1">（不可用）</span>
                )}
              </span>
            </div>
          )}

          {/* Generate Button */}
          <Button
            id="generate-button"
            onClick={handleGenerate}
            disabled={generateMutation.isPending || prepareJobMutation.isPending || !isOnline}
            title={!isOnline ? "目前處於離線狀態，無法生成" : undefined}
            className="w-full h-12 rounded-xl text-sm font-medium gap-2 shadow-md hover:shadow-lg transition-all"
          >
            <Wand2 className="w-4 h-4" />
            {prepareJobMutation.isPending ? "準備中..." : generateMutation.isPending ? "生成中..." : "開始創作"}
          </Button>

          {/* Thought Island Chain — z-10 below PromptBuilder's z-20 */}
          <AnimatePresence>
            {(thoughtChain.length > 0 || generateMutation.isPending) && (
              <motion.div
                className="relative z-10"
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <ThoughtIslandChain
                  nodes={thoughtChain.length > 0 ? thoughtChain : [
                    { id: "safety", label: "安全檢查", status: "processing", detail: "正在驗證...", timestamp: Date.now() },
                    { id: "compile", label: "提示詞編譯", status: "queued", detail: "等待中...", timestamp: Date.now() },
                    { id: "generate", label: "AI 生成", status: "queued", detail: "等待中...", timestamp: Date.now() },
                  ]}
                  isVisible={true}
                  onPinToNotes={(node) => {
                    const notesEvent = new CustomEvent("pin-to-notes", {
                      detail: {
                        title: `思維節點：${node.label}`,
                        content: `${node.detail}${node.reasoning ? "\n\n推理：" + node.reasoning : ""}`,
                        sourceType: "thought-chain",
                      },
                    });
                    window.dispatchEvent(notesEvent);
                    toast.success("已釘選至筆記");
                  }}
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
                      {activeModality === "video" ? (
                        <video
                          src={resultUrl}
                          controls
                          autoPlay
                          loop
                          playsInline
                          className="w-full rounded-xl"
                          style={{ maxHeight: 400 }}
                        />
                      ) : activeModality === "audio" || activeModality === "voice" ? (
                        <div className="p-4 flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
                            {activeModality === "audio" ? <Music className="w-8 h-8 text-purple-400" /> : <Mic className="w-8 h-8 text-cyan-400" />}
                          </div>
                          <audio
                            src={resultUrl}
                            controls
                            autoPlay
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <img src={resultUrl} alt="Generated" className="w-full object-cover" loading="lazy" />
                      )}
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
                      {resultData.videoError ? (
                        <p className="text-red-400 text-[11px] ml-5">{`${resultData.videoError}`}</p>
                      ) : null}
                      {resultData.audioStatus != null && (
                        <p className="flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          音樂：{String(resultData.audioStatus)}
                        </p>
                      )}
                      {resultData.audioError ? (
                        <p className="text-red-400 text-[11px] ml-5">{`${resultData.audioError}`}</p>
                      ) : null}
                      {resultData.voiceStatus != null && (
                        <p className="flex items-center gap-2">
                          <Mic className="w-3 h-3" />
                          語音：{String(resultData.voiceStatus)}
                        </p>
                      )}
                      {resultData.voiceError ? (
                        <p className="text-red-400 text-[11px] ml-5">{`${resultData.voiceError}`}</p>
                      ) : null}
                    </div>
                  )}

                  {/* ── Generation Details (all fields visible) ── */}
                  <div className="text-xs text-muted-foreground space-y-1 p-3 rounded-lg bg-muted/10 border border-border/20">
                    <p className="font-medium text-foreground text-[11px] mb-2">生成詳情</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span>模態：{activeModality === "image" ? "圖片" : activeModality === "video" ? "影片" : activeModality === "audio" ? "音樂" : "語音"}</span>
                      <span>模式：{mode === "lightning" ? "閃電" : "深度精磆"}</span>
                      <span>Temperature：{temperature}</span>
                      <span>Seed：{seed || "random"}</span>
                      <span>LoRA 權重：{loraWeight}</span>
                      {promptBuilder.vibeCardIds.length > 0 && (
                        <span className="col-span-2">Vibe Cards：{promptBuilder.vibeCardIds.join(", ")}</span>
                      )}
                    </div>
                    {promptBuilder.compiledPrompt && (
                      <div className="mt-2 pt-2 border-t border-border/20">
                        <p className="font-medium text-foreground text-[11px] mb-1">編譯後提示詞</p>
                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{promptBuilder.compiledPrompt}</p>
                      </div>
                    )}
                  </div>

                  {/* ── Individual Download Button ── */}
                  {resultUrl && (
                    <Button
                      variant="outline"
                      className="w-full rounded-xl gap-2 text-sm"
                      onClick={async () => {
                        try {
                          // Use server proxy to bypass CORS on CDN URLs
                          const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(resultUrl)}`;
                          const resp = await fetch(proxyUrl);
                          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                          const blob = await resp.blob();
                          const ext = activeModality === "image" ? (blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg")
                            : activeModality === "video" ? "mp4"
                            : activeModality === "audio" ? (blob.type.includes("wav") ? "wav" : "mp3")
                            : (blob.type.includes("wav") ? "wav" : "mp3");
                          const objectUrl = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = objectUrl;
                          a.download = `ai-director-${activeModality}-${Date.now()}.${ext}`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(objectUrl);
                          toast.success(`已下載 ${ext.toUpperCase()} 檔案`);
                        } catch {
                          window.open(resultUrl, "_blank");
                          toast.info("已在新分頁開啟");
                        }
                      }}
                    >
                      <Download className="w-4 h-4" />
                      下載 {activeModality === "image" ? "PNG" : activeModality === "video" ? "MP4" : "MP3"}
                    </Button>
                  )}

                  {/* ── Copy Result URL ── */}
                  {resultUrl && (
                    <Button
                      variant="outline"
                      className="w-full rounded-xl gap-2 text-sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(resultUrl);
                          toast.success("已複製結果連結");
                        } catch {
                          // Fallback for older browsers
                          const ta = document.createElement("textarea");
                          ta.value = resultUrl;
                          ta.style.position = "fixed";
                          ta.style.opacity = "0";
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand("copy");
                          document.body.removeChild(ta);
                          toast.success("已複製結果連結");
                        }
                      }}
                    >
                      <Copy className="w-4 h-4" />
                      複製連結
                    </Button>
                  )}

                  {/* ── Pin to Notes ── */}
                  <Button
                    variant="outline"
                    className="w-full rounded-xl gap-2 text-sm border-cyan-500/20 hover:bg-cyan-500/10 hover:border-cyan-500/40"
                    onClick={() => {
                      const notesEvent = new CustomEvent("pin-to-notes", {
                        detail: {
                          title: `${activeModality === "image" ? "圖片" : activeModality === "video" ? "影片" : activeModality === "audio" ? "音樂" : "語音"}生成結果`,
                          content: `提示詞：${promptBuilder.compiledPrompt || promptBuilder.rawPrompt}\n\n結果：${resultUrl || "(無 URL)"}\n\n模態：${activeModality} | 模式：${mode} | Temperature：${temperature} | Seed：${seed || "random"}`,
                          sourceType: "studio-result",
                          resultUrl: resultUrl || undefined,
                        },
                      });
                      window.dispatchEvent(notesEvent);
                      toast.success("已釘選至筆記");
                    }}
                  >
                    <StickyNote className="w-4 h-4" />
                    釘選至筆記
                  </Button>

                  {/* ── ZIP Export ── */}
                  <Button
                    variant="outline"
                    className="w-full rounded-xl gap-2 text-sm"
                    onClick={async () => {
                      try {
                        const zip = new JSZip();
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

                        // Determine file extension by modality
                        const extMap: Record<string, string> = { image: "png", video: "mp4", audio: "mp3", voice: "mp3" };
                        const defaultExt = extMap[activeModality] || "bin";

                        // Download and add the generated asset (via proxy to avoid CORS)
                        if (resultUrl) {
                          try {
                            const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(resultUrl)}`;
                            const resp = await fetch(proxyUrl);
                            if (!resp.ok) throw new Error(`proxy ${resp.status}`);
                            const blob = await resp.blob();
                            let ext = defaultExt;
                            if (activeModality === "image") {
                              ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
                            } else if (activeModality === "video") {
                              ext = blob.type.includes("webm") ? "webm" : "mp4";
                            } else if (activeModality === "audio" || activeModality === "voice") {
                              ext = blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : "mp3";
                            }
                            zip.file(`generated-${activeModality}.${ext}`, blob);
                          } catch {
                            // Fallback: include URL as text file
                            zip.file("asset-url.txt", resultUrl);
                          }
                        }

                        // Build comprehensive parameter description file
                        const lines: string[] = [];
                        lines.push("═══════════════════════════════════════");
                        lines.push("  AI Director — 生成參數說明");
                        lines.push("═══════════════════════════════════════");
                        lines.push("");
                        lines.push(`生成時間：${new Date().toLocaleString("zh-TW")}`);
                        lines.push(`模態：${activeModality === "image" ? "圖片" : activeModality === "video" ? "影片" : activeModality === "audio" ? "音樂" : "語音"}`);
                        lines.push(`模式：${mode === "lightning" ? "閃電模式 (Flash)" : "專業模式 (Pro)"}`);
                        lines.push(`創意溫度：${temperature}`);
                        lines.push(`種子碼：${seed || "隨機"}`);
                        lines.push(`LoRA 權重：${loraWeight}`);
                        lines.push("");
                        lines.push("── 提示詞 ──");
                        lines.push(`原始輸入：${promptBuilder.rawPrompt || "(空)"}`);
                        lines.push(`編譯結果：${promptBuilder.compiledPrompt || "(未編譯)"}`);
                        if (promptBuilder.vibeCardIds.length > 0) {
                          lines.push(`Vibe Cards：${promptBuilder.vibeCardIds.join(", ")}`);
                        }
                        lines.push("");

                        // Modality-specific params
                        if (activeModality === "image") {
                          lines.push("── 圖片參數 ──");
                          lines.push(`長寬比：${imageState.aspectRatio}`);
                          lines.push(`負面提示詞：${imageState.negativePrompt || "(無)"}`);
                          lines.push(`風格參考圖：${imageState.styleReferenceUrl || "(無)"}`);
                          lines.push(`氛圍參考圖：${imageState.vibeReferenceUrl || "(無)"}`);
                        } else if (activeModality === "video") {
                          lines.push("── 影片參數 ──");
                          lines.push(`時長：${videoState.duration}`);
                          lines.push(`鏡頭運動：${videoState.cameraMotion || "(無)"}`);
                          lines.push(`首幀圖片：${videoState.firstFrameUrl || "(無)"}`);
                          lines.push(`末幀圖片：${videoState.lastFrameUrl || "(無)"}`);
                          lines.push(`角色參考：${videoState.characterRefUrl || "(無)"}`);
                        } else if (activeModality === "audio") {
                          lines.push("── 音樂參數 ──");
                          lines.push(`音樂風格：${audioState.musicStyle}`);
                          lines.push(`能量等級：${audioState.energy}`);
                          lines.push(`純樂器：${audioState.isInstrumental ? "是" : "否"}`);
                          lines.push(`自訂歌詞：${audioState.lyrics || "(無)"}`);
                        } else if (activeModality === "voice") {
                          lines.push("── 語音參數 ──");
                          lines.push(`語音角色：${voiceState.voiceActorId}`);
                          lines.push(`語速：${voiceState.speed}`);
                          lines.push(`情緒類型：${voiceState.emotionType}`);
                          lines.push(`情緒強度：${voiceState.emotionIntensity}`);
                          lines.push(`穩定度：${voiceState.stability}`);
                          lines.push(`文案：${voiceState.text || "(空)"}`);
                        }

                        // Thought chain
                        if (thoughtChain.length > 0) {
                          lines.push("");
                          lines.push("── AI 推理鏈 ──");
                          thoughtChain.forEach(n => {
                            lines.push(`[${n.status.toUpperCase()}] ${n.label}：${n.detail}`);
                          });
                        }

                        zip.file("parameters.txt", lines.join("\n"));

                        // Also add structured JSON metadata
                        const metadata = {
                          modality: activeModality,
                          mode,
                          temperature,
                          seed: seed || "random",
                          loraWeight,
                          prompt: { raw: promptBuilder.rawPrompt, compiled: promptBuilder.compiledPrompt, vibeCardIds: promptBuilder.vibeCardIds },
                          ...(activeModality === "image" ? { imageParams: imageState } : {}),
                          ...(activeModality === "video" ? { videoParams: videoState } : {}),
                          ...(activeModality === "audio" ? { audioParams: audioState } : {}),
                          ...(activeModality === "voice" ? { voiceParams: voiceState } : {}),
                          resultUrl,
                          thoughtChain,
                          generatedAt: new Date().toISOString(),
                        };
                        zip.file("metadata.json", JSON.stringify(metadata, null, 2));

                        const content = await zip.generateAsync({ type: "blob" });
                        if (content.size === 0) {
                          toast.error("ZIP 檔案為空，請稍後再試");
                          return;
                        }
                        const blobUrl = URL.createObjectURL(content);
                        const anchor = document.createElement("a");
                        anchor.href = blobUrl;
                        anchor.download = `ai-director-${activeModality}-${timestamp}.zip`;
                        document.body.appendChild(anchor);
                        anchor.click();
                        document.body.removeChild(anchor);
                        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                        toast.success("已匯出 ZIP 包");
                      } catch (err) {
                        toast.error("匯出失敗，請稍後再試");
                      }
                    }}
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
                onTemperatureChange={(v) => { setTemperature(v); notifyAdvancedParams(); }}
                seed={seed}
                onSeedChange={(v) => { setSeed(v); notifyAdvancedParams(); }}
                mode={mode}
                onModeChange={(v) => { setMode(v); notifyAdvancedParams(); }}
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
              <button
                onClick={() => setLeftDrawerTab("models")}
                className={`flex-1 text-xs py-2 rounded-lg transition-colors ${
                  leftDrawerTab === "models" ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground"
                }`}
              >
                模型
              </button>
            </div>
            {leftDrawerTab === "vault" ? (
              <ConsistencyVault onSelect={handleVaultSelect} />
            ) : leftDrawerTab === "models" ? (
              <MiniModelsPanel
                activeModelId={fineTunedModelId}
                onApply={(id, name) => { setFineTunedModelId(id); setFineTunedModelName(name); toast.success(`已套用模型「${name}」`); }}
                onRemove={() => { setFineTunedModelId(undefined); setFineTunedModelName(undefined); toast.info("已移除微調模型"); }}
              />
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

      {/* Onboarding Tour */}
      <OnboardingTour />

      {/* Floating Proactive Orb Widget */}
      <ProactiveOrbWidget
        onSaveToNotes={(payload) => {
          const notesEvent = new CustomEvent("pin-to-notes", { detail: payload });
          window.dispatchEvent(notesEvent);
        }}
        onOpenNotes={() => {
          window.dispatchEvent(new CustomEvent("open-notes-drawer"));
        }}
        onOpenCalendar={() => {
          window.dispatchEvent(new CustomEvent("navigate-to", { detail: "/calendar" }));
        }}
        onAddToCalendar={(payload) => {
          window.dispatchEvent(new CustomEvent("add-to-calendar", { detail: payload }));
        }}
        onRestartTour={() => {
          // 觸發全站引導 for studio
          window.dispatchEvent(new CustomEvent("site-tour-start", { detail: { pageId: "studio" } }));
        }}
        onApplyInspiration={(blocks) => {
          // Build a prompt string from inspiration blocks
          const parts = Object.entries(blocks)
            .filter(([_, v]) => v)
            .map(([_, label]) => label as string);
          const inspirationPrompt = parts.join(', ');
          const separator = promptBuilder.rawPrompt.trim() ? ', ' : '';
          const newRaw = promptBuilder.rawPrompt.trim() + separator + inspirationPrompt;
          setPromptBuilder((prev) => ({
            ...prev,
            rawPrompt: newRaw,
            compiledPrompt: newRaw,
          }));
        }}
        onSwitchModality={(modality) => {
          setActiveModality(modality);
        }}
      />
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
            <img src={asset.thumbnailUrl} alt="" className="w-8 h-8 rounded object-cover shrink-0" loading="lazy" />
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


// ─── Mini Models Panel (embedded in left drawer) ──────────────────────────

function MiniModelsPanel({
  activeModelId,
  onApply,
  onRemove,
}: {
  activeModelId?: number;
  onApply: (id: number, name: string) => void;
  onRemove: () => void;
}) {
  const myModelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });

  if (myModelsQuery.isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const models = myModelsQuery.data || [];

  if (!models.length) {
    return (
      <div className="p-6 text-center">
        <Cpu className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">尚無微調模型</p>
        <p className="text-xs text-muted-foreground/60 mt-1">前往「角色鍛造所」訓練你的專屬模型</p>
      </div>
    );
  }

  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    ready: { label: "就緒", color: "text-green-600 bg-green-50" },
    training: { label: "訓練中", color: "text-amber-600 bg-amber-50" },
    pending: { label: "等待中", color: "text-muted-foreground bg-muted/30" },
    failed: { label: "失敗", color: "text-red-600 bg-red-50" },
  };

  return (
    <div className="space-y-1 p-2">
      {models.map((model: any) => {
        const isActive = activeModelId === model.id;
        const isReady = model.status === "ready";
        const statusInfo = STATUS_LABELS[model.status] || STATUS_LABELS.pending;
        const triggerWord = model.configJson?.triggerWord as string | undefined;

        return (
          <div
            key={model.id}
            className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
              isActive ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/30"
            }`}
          >
            <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate font-medium">{model.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                {triggerWord && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    觸發詞: {triggerWord}
                  </span>
                )}
              </div>
            </div>
            {isReady && (
              <button
                onClick={() => isActive ? onRemove() : onApply(model.id, model.name)}
                className={`shrink-0 text-[10px] px-2 py-1 rounded-md transition-colors ${
                  isActive
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                {isActive ? (
                  <><X className="w-2.5 h-2.5 inline mr-0.5" />移除</>
                ) : (
                  <><Check className="w-2.5 h-2.5 inline mr-0.5" />套用</>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
