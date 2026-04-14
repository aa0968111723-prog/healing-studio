/**
 * ProStudio.tsx — 音樂配音創作室
 *
 * 整合 fal.ai 頂尖音訊 / 語音 / 影片模型
 * 分類：音樂生成 / 音效生成 / 語音合成 / 聲音克隆 / Kling 語音 / 音訊處理 / 語音識別 / AI 形像影片
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Music2, Mic2, Waves, Merge, Repeat2, FileText,
  Sparkles, Download, Loader2, AlertCircle,
  Volume2, Guitar, Headphones, Wand2, Film, Upload,
  UserRound, Zap, Bot, Star, Check, Copy, ExternalLink,
  ChevronDown, ChevronUp, Info, Tag, X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRegisterBgTask } from "@/contexts/BackgroundTasksContext";

// ─── 類型 ────────────────────────────────────────────────────────────────────

interface AudioResult {
  url?: string;
  audio_url?: string;
  audio?: { url: string };
  video_url?: string;
  request_id?: string;
  model?: string;
  [key: string]: unknown;
}

// ─── 子元件：AsyncAudioPoller — 音訊輪詢元件 ─────────────────────────────────

/**
 * 當後端 textToMusic / speechToText 回傳 request_id 時
 * 每 3 秒輪詢 checkAudioStatus，完成後自動顯示 AudioPlayer。
 * 支援超時偵測：超過 10 分鐘自動標記失敗。
 */
function AsyncAudioPoller({ result, onUpdate, label }: {
  result: AudioResult;
  onUpdate: (r: AudioResult) => void;
  label?: string;
}) {
  const modelId = result.model ?? "";
  const audioUrl = result.audio_url ?? (result.audio as any)?.url ?? result.url;
  const [dismissed, setDismissed] = useState(false);
  // 記錄提交時間，用於超時偵測
  const [submittedAt] = useState(() => Date.now());

  const { data, isError, error } = trpc.proStudio.checkAudioStatus.useQuery(
    { requestId: result.request_id ?? "", model: modelId, submittedAt },
    {
      enabled: !!(result.request_id && !audioUrl && modelId),
      refetchInterval: (query) => {
        const s = (query.state.data as any)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );

  useEffect(() => {
    if ((data as any)?.status === "COMPLETED") {
      const newUrl = (data as any)?.audio_url ?? (data as any)?.text;
      if (newUrl) {
        setDismissed(false); // 完成時自動顯示結果
        toast.success(`✅ ${label ?? "音訊"} 生成完成！`);
        onUpdate({ ...result, audio_url: newUrl });
      }
    } else if ((data as any)?.status === "FAILED") {
      toast.error(`❌ ${label ?? "音訊"} 生成失敗`);
    }
  }, [(data as any)?.status, label]);

  if (audioUrl) return <AudioPlayer url={audioUrl as string} label={label} />;

  if (isError) return (
    <div className="mt-4 p-3 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
      <AlertCircle className="w-4 h-4" />
      <span>生成失敗：{(error as any)?.message ?? "請重試"}</span>
    </div>
  );

  // 使用者已關閉等待畫面
  if (dismissed) return null;

  if (result.request_id && !audioUrl) return (
    <div className="mt-4 p-5 rounded-xl bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 flex flex-col items-center gap-2 relative">
      <button onClick={() => setDismissed(true)} className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-accent active:bg-accent/70 transition-colors" title="隱藏等待畫面（背景任務會繼續）">
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
      <div className="text-center">
        <p className="text-sm font-semibold">{label ?? "音訊"} 背景生成中...</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          已轉入背景任務，完成後會自動通知你<br />
          <span className="text-primary/70">你可以關閉此面板繼續其他操作</span>
        </p>
      </div>
    </div>
  );

  return null;
}

// ─── 子元件：音訊播放器 ──────────────────────────────────────────────────────

function AudioPlayer({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/5 to-purple-500/5 border border-primary/20">
      {label && <p className="text-xs text-muted-foreground mb-2 font-medium">{label}</p>}
      <audio controls className="w-full" src={url}>
        <track kind="captions" />
      </audio>
      <a
        href={url}
        download
        className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Download className="w-3 h-3" /> 下載音訊
      </a>
    </div>
  );
}

function VideoPlayer({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/5 to-blue-500/5 border border-primary/20">
      {label && <p className="text-xs text-muted-foreground mb-2 font-medium">{label}</p>}
      <video controls className="w-full rounded-lg max-h-64" src={url}>
        <track kind="captions" />
      </video>
      <a
        href={url}
        download
        className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
      >
        <Download className="w-3 h-3" /> 下載影片
      </a>
    </div>
  );
}

// ─── 子元件：音訊 URL 輸入 ───────────────────────────────────────────────────

function AudioUrlInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "貼上音訊 URL（支援 mp3、wav、flac）"}
        className="text-sm"
      />
    </div>
  );
}

// ─── 子元件：檔案上傳輸入框（支援上傳 + URL 貼上）────────────────────────────

function FileUploadInput({
  label,
  value,
  onChange,
  accept = "audio/*",
  placeholder,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  accept?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = (e.target?.result as string).split(",")[1];
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ fileName: file.name, mimeType: file.type, data: base64 }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "上傳失敗" }));
            toast.error("上傳失敗：" + (err.error ?? `HTTP ${res.status}`));
            return;
          }
          const json = await res.json();
          if (json.url) {
            onChange(json.url);
            toast.success(`✅ 上傳完成：${file.name}`);
          } else {
            toast.error("上傳失敗：" + (json.error ?? "未知錯誤"));
          }
        } catch {
          toast.error("上傳失敗，請檢查網路連線");
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
      toast.error("讀取檔案失敗");
    }
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const isImageAccept = accept.includes("image");
  const defaultPlaceholder = isImageAccept
    ? "貼上圖片 URL，或點右側上傳"
    : "貼上音訊 URL（mp3/wav/flac），或點右側上傳";

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div
        className="flex gap-2 items-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? defaultPlaceholder}
          className="text-sm flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 text-xs px-3 h-9 gap-1.5 border-dashed"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Upload className="w-3.5 h-3.5" />
          }
          {uploading ? "上傳中" : "上傳"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
      </div>
      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
      {value && value.startsWith("http") && (
        <p className="text-[10px] text-emerald-600 truncate">✓ {value}</p>
      )}
    </div>
  );
}

// ─── 音樂風格標籤資料（含中文翻譯）──────────────────────────────────────────

/** 英文標籤 → 中文翻譯對照 */
const TAG_ZH: Record<string, string> = {
  // 曲風
  pop: "流行", rock: "搖滾", jazz: "爵士", classical: "古典", "hip-hop": "嘻哈",
  electronic: "電子", folk: "民謠", country: "鄉村", "R&B": "節奏藍調", metal: "金屬",
  blues: "藍調", reggae: "雷鬼", soul: "靈魂樂", funk: "放克", ambient: "氛圍",
  "lo-fi": "低保真",
  // 樂器
  piano: "鋼琴", guitar: "吉他", violin: "小提琴", drums: "鼓", bass: "貝斯",
  flute: "長笛", cello: "大提琴", trumpet: "小號", synthesizer: "合成器",
  "acoustic guitar": "木吉他", "electric guitar": "電吉他", ukulele: "烏克麗麗",
  // 情緒
  happy: "開心", sad: "悲傷", romantic: "浪漫", energetic: "活力", relaxing: "放鬆",
  dramatic: "戲劇性", mysterious: "神秘", uplifting: "振奮", melancholic: "憂鬱",
  calm: "平靜", tense: "緊張", nostalgic: "懷舊",
  // 節奏
  upbeat: "輕快", slow: "慢速", moderate: "中速", fast: "快速", danceable: "適合跳舞",
  // 調性
  "C major": "C 大調", "G major": "G 大調", "D major": "D 大調",
  "A minor": "A 小調", "E minor": "E 小調", "F major": "F 大調",
  "minor key": "小調", "major key": "大調",
};

const MUSIC_TAG_CATEGORIES = [
  {
    label: "曲風",
    color: "purple",
    tags: ["pop", "rock", "jazz", "classical", "hip-hop", "electronic", "folk", "country", "R&B", "metal", "blues", "reggae", "soul", "funk", "ambient", "lo-fi"],
  },
  {
    label: "樂器",
    color: "blue",
    tags: ["piano", "guitar", "violin", "drums", "bass", "flute", "cello", "trumpet", "synthesizer", "acoustic guitar", "electric guitar", "ukulele"],
  },
  {
    label: "情緒氛圍",
    color: "pink",
    tags: ["happy", "sad", "romantic", "energetic", "relaxing", "dramatic", "mysterious", "uplifting", "melancholic", "calm", "tense", "nostalgic"],
  },
  {
    label: "節奏速度",
    color: "orange",
    tags: ["60bpm", "80bpm", "100bpm", "120bpm", "140bpm", "upbeat", "slow", "moderate", "fast", "danceable"],
  },
  {
    label: "調性",
    color: "green",
    tags: ["C major", "G major", "D major", "A minor", "E minor", "F major", "minor key", "major key"],
  },
];

type TagColor = "purple" | "blue" | "pink" | "orange" | "green";

