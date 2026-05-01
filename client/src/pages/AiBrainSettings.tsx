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

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** 錯誤分類中文標籤（集中定義，避免重複） */
const ERROR_CATEGORY_LABEL_MAP: Record<string, string> = {
  rate_limit: "速率限制",
  auth_failure: "認證失敗",
  connection: "連線問題",
  timeout: "請求逾時",
  missing_api: "缺失 API",
  broken_link: "連結中斷",
  validation: "參數錯誤",
  server_error: "伺服器錯誤",
  quota_exceeded: "配額用盡",
  model_unavailable: "模型不可用",
  unknown: "未知",
};

/** 錯誤分類的顏色樣式 */
const ERROR_CATEGORY_COLOR_MAP: Record<string, string> = {
  rate_limit: "text-orange-600 bg-orange-500/10",
  auth_failure: "text-red-600 bg-red-500/10",
  connection: "text-yellow-600 bg-yellow-500/10",
  timeout: "text-amber-600 bg-amber-500/10",
  missing_api: "text-purple-600 bg-purple-500/10",
  broken_link: "text-pink-600 bg-pink-500/10",
  validation: "text-blue-600 bg-blue-500/10",
  server_error: "text-red-700 bg-red-600/10",
  quota_exceeded: "text-orange-700 bg-orange-600/10",
  model_unavailable: "text-slate-600 bg-slate-500/10",
  unknown: "text-muted-foreground bg-muted",
};

/** 錯誤分類帶 emoji 標籤（爬網研究頁用） */
const ERROR_CATEGORY_EMOJI_LABELS: Record<string, string> = {
  rate_limit: "🚦 速率限制",
  auth_failure: "🔑 認證失敗",
  connection: "🔌 連線問題",
  timeout: "⏱️ 請求逾時",
  missing_api: "❓ 缺失 API",
  broken_link: "🔗 連結中斷",
  validation: "📋 參數錯誤",
  server_error: "💥 伺服器錯誤",
  quota_exceeded: "📊 配額用盡",
  model_unavailable: "🚫 模型不可用",
  unknown: "❔ 未分類",
};

interface ModelOption {
  value: string;
  label: string;
  tier: string;
  description?: string;
}

interface SlotCatalog {
  label: string;
  description: string;
  options: readonly ModelOption[];
  targetPath?: string;
}

type TextareaChangeEvent = React.ChangeEvent<HTMLTextAreaElement>;

function withTextareaValue(handler?: (value: string) => void) {
  return (e: TextareaChangeEvent) => {
    handler?.(e.target.value);
  };
}

type HealthState = "healthy" | "unhealthy" | "unverified";

type HealthStatus = Record<
  string,
  {
    healthy: boolean;
    state?: HealthState;
    consecutiveFailures: number;
    lastError?: string;
  }
>;

// Fal.ai 16大類任務引擎鍵名
type FalTaskKey =
  | "image-to-3d"
  | "image-to-image"
  | "image-to-json"
  | "image-to-video"
  | "json"
  | "llm"
  | "text-to-3d"
  | "text-to-audio"
  | "text-to-image"
  | "text-to-json"
  | "text-to-speech"
  | "text-to-video"
  | "training"
  | "video-to-audio"
  | "video-to-text"
  | "video-to-video";

// Maps FalTaskKey → state field name in upsert
const FAL_TASK_UPSERT_KEY: Record<FalTaskKey, string> = {
  "image-to-3d": "falImageTo3dEngine",
  "image-to-image": "falImageToImageEngine",
  "image-to-json": "falImageToJsonEngine",
  "image-to-video": "falImageToVideoEngine",
  json: "falJsonEngine",
  llm: "falLlmEngine",
  "text-to-3d": "falTextTo3dEngine",
  "text-to-audio": "falTextToAudioEngine",
  "text-to-image": "falTextToImageEngine",
  "text-to-json": "falTextToJsonEngine",
  "text-to-speech": "falTextToSpeechEngine",
  "text-to-video": "falTextToVideoEngine",
  training: "falTrainingEngine",
  "video-to-audio": "falVideoToAudioEngine",
  "video-to-text": "falVideoToTextEngine",
  "video-to-video": "falVideoToVideoEngine",
};

// Default models per task category (first premium model in catalog)
const FAL_TASK_DEFAULTS: Record<FalTaskKey, string> = {
  "image-to-3d": "fal-ai/trellis-2",
  "image-to-image": "fal-ai/flux/dev/image-to-image",
  "image-to-json": "fal-ai/any-llm",
  "image-to-video": "fal-ai/kling-video/v2.1/pro/image-to-video",
  json: "fal-ai/any-llm",
  llm: "fal-ai/any-llm",
  "text-to-3d": "fal-ai/hyper3d/rodin",
  "text-to-audio": "fal-ai/stable-audio",
  "text-to-image": "fal-ai/flux-pro/v1.1",
  "text-to-json": "fal-ai/any-llm",
  "text-to-speech": "fal-ai/elevenlabs/tts/turbo-v2.5",
  "text-to-video": "fal-ai/kling-video/v2.1/pro/text-to-video",
  training: "fal-ai/flux-lora-fast-training",
  "video-to-audio": "fal-ai/mmaudio-v2/video-to-audio",
  "video-to-text": "fal-ai/nemotron/asr/stream",
  "video-to-video": "fal-ai/kling-video/v2.1/standard/video-to-video",
};

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
// Health Indicator Component
// ═══════════════════════════════════════════════════════════════════════════

