import { useState, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface ModelOption {
  value: string;
  label: string;
  tier: string;
}

interface SlotCatalog {
  label: string;
  description: string;
  options: readonly ModelOption[];
}

type HealthStatus = Record<
  string,
  { healthy: boolean; consecutiveFailures: number; lastError?: string }
>;

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
  const isHealthy = status?.healthy ?? true;
  const failures = status?.consecutiveFailures ?? 0;

  // 三色點燈：Online 綠 / Degraded 橘 / Offline 紅
  let color: string;
  let label: string;
  let pulseClass: string;

  if (!isHealthy) {
    color = "bg-red-500";
    label = "Offline";
    pulseClass = "";
  } else if (failures > 0) {
    color = "bg-amber-500";
    label = "Degraded";
    pulseClass = "animate-pulse";
  } else {
    color = "bg-emerald-500";
    label = "Online";
    pulseClass = "";
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex items-center">
          <span
            className={`w-2.5 h-2.5 rounded-full ${color} ${pulseClass}`}
          />
          {isHealthy && failures === 0 && (
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
    premium: { className: "bg-amber-500/10 text-amber-600 border-amber-500/20", label: "Premium" },
    standard: { className: "bg-blue-500/10 text-blue-600 border-blue-500/20", label: "Standard" },
    fast: { className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", label: "Fast" },
  };
  const v = variants[tier] ?? variants.standard;
  return (
    <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${v.className}`}>
      {v.label}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Live Preview — 光球對話範例
// ═══════════════════════════════════════════════════════════════════════════

const SOUL_PREVIEW_MESSAGES: Record<string, string[]> = {
  "gpt-4o": [
    "我注意到你在這張星空作品前停留了好一會兒。要不要讓我幫你把光影參數調好，我們直接去創作室試試看？",
    "你的創作風格很有層次感。我可以建議一些進階的構圖技巧，讓畫面更有深度。",
  ],
  "gpt-4o-mini": [
    "嗨！看起來你對這個風格很感興趣。要試試看嗎？",
    "這張圖的色調很棒！我可以幫你快速設定類似的參數。",
  ],
  "claude-3.5-sonnet": [
    "我留意到你反覆端詳這幅作品的光影層次。如果你願意，我可以為你解析其中的構圖邏輯，並協助你在創作室重現這種氛圍。",
    "你的審美直覺很敏銳。這種明暗對比的手法在文藝復興時期被稱為 chiaroscuro——要不要一起探索這個方向？",
  ],
  "claude-3-opus": [
    "我觀察到你對這件作品的光影處理特別著迷。讓我為你深入剖析它的藝術脈絡，然後我們可以一起在創作室中展開一場對話式的創作旅程。",
    "你的目光在這幅作品上流連了許久。我感受到你被它的情感張力所吸引——要不要讓我們一起解構這份感動，轉化為你自己的創作語言？",
  ],
  "gemini-1.5-pro": [
    "有趣的選擇！我分析了這張圖的 42 個視覺特徵，發現它的獨特之處在於光源角度和色溫的巧妙平衡。要我幫你設定最佳參數嗎？",
    "根據你的瀏覽模式，你似乎偏好暖色調和柔和光線。我已經準備好了一組推薦配置，隨時可以開始。",
  ],
  "gemini-pro": [
    "這張圖的構圖很有意思！我注意到幾個關鍵的視覺元素。要不要讓我幫你分析一下？",
    "你的瀏覽偏好顯示你喜歡這類風格。我可以快速幫你配置相似的參數。",
  ],
};

function LivePreview({ model }: { model: string }) {
  const messages = SOUL_PREVIEW_MESSAGES[model] ?? SOUL_PREVIEW_MESSAGES["gpt-4o"];
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    setMsgIndex(0);
  }, [model]);

  const currentMsg = messages[msgIndex % messages.length];

  return (
    <div className="relative">
      {/* 光球視覺 */}
      <div className="flex items-start gap-3">
        <motion.div
          className="relative flex-shrink-0"
          animate={{
            scale: [1, 1.05, 1],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-rose-400 shadow-lg shadow-amber-300/30" />
          <div className="absolute inset-0 w-10 h-10 rounded-full bg-gradient-to-br from-amber-300/40 via-orange-400/30 to-rose-400/20 blur-md" />
        </motion.div>

        {/* 對話氣泡 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${model}-${msgIndex}`}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 bg-white/60 dark:bg-white/10 backdrop-blur-sm rounded-2xl rounded-tl-sm p-3.5 border border-white/40 shadow-sm"
          >
            <p className="text-sm text-foreground/90 leading-relaxed">
              {currentMsg}
            </p>
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[10px] text-muted-foreground/60">
                {model} · 光球語調預覽
              </span>
              <button
                onClick={() => setMsgIndex((i) => i + 1)}
                className="text-[10px] text-primary/70 hover:text-primary transition-colors flex items-center gap-0.5"
              >
                換一句 <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Brain Slot Card
// ═══════════════════════════════════════════════════════════════════════════

function BrainSlotCard({
  slot,
  catalog,
  icon: Icon,
  currentModel,
  temperature,
  topP,
  enabled,
  health,
  onModelChange,
  onTemperatureChange,
  onTopPChange,
  onEnabledChange,
}: {
  slot: string;
  catalog: SlotCatalog;
  icon: React.ElementType;
  currentModel: string;
  temperature: number;
  topP: number;
  enabled: boolean;
  health: HealthStatus | undefined;
  onModelChange: (model: string) => void;
  onTemperatureChange: (temp: number) => void;
  onTopPChange: (topP: number) => void;
  onEnabledChange: (enabled: boolean) => void;
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
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              enabled
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
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
            <p className="text-[10px] text-muted-foreground">
              {catalog.description}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {/* Model Select */}
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
                {catalog.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <HealthDot model={opt.value} health={health} />
                      <span>{opt.label}</span>
                      <TierBadge tier={opt.tier} />
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Temperature Slider */}
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
              onValueChange={([v]) => onTemperatureChange(v)}
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

          {/* Top P Slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">
                Top P
              </Label>
              <span className="text-[10px] font-mono text-foreground/70 tabular-nums">
                {topP.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[topP]}
              onValueChange={([v]) => onTopPChange(v)}
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
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Engine Slot Card
// ═══════════════════════════════════════════════════════════════════════════

function EngineSlotCard({
  catalog,
  icon: Icon,
  currentEngine,
  enabled,
  health,
  onEngineChange,
  onEnabledChange,
}: {
  catalog: SlotCatalog;
  icon: React.ElementType;
  currentEngine: string;
  enabled: boolean;
  health: HealthStatus | undefined;
  onEngineChange: (engine: string) => void;
  onEnabledChange: (enabled: boolean) => void;
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
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              enabled
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
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
            <p className="text-[10px] text-muted-foreground">
              {catalog.description}
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
        >
          <Label className="text-[10px] text-muted-foreground mb-1.5 block">
            引擎選擇
          </Label>
          <Select value={currentEngine} onValueChange={onEngineChange}>
            <SelectTrigger className="h-9 text-xs bg-white/40 dark:bg-white/5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className="flex items-center gap-2">
                    <HealthDot model={opt.value} health={health} />
                    <span>{opt.label}</span>
                    <TierBadge tier={opt.tier} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </motion.div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════

export default function AiBrainSettings() {
  const brainQuery = trpc.brain.get.useQuery(undefined, { retry: false });
  const catalogQuery = trpc.brain.catalog.useQuery(undefined, { staleTime: 60_000 });
  const healthQuery = trpc.brain.healthStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const upsertMutation = trpc.brain.upsert.useMutation({
    onSuccess: () => {
      toast.success("大腦組態已儲存");
      brainQuery.refetch();
    },
    onError: (err) => toast.error("儲存失敗：" + err.message),
  });

  // ── Local State ───────────────────────────────────────────────────────

  // Reasoning brains
  const [directorModel, setDirectorModel] = useState("gpt-4o");
  const [directorTemp, setDirectorTemp] = useState(0.7);
  const [directorTopP, setDirectorTopP] = useState(0.9);
  const [directorEnabled, setDirectorEnabled] = useState(true);

  const [analystModel, setAnalystModel] = useState("gpt-4o-mini");
  const [analystTemp, setAnalystTemp] = useState(0.3);
  const [analystTopP, setAnalystTopP] = useState(0.8);
  const [analystEnabled, setAnalystEnabled] = useState(true);

  const [storytellerModel, setStorytellerModel] = useState("gpt-4o");
  const [storytellerTemp, setStorytellerTemp] = useState(0.9);
  const [storytellerTopP, setStorytellerTopP] = useState(0.95);
  const [storytellerEnabled, setStorytellerEnabled] = useState(true);

  const [technicianModel, setTechnicianModel] = useState("gpt-4o");
  const [technicianTemp, setTechnicianTemp] = useState(0.2);
  const [technicianTopP, setTechnicianTopP] = useState(0.7);
  const [technicianEnabled, setTechnicianEnabled] = useState(true);

  const [curatorModel, setCuratorModel] = useState("gpt-4o");
  const [curatorTemp, setCuratorTemp] = useState(0.8);
  const [curatorTopP, setCuratorTopP] = useState(0.9);
  const [curatorEnabled, setCuratorEnabled] = useState(true);

  // Generation engines
  const [imageEngine, setImageEngine] = useState("flux-pro");
  const [imageEnabled, setImageEnabled] = useState(true);
  const [videoEngine, setVideoEngine] = useState("kling-v1");
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEngine, setAudioEngine] = useState("suno-v4");
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [voiceEngine, setVoiceEngine] = useState("elevenlabs-v2");
  const [voiceEnabled, setVoiceEnabled] = useState(true);

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
    }
    if (r.analyst) {
      setAnalystModel(r.analyst.model);
      setAnalystTemp(r.analyst.temperature);
      setAnalystTopP(r.analyst.topP);
      setAnalystEnabled(r.analyst.enabled);
    }
    if (r.storyteller) {
      setStorytellerModel(r.storyteller.model);
      setStorytellerTemp(r.storyteller.temperature);
      setStorytellerTopP(r.storyteller.topP);
      setStorytellerEnabled(r.storyteller.enabled);
    }
    if (r.technician) {
      setTechnicianModel(r.technician.model);
      setTechnicianTemp(r.technician.temperature);
      setTechnicianTopP(r.technician.topP);
      setTechnicianEnabled(r.technician.enabled);
    }
    if (r.curator) {
      setCuratorModel(r.curator.model);
      setCuratorTemp(r.curator.temperature);
      setCuratorTopP(r.curator.topP);
      setCuratorEnabled(r.curator.enabled);
    }
    if (g.imageEngine) {
      setImageEngine(g.imageEngine.engine);
      setImageEnabled(g.imageEngine.enabled);
    }
    if (g.videoEngine) {
      setVideoEngine(g.videoEngine.engine);
      setVideoEnabled(g.videoEngine.enabled);
    }
    if (g.audioEngine) {
      setAudioEngine(g.audioEngine.engine);
      setAudioEnabled(g.audioEngine.enabled);
    }
    if (g.voiceEngine) {
      setVoiceEngine(g.voiceEngine.engine);
      setVoiceEnabled(g.voiceEngine.enabled);
    }
  }, [brainQuery.data]);

  // ── Save Handler ──────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    upsertMutation.mutate({
      directorModel,
      directorTemperature: directorTemp,
      directorTopP,
      directorEnabled,
      analystModel,
      analystTemperature: analystTemp,
      analystTopP,
      analystEnabled,
      storytellerModel,
      storytellerTemperature: storytellerTemp,
      storytellerTopP,
      storytellerEnabled,
      technicianModel,
      technicianTemperature: technicianTemp,
      technicianTopP,
      technicianEnabled,
      curatorModel,
      curatorTemperature: curatorTemp,
      curatorTopP,
      curatorEnabled,
      imageEngine,
      imageEngineEnabled: imageEnabled,
      videoEngine,
      videoEngineEnabled: videoEnabled,
      audioEngine,
      audioEngineEnabled: audioEnabled,
      voiceEngine,
      voiceEngineEnabled: voiceEnabled,
    });
  }, [
    directorModel, directorTemp, directorTopP, directorEnabled,
    analystModel, analystTemp, analystTopP, analystEnabled,
    storytellerModel, storytellerTemp, storytellerTopP, storytellerEnabled,
    technicianModel, technicianTemp, technicianTopP, technicianEnabled,
    curatorModel, curatorTemp, curatorTopP, curatorEnabled,
    imageEngine, imageEnabled, videoEngine, videoEnabled,
    audioEngine, audioEnabled, voiceEngine, voiceEnabled,
    upsertMutation,
  ]);

  // ── Health Summary ────────────────────────────────────────────────────

  const healthSummary = useMemo(() => {
    const h = healthQuery.data;
    if (!h) return { online: 0, degraded: 0, offline: 0 };
    let online = 0, degraded = 0, offline = 0;
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
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
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
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Brain className="w-6 h-6" />
            AI 大腦組態
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理 5 種推理大腦與 4 種生成引擎的模型選擇與參數配置
          </p>
        </div>

        {/* Health Summary Pills */}
        <div className="flex items-center gap-2">
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

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Brain & Engine Cards (3 cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Reasoning Brains Section */}
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              邏輯推理大腦
              <Badge variant="outline" className="text-[9px] ml-1">5 slots</Badge>
            </h2>
            <div className="space-y-3">
              {catalog && (
                <>
                  <BrainSlotCard
                    slot="director"
                    catalog={catalog.reasoning.director as unknown as SlotCatalog}
                    icon={Sparkles}
                    currentModel={directorModel}
                    temperature={directorTemp}
                    topP={directorTopP}
                    enabled={directorEnabled}
                    health={health}
                    onModelChange={setDirectorModel}
                    onTemperatureChange={setDirectorTemp}
                    onTopPChange={setDirectorTopP}
                    onEnabledChange={setDirectorEnabled}
                  />
                  <BrainSlotCard
                    slot="analyst"
                    catalog={catalog.reasoning.analyst as unknown as SlotCatalog}
                    icon={Activity}
                    currentModel={analystModel}
                    temperature={analystTemp}
                    topP={analystTopP}
                    enabled={analystEnabled}
                    health={health}
                    onModelChange={setAnalystModel}
                    onTemperatureChange={setAnalystTemp}
                    onTopPChange={setAnalystTopP}
                    onEnabledChange={setAnalystEnabled}
                  />
                  <BrainSlotCard
                    slot="storyteller"
                    catalog={catalog.reasoning.storyteller as unknown as SlotCatalog}
                    icon={Zap}
                    currentModel={storytellerModel}
                    temperature={storytellerTemp}
                    topP={storytellerTopP}
                    enabled={storytellerEnabled}
                    health={health}
                    onModelChange={setStorytellerModel}
                    onTemperatureChange={setStorytellerTemp}
                    onTopPChange={setStorytellerTopP}
                    onEnabledChange={setStorytellerEnabled}
                  />
                  <BrainSlotCard
                    slot="technician"
                    catalog={catalog.reasoning.technician as unknown as SlotCatalog}
                    icon={Shield}
                    currentModel={technicianModel}
                    temperature={technicianTemp}
                    topP={technicianTopP}
                    enabled={technicianEnabled}
                    health={health}
                    onModelChange={setTechnicianModel}
                    onTemperatureChange={setTechnicianTemp}
                    onTopPChange={setTechnicianTopP}
                    onEnabledChange={setTechnicianEnabled}
                  />
                  <BrainSlotCard
                    slot="curator"
                    catalog={catalog.reasoning.curator as unknown as SlotCatalog}
                    icon={Brain}
                    currentModel={curatorModel}
                    temperature={curatorTemp}
                    topP={curatorTopP}
                    enabled={curatorEnabled}
                    health={health}
                    onModelChange={setCuratorModel}
                    onTemperatureChange={setCuratorTemp}
                    onTopPChange={setCuratorTopP}
                    onEnabledChange={setCuratorEnabled}
                  />
                </>
              )}
            </div>
          </GlassCard>

          {/* Generation Engines Section */}
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              生成引擎
              <Badge variant="outline" className="text-[9px] ml-1">4 slots</Badge>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {catalog && (
                <>
                  <EngineSlotCard
                    catalog={catalog.generation.imageEngine as unknown as SlotCatalog}
                    icon={Image}
                    currentEngine={imageEngine}
                    enabled={imageEnabled}
                    health={health}
                    onEngineChange={setImageEngine}
                    onEnabledChange={setImageEnabled}
                  />
                  <EngineSlotCard
                    catalog={catalog.generation.videoEngine as unknown as SlotCatalog}
                    icon={Video}
                    currentEngine={videoEngine}
                    enabled={videoEnabled}
                    health={health}
                    onEngineChange={setVideoEngine}
                    onEnabledChange={setVideoEnabled}
                  />
                  <EngineSlotCard
                    catalog={catalog.generation.audioEngine as unknown as SlotCatalog}
                    icon={Music}
                    currentEngine={audioEngine}
                    enabled={audioEnabled}
                    health={health}
                    onEngineChange={setAudioEngine}
                    onEnabledChange={setAudioEnabled}
                  />
                  <EngineSlotCard
                    catalog={catalog.generation.voiceEngine as unknown as SlotCatalog}
                    icon={Mic}
                    currentEngine={voiceEngine}
                    enabled={voiceEnabled}
                    health={health}
                    onEngineChange={setVoiceEngine}
                    onEnabledChange={setVoiceEnabled}
                  />
                </>
              )}
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
            <p className="text-[10px] text-muted-foreground mb-3">
              切換「光球語調」大腦模型，即時預覽光球對話風格
            </p>
            <LivePreview model={technicianModel} />
          </GlassCard>

          {/* Health Overview */}
          <GlassCard>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              系統健康
            </h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">在線引擎</span>
                <span className="font-medium text-emerald-600">
                  {healthSummary.online}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">降級中</span>
                <span className="font-medium text-amber-600">
                  {healthSummary.degraded}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">離線</span>
                <span className="font-medium text-red-600">
                  {healthSummary.offline}
                </span>
              </div>
              <div className="pt-2 border-t border-white/20">
                <p className="text-[10px] text-muted-foreground/60">
                  健康檢查每 30 秒自動更新。離線引擎將自動降級至備援。
                </p>
              </div>
            </div>
          </GlassCard>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSave}
              disabled={upsertMutation.isPending}
              className="w-full rounded-xl"
            >
              <Save className="w-4 h-4 mr-2" />
              {upsertMutation.isPending ? "儲存中..." : "儲存組態"}
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
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground">安全提示：</strong>
              此頁面不會顯示或暴露任何 API Key。所有模型呼叫均透過伺服器端安全代理執行。
              切換模型時，系統會自動記錄切換日誌以供審計。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
