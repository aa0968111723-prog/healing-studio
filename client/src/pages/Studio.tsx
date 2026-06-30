import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { trpc } from "@/lib/trpc";
import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ProgressivePromptBuilder,
  createEmptyPromptOutput,
  isWeightAdjusted,
  type PromptBuilderOutput,
} from "@/components/ProgressivePromptBuilder";
import {
  ImageWorkspace,
  createDefaultImageState,
  type ImageWorkspaceState,
} from "@/components/workspaces/ImageWorkspace";
import {
  VideoWorkspace,
  createDefaultVideoState,
  type VideoWorkspaceState,
} from "@/components/workspaces/VideoWorkspace";
import {
  AudioWorkspace,
  createDefaultAudioState,
  type AudioWorkspaceState,
} from "@/components/workspaces/AudioWorkspace";
import {
  VoiceWorkspace,
  createDefaultVoiceState,
  type VoiceWorkspaceState,
} from "@/components/workspaces/VoiceWorkspace";
import {
  ConsistencyVault,
  type VaultItem,
} from "@/components/ConsistencyVault";
import { GenerationControls } from "@/components/GenerationControls";
import {
  GlassCard,
  BottomSheet,
} from "@/components/ZenCoPilot";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Image,
  Video,
  Music,
  Mic,
  Download,
  Copy,
  Layers,
  Clock,
  Package,
  X,
  Bookmark,
  Send,
  StickyNote,
  Cpu,
  Check,
  Briefcase,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/useMobile";
import { PROGRESS_MESSAGES } from "@shared/types";
import {
  PromptStrengthBar,
  type SuggestionAction,
} from "@/components/PromptStrengthBar";
import ThoughtIslandChain, {
  type ThoughtNode,
} from "@/components/ThoughtIslandChain";
import { useAIState } from "@/contexts/AIStateContext";
import { usePersonality } from "@/contexts/PersonalityContext";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";
import VisualSoul from "@/components/VisualSoul";
import { useLocation } from "wouter";
import { useShowcaseTransfer } from "@/contexts/ShowcaseTransferContext";
import type { GenerationMode, GenerationType } from "@shared/types";
import { normalizeEngineModelId } from "@shared/engineModelIds";
import JSZip from "jszip";

