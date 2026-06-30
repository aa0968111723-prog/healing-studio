import { useState, useEffect, useMemo, useCallback, useRef, type ChangeEvent } from "react";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Brain,
  Cpu,
  Image,
  Video,
  Music,
  Mic,
  Save,
  RotateCcw,
  Activity,
  Sparkles,
  Zap,
  Shield,
  ChevronRight,
  Box,
  FileJson,
  MessageSquare,
  Volume2,
  Clapperboard,
  Wand2,
  Layers,
  Radio,
  FileText,
  VideoIcon,
  Dumbbell,
  ChevronDown,
  AlertTriangle,
  Bug,
  Lightbulb,
  Globe,
  Target,
  Check,
  X,
  Search,
  BookOpen,
  Play,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";
import { useLocation, useSearch } from "wouter";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { normalizeEngineModelId } from "../../../shared/engineModelIds";
import {
  ERROR_CATEGORY_LABEL_MAP,
  ERROR_CATEGORY_COLOR_MAP,
  ERROR_CATEGORY_EMOJI_LABELS,
  FAL_TASK_UPSERT_KEY,
  FAL_TASK_DEFAULTS,
  type ModelOption,
  type SlotCatalog,
  type HealthState,
  type HealthStatus,
  type FalTaskKey,
} from "./admin/brain/_shared";
import {
  HealthDot,
  TierBadge,
  ProviderBadge,
} from "./admin/brain/_components/Badges";
import { LangsmithTab } from "./admin/brain/tabs/LangsmithTab";
import { AlertsTab } from "./admin/brain/tabs/AlertsTab";
import { ProposalsTab } from "./admin/brain/tabs/ProposalsTab";
import { ResearchTab } from "./admin/brain/tabs/ResearchTab";
import { AccuracyTab } from "./admin/brain/tabs/AccuracyTab";
import { ErrorsTab } from "./admin/brain/tabs/ErrorsTab";
import { LivePreview } from "./admin/brain/_components/LivePreview";
import {
  BrainSlotCard,
  EngineSlotCard,
  FalTaskCard,
} from "./admin/brain/_components/SlotCards";

// ═══════════════════════════════════════════════════════════════════════════
// Types (page-local helpers)
// ═══════════════════════════════════════════════════════════════════════════

type TextareaChangeEvent = React.ChangeEvent<HTMLTextAreaElement>;

function withTextareaValue(handler?: (value: string) => void) {
  return (e: TextareaChangeEvent) => {
    handler?.(e.target.value);
  };
}

// Icons for each Fal task category
const FAL_TASK_ICONS: Record<
  FalTaskKey,
  React.ComponentType<{ className?: string }>
> = {
  "image-to-3d": Box,
  "image-to-image": Wand2,
  "image-to-json": FileJson,
  "image-to-video": VideoIcon,
  json: FileJson,
  llm: MessageSquare,
  "text-to-3d": Box,
  "text-to-audio": Music,
  "text-to-image": Image,
  "text-to-json": FileText,
  "text-to-speech": Volume2,
  "text-to-video": Clapperboard,
  training: Dumbbell,
  "video-to-audio": Radio,
  "video-to-text": FileText,
  "video-to-video": Layers,
};

// ═══════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════

const FAL_TASK_KEYS: FalTaskKey[] = [
  "image-to-3d",
  "image-to-image",
  "image-to-json",
  "image-to-video",
  "json",
  "llm",
  "text-to-3d",
  "text-to-audio",
  "text-to-image",
  "text-to-json",
  "text-to-speech",
  "text-to-video",
  "training",
  "video-to-audio",
  "video-to-text",
  "video-to-video",
];