const TAG_COLOR_MAP: Record<TagColor, string> = {
  purple: "bg-purple-50 hover:bg-purple-100 border-purple-200/60 text-purple-700",
  blue:   "bg-blue-50 hover:bg-blue-100 border-blue-200/60 text-blue-700",
  pink:   "bg-pink-50 hover:bg-pink-100 border-pink-200/60 text-pink-700",
  orange: "bg-orange-50 hover:bg-orange-100 border-orange-200/60 text-orange-700",
  green:  "bg-emerald-50 hover:bg-emerald-100 border-emerald-200/60 text-emerald-700",
};

const TAG_COLOR_ACTIVE_MAP: Record<TagColor, string> = {
  purple: "bg-purple-500 border-purple-500 text-white",
  blue:   "bg-blue-500 border-blue-500 text-white",
  pink:   "bg-pink-500 border-pink-500 text-white",
  orange: "bg-orange-500 border-orange-500 text-white",
  green:  "bg-emerald-500 border-emerald-500 text-white",
};

function MusicTagPicker({ tags, onChange }: { tags: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(
    tags.split(",").map((t) => t.trim()).filter(Boolean)
  );

  const toggle = (tag: string) => {
    const next = new Set(selectedSet);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(Array.from(next).join(", "));
  };

  const selectedCount = selectedSet.size;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground flex items-center gap-1">
          <Tag className="w-3 h-3" />
          風格標籤（逗號分隔）
          {selectedCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">{selectedCount} 個已選</Badge>
          )}
        </Label>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 transition-colors"
        >
          {open ? <><ChevronUp className="w-3 h-3" />收起快選</> : <><ChevronDown className="w-3 h-3" />快速選取</>}
        </button>
      </div>

      {/* 手動輸入 */}
      <Input
        value={tags}
        onChange={(e) => onChange(e.target.value)}
        placeholder="例如：jazz, piano, 120bpm, relaxing, C major"
        className="text-sm"
      />

      {/* 快選面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-muted/30 border border-border/50 space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Info className="w-3 h-3" />
                點擊標籤快速新增，多個標籤會自動合併為逗號分隔格式
              </div>
              {MUSIC_TAG_CATEGORIES.map((cat) => (
                <div key={cat.label}>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1.5">{cat.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {cat.tags.map((tag) => {
                      const isActive = selectedSet.has(tag);
                      const colorKey = cat.color as TagColor;
                      const zhLabel = TAG_ZH[tag];
                      return (
                        <button
                          key={tag}
                          onClick={() => toggle(tag)}
                          className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                            isActive ? TAG_COLOR_ACTIVE_MAP[colorKey] : TAG_COLOR_MAP[colorKey]
                          }`}
                          title={zhLabel ? `${zhLabel} (${tag})` : tag}
                        >
                          {isActive && <span className="mr-0.5">✓</span>}
                          {zhLabel ?? tag}
                          {zhLabel && <span className="ml-0.5 opacity-60 text-[9px]">{tag}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {selectedCount > 0 && (
                <button
                  onClick={() => onChange("")}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  清除全部選取
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 子元件：卡片容器 ─────────────────────────────────────────────────────────

function ToolCard({
  icon: Icon,
  title,
  description,
  badge,
  modelId,
  color = "purple",
  children,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  badge?: string;
  modelId?: string;
  color?: "purple" | "blue" | "green" | "orange" | "pink" | "cyan" | "indigo";
  children: React.ReactNode;
}) {
  const colors = {
    purple: "from-purple-500/10 to-violet-500/5 border-purple-200/50",
    blue:   "from-blue-500/10 to-cyan-500/5 border-blue-200/50",
    green:  "from-emerald-500/10 to-teal-500/5 border-emerald-200/50",
    orange: "from-orange-500/10 to-amber-500/5 border-orange-200/50",
    pink:   "from-pink-500/10 to-rose-500/5 border-pink-200/50",
    cyan:   "from-cyan-500/10 to-sky-500/5 border-cyan-200/50",
    indigo: "from-indigo-500/10 to-blue-500/5 border-indigo-200/50",
  };
  const iconColors = {
    purple: "text-purple-500",
    blue:   "text-blue-500",
    green:  "text-emerald-500",
    orange: "text-orange-500",
    pink:   "text-pink-500",
    cyan:   "text-cyan-500",
    indigo: "text-indigo-500",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-5 bg-gradient-to-br ${colors[color]} border backdrop-blur-sm`}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={`p-2 rounded-xl bg-white/60 shadow-sm ${iconColors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sm text-foreground">{title}</h3>
            {badge && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          {modelId && (
            <a
              href={`https://fal.ai/models/${modelId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-[10px] text-primary/60 hover:text-primary mt-0.5 transition-colors"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              {modelId}
            </a>
          )}
        </div>
      </div>
      {children}
    </motion.div>
  );
}

// ─── 音樂生成 Tab ─────────────────────────────────────────────────────────────

/** 一鍵套用模板 */
const MUSIC_TEMPLATES = [
  { label: "☕ 咖啡廳", desc: "溫暖咖啡廳背景音樂，適合閱讀和聊天", tags: "jazz, piano, calm, 80bpm" },
  { label: "🎬 電影配樂", desc: "科幻電影高潮場景配樂", tags: "electronic, dramatic, tense, 140bpm, synthesizer" },
  { label: "🌅 放鬆冥想", desc: "寧靜的冥想背景音樂，自然環境融合", tags: "ambient, calm, relaxing, slow, piano" },
  { label: "🎉 派對", desc: "輕鬆夏日流行歌曲", tags: "pop, upbeat, happy, guitar, 120bpm, C major" },
  { label: "📚 學習專注", desc: "幫助專注的 Lo-fi 音樂", tags: "lo-fi, calm, piano, 80bpm" },
  { label: "🏃 運動健身", desc: "高能量健身動感音樂", tags: "electronic, energetic, fast, drums, 140bpm" },
];

function MusicTab() {
  const registerBgTask = useRegisterBgTask();
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [tags, setTags] = useState("");
  const [musicModel, setMusicModel] = useState<"sonauto" | "ace-step" | "stable-audio" | "musicgen">("sonauto");
  const [duration, setDuration] = useState(30);
  const [result, setResult] = useState<AudioResult | null>(null);

  // 載入可用模型清單
  const modelsQuery = trpc.proStudio.musicModels.useQuery();
  const models = modelsQuery.data ?? [];

  const mutation = trpc.proStudio.textToMusic.useMutation({
    onSuccess: (data) => {
      setResult(data as AudioResult);
      registerBgTask(data, "audio", "🎵 音樂生成");
      const immediate = (data as any)?.audio_url ?? (data as any)?.url;
      if (immediate) toast.success("🎵 音樂生成完成！");
      else toast.success("📤 任務已提交！稍後自動更新結果...");
    },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const audioUrl = result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;
  const showDuration = musicModel !== "sonauto"; // Sonauto 不支援 duration
  const showLyrics = musicModel === "sonauto" || musicModel === "ace-step"; // 只有支援歌詞的模型才顯示

  const applyTemplate = (t: typeof MUSIC_TEMPLATES[number]) => {
    setPrompt(t.desc);
    setTags(t.tags);
    toast.success(`已套用模板「${t.label}」`);
  };

  return (
    <div className="space-y-4">
      <ToolCard
        icon={Music2}
        title="文字轉音樂"
        description="多模型支援 — 輸入描述，AI 為你作曲"
        badge={models.find(m => m.id === musicModel)?.label ?? "Sonauto v2"}
        modelId={musicModel === "sonauto" ? "sonauto/v2/text-to-music" : `fal-ai/${musicModel}`}
        color="purple"
      >
        <div className="space-y-3">
          {/* 模型選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Bot className="w-3 h-3" />
              選擇模型
              <span className="text-[9px] text-muted-foreground/60 ml-1">（主模型失敗可切換備選）</span>
            </Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {(models.length > 0 ? models : [
                { id: "sonauto", label: "Sonauto v2", description: "完整歌曲生成", badge: "預設", tier: "premium" },
                { id: "ace-step", label: "ACE-Step", description: "高品質音樂", badge: "推薦", tier: "premium" },
                { id: "stable-audio", label: "Stable Audio", description: "音樂/音效", badge: "", tier: "premium" },
                { id: "musicgen", label: "MusicGen", description: "輕量快速", badge: "快速", tier: "standard" },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMusicModel(m.id as typeof musicModel)}
                  className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                    musicModel === m.id
                      ? "bg-purple-50 border-purple-300 ring-1 ring-purple-300"
                      : "bg-background border-border hover:bg-accent"
                  }`}
                >
                  <div className="font-medium flex items-center gap-1">
                    {m.label}
                    {m.badge && <Badge variant="secondary" className="text-[8px] px-1 py-0">{m.badge}</Badge>}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 快速模板 */}
          <div>
            <Label className="text-xs text-muted-foreground">🎯 一鍵套用模板（點擊快速填入）</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {MUSIC_TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => applyTemplate(t)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200/60 text-purple-700 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 音樂描述 */}
          <div>
            <Label className="text-xs text-muted-foreground">
              音樂描述 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：一首輕快的爵士鋼琴曲，帶有活潑的節奏和溫暖的音色，讓人心情愉悅..."
              className="mt-1 text-sm resize-none h-20"
            />
          </div>
          <div className="mt-1">
            <MusicTagPicker tags={tags} onChange={setTags} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={instrumental} onCheckedChange={setInstrumental} id="instrumental" />
            <Label htmlFor="instrumental" className="text-xs text-muted-foreground cursor-pointer">
              純音樂（無人聲）
            </Label>
          </div>
          {!instrumental && showLyrics && (
            <div>
              <Label className="text-xs text-muted-foreground">歌詞（選填）</Label>
              <Textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="輸入歌詞內容（留空讓 AI 自動生成）..."
                className="mt-1 text-sm resize-none h-24"
              />
            </div>
          )}
          {/* 時長控制（非 Sonauto 模型） */}
          {showDuration && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                音樂時長：{duration} 秒（{Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, "0")}）
              </Label>
              <Slider
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                min={5} max={180} step={5}
              />
            </div>
          )}
          {/* Sonauto 注意事項 */}
          {musicModel === "sonauto" && (
            <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/40">
              <p className="text-[10px] text-amber-700">
                ⚡ <strong>Sonauto v2</strong> 自動決定音樂時長（通常 60-180 秒），無法手動指定。
                若需精確時長控制，請在描述中說明（如：「60 秒短曲」）或切換至其他模型。
              </p>
            </div>
          )}
          <Button
            onClick={() => mutation.mutate({
              prompt,
              lyrics: lyrics || undefined,
              instrumental,
              tags: tags || undefined,
              model: musicModel,
              duration: showDuration ? duration : undefined,
            })}
            disabled={mutation.isPending || !prompt.trim()}
            className="w-full"
          >
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />AI 作曲中...</>
              : <><Sparkles className="w-4 h-4 mr-2" />生成音樂</>
            }
          </Button>
        </div>
        {result ? (
          <AsyncAudioPoller result={result} onUpdate={setResult} label="✨ 音樂生成結果" />
        ) : null}
      </ToolCard>

      {/* 使用說明 */}
      <div className="rounded-xl p-4 bg-purple-50/50 border border-purple-200/40 space-y-3">
        <div>
          <p className="text-xs font-medium text-purple-700 mb-1.5">💡 提示詞技巧</p>
          <ul className="space-y-1">
            {[
              "「音樂描述」：用自然語言說明想要的音樂感覺（情境、情緒、場景）",
              "「風格標籤」：點擊「快速選取」選擇曲風/樂器/情緒/節奏/調性（已附中文翻譯）",
              "兩者可同時使用：描述提供脈絡，標籤精確指定音樂特徵",
              "⏱️ 如果主模型（Sonauto）超時或失敗，可切換至 ACE-Step / MusicGen 重試",
            ].map((tip, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] text-purple-600">
                <span className="shrink-0 mt-0.5">•</span>{tip}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-purple-200/40 pt-3">
          <p className="text-[10px] font-medium text-purple-700 mb-1">📝 範例組合</p>
          <div className="space-y-1.5">
            {[
              { desc: "溫暖咖啡廳背景音樂", tags: "jazz, piano, acoustic, warm, 80bpm" },
              { desc: "科幻電影高潮場景配樂", tags: "electronic, dramatic, tense, 140bpm, synthesizer" },
              { desc: "輕鬆夏日流行歌曲", tags: "pop, upbeat, happy, guitar, 120bpm, C major" },
            ].map((ex, i) => (
              <button
                key={i}
                onClick={() => { setPrompt(ex.desc); setTags(ex.tags); }}
                className="w-full p-1.5 rounded bg-purple-100/50 text-[10px] text-purple-700 text-left hover:bg-purple-100 transition-colors cursor-pointer"
              >
                <strong>描述：</strong>{ex.desc}<br />
                <strong>標籤：</strong>{ex.tags}
                <span className="ml-1 text-[9px] text-purple-500">（點擊套用）</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 音效生成 Tab ─────────────────────────────────────────────────────────────

function SoundEffectsTab() {
  const registerBgTask = useRegisterBgTask();
  const [text, setText] = useState("");
  const [duration, setDuration] = useState<number>(10);
  const [useDuration, setUseDuration] = useState(false);
  const [influence, setInfluence] = useState(0.3);
  const [sfxModel, setSfxModel] = useState<"stable-audio" | "audioldm2" | "elevenlabs">("stable-audio");
  const [result, setResult] = useState<AudioResult | null>(null);

  // 載入可用模型清單
  const modelsQuery = trpc.proStudio.sfxModels.useQuery();
  const models = modelsQuery.data ?? [];

  const mutation = trpc.proStudio.soundEffects.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "audio", "🔊 音效生成"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`生成失敗：${e.message}`),
  });

  const audioUrl = result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;
  // ElevenLabs max 22s, others up to 180s
  const maxDuration = sfxModel === "elevenlabs" ? 22 : 180;
  const showInfluence = sfxModel === "elevenlabs"; // 只有 ElevenLabs 支援 prompt_influence

  const examples = [
    "雷雨交加的夜晚，遠處傳來狼嚎聲，樹葉沙沙作響",
    "古老城堡的木門緩緩開啟，發出刺耳的嘎吱聲",
    "太空船引擎啟動，伴隨低沉的轟鳴和電子儀器音效",
    "森林中的鳥鳴聲，溪流潺潺，清晨的寧靜氛圍",
    "繁忙街道上的車流聲，遠處偶爾傳來喇叭聲",
  ];

  return (
    <div className="space-y-4">
      <ToolCard
        icon={Volume2}
        title="AI 音效生成"
        description="環境音效 / Foley 音效 — 文字描述即可生成真實音效"
        badge={models.find(m => m.id === sfxModel)?.label ?? "Stable Audio"}
        modelId={sfxModel === "elevenlabs" ? "fal-ai/elevenlabs/sound-effects/v2" : `fal-ai/${sfxModel}`}
        color="orange"
      >
        <div className="space-y-3">
          {/* 模型選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Bot className="w-3 h-3" />
              選擇模型
            </Label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {(models.length > 0 ? models : [
                { id: "stable-audio", label: "Stable Audio", description: "真實環境音效", badge: "預設", tier: "premium" },
                { id: "audioldm2", label: "AudioLDM 2", description: "自然音效", badge: "", tier: "standard" },
                { id: "elevenlabs", label: "ElevenLabs", description: "備用", badge: "備用", tier: "standard" },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSfxModel(m.id as typeof sfxModel);
                    // 切換模型時調整時長上限
                    if (m.id === "elevenlabs" && duration > 22) setDuration(22);
                  }}
                  className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                    sfxModel === m.id
                      ? "bg-orange-50 border-orange-300 ring-1 ring-orange-300"
                      : "bg-background border-border hover:bg-accent"
                  }`}
                >
                  <div className="font-medium flex items-center gap-1">
                    {m.label}
                    {m.badge && <Badge variant="secondary" className="text-[8px] px-1 py-0">{m.badge}</Badge>}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">{m.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ⚠️ ElevenLabs 警告 */}
          {sfxModel === "elevenlabs" && (
            <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/40">
              <p className="text-[10px] text-amber-700">
                ⚠️ ElevenLabs Sound Effects 對某些描述可能產生「語音配音」而非音效。
                如需純音效，建議使用 <strong>Stable Audio</strong> 或 <strong>AudioLDM 2</strong>。
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">
              音效描述 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={sfxModel === "elevenlabs"
                ? "詳細描述你想要的音效（ElevenLabs 模式，最長 22 秒）..."
                : "詳細描述你想要的音效場景，例如：森林鳥鳴、雷雨聲、機器運轉..."}
              className="mt-1 text-sm resize-none h-20"
            />
          </div>

          {/* 快速範例 */}
          <div>
            <Label className="text-xs text-muted-foreground">快速範例（點擊套用）</Label>
            <div className="mt-1 flex flex-wrap gap-1">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setText(ex)}
                  className="text-[10px] px-2 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 border border-orange-200/60 text-orange-700 transition-colors text-left"
                >
                  {ex.slice(0, 20)}...
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={useDuration} onCheckedChange={setUseDuration} id="useDur" />
            <Label htmlFor="useDur" className="text-xs text-muted-foreground cursor-pointer">
              指定時長（預設自動）
            </Label>
          </div>

          {useDuration && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">時長：{duration} 秒（最長 {maxDuration} 秒）</Label>
              <Slider
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                min={1} max={maxDuration} step={0.5}
              />
            </div>
          )}

          {showInfluence && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                提示詞影響強度：{influence.toFixed(2)}
                <span className="ml-2 text-[10px] text-muted-foreground/60">（越高越貼近描述，越低越有創意）</span>
              </Label>
              <Slider
                value={[influence]}
                onValueChange={([v]) => setInfluence(v)}
                min={0} max={1} step={0.05}
              />
            </div>
          )}
          <Button
            onClick={() => mutation.mutate({
              text,
              duration_seconds: useDuration ? duration : undefined,
              prompt_influence: showInfluence ? influence : undefined,
              model: sfxModel,
            })}
            disabled={mutation.isPending || !text.trim()}
            className="w-full"
          >
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中...</>
              : <><Volume2 className="w-4 h-4 mr-2" />生成音效</>
            }
          </Button>
        </div>
        {result?.request_id && result?.model && !audioUrl && (
          <AsyncAudioPoller result={result} onUpdate={setResult} label="🔊 音效結果" />
        )}
        {audioUrl && <AudioPlayer url={audioUrl as string} label="🔊 音效結果" />}
      </ToolCard>
    </div>
  );
}

// ─── 語音合成 Tab ─────────────────────────────────────────────────────────────

function TTSTab() {
  const registerBgTask = useRegisterBgTask();
  const [engine, setEngine] = useState<"elevenlabs" | "qwen">("elevenlabs");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [speed, setSpeed] = useState(1.0);
  const [result, setResult] = useState<AudioResult | null>(null);

  const elevenMutation = trpc.proStudio.elevenLabsTTS.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "voice", "🎤 ElevenLabs 語音"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`合成失敗：${e.message}`),
  });

  const qwenMutation = trpc.proStudio.qwenTTS.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "voice", "🎤 Qwen 語音"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`合成失敗：${e.message}`),
  });

  const isPending = elevenMutation.isPending || qwenMutation.isPending;
  const audioUrl = result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;

  const handleGenerate = () => {
    setResult(null);
    if (engine === "elevenlabs") {
      elevenMutation.mutate({ text, voice_id: voiceId || undefined, stability, similarity_boost: similarity });
    } else {
      // Qwen3-TTS accepts: text, voice (preset name), language
      // It does NOT support voice_id or speed parameters
      qwenMutation.mutate({ text, voice: voiceId || undefined });
    }
  };

  const elevenVoices = [
    { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "英文女聲・自然沉穩", emoji: "👩" },
    { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi",   desc: "英文女聲・充滿活力", emoji: "💃" },
    { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella",  desc: "英文女聲・柔和溫暖", emoji: "🌸" },
    { id: "ErXwobaYiN019PkySvjV", name: "Antoni", desc: "英文男聲・親切自然", emoji: "👨" },
    { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli",   desc: "英文女聲・年輕清亮", emoji: "✨" },
    { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh",   desc: "英文男聲・低沉磁性", emoji: "🎙️" },
    { id: "pNInz4obpRJjN438Rq59", name: "Adam",  desc: "英文男聲・新聞播報", emoji: "📰" },
    { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam",   desc: "英文男聲・理性穩健", emoji: "🤵" },
  ];

  const qwenVoicePresets = [
    { id: "Chelsie", desc: "女聲・活潑英語", emoji: "🌟", lang: "英文" },
    { id: "Ethan",   desc: "男聲・英語播報", emoji: "🎤", lang: "英文" },
    { id: "Vivian",  desc: "女聲・中文自然", emoji: "🌺", lang: "中文" },
    { id: "Dylan",   desc: "男聲・中文沉穩", emoji: "🎯", lang: "中文" },
  ];

  return (
    <div className="space-y-4">
      <ToolCard
        icon={Mic2}
        title="AI 語音合成 (TTS)"
        description="ElevenLabs Turbo v2.5 / Qwen3-TTS — 自然擬真的 AI 語音"
        color="blue"
      >
        <div className="space-y-3">
          {/* 引擎選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground">引擎選擇</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[
                { id: "elevenlabs" as const, label: "ElevenLabs Turbo v2.5", desc: "英語最佳品質", modelId: "fal-ai/elevenlabs/tts/turbo-v2.5" },
                { id: "qwen" as const, label: "Qwen3-TTS 1.7B", desc: "中文 / 多語言", modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b" },
              ].map(({ id, label, desc, modelId }) => (
                <button
                  key={id}
                  onClick={() => { setEngine(id); setResult(null); }}
                  className={`p-3 rounded-xl border text-left transition-all ${engine === id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <p className="text-xs font-semibold">{label}</p>
                  <p className={`text-[10px] mt-0.5 ${engine === id ? "text-blue-100" : "text-muted-foreground"}`}>{desc}</p>
                  <p className={`text-[9px] mt-0.5 font-mono ${engine === id ? "text-blue-200" : "text-muted-foreground/50"}`}>{modelId}</p>
                </button>
              ))}
            </div>
          </div>

          {/* 合成文字 */}
          <div>
            <Label className="text-xs text-muted-foreground">
              合成文字 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={engine === "elevenlabs"
                ? "輸入英文文字（ElevenLabs 英文效果最佳）..."
                : "輸入中文或其他語言的文字..."
              }
              className="mt-1 text-sm resize-none h-24"
            />
            <p className="text-[10px] text-muted-foreground/60 mt-1">{text.length} / 5000 字元</p>
          </div>

          {/* 語音選擇 */}
          {engine === "elevenlabs" ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">語音選擇（點擊快速套用）</Label>
              {/* ElevenLabs 預設語音快選卡 */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setVoiceId("")}
                  className={`p-2 rounded-lg border text-left transition-all text-xs ${!voiceId ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <span className="mr-1">🎵</span> 預設語音
                  <p className={`text-[9px] mt-0.5 ${!voiceId ? "text-blue-100" : "text-muted-foreground"}`}>系統自動選擇</p>
                </button>
                {elevenVoices.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`p-2 rounded-lg border text-left transition-all ${voiceId === v.id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                  >
                    <span className="mr-1">{v.emoji}</span>
                    <span className="text-xs font-medium">{v.name}</span>
                    <p className={`text-[9px] mt-0.5 ${voiceId === v.id ? "text-blue-100" : "text-muted-foreground"}`}>{v.desc}</p>
                  </button>
                ))}
              </div>
              {/* 自訂 Voice ID 輸入 */}
              <div>
                <Label className="text-xs text-muted-foreground">或輸入自訂 Voice ID</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    placeholder="貼上 ElevenLabs voice_id（例：21m00Tcm4TlvDq8ikWAM）"
                    className="text-xs flex-1"
                  />
                  {voiceId && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setVoiceId("")}>
                      ✕
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  💡 在 <a href="https://elevenlabs.io/voice-library" target="_blank" rel="noopener noreferrer" className="text-primary underline">ElevenLabs Voice Library</a> 可找到更多語音 ID
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Qwen 語音選擇（點擊快速套用）</Label>
              {/* Qwen 預設語音快選 */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setVoiceId("")}
                  className={`p-2 rounded-lg border text-left transition-all text-xs ${!voiceId ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <span className="mr-1">🤖</span> 預設語音
                  <p className={`text-[9px] mt-0.5 ${!voiceId ? "text-blue-100" : "text-muted-foreground"}`}>系統自動決定</p>
                </button>
                {qwenVoicePresets.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`p-2 rounded-lg border text-left transition-all ${voiceId === v.id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                  >
                    <span className="mr-1">{v.emoji}</span>
                    <span className="text-xs font-medium">{v.id}</span>
                    <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">{v.lang}</Badge>
                    <p className={`text-[9px] mt-0.5 ${voiceId === v.id ? "text-blue-100" : "text-muted-foreground"}`}>{v.desc}</p>
                  </button>
                ))}
              </div>
              {/* 手動輸入 */}
              <div>
                <Label className="text-xs text-muted-foreground">或輸入語音名稱</Label>
                <Input
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  placeholder="如：Vivian、Dylan（留空使用預設）"
                  className="mt-1 text-sm"
                />
              </div>
            </div>
          )}

          {/* ElevenLabs 進階設定 */}
          {engine === "elevenlabs" && (
            <div className="space-y-2 p-3 rounded-lg bg-blue-50/40 border border-blue-200/30">
              <p className="text-[10px] font-medium text-blue-700">進階語音設定</p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">穩定性：{stability.toFixed(2)}</Label>
                <Slider value={[stability]} onValueChange={([v]) => setStability(v)} min={0} max={1} step={0.05} />
                <p className="text-[10px] text-muted-foreground/60">低 = 更具表現力，高 = 更穩定一致</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">相似度：{similarity.toFixed(2)}</Label>
                <Slider value={[similarity]} onValueChange={([v]) => setSimilarity(v)} min={0} max={1} step={0.05} />
              </div>
            </div>
          )}

          {/* Qwen 語音說明 */}
          {engine === "qwen" && (
            <div className="p-3 rounded-lg bg-blue-50/40 border border-blue-200/30">
              <p className="text-[10px] text-blue-700 leading-relaxed">
                💡 <strong>Qwen3-TTS</strong> 支援中文、英文、日文等多語言，自動偵測語言。<br />
                • 預設語音為系統自動選擇<br />
                • 語音名稱（如 Vivian、Dylan）為 Qwen 內建的人聲風格<br />
                • <strong>不支援</strong> ElevenLabs voice_id 格式
              </p>
            </div>
          )}

          <Button onClick={handleGenerate} disabled={isPending || !text.trim()} className="w-full">
            {isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />合成中...</>
              : <><Mic2 className="w-4 h-4 mr-2" />合成語音</>
            }
          </Button>
        </div>
        {result?.request_id && result?.model && !audioUrl && (
          <AsyncAudioPoller result={result} onUpdate={setResult} label="🎤 合成結果" />
        )}
        {audioUrl && <AudioPlayer url={audioUrl as string} label="🎤 合成結果" />}
      </ToolCard>
    </div>
  );
}

// ─── 聲音克隆 Tab ─────────────────────────────────────────────────────────────

function CloneTab() {
  const registerBgTask = useRegisterBgTask();
  const [mode, setMode] = useState<"qwen" | "dia" | "design" | "kling">("qwen");
  const [text, setText] = useState("");
  const [refAudio, setRefAudio] = useState("");
  const [refTranscript, setRefTranscript] = useState("");
  const [voiceDesc, setVoiceDesc] = useState("");
  // Kling 專用
  const [klingName, setKlingName] = useState("");
  const [klingResult, setKlingResult] = useState<any>(null);
  const [result, setResult] = useState<AudioResult | null>(null);

  // qwenCloneAndSpeak: clone + TTS in one step (audio_url + text → audio)
  const qwenClone = trpc.proStudio.qwenCloneAndSpeak.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "voice", "🎭 Qwen 聲音克隆"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`克隆失敗：${e.message}`),
  });
  // diaTTSVoiceClone: only accepts { text } — no reference_audio_url
  const diaClone = trpc.proStudio.diaTTSVoiceClone.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "voice", "🎭 Dia 聲音克隆"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`克隆失敗：${e.message}`),
  });
  const voiceDesign = trpc.proStudio.qwenVoiceDesign.useMutation({
    onSuccess: (data) => { setResult(data as AudioResult); registerBgTask(data, "voice", "🎨 語音設計"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`設計失敗：${e.message}`),
  });
  const klingVoice = trpc.proStudio.klingCreateVoice.useMutation({
    onSuccess: (data) => {
      setKlingResult(data);
      registerBgTask(data, "voice", "✅ Kling 語音建立");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
    },
    onError: (e) => toast.error(`Kling 建立失敗：${e.message}`),
  });

  const isPending = qwenClone.isPending || diaClone.isPending || voiceDesign.isPending || klingVoice.isPending;
  const audioUrl = result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;

  const handleGenerate = () => {
    setResult(null);
    setKlingResult(null);
    if (mode === "qwen") {
      // qwenCloneAndSpeak: audio_url = reference, text = what to say
      qwenClone.mutate({ audio_url: refAudio, text, reference_text: refTranscript || undefined });
    } else if (mode === "dia") {
      // diaTTSVoiceClone: only text; supports [S1]/[S2] speaker tags
      diaClone.mutate({ text });
    } else if (mode === "design") {
      voiceDesign.mutate({ voice_description: voiceDesc, text: text || undefined });
    } else {
      klingVoice.mutate({ audio_url: refAudio, name: klingName });
    }
  };

  const modeConfig = [
    { id: "qwen" as const,   label: "Qwen 克隆",    desc: "零次學習克隆",    badge: "Qwen3-TTS" },
    { id: "dia" as const,    label: "Dia 對話克隆",  desc: "多說話者克隆",    badge: "Dia-TTS" },
    { id: "design" as const, label: "語音設計",      desc: "文字描述設計聲音", badge: "Qwen3" },
    { id: "kling" as const,  label: "Kling 語音建立", desc: "用於 Kling 影片", badge: "Kling", special: true },
  ];

  const isKlingDisabled = mode === "kling" && (!refAudio.trim() || !klingName.trim());
  // dia only needs text; qwen needs both audio + text
  const isOtherDisabled = mode === "qwen" && (!text.trim() || !refAudio.trim())
    || mode === "dia" && !text.trim();
  const isDesignDisabled = mode === "design" && !voiceDesc.trim();
  const submitDisabled = isPending || isKlingDisabled || isOtherDisabled || isDesignDisabled;

  return (
    <div className="space-y-4">
      {/* 模式選擇 */}
      <div className="grid grid-cols-2 gap-2">
        {modeConfig.map(({ id, label, desc, badge, special }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setResult(null); setKlingResult(null); }}
            className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
              mode === id
                ? special ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white border-purple-500"
                           : "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-border"
            }`}
          >
            {special && mode === id && (
              <Star className="absolute right-2 top-2 w-3 h-3 text-yellow-300" />
            )}
            <p className="text-xs font-semibold">{label}</p>
            <p className={`text-[10px] mt-0.5 ${mode === id ? "text-white/70" : "text-muted-foreground"}`}>{desc}</p>
            <Badge
              variant={mode === id ? "outline" : "secondary"}
              className={`text-[9px] px-1 py-0 mt-1 ${mode === id ? "border-white/30 text-white/80" : ""}`}
            >
              {badge}
            </Badge>
          </button>
        ))}
      </div>

      <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {/* Qwen / Dia 克隆 */}
        {(mode === "qwen" || mode === "dia") && (
          <ToolCard
            icon={UserRound}
            title={mode === "qwen" ? "Qwen3-TTS 零次聲音克隆" : "Dia TTS 多說話者 TTS"}
            description={mode === "qwen" ? "上傳 3-10 秒參考音訊，AI 克隆聲音後合成語音" : "用 [S1]/[S2] 標籤標注多位說話者，AI 自動分配音色"}
            badge={mode === "qwen" ? "Qwen3 1.7B" : "Dia TTS"}
            modelId={mode === "qwen" ? "fal-ai/qwen-3-tts/clone-voice/1.7b" : "fal-ai/dia-tts/voice-clone"}
            color="pink"
          >
            <div className="space-y-3">
              {/* Qwen 需要參考音訊；Dia 不支援參考音訊 */}
              {mode === "qwen" && (
                <>
                  <FileUploadInput label="參考音訊" value={refAudio} onChange={setRefAudio} required accept="audio/*" placeholder="貼上 3-10 秒高品質音訊（mp3/wav/flac）" hint="建議：安靜環境錄製的清晰人聲，3-10 秒，最大 16MB" />
                  <div>
                    <Label className="text-xs text-muted-foreground">參考音訊文字稿（選填，可提升克隆品質）</Label>
                    <Textarea
                      value={refTranscript}
                      onChange={(e) => setRefTranscript(e.target.value)}
                      placeholder="輸入參考音訊中說的文字（可提升準確度）..."
                      className="mt-1 text-sm resize-none h-14"
                    />
                  </div>
                </>
              )}
              {mode === "dia" && (
                <div className="p-3 rounded-lg bg-pink-50/60 border border-pink-200/40">
                  <p className="text-[11px] text-pink-700 leading-relaxed">
                    💡 <strong>Dia TTS</strong> 不需要參考音訊。<br />
                    用 <code className="bg-pink-100 px-1 rounded">[S1]</code> / <code className="bg-pink-100 px-1 rounded">[S2]</code> 標記不同說話者，AI 會自動分配不同音色。<br />
                    例如：<code className="bg-pink-100 px-1 rounded text-[10px]">[S1] 你好，我是第一位說話者。 [S2] 我是第二位。</code>
                  </p>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">
                  要合成的文字 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={mode === "qwen"
                    ? "輸入要用克隆語音朗讀的文字..."
                    : "[S1] 你好，請問有什麼需要幫助的？ [S2] 我想了解一下你們的服務。"}
                  className="mt-1 text-sm resize-none h-20"
                />
              </div>
              <Button onClick={handleGenerate} disabled={submitDisabled} className="w-full">
                {isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{mode === "qwen" ? "克隆中..." : "合成中..."}</>
                  : <><Wand2 className="w-4 h-4 mr-2" />{mode === "qwen" ? "克隆並合成語音" : "合成多說話者語音"}</>
                }
              </Button>
            </div>
            {result?.request_id && result?.model && !audioUrl && (
              <AsyncAudioPoller result={result as AudioResult} onUpdate={setResult} label="🎭 合成結果" />
            )}
            {audioUrl && <AudioPlayer url={audioUrl as string} label="🎭 合成結果" />}
          </ToolCard>
        )}

        {/* 語音設計 */}
        {mode === "design" && (
          <ToolCard
            icon={Bot}
            title="Qwen3 語音設計"
            description="用文字描述你想要的聲音，AI 自動生成對應的語音特徵"
            badge="Qwen3 1.7B"
            modelId="fal-ai/qwen-3-tts/voice-design/1.7b"
            color="purple"
          >
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  語音特徵描述 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={voiceDesc}
                  onChange={(e) => setVoiceDesc(e.target.value)}
                  placeholder="例如：一位成熟穩重的中年男性，帶有輕微的低沉嗓音，說話速度適中，充滿磁性的音色，帶點廣播主播的感覺..."
                  className="mt-1 text-sm resize-none h-24"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">測試文字（選填）</Label>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="你好，我是你設計的聲音，歡迎使用 AI Director 音樂配音創作室。"
                  className="mt-1 text-sm"
                />
              </div>
              <Button onClick={handleGenerate} disabled={submitDisabled} className="w-full">
                {isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />設計中...</>
                  : <><Sparkles className="w-4 h-4 mr-2" />設計語音</>
                }
              </Button>
            </div>
            {result?.request_id && result?.model && !audioUrl && (
              <AsyncAudioPoller result={result as AudioResult} onUpdate={setResult} label="🎨 設計結果" />
            )}
            {audioUrl && <AudioPlayer url={audioUrl as string} label="🎨 設計結果" />}
          </ToolCard>
        )}

        {/* Kling 語音建立 */}
        {mode === "kling" && (
          <ToolCard
            icon={Star}
            title="Kling 語音建立"
            description="建立可與 Kling 影片模型搭配使用的語音配置檔，用於 AI 說話人影片"
            badge="Kling Video"
            modelId="fal-ai/kling-video/create-voice"
            color="indigo"
          >
            <div className="space-y-3">
              {/* 使用說明 */}
              <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200/40">
                <p className="text-xs font-medium text-indigo-700 mb-1">📋 用途說明</p>
                <p className="text-[11px] text-indigo-600 leading-relaxed">
                  此功能建立「語音配置」供 Kling 影片生成使用。上傳 3-30 秒的清晰人聲音訊，
                  建立後可在 Kling 的影片生成中指定此語音 ID，讓 AI 影片角色用你的聲音說話。
                </p>
              </div>

              <FileUploadInput
                label="音訊來源"
                value={refAudio}
                onChange={setRefAudio}
                required
                accept="audio/*"
                placeholder="貼上 3-30 秒清晰人聲音訊（建議 wav/mp3）"
                hint="需有乾淨的人聲，建議 16kHz 以上，無背景音樂，最大 16MB"
              />

              <div>
                <Label className="text-xs text-muted-foreground">
                  語音名稱 <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={klingName}
                  onChange={(e) => setKlingName(e.target.value)}
                  placeholder="例如：旁白女聲、主角男聲、客服語音..."
                  className="mt-1 text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">建議使用有意義的名稱方便日後識別</p>
              </div>

              {/* 音訊品質建議 */}
              <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200/40">
                <p className="text-[11px] font-medium text-amber-700 mb-1">⚠️ 音訊品質要求</p>
                <ul className="space-y-0.5">
                  {[
                    "長度：3 ~ 30 秒",
                    "環境：安靜無雜音，盡量無背景音樂",
                    "格式：WAV（推薦）/ MP3 / FLAC",
                    "取樣率：建議 16kHz 以上",
                  ].map((t, i) => (
                    <li key={i} className="flex gap-1 text-[10px] text-amber-600">
                      <span>•</span>{t}
                    </li>
                  ))}
                </ul>
              </div>

              <Button onClick={handleGenerate} disabled={submitDisabled} className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700">
                {isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />建立 Kling 語音中...</>
                  : <><Star className="w-4 h-4 mr-2" />建立 Kling 語音</>
                }
              </Button>
            </div>

            {/* Kling 結果 — 背景任務輪詢 */}
            {klingResult?.request_id && klingResult?.model && !klingResult?.voice_id && (
              <AsyncAudioPoller result={klingResult as AudioResult} onUpdate={(r) => setKlingResult(r)} label="✅ Kling 語音建立" />
            )}
            {klingResult && klingResult.voice_id && (
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/50">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <p className="text-sm font-medium text-foreground">Kling 語音建立成功！</p>
                </div>
                <div className="space-y-2">
                  {klingResult.voice_id && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">語音 ID（複製後用於 Kling 影片生成）</p>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-xs bg-white/60 px-2 py-1 rounded border font-mono truncate">
                          {klingResult.voice_id}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => { navigator.clipboard.writeText(klingResult.voice_id); toast.success("已複製語音 ID"); }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {klingResult.name && (
                    <p className="text-xs text-muted-foreground">名稱：<span className="text-foreground">{klingResult.name}</span></p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    💡 在「AI 形像影片」→「Kling 說話人」中使用此語音 ID 生成說話影片
                  </p>
                </div>
              </div>
            )}
          </ToolCard>
        )}
      </motion.div>
    </div>
  );
}

// ─── 音訊處理 Tab ─────────────────────────────────────────────────────────────

function ProcessTab() {
  const registerBgTask = useRegisterBgTask();
  const [tool, setTool] = useState<"demucs" | "isolation" | "merge" | "changer">("demucs");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioUrls, setAudioUrls] = useState(["", ""]);
  const [mergeStrategy, setMergeStrategy] = useState<"concatenate" | "mix">("concatenate");
  const [demucsModel, setDemucsModel] = useState("htdemucs_ft");
  const [voiceId, setVoiceId] = useState("");
  const [removeBgNoise, setRemoveBgNoise] = useState(false);
  const [result, setResult] = useState<any>(null);

  const demucsMut = trpc.proStudio.demucs.useMutation({
    onSuccess: (data) => { setResult(data); registerBgTask(data, "audio", "🎸 音幹分離"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`失敗：${e.message}`),
  });
  const isoMut = trpc.proStudio.audioIsolation.useMutation({
    onSuccess: (data) => { setResult(data); registerBgTask(data, "audio", "🔇 音訊隔離"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`失敗：${e.message}`),
  });
  const mergeMut = trpc.proStudio.mergeAudios.useMutation({
    onSuccess: (data) => { setResult(data); registerBgTask(data, "audio", "🔗 音訊合併"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`失敗：${e.message}`),
  });
  const changerMut = trpc.proStudio.voiceChanger.useMutation({
    onSuccess: (data) => { setResult(data); registerBgTask(data, "voice", "🔁 聲音變換"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`失敗：${e.message}`),
  });

  const isPending = demucsMut.isPending || isoMut.isPending || mergeMut.isPending || changerMut.isPending;

  const toolConfig = {
    demucs:    { icon: Guitar,     label: "音幹分離",     subLabel: "Demucs",      desc: "AI 分離人聲、鼓、貝斯、吉他等獨立音幹", color: "green" as const },
    isolation: { icon: Headphones, label: "音訊隔離",     subLabel: "ElevenLabs",  desc: "智慧去除背景噪音，提取清晰人聲", color: "cyan" as const },
    merge:     { icon: Merge,      label: "多音訊合併",   subLabel: "FFmpeg API",  desc: "將多個音訊串接（拼接）或混音（疊加）", color: "orange" as const },
    changer:   { icon: Repeat2,    label: "聲音變換",     subLabel: "ElevenLabs",  desc: "將音訊中的聲音更換為指定的 ElevenLabs 語音", color: "blue" as const },
  };

  const cfg = toolConfig[tool];

  const handleProcess = () => {
    setResult(null);
    if (tool === "demucs")    demucsMut.mutate({ audio_url: audioUrl, model: demucsModel as any });
    else if (tool === "isolation") isoMut.mutate({ audio_url: audioUrl });
    else if (tool === "merge") mergeMut.mutate({ audio_urls: audioUrls.filter(Boolean), merge_strategy: mergeStrategy });
    else changerMut.mutate({ audio_url: audioUrl, voice_id: voiceId, remove_background_noise: removeBgNoise });
  };

  const outputAudio = result?.audio_url ?? result?.audio?.url ?? result?.url;
  const stems = result?.stems;

  const isMergeDisabled = tool === "merge" && audioUrls.filter(Boolean).length < 2;
  const isChangerDisabled = tool === "changer" && (!audioUrl.trim() || !voiceId.trim());
  const isOtherDisabled = tool !== "merge" && tool !== "changer" && !audioUrl.trim();
  const submitDisabled = isPending || isMergeDisabled || isChangerDisabled || isOtherDisabled;

  return (
    <div className="space-y-4">
      {/* 工具選擇 */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(toolConfig) as Array<keyof typeof toolConfig>).map((k) => {
          const { icon: Ic, label, subLabel } = toolConfig[k];
          return (
            <button
              key={k}
              onClick={() => { setTool(k); setResult(null); }}
              className={`p-3 rounded-xl border text-left transition-all ${tool === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Ic className="w-3.5 h-3.5" />
                <p className="text-xs font-semibold">{label}</p>
              </div>
              <p className={`text-[10px] ${tool === k ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{subLabel}</p>
            </button>
          );
        })}
      </div>

      <motion.div key={tool} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <ToolCard
          icon={cfg.icon}
          title={`${cfg.label}（${cfg.subLabel}）`}
          description={cfg.desc}
          modelId={
            tool === "demucs"    ? "fal-ai/demucs" :
            tool === "isolation" ? "fal-ai/elevenlabs/audio-isolation" :
            tool === "merge"     ? "fal-ai/ffmpeg-api/merge-audios" :
                                   "fal-ai/elevenlabs/voice-changer"
          }
          color={cfg.color}
        >
          <div className="space-y-3">
            {/* 音訊輸入 */}
            {tool !== "merge" ? (
              <FileUploadInput label="音訊" value={audioUrl} onChange={setAudioUrl} required accept="audio/*" hint="支援 mp3、wav、flac，最大 16MB" />
            ) : (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">音訊列表（最少 2 個）<span className="text-destructive ml-0.5">*</span></Label>
                {audioUrls.map((u, i) => (
                  <div key={i} className="space-y-1">
                    <FileUploadInput
                      label={`音訊 ${i + 1}`}
                      value={u}
                      onChange={(v) => { const next = [...audioUrls]; next[i] = v; setAudioUrls(next); }}
                      accept="audio/*"
                    />
                    {i > 1 && (
                      <Button variant="ghost" size="sm" className="text-xs text-destructive h-6 px-2" onClick={() => setAudioUrls(audioUrls.filter((_, j) => j !== i))}>
                        移除此音訊
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="text-xs w-full" onClick={() => setAudioUrls([...audioUrls, ""])}>
                  + 新增音訊
                </Button>
              </div>
            )}

            {/* Demucs 設定 */}
            {tool === "demucs" && (
              <div>
                <Label className="text-xs text-muted-foreground">分離模型</Label>
                <Select value={demucsModel} onValueChange={setDemucsModel}>
                  <SelectTrigger className="mt-1 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="htdemucs_ft">htdemucs_ft — 最高品質（推薦）</SelectItem>
                    <SelectItem value="htdemucs">htdemucs — 標準（4 音幹）</SelectItem>
                    <SelectItem value="htdemucs_6s">htdemucs_6s — 6 音幹（含琴、鋼琴）</SelectItem>
                    <SelectItem value="mdx">MDX — 競賽版</SelectItem>
                    <SelectItem value="mdx_extra">MDX Extra — 競賽增強版</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Merge 設定 */}
            {tool === "merge" && (
              <div>
                <Label className="text-xs text-muted-foreground">合併方式</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    variant={mergeStrategy === "concatenate" ? "default" : "outline"}
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => setMergeStrategy("concatenate")}
                  >
                    串接（依序拼接）
                  </Button>
                  <Button
                    variant={mergeStrategy === "mix" ? "default" : "outline"}
                    size="sm"
                    className="text-xs flex-1"
                    onClick={() => setMergeStrategy("mix")}
                  >
                    混音（疊加播放）
                  </Button>
                </div>
              </div>
            )}

            {/* Voice Changer 設定 */}
            {tool === "changer" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">目標語音 ID <span className="text-destructive">*</span></Label>
                  {/* 快選 */}
                  <div className="mt-1 flex flex-wrap gap-1 mb-2">
                    {[
                      { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel 女聲" },
                      { id: "ErXwobaYiN019PkySvjV", label: "Antoni 男聲" },
                      { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh 男聲" },
                      { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella 女聲" },
                    ].map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setVoiceId(v.id)}
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${voiceId === v.id ? "bg-blue-500 text-white border-blue-500" : "bg-blue-50 hover:bg-blue-100 border-blue-200/60 text-blue-700"}`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    placeholder="或貼上自訂 ElevenLabs voice_id"
                    className="text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">💡 點擊上方快選，或到 <a href="https://elevenlabs.io/voice-library" target="_blank" rel="noopener noreferrer" className="text-primary underline">Voice Library</a> 取得更多</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={removeBgNoise} onCheckedChange={setRemoveBgNoise} id="rmBg" />
                  <Label htmlFor="rmBg" className="text-xs text-muted-foreground cursor-pointer">
                    變換前去除背景噪音
                  </Label>
                </div>
              </>
            )}

            <Button onClick={handleProcess} disabled={submitDisabled} className="w-full">
              {isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />處理中（可能需要 30-120 秒）...</>
                : <><Zap className="w-4 h-4 mr-2" />開始處理</>
              }
            </Button>
          </div>

          {/* 輸出結果 */}
          {result?.request_id && result?.model && !outputAudio && !stems && (
            <AsyncAudioPoller result={result as AudioResult} onUpdate={setResult} label={`✅ ${cfg.label}結果`} />
          )}
          {outputAudio && <AudioPlayer url={outputAudio} label="✅ 處理結果" />}
          {stems && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">🎸 分離音幹：</p>
              {Object.entries(stems as Record<string, string>).map(([stem, url]) => (
                <AudioPlayer key={stem} url={url} label={`音幹：${stem}`} />
              ))}
            </div>
          )}
        </ToolCard>
      </motion.div>
    </div>
  );
}