function HealthDot({
  model,
  health,
}: {
  model: string;
  health: HealthStatus | undefined;
}) {
  const status = health?.[model];
  const state: HealthState = status?.state ?? (status ? "healthy" : "unverified");
  const failures = status?.consecutiveFailures ?? 0;

  let color: string;
  let label: string;
  let pulseClass: string;

  if (state === "unhealthy") {
    color = "bg-red-500";
    label = "Offline";
    pulseClass = "";
  } else if (state === "unverified") {
    color = "bg-slate-400";
    label = "未驗證";
    pulseClass = "animate-pulse";
  } else if (failures > 0) {
    color = "bg-amber-500";
    label = "Degraded";
    pulseClass = "animate-pulse";
  } else {
    color = "bg-emerald-500";
    label = "已驗證";
    pulseClass = "";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex items-center">
          <span className={`w-2.5 h-2.5 rounded-full ${color} ${pulseClass}`} />
          {state === "healthy" && failures === 0 && (
            <span
              className={`absolute w-2.5 h-2.5 rounded-full ${color} animate-ping opacity-40`}
            />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">{label}</p>
        {status?.lastError && (
          <p className="text-muted-foreground mt-0.5 max-w-48 truncate">
            {status.lastError}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tier Badge
// ═══════════════════════════════════════════════════════════════════════════

function TierBadge({ tier }: { tier: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    premium: {
      className: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      label: "Premium",
    },
    standard: {
      className: "bg-blue-500/10 text-blue-600 border-blue-500/20",
      label: "Standard",
    },
    fast: {
      className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      label: "Fast",
    },
  };
  const v = variants[tier] ?? variants.standard;
  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1.5 py-0 ${v.className}`}
    >
      {v.label}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider Badge
// ═══════════════════════════════════════════════════════════════════════════

function ProviderBadge({ value }: { value: string }) {
  let provider = "";
  let className = "";
  if (value.startsWith("fal-ai/") || value.startsWith("fal/")) {
    provider = "Fal.ai";
    className = "bg-violet-500/10 text-violet-600 border-violet-500/20";
  } else if (
    value.startsWith("gemini/") ||
    value.startsWith("imagen") ||
    value.startsWith("veo") ||
    value.startsWith("lyria") ||
    value.startsWith("gemini-")
  ) {
    provider = "Gemini";
    className = "bg-blue-500/10 text-blue-600 border-blue-500/20";
  } else if (value.startsWith("vertex/")) {
    provider = "Vertex";
    className = "bg-cyan-500/10 text-cyan-600 border-cyan-500/20";
  } else if (value.startsWith("elevenlabs/") || value.startsWith("eleven_")) {
    provider = "ElevenLabs";
    className = "bg-purple-500/10 text-purple-600 border-purple-500/20";
  } else if (value.startsWith("suno")) {
    provider = "Suno";
    className = "bg-green-500/10 text-green-600 border-green-500/20";
  }
  if (!provider) return null;
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${className}`}>
      {provider}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Live Preview — 光球對話範例
// ═══════════════════════════════════════════════════════════════════════════

// ── Static preview sentences for orb voice (used before API call) ─────────
const SOUL_PREVIEW_TEXT =
  "你好，我是光球。我已準備好協助你開始今天的創作旅程。";

// ── Real Orb Voice Preview (ElevenLabs TTS via backend) ──────────────────
function LivePreview({ model, voiceId }: { model: string; voiceId?: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const orbVoicePreview = trpc.brain.orbVoicePreview.useMutation({
    onSuccess: data => {
      setIsLoading(false);
      setErrorMsg(null);
      // Play the base64 audio
      const audio = new Audio(data.audioBase64);
      audioRef.current = audio;
      audio.onended = () => setIsPlaying(false);
      audio.onerror = () => {
        setIsPlaying(false);
        setErrorMsg("音頻播放失敗");
      };
      audio.play().catch(e => {
        setIsPlaying(false);
        setErrorMsg("無法播放：" + String(e));
      });
      setIsPlaying(true);
    },
    onError: err => {
      setIsLoading(false);
      setIsPlaying(false);
      setErrorMsg(err.message);
    },
  });

  const handlePlay = () => {
    if (isLoading || isPlaying) {
      // Stop playback
      audioRef.current?.pause();
      audioRef.current = null;
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    orbVoicePreview.mutate({
      text: SOUL_PREVIEW_TEXT,
      voiceId: voiceId ?? "Rachel",
      modelId: "eleven_turbo_v2",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
    });
  };

  return (
    <div className="space-y-3">
      {/* Orb animation */}
      <div className="flex items-start gap-3">
        <motion.div
          className="relative flex-shrink-0 cursor-pointer"
          animate={
            isPlaying
              ? { scale: [1, 1.15, 1, 1.1, 1], opacity: [1, 0.9, 1, 0.85, 1] }
              : { scale: [1, 1.04, 1] }
          }
          transition={
            isPlaying
              ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
              : { duration: 3, repeat: Infinity, ease: "easeInOut" }
          }
          onClick={handlePlay}
          title="點擊播放光球語音預覽"
        >
          <div
            className={`w-10 h-10 rounded-full shadow-lg transition-all duration-500 ${
              isPlaying
                ? "bg-gradient-to-br from-amber-300 via-orange-500 to-rose-500 shadow-orange-400/50"
                : "bg-gradient-to-br from-amber-300 via-orange-400 to-rose-400 shadow-amber-300/30"
            }`}
          />
          <div className="absolute inset-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-300/40 via-orange-400/30 to-rose-400/20 blur-md" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white/60 border-t-white rounded-full animate-spin" />
            </div>
          )}
        </motion.div>

        <div className="flex-1 bg-white/60 dark:bg-white/10 backdrop-blur-sm rounded-2xl rounded-tl-sm p-3.5 border border-white/40 shadow-sm">
          <p className="text-sm text-foreground/90 leading-relaxed italic">
            「{SOUL_PREVIEW_TEXT}」
          </p>
          <div className="flex items-center justify-between mt-2.5">
            <span className="hs-small !mb-0 text-muted-foreground/60">
              {model} · ElevenLabs TTS
            </span>
            <button
              onClick={handlePlay}
              disabled={false}
              className={`text-[10px] flex items-center gap-1 transition-colors ${
                isLoading
                  ? "text-amber-500 cursor-wait"
                  : isPlaying
                    ? "text-red-400 hover:text-red-500"
                    : "text-primary/70 hover:text-primary"
              }`}
            >
              {isLoading ? "載入中..." : isPlaying ? "停止 ■" : "▶ 播放預覽"}
            </button>
          </div>
          {errorMsg && (
            <p className="hs-small !mb-0 text-red-400 mt-1">{errorMsg}</p>
          )}
        </div>
      </div>
      <p className="hs-small !mb-0 text-muted-foreground/60 text-center">
        點擊光球或「播放預覽」聆聽真實 TTS 語音
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Brain Slot Card
// ═══════════════════════════════════════════════════════════════════════════

function BrainSlotCard({
  catalog,
  icon: Icon,
  currentModel,
  temperature,
  topP,
  enabled,
  health,
  systemPrompt,
  onModelChange,
  onTemperatureChange,
  onTopPChange,
  onEnabledChange,
  onSystemPromptChange,
  onNavigateTarget,
}: {
  catalog: SlotCatalog;
  icon: React.ComponentType<{ className?: string }>;
  currentModel: string;
  temperature: number;
  topP: number;
  enabled: boolean;
  health: HealthStatus | undefined;
  systemPrompt?: string;
  onModelChange: (model: string) => void;
  onTemperatureChange: (temp: number) => void;
  onTopPChange: (topP: number) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSystemPromptChange?: (prompt: string) => void;
  onNavigateTarget?: (path: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 transition-all ${
        enabled
          ? "bg-white/50 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm"
          : "bg-muted/30 border-muted/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {catalog.label}
              </h3>
              <HealthDot model={currentModel} health={health} />
            </div>
            <p className="hs-small !mb-0 text-muted-foreground">
              {catalog.description}
            </p>
            {catalog.targetPath && onNavigateTarget && (
              <button
                type="button"
                onClick={() => onNavigateTarget(catalog.targetPath!)}
                className="mt-1 text-[10px] text-primary/80 hover:text-primary inline-flex items-center gap-1"
              >
                前往頁面
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              模型選擇
            </Label>
            <Select value={currentModel} onValueChange={onModelChange}>
              <SelectTrigger className="h-9 text-xs bg-white/40 dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <HealthDot model={opt.value} health={health} />
                      <span>{opt.label}</span>
                      <ProviderBadge value={opt.value} />
                      <TierBadge tier={opt.tier} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">
                溫度 (Temperature)
              </Label>
              <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
                {temperature.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[temperature]}
              onValueChange={(vals: number[]) => onTemperatureChange(vals[0])}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">精確</span>
              <span className="text-[9px] text-muted-foreground/50">創意</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">Top P</Label>
              <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
                {topP.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[topP]}
              onValueChange={(vals: number[]) => onTopPChange(vals[0])}
              min={0}
              max={1}
              step={0.05}
              className="w-full"
            />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">集中</span>
              <span className="text-[9px] text-muted-foreground/50">多樣</span>
            </div>
          </div>

          {onSystemPromptChange && (
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                系統提示詞（選填）
              </Label>
              <Textarea
                value={systemPrompt || ""}
                onChange={withTextareaValue(onSystemPromptChange)}
                placeholder="為此推理大腦設定自訂的系統提示詞，留空則使用預設值"
                className="min-h-[80px] text-xs bg-white/40 dark:bg-white/5 resize-none"
              />
              <p className="text-[9px] text-muted-foreground/70 mt-1">
                自訂系統提示詞可影響大腦的行為風格與輸出品質
              </p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Engine Slot Card (Generation Engines)
// ═══════════════════════════════════════════════════════════════════════════

function EngineSlotCard({
  catalog,
  icon: Icon,
  currentEngine,
  enabled,
  health,
  engineParams,
  onEngineChange,
  onEnabledChange,
  onEngineParamsChange,
  onNavigateTarget,
}: {
  catalog: SlotCatalog;
  icon: React.ComponentType<{ className?: string }>;
  currentEngine: string;
  enabled: boolean;
  health: HealthStatus | undefined;
  engineParams?: string;
  onEngineChange: (engine: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onEngineParamsChange?: (params: string) => void;
  onNavigateTarget?: (path: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 transition-all ${
        enabled
          ? "bg-white/50 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm"
          : "bg-muted/30 border-muted/40 opacity-60"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {catalog.label}
              </h3>
              <HealthDot model={currentEngine} health={health} />
            </div>
            <p className="hs-small !mb-0 text-muted-foreground">
              {catalog.description}
            </p>
            {catalog.targetPath && onNavigateTarget && (
              <button
                type="button"
                onClick={() => onNavigateTarget(catalog.targetPath!)}
                className="mt-1 text-[10px] text-primary/80 hover:text-primary inline-flex items-center gap-1"
              >
                前往頁面
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-3"
        >
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">
              引擎選擇
            </Label>
            <Select value={currentEngine} onValueChange={onEngineChange}>
              <SelectTrigger className="h-9 text-xs bg-white/40 dark:bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalog.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <HealthDot model={opt.value} health={health} />
                      <span>{opt.label}</span>
                      <ProviderBadge value={opt.value} />
                      <TierBadge tier={opt.tier} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {onEngineParamsChange && (
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                引擎參數（JSON，選填）
              </Label>
              <Textarea
                value={engineParams || ""}
                onChange={withTextareaValue(onEngineParamsChange)}
                placeholder={'例如：{"num_images": 4, "guidance_scale": 7.5}'}
                className="min-h-[80px] text-xs bg-white/40 dark:bg-white/5 resize-none font-mono"
              />
              <p className="text-[9px] text-muted-foreground/70 mt-1">
                以 JSON 格式設定引擎專屬參數，留空則使用預設值
              </p>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Fal Task Engine Card — compact card for one of the 16 task categories
// ═══════════════════════════════════════════════════════════════════════════

function FalTaskCard({
  taskKey,
  catalog,
  currentModel,
  health,
  onModelChange,
}: {
  taskKey: FalTaskKey;
  catalog: SlotCatalog;
  currentModel: string;
  health: HealthStatus | undefined;
  onModelChange: (model: string) => void;
}) {
  const Icon = FAL_TASK_ICONS[taskKey];
  const [open, setOpen] = useState(false);

  // Get selected option label
  const selectedOpt = catalog.options.find(o => o.value === currentModel);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-white/40 dark:bg-white/5 border-white/60 dark:border-white/10 shadow-sm overflow-hidden"
    >
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/20 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-violet-500/10 text-violet-600">
            <Icon className="w-3.5 h-3.5" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                {catalog.label}
              </span>
              <HealthDot model={currentModel} health={health} />
            </div>
            <span className="text-[10px] text-muted-foreground truncate max-w-32 block">
              {selectedOpt?.label ?? currentModel.split("/").pop()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedOpt && <TierBadge tier={selectedOpt.tier} />}
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-white/20 dark:border-white/10"
          >
            <div className="p-3 space-y-2">
              <p className="hs-small !mb-0 text-muted-foreground">
                {catalog.description}
              </p>
              <Select value={currentModel} onValueChange={onModelChange}>
                <SelectTrigger className="h-8 text-xs bg-white/40 dark:bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catalog.options.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        <HealthDot model={opt.value} health={health} />
                        <span className="flex-1">{opt.label}</span>
                        <TierBadge tier={opt.tier} />
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedOpt?.description && (
                <p className="hs-small !mb-0 text-muted-foreground/70">
                  {selectedOpt.description}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

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
    () => new Set(["/settings", "/langsmith", "/admin"]),
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
        hint: "/settings、/langsmith、/admin",
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

  const brainQuery = trpc.brain.get.useQuery(undefined, { retry: false });
  const catalogQuery = trpc.brain.catalog.useQuery(undefined, {
    staleTime: 60_000,
  });
  const healthQuery = trpc.brain.healthStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const pricingQuery = trpc.brain.pricingSummary.useQuery(undefined, {
    staleTime: 60_000,
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

  // ── Monitoring Queries (only fetch when active) ───────────────────────
  const summaryQuery = trpc.brain.monitorSummary.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const autoRepairConfigQuery = trpc.brain.autoRepairConfig.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
    }
  );
  const alertsQuery = trpc.brain.alerts.useQuery(undefined, {
    enabled: activeTab === "alerts",
    refetchInterval: 10_000,
  });
  const errorsQuery = trpc.brain.errorTraces.useQuery(undefined, {
    enabled: activeTab === "errors" || activeTab === "research",
    refetchInterval: 15_000,
  });
  const diagnosisQuery = trpc.brain.diagnoseError.useQuery(
    { traceId: expandedDiagnosisId ?? "" },
    { enabled: !!expandedDiagnosisId && activeTab === "errors" }
  );
  const proposalsQuery = trpc.brain.proposals.useQuery(undefined, {
    enabled: activeTab === "proposals",
    refetchInterval: 15_000,
  });
  const researchQuery = trpc.brain.researchResults.useQuery(undefined, {
    enabled: activeTab === "research",
  });
  const testsQuery = trpc.brain.accuracyTests.useQuery(undefined, {
    enabled: activeTab === "accuracy",
    refetchInterval: 15_000,
  });

  // ── Monitoring Mutations ──────────────────────────────────────────────
  const toggleAutoRepairMut = trpc.brain.toggleAutoRepair.useMutation({
    onSuccess: r => {
      toast.success(r.enabled ? "自動除錯已啟用 ✅" : "自動除錯已停用 🔴");
      autoRepairConfigQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const setMonitorIntervalMut = trpc.brain.setMonitorInterval.useMutation({
    onSuccess: r => {
      toast.success(`巡檢間隔已更新為 ${r.intervalMinutes} 分鐘`);
      autoRepairConfigQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const dismissAlertMut = trpc.brain.dismissAlert.useMutation({
    onSuccess: () => {
      toast.success("警報已關閉");
      alertsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const resolveErrorMut = trpc.brain.resolveError.useMutation({
    onSuccess: () => {
      toast.success("已標記解決");
      errorsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const approveProposalMut = trpc.brain.approveProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已批准");
      proposalsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const rejectProposalMut = trpc.brain.rejectProposal.useMutation({
    onSuccess: () => {
      toast.success("提案已拒絕");
      proposalsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const webSearchMut = trpc.brain.webSearch.useMutation({
    onSuccess: data => {
      toast.success(`找到 ${data.length} 筆結果`);
      researchQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const addToLearnHubMut = trpc.brain.addResearchToLearnHub.useMutation({
    onSuccess: () => {
      toast.success("已加入學習文件庫");
      researchQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const runTestMut = trpc.brain.runAccuracyTest.useMutation({
    onSuccess: t => {
      toast.success(`測試完成：${t.score}/100`);
      testsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const runAllTestsMut = trpc.brain.runAllAccuracyTests.useMutation({
    onSuccess: tests => {
      const avg =
        tests.length > 0
          ? Math.round(tests.reduce((s, t) => s + t.score, 0) / tests.length)
          : 0;
      toast.success(`全部測試完成，平均分數 ${avg}/100`);
      testsQuery.refetch();
      summaryQuery.refetch();
    },
    onError: e => toast.error(e.message),
  });

  // ── Web Search State ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  // ── LangSmith State ───────────────────────────────────────────────────
  interface LangSmithRun {
    id: string;
    name: string;
    status: string;
    latency: number | null;
    totalTokens: number;
    error: string | null;
    startTime: string;
  }
  interface LangSmithStats {
    runs: LangSmithRun[];
    summary: {
      totalRuns: number;
      errorCount: number;
      errorRate: number;
      avgLatency: number;
      totalTokens: number;
    };
  }
  const [langsmithStats, setLangsmithStats] = useState<LangSmithStats | null>(
    null
  );
  const [langsmithLoading, setLangsmithLoading] = useState(false);
  const [langsmithError, setLangsmithError] = useState<string | null>(null);

  const fetchLangsmithStats = useCallback(async () => {
    setLangsmithLoading(true);
    setLangsmithError(null);
    try {
      const res = await fetch("/api/langsmith/stats");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLangsmithError(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
        setLangsmithStats(null);
      } else {
        const data = (await res.json()) as LangSmithStats;
        setLangsmithStats(data);
      }
    } catch (e) {
      setLangsmithError(e instanceof Error ? e.message : String(e));
    } finally {
      setLangsmithLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "langsmith") return;
    fetchLangsmithStats();
    const timer = setInterval(fetchLangsmithStats, 30_000);
    return () => clearInterval(timer);
  }, [activeTab, fetchLangsmithStats]);

  // ── Accuracy Test State ───────────────────────────────────────────────
  const [testEngine, setTestEngine] = useState("gemini-2.5-flash");
  const [testType, setTestType] = useState<
    "response_quality" | "latency" | "consistency" | "error_rate"
  >("response_quality");
  const [testPrompt, setTestPrompt] = useState("");
  const [testExpected, setTestExpected] = useState("");

  // ── Reasoning Brain State ─────────────────────────────────────────────
  const [directorModel, setDirectorModel] = useState("gemini-2.5-pro");
  const [directorTemp, setDirectorTemp] = useState(0.7);
  const [directorTopP, setDirectorTopP] = useState(0.9);
  const [directorEnabled, setDirectorEnabled] = useState(true);
  const [directorSystemPrompt, setDirectorSystemPrompt] = useState("");

  const [analystModel, setAnalystModel] = useState("gemini-2.5-flash");
  const [analystTemp, setAnalystTemp] = useState(0.3);
  const [analystTopP, setAnalystTopP] = useState(0.8);
  const [analystEnabled, setAnalystEnabled] = useState(true);
  const [analystSystemPrompt, setAnalystSystemPrompt] = useState("");

  const [storytellerModel, setStorytellerModel] = useState("gemini-2.5-pro");
  const [storytellerTemp, setStorytellerTemp] = useState(0.9);
  const [storytellerTopP, setStorytellerTopP] = useState(0.95);
  const [storytellerEnabled, setStorytellerEnabled] = useState(true);
  const [storytellerSystemPrompt, setStorytellerSystemPrompt] = useState("");

  const [technicianModel, setTechnicianModel] = useState("gemini-2.5-flash");
  const [technicianTemp, setTechnicianTemp] = useState(0.2);
  const [technicianTopP, setTechnicianTopP] = useState(0.7);
  const [technicianEnabled, setTechnicianEnabled] = useState(true);
  const [technicianSystemPrompt, setTechnicianSystemPrompt] = useState("");

  const [curatorModel, setCuratorModel] = useState("gemini-2.5-flash");
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
    const r = brainQuery.data.reasoning as any;
    const g = brainQuery.data.generation as any;

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
    const fal = (brainQuery.data as any).falTasks;
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
    <div className="space-y-6 max-w-5xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="hs-h1 !mb-0 text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6" />
            AI 大腦組態
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            5種推理大腦 · 4種生成引擎 · 16大Fal.ai任務引擎 · Gemini / ElevenLabs
            / Vertex AI 自由切換
          </p>
        </div>

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
                                ? "bg-gray-300 animate-pulse"
                                : pingResult === undefined
                                  ? "bg-gray-300"
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
      {activeTab === "alerts" && (
        <div className="space-y-4">
          {/* ── 自動除錯開關 & 巡檢間隔 ─────────────────────────────────── */}
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              自動除錯設定
            </h2>
            <div className="space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-medium">啟用自動除錯</Label>
                  <p className="hs-small !mb-0 text-muted-foreground">
                    開啟後系統將定時自動巡檢 API 並嘗試修復故障引擎
                  </p>
                </div>
                <Switch
                  checked={autoRepairConfigQuery.data?.enabled ?? true}
                  onCheckedChange={checked =>
                    toggleAutoRepairMut.mutate({ enabled: checked })
                  }
                  disabled={toggleAutoRepairMut.isPending}
                />
              </div>
              {/* Interval Slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs font-medium">巡檢間隔</Label>
                  <span className="text-xs font-mono text-muted-foreground">
                    {autoRepairConfigQuery.data?.intervalMinutes ?? 3} 分鐘
                  </span>
                </div>
                <Slider
                  min={1}
                  max={60}
                  step={1}
                  value={[autoRepairConfigQuery.data?.intervalMinutes ?? 3]}
                  onValueCommit={v =>
                    setMonitorIntervalMut.mutate({ minutes: v[0] })
                  }
                  disabled={
                    setMonitorIntervalMut.isPending ||
                    !(autoRepairConfigQuery.data?.enabled ?? true)
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground/50 mt-1">
                  <span>1 分鐘</span>
                  <span>30 分鐘</span>
                  <span>60 分鐘</span>
                </div>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              自動修復 API + 提醒管理
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              系統每 {autoRepairConfigQuery.data?.intervalMinutes ?? 3}{" "}
              分鐘自動巡檢所有 API
              provider，偵測到故障時自動切換備援引擎，無法修復時通知管理員。
            </p>
            {alertsQuery.isLoading ? (
              <ZenSkeleton lines={4} />
            ) : (
              <div className="space-y-2">
                {(alertsQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 py-4 text-center">
                    ✅ 目前沒有警報，所有 API 正常運作
                  </p>
                )}
                {(alertsQuery.data ?? []).map(alert => (
                  <div
                    key={alert.id}
                    className={`rounded-lg border p-3 text-xs ${
                      alert.dismissedAt
                        ? "opacity-50 border-muted"
                        : alert.severity === "critical"
                          ? "border-red-500/30 bg-red-500/5"
                          : alert.severity === "warning"
                            ? "border-amber-500/30 bg-amber-500/5"
                            : "border-emerald-500/30 bg-emerald-500/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge
                            variant="outline"
                            className={`text-[9px] ${
                              alert.severity === "critical"
                                ? "text-red-600 border-red-500/30"
                                : alert.severity === "warning"
                                  ? "text-amber-600 border-amber-500/30"
                                  : "text-emerald-600 border-emerald-500/30"
                            }`}
                          >
                            {alert.severity}
                          </Badge>
                          <span className="font-medium">{alert.engine}</span>
                          {alert.autoRepaired && (
                            <Badge variant="secondary" className="text-[9px]">
                              已自動修復
                            </Badge>
                          )}
                        </div>
                        <p className="text-muted-foreground">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {new Date(alert.createdAt).toLocaleString("zh-TW")}
                          {alert.repairedWith &&
                            ` · 備援: ${alert.repairedWith}`}
                        </p>
                      </div>
                      {!alert.dismissedAt && alert.severity !== "info" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-7 shrink-0"
                          onClick={() =>
                            dismissAlertMut.mutate({ alertId: alert.id })
                          }
                          disabled={dismissAlertMut.isPending}
                        >
                          <Check className="w-3 h-3 mr-1" />
                          關閉
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Tab: Errors (錯誤線索) ─────────────────────────────────────── */}
      {activeTab === "errors" && (
        <div className="space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bug className="w-4 h-4 text-red-500" />
              生成錯誤線索系統
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              追蹤所有失敗的生成任務，自動分析根因、爬網搜尋修復方案，並提供步驟式解決指南。
            </p>
            {errorsQuery.isLoading ? (
              <ZenSkeleton lines={4} />
            ) : (
              <div className="space-y-2">
                {(errorsQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 py-4 text-center">
                    ✅ 目前沒有錯誤記錄
                  </p>
                )}
                {(errorsQuery.data ?? []).map(trace => {
                  const isExpanded = expandedDiagnosisId === trace.id;
                  const categoryLabel = trace.errorCategory
                    ? (ERROR_CATEGORY_LABEL_MAP[trace.errorCategory] ??
                      trace.errorCategory)
                    : null;
                  const categoryColor = trace.errorCategory
                    ? (ERROR_CATEGORY_COLOR_MAP[trace.errorCategory] ?? "")
                    : "";
                  return (
                    <div
                      key={trace.id}
                      id={`error-trace-${trace.id}`}
                      className={`rounded-lg border p-3 text-xs transition-all scroll-mt-24 ${
                        trace.resolvedAt
                          ? "opacity-50 border-muted"
                          : "border-red-500/20 bg-red-500/5"
                      } ${
                        focusedTraceId === trace.id
                          ? "ring-2 ring-amber-500 shadow-lg"
                          : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <Badge variant="outline" className="text-[9px]">
                              {trace.modality}
                            </Badge>
                            <span className="font-medium">{trace.engine}</span>
                            {trace.errorCode && (
                              <Badge variant="secondary" className="text-[9px]">
                                {trace.errorCode}
                              </Badge>
                            )}
                            {categoryLabel && (
                              <Badge
                                variant="secondary"
                                className={`text-[9px] ${categoryColor}`}
                              >
                                {categoryLabel}
                              </Badge>
                            )}
                            {trace.rootCauseConfidence != null &&
                              trace.rootCauseConfidence > 0 && (
                                <span className="text-[9px] text-muted-foreground">
                                  信心度 {trace.rootCauseConfidence}%
                                </span>
                              )}
                            {trace.resolvedAt && (
                              <Badge
                                variant="secondary"
                                className="text-[9px] bg-emerald-500/10 text-emerald-600"
                              >
                                已解決
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground break-all">
                            {trace.errorMessage.slice(0, 200)}
                          </p>
                          {trace.rootCause && (
                            <p className="text-[10px] text-amber-600 mt-1">
                              🔍 根因：{trace.rootCause.slice(0, 150)}
                            </p>
                          )}
                          {trace.webSearchResult && (
                            <p className="text-[10px] text-blue-500/80 mt-1">
                              🌐 {trace.webSearchResult.slice(0, 150)}...
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {new Date(trace.createdAt).toLocaleString("zh-TW")}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          {!trace.resolvedAt && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className={`text-[10px] h-7 ${isExpanded ? "border-blue-500 text-blue-600" : ""}`}
                                onClick={() =>
                                  setExpandedDiagnosisId(
                                    isExpanded ? null : trace.id
                                  )
                                }
                              >
                                <Search className="w-3 h-3 mr-1" />
                                {isExpanded ? "收起" : "診斷"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7"
                                onClick={() =>
                                  resolveErrorMut.mutate({
                                    traceId: trace.id,
                                    resolution: "手動標記已解決",
                                  })
                                }
                                disabled={resolveErrorMut.isPending}
                              >
                                <Check className="w-3 h-3 mr-1" />
                                解決
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* ── 展開：步驟式診斷面板 ── */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-blue-500/20">
                          {diagnosisQuery.isLoading ? (
                            <ZenSkeleton lines={3} />
                          ) : diagnosisQuery.data ? (
                            <div className="space-y-3">
                              {/* 根因分析 */}
                              <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5">
                                <p className="text-[10px] font-semibold text-amber-700 mb-1 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  根因分析（信心度{" "}
                                  {diagnosisQuery.data.rootCauseConfidence}%）
                                </p>
                                <p className="text-[11px] text-amber-900/80">
                                  {diagnosisQuery.data.rootCause}
                                </p>
                              </div>

                              {/* 相關錯誤 */}
                              {diagnosisQuery.data.relatedTraceIds.length >
                                0 && (
                                <p className="text-[10px] text-muted-foreground">
                                  🔗 發現{" "}
                                  {diagnosisQuery.data.relatedTraceIds.length}{" "}
                                  筆相關錯誤（同一引擎或分類）
                                </p>
                              )}

                              {/* 步驟式解決方案 */}
                              <div>
                                <p className="text-[10px] font-semibold text-foreground mb-2 flex items-center gap-1">
                                  <Lightbulb className="w-3 h-3 text-yellow-500" />
                                  步驟式解決方案
                                </p>
                                <div className="space-y-2">
                                  {diagnosisQuery.data.suggestedSteps.map(s => (
                                    <div
                                      key={s.step}
                                      className={`rounded-md border p-2 ${
                                        s.action === "check"
                                          ? "border-blue-500/20 bg-blue-500/5"
                                          : s.action === "fix"
                                            ? "border-emerald-500/20 bg-emerald-500/5"
                                            : s.action === "verify"
                                              ? "border-indigo-500/20 bg-indigo-500/5"
                                              : "border-orange-500/20 bg-orange-500/5"
                                      }`}
                                    >
                                      <div className="flex items-start gap-2">
                                        <span
                                          className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                            s.action === "check"
                                              ? "bg-blue-500/20 text-blue-700"
                                              : s.action === "fix"
                                                ? "bg-emerald-500/20 text-emerald-700"
                                                : s.action === "verify"
                                                  ? "bg-indigo-500/20 text-indigo-700"
                                                  : "bg-orange-500/20 text-orange-700"
                                          }`}
                                        >
                                          {s.step}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11px] font-medium">
                                            {s.title}
                                          </p>
                                          <p className="text-[10px] text-muted-foreground mt-0.5">
                                            {s.description}
                                          </p>
                                          {s.command && (
                                            <pre className="mt-1 text-[9px] bg-black/5 dark:bg-white/5 rounded px-2 py-1 whitespace-pre-wrap font-mono text-muted-foreground">
                                              {s.command}
                                            </pre>
                                          )}
                                        </div>
                                        <Badge
                                          variant="outline"
                                          className={`text-[8px] shrink-0 ${
                                            s.action === "check"
                                              ? "text-blue-600"
                                              : s.action === "fix"
                                                ? "text-emerald-600"
                                                : s.action === "verify"
                                                  ? "text-indigo-600"
                                                  : "text-orange-600"
                                          }`}
                                        >
                                          {s.action === "check"
                                            ? "檢查"
                                            : s.action === "fix"
                                              ? "修復"
                                              : s.action === "verify"
                                                ? "驗證"
                                                : "備援"}
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* 建議搜尋 */}
                              {diagnosisQuery.data.searchQueries.length > 0 && (
                                <div>
                                  <p className="text-[10px] font-semibold text-foreground mb-1.5 flex items-center gap-1">
                                    <Globe className="w-3 h-3 text-blue-500" />
                                    建議搜尋關鍵字
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {diagnosisQuery.data.searchQueries.map(
                                      (q, i) => (
                                        <Button
                                          key={i}
                                          size="sm"
                                          variant="outline"
                                          className="text-[9px] h-6 border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-600"
                                          onClick={() => {
                                            setActiveTab("research");
                                            setSearchQuery(q);
                                            webSearchMut.mutate({ query: q });
                                          }}
                                          disabled={webSearchMut.isPending}
                                        >
                                          <Search className="w-2.5 h-2.5 mr-0.5" />
                                          {q.slice(0, 40)}
                                        </Button>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground">
                              無法取得診斷資訊
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Tab: Proposals (自我反省) ──────────────────────────────────── */}
      {activeTab === "proposals" && (
        <div className="space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-yellow-500" />
              回饋自我反省優化系統
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              AI
              自動分析系統表現，提出優化提案。所有修改需經管理員審核批准後才會套用。
            </p>
            {proposalsQuery.isLoading ? (
              <ZenSkeleton lines={4} />
            ) : (
              <div className="space-y-3">
                {(proposalsQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 py-4 text-center">
                    目前沒有優化提案
                  </p>
                )}
                {(proposalsQuery.data ?? []).map(p => (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 text-xs ${
                      p.status === "pending"
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : p.status === "approved"
                          ? "border-emerald-500/30 bg-emerald-500/5 opacity-70"
                          : "border-red-500/20 bg-red-500/5 opacity-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[9px]">
                            {p.category}
                          </Badge>
                          <Badge
                            variant={
                              p.status === "approved"
                                ? "default"
                                : p.status === "rejected"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-[9px]"
                          >
                            {p.status === "pending"
                              ? "待審核"
                              : p.status === "approved"
                                ? "已批准"
                                : "已拒絕"}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            信心度 {p.confidence}%
                          </span>
                        </div>
                        <p className="font-medium mb-1">{p.title}</p>
                        <p className="text-muted-foreground">
                          {p.description.slice(0, 200)}
                        </p>
                        <div className="flex gap-4 mt-1.5 text-[10px] text-muted-foreground/60">
                          <span>現行：{p.currentValue}</span>
                          <span>→ 建議：{p.proposedValue.slice(0, 80)}</span>
                        </div>
                        {p.adminNote && (
                          <p className="text-[10px] text-blue-500/80 mt-1">
                            管理員備註：{p.adminNote}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {new Date(p.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                      {p.status === "pending" && (
                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            size="sm"
                            className="text-[10px] h-7 bg-emerald-600 hover:bg-emerald-700"
                            onClick={() =>
                              approveProposalMut.mutate({ proposalId: p.id })
                            }
                            disabled={approveProposalMut.isPending}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            批准
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[10px] h-7 text-red-600 hover:text-red-700"
                            onClick={() =>
                              rejectProposalMut.mutate({ proposalId: p.id })
                            }
                            disabled={rejectProposalMut.isPending}
                          >
                            <X className="w-3 h-3 mr-1" />
                            拒絕
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Tab: Research (爬網研究) ───────────────────────────────────── */}
      {activeTab === "research" && (
        <div className="space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-500" />
              爬網找資料功能
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              搜尋開源模型、程式碼、API
              文件等資源。搜尋結果可直接加入學習文件庫供 AI 使用。
            </p>
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="搜尋 AI 模型、API 錯誤修復方案..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && searchQuery.trim()) {
                    webSearchMut.mutate({ query: searchQuery.trim() });
                  }
                }}
                className="text-xs"
              />
              <Button
                size="sm"
                onClick={() =>
                  searchQuery.trim() &&
                  webSearchMut.mutate({ query: searchQuery.trim() })
                }
                disabled={webSearchMut.isPending || !searchQuery.trim()}
                className="shrink-0"
              >
                <Search className="w-3.5 h-3.5 mr-1" />
                {webSearchMut.isPending ? "搜尋中..." : "搜尋"}
              </Button>
            </div>

            {/* ── 錯誤 API 快選（按分類分組） ─────────────────────────── */}
            {(() => {
              const unresolvedErrors = (errorsQuery.data ?? []).filter(
                t => !t.resolvedAt
              );
              if (unresolvedErrors.length === 0) return null;

              // 按錯誤分類分組
              const categoryGroups: Record<string, typeof unresolvedErrors> =
                {};
              for (const t of unresolvedErrors) {
                const cat = t.errorCategory ?? "unknown";
                if (!categoryGroups[cat]) categoryGroups[cat] = [];
                categoryGroups[cat].push(t);
              }

              const categoryLabels = ERROR_CATEGORY_EMOJI_LABELS;

              return (
                <div className="mb-4 space-y-3">
                  <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Bug className="w-3 h-3 text-red-400" />
                    依錯誤分類搜尋修復方案：
                  </p>
                  {Object.entries(categoryGroups).map(([cat, traces]) => {
                    const label = categoryLabels[cat] ?? cat;
                    const uniqueEngines = Array.from(
                      new Set(traces.map(t => t.engine))
                    );
                    return (
                      <div key={cat} className="space-y-1">
                        <p className="text-[10px] font-medium text-foreground/80">
                          {label} ({traces.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {uniqueEngines.slice(0, 8).map(engine => {
                            const errorCount = traces.filter(
                              t => t.engine === engine
                            ).length;
                            const errMsg =
                              traces.find(t => t.engine === engine)
                                ?.errorMessage ?? "";
                            const query =
                              cat !== "unknown"
                                ? `${engine} ${cat.replace("_", " ")} error fix solution`
                                : `${engine} API error fix ${errMsg.slice(0, 60)}`;
                            return (
                              <Button
                                key={engine}
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-7 border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-600"
                                onClick={() => {
                                  setSearchQuery(query);
                                  webSearchMut.mutate({ query });
                                }}
                                disabled={webSearchMut.isPending}
                              >
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {engine.split("/").pop()}
                                {errorCount > 1 && (
                                  <Badge
                                    variant="secondary"
                                    className="text-[8px] ml-1 px-1 py-0 h-3.5"
                                  >
                                    ×{errorCount}
                                  </Badge>
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </GlassCard>

          <GlassCard>
            <h3 className="text-xs font-semibold text-foreground mb-3">
              搜尋結果
            </h3>
            {researchQuery.isLoading ? (
              <ZenSkeleton lines={3} />
            ) : (
              <div className="space-y-2">
                {(researchQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 py-4 text-center">
                    尚無搜尋結果，請在上方輸入搜尋詞
                  </p>
                )}
                {(researchQuery.data ?? []).map(r => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[9px]">
                            {r.source}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            相關度 {r.relevance}%
                          </span>
                          {r.addedToLearnHub && (
                            <Badge
                              variant="secondary"
                              className="text-[9px] bg-emerald-500/10 text-emerald-600"
                            >
                              已加入學習庫
                            </Badge>
                          )}
                        </div>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {r.title}
                        </a>
                        <p className="text-muted-foreground mt-1">
                          {r.summary.slice(0, 200)}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {new Date(r.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                      {!r.addedToLearnHub && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-[10px] h-7 shrink-0"
                          onClick={() =>
                            addToLearnHubMut.mutate({ researchId: r.id })
                          }
                          disabled={addToLearnHubMut.isPending}
                        >
                          <BookOpen className="w-3 h-3 mr-1" />
                          加入學習庫
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Tab: Accuracy (精準度測試) ─────────────────────────────────── */}
      {activeTab === "accuracy" && (
        <div className="space-y-4">
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-500" />
              AI 精準度測試系統
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              自行測試生成式 AI
              的回應品質、延遲、一致性。低於門檻時自動建立優化提案（需管理員批准）。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <Label className="text-[10px]">引擎</Label>
                <Input
                  value={testEngine}
                  onChange={e => setTestEngine(e.target.value)}
                  className="text-xs mt-1"
                  placeholder="gemini-2.5-flash"
                />
              </div>
              <div>
                <Label className="text-[10px]">測試類型</Label>
                <Select
                  value={testType}
                  onValueChange={v => setTestType(v as typeof testType)}
                >
                  <SelectTrigger className="text-xs mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="response_quality">回應品質</SelectItem>
                    <SelectItem value="latency">延遲測試</SelectItem>
                    <SelectItem value="consistency">一致性</SelectItem>
                    <SelectItem value="error_rate">錯誤率</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-[10px]">測試提示詞</Label>
                <Input
                  value={testPrompt}
                  onChange={e => setTestPrompt(e.target.value)}
                  className="text-xs mt-1"
                  placeholder="用 30 字描述一棵樹"
                />
              </div>
              <div>
                <Label className="text-[10px]">預期行為</Label>
                <Input
                  value={testExpected}
                  onChange={e => setTestExpected(e.target.value)}
                  className="text-xs mt-1"
                  placeholder="回傳繁體中文，字數接近 30"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  testPrompt.trim() &&
                  testExpected.trim() &&
                  runTestMut.mutate({
                    engine: testEngine,
                    testType,
                    testPrompt,
                    expectedBehavior: testExpected,
                  })
                }
                disabled={
                  runTestMut.isPending ||
                  !testPrompt.trim() ||
                  !testExpected.trim()
                }
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                {runTestMut.isPending ? "測試中..." : "執行測試"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => runAllTestsMut.mutate()}
                disabled={runAllTestsMut.isPending}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 mr-1 ${runAllTestsMut.isPending ? "animate-spin" : ""}`}
                />
                {runAllTestsMut.isPending
                  ? "批量測試中..."
                  : "執行全部預定義測試"}
              </Button>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" />
              測試結果歷史
            </h3>
            {testsQuery.isLoading ? (
              <ZenSkeleton lines={3} />
            ) : (
              <div className="space-y-2">
                {(testsQuery.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground/60 py-4 text-center">
                    尚無測試記錄，請執行測試
                  </p>
                )}
                {(testsQuery.data ?? []).map(t => (
                  <div
                    key={t.id}
                    className={`rounded-lg border p-3 text-xs ${
                      t.passed
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-red-500/20 bg-red-500/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[9px]">
                            {t.engine}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px]">
                            {t.testType}
                          </Badge>
                          <span
                            className={`font-bold text-sm ${t.passed ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {t.score}/100
                          </span>
                          {t.passed ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <X className="w-3 h-3 text-red-600" />
                          )}
                        </div>
                        <p className="text-muted-foreground">
                          提示：{t.testPrompt}
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          結果：{t.actualResult.slice(0, 200)}
                        </p>
                        {t.suggestions.length > 0 && (
                          <div className="mt-1.5 text-[10px] text-amber-600">
                            💡 {t.suggestions.join("；")}
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {new Date(t.createdAt).toLocaleString("zh-TW")}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Tab: LangSmith 監控 ─────────────────────────────────────────── */}
      {activeTab === "langsmith" && (
        <div className="space-y-4">
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                LangSmith 監控
              </h2>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={fetchLangsmithStats}
                disabled={langsmithLoading}
              >
                <RefreshCw
                  className={`w-3 h-3 ${langsmithLoading ? "animate-spin" : ""}`}
                />
                重新整理
              </Button>
            </div>

            {/* Loading skeleton */}
            {langsmithLoading && !langsmithStats && <ZenSkeleton lines={6} />}

            {/* Error / not configured */}
            {!langsmithLoading && langsmithError && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-700 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  無法載入 LangSmith 資料
                </p>
                <p className="text-xs">{langsmithError}</p>
                {langsmithError.includes("LANGSMITH_API_KEY") && (
                  <p className="text-xs mt-2">
                    前往{" "}
                    <a
                      href="https://smith.langchain.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      smith.langchain.com
                    </a>{" "}
                    取得 API Key，並在伺服器環境變數中設定{" "}
                    <code className="bg-amber-500/20 px-1 rounded">
                      LANGSMITH_API_KEY
                    </code>
                    。
                  </p>
                )}
              </div>
            )}

            {/* KPI cards */}
            {langsmithStats && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {[
                    {
                      label: "總呼叫次數",
                      value: langsmithStats.summary.totalRuns,
                      unit: "",
                    },
                    {
                      label: "平均延遲",
                      value: langsmithStats.summary.avgLatency,
                      unit: "ms",
                    },
                    {
                      label: "錯誤率",
                      value: langsmithStats.summary.errorRate,
                      unit: "%",
                    },
                    {
                      label: "Token 用量",
                      value:
                        langsmithStats.summary.totalTokens.toLocaleString(),
                      unit: "",
                    },
                  ].map(kpi => (
                    <div
                      key={kpi.label}
                      className="rounded-lg bg-muted/30 border border-white/10 p-3 text-center"
                    >
                      <p className="text-[10px] text-muted-foreground mb-1">
                        {kpi.label}
                      </p>
                      <p className="text-lg font-bold text-foreground">
                        {kpi.value}
                        {kpi.unit && (
                          <span className="text-xs font-normal text-muted-foreground ml-0.5">
                            {kpi.unit}
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Recent runs table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-muted-foreground">
                        <th className="text-left py-2 pr-3 font-medium">
                          時間
                        </th>
                        <th className="text-left py-2 pr-3 font-medium">
                          名稱
                        </th>
                        <th className="text-left py-2 pr-3 font-medium">
                          狀態
                        </th>
                        <th className="text-right py-2 pr-3 font-medium">
                          延遲
                        </th>
                        <th className="text-right py-2 font-medium">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {langsmithStats.runs.slice(0, 10).map(run => (
                        <tr
                          key={run.id}
                          className="border-b border-white/5 hover:bg-muted/20 transition-colors"
                        >
                          <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                            {run.startTime
                              ? new Date(run.startTime).toLocaleString(
                                  "zh-TW",
                                  {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }
                                )
                              : "—"}
                          </td>
                          <td
                            className="py-2 pr-3 max-w-[160px] truncate"
                            title={run.name}
                          >
                            {run.name || "—"}
                          </td>
                          <td className="py-2 pr-3">
                            {run.error || run.status === "error" ? (
                              <Badge
                                variant="secondary"
                                className="text-[9px] bg-red-500/10 text-red-600 border-red-500/20"
                              >
                                錯誤
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                              >
                                成功
                              </Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right text-muted-foreground">
                            {run.latency != null
                              ? `${run.latency.toLocaleString()} ms`
                              : "—"}
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {run.totalTokens > 0
                              ? run.totalTokens.toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                      {langsmithStats.runs.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-8 text-center text-muted-foreground"
                          >
                            尚無追蹤記錄
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