export default function AiBrainSettings() {
  const { aiState, setPageContext, personality } = useAIState();

  useEffect(() => {
    setPageContext({ pageId: "brain-settings", pageLabel: "AI 大腦設定" });
    return () => setPageContext(null);
  }, [setPageContext]);

  // ── Tab State ─────────────────────────────────────────────────────────
  type TabId =
    | "config"
    | "alerts"
    | "errors"
    | "proposals"
    | "research"
    | "accuracy"
    | "langsmith";
  // 從 URL 帶入初始 tab：當 brain-pipeline 的 NodeDetailSheet 點擊 Trace 跳轉
  // 過來時，URL 會帶 ?section=brain&brainTab=errors&trace=<id>。AdminPage 已
  // 處理 ?section=brain；這裡接 ?brainTab 與 ?trace。
  const aiBrainSearch = useSearch();
  const VALID_BRAIN_TABS: readonly TabId[] = [
    "config",
    "alerts",
    "errors",
    "proposals",
    "research",
    "accuracy",
    "langsmith",
  ];
  const initialBrainTab = (() => {
    try {
      const params = new URLSearchParams(aiBrainSearch);
      const v = params.get("brainTab");
      return v && (VALID_BRAIN_TABS as readonly string[]).includes(v)
        ? (v as TabId)
        : "config";
    } catch {
      return "config" as TabId;
    }
  })();
  const initialFocusTraceId = (() => {
    try {
      return new URLSearchParams(aiBrainSearch).get("trace");
    } catch {
      return null;
    }
  })();
  const [activeTab, setActiveTab] = useState<TabId>(initialBrainTab);
  const [focusedTraceId, setFocusedTraceId] = useState<string | null>(
    initialFocusTraceId
  );
  // ── Error Diagnosis State ─────────────────────────────────────────────
  const [expandedDiagnosisId, setExpandedDiagnosisId] = useState<string | null>(
    initialFocusTraceId
  );

  // URL 變動時也跟著切（例：在 admin tab 內 NodeDetailSheet 點 Trace）。
  useEffect(() => {
    try {
      const params = new URLSearchParams(aiBrainSearch);
      const tab = params.get("brainTab");
      if (
        tab &&
        (VALID_BRAIN_TABS as readonly string[]).includes(tab) &&
        tab !== activeTab
      ) {
        setActiveTab(tab as TabId);
      }
      const traceId = params.get("trace");
      if (traceId && traceId !== focusedTraceId) {
        setFocusedTraceId(traceId);
        setExpandedDiagnosisId(traceId);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiBrainSearch]);

  // 高亮顯示完成後 6 秒淡出，避免畫面長期殘留橘色 ring。
  useEffect(() => {
    if (!focusedTraceId) return;
    const node = document.getElementById(`error-trace-${focusedTraceId}`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = window.setTimeout(() => setFocusedTraceId(null), 6000);
    return () => window.clearTimeout(timer);
  }, [focusedTraceId, activeTab]);

  // ── PageAgent：光球可切換七大分頁 ───────────────────────────────
  const [, navigateToPath] = useLocation();
  const BRAIN_TAB_OPTIONS = useMemo(
    () => [
      { id: "config", label: "組態" },
      { id: "alerts", label: "警報" },
      { id: "errors", label: "錯誤追蹤" },
      { id: "proposals", label: "優化提案" },
      { id: "research", label: "研究" },
      { id: "accuracy", label: "準確度" },
      { id: "langsmith", label: "LangSmith" },
    ],
    []
  );
  const BRAIN_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/settings", "/langsmith", "/admin", "/my-brain", "/admin/brain-pipeline"]),
    []
  );
  const brainAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換 AI 大腦分頁",
        currentId: activeTab,
        options: BRAIN_TAB_OPTIONS,
        hint: "config | alerts | errors | proposals | research | accuracy | langsmith",
      },
      {
        action: "navigate",
        label: "前往相關頁面",
        options: [
          { id: "/settings", label: "個人設定", meta: { bestFor: "返回設定主頁", tip: "調整其他偏好" } },
          { id: "/my-brain", label: "我的大腦", meta: { bestFor: "查看運作狀態", tip: "即時監控大腦健康" } },
          { id: "/admin/brain-pipeline", label: "推理鏈視覺化", meta: { bestFor: "視覺化推理過程", tip: "需管理員權限" } },
          { id: "/admin", label: "管理後台", meta: { bestFor: "系統管理", tip: "需管理員權限" } },
          { id: "/langsmith", label: "LangSmith", meta: { bestFor: "追蹤推理日誌", tip: "需管理員權限" } },
        ],
        hint: "navigate path='/settings' | '/my-brain' | '/admin/brain-pipeline' | '/admin' | '/langsmith'",
      },
    ],
    [activeTab, BRAIN_TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "brain-settings",
    pageLabel: "AI 大腦設定",
    pagePath: "/settings/ai-brain",
    capabilities: brainAgentCapabilities,
    state: { activeTab, expandedDiagnosisId },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const valid: TabId[] = [
            "config",
            "alerts",
            "errors",
            "proposals",
            "research",
            "accuracy",
            "langsmith",
          ];
          if (!valid.includes(action.tabId as TabId)) {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          setActiveTab(action.tabId as TabId);
          return { ok: true, message: `切到「${action.tabId}」分頁` };
        }
        case "navigate": {
          if (!BRAIN_NAV_ALLOWLIST.has(action.path)) {
            return { ok: false, reason: `navigation blocked: ${action.path}` };
          }
          navigateToPath(action.path);
          return { ok: true, message: `已導航到 ${action.path}` };
        }
        case "reset": {
          setActiveTab("config");
          setExpandedDiagnosisId(null);
          return { ok: true, message: "已回到組態分頁" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on brain-settings: ${action.type}`,
          };
      }
    },
  });

  const brainQuery = trpc.brain.get.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  // Catalog is a static module-load-time payload on the server — never go
  // stale within a session.
  const catalogQuery = trpc.brain.catalog.useQuery(undefined, {
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const healthQuery = trpc.brain.healthStatus.useQuery(undefined, {
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
  // Pricing rarely changes — keep it fresh for 5 minutes between refetches.
  const pricingQuery = trpc.brain.pricingSummary.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  // Real provider ping — refresh every 60 seconds
  const pingQuery = trpc.brain.pingProviders.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const upsertMutation = trpc.brain.upsert.useMutation({
    onSuccess: () => {
      toast.success("大腦組態已儲存");
      brainQuery.refetch();
    },
    onError: err => toast.error("儲存失敗：" + err.message),
  });

  // ── Monitoring summary used for tab-bar badges (the rest of the
  //    per-tab queries / mutations / form state now live inside their
  //    respective tab modules under admin/brain/tabs/) ────────────────────
  const summaryQuery = trpc.brain.monitorSummary.useQuery(undefined, {
    staleTime: 12_000,
    refetchInterval: 15_000,
  });

  // Cross-tab handoff: when the Errors tab fires "search this on the web",
  // we flip activeTab to "research" and seed this query for ResearchTab to
  // consume on its next render.
  const [pendingResearchQuery, setPendingResearchQuery] = useState<
    string | null
  >(null);

  // ── Reasoning Brain State ─────────────────────────────────────────────
  // 預設與 server/middleware/brainContext.ts 的 DEFAULT_REASONING_BRAINS 對齊。
  // 採「混合搭配」策略：
  //   - director / storyteller / technician / curator → Claude Opus 4.7
  //     （原生 function calling、無 web 雜訊、最佳工具使用 + 純創作品質）
  //   - analyst → Perplexity Sonar Reasoning Pro
  //     （原生 web grounding；數據查詢 / 統計 / 新聞摘要場景帶引用來源）
  const [directorModel, setDirectorModel] = useState("anthropic/claude-opus-4.7");
  const [directorTemp, setDirectorTemp] = useState(0.7);
  const [directorTopP, setDirectorTopP] = useState(0.9);
  const [directorEnabled, setDirectorEnabled] = useState(true);
  const [directorSystemPrompt, setDirectorSystemPrompt] = useState("");

  const [analystModel, setAnalystModel] = useState("perplexity/sonar-reasoning-pro");
  const [analystTemp, setAnalystTemp] = useState(0.3);
  const [analystTopP, setAnalystTopP] = useState(0.8);
  const [analystEnabled, setAnalystEnabled] = useState(true);
  const [analystSystemPrompt, setAnalystSystemPrompt] = useState("");

  const [storytellerModel, setStorytellerModel] = useState("anthropic/claude-opus-4.7");
  const [storytellerTemp, setStorytellerTemp] = useState(0.9);
  const [storytellerTopP, setStorytellerTopP] = useState(0.95);
  const [storytellerEnabled, setStorytellerEnabled] = useState(true);
  const [storytellerSystemPrompt, setStorytellerSystemPrompt] = useState("");

  const [technicianModel, setTechnicianModel] = useState("anthropic/claude-opus-4.7");
  const [technicianTemp, setTechnicianTemp] = useState(0.2);
  const [technicianTopP, setTechnicianTopP] = useState(0.7);
  const [technicianEnabled, setTechnicianEnabled] = useState(true);
  const [technicianSystemPrompt, setTechnicianSystemPrompt] = useState("");

  const [curatorModel, setCuratorModel] = useState("anthropic/claude-opus-4.7");
  const [curatorTemp, setCuratorTemp] = useState(0.8);
  const [curatorTopP, setCuratorTopP] = useState(0.9);
  const [curatorEnabled, setCuratorEnabled] = useState(true);
  const [curatorSystemPrompt, setCuratorSystemPrompt] = useState("");

  // ── Generation Engine State ───────────────────────────────────────────
  const [imageEngine, setImageEngine] = useState("fal-ai/flux-pro/v1.1");
  const [imageEnabled, setImageEnabled] = useState(true);
  const [imageEngineParams, setImageEngineParams] = useState("");
  const [videoEngine, setVideoEngine] = useState(
    "fal-ai/kling-video/v2.1/standard/text-to-video"
  );
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [videoEngineParams, setVideoEngineParams] = useState("");
  const [audioEngine, setAudioEngine] = useState("fal-ai/stable-audio");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioEngineParams, setAudioEngineParams] = useState("");
  const [voiceEngine, setVoiceEngine] = useState(
    "fal-ai/elevenlabs/tts/turbo-v2.5"
  );
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceEngineParams, setVoiceEngineParams] = useState("");

  // ── Fal.ai 16 Task Engine State ───────────────────────────────────────
  const [falTaskEngines, setFalTaskEngines] = useState<
    Record<FalTaskKey, string>
  >(() => ({ ...FAL_TASK_DEFAULTS }));

  const setFalTask = useCallback((key: FalTaskKey, value: string) => {
    setFalTaskEngines(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Sync from server ──────────────────────────────────────────────────
  useEffect(() => {
    if (!brainQuery.data) return;
    type ReasoningSlot = { model: string; temperature: number; topP: number; systemPrompt: string | null; enabled: boolean; healthy: boolean };
    type GenerationSlot = { engine: string; params: unknown; enabled: boolean; healthy: boolean };
    const r = brainQuery.data.reasoning as Record<string, ReasoningSlot>;
    const g = brainQuery.data.generation as Record<string, GenerationSlot>;

    if (r.director) {
      setDirectorModel(r.director.model);
      setDirectorTemp(r.director.temperature);
      setDirectorTopP(r.director.topP);
      setDirectorEnabled(r.director.enabled);
      setDirectorSystemPrompt(r.director.systemPrompt || "");
    }
    if (r.analyst) {
      setAnalystModel(r.analyst.model);
      setAnalystTemp(r.analyst.temperature);
      setAnalystTopP(r.analyst.topP);
      setAnalystEnabled(r.analyst.enabled);
      setAnalystSystemPrompt(r.analyst.systemPrompt || "");
    }
    if (r.storyteller) {
      setStorytellerModel(r.storyteller.model);
      setStorytellerTemp(r.storyteller.temperature);
      setStorytellerTopP(r.storyteller.topP);
      setStorytellerEnabled(r.storyteller.enabled);
      setStorytellerSystemPrompt(r.storyteller.systemPrompt || "");
    }
    if (r.technician) {
      setTechnicianModel(r.technician.model);
      setTechnicianTemp(r.technician.temperature);
      setTechnicianTopP(r.technician.topP);
      setTechnicianEnabled(r.technician.enabled);
      setTechnicianSystemPrompt(r.technician.systemPrompt || "");
    }
    if (r.curator) {
      setCuratorModel(r.curator.model);
      setCuratorTemp(r.curator.temperature);
      setCuratorTopP(r.curator.topP);
      setCuratorEnabled(r.curator.enabled);
      setCuratorSystemPrompt(r.curator.systemPrompt || "");
    }
    if (g.imageEngine) {
      setImageEngine(normalizeEngineModelId(g.imageEngine.engine));
      setImageEnabled(g.imageEngine.enabled);
      setImageEngineParams(g.imageEngine.params ? JSON.stringify(g.imageEngine.params, null, 2) : "");
    }
    if (g.videoEngine) {
      setVideoEngine(normalizeEngineModelId(g.videoEngine.engine));
      setVideoEnabled(g.videoEngine.enabled);
      setVideoEngineParams(g.videoEngine.params ? JSON.stringify(g.videoEngine.params, null, 2) : "");
    }
    if (g.audioEngine) {
      setAudioEngine(normalizeEngineModelId(g.audioEngine.engine));
      setAudioEnabled(g.audioEngine.enabled);
      setAudioEngineParams(g.audioEngine.params ? JSON.stringify(g.audioEngine.params, null, 2) : "");
    }
    if (g.voiceEngine) {
      setVoiceEngine(normalizeEngineModelId(g.voiceEngine.engine));
      setVoiceEnabled(g.voiceEngine.enabled);
      setVoiceEngineParams(g.voiceEngine.params ? JSON.stringify(g.voiceEngine.params, null, 2) : "");
    }
    const fal = brainQuery.data.falTasks;
    if (fal) {
      setFalTaskEngines(prev => ({
        ...prev,
        "image-to-3d": normalizeEngineModelId(fal.imageTo3d ?? prev["image-to-3d"]),
        "image-to-image": normalizeEngineModelId(
          fal.imageToImage ?? prev["image-to-image"]
        ),
        "image-to-json": normalizeEngineModelId(
          fal.imageToJson ?? prev["image-to-json"]
        ),
        "image-to-video": normalizeEngineModelId(
          fal.imageToVideo ?? prev["image-to-video"]
        ),
        json: normalizeEngineModelId(fal.json ?? prev.json),
        llm: normalizeEngineModelId(fal.llm ?? prev.llm),
        "text-to-3d": normalizeEngineModelId(fal.textTo3d ?? prev["text-to-3d"]),
        "text-to-audio": normalizeEngineModelId(
          fal.textToAudio ?? prev["text-to-audio"]
        ),
        "text-to-image": normalizeEngineModelId(
          fal.textToImage ?? prev["text-to-image"]
        ),
        "text-to-json": normalizeEngineModelId(
          fal.textToJson ?? prev["text-to-json"]
        ),
        "text-to-speech": normalizeEngineModelId(
          fal.textToSpeech ?? prev["text-to-speech"]
        ),
        "text-to-video": normalizeEngineModelId(
          fal.textToVideo ?? prev["text-to-video"]
        ),
        training: normalizeEngineModelId(fal.training ?? prev.training),
        "video-to-audio": normalizeEngineModelId(
          fal.videoToAudio ?? prev["video-to-audio"]
        ),
        "video-to-text": normalizeEngineModelId(
          fal.videoToText ?? prev["video-to-text"]
        ),
        "video-to-video": normalizeEngineModelId(
          fal.videoToVideo ?? prev["video-to-video"]
        ),
      }));
    }
  }, [brainQuery.data]);

  // ── Save Handler ──────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const falTaskPayload: Record<string, string> = {};
    for (const key of FAL_TASK_KEYS) {
      falTaskPayload[FAL_TASK_UPSERT_KEY[key]] = normalizeEngineModelId(
        falTaskEngines[key]
      );
    }

    // Parse JSON params
    const parseParams = (paramsStr: string) => {
      if (!paramsStr.trim()) return undefined;
      try {
        return JSON.parse(paramsStr);
      } catch (e) {
        toast.error(`參數 JSON 解析失敗: ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
      }
    };

    upsertMutation.mutate({
      directorModel,
      directorTemperature: directorTemp,
      directorTopP,
      directorEnabled,
      directorSystemPrompt: directorSystemPrompt || undefined,
      analystModel,
      analystTemperature: analystTemp,
      analystTopP,
      analystEnabled,
      analystSystemPrompt: analystSystemPrompt || undefined,
      storytellerModel,
      storytellerTemperature: storytellerTemp,
      storytellerTopP,
      storytellerEnabled,
      storytellerSystemPrompt: storytellerSystemPrompt || undefined,
      technicianModel,
      technicianTemperature: technicianTemp,
      technicianTopP,
      technicianEnabled,
      technicianSystemPrompt: technicianSystemPrompt || undefined,
      curatorModel,
      curatorTemperature: curatorTemp,
      curatorTopP,
      curatorEnabled,
      curatorSystemPrompt: curatorSystemPrompt || undefined,
      imageEngine: normalizeEngineModelId(imageEngine),
      imageEngineEnabled: imageEnabled,
      imageEngineParams: parseParams(imageEngineParams),
      videoEngine: normalizeEngineModelId(videoEngine),
      videoEngineEnabled: videoEnabled,
      videoEngineParams: parseParams(videoEngineParams),
      audioEngine: normalizeEngineModelId(audioEngine),
      audioEngineEnabled: audioEnabled,
      audioEngineParams: parseParams(audioEngineParams),
      voiceEngine: normalizeEngineModelId(voiceEngine),
      voiceEngineEnabled: voiceEnabled,
      voiceEngineParams: parseParams(voiceEngineParams),
      ...falTaskPayload,
    } as any);
  }, [
    directorModel,
    directorTemp,
    directorTopP,
    directorEnabled,
    directorSystemPrompt,
    analystModel,
    analystTemp,
    analystTopP,
    analystEnabled,
    analystSystemPrompt,
    storytellerModel,
    storytellerTemp,
    storytellerTopP,
    storytellerEnabled,
    storytellerSystemPrompt,
    technicianModel,
    technicianTemp,
    technicianTopP,
    technicianEnabled,
    technicianSystemPrompt,
    curatorModel,
    curatorTemp,
    curatorTopP,
    curatorEnabled,
    curatorSystemPrompt,
    imageEngine,
    imageEnabled,
    imageEngineParams,
    videoEngine,
    videoEnabled,
    videoEngineParams,
    audioEngine,
    audioEnabled,
    audioEngineParams,
    voiceEngine,
    voiceEnabled,
    voiceEngineParams,
    falTaskEngines,
    upsertMutation,
  ]);

  // ── Health Summary ────────────────────────────────────────────────────
  const healthSummary = useMemo(() => {
    const h = healthQuery.data;
    if (!h) return { online: 0, degraded: 0, offline: 0 };
    let online = 0,
      degraded = 0,
      offline = 0;
    for (const key of Object.keys(h)) {
      const s = h[key];
      if (!s.healthy) offline++;
      else if (s.consecutiveFailures > 0) degraded++;
      else online++;
    }
    return { online, degraded, offline };
  }, [healthQuery.data]);

  const catalog = catalogQuery.data;
  const health = healthQuery.data;

  // ── Loading ───────────────────────────────────────────────────────────
  if (brainQuery.isLoading || catalogQuery.isLoading) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="hs-h1 !mb-0 text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6" />
            AI 大腦組態
          </h1>
        </div>
        <ZenSkeleton lines={8} />
      </div>
    );
  }

  return (
    <div className="page-shell space-y-6">
      <div className="flex items-start justify-between gap-4">
        <header className="page-header !mb-0">
          <p className="page-eyebrow">AI Brain</p>
          <h1 className="page-title flex items-center gap-2 !mb-0">
            <Brain className="w-6 h-6" />
            AI 大腦組態
          </h1>
          <p className="page-subtitle">
            5種推理大腦 · 4種生成引擎 · 16大Fal.ai任務引擎 · Gemini / ElevenLabs
            / Vertex AI 自由切換
          </p>
        </header>

        {/* Health Summary Pills */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {healthSummary.online}
          </div>
          {healthSummary.degraded > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {healthSummary.degraded}
            </div>
          )}
          {healthSummary.offline > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {healthSummary.offline}
            </div>
          )}
        </div>
      </div>

      {/* ── Provider Legend ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          className="text-[9px] bg-violet-500/10 text-violet-600 border-violet-500/20"
        >
          Fal.ai
        </Badge>
        <Badge
          variant="outline"
          className="text-[9px] bg-blue-500/10 text-blue-600 border-blue-500/20"
        >
          Gemini
        </Badge>
        <Badge
          variant="outline"
          className="text-[9px] bg-cyan-500/10 text-cyan-600 border-cyan-500/20"
        >
          Vertex AI
        </Badge>
        <Badge
          variant="outline"
          className="text-[9px] bg-purple-500/10 text-purple-600 border-purple-500/20"
        >
          ElevenLabs
        </Badge>
        <Badge
          variant="outline"
          className="text-[9px] bg-green-500/10 text-green-600 border-green-500/20"
        >
          Suno
        </Badge>
      </div>

      {/* ── Tab Navigation ──────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-white/10 pb-1">
        {[
          { id: "config" as TabId, icon: Brain, label: "組態", badge: null },
          {
            id: "alerts" as TabId,
            icon: AlertTriangle,
            label: "自動修復",
            badge: summaryQuery.data?.activeAlerts,
          },
          {
            id: "errors" as TabId,
            icon: Bug,
            label: "錯誤線索",
            badge: summaryQuery.data?.unresolvedErrors,
          },
          {
            id: "proposals" as TabId,
            icon: Lightbulb,
            label: "自我反省",
            badge: summaryQuery.data?.pendingProposals,
          },
          {
            id: "research" as TabId,
            icon: Globe,
            label: "爬網研究",
            badge: summaryQuery.data?.totalResearch,
          },
          {
            id: "accuracy" as TabId,
            icon: Target,
            label: "精準度測試",
            badge:
              summaryQuery.data?.recentTestScore != null
                ? `${summaryQuery.data.recentTestScore}分`
                : null,
          },
          {
            id: "langsmith" as TabId,
            icon: Activity,
            label: "LangSmith 監控",
            badge: null,
          },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap min-h-[44px] ${
              activeTab === tab.id
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.badge != null &&
              (typeof tab.badge === "string" || Number(tab.badge) > 0) && (
                <Badge
                  variant="secondary"
                  className="text-[9px] px-1.5 py-0 h-4 min-w-[18px]"
                >
                  {tab.badge}
                </Badge>
              )}
          </button>
        ))}
      </div>

      {/* ── Tab: Config (original content) ─────────────────────────────── */}
      {activeTab === "config" && (
        <>
          {/* ── Two-column layout ────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: Brain & Engine Cards (3 cols) */}
            <div className="lg:col-span-3 space-y-6">
              {/* 邏輯推理大腦 Section */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Cpu className="w-4 h-4" />
                  邏輯推理大腦
                  <Badge variant="outline" className="text-[9px] ml-1">
                    5 slots
                  </Badge>
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    Gemini · Vertex AI
                  </span>
                </h2>
                <div className="space-y-3">
                  {catalog && (
                    <>
                      <BrainSlotCard
                        catalog={
                          catalog.reasoning.director as unknown as SlotCatalog
                        }
                        icon={Sparkles}
                        currentModel={directorModel}
                        temperature={directorTemp}
                        topP={directorTopP}
                        enabled={directorEnabled}
                        health={health}
                        systemPrompt={directorSystemPrompt}
                        onModelChange={setDirectorModel}
                        onTemperatureChange={setDirectorTemp}
                        onTopPChange={setDirectorTopP}
                        onEnabledChange={setDirectorEnabled}
                        onSystemPromptChange={setDirectorSystemPrompt}
                        onNavigateTarget={navigateToPath}
                      />
                      <BrainSlotCard
                        catalog={
                          catalog.reasoning.analyst as unknown as SlotCatalog
                        }
                        icon={Activity}
                        currentModel={analystModel}
                        temperature={analystTemp}
                        topP={analystTopP}
                        enabled={analystEnabled}
                        health={health}
                        systemPrompt={analystSystemPrompt}
                        onModelChange={setAnalystModel}
                        onTemperatureChange={setAnalystTemp}
                        onTopPChange={setAnalystTopP}
                        onEnabledChange={setAnalystEnabled}
                        onSystemPromptChange={setAnalystSystemPrompt}
                        onNavigateTarget={navigateToPath}
                      />
                      <BrainSlotCard
                        catalog={
                          catalog.reasoning
                            .storyteller as unknown as SlotCatalog
                        }
                        icon={Zap}
                        currentModel={storytellerModel}
                        temperature={storytellerTemp}
                        topP={storytellerTopP}
                        enabled={storytellerEnabled}
                        health={health}
                        systemPrompt={storytellerSystemPrompt}
                        onModelChange={setStorytellerModel}
                        onTemperatureChange={setStorytellerTemp}
                        onTopPChange={setStorytellerTopP}
                        onEnabledChange={setStorytellerEnabled}
                        onSystemPromptChange={setStorytellerSystemPrompt}
                        onNavigateTarget={navigateToPath}
                      />
                      <BrainSlotCard
                        catalog={
                          catalog.reasoning.technician as unknown as SlotCatalog
                        }
                        icon={Shield}
                        currentModel={technicianModel}
                        temperature={technicianTemp}
                        topP={technicianTopP}
                        enabled={technicianEnabled}
                        health={health}
                        systemPrompt={technicianSystemPrompt}
                        onModelChange={setTechnicianModel}
                        onTemperatureChange={setTechnicianTemp}
                        onTopPChange={setTechnicianTopP}
                        onEnabledChange={setTechnicianEnabled}
                        onSystemPromptChange={setTechnicianSystemPrompt}
                        onNavigateTarget={navigateToPath}
                      />
                      <BrainSlotCard
                        catalog={
                          catalog.reasoning.curator as unknown as SlotCatalog
                        }
                        icon={Brain}
                        currentModel={curatorModel}
                        temperature={curatorTemp}
                        topP={curatorTopP}
                        enabled={curatorEnabled}
                        health={health}
                        systemPrompt={curatorSystemPrompt}
                        onModelChange={setCuratorModel}
                        onTemperatureChange={setCuratorTemp}
                        onTopPChange={setCuratorTopP}
                        onEnabledChange={setCuratorEnabled}
                        onSystemPromptChange={setCuratorSystemPrompt}
                        onNavigateTarget={navigateToPath}
                      />
                    </>
                  )}
                </div>
              </GlassCard>

              {/* 生成引擎 Section */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  生成引擎
                  <Badge variant="outline" className="text-[9px] ml-1">
                    4 slots
                  </Badge>
                  <span className="text-[10px] text-muted-foreground font-normal ml-1">
                    Fal.ai · Gemini · Vertex · ElevenLabs · Suno
                  </span>
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {catalog && (
                    <>
                      <EngineSlotCard
                        catalog={
                          catalog.generation
                            .imageEngine as unknown as SlotCatalog
                        }
                        icon={Image}
                        currentEngine={imageEngine}
                        enabled={imageEnabled}
                        health={health}
                        engineParams={imageEngineParams}
                        onEngineChange={setImageEngine}
                        onEnabledChange={setImageEnabled}
                        onEngineParamsChange={setImageEngineParams}
                        onNavigateTarget={navigateToPath}
                      />
                      <EngineSlotCard
                        catalog={
                          catalog.generation
                            .videoEngine as unknown as SlotCatalog
                        }
                        icon={Video}
                        currentEngine={videoEngine}
                        enabled={videoEnabled}
                        health={health}
                        engineParams={videoEngineParams}
                        onEngineChange={setVideoEngine}
                        onEnabledChange={setVideoEnabled}
                        onEngineParamsChange={setVideoEngineParams}
                        onNavigateTarget={navigateToPath}
                      />
                      <EngineSlotCard
                        catalog={
                          catalog.generation
                            .audioEngine as unknown as SlotCatalog
                        }
                        icon={Music}
                        currentEngine={audioEngine}
                        enabled={audioEnabled}
                        health={health}
                        engineParams={audioEngineParams}
                        onEngineChange={setAudioEngine}
                        onEnabledChange={setAudioEnabled}
                        onEngineParamsChange={setAudioEngineParams}
                        onNavigateTarget={navigateToPath}
                      />
                      <EngineSlotCard
                        catalog={
                          catalog.generation
                            .voiceEngine as unknown as SlotCatalog
                        }
                        icon={Mic}
                        currentEngine={voiceEngine}
                        enabled={voiceEnabled}
                        health={health}
                        engineParams={voiceEngineParams}
                        onEngineChange={setVoiceEngine}
                        onEnabledChange={setVoiceEnabled}
                        onEngineParamsChange={setVoiceEngineParams}
                        onNavigateTarget={navigateToPath}
                      />
                    </>
                  )}
                </div>
              </GlassCard>

              {/* Fal.ai 16大類任務引擎 Section */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  Fal.ai 任務引擎
                  <Badge
                    variant="outline"
                    className="text-[9px] ml-1 bg-violet-500/10 text-violet-600 border-violet-500/20"
                  >
                    16 categories
                  </Badge>
                </h2>
                <p className="hs-small !mb-0 text-muted-foreground mb-4">
                  為每種 AI 任務類型選擇最佳 Fal.ai
                  模型。點擊展開可查看所有可用模型。
                </p>

                {/* 4列 Grid，2行 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catalog &&
                    FAL_TASK_KEYS.map(key => {
                      const taskCatalog = (catalog as any).falTasks?.[key];
                      if (!taskCatalog) return null;
                      return (
                        <FalTaskCard
                          key={key}
                          taskKey={key}
                          icon={FAL_TASK_ICONS[key]}
                          catalog={taskCatalog as SlotCatalog}
                          currentModel={falTaskEngines[key]}
                          health={health}
                          onModelChange={v => setFalTask(key, v)}
                        />
                      );
                    })}
                </div>
              </GlassCard>
            </div>

            {/* Right: Live Preview + Actions (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Live Preview */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  光球語調預覽
                </h2>
                <p className="hs-small !mb-0 text-muted-foreground mb-3">
                  切換「光球語調」大腦模型，即時預覽光球對話風格
                </p>
                <LivePreview model={technicianModel} />
              </GlassCard>

              {/* Providers Status — real ping latency */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  整合服務
                  {pingQuery.isFetching && (
                    <span className="text-[9px] text-muted-foreground animate-pulse ml-1">
                      偵測中...
                    </span>
                  )}
                  {!pingQuery.isFetching && (
                    <button
                      onClick={() => pingQuery.refetch()}
                      className="ml-auto text-[9px] text-primary/60 hover:text-primary transition-colors flex items-center gap-0.5"
                    >
                      <RotateCcw className="w-3 h-3" />
                      重新偵測
                    </button>
                  )}
                </h2>
                <div className="space-y-2 text-xs">
                  {[
                    {
                      key: "gemini",
                      provider: "Gemini API",
                      desc: "LLM/生圖/語音",
                      badge: "bg-blue-500/10 text-blue-600",
                      dotOk: "bg-emerald-400",
                      dotFail: "bg-red-400",
                    },
                    {
                      key: "vertex",
                      provider: "Vertex AI",
                      desc: "企業級 Gemini + Imagen",
                      badge: "bg-cyan-500/10 text-cyan-600",
                      dotOk: "bg-emerald-400",
                      dotFail: "bg-amber-400",
                    },
                    {
                      key: "elevenlabs",
                      provider: "ElevenLabs",
                      desc: "TTS V3 · 音效 · 聲音克隆",
                      badge: "bg-purple-500/10 text-purple-600",
                      dotOk: "bg-emerald-400",
                      dotFail: "bg-red-400",
                    },
                    {
                      key: "fal",
                      provider: "Fal.ai",
                      desc: "16大類 80+ AI 模型",
                      badge: "bg-violet-500/10 text-violet-600",
                      dotOk: "bg-emerald-400",
                      dotFail: "bg-red-400",
                    },
                  ].map(s => {
                    const pingData = pingQuery.data as
                      | Record<
                          string,
                          {
                            latencyMs: number | null;
                            ok: boolean;
                            error?: string;
                          }
                        >
                      | undefined;
                    const pingResult = pingData?.[s.key];
                    const isLoading = pingQuery.isLoading;
                    return (
                      <div
                        key={s.provider}
                        className="flex items-center justify-between py-0.5"
                      >
                        <div className="flex items-center gap-2">
                          {/* Latency dot */}
                          <span
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isLoading
                                ? "bg-muted animate-pulse"
                                : pingResult === undefined
                                  ? "bg-muted"
                                  : pingResult.ok
                                    ? s.dotOk
                                    : s.dotFail
                            }`}
                            title={
                              pingResult?.error ??
                              (pingResult?.ok ? "在線" : "離線")
                            }
                          />
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${s.badge}`}
                          >
                            {s.provider}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {s.desc}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                          {isLoading
                            ? "…"
                            : pingResult?.latencyMs != null
                              ? `${pingResult.latencyMs}ms`
                              : pingResult?.ok
                                ? "✓"
                                : pingResult?.error
                                  ? "✕"
                                  : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>

              {/* Health Overview — combined from model health + provider ping */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  系統健康
                </h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">模型在線</span>
                    <span className="font-medium text-emerald-600">
                      {healthSummary.online}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">模型降級中</span>
                    <span className="font-medium text-amber-600">
                      {healthSummary.degraded}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">模型離線</span>
                    <span className="font-medium text-red-600">
                      {healthSummary.offline}
                    </span>
                  </div>
                  {/* Real provider ping summary */}
                  {pingQuery.data && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-white/20">
                      <span className="text-muted-foreground">服務在線</span>
                      <span className="font-medium text-emerald-600">
                        {
                          Object.values(
                            pingQuery.data as Record<string, { ok: boolean }>
                          ).filter(v => v.ok).length
                        }
                        /{Object.keys(pingQuery.data).length}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-white/20">
                    <p className="hs-small !mb-0 text-muted-foreground/60">
                      模型健康每 30 秒更新，服務 ping 每 60
                      秒更新。離線引擎自動降級至備援。
                    </p>
                  </div>
                </div>
              </GlassCard>

              {/* Points Cost Summary */}
              <GlassCard>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  積分費率
                  <Badge
                    variant="outline"
                    className="text-[9px] ml-1 bg-amber-500/10 text-amber-600 border-amber-500/20"
                  >
                    1 USD ≈ 100 pts
                  </Badge>
                </h2>
                {pricingQuery.data ? (
                  <div className="space-y-2">
                    {(["image", "video", "audio", "voice"] as const).map(
                      modality => {
                        const entry = pricingQuery.data[modality];
                        if (!entry) return null;
                        const modalityLabel = {
                          image: "圖片",
                          video: "影片",
                          audio: "音樂",
                          voice: "語音",
                        }[modality];
                        const tierColor =
                          entry.tier === "ultra" || entry.tier === "premium"
                            ? "text-amber-600"
                            : entry.tier === "standard"
                              ? "text-blue-600"
                              : "text-green-600";
                        return (
                          <div
                            key={modality}
                            className="flex items-start justify-between gap-2 py-1.5 border-b border-white/10 last:border-0"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-muted-foreground">
                                  {modalityLabel}
                                </span>
                                <span className="text-[10px] font-medium text-foreground truncate">
                                  {entry.label}
                                </span>
                              </div>
                              <div className="text-[9px] text-muted-foreground/60 mt-0.5">
                                {entry.breakdown}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className={`text-xs font-semibold ${tierColor}`}
                              >
                                {entry.estimatedPoints} pts
                              </div>
                              <div className="text-[9px] text-muted-foreground/60">
                                {entry.estimatedUsd}
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                    <p className="hs-small !mb-0 text-muted-foreground/50 pt-1">
                      {pricingQuery.data.rateNote}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        className="h-8 rounded bg-muted/20 animate-pulse"
                      />
                    ))}
                  </div>
                )}
              </GlassCard>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleSave}
                  disabled={upsertMutation.isPending}
                  className="w-full rounded-xl"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {upsertMutation.isPending ? "儲存中..." : "儲存全部組態"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => brainQuery.refetch()}
                  className="w-full rounded-xl"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  重新載入
                </Button>
              </div>

              {/* Info */}
              <div className="rounded-xl bg-primary/5 border border-primary/10 p-3">
                <p className="hs-small !mb-0 text-muted-foreground">
                  <strong className="text-foreground">安全提示：</strong>
                  此頁面不會顯示或暴露任何 API
                  Key。所有模型呼叫均透過伺服器端安全代理執行。
                  切換模型時，系統會自動記錄切換日誌以供審計。
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Alerts (自動修復監控) ──────────────────────────────────── */}
      {activeTab === "alerts" && <AlertsTab active={activeTab === "alerts"} />}

      {/* ── Tab: Errors (錯誤線索) ─────────────────────────────────────── */}
      {activeTab === "errors" && (
        <ErrorsTab
          active={activeTab === "errors"}
          focusedTraceId={focusedTraceId}
          onJumpToResearch={query => {
            setPendingResearchQuery(query);
            setActiveTab("research");
          }}
        />
      )}

      {/* ── Tab: Proposals (自我反省) ──────────────────────────────────── */}
      {activeTab === "proposals" && (
        <ProposalsTab active={activeTab === "proposals"} />
      )}

      {/* ── Tab: Research (爬網研究) ───────────────────────────────────── */}
      {activeTab === "research" && (
        <ResearchTab
          active={activeTab === "research"}
          pendingQuery={pendingResearchQuery}
          onPendingQueryConsumed={() => setPendingResearchQuery(null)}
        />
      )}

      {/* ── Tab: Accuracy (精準度測試) ─────────────────────────────────── */}
      {activeTab === "accuracy" && (
        <AccuracyTab active={activeTab === "accuracy"} />
      )}

      {/* ── Tab: LangSmith 監控 ─────────────────────────────────────────── */}
      {activeTab === "langsmith" && (
        <LangsmithTab active={activeTab === "langsmith"} />
      )}
    </div>
  );
}