import {
  useRegisterPageAgent,
  usePageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";
import { useEnsureCompatibleModel } from "@/hooks/useEnsureCompatibleModel";
import { useGenerationTask } from "@/hooks/useGenerationTask";
import { useAutoSavePrompt } from "@/hooks/useAutoSavePrompt";
import {
  FEATURE_LABELS,
  getModelCapability,
  type FalModelCapabilityFeatures,
} from "@shared/falModelCapabilities";
import { useNotesDrawer } from "@/contexts/NotesDrawerContext";
import { requireAuth } from "@/components/AuthExpiredModal";

// ─── Creative Mode ───────────────────────────────────────────────────────────
import {
  CreativeModeSelector,
  loadCreativeMode,
} from "@/components/CreativeModeSelector";
import {
  InspirationQuickPanel,
  type InspirationBlocks,
} from "@/components/InspirationQuickPanel";
import type { CreativeMode } from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";

// ─── New Workspace Components ────────────────────────────────────────────────
import {
  type Modality,
  type WorkspaceMode as WSMode,
  type PromptStrengthLevel,
  type ActionMode,
  type ThoughtIsland,
  type StructuredBlock,
  type ReferenceItem,
  type VersionEntry,
  type SavedRecipe,
  getDefaultBlocks,
  getDefaultThoughtIslands,
} from "@/stores/workspaceStore";

import { ThoughtIslandsPanel } from "@/components/workspaces/ThoughtIslandsPanel";
import { PromptStrengthControl } from "@/components/workspaces/PromptStrengthControl";
import { AdvancedPromptPanel } from "@/components/workspaces/AdvancedPromptPanel";
import { StructuredBlocksEditor } from "@/components/workspaces/StructuredBlocksEditor";
import { PromptCompilerPreview } from "@/components/workspaces/PromptCompilerPreview";
import { GenerationActionBar } from "@/components/workspaces/GenerationActionBar";
import { VersionHistoryPanel } from "@/components/workspaces/VersionHistoryPanel";
import { RecipeLibraryPanel } from "@/components/workspaces/RecipeLibraryPanel";
import { ReferencePanel } from "@/components/workspaces/ReferencePanel";
import { RefineQuickActions } from "@/components/workspaces/RefineQuickActions";
import {
  compilePrompt,
  lintPrompt,
  diffBlocks,
  type PromptWarning,
} from "@/components/workspaces/PromptCompiler";

// ─── Tab Config ─────────────────────────────────────────────────────────────

const MODALITY_TABS: {
  value: GenerationType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { value: "image", label: "圖片", icon: <Image className="w-4 h-4" /> },
  { value: "video", label: "影片", icon: <Video className="w-4 h-4" /> },
  { value: "audio", label: "音樂", icon: <Music className="w-4 h-4" /> },
  { value: "voice", label: "語音", icon: <Mic className="w-4 h-4" /> },
];

interface DirectorBatchTaskPayload {
  prompt: string;
  generationType: "image" | "video" | "audio" | "voice";
  overrideEngine?: string;
  musicStyle?: string;
  audioScript?: string;
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
          <div className="h-full rounded-xl overflow-hidden flex flex-col bg-card/50 backdrop-blur-md border border-white/50">
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
            <div className="flex-1 overflow-y-auto">{children}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Studio Page ────────────────────────────────────────────────────────────

export default function Studio() {
  const { user } = useAuth();
  const { settings: personalSettings } = usePersonalSettings();
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
    return () =>
      window.removeEventListener("apply-style-preset", handleStylePreset);
  }, []);
  const {
    aiState,
    setAIState,
    personality,
    reportTyping,
    reportFailure,
    reportSuccess,
    resetIdle,
  } = useAIState();
  const {
    onGenerationStart: notifyGenStart,
    onGenerationDone: notifyGenDone,
    onGenerationFail: notifyGenFail,
    onTyping: notifyTyping,
    onAdvancedParams: notifyAdvancedParams,
  } = usePersonality();
  const [, navigate] = useLocation();

  // ── PageAgent: 取得 dispatch helper 用於導演 AI 建議自動執行 ──
  const pageAgent = usePageAgent();

  // ── Shared state ──
  const [activeModality, setActiveModality] = useState<GenerationType>("image");
  const [mode, setMode] = useState<GenerationMode>("lightning");
  // ── Per-modality prompt state ──
  // 四模態各自獨立的提示詞 / vibeCards / advancedFields / tokenWeights，
  // 切換 modality 時自動 swap 對應的副本，使用者切回原模態時內容仍在。
  const [promptByModality, setPromptByModality] = useState<
    Record<GenerationType, PromptBuilderOutput>
  >(() => ({
    image: createEmptyPromptOutput(),
    video: createEmptyPromptOutput(),
    audio: createEmptyPromptOutput(),
    voice: createEmptyPromptOutput(),
    multimodal: createEmptyPromptOutput(),
  }));
  // 為了最小化既有 30+ 個 promptBuilder 引用點的改動，保留 promptBuilder 名稱
  // 作為當前 modality 的衍生值，setPromptBuilder 只更新對應 modality 的副本。
  const promptBuilder = promptByModality[activeModality];
  const setPromptBuilder = useCallback(
    (
      next:
        | PromptBuilderOutput
        | ((prev: PromptBuilderOutput) => PromptBuilderOutput)
    ) => {
      setPromptByModality(prev => {
        const current = prev[activeModality];
        const nextValue = typeof next === "function" ? next(current) : next;
        if (nextValue === current) return prev;
        return { ...prev, [activeModality]: nextValue };
      });
    },
    [activeModality]
  );
  const [temperature, setTemperature] = useState(0.5);
  const [seed, setSeed] = useState("");
  const [loraWeight, setLoraWeight] = useState(0.7);

  // ── Modality-specific state ──
  const [imageState, setImageState] = useState<ImageWorkspaceState>(
    createDefaultImageState
  );
  const [videoState, setVideoState] = useState<VideoWorkspaceState>(
    createDefaultVideoState
  );
  const [audioState, setAudioState] = useState(createDefaultAudioState);
  const [voiceState, setVoiceState] = useState(createDefaultVoiceState);

  // ── Vault & Model injection state ──
  const [vaultCharacterId, setVaultCharacterId] = useState<number | undefined>(
    undefined
  );
  const [vaultSceneId, setVaultSceneId] = useState<number | undefined>(
    undefined
  );
  const [fineTunedModelId, setFineTunedModelId] = useState<number | undefined>(
    undefined
  );
  const [fineTunedModelName, setFineTunedModelName] = useState<
    string | undefined
  >(undefined);
  const [directorModelOverride, setDirectorModelOverride] = useState<
    string | undefined
  >(undefined);

  // ── UI state ──
  const [creativeMode, setCreativeMode] =
    useState<CreativeMode>(loadCreativeMode);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [leftDrawerTab, setLeftDrawerTab] = useState<
    "vault" | "assets" | "models" | "controls" | "recipes" | "versions"
  >("vault");
  const [toolboxSheetOpen, setToolboxSheetOpen] = useState(false);
  const [toolboxTab, setToolboxTab] = useState<
    | "vault"
    | "assets"
    | "models"
    | "controls"
    | "recipes"
    | "versions"
  >("vault");
  const [isApplyingSuggestedModel, setIsApplyingSuggestedModel] = useState(false);
  const {
    selectedModelId: selectedFalModelId,
    setSelectedModelId: setSelectedFalModelId,
    params: selectedModelParams,
    setParams: setSelectedModelParams,
    resetParams: resetModelParams,
  } = useGenerationTask();
  // 光球 setModel 能力用的 Fal 模型清單（依 activeModality 切換）。
  // 真正的下拉選單在 MiniModelsPanel 各自 fetch；這裡只是給 orb agent 看「可選什麼」。
  const [orbFalModelOptions, setOrbFalModelOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  useEffect(() => {
    const cat =
      activeModality === "voice" || activeModality === "audio"
        ? "audio"
        : activeModality === "image"
          ? "image"
          : "video";
    let cancelled = false;
    fetch(`/api/tools/models?category=${cat}`)
      .then(r => r.json())
      .then((rows: Array<{ id: string; name: string }>) => {
        if (cancelled) return;
        setOrbFalModelOptions(
          Array.isArray(rows) ? rows.slice(0, 30).map(r => ({ id: r.id, name: r.name })) : []
        );
      })
      .catch(() => {
        if (!cancelled) setOrbFalModelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeModality]);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Record<string, unknown> | null>(
    null
  );
  const [thoughtChain, setThoughtChain] = useState<ThoughtNode[]>([]);

  // ── Multi-Modal Workspace State (new) ──
  const modalityKey = (
    activeModality === "audio" ? "music" : activeModality
  ) as Modality;
  // ── 模型 ↔ 功能相容性監看：啟用 LoRA / 自注意力 / 寬比例時自動切換到相容模型 ──
  const hasWeightedTokens = useMemo(
    () =>
      Array.isArray(promptBuilder.tokenWeights) &&
      promptBuilder.tokenWeights.some(t => isWeightAdjusted(t.weight)),
    [promptBuilder.tokenWeights]
  );
  const isWideAspect = useMemo(
    () => ["21:9", "32:9"].includes(imageState.aspectRatio),
    [imageState.aspectRatio]
  );
  const isStandardAspect = useMemo(
    () => ["4:3", "3:4", "3:2", "2:3"].includes(imageState.aspectRatio),
    [imageState.aspectRatio]
  );
  const compatibility = useEnsureCompatibleModel({
    modality:
      activeModality === "voice" || activeModality === "audio"
        ? "audio"
        : (activeModality as "image" | "video"),
    selectedModelId: selectedFalModelId,
    setModelId: setSelectedFalModelId,
    activeFeatures: {
      tokenWeights: hasWeightedTokens && activeModality === "image",
      loraInjection: !!fineTunedModelId && activeModality === "image",
      aspectRatioWide: isWideAspect && activeModality === "image",
      aspectRatioStandard: isStandardAspect && activeModality === "image",
    },
  });

  // Derive workspaceMode from creativeMode for backward compat
  const derivedWorkspaceMode: WSMode =
    creativeMode === "pro" ? "advanced" : "beginner";
  const [workspaceMode, setWorkspaceMode] = useState<WSMode>("beginner");
  // Sync workspaceMode when creativeMode changes
  useEffect(() => {
    setWorkspaceMode(derivedWorkspaceMode);
  }, [derivedWorkspaceMode]);
  const isSimple = creativeMode === "simple";
  const isStandard = creativeMode === "standard";
  const isPro = creativeMode === "pro";
  const [actionMode, setActionMode] = useState<ActionMode>("generate");
  const [promptStrength, setPromptStrength] =
    useState<PromptStrengthLevel>("medium");
  const [structuredBlocks, setStructuredBlocks] = useState<
    Record<string, StructuredBlock[]>
  >({
    image: getDefaultBlocks("image"),
    video: getDefaultBlocks("video"),
    music: getDefaultBlocks("music"),
    voice: getDefaultBlocks("voice"),
  });
  const [thoughtIslands, setThoughtIslands] = useState<
    Record<string, ThoughtIsland[]>
  >({
    image: getDefaultThoughtIslands("image"),
    video: getDefaultThoughtIslands("video"),
    music: getDefaultThoughtIslands("music"),
    voice: getDefaultThoughtIslands("voice"),
  });
  const [advancedPrompt, setAdvancedPrompt] = useState<Record<string, string>>({
    image: "",
    video: "",
    music: "",
    voice: "",
  });
  const [advancedPromptOverride, setAdvancedPromptOverride] = useState<
    Record<string, boolean>
  >({ image: false, video: false, music: false, voice: false });
  const [negativePrompts, setNegativePrompts] = useState<
    Record<string, string>
  >({ image: "", video: "", music: "", voice: "" });
  const [references, setReferences] = useState<Record<string, ReferenceItem[]>>(
    { image: [], video: [], music: [], voice: [] }
  );
  // ── Recipes & Versions（持久化到 MySQL）──────────────────────────────
  // 之前 savedRecipes / versions 只存在 useState，重新整理就消失，
  // RecipeLibraryPanel / VersionHistoryPanel 形同失效。改成從
  // trpc.studio.recipes.list / trpc.studio.versions.list 讀，所有寫入
  // 都同步到 studio_recipes / studio_versions（drizzle schema、migration 0030）。
  const recipesQuery = trpc.studio.recipes.list.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const versionsQuery = trpc.studio.versions.list.useQuery(
    { limit: 50 },
    { retry: false, staleTime: 30_000 }
  );
  const createRecipeMutation = trpc.studio.recipes.create.useMutation({
    onSuccess: () => recipesQuery.refetch(),
  });
  const deleteRecipeMutation = trpc.studio.recipes.delete.useMutation({
    onSuccess: () => recipesQuery.refetch(),
  });
  const createVersionMutation = trpc.studio.versions.create.useMutation({
    onSuccess: () => versionsQuery.refetch(),
  });
  const setVersionPinnedMutation = trpc.studio.versions.setPinned.useMutation({
    onSuccess: () => versionsQuery.refetch(),
  });

  // 把 server payload 還原成 frontend 用的 SavedRecipe / VersionEntry 形狀。
  // payload 由 useState 寫入時就是這個形狀，所以只要 spread 即可。
  const savedRecipes = useMemo<SavedRecipe[]>(
    () =>
      (recipesQuery.data ?? []).map((row): SavedRecipe => {
        const p = (row.payload ?? {}) as Partial<SavedRecipe>;
        return {
          id: `recipe-db-${row.id}`,
          name: row.name,
          modality: row.modality,
          blocks: p.blocks ?? [],
          thoughtIslands: p.thoughtIslands ?? [],
          promptStrength: p.promptStrength ?? "medium",
          advancedPrompt: p.advancedPrompt ?? "",
          references: p.references ?? [],
          generationParams: p.generationParams ?? {},
          createdAt: row.createdAt
            ? new Date(row.createdAt).getTime()
            : Date.now(),
        };
      }),
    [recipesQuery.data]
  );

  const versions = useMemo<VersionEntry[]>(
    () =>
      (versionsQuery.data ?? []).map((row): VersionEntry => {
        const p = (row.payload ?? {}) as Partial<VersionEntry>;
        return {
          id: row.versionKey,
          timestamp: row.createdAt
            ? new Date(row.createdAt).getTime()
            : Date.now(),
          modality: row.modality,
          blocks: p.blocks ?? [],
          thoughtIslands: p.thoughtIslands ?? [],
          promptStrength: p.promptStrength ?? "medium",
          advancedPrompt: p.advancedPrompt ?? "",
          compiledPrompt: p.compiledPrompt ?? "",
          changedFields: p.changedFields ?? [],
          references: p.references ?? [],
          generationSettings: p.generationSettings ?? {},
          outputUrl: p.outputUrl ?? null,
          pinned: !!row.pinned,
          actionMode: p.actionMode ?? "generate",
        };
      }),
    [versionsQuery.data]
  );

  const pinnedVersionId = useMemo(
    () => versions.find(v => v.pinned)?.id ?? null,
    [versions]
  );
  const previousBlocksRef = useRef<StructuredBlock[]>([]);

  // ── Compiled prompt (derived from structured blocks) ──
  const compileResult = useMemo(() => {
    const blocks = structuredBlocks[modalityKey] || [];
    const islands = thoughtIslands[modalityKey] || [];
    const advP = advancedPrompt[modalityKey] || "";
    const advO = advancedPromptOverride[modalityKey] || false;
    const negP = negativePrompts[modalityKey] || "";
    return compilePrompt(
      modalityKey,
      blocks,
      islands,
      promptStrength,
      advP,
      advO,
      negP,
      previousBlocksRef.current
    );
  }, [
    modalityKey,
    structuredBlocks,
    thoughtIslands,
    promptStrength,
    advancedPrompt,
    advancedPromptOverride,
    negativePrompts,
  ]);

  const promptWarnings = useMemo(() => {
    const blocks = structuredBlocks[modalityKey] || [];
    const negP = negativePrompts[modalityKey] || "";
    return lintPrompt(modalityKey, blocks, negP);
  }, [modalityKey, structuredBlocks, negativePrompts]);

  // Sync compiled prompt to promptBuilder for backward compatibility
  useEffect(() => {
    if (compileResult.compiledPrompt && workspaceMode === "advanced") {
      setPromptBuilder(prev => ({
        ...prev,
        compiledPrompt: compileResult.compiledPrompt,
      }));
    }
  }, [compileResult.compiledPrompt, workspaceMode]);

  // ── Background Tasks ──
  const { setDrawerOpen } = useBackgroundTasks();

  // ── Brain Pricing Summary (show engine name + cost in UI) ──
  const pricingSummaryQuery = trpc.brain.pricingSummary.useQuery(
    {
      durationSec: parseInt(videoState.duration) || 5,
      charCount: voiceState.text?.length || 100,
    },
    { retry: false, staleTime: 30_000 }
  );
  const currentEngine =
    pricingSummaryQuery.data?.[
      activeModality as "image" | "video" | "audio" | "voice"
    ];

  const { trySave: autoSavePrompt } = useAutoSavePrompt({ sourceWorkflow: "video" });

  // ── Mutation ──
  const utils = trpc.useUtils();
  // ── Async submit mutation (背景任務模式，不阻塞 UI) ──
  const submitAsyncMutation = trpc.generate.submitMultimodalAsync.useMutation({
    onMutate: () => {
      setAIState("generating");
      notifyGenStart();
    },
    onSuccess: (data, variables) => {
      // submitMultimodalAsync 在伺服器端已建立 background_job 記錄（routers.ts
      // submitMultimodalAsync 內 db.createBackgroundJob），這裡僅需 invalidate
      // activeJobs 讓 BackgroundTasksDrawer 立刻撈到新任務，避免再呼叫
      // submitTask → submitStudioJob 造成同一任務插入第二筆 job 列。
      utils.generate.activeJobs.invalidate();
      autoSavePrompt({
        title: data.label || "生成",
        content: variables.prompt || "",
        modelHint: data.modelId,
      });
      setAIState("idle");
      notifyGenDone();
      toast.success(`${data.label} 已提交背景執行`, {
        description: "完成後將自動通知您",
        action: {
          label: "查看任務",
          onClick: () => setDrawerOpen(true),
        },
      });
      utils.auth.me.invalidate();
      // 模型自動降級提醒：dispatcher 找不到使用者選的模型時會 fallback 到
      // catalog 首選，若 originalModel 不同就告訴使用者「實際送出的不是你選的」。
      // 之前這個資訊已從伺服器回來但沒人講，使用者會以為自己用了 flux-pro
      // 但其實跑的是 flux-realism。
      if (data.degraded && data.originalModel) {
        toast.warning(
          `已改用備援模型 ${data.modelId}（你選的 ${data.originalModel} 暫不可用）`,
          { duration: 6000 }
        );
      }
      // 自動快照當前工作區成版本歷史，讓 VersionHistoryPanel 真的能用。
      // 之前 versions 永遠是空陣列、面板形同失效。
      try {
        const versionKey = `v-${Date.now()}`;
        createVersionMutation.mutate({
          modality: modalityKey,
          versionKey,
          payload: {
            blocks: structuredBlocks[modalityKey] || [],
            thoughtIslands: thoughtIslands[modalityKey] || [],
            promptStrength,
            advancedPrompt: advancedPrompt[modalityKey] || "",
            compiledPrompt:
              compileResult.compiledPrompt || promptBuilder.compiledPrompt || "",
            changedFields: [],
            references: references[modalityKey] || [],
            generationSettings: {
              temperature,
              seed,
              mode,
              loraWeight,
              modelId: data.modelId,
              jobId: data.jobId,
            },
            outputUrl: null,
            actionMode,
          },
        });
      } catch {
        // version snapshot is best-effort — never block the main flow.
      }
    },
    onError: (error) => {
      setAIState("idle");
      notifyGenFail();
      const msg = error.message || "";
      const isQuota = /配額|不足|積分/.test(msg);
      if (isQuota) {
        toast.error(msg);
      } else {
        toast.error(`提交失敗：${msg || "請稍後重試"}`);
      }
      reportFailure();
    },
  });

  const submitDirectorBatch = useCallback(
    async (tasks: DirectorBatchTaskPayload[]) => {
      let ok = 0;
      let failed = 0;
      for (const task of tasks) {
        try {
          await submitAsyncMutation.mutateAsync({
            prompt: task.prompt,
            generationType: task.generationType,
            mode,
            ...(task.generationType === "audio" && {
              musicStyle: task.musicStyle || task.prompt,
            }),
            ...(task.generationType === "voice" && {
              voiceText: task.audioScript || task.prompt,
            }),
            overrideModelId: task.overrideEngine
              ? normalizeEngineModelId(task.overrideEngine)
              : selectedFalModelId,
            modelParams: selectedModelParams,
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (ok > 0) toast.success(`導演批次任務已提交 ${ok} 筆`);
      if (failed > 0) toast.error(`導演批次任務失敗 ${failed} 筆`);
    },
    [submitAsyncMutation, mode]
  );



  // ── Populate from Showcase Transfer (完全解構 JSON 還原) ──
  const { consumePayload } = useShowcaseTransfer();
  useEffect(() => {
    const showcaseData = consumePayload();
    if (showcaseData) {
      // Set modality
      setActiveModality(showcaseData.modality);

      // Restore compiled prompt
      if (
        showcaseData.originalPrompt ||
        showcaseData.deconstructedBlocks?.compiledPrompt
      ) {
        const prompt =
          showcaseData.deconstructedBlocks?.compiledPrompt ||
          showcaseData.originalPrompt ||
          "";
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
      if (
        showcaseData.modality === "image" &&
        showcaseData.deconstructedBlocks?.negativePrompt
      ) {
        setImageState(prev => ({
          ...prev,
          negativePrompt: showcaseData.deconstructedBlocks!.negativePrompt,
          // Use showcase image as style reference
          ...(showcaseData.imageUrl && {
            styleReferenceUrl: showcaseData.imageUrl,
          }),
        }));
      }

      // Restore video first frame from showcase image
      if (showcaseData.modality === "video" && showcaseData.imageUrl) {
        setVideoState(prev => ({
          ...prev,
          firstFrameUrl: showcaseData.imageUrl,
        }));
      }

      // Restore technical parameters from deconstructed blocks
      if (showcaseData.deconstructedBlocks?.parameters) {
        const params = showcaseData.deconstructedBlocks.parameters;
        if (params.temperature != null)
          setTemperature(Number(params.temperature));
        if (params.seed != null) setSeed(String(params.seed));
        if (params.loraWeight != null) setLoraWeight(Number(params.loraWeight));
        if (params.mode === "lightning" || params.mode === "deep_precision") {
          setMode(params.mode as GenerationMode);
        }
        // Image-specific
        if (showcaseData.modality === "image") {
          setImageState(prev => ({
            ...prev,
            ...(params.aspectRatio != null && {
              aspectRatio: String(params.aspectRatio),
            }),
          }));
        }
        // Audio-specific
        if (showcaseData.modality === "audio") {
          setAudioState(prev => ({
            ...prev,
            ...(params.musicStyle != null && {
              musicStyle: String(params.musicStyle),
            }),
            ...(params.isInstrumental != null && {
              isInstrumental: Boolean(params.isInstrumental),
            }),
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

      toast.success(`已載入「${showcaseData.title}」的完整配方`, {
        duration: 4000,
      });
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
        setDirectorModelOverride(
          data.overrideEngine ? String(data.overrideEngine) : undefined
        );
        if (data.musicStyle)
          setAudioState(prev => ({ ...prev, musicStyle: data.musicStyle }));
        if (data.voiceText)
          setVoiceState(prev => ({ ...prev, text: data.voiceText }));
        if (data.audioScript)
          setVoiceState(prev => ({ ...prev, text: data.audioScript }));
        if (Array.isArray(data.batchTasks) && data.batchTasks.length > 0) {
          const tasks = data.batchTasks.filter(
            (t: any) =>
              t &&
              typeof t.prompt === "string" &&
              ["image", "video", "audio", "voice"].includes(t.generationType)
          ) as DirectorBatchTaskPayload[];
          if (tasks.length > 0) {
            void submitDirectorBatch(tasks);
          }
        }

        // ── Restore full parameter snapshot from history (cross-modal, 100% fidelity) ──
        if (data.parameterSnapshot) {
          const snap = data.parameterSnapshot as Record<string, unknown>;

          // ── Common params ──
          if (snap.temperature != null)
            setTemperature(Number(snap.temperature));
          if (snap.seed != null) setSeed(String(snap.seed));
          if (snap.vibeCardIds && Array.isArray(snap.vibeCardIds)) {
            setPromptBuilder(prev => ({
              ...prev,
              vibeCardIds: snap.vibeCardIds as string[],
            }));
          }
          if (snap.mode === "lightning" || snap.mode === "deep_precision")
            setMode(snap.mode as GenerationMode);
          // ── LoRA weight ──
          if (snap.loraWeight != null) setLoraWeight(Number(snap.loraWeight));
          // ── Fine-tuned model embedded in snapshot ──
          if (snap.fineTunedModelId != null) {
            setFineTunedModelId(Number(snap.fineTunedModelId));
            if (snap.fineTunedModelName != null)
              setFineTunedModelName(String(snap.fineTunedModelName));
          }
          // ── Consistency Vault IDs ──
          if (snap.vaultCharacterId != null)
            setVaultCharacterId(Number(snap.vaultCharacterId));
          if (snap.vaultSceneId != null)
            setVaultSceneId(Number(snap.vaultSceneId));

          // ── Image-specific params ──
          if (data.generationType === "image") {
            setImageState(prev => ({
              ...prev,
              ...(snap.aspectRatio != null && {
                aspectRatio: String(snap.aspectRatio),
              }),
              ...(snap.negativePrompt != null && {
                negativePrompt: String(snap.negativePrompt),
              }),
              ...(snap.styleReferenceUrl != null && {
                styleReferenceUrl: String(snap.styleReferenceUrl),
              }),
              ...(snap.vibeReferenceUrl != null && {
                vibeReferenceUrl: String(snap.vibeReferenceUrl),
              }),
            }));
          }

          // ── Video-specific params ──
          if (data.generationType === "video") {
            setVideoState(prev => ({
              ...prev,
              ...(snap.videoDurationSeconds != null && {
                duration: String(snap.videoDurationSeconds),
              }),
              ...(snap.firstFrameUrl != null && {
                firstFrameUrl: String(snap.firstFrameUrl),
              }),
              ...(snap.lastFrameUrl != null && {
                lastFrameUrl: String(snap.lastFrameUrl),
              }),
              ...(snap.characterRefUrl != null && {
                characterRefUrl: String(snap.characterRefUrl),
              }),
              ...(snap.cameraMotion != null &&
                typeof snap.cameraMotion === "object" && {
                  cameraMotion: snap.cameraMotion as {
                    pan: number;
                    zoom: number;
                    tilt: number;
                  },
                }),
            }));
          }

          // ── Audio-specific params ──
          if (data.generationType === "audio") {
            setAudioState(prev => ({
              ...prev,
              ...(snap.musicStyle != null && {
                musicStyle: String(snap.musicStyle),
              }),
              ...(snap.isInstrumental != null && {
                isInstrumental: Boolean(snap.isInstrumental),
              }),
              ...(snap.lyrics != null && { lyrics: String(snap.lyrics) }),
              ...(snap.audioDuration != null && {
                duration: Number(snap.audioDuration),
              }),
              ...(snap.audioEnergy != null && {
                energy: Number(snap.audioEnergy),
              }),
            }));
          }

          // ── Voice-specific params ──
          if (data.generationType === "voice") {
            setVoiceState(prev => ({
              ...prev,
              ...(snap.voiceModelId != null && {
                voiceActorId: String(snap.voiceModelId),
              }),
              ...(snap.voiceText != null && { text: String(snap.voiceText) }),
              ...(snap.voiceSpeed != null && {
                speed: Number(snap.voiceSpeed),
              }),
              ...(snap.voiceStability != null && {
                stability: Number(snap.voiceStability),
              }),
              ...(snap.voiceEmotionType != null && {
                emotionType: String(snap.voiceEmotionType),
              }),
              ...(snap.voiceEmotionIntensity != null && {
                emotionIntensity: Number(snap.voiceEmotionIntensity),
              }),
            }));
          }
        }

        // ── Restore video first frame from cross-modal reference ──
        if (data.referenceImageUrl && data.generationType === "video") {
          setVideoState(prev => ({
            ...prev,
            firstFrameUrl: data.referenceImageUrl,
          }));
        }

        // ── Restore image style reference from shared space ──
        if (data.referenceImageUrl && data.generationType === "image") {
          setImageState(prev => ({
            ...prev,
            styleReferenceUrl: data.referenceImageUrl,
          }));
        }

        // ── Restore fine-tuned model from top-level data (shared space / history) ──
        if (data.fineTunedModelId) {
          setFineTunedModelId(Number(data.fineTunedModelId));
          if (data.fineTunedModelName)
            setFineTunedModelName(String(data.fineTunedModelName));
        }

        sessionStorage.removeItem("sendToStudio");
        const sourceLabel =
          data.source === "shared_space"
            ? "已從共享空間載入素材"
            : data.source === "director_ai" && data.overrideEngine
              ? `已從導演 AI 載入「${data.sceneName ?? "場景"}」（模型：${data.overrideEngine}）`
            : data.source === "history" || data.source === "history_cross"
              ? "已 100% 還原生成配置，可直接重新生成"
              : "已載入參數與提示詞";
        toast.success(sourceLabel);
      } catch {
        /* ignore */
      }
    }
  }, [submitDirectorBatch]);

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
              rawPrompt: prev.rawPrompt
                ? `${data.triggerWord}, ${prev.rawPrompt}`
                : data.triggerWord,
            }));
          }
        }
        sessionStorage.removeItem("applyModel");
        toast.success(
          `已套用模型「${data.name || "模型"}」，觸發詞已加入提示詞`
        );
      } catch {
        /* ignore */
      }
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
          image: "image",
          video: "video",
          music: "audio",
          audio: "audio",
          voice: "voice",
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
        const tags = decodeURIComponent(presetAesthetics)
          .split(",")
          .map(t => t.trim().toLowerCase());
        const aestheticVibeMap: Record<string, string> = {
          serene: "serene",
          calm: "serene",
          warm: "warm",
          cozy: "warm",
          dreamy: "dreamy",
          ethereal: "dreamy",
          nature: "nature",
          organic: "nature",
          vintage: "vintage",
          retro: "vintage",
          minimal: "minimal",
          clean: "minimal",
          joyful: "joyful",
          happy: "joyful",
          mystical: "mystical",
          cosmic: "mystical",
        };
        const vibeIds = new Set<string>();
        for (const tag of tags) {
          if (aestheticVibeMap[tag]) vibeIds.add(aestheticVibeMap[tag]);
        }
        if (vibeIds.size > 0) {
          setPromptBuilder(prev => ({
            ...prev,
            vibeCardIds: Array.from(vibeIds),
          }));
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
        serene: "serene",
        calm: "serene",
        peaceful: "serene",
        tranquil: "serene",
        warm: "warm",
        cozy: "warm",
        comfortable: "warm",
        soft: "warm",
        dreamy: "dreamy",
        ethereal: "dreamy",
        surreal: "dreamy",
        fantasy: "dreamy",
        nature: "nature",
        organic: "nature",
        botanical: "nature",
        natural: "nature",
        vintage: "vintage",
        retro: "vintage",
        nostalgic: "vintage",
        classic: "vintage",
        minimal: "minimal",
        clean: "minimal",
        simple: "minimal",
        minimalist: "minimal",
        joyful: "joyful",
        happy: "joyful",
        vibrant: "joyful",
        colorful: "joyful",
        bright: "joyful",
        mystical: "mystical",
        mysterious: "mystical",
        dark: "mystical",
        gothic: "mystical",
        cosmic: "mystical",
        // 中文匹配
        寧靜: "serene",
        溫暖: "warm",
        夢幻: "dreamy",
        自然: "nature",
        復古: "vintage",
        極簡: "minimal",
        歡愉: "joyful",
        神秘: "mystical",
        // 擴展匹配
        cyberpunk: "mystical",
        neon: "joyful",
        cinematic: "mystical",
        watercolor: "dreamy",
        pastel: "serene",
        golden: "warm",
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
            for (const [keyword, vibeId] of Object.entries(
              aestheticToVibeMap
            )) {
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
      const vibeNames = Array.from(matchedVibeIds)
        .map(id => {
          const card = [
            "serene",
            "warm",
            "dreamy",
            "nature",
            "vintage",
            "minimal",
            "joyful",
            "mystical",
          ];
          const zhMap: Record<string, string> = {
            serene: "寧靜",
            warm: "溫暖",
            dreamy: "夢幻",
            nature: "自然",
            vintage: "復古",
            minimal: "極簡",
            joyful: "歡愉",
            mystical: "神秘",
          };
          return zhMap[id] || id;
        })
        .join("、");

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
  /**
   * handleAskDirector — 把當前 Studio 完整上下文送給導演 AI，取回 AgentAction[]
   * 並透過 PageAgent 直接執行（雙向迴路，無需跳離工作室）。
   */
  const askDirectorMutation = trpc.director.askForStudioPlan.useMutation();
  const handleAskDirector = useCallback(async () => {
    if (!requireAuth()) return;
    try {
      const result = await askDirectorMutation.mutateAsync({
        activeModality:
          activeModality === "multimodal" ? "image" : activeModality,
        prompts: {
          image: promptByModality.image.rawPrompt,
          video: promptByModality.video.rawPrompt,
          audio: promptByModality.audio.rawPrompt,
          voice: voiceState.text || promptByModality.voice.rawPrompt,
        },
        selectedFalModelId,
        hasTokenWeights: hasWeightedTokens,
        hasFineTunedModel: !!fineTunedModelId,
        aspectRatio: imageState.aspectRatio,
        personality: "creative",
      });
      if (result.actions.length === 0) {
        toast.info(result.rationale || "導演沒有建議");
        return;
      }
      // 透過 PageAgent 直接 dispatch 全部 actions（無需離開工作室）
      await pageAgent.dispatchMany(result.actions, { source: "manual" });
      toast.success(
        `導演建議了 ${result.actions.length} 個動作${
          result.rationale ? `：${result.rationale}` : ""
        }`,
        { duration: 5000 }
      );
    } catch (e) {
      toast.error(
        `徵詢導演失敗：${e instanceof Error ? e.message : "未知錯誤"}`
      );
    }
  }, [
    askDirectorMutation,
    activeModality,
    promptByModality,
    voiceState.text,
    selectedFalModelId,
    hasWeightedTokens,
    fineTunedModelId,
    imageState.aspectRatio,
    pageAgent,
  ]);

  /**
   * handleBatchGenerate — 一次送出多個模態的任務（平行）。
   *
   * 凡是該模態的 prompt（或 voiceState.text）非空者都會被送出。Promise.allSettled
   * 確保任一失敗不影響其他模態。完成後彙整 toast 顯示成功 / 失敗數。
   */
  const handleBatchGenerate = useCallback(async () => {
    if (!requireAuth()) return;
    const modalities: Array<"image" | "video" | "audio" | "voice"> = [
      "image",
      "video",
      "audio",
      "voice",
    ];

    // 寶庫角色 / 場景:每個模態都該帶上,讓批次也能用 vault 注入
    const vaultPayload = {
      ...(vaultCharacterId ? { vaultCharacterId } : {}),
      ...(vaultSceneId ? { vaultSceneId } : {}),
    };
    const jobs = modalities
      .map(modality => {
        const builder = promptByModality[modality];
        const prompt = builder.compiledPrompt || builder.rawPrompt;
        if (modality === "voice") {
          if (!voiceState.text.trim()) return null;
          return {
            modality,
            input: {
              prompt: voiceState.text,
              generationType: "voice" as const,
              mode,
              voiceModelId: voiceState.voiceActorId,
              voiceText: voiceState.text,
              voiceSpeed: voiceState.speed,
              voiceStability: voiceState.stability,
              voiceEmotionType: voiceState.emotionType,
              voiceEmotionIntensity: voiceState.emotionIntensity,
              ...vaultPayload,
              fineTunedModelId,
              loraWeight,
            },
          };
        }
        if (!prompt.trim()) return null;
        if (modality === "image") {
          return {
            modality,
            input: {
              prompt,
              generationType: "image" as const,
              mode,
              aspectRatio: imageState.aspectRatio,
              negativePrompt: imageState.negativePrompt || undefined,
              styleReferenceUrl: imageState.styleReferenceUrl,
              vibeReferenceUrl: imageState.vibeReferenceUrl,
              ...vaultPayload,
              fineTunedModelId,
              loraWeight,
            },
          };
        }
        if (modality === "video") {
          return {
            modality,
            input: {
              prompt,
              generationType: "video" as const,
              mode,
              videoDurationSeconds: parseInt(videoState.duration) || 5,
              firstFrameUrl: videoState.firstFrameUrl,
              lastFrameUrl: videoState.lastFrameUrl,
              characterRefUrl: videoState.characterRefUrl,
              cameraMotion: videoState.cameraMotion,
              ...vaultPayload,
              fineTunedModelId,
              loraWeight,
            },
          };
        }
        // audio
        return {
          modality,
          input: {
            prompt,
            generationType: "audio" as const,
            mode,
            musicStyle: audioState.musicStyle,
            isInstrumental: audioState.isInstrumental,
            audioDuration: audioState.duration,
            ...vaultPayload,
            fineTunedModelId,
            loraWeight,
          },
        };
      })
      .filter((j): j is NonNullable<typeof j> => j !== null);

    if (!jobs.length) {
      toast.error("沒有可送出的內容（請先在任一模態填寫提示詞）");
      return;
    }

    toast.info(`正在平行送出 ${jobs.length} 個模態任務…`);
    const results = await Promise.allSettled(
      jobs.map(j => submitAsyncMutation.mutateAsync(j.input))
    );
    const success = results.filter(r => r.status === "fulfilled").length;
    const failed = results.length - success;
    if (success > 0) toast.success(`已送出 ${success} 個任務`);
    if (failed > 0) toast.error(`${failed} 個任務送出失敗`);
  }, [
    promptByModality,
    voiceState,
    imageState,
    videoState,
    audioState,
    mode,
    vaultCharacterId,
    vaultSceneId,
    fineTunedModelId,
    loraWeight,
    submitAsyncMutation,
    requireAuth,
  ]);

  const applySuggestedModel = useCallback(async () => {
    if (isApplyingSuggestedModel) return false;
    setIsApplyingSuggestedModel(true);
    try {
      const category =
        activeModality === "voice" || activeModality === "multimodal"
          ? "audio"
          : activeModality;
      const resp = await fetch(`/api/tools/models?category=${category}`);
      if (!resp.ok) {
        toast.error("模型服務暫時不可用，已為你切到模型頁");
        setToolboxTab("models");
        return false;
      }
      const list = await resp.json();
      const candidate = Array.isArray(list)
        ? list.find((m: any) => m?.default) ?? list[0]
        : null;
      if (!candidate?.id) {
        toast.info("目前此模態沒有可用模型");
        setToolboxTab("models");
        return false;
      }
      const modalityLabel =
        MODALITY_TABS.find(m => m.value === activeModality)?.label ?? "目前";
      setSelectedFalModelId(candidate.id);
      resetModelParams();
      setToolboxTab("models");
      toast.success(`已套用${modalityLabel}模型：${candidate.name ?? candidate.id}`);
      return true;
    } catch {
      toast.error("模型讀取失敗，已為你切到模型頁");
      setToolboxTab("models");
      return false;
    } finally {
      setIsApplyingSuggestedModel(false);
    }
  }, [activeModality, isApplyingSuggestedModel]);

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
    if (personalSettings.confirmBeforeGenerate) {
      const confirmed = window.confirm(
        "你已開啟「生成前二次確認」，確定要送出本次生成嗎？"
      );
      if (!confirmed) return;
    }

    const mutationInput = {
      prompt: activeModality === "voice" ? voiceState.text : prompt,
      generationType: activeModality,
      mode,
      vibeCardIds: promptBuilder.vibeCardIds,
      temperature,
      seed: seed.trim()
        ? isNaN(parseInt(seed))
          ? undefined
          : parseInt(seed)
        : undefined,
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
      // 背景任務模式：提交到 fal.ai queue，立刻回傳，不阻塞 UI
      await submitAsyncMutation.mutateAsync({
        prompt: mutationInput.prompt,
        generationType: activeModality as "image" | "video" | "audio" | "voice",
        mode,
        seed: mutationInput.seed,
        ...(activeModality === "image" && {
          aspectRatio: imageState.aspectRatio,
          negativePrompt: imageState.negativePrompt || undefined,
          styleReferenceUrl: imageState.styleReferenceUrl,
          vibeReferenceUrl: imageState.vibeReferenceUrl,
        }),
        ...(activeModality === "video" && {
          videoDurationSeconds: parseInt(videoState.duration) || 5,
          firstFrameUrl: videoState.firstFrameUrl,
          lastFrameUrl: videoState.lastFrameUrl,
          characterRefUrl: videoState.characterRefUrl,
          cameraMotion: videoState.cameraMotion,
        }),
        ...(activeModality === "audio" && {
          musicStyle: audioState.musicStyle,
          isInstrumental: audioState.isInstrumental,
          audioDuration: audioState.duration,
        }),
        ...(activeModality === "voice" && {
          voiceModelId: voiceState.voiceActorId,
          voiceText: voiceState.text,
          voiceSpeed: voiceState.speed,
          voiceStability: voiceState.stability,
          voiceEmotionType: voiceState.emotionType,
          voiceEmotionIntensity: voiceState.emotionIntensity,
        }),
        // 寶庫角色 / 場景:server 端會解析成參考圖 URL 後注入到對應的
        // styleReferenceUrl / characterRefUrl / firstFrameUrl / vibeReferenceUrl,
        // 之前漏傳 → server 拿不到 → 角色/場景被靜默忽略,使用者覺得「沒生效」
        ...(vaultCharacterId ? { vaultCharacterId } : {}),
        ...(vaultSceneId ? { vaultSceneId } : {}),
        fineTunedModelId,
        loraWeight,
        overrideModelId: directorModelOverride
          ? normalizeEngineModelId(directorModelOverride)
          : selectedFalModelId,
        modelParams: selectedModelParams,
      });
      setDirectorModelOverride(undefined);
    } catch {
      // Errors are handled by onError callback in the mutation
    }
  }, [
    promptBuilder,
    activeModality,
    mode,
    temperature,
    seed,
    imageState,
    videoState,
    audioState,
    voiceState,
    submitAsyncMutation,
    vaultCharacterId,
    vaultSceneId,
    fineTunedModelId,
    directorModelOverride,
    selectedModelParams,
    personalSettings.confirmBeforeGenerate,
    requireAuth,
  ]);

  // ── Vault select handler ──
  const handleVaultSelect = useCallback(
    (item: VaultItem) => {
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
          setImageState(prev => ({
            ...prev,
            styleReferenceUrl: item.imageUrl,
          }));
          toast.success(
            `已將「${item.name}」設為風格參考（角色特徵將注入生成）`
          );
        } else {
          toast.info("風格參考已設定，請先清除再載入");
        }
      } else if (activeModality === "audio") {
        toast.success(`已綁定「${item.name}」角色特徵至音樂生成`);
      } else if (activeModality === "voice") {
        toast.success(`已綁定「${item.name}」角色特徵至語音生成`);
      }
      if (isMobile) setToolboxSheetOpen(false);
    },
    [activeModality, videoState, imageState, isMobile]
  );

  const showLoraWeight =
    activeModality === "video"
      ? !!(videoState.firstFrameUrl || videoState.characterRefUrl)
      : activeModality === "image"
        ? !!imageState.styleReferenceUrl
        : false;

  // ── Handlers for new workspace components ──

  const handleBlocksChange = useCallback(
    (newBlocks: StructuredBlock[]) => {
      setStructuredBlocks(prev => ({ ...prev, [modalityKey]: newBlocks }));
    },
    [modalityKey]
  );

  const handleThoughtIslandsChange = useCallback(
    (newIslands: ThoughtIsland[]) => {
      setThoughtIslands(prev => ({ ...prev, [modalityKey]: newIslands }));
    },
    [modalityKey]
  );

  const handleReferencesChange = useCallback(
    (newRefs: ReferenceItem[]) => {
      setReferences(prev => ({ ...prev, [modalityKey]: newRefs }));
    },
    [modalityKey]
  );

  const handleVersionPin = useCallback(
    (versionId: string) => {
      const target = versions.find(v => v.id === versionId);
      if (!target) return;
      setVersionPinnedMutation.mutate({
        versionKey: versionId,
        pinned: !target.pinned,
      });
    },
    [versions, setVersionPinnedMutation]
  );

  const handleVersionRestore = useCallback(
    (versionId: string) => {
      const version = versions.find(v => v.id === versionId);
      if (!version) return;
      setStructuredBlocks(prev => ({
        ...prev,
        [version.modality]: version.blocks,
      }));
      setThoughtIslands(prev => ({
        ...prev,
        [version.modality]: version.thoughtIslands,
      }));
      setPromptStrength(version.promptStrength);
      setAdvancedPrompt(prev => ({
        ...prev,
        [version.modality]: version.advancedPrompt,
      }));
      setReferences(prev => ({
        ...prev,
        [version.modality]: version.references,
      }));
      if (version.modality !== modalityKey) {
        setActiveModality(
          version.modality === "music" ? "audio" : version.modality
        );
      }
      toast.success("已還原版本設定");
    },
    [versions, modalityKey]
  );

  const handleSaveRecipe = useCallback(
    (name: string) => {
      const payload = {
        blocks: structuredBlocks[modalityKey] || [],
        thoughtIslands: thoughtIslands[modalityKey] || [],
        promptStrength,
        advancedPrompt: advancedPrompt[modalityKey] || "",
        references: references[modalityKey] || [],
        generationParams: { temperature, seed, mode, loraWeight },
      };
      createRecipeMutation.mutate(
        { name, modality: modalityKey, payload },
        {
          onSuccess: () => toast.success(`已保存配方「${name}」`),
          onError: err =>
            toast.error(`保存配方失敗：${err.message || "請稍後重試"}`),
        }
      );
    },
    [
      modalityKey,
      structuredBlocks,
      thoughtIslands,
      promptStrength,
      advancedPrompt,
      references,
      temperature,
      seed,
      mode,
      loraWeight,
      createRecipeMutation,
    ]
  );

  const handleApplyRecipe = useCallback(
    (recipe: SavedRecipe) => {
      setStructuredBlocks(prev => ({
        ...prev,
        [recipe.modality]: recipe.blocks,
      }));
      setThoughtIslands(prev => ({
        ...prev,
        [recipe.modality]: recipe.thoughtIslands,
      }));
      setPromptStrength(recipe.promptStrength);
      setAdvancedPrompt(prev => ({
        ...prev,
        [recipe.modality]: recipe.advancedPrompt,
      }));
      setReferences(prev => ({
        ...prev,
        [recipe.modality]: recipe.references,
      }));
      if (recipe.modality !== modalityKey) {
        setActiveModality(
          recipe.modality === "music" ? "audio" : recipe.modality
        );
      }
      toast.success(`已套用配方「${recipe.name}」`);
    },
    [modalityKey]
  );

  const handleDeleteRecipe = useCallback(
    (recipeId: string) => {
      // SavedRecipe.id 形如 "recipe-db-<dbId>"（見 recipesQuery 還原）。
      const match = /^recipe-db-(\d+)$/.exec(recipeId);
      if (!match) {
        toast.error("無法刪除：配方未持久化");
        return;
      }
      const dbId = Number(match[1]);
      deleteRecipeMutation.mutate(
        { id: dbId },
        {
          onSuccess: () => toast.success("已刪除配方"),
          onError: err =>
            toast.error(`刪除配方失敗：${err.message || "請稍後重試"}`),
        }
      );
    },
    [deleteRecipeMutation]
  );

  const handleRefineAction = useCallback(
    (blockUpdates: { fieldKey: string; instruction: string }[]) => {
      setStructuredBlocks(prev => {
        const currentBlocks = [...(prev[modalityKey] || [])];
        for (const update of blockUpdates) {
          const idx = currentBlocks.findIndex(
            b => b.fieldKey === update.fieldKey
          );
          if (idx >= 0) {
            currentBlocks[idx] = {
              ...currentBlocks[idx],
              value: update.instruction,
              enabled: true,
            };
          }
        }
        return { ...prev, [modalityKey]: currentBlocks };
      });
      toast.success("已套用精修動作");
    },
    [modalityKey]
  );

  // ── 光球代理人：Studio 總控 ───────────────────────────────────────────
  // Studio 是 4 模態 × 2 模式 × 3 創作層級的核心頁；把最外層控制
  // 完整交給光球，讓使用者用自然語就能「切到影片、用專業模式」。
  //
  // Phase 4：深度整合 — 每個模態的所有可調參數都暴露給光球，
  // 包括選項列表 (options) 和目前值 (currentId)，讓 LLM 能主動
  // 幫使用者設定參數、討論「想要什麼感覺」→ 映射到具體參數。
  const studioCaps: AgentCapability[] = useMemo(() => {
    const caps: AgentCapability[] = [
      {
        action: "setModality",
        label: "模態",
        currentId: activeModality,
        options: MODALITY_TABS.map(t => ({ id: t.value, label: t.label })),
        hint: "image / video / audio(=music) / voice — audio 的 modalityKey 會被映射成 music",
      },
      {
        action: "setMode",
        label: "生成模式",
        currentId: mode,
        options: [
          { id: "lightning", label: "閃電", description: "快、便宜、適合試草稿" },
          {
            id: "deep_precision",
            label: "深度精磆",
            description: "高品質、較慢、專業用",
          },
        ],
        hint: "只接受 lightning | deep_precision",
      },
      {
        action: "applyPreset",
        label: "創作層級",
        currentId: `creative:${creativeMode}`,
        options: [
          { id: "creative:simple", label: "輕鬆模式", description: "只有提示詞，一鍵生成" },
          { id: "creative:standard", label: "標準模式", description: "顯示氛圍卡、品質控制" },
          { id: "creative:pro", label: "專業模式", description: "結構化 prompt、參考圖、進階參數" },
        ],
        hint: "以 creative:<simple|standard|pro> 切換創作界面複雜度",
      },
      {
        action: "fillPrompt",
        label: "提示詞",
        hint: "slot=prompt 填入主要提示詞；slot=negativePrompt 填入負面提示詞；slot=voice 填入語音文字；slot=lyrics 填入歌詞。append=true 可追加而非覆蓋。",
      },
      {
        action: "setParam",
        label: "進階參數",
        hint: [
          "全域: temperature(0~1)、seed(字串或數字)、loraWeight(0~1)",
          activeModality === "image"
            ? "圖片: aspectRatio(1:1/16:9/9:16/4:3/3:2)、negativePrompt(文字)"
            : "",
          activeModality === "video"
            ? "影片: duration(秒數字串,如\"5\"或\"8\"或\"10\")、cameraPan(-100~100)、cameraZoom(-100~100)、cameraTilt(-100~100)"
            : "",
          activeModality === "audio"
            ? "音樂: musicStyle(ambient/lofi/classical/electronic/jazz/cinematic/pop/rnb/folk/hiphop)、duration(秒數,10~180)、energy(0~100)、isInstrumental(true/false)、lyrics(文字)"
            : "",
          activeModality === "voice"
            ? "語音: voiceActorId(default-warm/default-calm/default-bright/default-narrator/default-child)、speed(0.5~2.0)、stability(0~1)、emotionType(neutral/happy/sad/excited/calm/serious)、emotionIntensity(0~1)"
            : "",
        ].filter(Boolean).join("；"),
      },
      {
        action: "submit",
        label: "送出生成",
        hint: "提示詞空或語音模態未填文字會失敗",
      },
      {
        action: "reset",
        label: "重設",
        hint: "清空提示詞與結果",
      },
    ];

    // ── 根據當前模態追加模態專屬選項 ──
    if (activeModality === "image") {
      caps.push({
        action: "setParam",
        label: "畫面比例",
        currentId: imageState.aspectRatio,
        options: [
          { id: "1:1", label: "1:1 正方形", description: "頭像、社群貼文" },
          { id: "16:9", label: "16:9 寬螢幕", description: "封面、影片縮圖、電影感" },
          { id: "9:16", label: "9:16 直式", description: "手機桌布、IG 限動、Reels" },
          { id: "4:3", label: "4:3 傳統", description: "傳統照片比例" },
          { id: "3:2", label: "3:2 相片", description: "經典攝影比例" },
        ],
        hint: "用 [ACTION:setParam:aspectRatio=16:9] 設定；使用者說「我想要直式的」→ 9:16、「橫幅」→ 16:9、「正方形」→ 1:1",
      });
    }

    if (activeModality === "video") {
      caps.push({
        action: "setParam",
        label: "影片時長",
        currentId: videoState.duration,
        options: [
          { id: "4", label: "4 秒", description: "快速預覽、GIF 感" },
          { id: "5", label: "5 秒", description: "短影片" },
          { id: "8", label: "8 秒", description: "標準長度（預設）" },
          { id: "10", label: "10 秒", description: "較長片段" },
        ],
        hint: "用 [ACTION:setParam:duration=8] 設定影片秒數",
      });
    }

    if (activeModality === "audio") {
      caps.push({
        action: "setParam",
        label: "音樂風格",
        currentId: audioState.musicStyle,
        options: [
          { id: "ambient", label: "環境音樂", description: "放鬆、冥想、背景音" },
          { id: "lofi", label: "Lo-Fi", description: "學習、工作、咖啡廳氣氛" },
          { id: "classical", label: "古典", description: "優雅、莊重" },
          { id: "electronic", label: "電子", description: "節奏感、現代" },
          { id: "jazz", label: "爵士", description: "慵懶、成熟" },
          { id: "cinematic", label: "電影配樂", description: "史詩感、情緒張力" },
          { id: "pop", label: "流行", description: "朗朗上口、大眾" },
          { id: "rnb", label: "R&B", description: "情感豐富、節奏" },
          { id: "folk", label: "民謠", description: "溫暖、自然" },
          { id: "hiphop", label: "嘻哈", description: "節拍強烈、韻律" },
        ],
        hint: "用 [ACTION:setParam:musicStyle=ambient] 設定。使用者說「放鬆的」→ ambient、「學習用」→ lofi、「有氣勢的」→ cinematic",
      });
    }

    if (activeModality === "voice") {
      caps.push(
        {
          action: "setParam",
          label: "語音角色",
          currentId: voiceState.voiceActorId,
          options: [
            { id: "default-warm", label: "溫暖女聲", description: "柔和、治癒感" },
            { id: "default-calm", label: "沉穩男聲", description: "深沉、可靠" },
            { id: "default-bright", label: "明亮女聲", description: "活潑、清晰" },
            { id: "default-narrator", label: "旁白男聲", description: "專業、敘事感" },
            { id: "default-child", label: "童聲", description: "天真、可愛" },
          ],
          hint: "用 [ACTION:setParam:voiceActorId=default-warm] 設定。使用者說「溫柔的」→ default-warm、「專業的」→ default-narrator",
        },
        {
          action: "setParam",
          label: "語音情緒",
          currentId: voiceState.emotionType,
          options: [
            { id: "neutral", label: "中性", description: "客觀平衡" },
            { id: "happy", label: "愉悅", description: "開心、陽光" },
            { id: "sad", label: "感傷", description: "低沉、感性" },
            { id: "excited", label: "興奮", description: "激動、熱情" },
            { id: "calm", label: "平靜", description: "安穩、舒緩" },
            { id: "serious", label: "嚴肅", description: "正式、權威" },
          ],
          hint: "用 [ACTION:setParam:emotionType=calm] 設定。使用者說「冥想引導」→ calm + default-warm、「廣告」→ excited + default-bright",
        }
      );
    }

    // ── 模型挑選能力 ──
    // 光球可以用 [ACTION:setModel:<falModelId>] 直接套用 Fal 模型；
    // 也接受純數字 LoRA fineTuned id（保留舊行為）。
    caps.push({
      action: "setModel",
      label: "生成模型",
      currentId: selectedFalModelId,
      options: orbFalModelOptions.map(m => ({
        id: m.id,
        label: m.name,
        description: m.id,
      })),
      hint: "Fal 模型用 modelId（含 / 或 fal: 前綴）；LoRA 微調模型用 myModels 的數字 id。",
    });

    // ── 工具箱深度操作 ──
    // 光球可以用 [ACTION:openDialog:toolbox?tab=<key>] 直接打開對應分頁。
    caps.push({
      action: "openDialog",
      label: "工具箱",
      options: [
        { id: "toolbox?tab=models", label: "模型挑選", description: "Fal 模型 / LoRA 微調" },
        { id: "toolbox?tab=controls", label: "進階控制", description: "溫度 / 種子 / LoRA 權重 / 模式" },
        { id: "toolbox?tab=vault", label: "一致性保險庫", description: "角色 / 場景一致性綁定" },
        { id: "toolbox?tab=assets", label: "數位資產", description: "翻過去用過的素材" },
      ],
      hint: "使用 dialogId='toolbox'，params.tab 可填 models / controls / vault / assets",
    });

    return caps;
  }, [activeModality, mode, creativeMode, imageState, videoState, audioState, voiceState, selectedFalModelId, orbFalModelOptions]);

  useRegisterPageAgent({
    pageId: "studio",
    pageLabel: "創作工作室",
    pagePath: "/studio",
    capabilities: studioCaps,
    state: {
      activeModality,
      // activeTab is an alias of activeModality so generic agents that look
      // for "tab" find the current section (orb, audit scripts, observers).
      activeTab: activeModality,
      mode,
      creativeMode,
      // selectedModelId / activeModel surface the currently-chosen FAL model
      // so the orb can decide whether to keep / swap before driving submit.
      selectedModelId: selectedFalModelId ?? null,
      activeModel: selectedFalModelId ?? null,
      // Provide a generic `prompt` alias alongside the existing
      // promptLength / promptPreview to satisfy LLM prompts that look for the
      // bare key, without leaking the full rawPrompt (capped at 120 chars).
      prompt: promptBuilder.rawPrompt.slice(0, 120) || "(空)",
      promptLength: promptBuilder.rawPrompt.length,
      promptPreview: promptBuilder.rawPrompt.slice(0, 120) || "(空)",
      hasResult: resultUrl !== null,
      // 模態專屬參數快照 — 讓 LLM 看到使用者目前的完整設定
      ...(activeModality === "image" && {
        aspectRatio: imageState.aspectRatio,
        negativePrompt: imageState.negativePrompt || "(無)",
      }),
      ...(activeModality === "video" && {
        duration: videoState.duration,
        cameraPan: videoState.cameraMotion.pan,
        cameraZoom: videoState.cameraMotion.zoom,
        cameraTilt: videoState.cameraMotion.tilt,
      }),
      ...(activeModality === "audio" && {
        musicStyle: audioState.musicStyle,
        duration: audioState.duration,
        energy: audioState.energy,
        isInstrumental: audioState.isInstrumental,
        hasLyrics: audioState.lyrics.length > 0,
      }),
      ...(activeModality === "voice" && {
        voiceActorId: voiceState.voiceActorId,
        speed: voiceState.speed,
        stability: voiceState.stability,
        emotionType: voiceState.emotionType,
        emotionIntensity: voiceState.emotionIntensity,
        voiceTextLength: voiceState.text.length,
      }),
      temperature,
      seed: seed || "(隨機)",
      loraWeight,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setModality": {
          const valid: GenerationType[] = ["image", "video", "audio", "voice"];
          if (!valid.includes(action.modality as GenerationType)) {
            return { ok: false, reason: `unknown modality: ${action.modality}` };
          }
          setActiveModality(action.modality as GenerationType);
          return { ok: true };
        }
        case "setMode": {
          if (action.modeId === "lightning" || action.modeId === "deep_precision") {
            setMode(action.modeId as GenerationMode);
            return { ok: true };
          }
          const creativeModeMap: Record<string, CreativeMode> = {
            inspiration: "simple",
            standard: "standard",
            professional: "pro",
          };
          const mapped = creativeModeMap[action.modeId];
          if (mapped) {
            setCreativeMode(mapped);
            return { ok: true, message: `已切換到 ${action.modeId} 模式` };
          }
          return { ok: false, reason: `unknown modeId: ${action.modeId}` };
        }
        case "applyPreset": {
          const id = action.presetId;
          if (id.startsWith("creative:")) {
            const cm = id.slice("creative:".length) as CreativeMode;
            if (cm === "simple" || cm === "standard" || cm === "pro") {
              setCreativeMode(cm);
              return { ok: true, message: `已切到「${cm}」層級` };
            }
          }
          return { ok: false, reason: `unknown presetId: ${id}` };
        }
        case "fillPrompt": {
          const slot = action.slot ?? "prompt";
          if (slot === "voice") {
            setVoiceState(prev => ({
              ...prev,
              text: action.append ? `${prev.text}${prev.text ? " " : ""}${action.text}` : action.text,
            }));
            return { ok: true, message: "已填入語音文字" };
          }
          if (slot === "lyrics") {
            setAudioState(prev => ({
              ...prev,
              lyrics: action.append ? `${prev.lyrics}${prev.lyrics ? "\n" : ""}${action.text}` : action.text,
              isInstrumental: false,
            }));
            return { ok: true, message: "已填入歌詞" };
          }
          if (slot === "negativePrompt") {
            if (activeModality === "image") {
              setImageState(prev => ({
                ...prev,
                negativePrompt: action.append
                  ? `${prev.negativePrompt}${prev.negativePrompt ? ", " : ""}${action.text}`
                  : action.text,
              }));
            } else {
              setNegativePrompts(prev => ({
                ...prev,
                [modalityKey]: action.append
                  ? `${prev[modalityKey] ?? ""}${prev[modalityKey] ? ", " : ""}${action.text}`
                  : action.text,
              }));
            }
            return { ok: true, message: "已填入負面提示詞" };
          }
          setPromptBuilder(prev => {
            const next = action.append && prev.rawPrompt.trim()
              ? `${prev.rawPrompt}, ${action.text}`
              : action.text;
            return { ...prev, rawPrompt: next, compiledPrompt: next };
          });
          return { ok: true, message: "已填入提示詞" };
        }
        case "setParam": {
          const { key, value } = action;
          switch (key) {
            // ── 全域參數 ──
            case "temperature":
              if (typeof value === "number") setTemperature(value);
              return { ok: true, message: `溫度已設為 ${value}` };
            case "seed":
              if (typeof value === "string" || typeof value === "number")
                setSeed(String(value));
              return { ok: true, message: `種子碼已設為 ${value}` };
            case "loraWeight":
              if (typeof value === "number") setLoraWeight(value);
              return { ok: true, message: `LoRA 權重已設為 ${value}` };

            // ── 圖片專屬 ──
            case "aspectRatio":
              setImageState(prev => ({ ...prev, aspectRatio: String(value) }));
              return { ok: true, message: `畫面比例已設為 ${value}` };
            case "negativePrompt":
              setImageState(prev => ({ ...prev, negativePrompt: String(value) }));
              return { ok: true, message: "負面提示詞已更新" };

            // ── 影片/音樂共用：duration ──
            // VideoWorkspaceState.duration 是 string（如 "8"），AudioWorkspaceState.duration 是 number
            case "duration":
              if (activeModality === "video") {
                setVideoState(prev => ({ ...prev, duration: String(value) }));
                return { ok: true, message: `影片時長已設為 ${value} 秒` };
              }
              if (activeModality === "audio") {
                setAudioState(prev => ({ ...prev, duration: Number(value) }));
                return { ok: true, message: `音樂時長已設為 ${value} 秒` };
              }
              return { ok: true };
            case "cameraPan":
              setVideoState(prev => ({
                ...prev,
                cameraMotion: { ...prev.cameraMotion, pan: Number(value) },
              }));
              return { ok: true, message: `鏡頭平移已設為 ${value}` };
            case "cameraZoom":
              setVideoState(prev => ({
                ...prev,
                cameraMotion: { ...prev.cameraMotion, zoom: Number(value) },
              }));
              return { ok: true, message: `鏡頭縮放已設為 ${value}` };
            case "cameraTilt":
              setVideoState(prev => ({
                ...prev,
                cameraMotion: { ...prev.cameraMotion, tilt: Number(value) },
              }));
              return { ok: true, message: `鏡頭俯仰已設為 ${value}` };

            // ── 音樂專屬 ──
            case "musicStyle":
              setAudioState(prev => ({ ...prev, musicStyle: String(value) }));
              return { ok: true, message: `音樂風格已設為 ${value}` };
            case "energy":
              setAudioState(prev => ({ ...prev, energy: Number(value) }));
              return { ok: true, message: `音樂能量已設為 ${value}` };
            case "isInstrumental":
              setAudioState(prev => ({ ...prev, isInstrumental: Boolean(value) }));
              return { ok: true, message: value ? "切為純音樂（無人聲）" : "切為含人聲歌曲" };
            case "lyrics":
              setAudioState(prev => ({ ...prev, lyrics: String(value), isInstrumental: false }));
              return { ok: true, message: "歌詞已填入" };

            // ── 語音專屬 ──
            case "voiceActorId":
              setVoiceState(prev => ({ ...prev, voiceActorId: String(value) }));
              return { ok: true, message: `語音角色已切換為 ${value}` };
            case "speed":
              setVoiceState(prev => ({ ...prev, speed: Number(value) }));
              return { ok: true, message: `語速已設為 ${value}` };
            case "stability":
              setVoiceState(prev => ({ ...prev, stability: Number(value) }));
              return { ok: true, message: `穩定度已設為 ${value}` };
            case "emotionType":
              setVoiceState(prev => ({ ...prev, emotionType: String(value) }));
              return { ok: true, message: `情緒已設為 ${value}` };
            case "emotionIntensity":
              setVoiceState(prev => ({ ...prev, emotionIntensity: Number(value) }));
              return { ok: true, message: `情緒強度已設為 ${value}` };

            default:
              return { ok: false, reason: `unknown param key: ${key}` };
          }
        }
        case "submit": {
          if (action.delayMs && action.delayMs > 0) {
            await new Promise(r => setTimeout(r, action.delayMs));
          }
          void handleGenerate();
          return { ok: true, message: "已送出生成" };
        }
        case "reset": {
          setPromptBuilder(createEmptyPromptOutput);
          setResultUrl(null);
          setResultData(null);
          return { ok: true };
        }
        case "openDialog": {
          const openToolbox = (tab: "vault" | "assets" | "models" | "controls") => {
            setToolboxTab(tab);
            setToolboxSheetOpen(true);
            setLeftDrawerOpen(false);
          };
          if (action.dialogId === "toolbox") {
            const tab =
              action.params && typeof action.params.tab === "string"
                ? action.params.tab
                : "assets";
            const normalized =
              tab === "vault" ||
              tab === "assets" ||
              tab === "models" ||
              tab === "controls"
                ? tab
                : "assets";
            openToolbox(normalized);
            return { ok: true, message: `已開啟工具箱（${normalized}）` };
          }
          if (action.dialogId === "toolbox-assets") {
            openToolbox("assets");
            return { ok: true };
          }
          if (action.dialogId === "toolbox-models") {
            openToolbox("models");
            return { ok: true };
          }
          if (action.dialogId === "toolbox-vault") {
            openToolbox("vault");
            return { ok: true };
          }
          if (action.dialogId === "toolbox-controls") {
            openToolbox("controls");
            return { ok: true };
          }
          return { ok: false, reason: `unknown dialogId: ${action.dialogId}` };
        }
        case "setModel": {
          // 兩種來源：
          //  1) 純數字 → 視為 LoRA fineTuned modelId（保留舊行為）
          //  2) 帶 "/" 或 "fal:" 前綴的字串 → 視為 Fal 模型 id（例如 fal-ai/flux/dev
          //     或 fal:fal-ai/flux/dev），把 selectedFalModelId 切過去
          const raw = String(action.modelId).trim();
          if (!raw) return { ok: false, reason: "setModel 需要 modelId" };
          const id = Number(raw);
          if (!Number.isNaN(id) && id > 0) {
            setFineTunedModelId(id);
            return { ok: true, message: `LoRA 模型已套用（id: ${id}）` };
          }
          const falId = raw.startsWith("fal:") ? raw.slice(4) : raw;
          if (falId.includes("/")) {
            setSelectedFalModelId(falId);
            resetModelParams();
            return { ok: true, message: `Fal 模型已套用：${falId}` };
          }
          return {
            ok: false,
            reason: `setModel 需要 LoRA 數字 id 或 Fal 模型 id（例如 fal-ai/flux/dev），收到：${raw}`,
          };
        }
        case "focusElement":
          return { ok: true };
        default:
          return { ok: false, reason: "unsupported action" };
      }
    },
  });

  return (
    <div className="page-shell space-y-4">
      {/* ── Header with Creative Mode Selector + Toolbox ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h1 className="hs-h3-lg !mb-0 text-foreground">創作工作室</h1>
            <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
              配額{" "}
              <span className="tabular-nums font-medium">
                {user?.remainingGenerations ?? 0}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Unified Toolbox button (replaces separate vault/settings/history) */}
          <Button
            variant={toolboxSheetOpen || leftDrawerOpen ? "default" : "outline"}
            size="sm"
            className="rounded-xl gap-1.5 text-xs h-8"
            onClick={() => {
              if (isMobile) {
                setToolboxSheetOpen(true);
              } else {
                setLeftDrawerOpen(!leftDrawerOpen);
              }
            }}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">工具箱</span>
          </Button>

          {/* Advanced studio entry — routes to ImageStudio / VideoStudio / ProStudio by modality */}
          {(() => {
            const advanced =
              activeModality === "image"
                ? { path: "/image-studio", label: "進階圖像創作" }
                : activeModality === "video"
                  ? { path: "/video-studio", label: "進階影片創作" }
                  : activeModality === "voice"
                    ? { path: "/pro-studio?tab=tts", label: "進階語音合成" }
                    : { path: "/pro-studio?tab=music", label: "進階配音音樂" };
            return (
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 text-xs h-8 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => navigate(advanced.path)}
                title={advanced.label}
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{advanced.label}</span>
              </Button>
            );
          })()}
        </div>
      </div>

      {/* ── Main Layout with Drawers ── */}
      <div className="flex gap-3 sm:gap-4">
        {/* ── Left Drawer: Vault + Assets ── */}
        {!isMobile && (
          <DrawerPanel
            open={leftDrawerOpen}
            side="left"
            title={
              leftDrawerTab === "vault"
                ? "一致性保險庫"
                : leftDrawerTab === "models"
                  ? "角色鍛造所"
                  : leftDrawerTab === "controls"
                    ? "進階控制（種子碼）"
                    : leftDrawerTab === "recipes"
                      ? "配方庫"
                      : leftDrawerTab === "versions"
                        ? "版本歷史"
                        : "數位資產"
            }
            icon={
              leftDrawerTab === "vault" ? (
                <Layers className="w-4 h-4 text-primary" />
              ) : leftDrawerTab === "models" ? (
                <Cpu className="w-4 h-4 text-primary" />
              ) : leftDrawerTab === "controls" ? (
                <SlidersHorizontal className="w-4 h-4 text-primary" />
              ) : leftDrawerTab === "recipes" ? (
                <Bookmark className="w-4 h-4 text-primary" />
              ) : leftDrawerTab === "versions" ? (
                <Clock className="w-4 h-4 text-primary" />
              ) : (
                <Package className="w-4 h-4 text-primary" />
              )
            }
            onClose={() => setLeftDrawerOpen(false)}
          >
            {/* Tab switcher inside drawer */}
            <div className="px-2 pt-2">
              <div className="flex gap-1 p-0.5 rounded-lg bg-muted/30">
                <button
                  onClick={() => setLeftDrawerTab("vault")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "vault"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Layers className="w-3 h-3 inline mr-1" />
                  保險庫
                </button>
                <button
                  onClick={() => setLeftDrawerTab("assets")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "assets"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Package className="w-3 h-3 inline mr-1" />
                  資產
                </button>
                <button
                  onClick={() => setLeftDrawerTab("models")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "models"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Cpu className="w-3 h-3 inline mr-1" />
                  模型
                </button>
                <button
                  onClick={() => setLeftDrawerTab("controls")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "controls"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <SlidersHorizontal className="w-3 h-3 inline mr-1" />
                  參數
                </button>
                <button
                  onClick={() => setLeftDrawerTab("recipes")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "recipes"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Bookmark className="w-3 h-3 inline mr-1" />
                  配方
                </button>
                <button
                  onClick={() => setLeftDrawerTab("versions")}
                  className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                    leftDrawerTab === "versions"
                      ? "bg-card shadow-sm text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Clock className="w-3 h-3 inline mr-1" />
                  版本
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
                      <button
                        onClick={() => setVaultCharacterId(undefined)}
                        className="hover:text-destructive"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {vaultSceneId && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      場景已綁定
                      <button
                        onClick={() => setVaultSceneId(undefined)}
                        className="hover:text-destructive"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  )}
                  {fineTunedModelId && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full">
                      <Cpu className="w-2.5 h-2.5" />
                      {fineTunedModelName || "微調模型"}
                      <button
                        onClick={() => {
                          setFineTunedModelId(undefined);
                          setFineTunedModelName(undefined);
                        }}
                        className="hover:text-destructive"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
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
                onApply={(id, name) => {
                  setFineTunedModelId(id);
                  setFineTunedModelName(name);
                  toast.success(`已套用模型「${name}」的觸發詞`);
                }}
                onRemove={() => {
                  setFineTunedModelId(undefined);
                  setFineTunedModelName(undefined);
                  toast.info("已移除微調模型");
                }}
              />
            ) : leftDrawerTab === "controls" ? (
              <div className="px-3 pb-3 pt-2">
                <GenerationControls
                  temperature={temperature}
                  onTemperatureChange={v => {
                    setTemperature(v);
                    notifyAdvancedParams();
                  }}
                  seed={seed}
                  onSeedChange={v => {
                    setSeed(v);
                    notifyAdvancedParams();
                  }}
                  mode={mode}
                  onModeChange={v => {
                    setMode(v);
                    notifyAdvancedParams();
                  }}
                  loraWeight={loraWeight}
                  onLoraWeightChange={setLoraWeight}
                  showLoraWeight={showLoraWeight}
                  seedOnly={isStandard}
                  selectedModelId={selectedFalModelId}
                />
              </div>
            ) : leftDrawerTab === "recipes" ? (
              <div className="px-2 pb-3">
                <RecipeLibraryPanel
                  modality={modalityKey}
                  savedRecipes={savedRecipes}
                  onApplyRecipe={handleApplyRecipe}
                  onSaveRecipe={handleSaveRecipe}
                  onDeleteRecipe={handleDeleteRecipe}
                />
              </div>
            ) : leftDrawerTab === "versions" ? (
              <div className="px-2 pb-3">
                <VersionHistoryPanel
                  versions={versions}
                  onPin={handleVersionPin}
                  onRestore={handleVersionRestore}
                  pinnedVersionId={pinnedVersionId}
                />
              </div>
            ) : (
              <MiniAssetsPanel />
            )}
          </DrawerPanel>
        )}

        {/* ── Center: Main Canvas ── */}
        <div
          className={cn(
            "flex-1 min-w-0",
            isSimple ? "space-y-6" : "space-y-4 sm:space-y-5"
          )}
        >
          {/* Modality Tabs — hidden in simple mode mode */}
          {!isSimple && (
            <Tabs
              value={activeModality}
              onValueChange={v => setActiveModality(v as GenerationType)}
            >
              <TabsList
                id="modality-tabs"
                className="w-full grid grid-cols-4 h-auto rounded-xl p-1 bg-card/40 border border-white/50 backdrop-blur-sm"
              >
                {MODALITY_TABS.map(t => (
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
          )}

          {/* ── Thought Islands (Pro mode only) ── */}
          {isPro && (
            <GlassCard hover={false}>
              <ThoughtIslandsPanel
                islands={thoughtIslands[modalityKey] || []}
                onChange={handleThoughtIslandsChange}
                modality={modalityKey}
              />
            </GlassCard>
          )}

          {/* Progressive Prompt Builder — z-20 ensures Self-Attention sliders stay above ThoughtIslandChain D3 canvas */}
          {activeModality !== "voice" && (
            <GlassCard
              hover={false}
              id="prompt-builder-area"
              className={cn("relative z-20", isSimple && "p-6 sm:p-8")}
            >
              <ProgressivePromptBuilder
                value={promptBuilder}
                onChange={setPromptBuilder}
                modality={activeModality}
                onType={len => {
                  reportTyping(len);
                  notifyTyping();
                }}
                simpleMode={isSimple}
              />
              {!isSimple && (
                <div className="mt-3 pt-3 border-t border-border/20">
                  <PromptStrengthBar
                    prompt={
                      promptBuilder.compiledPrompt || promptBuilder.rawPrompt
                    }
                    modality={
                      activeModality as "image" | "video" | "audio" | "voice"
                    }
                    onApplyOptimized={optimized => {
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
                          const separator = promptBuilder.rawPrompt.trim()
                            ? ", "
                            : "";
                          const newPrompt =
                            promptBuilder.rawPrompt.trim() +
                            separator +
                            action.actionPayload;
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
                                ? prev.negativePrompt +
                                  ", " +
                                  action.actionPayload
                                : action.actionPayload,
                            }));
                          } else {
                            // For non-image modalities, append as negative context to prompt
                            const separator = promptBuilder.rawPrompt.trim()
                              ? ", "
                              : "";
                            const newPrompt =
                              promptBuilder.rawPrompt.trim() +
                              separator +
                              "avoid: " +
                              action.actionPayload;
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
              )}

              {/* ── Inspiration Quick Panel (simple mode) ── */}
              {isSimple && (
                <div className="mt-4">
                  <InspirationQuickPanel
                    onApply={blocks => {
                      const parts = Object.entries(blocks)
                        .filter(([_, v]) => v)
                        .map(([_, label]) => label as string);
                      const inspirationPrompt = parts.join(", ");
                      const separator = promptBuilder.rawPrompt.trim()
                        ? ", "
                        : "";
                      const newRaw =
                        promptBuilder.rawPrompt.trim() +
                        separator +
                        inspirationPrompt;
                      setPromptBuilder(prev => ({
                        ...prev,
                        rawPrompt: newRaw,
                        compiledPrompt: newRaw,
                      }));
                      toast.success("已套用靈感 ✨");
                    }}
                  />
                </div>
              )}
            </GlassCard>
          )}

          {/* Modality-Specific Workspace / Personality Selector — hidden in simple mode */}
          {!isSimple && (
            <GlassCard hover={false} id="personality-selector">
              <div className="space-y-1">
                <h3 className="hs-h3 !mb-0 text-foreground flex items-center gap-2">
                  {activeModality === "image" && (
                    <>
                      <Image className="w-4 h-4 text-primary" /> 圖片工作區
                    </>
                  )}
                  {activeModality === "video" && (
                    <>
                      <Video className="w-4 h-4 text-primary" /> 影片工作區
                      <span
                        className="text-[10px] text-muted-foreground/40 font-normal"
                        title="Powered by Veo 3.1"
                      >
                        Veo 3.1
                      </span>
                    </>
                  )}
                  {activeModality === "audio" && (
                    <>
                      <Music className="w-4 h-4 text-primary" /> 音樂工作區
                      <span
                        className="text-[10px] text-muted-foreground/40 font-normal"
                        title="Powered by Suno"
                      >
                        Suno
                      </span>
                    </>
                  )}
                  {activeModality === "voice" && (
                    <>
                      <Mic className="w-4 h-4 text-primary" /> 語音工作區
                      <span
                        className="text-[10px] text-muted-foreground/40 font-normal"
                        title="Powered by ElevenLabs"
                      >
                        ElevenLabs
                      </span>
                    </>
                  )}
                </h3>
                <div className="h-px bg-border/30 my-3" />

                {activeModality === "image" && (
                  <ImageWorkspace value={imageState} onChange={setImageState} compactMode={isStandard} />
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
          )}

          {/* ── Structured Prompt Blocks — hidden in simple mode ── */}
          {!isSimple && (
            <GlassCard hover={false}>
              <StructuredBlocksEditor
                blocks={structuredBlocks[modalityKey] || []}
                onChange={handleBlocksChange}
                modality={modalityKey}
                workspaceMode={workspaceMode}
              />
            </GlassCard>
          )}

          {/* ── Prompt Strength Control — pro mode only (hidden in standard/simple) ── */}
          {isPro && (
            <GlassCard hover={false}>
              <PromptStrengthControl
                value={promptStrength}
                onChange={setPromptStrength}
                modality={modalityKey}
              />
            </GlassCard>
          )}

          {/* ── Reference Materials (pro only) ── */}
          {isPro && (
            <GlassCard hover={false}>
              <ReferencePanel
                references={references[modalityKey] || []}
                onChange={handleReferencesChange}
                modality={modalityKey}
              />
            </GlassCard>
          )}

          {/* ── Advanced Prompt Panel (pro only) ── */}
          {isPro && (
            <AdvancedPromptPanel
              compiledPrompt={compileResult.compiledPrompt}
              advancedPrompt={advancedPrompt[modalityKey] || ""}
              onAdvancedPromptChange={val =>
                setAdvancedPrompt(prev => ({ ...prev, [modalityKey]: val }))
              }
              override={advancedPromptOverride[modalityKey] || false}
              onOverrideChange={val =>
                setAdvancedPromptOverride(prev => ({
                  ...prev,
                  [modalityKey]: val,
                }))
              }
              negativePrompt={negativePrompts[modalityKey] || ""}
              onNegativePromptChange={val =>
                setNegativePrompts(prev => ({ ...prev, [modalityKey]: val }))
              }
              modality={modalityKey}
            />
          )}

          {/* ── Prompt Compiler Preview (pro only) ── */}
          {isPro && (
            <PromptCompilerPreview
              compiledPrompt={compileResult.compiledPrompt}
              warnings={promptWarnings}
              changedFields={compileResult.changedFields}
              summary={compileResult.summary}
            />
          )}

          {/* Generate / Refine / Branch + Mode Toggle */}
          <GenerationActionBar
            actionMode={actionMode}
            onActionModeChange={setActionMode}
            onGenerate={handleGenerate}
            isGenerating={submitAsyncMutation.isPending}
            hasResult={!!resultUrl}
            simpleMode={isSimple}
          />

          {/* 全模態送出：偵測有填寫提示詞的模態並平行送出 */}
          {(() => {
            const filledModalities = (
              ["image", "video", "audio", "voice"] as const
            ).filter(m => {
              if (m === "voice") return !!voiceState.text.trim();
              const b = promptByModality[m];
              return !!(b.compiledPrompt || b.rawPrompt).trim();
            });
            if (filledModalities.length < 2) return null;
            return (
              <button
                onClick={() => void handleBatchGenerate()}
                disabled={submitAsyncMutation.isPending}
                className="mt-2 w-full rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors px-4 py-2.5 text-xs flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  全模態送出（{filledModalities.length} 個：
                  {filledModalities
                    .map(m =>
                      m === "image"
                        ? "圖片"
                        : m === "video"
                          ? "影片"
                          : m === "audio"
                            ? "音樂"
                            : "語音"
                    )
                    .join("、")}
                  ）
                </span>
              </button>
            );
          })()}

          {/* 徵詢導演 AI：把當前 4 模態 + 設定送給導演，回傳 actions 自動 dispatch */}
          <button
            onClick={() => void handleAskDirector()}
            disabled={askDirectorMutation.isPending}
            className="mt-2 w-full rounded-xl border border-amber-400/30 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 transition-colors px-4 py-2 text-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {askDirectorMutation.isPending
                ? "導演思考中…"
                : "徵詢導演 AI（自動套用建議）"}
            </span>
          </button>

          {/* Thought Island Chain — z-10 below PromptBuilder's z-20 */}
          <AnimatePresence>
            {(thoughtChain.length > 0 || submitAsyncMutation.isPending) && (
              <motion.div
                className="relative z-10"
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <ThoughtIslandChain
                  nodes={
                    thoughtChain.length > 0
                      ? thoughtChain
                      : [
                          {
                            id: "safety",
                            label: "安全檢查",
                            status: "processing",
                            detail: "正在驗證...",
                            timestamp: Date.now(),
                          },
                          {
                            id: "compile",
                            label: "提示詞編譯",
                            status: "queued",
                            detail: "等待中...",
                            timestamp: Date.now(),
                          },
                          {
                            id: "generate",
                            label: "AI 生成",
                            status: "queued",
                            detail: "等待中...",
                            timestamp: Date.now(),
                          },
                        ]
                  }
                  isVisible={true}
                  onPinToNotes={node => {
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
                  <h3 className="hs-h3 !mb-0 text-foreground">生成結果</h3>
                  {resultUrl && (
                    <div className="rounded-xl overflow-hidden shadow-sm">
                      {activeModality === "video" ? (
                        <video
                          src={resultUrl}
                          controls
                          autoPlay
                          loop
                          playsInline
                          className="w-full rounded-xl max-h-64 sm:max-h-80 lg:max-h-[400px]"
                        />
                      ) : activeModality === "audio" ||
                        activeModality === "voice" ? (
                        <div className="p-4 flex flex-col items-center gap-3">
                          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center">
                            {activeModality === "audio" ? (
                              <Music className="w-8 h-8 text-purple-400" />
                            ) : (
                              <Mic className="w-8 h-8 text-cyan-400" />
                            )}
                          </div>
                          <audio
                            src={resultUrl}
                            controls
                            autoPlay
                            className="w-full"
                          />
                        </div>
                      ) : (
                        <img
                          src={resultUrl}
                          alt="Generated"
                          className="w-full object-cover max-h-[400px] sm:max-h-[500px] lg:max-h-[600px]"
                          loading="lazy"
                        />
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
                    <p className="font-medium text-foreground text-[11px] mb-2">
                      生成詳情
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span>
                        模態：
                        {activeModality === "image"
                          ? "圖片"
                          : activeModality === "video"
                            ? "影片"
                            : activeModality === "audio"
                              ? "音樂"
                              : "語音"}
                      </span>
                      <span>
                        模式：{mode === "lightning" ? "閃電" : "深度精磆"}
                      </span>
                      <span>Temperature：{temperature}</span>
                      <span>Seed：{seed || "random"}</span>
                      <span>LoRA 權重：{loraWeight}</span>
                      {promptBuilder.vibeCardIds.length > 0 && (
                        <span className="col-span-2">
                          Vibe Cards：{promptBuilder.vibeCardIds.join(", ")}
                        </span>
                      )}
                    </div>
                    {promptBuilder.compiledPrompt && (
                      <div className="mt-2 pt-2 border-t border-border/20">
                        <p className="font-medium text-foreground text-[11px] mb-1">
                          編譯後提示詞
                        </p>
                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap">
                          {promptBuilder.compiledPrompt}
                        </p>
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
                          const ext =
                            activeModality === "image"
                              ? blob.type.includes("png")
                                ? "png"
                                : blob.type.includes("webp")
                                  ? "webp"
                                  : "jpg"
                              : activeModality === "video"
                                ? "mp4"
                                : activeModality === "audio"
                                  ? blob.type.includes("wav")
                                    ? "wav"
                                    : "mp3"
                                  : blob.type.includes("wav")
                                    ? "wav"
                                    : "mp3";
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
                      下載{" "}
                      {activeModality === "image"
                        ? "PNG"
                        : activeModality === "video"
                          ? "MP4"
                          : "MP3"}
                    </Button>
                  )}

                  {/* ── Copy Result URL ── */}
                  {resultUrl && (
                    <Button
                      variant="outline"
                      className="w-full rounded-xl gap-2 text-sm"
                      onClick={() => {
                        void copyToClipboard(resultUrl, "已複製結果連結");
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
                        const timestamp = new Date()
                          .toISOString()
                          .replace(/[:.]/g, "-")
                          .slice(0, 19);

                        // Determine file extension by modality
                        const extMap: Record<string, string> = {
                          image: "png",
                          video: "mp4",
                          audio: "mp3",
                          voice: "mp3",
                        };
                        const defaultExt = extMap[activeModality] || "bin";

                        // Download and add the generated asset (via proxy to avoid CORS)
                        if (resultUrl) {
                          try {
                            const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(resultUrl)}`;
                            const resp = await fetch(proxyUrl);
                            if (!resp.ok)
                              throw new Error(`proxy ${resp.status}`);
                            const blob = await resp.blob();
                            let ext = defaultExt;
                            if (activeModality === "image") {
                              ext = blob.type.includes("png")
                                ? "png"
                                : blob.type.includes("webp")
                                  ? "webp"
                                  : "jpg";
                            } else if (activeModality === "video") {
                              ext = blob.type.includes("webm") ? "webm" : "mp4";
                            } else if (
                              activeModality === "audio" ||
                              activeModality === "voice"
                            ) {
                              ext = blob.type.includes("wav")
                                ? "wav"
                                : blob.type.includes("ogg")
                                  ? "ogg"
                                  : "mp3";
                            }
                            zip.file(
                              `generated-${activeModality}.${ext}`,
                              blob
                            );
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
                        lines.push(
                          `生成時間：${new Date().toLocaleString("zh-TW")}`
                        );
                        lines.push(
                          `模態：${activeModality === "image" ? "圖片" : activeModality === "video" ? "影片" : activeModality === "audio" ? "音樂" : "語音"}`
                        );
                        lines.push(
                          `模式：${mode === "lightning" ? "閃電模式 (Flash)" : "專業模式 (Pro)"}`
                        );
                        lines.push(`創意溫度：${temperature}`);
                        lines.push(`種子碼：${seed || "隨機"}`);
                        lines.push(`LoRA 權重：${loraWeight}`);
                        lines.push("");
                        lines.push("── 提示詞 ──");
                        lines.push(
                          `原始輸入：${promptBuilder.rawPrompt || "(空)"}`
                        );
                        lines.push(
                          `編譯結果：${promptBuilder.compiledPrompt || "(未編譯)"}`
                        );
                        if (promptBuilder.vibeCardIds.length > 0) {
                          lines.push(
                            `Vibe Cards：${promptBuilder.vibeCardIds.join(", ")}`
                          );
                        }
                        lines.push("");

                        // Modality-specific params
                        if (activeModality === "image") {
                          lines.push("── 圖片參數 ──");
                          lines.push(`長寬比：${imageState.aspectRatio}`);
                          lines.push(
                            `負面提示詞：${imageState.negativePrompt || "(無)"}`
                          );
                          lines.push(
                            `風格參考圖：${imageState.styleReferenceUrl || "(無)"}`
                          );
                          lines.push(
                            `氛圍參考圖：${imageState.vibeReferenceUrl || "(無)"}`
                          );
                        } else if (activeModality === "video") {
                          lines.push("── 影片參數 ──");
                          lines.push(`時長：${videoState.duration}`);
                          lines.push(
                            `鏡頭運動：${videoState.cameraMotion || "(無)"}`
                          );
                          lines.push(
                            `首幀圖片：${videoState.firstFrameUrl || "(無)"}`
                          );
                          lines.push(
                            `末幀圖片：${videoState.lastFrameUrl || "(無)"}`
                          );
                          lines.push(
                            `角色參考：${videoState.characterRefUrl || "(無)"}`
                          );
                        } else if (activeModality === "audio") {
                          lines.push("── 音樂參數 ──");
                          lines.push(`音樂風格：${audioState.musicStyle}`);
                          lines.push(`能量等級：${audioState.energy}`);
                          lines.push(
                            `純樂器：${audioState.isInstrumental ? "是" : "否"}`
                          );
                          lines.push(
                            `自訂歌詞：${audioState.lyrics || "(無)"}`
                          );
                        } else if (activeModality === "voice") {
                          lines.push("── 語音參數 ──");
                          lines.push(`語音角色：${voiceState.voiceActorId}`);
                          lines.push(`語速：${voiceState.speed}`);
                          lines.push(`情緒類型：${voiceState.emotionType}`);
                          lines.push(
                            `情緒強度：${voiceState.emotionIntensity}`
                          );
                          lines.push(`穩定度：${voiceState.stability}`);
                          lines.push(`文案：${voiceState.text || "(空)"}`);
                        }

                        // Thought chain
                        if (thoughtChain.length > 0) {
                          lines.push("");
                          lines.push("── AI 推理鏈 ──");
                          thoughtChain.forEach(n => {
                            lines.push(
                              `[${n.status.toUpperCase()}] ${n.label}：${n.detail}`
                            );
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
                          prompt: {
                            raw: promptBuilder.rawPrompt,
                            compiled: promptBuilder.compiledPrompt,
                            vibeCardIds: promptBuilder.vibeCardIds,
                          },
                          ...(activeModality === "image"
                            ? { imageParams: imageState }
                            : {}),
                          ...(activeModality === "video"
                            ? { videoParams: videoState }
                            : {}),
                          ...(activeModality === "audio"
                            ? { audioParams: audioState }
                            : {}),
                          ...(activeModality === "voice"
                            ? { voiceParams: voiceState }
                            : {}),
                          resultUrl,
                          thoughtChain,
                          generatedAt: new Date().toISOString(),
                        };
                        zip.file(
                          "metadata.json",
                          JSON.stringify(metadata, null, 2)
                        );

                        const content = await zip.generateAsync({
                          type: "blob",
                        });
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

      </div>

      {/* ── Mobile Bottom Sheets ── */}
      {isMobile && (
        <>
          {/* Unified Toolbox bottom sheet */}
          <BottomSheet
            open={toolboxSheetOpen}
            onClose={() => setToolboxSheetOpen(false)}
            title="🗂️ 工具箱"
          >
            <div className="px-2 pt-2">
              <div className="rounded-xl border border-border/60 bg-background/60 p-2">
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  全模式快速切換
                </p>
                <div className="grid grid-cols-4 gap-1">
                  {MODALITY_TABS.map(mod => (
                    <button
                      key={mod.value}
                      onClick={() => setActiveModality(mod.value)}
                      className={`rounded-lg py-1.5 text-[11px] flex items-center justify-center gap-1 ${
                        activeModality === mod.value
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {mod.icon}
                      <span>{mod.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-2 pt-1">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-foreground">工具箱 × 工作區連結</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setToolboxTab("vault")}
                      className="text-[10px] px-2 py-1 rounded-full bg-primary/15 text-primary hover:bg-primary/20 transition-colors"
                    >
                      開啟保險庫
                    </button>
                    <button
                      onClick={() => {
                        void applySuggestedModel();
                      }}
                      disabled={isApplyingSuggestedModel}
                      className="text-[10px] px-2 py-1 rounded-full bg-muted/60 text-foreground hover:bg-muted transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isApplyingSuggestedModel ? "套用中..." : "套用建議模型"}
                    </button>
                    <button
                      onClick={async () => {
                        const applied = await applySuggestedModel();
                        if (!applied) return;
                        setToolboxSheetOpen(false);
                        void handleGenerate();
                      }}
                      disabled={isApplyingSuggestedModel || submitAsyncMutation.isPending}
                      className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {submitAsyncMutation.isPending ? "生成中..." : "套用並生成"}
                    </button>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground leading-relaxed">
                  <li>• 先在「保險庫」選角色/場景，拖放到工作區保持一致性。</li>
                  <li>• 到「參數」鎖定 seed 與模式，再切換到對應的進階創作室。</li>
                  <li>• 若要跨模態延伸，先從上方切換圖片/影片/音樂/語音再生成。</li>
                </ul>
              </div>
            </div>
            <div className="flex gap-1 p-2 mb-2 flex-wrap">
              {(
                [
                  "vault",
                  "assets",
                  "models",
                  "controls",
                  "recipes",
                  "versions",
                ] as const
              ).map(tab => {
                const labels: Record<string, string> = {
                  vault: "保險庫",
                  assets: "資產",
                  models: "模型",
                  controls: "參數",
                  recipes: "配方",
                  versions: "版本",
                };
                return (
                  <button
                    key={tab}
                    onClick={() => setToolboxTab(tab)}
                    className={`flex-1 text-xs py-2 rounded-lg transition-colors min-w-[60px] ${
                      toolboxTab === tab
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
            {toolboxTab === "vault" && (
              <ConsistencyVault onSelect={handleVaultSelect} />
            )}
            {toolboxTab === "assets" && <MiniAssetsPanel />}
            {toolboxTab === "models" && (
              <MiniModelsPanel
                activeModelId={fineTunedModelId}
                selectedFalModelId={selectedFalModelId}
                onSelectFalModel={setSelectedFalModelId}
                modelParams={selectedModelParams}
                onChangeModelParams={setSelectedModelParams}
                activeCategory={activeModality}
                onApply={(id, name) => {
                  setFineTunedModelId(id);
                  setFineTunedModelName(name);
                  toast.success(`已套用模型「${name}」`);
                }}
                onRemove={() => {
                  setFineTunedModelId(undefined);
                  setFineTunedModelName(undefined);
                  toast.info("已移除微調模型");
                }}
              />
            )}
            {toolboxTab === "controls" && (
              <GenerationControls
                temperature={temperature}
                onTemperatureChange={v => {
                  setTemperature(v);
                  notifyAdvancedParams();
                }}
                seed={seed}
                onSeedChange={v => {
                  setSeed(v);
                  notifyAdvancedParams();
                }}
                mode={mode}
                onModeChange={v => {
                  setMode(v);
                  notifyAdvancedParams();
                }}
                loraWeight={loraWeight}
                onLoraWeightChange={setLoraWeight}
                showLoraWeight={showLoraWeight}
                seedOnly={isStandard}
                selectedModelId={selectedFalModelId}
              />
            )}
            {toolboxTab === "recipes" && (
              <div className="px-2 pb-3">
                <RecipeLibraryPanel
                  modality={modalityKey}
                  savedRecipes={savedRecipes}
                  onApplyRecipe={handleApplyRecipe}
                  onSaveRecipe={handleSaveRecipe}
                  onDeleteRecipe={handleDeleteRecipe}
                />
              </div>
            )}
            {toolboxTab === "versions" && (
              <div className="px-2 pb-3">
                <VersionHistoryPanel
                  versions={versions}
                  onPin={handleVersionPin}
                  onRestore={handleVersionRestore}
                  pinnedVersionId={pinnedVersionId}
                />
              </div>
            )}
          </BottomSheet>
        </>
      )}

      {/* Floating Proactive Orb Widget — hidden */}
    </div>
  );
}

// ─── Mini Assets Panel (embedded in left drawer) ────────────────────────────

function MiniAssetsPanel() {
  const myAssetsQuery = trpc.assets.myAssets.useQuery(undefined, {
    retry: false,
  });

  if (myAssetsQuery.isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const assets = myAssetsQuery.data?.items ?? [];

  if (!assets.length) {
    return (
      <div className="p-6 text-center">
        <Package className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">尚無數位資產</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          生成作品後會自動保存至此
        </p>
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
            <img
              src={asset.thumbnailUrl}
              alt=""
              className="w-8 h-8 rounded object-cover shrink-0"
              loading="lazy"
            />
          ) : (
            <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
              {ASSET_ICONS[asset.type] || <Package className="w-3 h-3" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-foreground truncate">
              {asset.name || "未命名"}
            </p>
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
  selectedFalModelId,
  onSelectFalModel = () => {},
  modelParams = {},
  onChangeModelParams = () => {},
  activeCategory = "image",
  onApply,
  onRemove,
}: {
  activeModelId?: number;
  selectedFalModelId?: string;
  onSelectFalModel?: (id: string | undefined) => void;
  modelParams?: Record<string, string | number | boolean>;
  onChangeModelParams?: (next: Record<string, string | number | boolean>) => void;
  activeCategory?: "image" | "video" | "audio" | "voice" | "multimodal";
  onApply: (id: number, name: string) => void;
  onRemove: () => void;
}) {
  // 能力徽章：根據選中的 fal 模型顯示支援的功能
  const modelCapability = selectedFalModelId
    ? getModelCapability(selectedFalModelId)
    : null;
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const [falModels, setFalModels] = useState<Array<any>>([]);
  const myModelsQuery = trpc.models.myModels.useQuery(undefined, {
    retry: false,
  });
  useEffect(() => {
    const mappedCategory =
      activeCategory === "voice" || activeCategory === "multimodal"
        ? "audio"
        : activeCategory;
    fetch(`/api/tools/models?category=${mappedCategory}`)
      .then(r => r.json())
      .then(setFalModels)
      .catch(() => setFalModels([]));
  }, [activeCategory]);

  if (myModelsQuery.isLoading) {
    return (
      <div className="p-3 space-y-2">
        {[1, 2, 3].map(i => (
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
        <p className="text-xs text-muted-foreground/60 mt-1">
          前往「角色鍛造所」訓練你的專屬模型
        </p>
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
    <div className="space-y-2 p-2">
      <div className="rounded-lg border border-border/50 p-2">
        <p className="text-[11px] text-muted-foreground mb-1">Fal 模型選擇</p>
        <select
          className="w-full rounded-md bg-muted/30 px-2 py-1.5 text-xs"
          value={selectedFalModelId ?? ""}
          onChange={e => {
            onSelectFalModel(e.target.value || undefined);
            onChangeModelParams({});
          }}
        >
          <option value="">使用預設模型</option>
          {falModels.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {modelCapability && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(Object.entries(modelCapability.features) as Array<
              [keyof FalModelCapabilityFeatures, boolean]
            >)
              .filter(([key]) => key !== "seed")
              .map(([key, supported]) => (
                <span
                  key={key}
                  className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                    supported
                      ? "border-green-500/30 bg-green-500/10 text-green-700"
                      : "border-muted/40 bg-muted/20 text-muted-foreground line-through"
                  }`}
                  title={
                    supported
                      ? `支援 ${FEATURE_LABELS[key]}`
                      : `此模型不支援 ${FEATURE_LABELS[key]}（會被忽略）`
                  }
                >
                  {FEATURE_LABELS[key]}
                </span>
              ))}
          </div>
        )}
        <button
          className="mt-2 text-xs text-primary hover:underline"
          onClick={() => setOpenAdvanced(v => !v)}
        >
          進階設定
        </button>
        {openAdvanced && selectedFalModelId && (
          <div className="mt-2 space-y-2">
            {(falModels.find(m => m.id === selectedFalModelId)?.params ?? []).map((p: any) => (
              <div key={p.key} className="space-y-1">
                <label className="text-[11px] text-muted-foreground">{p.label}</label>
                {p.type === "number" && (
                  <div>
                    <input type="range" min={p.min ?? 0} max={p.max ?? 100} step={p.step ?? 1}
                      value={Number(modelParams[p.key] ?? p.default ?? 0)}
                      onChange={e => onChangeModelParams({ ...modelParams, [p.key]: Number(e.target.value) })}
                      className="w-full" />
                    <div className="text-[11px]">{String(modelParams[p.key] ?? p.default ?? 0)}</div>
                  </div>
                )}
                {p.type === "select" && (
                  <select className="w-full rounded-md bg-muted/20 px-2 py-1 text-xs"
                    value={String(modelParams[p.key] ?? p.default ?? "")}
                    onChange={e => onChangeModelParams({ ...modelParams, [p.key]: e.target.value })}>
                    {(p.options ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {p.type === "boolean" && (
                  <input type="checkbox" checked={Boolean(modelParams[p.key] ?? p.default ?? false)}
                    onChange={e => onChangeModelParams({ ...modelParams, [p.key]: e.target.checked })} />
                )}
                {p.type === "string" && (
                  <input type="text" className="w-full rounded-md bg-muted/20 px-2 py-1 text-xs"
                    value={String(modelParams[p.key] ?? p.default ?? "")}
                    onChange={e => onChangeModelParams({ ...modelParams, [p.key]: e.target.value })} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {models.map((model: any) => {
        const isActive = activeModelId === model.id;
        const isReady = model.status === "ready";
        const statusInfo = STATUS_LABELS[model.status] || STATUS_LABELS.pending;
        const triggerWord = model.configJson?.triggerWord as string | undefined;

        return (
          <div
            key={model.id}
            className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
              isActive
                ? "bg-primary/10 ring-1 ring-primary/30"
                : "hover:bg-accent/30"
            }`}
          >
            <div className="w-8 h-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate font-medium">
                {model.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusInfo.color}`}
                >
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
                onClick={() =>
                  isActive ? onRemove() : onApply(model.id, model.name)
                }
                className={`shrink-0 text-[10px] px-2 py-1 rounded-md transition-colors ${
                  isActive
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                {isActive ? (
                  <>
                    <X className="w-2.5 h-2.5 inline mr-0.5" />
                    移除
                  </>
                ) : (
                  <>
                    <Check className="w-2.5 h-2.5 inline mr-0.5" />
                    套用
                  </>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