// ─── 語音識別 Tab ─────────────────────────────────────────────────────────────

function ASRTab() {
  const registerBgTask = useRegisterBgTask();
  const [audioUrl, setAudioUrl] = useState("");
  const [acceleration, setAcceleration] = useState<"none" | "low" | "medium" | "high">("none");
  const [result, setResult] = useState<any>(null);

  const mutation = trpc.proStudio.speechToText.useMutation({
    onSuccess: (data) => { setResult(data); registerBgTask(data, "audio", "📝 語音識別"); toast.success("📤 任務已提交！背景生成中，完成後會自動通知你"); },
    onError: (e) => toast.error(`失敗：${e.message}`),
  });

  const text = result?.text ?? result?.transcript ?? result?.transcription;

  return (
    <div className="space-y-4">
      <ToolCard
        icon={FileText}
        title="語音轉文字 (ASR)"
        description="Nemotron ASR — NVIDIA 高速精準語音識別，支援多語言"
        badge="Nemotron"
        modelId="fal-ai/nemotron/asr/stream"
        color="green"
      >
        <div className="space-y-3">
          <FileUploadInput label="音訊" value={audioUrl} onChange={setAudioUrl} required accept="audio/*" hint="支援 mp3、wav、flac、m4a 等格式，最大 16MB" />

          {/* Nemotron ASR 自動偵測語言，不支援 language/task 參數 */}
          <div className="p-3 rounded-lg bg-green-50/50 border border-green-200/40">
            <p className="text-[11px] text-green-700">
              💡 Nemotron ASR <strong>自動偵測語言</strong>（支援中文、英文、日文等），無需手動選擇。
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">加速模式</Label>
            <Select value={acceleration} onValueChange={(v) => setAcceleration(v as any)}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">標準（最高準確度）</SelectItem>
                <SelectItem value="low">低加速</SelectItem>
                <SelectItem value="medium">中等加速</SelectItem>
                <SelectItem value="high">高加速（最快）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground/60 mt-1">加速越高速度越快，但準確度略低</p>
          </div>

          <Button
            onClick={() => mutation.mutate({ audio_url: audioUrl, acceleration })}
            disabled={mutation.isPending || !audioUrl.trim()}
            className="w-full"
          >
            {mutation.isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />識別中...</>
              : <><FileText className="w-4 h-4 mr-2" />開始識別</>
            }
          </Button>
        </div>

        {text && (
          <div className="mt-4 p-3 rounded-xl bg-white/60 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground font-medium">📝 識別結果：</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => { navigator.clipboard.writeText(text); toast.success("已複製"); }}
              >
                <Copy className="w-3 h-3 mr-1" /> 複製
              </Button>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</p>
          </div>
        )}
      </ToolCard>
    </div>
  );
}

