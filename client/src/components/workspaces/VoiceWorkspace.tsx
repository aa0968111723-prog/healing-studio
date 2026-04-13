import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ZenTooltip } from "@/components/ZenCoPilot";
import { trpc } from "@/lib/trpc";
import { Mic, Gauge, Heart, Zap, Volume2, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export type VoiceWorkspaceState = {
  voiceActorId: string;
  text: string;
  speed: number;
  stability: number;
  emotionIntensity: number;
  emotionType: string;
};

type VoiceWorkspaceProps = {
  value: VoiceWorkspaceState;
  onChange: (state: VoiceWorkspaceState) => void;
};

const PRESET_VOICES = [
  { id: "default-warm", name: "溫暖女聲", description: "柔和、治癒感" },
  { id: "default-calm", name: "沉穩男聲", description: "深沉、可靠" },
  { id: "default-bright", name: "明亮女聲", description: "活潑、清晰" },
  { id: "default-narrator", name: "旁白男聲", description: "專業、敘事感" },
  { id: "default-child", name: "童聲", description: "天真、可愛" },
];

const EMOTION_TYPES = [
  { value: "neutral", label: "中性" },
  { value: "happy", label: "愉悅" },
  { value: "sad", label: "感傷" },
  { value: "excited", label: "興奮" },
  { value: "calm", label: "平靜" },
  { value: "serious", label: "嚴肅" },
];

// ─── Quick Presets ─────────────────────────────────────────────────────────

type QuickPreset = {
  id: string;
  label: string;
  icon: string;
  description: string;
  color: string;
  glowRgb: string;
  state: Partial<VoiceWorkspaceState>;
};

const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "meditation",
    label: "冥想引導",
    icon: "🧘",
    description: "輕柔語調、平靜情緒",
    color: "cyan",
    glowRgb: "0,210,255",
    state: {
      text: "閉上眼睛，深呼吸。感受空氣緩緩流入你的身體，帶走所有的疲憊與焦慮。讓思緒如雲朵般飄過，不需要抓住任何一個念頭。你是安全的，你是被愛的。",
      speed: 0.8,
      emotionType: "calm",
      emotionIntensity: 0.7,
      voiceActorId: "default-warm",
    },
  },
  {
    id: "narration",
    label: "故事旁白",
    icon: "📖",
    description: "專業敘事、中性情緒",
    color: "amber",
    glowRgb: "255,180,50",
    state: {
      text: "在遙遠的北方，有一座被迷霧環繞的古老城堡。傳說中，每當月圓之夜，城堡的塔頂會亮起一盞幽藍的燈火，指引迷途的旅人找到回家的路。",
      speed: 1.0,
      emotionType: "neutral",
      emotionIntensity: 0.4,
      voiceActorId: "default-narrator",
    },
  },
  {
    id: "advertisement",
    label: "熱情廣告",
    icon: "📢",
    description: "明亮語調、興奮情緒",
    color: "rose",
    glowRgb: "255,100,130",
    state: {
      text: "全新升級！限時優惠只到本週末！現在加入會員，立即享受獨家折扣與專屬好禮。別再猶豫，馬上行動，讓美好生活從今天開始！",
      speed: 1.3,
      emotionType: "excited",
      emotionIntensity: 0.85,
      voiceActorId: "default-bright",
    },
  },
];

export function createDefaultVoiceState(): VoiceWorkspaceState {
  return {
    voiceActorId: "default-warm",
    text: "",
    speed: 1.0,
    stability: 0.5,
    emotionIntensity: 0.5,
    emotionType: "neutral",
  };
}

export function VoiceWorkspace({ value, onChange }: VoiceWorkspaceProps) {
  const update = (partial: Partial<VoiceWorkspaceState>) => onChange({ ...value, ...partial });

  // Fetch user's custom voice models
  const modelsQuery = trpc.models.myModels.useQuery(undefined, { retry: false });
  const voiceModels = (modelsQuery.data || []).filter(m => m.modelType === "voice_clone" && m.status === "ready");

  const applyPreset = (preset: QuickPreset) => {
    onChange({ ...value, ...preset.state });
  };

  return (
    <div className="space-y-5">
      {/* ── Quick Presets ── */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          常用語境預設
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {QUICK_PRESETS.map((preset) => (
            <motion.button
              key={preset.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => applyPreset(preset)}
              className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all border border-white/15 hover:border-white/30"
              style={{
                background: "rgba(255,255,255,0.06)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = `rgba(${preset.glowRgb}, 0.1)`;
                (e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px rgba(${preset.glowRgb}, 0.15)`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <span className="text-xl">{preset.icon}</span>
              <span className="text-[11px] font-medium text-foreground">{preset.label}</span>
              <span className="text-[9px] text-muted-foreground/60 leading-tight text-center">{preset.description}</span>
            </motion.button>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground/50">
          點擊預設按鈕將自動填入文案、語速、情緒與聲線設定
        </p>
      </div>

      {/* Voice Actor Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">語音角色</Label>
        <div className="space-y-1.5">
          {/* Preset voices */}
          <div className="grid grid-cols-1 gap-1.5">
            {PRESET_VOICES.map((voice) => (
              <button
                key={voice.id}
                onClick={() => update({ voiceActorId: voice.id })}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                  value.voiceActorId === voice.id
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "bg-white/30 hover:bg-white/50"
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  value.voiceActorId === voice.id ? "bg-primary/20" : "bg-muted/30"
                }`}>
                  <Mic className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{voice.name}</p>
                  <p className="text-[10px] text-muted-foreground">{voice.description}</p>
                </div>
                {value.voiceActorId === voice.id && (
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                )}
              </button>
            ))}
          </div>

          {/* Custom voice models */}
          {voiceModels.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-2">
                <div className="h-px flex-1 bg-border/30" />
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider">自訂語音模型</span>
                <div className="h-px flex-1 bg-border/30" />
              </div>
              {voiceModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => update({ voiceActorId: `custom-${model.id}` })}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all w-full ${
                    value.voiceActorId === `custom-${model.id}`
                      ? "bg-violet-500/10 ring-1 ring-violet-500/30"
                      : "bg-white/30 hover:bg-white/50"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Volume2 className="w-4 h-4 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{model.name}</p>
                    <p className="text-[10px] text-muted-foreground">自訂克隆語音</p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Text Input */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">語音文字</Label>
        <Textarea
          placeholder="輸入要轉換為語音的文字內容..."
          value={value.text}
          onChange={(e) => update({ text: e.target.value })}
          rows={4}
          className="rounded-xl bg-white/40 border-white/60 resize-none text-xs placeholder:text-muted-foreground/35 leading-relaxed"
        />
        <p className="text-[10px] text-muted-foreground/60 text-right">
          {value.text.length} 字
        </p>
      </div>

      {/* Emotion Type */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">情感類型</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {EMOTION_TYPES.map((emo) => (
            <button
              key={emo.value}
              onClick={() => update({ emotionType: emo.value })}
              className={`px-2.5 py-2 rounded-lg text-[11px] font-medium transition-all ${
                value.emotionType === emo.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-white/40 text-muted-foreground hover:bg-white/60"
              }`}
            >
              {emo.label}
            </button>
          ))}
        </div>
      </div>

      {/* Emotion Intensity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Heart className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium text-muted-foreground">情感強度</Label>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {Math.round(value.emotionIntensity * 100)}%
          </span>
        </div>
        <Slider
          value={[value.emotionIntensity]}
          onValueChange={([val]) => update({ emotionIntensity: val })}
          min={0}
          max={1}
          step={0.05}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>淡然</span>
          <span>強烈</span>
        </div>
      </div>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium text-muted-foreground">語速</Label>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {value.speed.toFixed(1)}x
          </span>
        </div>
        <Slider
          value={[value.speed]}
          onValueChange={([val]) => update({ speed: val })}
          min={0.5}
          max={2.0}
          step={0.1}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>0.5x 慢速</span>
          <span>1.0x 正常</span>
          <span>2.0x 快速</span>
        </div>
      </div>

      {/* Stability */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-muted-foreground" />
            <Label className="text-xs font-medium text-muted-foreground">穩定性</Label>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {Math.round(value.stability * 100)}%
          </span>
        </div>
        <Slider
          value={[value.stability]}
          onValueChange={([val]) => update({ stability: val })}
          min={0}
          max={1}
          step={0.05}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground/50">
          <span>多變表現</span>
          <span>穩定一致</span>
        </div>
      </div>
    </div>
  );
}