// ─── AI 形像影片 Tab ──────────────────────────────────────────────────────────

function AvatarVideoTab() {
  const registerBgTask = useRegisterBgTask();
  const [model, setModel] = useState<"wan" | "echo" | "stable" | "longcat" | "ltx" | "dubbing">("echo");
  const [imageUrl, setImageUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [jobInfo, setJobInfo] = useState<{ request_id: string; model: string } | null>(null);

  const modelConfig = {
    wan:     { label: "Wan 說話人",       desc: "圖片＋音訊 → 說話影片｜需：圖片＋音訊",   badge: "Wan 14B",    color: "purple" as const },
    echo:    { label: "EchoMimic V3",    desc: "形像驅動｜需：圖片（音訊/文字選填）",       badge: "EchoMimic",  color: "blue" as const },
    stable:  { label: "Stable Avatar",  desc: "音訊驅動頭像，最長 5 分鐘｜需：圖片＋音訊", badge: "Stable",     color: "green" as const },
    longcat: { label: "LongCat Avatar", desc: "超逼真唇形同步｜需：圖片＋音訊",            badge: "LongCat",    color: "orange" as const },
    ltx:     { label: "LTX-2 音訊→影片", desc: "音訊＋文字生成影片｜需：提示詞＋音訊",    badge: "LTX-2 19B",  color: "cyan" as const },
    dubbing: { label: "ElevenLabs 配音", desc: "AI 翻譯配音｜需：影片或音訊 URL",           badge: "Dubbing",    color: "pink" as const },
  };

  const modelIds: Record<string, string> = {
    wan:     "fal-ai/wan/v2.2-14b/speech-to-video",
    echo:    "fal-ai/echomimic-v3",
    stable:  "fal-ai/stable-avatar",
    longcat: "fal-ai/longcat-single-avatar/audio-to-video",
    ltx:     "fal-ai/ltx-2-19b/distilled/audio-to-video/lora",
    dubbing: "fal-ai/elevenlabs/dubbing",
  };

  const wanMut      = trpc.proStudio.speechToVideo.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 Wan 說話人"); toast.success("🎬 任務已提交！"); }, onError: (e) => toast.error(e.message) });
  const echoMut     = trpc.proStudio.echoMimic.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 EchoMimic"); toast.success("🎬 任務已提交！"); }, onError: (e) => toast.error(e.message) });
  const stableMut   = trpc.proStudio.stableAvatar.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 Stable Avatar"); toast.success("🎬 任務已提交！"); }, onError: (e) => toast.error(e.message) });
  const longcatMut  = trpc.proStudio.longcatAvatar.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 LongCat Avatar"); toast.success("🎬 任務已提交！"); }, onError: (e) => toast.error(e.message) });
  const ltxMut      = trpc.proStudio.ltxAudioToVideo.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 LTX 音訊→影片"); toast.success("🎬 任務已提交！"); }, onError: (e) => toast.error(e.message) });
  const dubbingMut  = trpc.proStudio.dubbing.useMutation({ onSuccess: (d) => { setJobInfo(d); registerBgTask(d, "video", "🎬 ElevenLabs 配音"); toast.success("🎬 配音任務已提交！"); }, onError: (e) => toast.error(e.message) });

  const statusQuery = trpc.proStudio.jobStatus.useQuery(
    { request_id: jobInfo?.request_id ?? "", model: jobInfo?.model ?? "" },
    { enabled: !!jobInfo && !!jobInfo.request_id, refetchInterval: 3000 }
  );

  const isPending = wanMut.isPending || echoMut.isPending || stableMut.isPending || longcatMut.isPending || ltxMut.isPending || dubbingMut.isPending;
  const jobStatus = (statusQuery.data as any)?.status;
  const videoResult = (statusQuery.data as any)?.output?.video_url;

  // 每個模型的必填欄位驗證
  const isGenerateDisabled = isPending || (() => {
    if (model === "wan")     return !imageUrl.trim() || !audioUrl.trim();
    if (model === "echo")    return !imageUrl.trim();
    if (model === "stable")  return !imageUrl.trim() || !audioUrl.trim();
    if (model === "longcat") return !imageUrl.trim() || !audioUrl.trim();
    if (model === "ltx")     return !prompt.trim() || !audioUrl.trim();
    if (model === "dubbing") return !videoUrl.trim() && !audioUrl.trim();
    return false;
  })();

  const handleGenerate = () => {
    setJobInfo(null);
    if (model === "wan")     wanMut.mutate({ image_url: imageUrl, audio_url: audioUrl, prompt: prompt || undefined });
    if (model === "echo")    echoMut.mutate({ image_url: imageUrl, audio_url: audioUrl || undefined, text: prompt || undefined });
    if (model === "stable")  stableMut.mutate({ image_url: imageUrl, audio_url: audioUrl });
    if (model === "longcat") longcatMut.mutate({ image_url: imageUrl, audio_url: audioUrl, prompt: prompt || undefined });
    if (model === "ltx")     ltxMut.mutate({ prompt, audio_url: audioUrl, image_url: imageUrl || undefined });
    if (model === "dubbing") dubbingMut.mutate({ video_url: videoUrl || undefined, audio_url: audioUrl || undefined, target_language: targetLang });
  };

  const cfg = modelConfig[model];

  return (
    <div className="space-y-4">
      {/* 模型選擇 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(Object.keys(modelConfig) as Array<keyof typeof modelConfig>).map((k) => (
          <button
            key={k}
            onClick={() => { setModel(k); setJobInfo(null); }}
            className={`p-3 rounded-xl border text-left transition-all ${model === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"}`}
          >
            <p className="text-[11px] font-semibold leading-tight">{modelConfig[k].label}</p>
            <Badge
              variant={model === k ? "outline" : "secondary"}
              className={`text-[9px] px-1 py-0 mt-1 ${model === k ? "border-white/30 text-white/80" : ""}`}
            >
              {modelConfig[k].badge}
            </Badge>
          </button>
        ))}
      </div>

      <motion.div key={model} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <ToolCard
          icon={Film}
          title={cfg.label}
          description={cfg.desc}
          badge={cfg.badge}
          modelId={modelIds[model]}
          color={cfg.color}
        >
          <div className="space-y-3">
            {/* 圖片輸入 */}
            {model !== "dubbing" && model !== "ltx" && (
              <FileUploadInput
                label="人物圖片（頭像）"
                value={imageUrl}
                onChange={setImageUrl}
                required
                accept="image/*"
                placeholder="貼上人物圖片 URL（建議正面照）"
                hint="建議：清晰正面照，人臉居中，jpg/png，最大 16MB"
              />
            )}

            {/* 音訊輸入 */}
            {model !== "dubbing" && (
              <FileUploadInput
                label={`驅動音訊${model === "echo" ? "（選填，也可用文字驅動）" : ""}`}
                value={audioUrl}
                onChange={setAudioUrl}
                required={model !== "echo"}
                accept="audio/*"
                hint={model === "echo" ? "EchoMimic V3：可選填音訊或在下方輸入文字提示詞" : "支援 mp3、wav，最大 16MB"}
              />
            )}

            {/* Dubbing 特殊輸入 */}
            {model === "dubbing" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">影片 URL（與音訊二選一）</Label>
                  <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="貼上影片 URL（mp4）" className="mt-1 text-sm" />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">影片格式：mp4，ElevenLabs Dubbing 僅接受 URL（不支援直接上傳）</p>
                </div>
                <FileUploadInput label="音訊（與影片二選一）" value={audioUrl} onChange={setAudioUrl} accept="audio/*" hint="支援 mp3、wav，最大 16MB" />
                <div>
                  <Label className="text-xs text-muted-foreground">目標語言</Label>
                  <Select value={targetLang} onValueChange={setTargetLang}>
                    <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="ko">한국어</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                      <SelectItem value="de">Deutsch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Prompt 輸入 */}
            {(model === "wan" || model === "echo" || model === "longcat" || model === "ltx") && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  提示詞{model === "ltx" ? <span className="text-destructive ml-0.5">*</span> : "（選填）"}
                </Label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={model === "ltx" ? "描述影片場景、風格..." : "描述想要的動作、表情、場景..."}
                  className="mt-1 text-sm resize-none h-16"
                />
              </div>
            )}

            <Button onClick={handleGenerate} disabled={isGenerateDisabled} className="w-full">
              {isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />提交中（非同步，1-5 分鐘）...</>
                : <><Film className="w-4 h-4 mr-2" />生成影片（非同步）</>
              }
            </Button>
            {isGenerateDisabled && !isPending && (
              <p className="text-[10px] text-amber-600 text-center">
                {model === "ltx" ? "⚠️ 請填寫提示詞和音訊" :
                 model === "dubbing" ? "⚠️ 請提供影片或音訊 URL" :
                 model === "echo" ? "⚠️ 請提供人物圖片" :
                 "⚠️ 請填寫圖片和音訊"}
              </p>
            )}
          </div>

          {/* 任務狀態 */}
          {jobInfo && (
            <div className="mt-4 p-3 rounded-xl bg-white/60 border border-border/50 space-y-2">
              <div className="flex items-center gap-2">
                {jobStatus === "COMPLETED" ? (
                  <Badge className="bg-emerald-500 text-white">✓ 完成</Badge>
                ) : jobStatus === "FAILED" ? (
                  <Badge variant="destructive">✕ 失敗</Badge>
                ) : (
                  <><Loader2 className="w-3 h-3 animate-spin text-primary" /><Badge variant="secondary">{jobStatus ?? "處理中..."}</Badge></>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate">ID: {jobInfo.request_id}</p>
              {videoResult && <VideoPlayer url={videoResult} label="🎬 生成影片" />}
            </div>
          )}
        </ToolCard>
      </motion.div>

      {/* 說明 */}
      <div className="rounded-xl p-3 bg-blue-50/50 border border-blue-200/40">
        <p className="text-[11px] text-blue-700">
          💡 影片生成為非同步任務，提交後系統每 3 秒自動查詢狀態，完成後自動顯示結果。
          通常需要 1-5 分鐘，請耐心等候。
        </p>
      </div>
    </div>
  );
}

// ─── 主頁面 ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: "music",   label: "音樂生成",    icon: Music2,    component: MusicTab },
  { id: "sfx",     label: "音效生成",    icon: Volume2,   component: SoundEffectsTab },
  { id: "tts",     label: "語音合成",    icon: Mic2,      component: TTSTab },
  { id: "clone",   label: "聲音克隆",    icon: UserRound, component: CloneTab },
  { id: "process", label: "音訊處理",    icon: Waves,     component: ProcessTab },
  { id: "asr",     label: "語音識別",    icon: FileText,  component: ASRTab },
  { id: "avatar",  label: "AI 形像影片", icon: Film,      component: AvatarVideoTab },
];

export default function ProStudio() {
  // 全站新手引導
  usePageTour("pro-studio");

  // ── AI Agent Integration ──
  const { aiState, setPageContext, personality } = useAIState();

  const [tab, setTab] = useState("music");
  const apiKeyQuery = trpc.proStudio.checkApiKey.useQuery();
  const hasKey = apiKeyQuery.data?.configured;

  const ActiveTab = TABS.find((t) => t.id === tab)?.component ?? MusicTab;

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({ pageId: "pro-studio", pageLabel: "音樂配音創作室", activeTab: tab });
    return () => setPageContext(null);
  }, [tab, setPageContext]);

  return (
    <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6">
      {/* 標題 */}
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-500 to-violet-600 shadow-lg shrink-0">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground">音樂配音創作室</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            音樂創作・配音制作・聲音克隆・AI 形像影片 — fal.ai 頂尖模型整合
          </p>
        </div>
        <VisualSoul size="sm" state={aiState} personality={personality} className="!w-7 !h-7 shrink-0 mt-1" />
        {hasKey === false && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs font-medium whitespace-nowrap">需設定 FAL_API_KEY</span>
          </div>
        )}
      </div>

      {/* API Key 提示 */}
      {hasKey === false && (
        <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/60">
          <p className="text-sm font-medium text-amber-800 mb-1">⚙️ 需要設定 FAL_API_KEY</p>
          <p className="text-xs text-amber-700 mb-2">
            音樂配音創作室的所有功能均需要 fal.ai API Key 才能使用。
          </p>
          <a
            href="https://fal.ai/dashboard/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-amber-800 font-medium underline hover:text-amber-900"
          >
            <ExternalLink className="w-3 h-3" />
            前往 fal.ai 取得 API Key
          </a>
          <p className="text-[10px] text-amber-600 mt-2 font-mono">
            Railway → Environment Variables → FAL_API_KEY = 你的 Key
          </p>
        </div>
      )}

      {/* Tab 選擇 */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar -mx-1 px-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-xl whitespace-nowrap text-xs font-medium transition-all border shrink-0 min-h-[44px] ${
              tab === id
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background text-muted-foreground hover:bg-accent active:bg-accent border-border"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 活躍 Tab 內容 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          <ActiveTab />
        </motion.div>
      </AnimatePresence>

      {/* 底部說明 */}
      <div className="text-center py-4 border-t border-border/40">
        <p className="text-[11px] text-muted-foreground/60">
          Powered by fal.ai · ElevenLabs · Sonauto · Qwen · Kling · LTX
        </p>
      </div>
    </div>
  );
}
