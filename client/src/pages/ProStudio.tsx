/**
 * ProStudio.tsx — 音樂配音創作室
 *
 * 整合 fal.ai 頂尖音訊 / 語音 / 影片模型
 * 分類：音樂生成 / 音效生成 / 語音合成 / 聲音克隆 / Kling 語音 / 音訊處理 / 語音識別 / AI 形像影片
 */

import { useState, useRef, useCallback, useEffect, createContext, useContext, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { WorldContextSidebar } from "@/components/WorldContextSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";
import {
  Music2,
  Mic2,
  Waves,
  Merge,
  Repeat2,
  FileText,
  Sparkles,
  Download,
  Loader2,
  AlertCircle,
  Volume2,
  Guitar,
  Headphones,
  Wand2,
  Film,
  Upload,
  UserRound,
  Zap,
  Bot,
  Star,
  Check,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
  Tag,
  X,
  Search,
  Package,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRegisterBgTask } from "@/contexts/BackgroundTasksContext";
import { normalizeEngineModelId } from "@shared/engineModelIds";
import { useAssetsDrawer } from "@/contexts/AssetsDrawerContext";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/layout/PageHeader";
import { NextStepPanel } from "@/components/layout/NextStepPanel";
import { getVisualDensity, shouldShowAdvanced } from "@/lib/visualDensity";

// ─── Agent Bridge：讓光球代理人能深度控制各分頁參數 ─────────────────────────────

/**
 * 各分頁透過此介面向父層「註冊」自己的 state + setters，
 * 讓光球代理人（PageAgent）能在對話中直接操作參數。
 */
interface ProStudioAgentBridge {
  /** 填入主要文字輸入（prompt / text） */
  fillPrompt?: (text: string) => void;
  /** 設定參數 key=value */
  setParam?: (key: string, value: string) => boolean;
  /** 取得當前分頁的快照狀態 */
  getState?: () => Record<string, unknown>;
  /** 送出生成 */
  submit?: () => boolean;
  /** 切換模型（由 PRO_MODEL id 對應到分頁內部 model key） */
  setModel?: (modelId: string) => boolean;
  /** 清空當前分頁的所有輸入 */
  reset?: () => void;
}

/**
 * 音訊「氛圍預設」— 光球助手 applyPreset 對應的內建套組。
 * 每個 preset 一次填好 model + prompt + 主要參數，讓使用者一鍵就有可聽結果。
 */
const AUDIO_PRESETS: Record<
  string,
  { label: string; tab: string; modelId?: string; prompt: string; params?: Record<string, string | number | boolean> }
> = {
  meditation: {
    label: "冥想引導",
    tab: "music",
    modelId: "stable-audio",
    prompt: "ambient meditation, soft pads, gentle nature sounds, peaceful, 60bpm",
    params: { duration: 60, instrumental: true },
  },
  cafe: {
    label: "咖啡廳輕音樂",
    tab: "music",
    modelId: "ace-step",
    prompt: "soft jazz, acoustic guitar, mellow piano, warm cafe ambience, 80bpm",
    params: { duration: 90, instrumental: true },
  },
  cinematic: {
    label: "電影配樂",
    tab: "music",
    modelId: "ace-step",
    prompt: "cinematic orchestral score, emotional strings, gentle piano, slow build, 70bpm",
    params: { duration: 60, instrumental: true },
  },
  rain: {
    label: "雨聲環境音",
    tab: "sfx",
    modelId: "stable-audio",
    prompt: "gentle rain on leaves, distant thunder, calm forest atmosphere",
    params: { duration_seconds: 30 },
  },
  forest: {
    label: "森林環境音",
    tab: "sfx",
    modelId: "stable-audio",
    prompt: "forest ambience, birds chirping, leaves rustling, distant stream",
    params: { duration_seconds: 30 },
  },
  // ── 聲音克隆預設 ──
  cloneNarration: {
    label: "克隆 → 旁白朗讀",
    tab: "clone",
    modelId: "qwen-clone",
    prompt: "請以溫暖、療癒的語氣朗讀這段內容。",
    params: { mode: "qwen" },
  },
  cloneDialog: {
    label: "多人對話克隆",
    tab: "clone",
    modelId: "dia-clone",
    prompt: "[S1] 你今天感覺如何？ [S2] 我覺得心情輕鬆了不少。",
    params: { mode: "dia" },
  },
  cloneIvc: {
    label: "ElevenLabs IVC（建 voice_id）",
    tab: "clone",
    modelId: "eleven-ivc",
    prompt: "請示範 30 秒以上的乾淨語音用作參考樣本。",
    params: { mode: "elevenlabs" },
  },
  voiceDesignWarm: {
    label: "聲音設計：溫暖女聲",
    tab: "clone",
    modelId: "voice-design",
    prompt: "你好，我是你設計出的聲音。",
    params: { mode: "design", voice_description: "warm, gentle female voice, calm pace, healing tone" },
  },
};

const AgentBridgeContext = createContext<React.MutableRefObject<ProStudioAgentBridge> | null>(null);

/** 各子 Tab 用此 hook 註冊自己的 agent bridge */
function useProStudioAgentBridge(bridge: ProStudioAgentBridge) {
  const ref = useContext(AgentBridgeContext);
  // 每次渲染都更新 ref 以保持最新閉包（bridge 每次都是新物件，含最新 state）
  if (ref) {
    ref.current = bridge;
  }
  useEffect(() => {
    return () => {
      if (ref) {
        ref.current = {};
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

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

const PROMPT_MIN_LENGTH = 12;

function hasKeyword(text: string, keywords: string[]): boolean {
  const normalized = text.toLowerCase();
  return keywords.some(keyword => normalized.includes(keyword.toLowerCase()));
}

export function validatePromptBeforeSubmit(tab: string, promptState: Record<string, unknown>): { ok: true } | { ok: false; reason: string } {
  const rawPrompt = String(promptState.prompt ?? promptState.text ?? "").trim();
  if (!rawPrompt) return { ok: false, reason: "提示詞為空，請先描述需求內容" };
  if (rawPrompt.length < PROMPT_MIN_LENGTH) {
    return { ok: false, reason: `提示詞太短（至少 ${PROMPT_MIN_LENGTH} 字），請補上更完整描述` };
  }

  if (tab === "music") {
    const tags = String(promptState.tags ?? "").trim();
    const merged = `${rawPrompt} ${tags}`.trim();
    const hasStyle = hasKeyword(merged, ["風格", "style", "jazz", "lo-fi", "ambient", "cinematic", "流行", "爵士"]);
    const hasRhythm = hasKeyword(merged, ["節奏", "bpm", "快", "慢", "rhythm", "tempo"]);
    const hasMood = hasKeyword(merged, ["情緒", "mood", "放鬆", "療癒", "緊張", "開心", "悲傷", "平靜"]);
    const hasUseCase = hasKeyword(merged, ["用途", "場景", "for", "適合", "背景", "冥想", "廣告", "影片"]);
    if (!hasStyle && !hasRhythm) {
      return { ok: false, reason: "配樂缺少風格與節奏描述（可補：曲風 + BPM/快慢）" };
    }
    const missing: string[] = [];
    if (!hasStyle) missing.push("風格");
    if (!hasRhythm) missing.push("節奏");
    if (!hasMood) missing.push("情緒");
    if (!hasUseCase) missing.push("用途/場景");
    if (missing.length > 0) return { ok: false, reason: `配樂描述仍缺少：${missing.join("、")}` };
  }

  if (tab === "tts") {
    const voiceId = String(promptState.voiceId ?? promptState.voice_id ?? "").trim();
    const paragraphs = rawPrompt.split(/\n+/).map(x => x.trim()).filter(Boolean);
    const hasTone = hasKeyword(rawPrompt, ["語氣", "tone", "溫暖", "嚴肅", "活潑", "沉穩", "親切", "情緒"]);
    if (!voiceId) return { ok: false, reason: "旁白缺少聲線（voice_id 或預設 voice）" };
    if (paragraphs.length < 2) return { ok: false, reason: "旁白缺少段落（建議至少 2 段）" };
    if (!hasTone) return { ok: false, reason: "旁白缺少語氣描述（例：溫暖、沉穩、活潑）" };
  }

  return { ok: true };
}

// ─── 子元件：AsyncAudioPoller — 音訊輪詢元件 ─────────────────────────────────

/**
 * 當後端 textToMusic / speechToText 回傳 request_id 時
 * 每 3 秒輪詢 checkAudioStatus，完成後自動顯示 AudioPlayer。
 * 支援超時偵測：超過 10 分鐘自動標記失敗。
 */
function AsyncAudioPoller({
  result,
  onUpdate,
  label,
}: {
  result: AudioResult;
  onUpdate: (r: AudioResult) => void;
  label?: string;
}) {
  const modelId = result.model ?? "";
  const audioUrl = result.audio_url ?? result.audio?.url ?? result.url;
  const [dismissed, setDismissed] = useState(false);
  // 記錄提交時間，用於超時偵測
  const [submittedAt] = useState(() => Date.now());

  const { data, isError, error } = trpc.proStudio.checkAudioStatus.useQuery(
    { requestId: result.request_id ?? "", model: modelId, submittedAt },
    {
      enabled: !!(result.request_id && !audioUrl && modelId),
      refetchInterval: query => {
        const s = query.state.data?.status;
        return s === "COMPLETED" ? false : 3000;
      },
      refetchIntervalInBackground: false,
      retry: 5,
    }
  );

  useEffect(() => {
    if (data?.status === "COMPLETED") {
      const newUrl = data.audio_url ?? data.text;
      if (newUrl) {
        setDismissed(false); // 完成時自動顯示結果
        toast.success(`✅ ${label ?? "音訊"} 生成完成！`);
        onUpdate({ ...result, audio_url: newUrl });
      }
    }
  }, [data?.status, label]);

  if (audioUrl) return <AudioPlayer url={audioUrl as string} label={label} />;

  if (isError)
    return (
      <div className="mt-4 p-3 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
        <AlertCircle className="w-4 h-4" />
        <span>生成失敗：{(error as any)?.message ?? "請重試"}</span>
      </div>
    );

  // 使用者已關閉等待畫面
  if (dismissed) return null;

  if (result.request_id && !audioUrl)
    return (
      <div className="mt-4 p-5 rounded-xl bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 flex flex-col items-center gap-2 relative">
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-accent active:bg-accent/70 transition-colors"
          title="隱藏等待畫面（背景任務會繼續）"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold">
            {label ?? "音訊"} 背景生成中...
          </p>
          <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
            已轉入背景任務，完成後會自動通知你
            <br />
            <span className="text-primary/70">
              你可以關閉此面板繼續其他操作
            </span>
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
      {label && (
        <p className="text-xs text-muted-foreground mb-2 font-medium flex items-center gap-1.5">
          <Volume2 className="w-3 h-3" />
          {label}
          <span className="ml-auto text-[10px] text-emerald-600 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">✓ 完成</span>
        </p>
      )}
      <audio controls className="w-full" src={url}>
        <track kind="captions" />
      </audio>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <a
          href={url}
          download
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2.5 py-1.5 rounded-lg hover:bg-primary/5 transition-all font-medium"
        >
          <Download className="w-3 h-3" /> 下載音訊
        </a>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-accent transition-all"
          onClick={() => {
            void copyToClipboard(url, "已複製音訊 URL");
          }}
        >
          <Copy className="w-3 h-3" />
          複製 URL
        </button>
      </div>
    </div>
  );
}

function VideoPlayer({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-primary/5 to-blue-500/5 border border-primary/20">
      {label && (
        <p className="text-xs text-muted-foreground mb-2 font-medium flex items-center gap-1.5">
          <Film className="w-3 h-3" />
          {label}
          <span className="ml-auto text-[10px] text-emerald-600 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">✓ 完成</span>
        </p>
      )}
      <video controls className="w-full rounded-lg max-h-64" src={url}>
        <track kind="captions" />
      </video>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <a
          href={url}
          download
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2.5 py-1.5 rounded-lg hover:bg-primary/5 transition-all font-medium"
        >
          <Download className="w-3 h-3" /> 下載影片
        </a>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-accent transition-all"
          onClick={() => {
            void copyToClipboard(url, "已複製影片 URL");
          }}
        >
          <Copy className="w-3 h-3" />
          複製 URL
        </button>
      </div>
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
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
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

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const reader = new FileReader();
        reader.onload = async e => {
          try {
            const base64 = (e.target?.result as string).split(",")[1];
            const res = await fetch("/api/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                fileName: file.name,
                mimeType: file.type,
                data: base64,
              }),
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
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const isImageAccept = accept.includes("image");
  const defaultPlaceholder = isImageAccept
    ? "貼上圖片 URL，或點右側上傳"
    : "貼上音訊 URL（mp3/wav/flac），或點右側上傳";

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div
        className="flex gap-2 items-center"
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
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
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {uploading ? "上傳中" : "上傳"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
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
  pop: "流行",
  rock: "搖滾",
  jazz: "爵士",
  classical: "古典",
  "hip-hop": "嘻哈",
  electronic: "電子",
  folk: "民謠",
  country: "鄉村",
  "R&B": "節奏藍調",
  metal: "金屬",
  blues: "藍調",
  reggae: "雷鬼",
  soul: "靈魂樂",
  funk: "放克",
  ambient: "氛圍",
  "lo-fi": "低保真",
  // 樂器
  piano: "鋼琴",
  guitar: "吉他",
  violin: "小提琴",
  drums: "鼓",
  bass: "貝斯",
  flute: "長笛",
  cello: "大提琴",
  trumpet: "小號",
  synthesizer: "合成器",
  "acoustic guitar": "木吉他",
  "electric guitar": "電吉他",
  ukulele: "烏克麗麗",
  // 情緒
  happy: "開心",
  sad: "悲傷",
  romantic: "浪漫",
  energetic: "活力",
  relaxing: "放鬆",
  dramatic: "戲劇性",
  mysterious: "神秘",
  uplifting: "振奮",
  melancholic: "憂鬱",
  calm: "平靜",
  tense: "緊張",
  nostalgic: "懷舊",
  // 節奏
  upbeat: "輕快",
  slow: "慢速",
  moderate: "中速",
  fast: "快速",
  danceable: "適合跳舞",
  // 調性
  "C major": "C 大調",
  "G major": "G 大調",
  "D major": "D 大調",
  "A minor": "A 小調",
  "E minor": "E 小調",
  "F major": "F 大調",
  "minor key": "小調",
  "major key": "大調",
};

const MUSIC_TAG_CATEGORIES = [
  {
    label: "曲風",
    color: "purple",
    tags: [
      "pop",
      "rock",
      "jazz",
      "classical",
      "hip-hop",
      "electronic",
      "folk",
      "country",
      "R&B",
      "metal",
      "blues",
      "reggae",
      "soul",
      "funk",
      "ambient",
      "lo-fi",
    ],
  },
  {
    label: "樂器",
    color: "blue",
    tags: [
      "piano",
      "guitar",
      "violin",
      "drums",
      "bass",
      "flute",
      "cello",
      "trumpet",
      "synthesizer",
      "acoustic guitar",
      "electric guitar",
      "ukulele",
    ],
  },
  {
    label: "情緒氛圍",
    color: "pink",
    tags: [
      "happy",
      "sad",
      "romantic",
      "energetic",
      "relaxing",
      "dramatic",
      "mysterious",
      "uplifting",
      "melancholic",
      "calm",
      "tense",
      "nostalgic",
    ],
  },
  {
    label: "節奏速度",
    color: "orange",
    tags: [
      "60bpm",
      "80bpm",
      "100bpm",
      "120bpm",
      "140bpm",
      "upbeat",
      "slow",
      "moderate",
      "fast",
      "danceable",
    ],
  },
  {
    label: "調性",
    color: "green",
    tags: [
      "C major",
      "G major",
      "D major",
      "A minor",
      "E minor",
      "F major",
      "minor key",
      "major key",
    ],
  },
];

type TagColor = "purple" | "blue" | "pink" | "orange" | "green";

const TAG_COLOR_MAP: Record<TagColor, string> = {
  purple:
    "bg-purple-50 hover:bg-purple-100 border-purple-200/60 text-purple-700",
  blue: "bg-blue-50 hover:bg-blue-100 border-blue-200/60 text-blue-700",
  pink: "bg-pink-50 hover:bg-pink-100 border-pink-200/60 text-pink-700",
  orange:
    "bg-orange-50 hover:bg-orange-100 border-orange-200/60 text-orange-700",
  green:
    "bg-emerald-50 hover:bg-emerald-100 border-emerald-200/60 text-emerald-700",
};

const TAG_COLOR_ACTIVE_MAP: Record<TagColor, string> = {
  purple: "bg-purple-500 border-purple-500 text-white",
  blue: "bg-blue-500 border-blue-500 text-white",
  pink: "bg-pink-500 border-pink-500 text-white",
  orange: "bg-orange-500 border-orange-500 text-white",
  green: "bg-emerald-500 border-emerald-500 text-white",
};

function MusicTagPicker({
  tags,
  onChange,
}: {
  tags: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(
    tags
      .split(",")
      .map(t => t.trim())
      .filter(Boolean)
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
            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
              {selectedCount} 個已選
            </Badge>
          )}
        </Label>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-0.5 text-[10px] text-primary hover:text-primary/80 transition-colors"
        >
          {open ? (
            <>
              <ChevronUp className="w-3 h-3" />
              收起快選
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              快速選取
            </>
          )}
        </button>
      </div>

      {/* 手動輸入 */}
      <Input
        value={tags}
        onChange={e => onChange(e.target.value)}
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
            <div
              className="p-2.5 sm:p-3 rounded-xl bg-muted/30 border border-border/50 space-y-2.5 sm:space-y-3 max-h-[50vh] overflow-y-auto focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
              tabIndex={0}
              role="region"
              aria-label="音樂風格標籤選擇器"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Info className="w-3 h-3" />
                點擊標籤快速新增，多個標籤會自動合併為逗號分隔格式
              </div>
              {MUSIC_TAG_CATEGORIES.map(cat => (
                <div key={cat.label}>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
                    {cat.label}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {cat.tags.map(tag => {
                      const isActive = selectedSet.has(tag);
                      const colorKey = cat.color as TagColor;
                      const zhLabel = TAG_ZH[tag];
                      return (
                        <button
                          key={tag}
                          onClick={() => toggle(tag)}
                          className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                            isActive
                              ? TAG_COLOR_ACTIVE_MAP[colorKey]
                              : TAG_COLOR_MAP[colorKey]
                          }`}
                          title={zhLabel ? `${zhLabel} (${tag})` : tag}
                        >
                          {isActive && <span className="mr-0.5">✓</span>}
                          {zhLabel ?? tag}
                          {zhLabel && (
                            <span className="ml-0.5 opacity-60 text-[9px]">
                              {tag}
                            </span>
                          )}
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
  defaultOpen = false,
  children,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  badge?: string;
  modelId?: string;
  color?: "purple" | "blue" | "green" | "orange" | "pink" | "cyan" | "indigo";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = {
    purple: "from-purple-500/10 to-violet-500/5 border-purple-200/50 dark:from-purple-500/15 dark:to-violet-500/8 dark:border-purple-700/30",
    blue: "from-blue-500/10 to-cyan-500/5 border-blue-200/50 dark:from-blue-500/15 dark:to-cyan-500/8 dark:border-blue-700/30",
    green: "from-emerald-500/10 to-teal-500/5 border-emerald-200/50 dark:from-emerald-500/15 dark:to-teal-500/8 dark:border-emerald-700/30",
    orange: "from-orange-500/10 to-amber-500/5 border-orange-200/50 dark:from-orange-500/15 dark:to-amber-500/8 dark:border-orange-700/30",
    pink: "from-pink-500/10 to-rose-500/5 border-pink-200/50 dark:from-pink-500/15 dark:to-rose-500/8 dark:border-pink-700/30",
    cyan: "from-cyan-500/10 to-sky-500/5 border-cyan-200/50 dark:from-cyan-500/15 dark:to-sky-500/8 dark:border-cyan-700/30",
    indigo: "from-indigo-500/10 to-blue-500/5 border-indigo-200/50 dark:from-indigo-500/15 dark:to-blue-500/8 dark:border-indigo-700/30",
  };
  const iconColors = {
    purple: "text-purple-500",
    blue: "text-blue-500",
    green: "text-emerald-500",
    orange: "text-orange-500",
    pink: "text-pink-500",
    cyan: "text-cyan-500",
    indigo: "text-indigo-500",
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl bg-gradient-to-br ${colors[color]} border backdrop-blur-sm transition-healing ${open ? "shadow-md ring-1 ring-primary/10" : "shadow-sm hover:shadow-md hover:-translate-y-0.5"}`}
      >
        <CollapsibleTrigger asChild>
          <button
            className="w-full text-left p-3.5 sm:p-4 flex items-center gap-2.5 sm:gap-3 cursor-pointer group"
          >
            <div
              className={`p-1.5 sm:p-2 rounded-xl bg-white/60 dark:bg-white/10 shadow-sm ${iconColors[color]} shrink-0 transition-transform duration-300 ${open ? "scale-110" : "group-hover:scale-105"}`}
            >
              <Icon className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-foreground leading-tight">{title}</span>
                {badge && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {badge}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                {description}
              </p>
            </div>
            <div className={`p-1 rounded-lg transition-healing ${open ? "bg-primary/10" : "group-hover:bg-accent"}`}>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? "rotate-180 text-primary" : ""}`}
              />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 overflow-hidden">
          <div className="px-3.5 sm:px-4 pb-3.5 sm:pb-4 pt-0">
            {/* API 路徑已隱藏 — 技術細節對一般用戶無意義 */}
            {children}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
}

// ─── 音樂生成 Tab ─────────────────────────────────────────────────────────────

/** 一鍵套用模板 */
const MUSIC_TEMPLATES = [
  {
    label: "☕ 咖啡廳",
    desc: "溫暖咖啡廳背景音樂，適合閱讀和聊天",
    tags: "jazz, piano, calm, 80bpm",
  },
  {
    label: "🎬 電影配樂",
    desc: "科幻電影高潮場景配樂",
    tags: "electronic, dramatic, tense, 140bpm, synthesizer",
  },
  {
    label: "🌅 放鬆冥想",
    desc: "寧靜的冥想背景音樂，自然環境融合",
    tags: "ambient, calm, relaxing, slow, piano",
  },
  {
    label: "🎉 派對",
    desc: "輕鬆夏日流行歌曲",
    tags: "pop, upbeat, happy, guitar, 120bpm, C major",
  },
  {
    label: "📚 學習專注",
    desc: "幫助專注的 Lo-fi 音樂",
    tags: "lo-fi, calm, piano, 80bpm",
  },
  {
    label: "🏃 運動健身",
    desc: "高能量健身動感音樂",
    tags: "electronic, energetic, fast, drums, 140bpm",
  },
];

type MusicModelChoice =
  | "sonauto"
  | "ace-step"
  | "stable-audio"
  | "musicgen"
  | "suno-v3.5"
  | "suno-v4";

function MusicTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [tags, setTags] = useState("");
  const [referenceAudioUrl, setReferenceAudioUrl] = useState("");
  // DEF-14 修正：預設改為 ACE-Step（Sonauto v2 在 fal.ai 上不穩定，除非話概可用時才切回）
  const [musicModel, setMusicModel] = useState<MusicModelChoice>("ace-step");
  const [duration, setDuration] = useState(30);
  const [result, setResult] = useState<AudioResult | null>(null);
  // Suno 走獨立 task 流程（taskId/jobId），用單獨 state 追蹤輪詢
  const [sunoJob, setSunoJob] = useState<{ taskId: string; jobId?: number; modelVersion: string } | null>(null);

  // ── Agent Bridge：讓光球能控制音樂分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (text: string) => setPrompt(text),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "musicModel": case "model": {
          const valid: MusicModelChoice[] = [
            "sonauto", "ace-step", "stable-audio", "musicgen", "suno-v3.5", "suno-v4",
          ];
          if ((valid as string[]).includes(value)) { setMusicModel(value as MusicModelChoice); return true; }
          return false;
        }
        case "duration": { const n = parseInt(value, 10); if (n >= 5 && n <= 180) { setDuration(n); return true; } return false; }
        case "instrumental": { setInstrumental(value === "true"); return true; }
        case "lyrics": { setLyrics(value); return true; }
        case "tags": { setTags(value); return true; }
        case "referenceAudioUrl": { setReferenceAudioUrl(value); return true; }
        default: return false;
      }
    },
    getState: () => ({ prompt, musicModel, duration, instrumental, lyrics, tags, referenceAudioUrl }),
    submit: () => { if (!prompt.trim()) return false; return true; },
    reset: () => {
      setPrompt("");
      setLyrics("");
      setTags("");
      setInstrumental(false);
      setDuration(30);
      setReferenceAudioUrl("");
      setResult(null);
      setSunoJob(null);
    },
  });

  // 載入可用模型清單
  const modelsQuery = trpc.proStudio.musicModels.useQuery();
  const falModels = modelsQuery.data ?? [];
  // Suno 模型由前端直接定義（後端 generateMusicSuno 已支援 v3.5/v4）
  const SUNO_MODELS = [
    {
      id: "suno-v3.5",
      label: "Suno v3.5",
      description: "Suno API · 完整歌曲 · 穩定預設（含人聲＋伴奏）",
      badge: "歌詞",
      tier: "premium" as const,
    },
    {
      id: "suno-v4",
      label: "Suno v4",
      description: "Suno API · 高品質頂規（含人聲＋伴奏）",
      badge: "Pro",
      tier: "premium" as const,
    },
  ];
  const models = [...falModels, ...SUNO_MODELS];
  const isSunoModel = musicModel === "suno-v3.5" || musicModel === "suno-v4";

  const mutation = trpc.proStudio.textToMusic.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "audio", "🎵 音樂生成", prompt);
      const immediate = (data as any)?.audio_url ?? (data as any)?.url;
      if (immediate) toast.success("🎵 音樂生成完成！");
      else toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    },
    onError: e => {
      toast.error(`生成失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  // Suno 走獨立 endpoint：generateMusicSuno → checkMusicSunoStatus
  const sunoMutation = trpc.proStudio.generateMusicSuno.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setSunoJob({
        taskId: data.taskId,
        jobId: data.jobId ?? undefined,
        modelVersion: data.modelVersion,
      });
      setResult(null);
      registerBgTask(
        { request_id: data.taskId, model: `suno/${data.modelVersion}` } as AudioResult,
        "audio",
        "🎵 Suno 音樂生成",
        prompt
      );
      toast.success("📤 Suno 任務已提交！背景生成 1-3 分鐘，完成後自動顯示");
      reportSuccess();
    },
    onError: e => {
      toast.error(`Suno 生成失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  // Suno 輪詢：完成後自動把 audioUrl 灌進 result，重用既有播放器
  const sunoStatusQuery = trpc.proStudio.checkMusicSunoStatus.useQuery(
    { taskId: sunoJob?.taskId ?? "", jobId: sunoJob?.jobId },
    {
      enabled: !!sunoJob?.taskId,
      refetchInterval: query => {
        const s = (query.state.data as any)?.status;
        return s === "COMPLETED" || s === "completed" ? false : 5000;
      },
      refetchIntervalInBackground: false,
      retry: 5,
    }
  );

  useEffect(() => {
    if (!sunoJob) return;
    const data = sunoStatusQuery.data as any;
    if (!data) return;
    if (data.status === "COMPLETED" && data.audioUrl) {
      setResult({
        audio_url: data.audioUrl,
        url: data.audioUrl,
        request_id: sunoJob.taskId,
        model: `suno/${sunoJob.modelVersion}`,
      });
      toast.success("🎵 Suno 音樂生成完成！");
    }
  }, [sunoStatusQuery.data, sunoJob]);

  const audioUrl =
    result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;
  // Sonauto 不支援 duration；Suno 由 API 控制時長
  const showDuration = !isSunoModel && musicModel !== "sonauto";
  // 支援歌詞的模型：sonauto / ace-step / suno
  const showLyrics =
    musicModel === "sonauto" ||
    musicModel === "ace-step" ||
    isSunoModel;

  const applyTemplate = (t: (typeof MUSIC_TEMPLATES)[number]) => {
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
        badge={models.find(m => m.id === musicModel)?.label ?? "ACE-Step"}
        modelId={
          musicModel === "sonauto"
            ? "sonauto/v2/text-to-music"
            : isSunoModel
              ? `suno/${musicModel === "suno-v4" ? "v4" : "v3.5"}`
              : `fal-ai/${musicModel}`
        }
        color="purple"
        defaultOpen
      >
        <div className="space-y-3">
          {/* 模型選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Bot className="w-3 h-3" />
              選擇模型
              <span className="text-[9px] text-muted-foreground/60 ml-1">
                （主模型失敗可切換備選）
              </span>
            </Label>
            <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {(models.length > 0
                ? models
                : [
                    {
                      id: "ace-step",
                      label: "ACE-Step",
                      description: "高品質音樂",
                      badge: "推薦",
                      tier: "premium",
                    },
                    {
                      id: "sonauto",
                      label: "Sonauto v2",
                      description: "完整歌曲生成",
                      badge: "預設",
                      tier: "premium",
                    },
                    {
                      id: "stable-audio",
                      label: "Stable Audio",
                      description: "音樂/音效",
                      badge: "",
                      tier: "premium",
                    },
                    {
                      id: "musicgen",
                      label: "MusicGen",
                      description: "輕量快速",
                      badge: "快速",
                      tier: "standard",
                    },
                    ...SUNO_MODELS,
                  ]
              ).map(m => {
                const isSuno = m.id === "suno-v3.5" || m.id === "suno-v4";
                const isActive = musicModel === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      setMusicModel(m.id as MusicModelChoice);
                      // 切換引擎時清掉舊結果，避免狀態混淆
                      setResult(null);
                      setSunoJob(null);
                    }}
                    className={`p-2 rounded-lg border text-left transition-all text-[11px] ${
                      isActive
                        ? isSuno
                          ? "bg-violet-50 border-violet-400 ring-1 ring-violet-400"
                          : "bg-purple-50 border-purple-300 ring-1 ring-purple-300"
                        : "bg-background border-border hover:bg-accent"
                    }`}
                  >
                    <div className="font-medium flex items-center gap-1">
                      {m.label}
                      {m.badge && (
                        <Badge
                          variant="secondary"
                          className={`text-[8px] px-1 py-0 ${
                            isSuno && isActive
                              ? "bg-violet-200 text-violet-800"
                              : ""
                          }`}
                        >
                          {m.badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {m.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 快速模板 */}
          <div>
            <Label className="text-xs text-muted-foreground">
              🎯 一鍵套用模板（點擊快速填入）
            </Label>
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
              onChange={e => setPrompt(e.target.value)}
              placeholder="例如：一首輕快的爵士鋼琴曲，帶有活潑的節奏和溫暖的音色，讓人心情愉悅..."
              className="mt-1 text-sm resize-none h-20"
            />
          </div>
          <div className="mt-1">
            <MusicTagPicker tags={tags} onChange={setTags} />
          </div>
          {!isSunoModel && (
            <FileUploadInput
              label="參考音訊（選填）"
              value={referenceAudioUrl}
              onChange={setReferenceAudioUrl}
              accept="audio/*"
              hint="可上傳一段示例音色／節奏給 fal.ai 音樂模型參考（目前主要支援 Stable Audio）。"
            />
          )}
          <div className="flex items-center gap-2">
            <Switch
              checked={instrumental}
              onCheckedChange={setInstrumental}
              id="instrumental"
            />
            <Label
              htmlFor="instrumental"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              純音樂（無人聲）
            </Label>
          </div>
          {!instrumental && showLyrics && (
            <div>
              <Label className="text-xs text-muted-foreground">
                歌詞（選填）
              </Label>
              <Textarea
                value={lyrics}
                onChange={e => setLyrics(e.target.value)}
                placeholder="輸入歌詞內容（留空讓 AI 自動生成）..."
                className="mt-1 text-sm resize-none h-24"
              />
            </div>
          )}
          {/* 時長控制（非 Sonauto 模型） */}
          {showDuration && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                音樂時長：{duration} 秒（{Math.floor(duration / 60)}:
                {(duration % 60).toString().padStart(2, "0")}）
              </Label>
              <Slider
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                min={5}
                max={180}
                step={5}
              />
            </div>
          )}
          {/* Sonauto 注意事項 */}
          {musicModel === "sonauto" && (
            <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/40">
              <p className="text-[10px] text-amber-700">
                ⚡ <strong>Sonauto v2</strong> 自動決定音樂時長（通常 60-180
                秒），無法手動指定。 若需精確時長控制，請在描述中說明（如：「60
                秒短曲」）或切換至其他模型。
              </p>
            </div>
          )}
          {/* Suno 注意事項 */}
          {isSunoModel && (
            <div className="p-2.5 rounded-lg bg-violet-50/60 border border-violet-200/40">
              <p className="text-[10px] text-violet-700">
                🎼 <strong>Suno {musicModel === "suno-v4" ? "v4" : "v3.5"}</strong> 走 Suno API
                （非 fal.ai），自動產出完整歌曲（含人聲＋伴奏）。1-3 分鐘完成；填歌詞會啟用 Custom
                Mode。需設定 <code className="bg-violet-100 px-0.5 rounded">SUNO_API_KEY</code>。
              </p>
            </div>
          )}
          <Button
            onClick={() => {
              if (isSunoModel) {
                // Suno 走獨立 endpoint：generateMusicSuno
                const customMode = !!lyrics && !instrumental;
                sunoMutation.mutate({
                  prompt,
                  style: tags || undefined,
                  instrumental,
                  customMode,
                  lyrics: customMode ? lyrics : undefined,
                  modelVersion: musicModel === "suno-v4" ? "v4" : "v3.5",
                });
              } else {
                mutation.mutate({
                  prompt,
                  lyrics: lyrics || undefined,
                  instrumental,
                  tags: tags || undefined,
                  model: musicModel as "sonauto" | "ace-step" | "stable-audio" | "musicgen",
                  duration: showDuration ? duration : undefined,
                  referenceAudioUrl: referenceAudioUrl || undefined,
                });
              }
            }}
            disabled={
              mutation.isPending || sunoMutation.isPending || !prompt.trim()
            }
            className="w-full btn-healing"
          >
            {mutation.isPending || sunoMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                AI 作曲中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                生成音樂
              </>
            )}
          </Button>
        </div>
        {/* Suno 任務進行中提示（在拿到 audioUrl 之前） */}
        {sunoJob && !result && (
          <div className="mt-4 p-5 rounded-xl bg-gradient-to-br from-violet-500/5 to-purple-500/5 border border-violet-200/40 flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold">Suno 音樂背景生成中...</p>
              <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
                狀態：{(sunoStatusQuery.data as any)?.status ?? "PENDING"}
                <br />
                <span className="text-violet-700/70">
                  通常 1-3 分鐘完成，可關閉此分頁繼續其他操作
                </span>
              </p>
            </div>
          </div>
        )}
        {result ? (
          isSunoModel ? (
            // Suno 完成後直接拿到 audioUrl，不需再走 fal poller
            audioUrl ? (
              <AudioPlayer url={audioUrl as string} label="🎵 Suno 音樂結果" />
            ) : null
          ) : (
            <AsyncAudioPoller
              result={result}
              onUpdate={setResult}
              label="✨ 音樂生成結果"
            />
          )
        ) : null}
      </ToolCard>

      {/* 使用說明 */}
      <div className="rounded-xl p-4 bg-purple-50/50 border border-purple-200/40 space-y-3">
        <div>
          <p className="text-xs font-medium text-purple-700 mb-1.5">
            💡 提示詞技巧
          </p>
          <ul className="space-y-1">
            {[
              "「音樂描述」：用自然語言說明想要的音樂感覺（情境、情緒、場景）",
              "「風格標籤」：點擊「快速選取」選擇曲風/樂器/情緒/節奏/調性（已附中文翻譯）",
              "兩者可同時使用：描述提供脈絡，標籤精確指定音樂特徵",
              "⏱️ 如果主模型（Sonauto）超時或失敗，可切換至 ACE-Step / MusicGen 重試",
            ].map((tip, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] text-purple-600">
                <span className="shrink-0 mt-0.5">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t border-purple-200/40 pt-3">
          <p className="text-[10px] font-medium text-purple-700 mb-1">
            📝 範例組合
          </p>
          <div className="space-y-1.5">
            {[
              {
                desc: "溫暖咖啡廳背景音樂",
                tags: "jazz, piano, acoustic, warm, 80bpm",
              },
              {
                desc: "科幻電影高潮場景配樂",
                tags: "electronic, dramatic, tense, 140bpm, synthesizer",
              },
              {
                desc: "輕鬆夏日流行歌曲",
                tags: "pop, upbeat, happy, guitar, 120bpm, C major",
              },
            ].map((ex, i) => (
              <button
                key={i}
                onClick={() => {
                  setPrompt(ex.desc);
                  setTags(ex.tags);
                }}
                className="w-full p-1.5 rounded bg-purple-100/50 text-[10px] text-purple-700 text-left hover:bg-purple-100 transition-colors cursor-pointer"
              >
                <strong>描述：</strong>
                {ex.desc}
                <br />
                <strong>標籤：</strong>
                {ex.tags}
                <span className="ml-1 text-[9px] text-purple-500">
                  （點擊套用）
                </span>
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
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [text, setText] = useState("");
  const [duration, setDuration] = useState<number>(10);
  const [useDuration, setUseDuration] = useState(false);
  const [influence, setInfluence] = useState(0.3);
  const [sfxModel, setSfxModel] = useState<
    "stable-audio" | "audioldm2" | "elevenlabs"
  >("stable-audio");
  const [result, setResult] = useState<AudioResult | null>(null);

  // ── Agent Bridge：讓光球能控制音效分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setText(t),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "sfxModel": case "model": {
          const valid = ["stable-audio", "audioldm2", "elevenlabs"];
          if (valid.includes(value)) { setSfxModel(value as typeof sfxModel); return true; }
          return false;
        }
        case "duration": { const n = parseInt(value, 10); if (n >= 1 && n <= 180) { setDuration(n); setUseDuration(true); return true; } return false; }
        case "useDuration": { setUseDuration(value === "true"); return true; }
        case "influence": { const f = parseFloat(value); if (f >= 0 && f <= 1) { setInfluence(f); return true; } return false; }
        default: return false;
      }
    },
    getState: () => ({ text, sfxModel, duration, useDuration, influence }),
    submit: () => { if (!text.trim()) return false; return true; },
    reset: () => {
      setText("");
      setDuration(10);
      setUseDuration(false);
      setInfluence(0.3);
      setResult(null);
    },
  });

  // 載入可用模型清單
  const modelsQuery = trpc.proStudio.sfxModels.useQuery();
  const models = modelsQuery.data ?? [];

  const mutation = trpc.proStudio.soundEffects.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "audio", "🔊 音效生成", text);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`生成失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  const audioUrl =
    result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;
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
        modelId={
          sfxModel === "elevenlabs"
            ? "fal-ai/elevenlabs/sound-effects/v2"
            : `fal-ai/${sfxModel}`
        }
        color="orange"
        defaultOpen
      >
        <div className="space-y-3">
          {/* 模型選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1">
              <Bot className="w-3 h-3" />
              選擇模型
            </Label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {(models.length > 0
                ? models
                : [
                    {
                      id: "stable-audio",
                      label: "Stable Audio",
                      description: "真實環境音效",
                      badge: "預設",
                      tier: "premium",
                    },
                    {
                      id: "audioldm2",
                      label: "AudioLDM 2",
                      description: "自然音效",
                      badge: "",
                      tier: "standard",
                    },
                    {
                      id: "elevenlabs",
                      label: "ElevenLabs",
                      description: "備用",
                      badge: "備用",
                      tier: "standard",
                    },
                  ]
              ).map(m => (
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
                    {m.badge && (
                      <Badge
                        variant="secondary"
                        className="text-[8px] px-1 py-0"
                      >
                        {m.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">
                    {m.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* ⚠️ ElevenLabs 警告 */}
          {sfxModel === "elevenlabs" && (
            <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200/40">
              <p className="text-[10px] text-amber-700">
                ⚠️ ElevenLabs Sound Effects
                對某些描述可能產生「語音配音」而非音效。 如需純音效，建議使用{" "}
                <strong>Stable Audio</strong> 或 <strong>AudioLDM 2</strong>。
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">
              音效描述 <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={
                sfxModel === "elevenlabs"
                  ? "詳細描述你想要的音效（ElevenLabs 模式，最長 22 秒）..."
                  : "詳細描述你想要的音效場景，例如：森林鳥鳴、雷雨聲、機器運轉..."
              }
              className="mt-1 text-sm resize-none h-20"
            />
          </div>

          {/* 快速範例 */}
          <div>
            <Label className="text-xs text-muted-foreground">
              快速範例（點擊套用）
            </Label>
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
            <Switch
              checked={useDuration}
              onCheckedChange={setUseDuration}
              id="useDur"
            />
            <Label
              htmlFor="useDur"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              指定時長（預設自動）
            </Label>
          </div>

          {useDuration && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                時長：{duration} 秒（最長 {maxDuration} 秒）
              </Label>
              <Slider
                value={[duration]}
                onValueChange={([v]) => setDuration(v)}
                min={1}
                max={maxDuration}
                step={0.5}
              />
            </div>
          )}

          {showInfluence && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                提示詞影響強度：{influence.toFixed(2)}
                <span className="ml-2 text-[10px] text-muted-foreground/60">
                  （越高越貼近描述，越低越有創意）
                </span>
              </Label>
              <Slider
                value={[influence]}
                onValueChange={([v]) => setInfluence(v)}
                min={0}
                max={1}
                step={0.05}
              />
            </div>
          )}
          <Button
            onClick={() =>
              mutation.mutate({
                text,
                duration_seconds: useDuration ? duration : undefined,
                prompt_influence: showInfluence ? influence : undefined,
                model: sfxModel,
              })
            }
            disabled={mutation.isPending || !text.trim()}
            className="w-full btn-healing"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 mr-2" />
                生成音效
              </>
            )}
          </Button>
        </div>
        {result?.request_id && result?.model && !audioUrl && (
          <AsyncAudioPoller
            result={result}
            onUpdate={setResult}
            label="🔊 音效結果"
          />
        )}
        {audioUrl && (
          <AudioPlayer url={audioUrl as string} label="🔊 音效結果" />
        )}
      </ToolCard>
    </div>
  );
}

// ─── 語音合成 Tab ─────────────────────────────────────────────────────────────

function TTSTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [engine, setEngine] = useState<"elevenlabs" | "qwen">("elevenlabs");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [speed, setSpeed] = useState(1.0);
  const [elevenEngine, setElevenEngine] = useState<
    "turbo-v2.5" | "flash-v2.5" | "multilingual-v2" | "eleven-v3"
  >("turbo-v2.5");
  const [result, setResult] = useState<AudioResult | null>(null);

  // ── Agent Bridge：讓光球能控制語音合成分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setText(t),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "engine": case "model": {
          const valid = ["elevenlabs", "qwen"];
          if (valid.includes(value)) { setEngine(value as typeof engine); return true; }
          return false;
        }
        case "elevenEngine": case "eleven_engine": case "elevenlabs_engine": {
          const valid = ["turbo-v2.5", "flash-v2.5", "multilingual-v2", "eleven-v3"];
          if (valid.includes(value)) { setElevenEngine(value as typeof elevenEngine); return true; }
          return false;
        }
        case "voiceId": case "voice_id": { setVoiceId(value); return true; }
        case "stability": { const f = parseFloat(value); if (f >= 0 && f <= 1) { setStability(f); return true; } return false; }
        case "similarity": { const f = parseFloat(value); if (f >= 0 && f <= 1) { setSimilarity(f); return true; } return false; }
        case "speed": { const f = parseFloat(value); if (f >= 0.5 && f <= 2) { setSpeed(f); return true; } return false; }
        default: return false;
      }
    },
    getState: () => ({ text, engine, elevenEngine, voiceId, stability, similarity, speed }),
    submit: () => { if (!text.trim()) return false; return true; },
    reset: () => {
      setText("");
      setVoiceId("");
      setStability(0.5);
      setSimilarity(0.75);
      setSpeed(1.0);
      setElevenEngine("turbo-v2.5");
      setResult(null);
    },
  });

  const elevenMutation = trpc.proStudio.elevenLabsTTS.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "voice", "🎤 ElevenLabs 語音", text);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`合成失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  const qwenMutation = trpc.proStudio.qwenTTS.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "voice", "🎤 Qwen 語音", text);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`合成失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  const isPending = elevenMutation.isPending || qwenMutation.isPending;
  const audioUrl =
    result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;

  const handleGenerate = () => {
    setResult(null);
    if (engine === "elevenlabs") {
      elevenMutation.mutate({
        text,
        voice_id: voiceId || undefined,
        engine: elevenEngine,
        stability,
        similarity_boost: similarity,
      });
    } else {
      // Qwen3-TTS accepts: text, voice (preset name), language
      // It does NOT support voice_id or speed parameters
      qwenMutation.mutate({ text, voice: voiceId || undefined });
    }
  };

  const elevenEngines = [
    { id: "turbo-v2.5" as const, label: "Turbo v2.5", desc: "最快速度・低成本", badge: "推薦" },
    { id: "flash-v2.5" as const, label: "Flash v2.5", desc: "超低延遲・即時對話", badge: "最快" },
    { id: "multilingual-v2" as const, label: "Multilingual v2", desc: "29 語言・穩定品質" },
    { id: "eleven-v3" as const, label: "ElevenLabs v3", desc: "最強情緒・最高品質", badge: "Pro" },
  ];

  const elevenVoices = [
    {
      id: "21m00Tcm4TlvDq8ikWAM",
      name: "Rachel",
      desc: "英文女聲・自然沉穩",
      emoji: "👩",
    },
    {
      id: "AZnzlk1XvdvUeBnXmlld",
      name: "Domi",
      desc: "英文女聲・充滿活力",
      emoji: "💃",
    },
    {
      id: "EXAVITQu4vr4xnSDxMaL",
      name: "Bella",
      desc: "英文女聲・柔和溫暖",
      emoji: "🌸",
    },
    {
      id: "ErXwobaYiN019PkySvjV",
      name: "Antoni",
      desc: "英文男聲・親切自然",
      emoji: "👨",
    },
    {
      id: "MF3mGyEYCl7XYWbV9V6O",
      name: "Elli",
      desc: "英文女聲・年輕清亮",
      emoji: "✨",
    },
    {
      id: "TxGEqnHWrfWFTfGW9XjX",
      name: "Josh",
      desc: "英文男聲・低沉磁性",
      emoji: "🎙️",
    },
    {
      id: "pNInz4obpRJjN438Rq59",
      name: "Adam",
      desc: "英文男聲・新聞播報",
      emoji: "📰",
    },
    {
      id: "yoZ06aMxZJJ28mfd3POQ",
      name: "Sam",
      desc: "英文男聲・理性穩健",
      emoji: "🤵",
    },
  ];

  const qwenVoicePresets = [
    { id: "Chelsie", desc: "女聲・活潑英語", emoji: "🌟", lang: "英文" },
    { id: "Ethan", desc: "男聲・英語播報", emoji: "🎤", lang: "英文" },
    { id: "Vivian", desc: "女聲・中文自然", emoji: "🌺", lang: "中文" },
    { id: "Dylan", desc: "男聲・中文沉穩", emoji: "🎯", lang: "中文" },
  ];

  return (
    <div className="space-y-4">
      <ToolCard
        icon={Mic2}
        title="AI 語音合成 (TTS)"
        description="ElevenLabs Turbo v2.5 / Qwen3-TTS — 自然擬真的 AI 語音"
        color="blue"
        defaultOpen
      >
        <div className="space-y-3">
          {/* 引擎選擇 */}
          <div>
            <Label className="text-xs text-muted-foreground">引擎選擇</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {[
                {
                  id: "elevenlabs" as const,
                  label: "ElevenLabs Turbo v2.5",
                  desc: "英語最佳品質",
                  modelId: "fal-ai/elevenlabs/tts/turbo-v2.5",
                },
                {
                  id: "qwen" as const,
                  label: "Qwen3-TTS 1.7B",
                  desc: "中文 / 多語言",
                  modelId: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
                },
              ].map(({ id, label, desc, modelId }) => (
                <button
                  key={id}
                  onClick={() => {
                    setEngine(id);
                    setResult(null);
                  }}
                  className={`p-3 rounded-xl border text-left transition-all ${engine === id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <p className="text-xs font-semibold">{label}</p>
                  <p
                    className={`text-[10px] mt-0.5 ${engine === id ? "text-blue-100" : "text-muted-foreground"}`}
                  >
                    {desc}
                  </p>
                  <p
                    className={`text-[9px] mt-0.5 font-mono ${engine === id ? "text-blue-200" : "text-muted-foreground/50"}`}
                  >
                    {modelId}
                  </p>
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
              onChange={e => setText(e.target.value)}
              placeholder={
                engine === "elevenlabs"
                  ? "輸入英文文字（ElevenLabs 英文效果最佳）..."
                  : "輸入中文或其他語言的文字..."
              }
              className="mt-1 text-sm resize-none h-24"
            />
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {text.length} / 5000 字元
            </p>
          </div>

          {/* ElevenLabs 引擎選擇器 */}
          {engine === "elevenlabs" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                ElevenLabs 引擎（影響成本與品質）
              </Label>
              <div className="grid grid-cols-2 gap-1.5">
                {elevenEngines.map(e => (
                  <button
                    key={e.id}
                    onClick={() => setElevenEngine(e.id)}
                    className={`p-2 rounded-lg border text-left transition-all relative ${elevenEngine === e.id ? "bg-purple-500 text-white border-purple-500" : "bg-background hover:bg-accent border-border"}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">{e.label}</p>
                      {e.badge && (
                        <span
                          className={`text-[8px] px-1 py-0 rounded ${elevenEngine === e.id ? "bg-white/30 text-white" : "bg-purple-100 text-purple-600"}`}
                        >
                          {e.badge}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-[9px] mt-0.5 ${elevenEngine === e.id ? "text-purple-100" : "text-muted-foreground"}`}
                    >
                      {e.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 語音選擇 */}
          {engine === "elevenlabs" ? (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                語音選擇（點擊快速套用）
              </Label>
              {/* ElevenLabs 預設語音快選卡 */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setVoiceId("")}
                  className={`p-2 rounded-lg border text-left transition-all text-xs ${!voiceId ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <span className="mr-1">🎵</span> 預設語音
                  <p
                    className={`text-[9px] mt-0.5 ${!voiceId ? "text-blue-100" : "text-muted-foreground"}`}
                  >
                    系統自動選擇
                  </p>
                </button>
                {elevenVoices.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`p-2 rounded-lg border text-left transition-all ${voiceId === v.id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                  >
                    <span className="mr-1">{v.emoji}</span>
                    <span className="text-xs font-medium">{v.name}</span>
                    <p
                      className={`text-[9px] mt-0.5 ${voiceId === v.id ? "text-blue-100" : "text-muted-foreground"}`}
                    >
                      {v.desc}
                    </p>
                  </button>
                ))}
              </div>
              {/* 自訂 Voice ID 輸入 */}
              <div>
                <Label className="text-xs text-muted-foreground">
                  或輸入自訂 Voice ID
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={voiceId}
                    onChange={e => setVoiceId(e.target.value)}
                    placeholder="貼上 ElevenLabs voice_id（例：21m00Tcm4TlvDq8ikWAM）"
                    className="text-xs flex-1"
                  />
                  {voiceId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => setVoiceId("")}
                    >
                      ✕
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  💡 在{" "}
                  <a
                    href="https://elevenlabs.io/voice-library"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    ElevenLabs Voice Library
                  </a>{" "}
                  可找到更多語音 ID
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Qwen 語音選擇（點擊快速套用）
              </Label>
              {/* Qwen 預設語音快選 */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => setVoiceId("")}
                  className={`p-2 rounded-lg border text-left transition-all text-xs ${!voiceId ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                >
                  <span className="mr-1">🤖</span> 預設語音
                  <p
                    className={`text-[9px] mt-0.5 ${!voiceId ? "text-blue-100" : "text-muted-foreground"}`}
                  >
                    系統自動決定
                  </p>
                </button>
                {qwenVoicePresets.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setVoiceId(v.id)}
                    className={`p-2 rounded-lg border text-left transition-all ${voiceId === v.id ? "bg-blue-500 text-white border-blue-500" : "bg-background hover:bg-accent border-border"}`}
                  >
                    <span className="mr-1">{v.emoji}</span>
                    <span className="text-xs font-medium">{v.id}</span>
                    <Badge
                      variant="outline"
                      className="ml-1 text-[8px] px-1 py-0"
                    >
                      {v.lang}
                    </Badge>
                    <p
                      className={`text-[9px] mt-0.5 ${voiceId === v.id ? "text-blue-100" : "text-muted-foreground"}`}
                    >
                      {v.desc}
                    </p>
                  </button>
                ))}
              </div>
              {/* 手動輸入 */}
              <div>
                <Label className="text-xs text-muted-foreground">
                  或輸入語音名稱
                </Label>
                <Input
                  value={voiceId}
                  onChange={e => setVoiceId(e.target.value)}
                  placeholder="如：Vivian、Dylan（留空使用預設）"
                  className="mt-1 text-sm"
                />
              </div>
            </div>
          )}

          {/* ElevenLabs 進階設定 */}
          {engine === "elevenlabs" && (
            <div className="space-y-2 p-3 rounded-lg bg-blue-50/40 border border-blue-200/30">
              <p className="text-[10px] font-medium text-blue-700">
                進階語音設定
              </p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  穩定性：{stability.toFixed(2)}
                </Label>
                <Slider
                  value={[stability]}
                  onValueChange={([v]) => setStability(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
                <p className="text-[10px] text-muted-foreground/60">
                  低 = 更具表現力，高 = 更穩定一致
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  相似度：{similarity.toFixed(2)}
                </Label>
                <Slider
                  value={[similarity]}
                  onValueChange={([v]) => setSimilarity(v)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </div>
            </div>
          )}

          {/* Qwen 語音說明 */}
          {engine === "qwen" && (
            <div className="p-3 rounded-lg bg-blue-50/40 border border-blue-200/30">
              <p className="hs-small !mb-0 text-blue-700">
                💡 <strong>Qwen3-TTS</strong>{" "}
                支援中文、英文、日文等多語言，自動偵測語言。
                <br />
                • 預設語音為系統自動選擇
                <br />
                • 語音名稱（如 Vivian、Dylan）為 Qwen 內建的人聲風格
                <br />• <strong>不支援</strong> ElevenLabs voice_id 格式
              </p>
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={isPending || !text.trim()}
            className="w-full btn-healing"
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                合成中...
              </>
            ) : (
              <>
                <Mic2 className="w-4 h-4 mr-2" />
                合成語音
              </>
            )}
          </Button>
        </div>
        {result?.request_id && result?.model && !audioUrl && (
          <AsyncAudioPoller
            result={result}
            onUpdate={setResult}
            label="🎤 合成結果"
          />
        )}
        {audioUrl && (
          <AudioPlayer url={audioUrl as string} label="🎤 合成結果" />
        )}
      </ToolCard>
    </div>
  );
}

// ─── 聲音克隆 Tab ─────────────────────────────────────────────────────────────

function CloneTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [mode, setMode] = useState<"qwen" | "dia" | "design" | "kling" | "elevenlabs">("qwen");
  const [text, setText] = useState("");
  const [refAudio, setRefAudio] = useState("");
  const [refTranscript, setRefTranscript] = useState("");
  const [voiceDesc, setVoiceDesc] = useState("");
  // Kling / ElevenLabs 共用 voice 名稱
  const [klingName, setKlingName] = useState("");
  const [elevenDescription, setElevenDescription] = useState("");
  const [klingResult, setKlingResult] = useState<any>(null);
  const [result, setResult] = useState<AudioResult | null>(null);

  // ── Agent Bridge：讓光球能控制聲音克隆分頁參數 ──
  // PRO_MODELS id → CloneTab 內部 mode
  const cloneModelToMode: Record<string, typeof mode> = {
    "qwen-clone": "qwen",
    "dia-clone": "dia",
    "voice-design": "design",
    "eleven-ivc": "elevenlabs",
    "kling-voice": "kling",
  };
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setText(t),
    setModel: (modelId: string) => {
      const next = cloneModelToMode[modelId];
      if (!next) return false;
      setMode(next);
      return true;
    },
    setParam: (key: string, value: string) => {
      switch (key) {
        case "mode": case "model": {
          const valid = ["qwen", "dia", "design", "kling", "elevenlabs"];
          if (valid.includes(value)) { setMode(value as typeof mode); return true; }
          return false;
        }
        case "refAudio": case "reference_audio": { setRefAudio(value); return true; }
        case "refTranscript": case "reference_text": { setRefTranscript(value); return true; }
        case "voiceDesc": case "voice_description": { setVoiceDesc(value); return true; }
        case "klingName": case "name": { setKlingName(value); return true; }
        case "elevenDescription": case "description": { setElevenDescription(value); return true; }
        default: return false;
      }
    },
    getState: () => ({ text, mode, refAudio, refTranscript, voiceDesc, klingName, elevenDescription }),
    submit: () => { if (mode === "design" && !voiceDesc.trim()) return false; if ((mode === "qwen" || mode === "dia") && !text.trim()) return false; if (mode === "elevenlabs" && (!refAudio.trim() || !klingName.trim())) return false; return true; },
    reset: () => {
      setText("");
      setRefAudio("");
      setRefTranscript("");
      setVoiceDesc("");
      setKlingName("");
      setElevenDescription("");
      setResult(null);
      setKlingResult(null);
    },
  });

  // qwenCloneAndSpeak: clone + TTS in one step (audio_url + text → audio)
  const qwenClone = trpc.proStudio.qwenCloneAndSpeak.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "voice", "🎭 Qwen 聲音克隆", text);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`克隆失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  // diaTTSVoiceClone: only accepts { text } — no reference_audio_url
  const diaClone = trpc.proStudio.diaTTSVoiceClone.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "voice", "🎭 Dia 聲音克隆", text);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`克隆失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const voiceDesign = trpc.proStudio.qwenVoiceDesign.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data as AudioResult);
      registerBgTask(data, "voice", "🎨 語音設計", voiceDesc);
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`設計失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const klingVoice = trpc.proStudio.klingCreateVoice.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setKlingResult(data);
      registerBgTask(data, "voice", "✅ Kling 語音建立");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`Kling 建立失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const elevenLabsClone = trpc.proStudio.elevenLabsVoiceClone.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setKlingResult(data);
      registerBgTask(data, "voice", "✅ ElevenLabs 聲音克隆");
      toast.success("📤 任務已提交！voice_id 完成後可在 TTS 分頁直接使用");
      reportSuccess();
    },
    onError: e => {
      toast.error(`ElevenLabs 克隆失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  const isPending =
    qwenClone.isPending ||
    diaClone.isPending ||
    voiceDesign.isPending ||
    klingVoice.isPending ||
    elevenLabsClone.isPending;
  const audioUrl =
    result?.audio_url ?? (result?.audio as any)?.url ?? result?.url;

  const handleGenerate = () => {
    setResult(null);
    setKlingResult(null);
    if (mode === "qwen") {
      // qwenCloneAndSpeak: audio_url = reference, text = what to say
      qwenClone.mutate({
        audio_url: refAudio,
        text,
        reference_text: refTranscript || undefined,
      });
    } else if (mode === "dia") {
      // diaTTSVoiceClone: only text; supports [S1]/[S2] speaker tags
      diaClone.mutate({ text });
    } else if (mode === "design") {
      voiceDesign.mutate({
        voice_description: voiceDesc,
        text: text || undefined,
      });
    } else if (mode === "elevenlabs") {
      // ElevenLabs Instant Voice Cloning：建 voice_id，後續可走 TTS / dubbing / voice-changer
      elevenLabsClone.mutate({
        audio_url: refAudio,
        name: klingName,
        description: elevenDescription || undefined,
      });
    } else {
      klingVoice.mutate({ audio_url: refAudio, name: klingName });
    }
  };

  const modeConfig = [
    {
      id: "qwen" as const,
      label: "Qwen 克隆",
      desc: "零次學習克隆",
      badge: "Qwen3-TTS",
    },
    {
      id: "dia" as const,
      label: "Dia 對話克隆",
      desc: "多說話者克隆",
      badge: "Dia-TTS",
    },
    {
      id: "design" as const,
      label: "語音設計",
      desc: "文字描述設計聲音",
      badge: "Qwen3",
    },
    {
      id: "elevenlabs" as const,
      label: "ElevenLabs IVC",
      desc: "建 voice_id 給 TTS / 配音用",
      badge: "ElevenLabs",
      special: true,
    },
    {
      id: "kling" as const,
      label: "Kling 語音建立",
      desc: "用於 Kling 影片",
      badge: "Kling",
      special: true,
    },
  ];

  const isKlingDisabled =
    mode === "kling" && (!refAudio.trim() || !klingName.trim());
  const isElevenDisabled =
    mode === "elevenlabs" &&
    (!refAudio.trim() ||
      !refAudio.trim().startsWith("https://") ||
      !klingName.trim());
  // DEF-08 修正：Qwen 必須有效的 HTTPS URL（空字串或未上傳完成會造成 422）
  const qwenAudioValid =
    mode !== "qwen" || refAudio.trim().startsWith("https://");
  const isOtherDisabled =
    (mode === "qwen" && (!text.trim() || !qwenAudioValid)) ||
    (mode === "dia" && !text.trim());
  const isDesignDisabled = mode === "design" && !voiceDesc.trim();
  const submitDisabled =
    isPending ||
    isKlingDisabled ||
    isElevenDisabled ||
    isOtherDisabled ||
    isDesignDisabled;

  return (
    <div className="space-y-4">
      {/* 模式選擇 */}
      <div className="grid grid-cols-2 gap-2">
        {modeConfig.map(({ id, label, desc, badge, special }) => (
          <button
            key={id}
            onClick={() => {
              setMode(id);
              setResult(null);
              setKlingResult(null);
            }}
            className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
              mode === id
                ? special
                  ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white border-purple-500"
                  : "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-accent border-border"
            }`}
          >
            {special && mode === id && (
              <Star className="absolute right-2 top-2 w-3 h-3 text-yellow-300" />
            )}
            <p className="text-xs font-semibold">{label}</p>
            <p
              className={`text-[10px] mt-0.5 ${mode === id ? "text-white/70" : "text-muted-foreground"}`}
            >
              {desc}
            </p>
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
            title={
              mode === "qwen"
                ? "Qwen3-TTS 零次聲音克隆"
                : "Dia TTS 多說話者 TTS"
            }
            description={
              mode === "qwen"
                ? "上傳 3-10 秒參考音訊，AI 克隆聲音後合成語音"
                : "用 [S1]/[S2] 標籤標注多位說話者，AI 自動分配音色"
            }
            badge={mode === "qwen" ? "Qwen3 1.7B" : "Dia TTS"}
            modelId={
              mode === "qwen"
                ? "fal-ai/qwen-3-tts/clone-voice/1.7b"
                : "fal-ai/dia-tts/voice-clone"
            }
            color="pink"
            defaultOpen
          >
            <div className="space-y-3">
              {/* Qwen 需要參考音訊；Dia 不支援參考音訊 */}
              {mode === "qwen" && (
                <>
                  <FileUploadInput
                    label="參考音訊"
                    value={refAudio}
                    onChange={setRefAudio}
                    required
                    accept="audio/*"
                    placeholder="貼上 3-10 秒高品質音訊（mp3/wav/flac）"
                    hint="建議：安靜環境錄製的清晰人聲，3-10 秒，最大 16MB"
                  />
                  {/* DEF-08 修正：未上傳成功時顯示警告，避免送出空字串 audio_url 造成 422 */}
                  {refAudio && !refAudio.startsWith("https://") && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-200/60 rounded-lg px-2.5 py-1.5">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>
                        請使用「上傳」按鈕將音訊檔上傳，或貼上{" "}
                        <code className="bg-amber-100 px-0.5 rounded">
                          https://
                        </code>{" "}
                        開頭的 URL
                      </span>
                    </div>
                  )}
                  {!refAudio && (
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 rounded-lg px-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>必填：請上傳參考音訊才能開始克隆</span>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      參考音訊文字稿（選填，可提升克隆品質）
                    </Label>
                    <Textarea
                      value={refTranscript}
                      onChange={e => setRefTranscript(e.target.value)}
                      placeholder="輸入參考音訊中說的文字（可提升準確度）..."
                      className="mt-1 text-sm resize-none h-14"
                    />
                  </div>
                </>
              )}
              {mode === "dia" && (
                <div className="p-3 rounded-lg bg-pink-50/60 border border-pink-200/40">
                  <p className="hs-small !mb-0 text-pink-700">
                    💡 <strong>Dia TTS</strong> 不需要參考音訊。
                    <br />用{" "}
                    <code className="bg-pink-100 px-1 rounded">
                      [S1]
                    </code> /{" "}
                    <code className="bg-pink-100 px-1 rounded">[S2]</code>{" "}
                    標記不同說話者，AI 會自動分配不同音色。
                    <br />
                    例如：
                    <code className="bg-pink-100 px-1 rounded text-[10px]">
                      [S1] 你好，我是第一位說話者。 [S2] 我是第二位。
                    </code>
                  </p>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">
                  要合成的文字 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder={
                    mode === "qwen"
                      ? "輸入要用克隆語音朗讀的文字..."
                      : "[S1] 你好，請問有什麼需要幫助的？ [S2] 我想了解一下你們的服務。"
                  }
                  className="mt-1 text-sm resize-none h-20"
                />
              </div>
              <Button
                onClick={handleGenerate}
                disabled={submitDisabled}
                className="w-full btn-healing"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {mode === "qwen" ? "克隆中..." : "合成中..."}
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 mr-2" />
                    {mode === "qwen" ? "克隆並合成語音" : "合成多說話者語音"}
                  </>
                )}
              </Button>
            </div>
            {result?.request_id && result?.model && !audioUrl && (
              <AsyncAudioPoller
                result={result as AudioResult}
                onUpdate={setResult}
                label="🎭 合成結果"
              />
            )}
            {audioUrl && (
              <AudioPlayer url={audioUrl as string} label="🎭 合成結果" />
            )}
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
            defaultOpen
          >
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  語音特徵描述 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={voiceDesc}
                  onChange={e => setVoiceDesc(e.target.value)}
                  placeholder="例如：一位成熟穩重的中年男性，帶有輕微的低沉嗓音，說話速度適中，充滿磁性的音色，帶點廣播主播的感覺..."
                  className="mt-1 text-sm resize-none h-24"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  測試文字（選填）
                </Label>
                <Input
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="你好，我是你設計的聲音，歡迎使用 AI Director 音樂配音創作室。"
                  className="mt-1 text-sm"
                />
              </div>
              <Button
                onClick={handleGenerate}
                disabled={submitDisabled}
                className="w-full btn-healing"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    設計中...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    設計語音
                  </>
                )}
              </Button>
            </div>
            {result?.request_id && result?.model && !audioUrl && (
              <AsyncAudioPoller
                result={result as AudioResult}
                onUpdate={setResult}
                label="🎨 設計結果"
              />
            )}
            {audioUrl && (
              <AudioPlayer url={audioUrl as string} label="🎨 設計結果" />
            )}
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
            defaultOpen
          >
            <div className="space-y-3">
              {/* 使用說明 */}
              <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-200/40">
                <p className="text-xs font-medium text-indigo-700 mb-1">
                  📋 用途說明
                </p>
                <p className="hs-small !mb-0 text-indigo-600">
                  此功能建立「語音配置」供 Kling 影片生成使用。上傳 3-30
                  秒的清晰人聲音訊， 建立後可在 Kling 的影片生成中指定此語音
                  ID，讓 AI 影片角色用你的聲音說話。
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
                  onChange={e => setKlingName(e.target.value)}
                  placeholder="例如：旁白女聲、主角男聲、客服語音..."
                  className="mt-1 text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  建議使用有意義的名稱方便日後識別
                </p>
              </div>

              {/* 音訊品質建議 */}
              <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200/40">
                <p className="text-[11px] font-medium text-amber-700 mb-1">
                  ⚠️ 音訊品質要求
                </p>
                <ul className="space-y-0.5">
                  {[
                    "長度：3 ~ 30 秒",
                    "環境：安靜無雜音，盡量無背景音樂",
                    "格式：WAV（推薦）/ MP3 / FLAC",
                    "取樣率：建議 16kHz 以上",
                  ].map((t, i) => (
                    <li
                      key={i}
                      className="flex gap-1 text-[10px] text-amber-600"
                    >
                      <span>•</span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={submitDisabled}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    建立 Kling 語音中...
                  </>
                ) : (
                  <>
                    <Star className="w-4 h-4 mr-2" />
                    建立 Kling 語音
                  </>
                )}
              </Button>
            </div>

            {/* Kling 結果 — 背景任務輪詢 */}
            {klingResult?.request_id &&
              klingResult?.model &&
              !klingResult?.voice_id && (
                <AsyncAudioPoller
                  result={klingResult as AudioResult}
                  onUpdate={r => setKlingResult(r)}
                  label="✅ Kling 語音建立"
                />
              )}
            {klingResult && klingResult.voice_id && (
              <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200/50">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="w-4 h-4 text-emerald-500" />
                  <p className="text-sm font-medium text-foreground">
                    Kling 語音建立成功！
                  </p>
                </div>
                <div className="space-y-2">
                  {klingResult.voice_id && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        語音 ID（複製後用於 Kling 影片生成）
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <code className="flex-1 text-xs bg-white/60 px-2 py-1 rounded border font-mono truncate">
                          {klingResult.voice_id}
                        </code>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => {
                            void copyToClipboard(klingResult.voice_id, "已複製語音 ID");
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {klingResult.name && (
                    <p className="text-xs text-muted-foreground">
                      名稱：
                      <span className="text-foreground">
                        {klingResult.name}
                      </span>
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-2">
                    💡 在「AI 形像影片」→「Kling 說話人」中使用此語音 ID
                    生成說話影片
                  </p>
                </div>
              </div>
            )}
          </ToolCard>
        )}

        {mode === "elevenlabs" && (
          <ToolCard
            icon={UserRound}
            title="ElevenLabs Instant Voice Cloning"
            description="上傳 30 秒~3 分鐘乾淨人聲，建立 voice_id，可直接在 TTS / 配音 / 變聲分頁使用"
            badge="ElevenLabs IVC"
            modelId="fal-ai/elevenlabs/voice-cloning"
            color="purple"
            defaultOpen
          >
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-violet-50/60 border border-violet-200/40">
                <p className="text-xs font-medium text-violet-700 mb-1">
                  💡 使用情境
                </p>
                <p className="hs-small !mb-0 text-violet-600">
                  克隆完成後會回傳 voice_id，可在「語音合成」分頁的 ElevenLabs
                  TTS 直接以該聲線朗讀任意文字，也可串給 Dubbing / Voice Changer。
                </p>
              </div>

              <FileUploadInput
                label="參考音訊"
                value={refAudio}
                onChange={setRefAudio}
                required
                accept="audio/*"
                placeholder="貼上 30 秒~3 分鐘乾淨人聲（mp3/wav/flac/m4a）"
                hint="建議 30 秒~3 分鐘，無背景雜音、無配樂；越乾淨越像本人"
              />

              <div>
                <Label className="text-xs text-muted-foreground">
                  聲音名稱 <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={klingName}
                  onChange={e => setKlingName(e.target.value)}
                  placeholder="例如：療癒女聲、品牌主播..."
                  className="mt-1 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">
                  聲音描述（選填）
                </Label>
                <Input
                  value={elevenDescription}
                  onChange={e => setElevenDescription(e.target.value)}
                  placeholder="柔和、溫暖、緩慢、適合冥想引導..."
                  className="mt-1 text-sm"
                />
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  幫助你日後在語音庫找到這個聲線
                </p>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={submitDisabled}
                className="w-full bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    建立 ElevenLabs 聲線中...
                  </>
                ) : (
                  <>
                    <Star className="w-4 h-4 mr-2" />
                    建立 ElevenLabs 聲線
                  </>
                )}
              </Button>

              {klingResult?.request_id &&
                klingResult?.model === "fal-ai/elevenlabs/voice-cloning" &&
                !klingResult?.voice_id && (
                  <AsyncAudioPoller
                    result={klingResult as AudioResult}
                    onUpdate={r => setKlingResult(r)}
                    label="✅ ElevenLabs 聲線建立"
                  />
                )}
              {klingResult?.voice_id &&
                klingResult?.model === "fal-ai/elevenlabs/voice-cloning" && (
                  <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-200/50">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-4 h-4 text-emerald-500" />
                      <p className="text-sm font-medium text-foreground">
                        ElevenLabs 聲線建立成功！
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="flex-1 text-xs bg-white/60 px-2 py-1 rounded border font-mono truncate">
                        {klingResult.voice_id}
                      </code>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => {
                          void copyToClipboard(klingResult.voice_id, "已複製 voice_id");
                        }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground/70 mt-2">
                      💡 在「語音合成」→ ElevenLabs TTS 的 voice_id 欄位貼上即可朗讀
                    </p>
                  </div>
                )}
            </div>
          </ToolCard>
        )}
      </motion.div>
    </div>
  );
}

// ─── 音訊處理 Tab ─────────────────────────────────────────────────────────────

function ProcessTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [tool, setTool] = useState<
    "demucs" | "isolation" | "merge" | "changer"
  >("demucs");
  const [audioUrl, setAudioUrl] = useState("");
  const [audioUrls, setAudioUrls] = useState(["", ""]);
  const [mergeStrategy, setMergeStrategy] = useState<"concatenate" | "mix">(
    "concatenate"
  );
  const [demucsModel, setDemucsModel] = useState("htdemucs_ft");
  const [voiceId, setVoiceId] = useState("");
  const [removeBgNoise, setRemoveBgNoise] = useState(false);
  const [result, setResult] = useState<any>(null);

  // ── Agent Bridge：讓光球能控制音訊處理分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setAudioUrl(t),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "tool": case "model": {
          const valid = ["demucs", "isolation", "merge", "changer"];
          if (valid.includes(value)) { setTool(value as typeof tool); return true; }
          return false;
        }
        case "audioUrl": case "audio_url": { setAudioUrl(value); return true; }
        case "demucsModel": { setDemucsModel(value); return true; }
        case "mergeStrategy": {
          if (value === "concatenate" || value === "mix") { setMergeStrategy(value); return true; }
          return false;
        }
        case "voiceId": case "voice_id": { setVoiceId(value); return true; }
        case "removeBgNoise": { setRemoveBgNoise(value === "true"); return true; }
        default: return false;
      }
    },
    getState: () => ({ tool, audioUrl, audioUrls, mergeStrategy, demucsModel, voiceId, removeBgNoise }),
    reset: () => {
      setAudioUrl("");
      setAudioUrls(["", ""]);
      setMergeStrategy("concatenate");
      setDemucsModel("htdemucs_ft");
      setVoiceId("");
      setRemoveBgNoise(false);
      setResult(null);
    },
    submit: () => {
      if (tool === "merge" && audioUrls.filter(Boolean).length < 2) return false;
      if (tool === "changer" && (!audioUrl.trim() || !voiceId.trim())) return false;
      if (tool !== "merge" && tool !== "changer" && !audioUrl.trim()) return false;
      return true;
    },
  });

  const demucsMut = trpc.proStudio.demucs.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data);
      registerBgTask(data, "audio", "🎸 音幹分離");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const isoMut = trpc.proStudio.audioIsolation.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data);
      registerBgTask(data, "audio", "🔇 音訊隔離");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const mergeMut = trpc.proStudio.mergeAudios.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data);
      registerBgTask(data, "audio", "🔗 音訊合併");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const changerMut = trpc.proStudio.voiceChanger.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data);
      registerBgTask(data, "voice", "🔁 聲音變換");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  const isPending =
    demucsMut.isPending ||
    isoMut.isPending ||
    mergeMut.isPending ||
    changerMut.isPending;

  const toolConfig = {
    demucs: {
      icon: Guitar,
      label: "音幹分離",
      subLabel: "Demucs",
      desc: "AI 分離人聲、鼓、貝斯、吉他等獨立音幹",
      color: "green" as const,
    },
    isolation: {
      icon: Headphones,
      label: "音訊隔離",
      subLabel: "ElevenLabs",
      desc: "智慧去除背景噪音，提取清晰人聲",
      color: "cyan" as const,
    },
    merge: {
      icon: Merge,
      label: "多音訊合併",
      subLabel: "FFmpeg API",
      desc: "將多個音訊串接（拼接）或混音（疊加）",
      color: "orange" as const,
    },
    changer: {
      icon: Repeat2,
      label: "聲音變換",
      subLabel: "ElevenLabs",
      desc: "將音訊中的聲音更換為指定的 ElevenLabs 語音",
      color: "blue" as const,
    },
  };

  const cfg = toolConfig[tool];

  const handleProcess = () => {
    setResult(null);
    if (tool === "demucs")
      demucsMut.mutate({ audio_url: audioUrl, model: demucsModel as any });
    else if (tool === "isolation") isoMut.mutate({ audio_url: audioUrl });
    else if (tool === "merge")
      mergeMut.mutate({
        audio_urls: audioUrls.filter(Boolean),
        merge_strategy: mergeStrategy,
      });
    else
      changerMut.mutate({
        audio_url: audioUrl,
        voice_id: voiceId,
        remove_background_noise: removeBgNoise,
      });
  };

  const outputAudio = result?.audio_url ?? result?.audio?.url ?? result?.url;
  const stems = result?.stems;

  const isMergeDisabled =
    tool === "merge" && audioUrls.filter(Boolean).length < 2;
  const isChangerDisabled =
    tool === "changer" && (!audioUrl.trim() || !voiceId.trim());
  const isOtherDisabled =
    tool !== "merge" && tool !== "changer" && !audioUrl.trim();
  const submitDisabled =
    isPending || isMergeDisabled || isChangerDisabled || isOtherDisabled;

  return (
    <div className="space-y-4">
      {/* 工具選擇 */}
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(toolConfig) as Array<keyof typeof toolConfig>).map(k => {
          const { icon: Ic, label, subLabel } = toolConfig[k];
          return (
            <button
              key={k}
              onClick={() => {
                setTool(k);
                setResult(null);
              }}
              className={`p-3 rounded-xl border text-left transition-all ${tool === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Ic className="w-3.5 h-3.5" />
                <p className="text-xs font-semibold">{label}</p>
              </div>
              <p
                className={`text-[10px] ${tool === k ? "text-primary-foreground/70" : "text-muted-foreground"}`}
              >
                {subLabel}
              </p>
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
            tool === "demucs"
              ? "fal-ai/demucs"
              : tool === "isolation"
                ? "fal-ai/elevenlabs/audio-isolation"
                : tool === "merge"
                  ? "fal-ai/ffmpeg-api/merge-audios"
                  : "fal-ai/elevenlabs/voice-changer"
          }
          color={cfg.color}
          defaultOpen
        >
          <div className="space-y-3">
            {/* 音訊輸入 */}
            {tool !== "merge" ? (
              <FileUploadInput
                label="音訊"
                value={audioUrl}
                onChange={setAudioUrl}
                required
                accept="audio/*"
                hint="支援 mp3、wav、flac，最大 16MB"
              />
            ) : (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  音訊列表（最少 2 個）
                  <span className="text-destructive ml-0.5">*</span>
                </Label>
                {audioUrls.map((u, i) => (
                  <div key={i} className="space-y-1">
                    <FileUploadInput
                      label={`音訊 ${i + 1}`}
                      value={u}
                      onChange={v => {
                        const next = [...audioUrls];
                        next[i] = v;
                        setAudioUrls(next);
                      }}
                      accept="audio/*"
                    />
                    {i > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive h-6 px-2"
                        onClick={() =>
                          setAudioUrls(audioUrls.filter((_, j) => j !== i))
                        }
                      >
                        移除此音訊
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs w-full"
                  onClick={() => setAudioUrls([...audioUrls, ""])}
                >
                  + 新增音訊
                </Button>
              </div>
            )}

            {/* Demucs 設定 */}
            {tool === "demucs" && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  分離模型
                </Label>
                <Select value={demucsModel} onValueChange={setDemucsModel}>
                  <SelectTrigger className="mt-1 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="htdemucs_ft">
                      htdemucs_ft — 最高品質（推薦）
                    </SelectItem>
                    <SelectItem value="htdemucs">
                      htdemucs — 標準（4 音幹）
                    </SelectItem>
                    <SelectItem value="htdemucs_6s">
                      htdemucs_6s — 6 音幹（含琴、鋼琴）
                    </SelectItem>
                    <SelectItem value="mdx">MDX — 競賽版</SelectItem>
                    <SelectItem value="mdx_extra">
                      MDX Extra — 競賽增強版
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Merge 設定 */}
            {tool === "merge" && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  合併方式
                </Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    variant={
                      mergeStrategy === "concatenate" ? "default" : "outline"
                    }
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
                  <Label className="text-xs text-muted-foreground">
                    目標語音 ID <span className="text-destructive">*</span>
                  </Label>
                  {/* 快選 */}
                  <div className="mt-1 flex flex-wrap gap-1 mb-2">
                    {[
                      { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel 女聲" },
                      { id: "ErXwobaYiN019PkySvjV", label: "Antoni 男聲" },
                      { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh 男聲" },
                      { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella 女聲" },
                    ].map(v => (
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
                    onChange={e => setVoiceId(e.target.value)}
                    placeholder="或貼上自訂 ElevenLabs voice_id"
                    className="text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    💡 點擊上方快選，或到{" "}
                    <a
                      href="https://elevenlabs.io/voice-library"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Voice Library
                    </a>{" "}
                    取得更多
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={removeBgNoise}
                    onCheckedChange={setRemoveBgNoise}
                    id="rmBg"
                  />
                  <Label
                    htmlFor="rmBg"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    變換前去除背景噪音
                  </Label>
                </div>
              </>
            )}

            <Button
              onClick={handleProcess}
              disabled={submitDisabled}
              className="w-full btn-healing"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  處理中（可能需要 30-120 秒）...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  開始處理
                </>
              )}
            </Button>
          </div>

          {/* 輸出結果 */}
          {result?.request_id && result?.model && !outputAudio && !stems && (
            <AsyncAudioPoller
              result={result as AudioResult}
              onUpdate={setResult}
              label={`✅ ${cfg.label}結果`}
            />
          )}
          {outputAudio && <AudioPlayer url={outputAudio} label="✅ 處理結果" />}
          {stems && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                🎸 分離音幹：
              </p>
              {Object.entries(stems as Record<string, string>).map(
                ([stem, url]) => (
                  <AudioPlayer key={stem} url={url} label={`音幹：${stem}`} />
                )
              )}
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
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [audioUrl, setAudioUrl] = useState("");
  const [acceleration, setAcceleration] = useState<
    "none" | "low" | "medium" | "high"
  >("none");
  const [result, setResult] = useState<any>(null);

  // ── Agent Bridge：讓光球能控制語音識別分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setAudioUrl(t),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "audioUrl": case "audio_url": { setAudioUrl(value); return true; }
        case "acceleration": {
          const valid = ["none", "low", "medium", "high"];
          if (valid.includes(value)) { setAcceleration(value as typeof acceleration); return true; }
          return false;
        }
        default: return false;
      }
    },
    getState: () => ({ audioUrl, acceleration }),
    reset: () => {
      setAudioUrl("");
      setAcceleration("none");
      setResult(null);
    },
    submit: () => { if (!audioUrl.trim()) return false; return true; },
  });

  const mutation = trpc.proStudio.speechToText.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setResult(data);
      registerBgTask(data, "audio", "📝 語音識別");
      toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
      reportSuccess();
    },
    onError: e => {
      toast.error(`失敗：${e.message}`);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
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
        defaultOpen
      >
        <div className="space-y-3">
          <FileUploadInput
            label="音訊"
            value={audioUrl}
            onChange={setAudioUrl}
            required
            accept="audio/*"
            hint="支援 mp3、wav、flac、m4a 等格式，最大 16MB"
          />

          {/* Nemotron ASR 自動偵測語言，不支援 language/task 參數 */}
          <div className="p-3 rounded-lg bg-green-50/50 border border-green-200/40">
            <p className="text-[11px] text-green-700">
              💡 Nemotron ASR <strong>自動偵測語言</strong>
              （支援中文、英文、日文等），無需手動選擇。
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">加速模式</Label>
            <Select
              value={acceleration}
              onValueChange={v => setAcceleration(v as any)}
            >
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
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              加速越高速度越快，但準確度略低
            </p>
          </div>

          <Button
            onClick={() =>
              mutation.mutate({ audio_url: audioUrl, acceleration })
            }
            disabled={mutation.isPending || !audioUrl.trim()}
            className="w-full btn-healing"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                識別中...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                開始識別
              </>
            )}
          </Button>
        </div>

        {text && (
          <div className="mt-4 p-3 rounded-xl bg-white/60 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground font-medium">
                📝 識別結果：
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => {
                  void copyToClipboard(text, "已複製");
                }}
              >
                <Copy className="w-3 h-3 mr-1" /> 複製
              </Button>
            </div>
            <p className="hs-p !mb-0 text-foreground whitespace-pre-wrap">
              {text}
            </p>
          </div>
        )}
      </ToolCard>
    </div>
  );
}

// ─── AI 形像影片 Tab ──────────────────────────────────────────────────────────

function AvatarVideoTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [model, setModel] = useState<
    "wan" | "echo" | "stable" | "longcat" | "ltx" | "dubbing"
  >("echo");
  const [imageUrl, setImageUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [jobInfo, setJobInfo] = useState<{
    request_id: string;
    model: string;
  } | null>(null);

  // ── Agent Bridge：讓光球能控制 AI 形像影片分頁參數 ──
  useProStudioAgentBridge({
    fillPrompt: (t: string) => setPrompt(t),
    setParam: (key: string, value: string) => {
      switch (key) {
        case "model": {
          const valid = ["wan", "echo", "stable", "longcat", "ltx", "dubbing"];
          if (valid.includes(value)) { setModel(value as typeof model); return true; }
          return false;
        }
        case "imageUrl": case "image_url": { setImageUrl(value); return true; }
        case "audioUrl": case "audio_url": { setAudioUrl(value); return true; }
        case "videoUrl": case "video_url": { setVideoUrl(value); return true; }
        case "targetLang": case "target_language": { setTargetLang(value); return true; }
        default: return false;
      }
    },
    getState: () => ({ model, imageUrl, audioUrl, videoUrl, prompt, targetLang }),
    reset: () => {
      setImageUrl("");
      setAudioUrl("");
      setVideoUrl("");
      setPrompt("");
      setTargetLang("en");
      setJobInfo(null);
    },
    submit: () => {
      if (model === "wan" && (!imageUrl.trim() || !audioUrl.trim())) return false;
      if (model === "echo" && !imageUrl.trim()) return false;
      if (model === "stable" && (!imageUrl.trim() || !audioUrl.trim())) return false;
      if (model === "longcat" && (!imageUrl.trim() || !audioUrl.trim())) return false;
      if (model === "ltx" && (!prompt.trim() || !audioUrl.trim())) return false;
      if (model === "dubbing" && !videoUrl.trim() && !audioUrl.trim()) return false;
      return true;
    },
    setModel: (modelId: string) => {
      const idToKey: Record<string, typeof model> = {
        "wan-s2v": "wan",
        "echo-mimic": "echo",
        "stable-avatar": "stable",
        "longcat": "longcat",
        "ltx-a2v": "ltx",
        "dubbing": "dubbing",
      };
      const key = idToKey[modelId];
      if (key) { setModel(key); return true; }
      return false;
    },
  });

  const modelConfig = {
    wan: {
      label: "Wan 說話人",
      desc: "圖片＋音訊 → 說話影片｜需：圖片＋音訊",
      badge: "Wan 14B",
      color: "purple" as const,
    },
    echo: {
      label: "EchoMimic V3",
      desc: "形像驅動｜需：圖片（音訊/文字選填）",
      badge: "EchoMimic",
      color: "blue" as const,
    },
    stable: {
      label: "Stable Avatar",
      desc: "音訊驅動頭像，最長 5 分鐘｜需：圖片＋音訊",
      badge: "Stable",
      color: "green" as const,
    },
    longcat: {
      label: "LongCat Avatar",
      desc: "超逼真唇形同步｜需：圖片＋音訊",
      badge: "LongCat",
      color: "orange" as const,
    },
    ltx: {
      label: "LTX-2 音訊→影片",
      desc: "音訊＋文字生成影片｜需：提示詞＋音訊",
      badge: "LTX-2 19B",
      color: "cyan" as const,
    },
    dubbing: {
      label: "ElevenLabs 配音",
      desc: "AI 翻譯配音｜需：影片或音訊 URL",
      badge: "Dubbing",
      color: "pink" as const,
    },
  };

  const modelIds: Record<string, string> = {
    wan: "fal-ai/wan/v2.2-14b/speech-to-video",
    echo: "fal-ai/echomimic-v3",
    stable: "fal-ai/stable-avatar",
    longcat: "fal-ai/longcat-single-avatar/audio-to-video",
    ltx: "fal-ai/ltx-2-19b/distilled/audio-to-video/lora",
    dubbing: "fal-ai/elevenlabs/dubbing",
  };

  const wanMut = trpc.proStudio.speechToVideo.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 Wan 說話人", prompt);
      toast.success("🎬 任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const echoMut = trpc.proStudio.echoMimic.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 EchoMimic");
      toast.success("🎬 任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const stableMut = trpc.proStudio.stableAvatar.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 Stable Avatar");
      toast.success("🎬 任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const longcatMut = trpc.proStudio.longcatAvatar.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 LongCat Avatar");
      toast.success("🎬 任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const ltxMut = trpc.proStudio.ltxAudioToVideo.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 LTX 音訊→影片");
      toast.success("🎬 任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });
  const dubbingMut = trpc.proStudio.dubbing.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: d => {
      setJobInfo(d);
      registerBgTask(d, "video", "🎬 ElevenLabs 配音");
      toast.success("🎬 配音任務已提交！");
      reportSuccess();
    },
    onError: e => {
      toast.error(e.message);
      reportFailure();
    },
    onSettled: () => setAIState("idle"),
  });

  // 使用 checkAudioStatus（已擴充 video_url 萃取）取代裸 jobStatus：
  // - jobStatus 只回 queue state，沒有 result payload，前端永遠拿不到 video URL
  // - checkAudioStatus 在 COMPLETED 時會自動 falQueueResult + localizeResultUrls
  //   ，回傳的 video_url 已持久化到自家 S3，不受 fal.ai CDN 過期影響
  const [statusSubmittedAt] = useState(() => Date.now());
  const statusQuery = trpc.proStudio.checkAudioStatus.useQuery(
    {
      requestId: jobInfo?.request_id ?? "",
      model: jobInfo?.model ?? "",
      submittedAt: statusSubmittedAt,
    },
    {
      enabled: !!jobInfo && !!jobInfo.request_id,
      refetchInterval: query => {
        const s = (query.state.data as any)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: false,
      retry: 5,
    }
  );

  const isPending =
    wanMut.isPending ||
    echoMut.isPending ||
    stableMut.isPending ||
    longcatMut.isPending ||
    ltxMut.isPending ||
    dubbingMut.isPending;
  const jobStatus = (statusQuery.data as any)?.status;
  // checkAudioStatus 已 S3 本地化並萃取出 video_url（支援 dubbing / avatar 全部模型）
  const videoResult =
    (statusQuery.data as any)?.video_url ??
    (statusQuery.data as any)?.audio_url ??
    null;

  // 每個模型的必填欄位驗證
  const isGenerateDisabled =
    isPending ||
    (() => {
      if (model === "wan") return !imageUrl.trim() || !audioUrl.trim();
      if (model === "echo") return !imageUrl.trim();
      if (model === "stable") return !imageUrl.trim() || !audioUrl.trim();
      if (model === "longcat") return !imageUrl.trim() || !audioUrl.trim();
      if (model === "ltx") return !prompt.trim() || !audioUrl.trim();
      if (model === "dubbing") return !videoUrl.trim() && !audioUrl.trim();
      return false;
    })();

  const handleGenerate = () => {
    setJobInfo(null);
    if (model === "wan")
      wanMut.mutate({
        image_url: imageUrl,
        audio_url: audioUrl,
        prompt: prompt || undefined,
      });
    if (model === "echo")
      echoMut.mutate({
        image_url: imageUrl,
        audio_url: audioUrl || undefined,
        text: prompt || undefined,
      });
    if (model === "stable")
      stableMut.mutate({ image_url: imageUrl, audio_url: audioUrl });
    if (model === "longcat")
      longcatMut.mutate({
        image_url: imageUrl,
        audio_url: audioUrl,
        prompt: prompt || undefined,
      });
    if (model === "ltx")
      ltxMut.mutate({
        prompt,
        audio_url: audioUrl,
        image_url: imageUrl || undefined,
      });
    if (model === "dubbing")
      dubbingMut.mutate({
        video_url: videoUrl || undefined,
        audio_url: audioUrl || undefined,
        target_language: targetLang,
      });
  };

  const cfg = modelConfig[model];

  return (
    <div className="space-y-4">
      {/* 模型選擇 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {(Object.keys(modelConfig) as Array<keyof typeof modelConfig>).map(
          k => (
            <button
              key={k}
              onClick={() => {
                setModel(k);
                setJobInfo(null);
              }}
              className={`p-3 rounded-xl border text-left transition-all ${model === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent border-border"}`}
            >
              <p className="text-[11px] font-semibold leading-tight">
                {modelConfig[k].label}
              </p>
              <Badge
                variant={model === k ? "outline" : "secondary"}
                className={`text-[9px] px-1 py-0 mt-1 ${model === k ? "border-white/30 text-white/80" : ""}`}
              >
                {modelConfig[k].badge}
              </Badge>
            </button>
          )
        )}
      </div>

      <motion.div key={model} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <ToolCard
          icon={Film}
          title={cfg.label}
          description={cfg.desc}
          badge={cfg.badge}
          modelId={modelIds[model]}
          color={cfg.color}
          defaultOpen
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
                hint={
                  model === "echo"
                    ? "EchoMimic V3：可選填音訊或在下方輸入文字提示詞"
                    : "支援 mp3、wav，最大 16MB"
                }
              />
            )}

            {/* Dubbing 特殊輸入 */}
            {model === "dubbing" && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    影片 URL（與音訊二選一）
                  </Label>
                  <Input
                    value={videoUrl}
                    onChange={e => setVideoUrl(e.target.value)}
                    placeholder="貼上影片 URL（mp4）"
                    className="mt-1 text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    影片格式：mp4，ElevenLabs Dubbing 僅接受
                    URL（不支援直接上傳）
                  </p>
                </div>
                <FileUploadInput
                  label="音訊（與影片二選一）"
                  value={audioUrl}
                  onChange={setAudioUrl}
                  accept="audio/*"
                  hint="支援 mp3、wav，最大 16MB"
                />
                <div>
                  <Label className="text-xs text-muted-foreground">
                    目標語言
                  </Label>
                  <Select value={targetLang} onValueChange={setTargetLang}>
                    <SelectTrigger className="mt-1 text-sm">
                      <SelectValue />
                    </SelectTrigger>
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
            {(model === "wan" ||
              model === "echo" ||
              model === "longcat" ||
              model === "ltx") && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  提示詞
                  {model === "ltx" ? (
                    <span className="text-destructive ml-0.5">*</span>
                  ) : (
                    "（選填）"
                  )}
                </Label>
                <Textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder={
                    model === "ltx"
                      ? "描述影片場景、風格..."
                      : "描述想要的動作、表情、場景..."
                  }
                  className="mt-1 text-sm resize-none h-16"
                />
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isGenerateDisabled}
              className="w-full btn-healing"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  提交中（非同步，1-5 分鐘）...
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 mr-2" />
                  生成影片（非同步）
                </>
              )}
            </Button>
            {isGenerateDisabled && !isPending && (
              <p className="text-[10px] text-amber-600 text-center">
                {model === "ltx"
                  ? "⚠️ 請填寫提示詞和音訊"
                  : model === "dubbing"
                    ? "⚠️ 請提供影片或音訊 URL"
                    : model === "echo"
                      ? "⚠️ 請提供人物圖片"
                      : "⚠️ 請填寫圖片和音訊"}
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
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    <Badge variant="secondary">
                      {jobStatus ?? "處理中..."}
                    </Badge>
                  </>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate">
                ID: {jobInfo.request_id}
              </p>
              {/* 影片結果（wan / echo / stable / longcat / ltx / dubbing 共用）*/}
              {(statusQuery.data as any)?.video_url && (
                <VideoPlayer
                  url={(statusQuery.data as any).video_url}
                  label={model === "dubbing" ? "🎬 配音影片" : "🎬 生成影片"}
                />
              )}
              {/* 配音「純音訊」回傳路徑（dubbing 上傳音訊時 fal 只給 audio.url）*/}
              {!(statusQuery.data as any)?.video_url &&
                (statusQuery.data as any)?.audio_url && (
                  <AudioPlayer
                    url={(statusQuery.data as any).audio_url}
                    label="🎙️ 配音音訊"
                  />
                )}
            </div>
          )}
        </ToolCard>
      </motion.div>

      {/* 說明 */}
      <div className="rounded-xl p-3 bg-blue-50/50 border border-blue-200/40">
        <p className="text-[11px] text-blue-700">
          💡 影片生成為非同步任務，提交後系統每 3
          秒自動查詢狀態，完成後自動顯示結果。 通常需要 1-5 分鐘，請耐心等候。
        </p>
      </div>
    </div>
  );
}

// ─── 主頁面 ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: "music", label: "音樂生成", icon: Music2, component: MusicTab, desc: "AI 作曲 · 多模型 · 風格標籤" },
  { id: "sfx", label: "音效生成", icon: Volume2, component: SoundEffectsTab, desc: "環境音效 · Foley · 擬真聲音" },
  { id: "tts", label: "語音合成", icon: Mic2, component: TTSTab, desc: "中英文 · 多語言 · 自然語音" },
  { id: "clone", label: "聲音克隆", icon: UserRound, component: CloneTab, desc: "零次學習 · 多說話者 · 語音設計" },
  { id: "process", label: "音訊處理", icon: Waves, component: ProcessTab, desc: "音幹分離 · 去噪 · 合併 · 變聲" },
  { id: "asr", label: "語音識別", icon: FileText, component: ASRTab, desc: "多語言語音轉文字 · 高精度" },
  { id: "avatar", label: "AI 形像影片", icon: Film, component: AvatarVideoTab, desc: "說話人 · 口型同步 · 配音翻譯" },
];

export default function ProStudio() {
  // 全站新手引導
  usePageTour("pro-studio");
  const { openDrawer: openAssetsDrawer } = useAssetsDrawer();
  // 世界觀上下文：ProStudio 的輸入大多是腳本（TTS）或標籤（音樂），
  // 自動注入會污染語音內容，所以這裡只顯示 sidebar 提供視覺參考——
  // 用戶可從 sidebar 看到當前世界觀，再手動把音樂主題或角色聲音特徵
  // 複製到對應欄位。不做自動注入。
  const worldCtx = useWorldContext();

  // ── AI Agent Integration ──
  const { setPageContext } = useAIState();

  const [tab, setTab] = useState(() => {
    // 容許從 URL ?tab= 帶入初始分頁，例如 Studio 進階按鈕跳轉時帶 ?tab=tts。
    if (typeof window === "undefined") return "music";
    const initial = new URLSearchParams(window.location.search).get("tab");
    return initial && TABS.some(t => t.id === initial) ? initial : "music";
  });
  const apiKeyQuery = trpc.proStudio.checkApiKey.useQuery();
  const hasKey = apiKeyQuery.data?.configured;

  const ActiveTab = TABS.find(t => t.id === tab)?.component ?? MusicTab;

  // ── Agent Bridge Ref：子分頁註冊自己的 bridge，父層透過此 ref 呼叫 ──
  const bridgeRef = useRef<ProStudioAgentBridge>({});
  const pendingModelIdRef = useRef<string | null>(null);

  // ── 全站光球多步驟代理：跨分頁 fillPrompt / setParam / submit 排隊 ──
  // 多步驟流程裡常見的 race：上一步 setTab(tts)，下一步馬上 fillPrompt。
  // setTab 觸發 React state change，但目標子分頁尚未掛載並透過
  // useProStudioAgentBridge 重設 bridgeRef → 這時候 fillPrompt 會打到
  // 舊分頁（音樂）的 bridge 或回 fn=null，使用者切到新分頁就看到空提示詞。
  // 用 ref 暫存待派發 payload，等 tab 真正切到目標 + bridge 註冊完再 drain。
  type PendingAgentPayload = {
    targetTab: string;
    fillPrompt?: string;
    setParam?: Array<{ key: string; value: string }>;
    submit?: boolean;
  };
  const pendingAgentPayloadRef = useRef<PendingAgentPayload | null>(null);
  const [agentDrainTick, setAgentDrainTick] = useState(0);
  const requestAgentDrain = useCallback(() => {
    setAgentDrainTick(prev => prev + 1);
  }, []);

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({
      pageId: "pro-studio",
      pageLabel: "音樂配音創作室",
      activeTab: tab,
    });
    return () => setPageContext(null);
  }, [tab, setPageContext]);

  // Consume pending model selection after tab switch renders and bridge is updated
  useEffect(() => {
    const pending = pendingModelIdRef.current;
    if (pending) {
      pendingModelIdRef.current = null;
      bridgeRef.current.setModel?.(pending);
    }
  }, [tab]);

  const [, navigate] = useLocation();

  // ── Director AI 來源情境（從 sendToStudio 載入後保留，用於「回到導演 AI」回填）──
  const [directorContext, setDirectorContext] = useState<{
    sceneName: string;
    sceneHeading?: string;
    mood?: string;
  } | null>(null);

  // 暫存待派發 prompt，等 setTab 切到 targetTab 之後再透過 bridgeRef.fillPrompt 寫入
  const [pendingDirectorPayload, setPendingDirectorPayload] = useState<{
    prompt?: string;
    targetTab: string;
  } | null>(null);

  // ── Restore Director AI sendToStudio payload (audio/voice path) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sendToStudio");
      if (!raw) return;
      const data = JSON.parse(raw) as {
        prompt?: string;
        generationType?: string;
        overrideEngine?: string;
        source?: string;
        sceneName?: string;
        segmentContext?: { sceneHeading?: string; mood?: string };
        musicStyle?: string;
        audioScript?: string;
      };
      if (data.generationType !== "audio" && data.generationType !== "voice") {
        return;
      }

      const canonical = data.overrideEngine
        ? normalizeEngineModelId(data.overrideEngine)
        : "";
      let targetTab = "music";
      if (data.generationType === "voice") {
        targetTab = "tts";
      } else if (
        canonical.startsWith("fal-ai/stable-audio") ||
        canonical.startsWith("fal-ai/musicgen") ||
        canonical.startsWith("fal-ai/ace-step") ||
        canonical.startsWith("fal-ai/sonauto")
      ) {
        targetTab = "music";
      } else {
        targetTab = "sfx";
      }
      setTab(targetTab);

      if (data.source === "director_ai" && data.sceneName) {
        setDirectorContext({
          sceneName: data.sceneName,
          sceneHeading: data.segmentContext?.sceneHeading,
          mood: data.segmentContext?.mood,
        });
      }

      // music tab 走 musicStyle，tts 走 audioScript，sfx 走 prompt
      const promptText =
        data.generationType === "voice"
          ? (data.audioScript ?? data.prompt)
          : targetTab === "music"
            ? (data.musicStyle ?? data.prompt)
            : data.prompt;

      if (promptText) {
        setPendingDirectorPayload({ prompt: promptText, targetTab });
      }

      sessionStorage.removeItem("sendToStudio");
      toast.success(
        data.source === "director_ai" && data.sceneName
          ? `已從導演 AI 載入「${data.sceneName}」到音樂配音創作室`
          : "已載入導演 AI 設定到音樂配音創作室"
      );
    } catch {
      // silent
    }
  }, []);

  // ── Drain pending payload once the right tab has mounted & registered bridge ──
  useEffect(() => {
    if (!pendingDirectorPayload) return;
    if (tab !== pendingDirectorPayload.targetTab) return;
    const fn = bridgeRef.current.fillPrompt;
    if (fn && pendingDirectorPayload.prompt) {
      fn(pendingDirectorPayload.prompt);
    }
    setPendingDirectorPayload(null);
  }, [pendingDirectorPayload, tab]);

  // ── 全站光球多步驟代理：tab 切到目標後，把暫存的 fillPrompt / setParam /
  // submit 真正灌進子分頁。bridgeRef 在子分頁 render 時被覆寫，所以這個
  // effect 會在 commit 後拿到最新的 fn；若子分頁掛太慢還沒寫入 bridge，
  // 用 RAF 重試最多 ~10 次（≈ 160ms）。
  useEffect(() => {
    const pending = pendingAgentPayloadRef.current;
    if (!pending) return;
    if (pending.targetTab && pending.targetTab !== tab) return;

    let cancelled = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 10;

    const drain = () => {
      if (cancelled) return;
      const current = pendingAgentPayloadRef.current;
      if (!current) return;
      if (current.targetTab && current.targetTab !== tab) return;

      const fillPromptFn = bridgeRef.current.fillPrompt;
      const setParamFn = bridgeRef.current.setParam;
      const submitFn = bridgeRef.current.submit;

      const needsFill = current.fillPrompt !== undefined;
      const needsParam = (current.setParam?.length ?? 0) > 0;
      const needsSubmit = current.submit === true;

      const ready =
        (!needsFill || !!fillPromptFn) &&
        (!needsParam || !!setParamFn) &&
        (!needsSubmit || !!submitFn);

      if (!ready) {
        if (attempt < MAX_ATTEMPTS) {
          attempt += 1;
          window.requestAnimationFrame(drain);
        }
        return;
      }

      if (needsFill && fillPromptFn) fillPromptFn(current.fillPrompt!);
      if (needsParam && setParamFn) {
        for (const { key, value } of current.setParam!) setParamFn(key, value);
      }
      if (needsSubmit && submitFn) submitFn();
      pendingAgentPayloadRef.current = null;
    };

    drain();
    return () => {
      cancelled = true;
    };
  }, [tab, agentDrainTick]);

  // ── 回到導演 AI：把目前 prompt + tab 寫進 directorReturn 並跳回 /director ──
  const handleReturnToDirector = useCallback(() => {
    if (!directorContext) return;
    const childState = bridgeRef.current.getState?.() ?? {};
    const finalPrompt =
      typeof childState.prompt === "string"
        ? childState.prompt
        : typeof childState.text === "string"
          ? childState.text
          : "";
    try {
      sessionStorage.setItem(
        "directorReturn",
        JSON.stringify({
          source: "pro_studio",
          sceneName: directorContext.sceneName,
          sceneHeading: directorContext.sceneHeading,
          mood: directorContext.mood,
          finalPrompt,
          modelId: tab,
          resultUrl: null,
          ts: Date.now(),
        })
      );
    } catch {
      // sessionStorage 滿/不可用就靜默
    }
    navigate("/director");
  }, [directorContext, tab, navigate]);

  // ── Restore applied model from Models/LoraTrainer (voice clone path) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("applyModel");
      if (!raw) return;
      const data = JSON.parse(raw) as {
        id?: number;
        name?: string;
        modelType?: string;
      };
      if (data.modelType !== "voice_clone") return;

      setTab("clone");
      sessionStorage.removeItem("applyModel");
      toast.success(
        `已載入模型「${data.name ?? "語音模型"}」到專業創作室，請在「聲音克隆」工具箱繼續生成`
      );
    } catch {
      // silent
    }
  }, []);

  // ── 光球代理人：音訊創作室 ───────────────────────────────────────────
  // 7 分頁、24+ 模型分散在子元件。頁面層只做 setTab + 模型語意對照。
  const PRO_MODELS: Array<{
    id: string;
    label: string;
    tab: string;
    desc: string;
    bestFor?: string;
    tip?: string;
    advantages?: string[];
  }> = [
    // music (6 — fal.ai 4 + Suno 2)
    { id: "sonauto", label: "Sonauto", tab: "music", desc: "AI 作曲、支援歌詞", bestFor: "快速從文字到完整歌曲", tip: "要快速做 demo 或旋律草稿，Sonauto 很省時間。", advantages: ["出歌快", "歌詞友善"] },
    { id: "ace-step", label: "ACE-Step", tab: "music", desc: "高品質音樂生成", bestFor: "高品質成品導向", tip: "適合最終成片用配樂，先確定情緒再生成。", advantages: ["品質高", "層次感佳"] },
    { id: "stable-audio", label: "Stable Audio", tab: "music", desc: "Stability 音樂模型", bestFor: "可控參數與穩定輸出", tip: "要做可重複測試的工作流，Stable Audio 很穩。", advantages: ["穩定", "可控"] },
    { id: "musicgen", label: "MusicGen", tab: "music", desc: "Meta 音樂生成", bestFor: "研究與風格探索", tip: "先做多版風格探索，再挑方向精修。", advantages: ["探索彈性高", "迭代快"] },
    { id: "suno-v3.5", label: "Suno v3.5", tab: "music", desc: "Suno API 完整歌曲（穩定預設）", bestFor: "需要人聲＋伴奏的完整歌曲", tip: "Custom Mode 可指定歌詞與風格；產出是真完整歌曲。", advantages: ["人聲＋伴奏", "歌詞友善", "Suno 直連"] },
    { id: "suno-v4", label: "Suno v4", tab: "music", desc: "Suno API 高品質頂規", bestFor: "對音質與和聲層次要求最高的成品", tip: "成本較高但音樂張力與層次最豐富，適合 final cut。", advantages: ["最高品質", "情緒層次佳"] },
    // sfx (1)
    { id: "sfx", label: "Sound Effects", tab: "sfx", desc: "文字生音效", bestFor: "場景音效製作", tip: "描述要包含材質、距離與空間感，會更像真實 Foley。", advantages: ["擬真音效", "快速產出"] },
    // tts (2+)
    { id: "eleven-tts", label: "ElevenLabs TTS", tab: "tts", desc: "多語言、多情緒", bestFor: "商業配音與角色旁白", tip: "需要情緒與品牌聲線時，優先 ElevenLabs。", advantages: ["情緒表現強", "語種多"] },
    { id: "qwen-tts", label: "Qwen TTS", tab: "tts", desc: "中文友善、自然語氣", bestFor: "中文敘事與口語自然度", tip: "中文長句表現穩，適合教學、導覽、解說。", advantages: ["中文自然", "語氣穩定"] },
    // clone (4)
    { id: "qwen-clone", label: "Qwen 克隆並朗讀", tab: "clone", desc: "上傳樣本 → 用樣本聲朗讀", bestFor: "快速個人聲線複製", tip: "樣本越乾淨、越少背景噪音，克隆穩定度越高。", advantages: ["上手快", "中文友善"] },
    { id: "dia-clone", label: "Dia TTS 聲音克隆", tab: "clone", desc: "Dia TTS voice clone", bestFor: "清晰朗讀類任務", tip: "適合旁白與資訊播報型內容。", advantages: ["清晰度好", "穩定朗讀"] },
    { id: "voice-design", label: "Qwen 聲音設計", tab: "clone", desc: "自定義音色", bestFor: "虛擬角色聲音設計", tip: "先明確角色年齡、情緒與語速，再生成更準。", advantages: ["可塑性高", "角色感強"] },
    { id: "eleven-ivc", label: "ElevenLabs IVC 聲線克隆", tab: "clone", desc: "建 voice_id，可複用於 ElevenLabs 全家族 TTS / 配音 / 變聲", bestFor: "需要跨工具（TTS、Dubbing、Voice Changer）共用聲線時", tip: "上傳 30 秒~3 分鐘乾淨人聲；得到 voice_id 後直接貼到 TTS / 變聲分頁使用。", advantages: ["跨 ElevenLabs 全家族復用", "voice_id 可永久保存"] },
    { id: "kling-voice", label: "Kling 建立聲音", tab: "clone", desc: "Kling 聲音建檔", bestFor: "Kling 生態內聲音資產", tip: "若後續會進 Kling 視訊流程，建議先建好聲音檔。", advantages: ["流程銜接好", "一致性高"] },
    // process (4)
    { id: "demucs", label: "Demucs 分軌", tab: "process", desc: "人聲 / 樂器分離", bestFor: "Remix 與伴奏抽離", tip: "先分軌再做音效或混音，流程更乾淨。", advantages: ["分離效果好", "後製友善"] },
    { id: "iso", label: "Audio Isolation", tab: "process", desc: "去噪、單軌萃取", bestFor: "口語去噪與收音修復", tip: "採訪與 vlog 類素材先做 isolation 成效很明顯。", advantages: ["降噪強", "人聲突出"] },
    { id: "merge", label: "音訊合併", tab: "process", desc: "多軌混音", bestFor: "背景音樂 + 人聲整合", tip: "建議先統一音量再合併，避免爆音。", advantages: ["流程簡單", "快速混音"] },
    { id: "voice-changer", label: "變聲器", tab: "process", desc: "Voice Changer", bestFor: "角色變聲與語氣轉換", tip: "先用短句測試，確認音色方向後再批量處理。", advantages: ["角色化效果", "變化明顯"] },
    // asr (1)
    { id: "asr", label: "Speech to Text", tab: "asr", desc: "語音辨識、字幕", bestFor: "逐字稿與字幕初稿", tip: "口齒清晰與背景噪音低時，辨識準確率最佳。", advantages: ["轉錄快", "字幕友善"] },
    // avatar (6)
    { id: "wan-s2v", label: "Wan Speech-to-Video", tab: "avatar", desc: "語音 → 角色說話影片", bestFor: "快速口播角色影片", tip: "語音節奏清楚時，嘴型同步更穩定。", advantages: ["轉影片快", "同步自然"] },
    { id: "echo-mimic", label: "EchoMimic", tab: "avatar", desc: "口型同步", bestFor: "精準嘴型對齊", tip: "短句測試口型後再長段輸出，成功率更高。", advantages: ["口型精準", "表情連動佳"] },
    { id: "stable-avatar", label: "Stable Avatar", tab: "avatar", desc: "穩定人像動畫", bestFor: "穩定主播型內容", tip: "同一角色反覆輸出時，Stable Avatar 很適合。", advantages: ["一致性高", "畫面穩定"] },
    { id: "longcat", label: "LongCat Avatar", tab: "avatar", desc: "長時間 avatar", bestFor: "長時段講解影片", tip: "長片先分段生成再拼接，品質更可控。", advantages: ["長時長支援", "敘事友善"] },
    { id: "ltx-a2v", label: "LTX 音訊轉影片", tab: "avatar", desc: "LTX audio-to-video", bestFor: "音訊驅動動態視覺", tip: "適合想保留音訊節奏並自動生成動態畫面的場景。", advantages: ["開源流程", "音訊驅動自然"] },
    { id: "dubbing", label: "Dubbing 配音", tab: "avatar", desc: "影片配音", bestFor: "影片語言重配與本地化", tip: "先準備乾淨原始音軌與腳本，配音一致性更好。", advantages: ["本地化快", "配音流程完整"] },
  ];

  const agentCapabilities: AgentCapability[] = [
    {
      action: "setTab",
      label: "分頁",
      currentId: tab,
      options: TABS.map(t => ({ id: t.id, label: t.label })),
      hint: "music / sfx / tts / clone / process / asr / avatar 七大音訊能力",
    },
    {
      action: "setModel",
      label: "模型（語意對照）",
      options: PRO_MODELS.map(m => ({
        id: m.id,
        label: m.label,
        description: m.desc,
        meta: {
          tab: m.tab,
          bestFor: m.bestFor,
          tip: m.tip,
          advantages: m.advantages ?? [],
        },
      })),
      hint: "音訊模型選型建議：先看任務類型（music/sfx/tts/clone/process/asr/avatar），再看你要速度、自然度、一致性或可控性。setModel 會自動切到對應分頁。",
    },
    {
      action: "fillPrompt",
      label: "填入提示詞",
      hint: "填入當前分頁的主要文字輸入（prompt / text / audio_url）",
    },
    {
      action: "setParam",
      label: "設定參數",
      hint: "音樂: musicModel/duration/instrumental/lyrics/tags; 音效: sfxModel/duration/influence; TTS: engine/voiceId/stability/similarity/speed; 克隆: mode/refAudio/voiceDesc; 處理: tool/audioUrl/demucsModel/mergeStrategy/voiceId; ASR: audioUrl/acceleration; 影片: model/imageUrl/audioUrl/videoUrl/targetLang",
    },
    {
      action: "focusElement",
      label: "視覺指引",
      hint: "可用 elementId=pro-tab-music / pro-tab-tts 等引導使用者",
    },
    {
      action: "applyPreset",
      label: "氛圍預設",
      options: Object.entries(AUDIO_PRESETS).map(([id, p]) => ({
        id,
        label: p.label,
        description: `${p.tab} · ${p.modelId ?? "auto"}`,
      })),
      hint: "一鍵套用氛圍包：自動切分頁、選模型、填好 prompt 與時長",
    },
    {
      action: "reset",
      label: "清空表單",
      hint: "清空當前分頁的 prompt 與參數，回到預設值",
    },
  ];

  useRegisterPageAgent({
    pageId: "pro-studio",
    pageLabel: "音樂配音創作室",
    pagePath: "/pro-studio",
    capabilities: agentCapabilities,
    state: (() => {
      const childState = bridgeRef.current.getState?.() ?? {};
      // 從子元件 bridge 抽出最常見的 prompt / text 欄位，向光球統一暴露
      // `prompt` / `promptPreview`，避免 LLM 看不到聲學提示詞而誤判。
      const rawPrompt =
        typeof childState.prompt === "string"
          ? childState.prompt
          : typeof childState.text === "string"
          ? childState.text
          : "";
      return {
        // pro-studio 會在「音樂 / 配音」之間切換；用 activeTab 推斷實際 modality
        // 讓光球可以選擇音樂精靈或語音精靈。child state 來自子元件 bridge。
        // 音樂類 tab：music / sfx；語音類 tab：tts / clone / asr / avatar / process。
        modality:
          tab === "music" || tab === "sfx" ? "audio" : "voice",
        activeTab: tab,
        modelCount: PRO_MODELS.length,
        prompt: rawPrompt.slice(0, 120) || "(空)",
        promptLength: rawPrompt.length,
        promptPreview: rawPrompt.slice(0, 120) || "(空)",
        ...childState,
      };
    })(),
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      const result = await runProStudioAction(action);
      // Agent loop v5/v6 — overlay structured `data` so the observer
      // sees what changed (active tab, model id, whether prompt/params/
      // submit landed immediately or got queued for a pending tab
      // switch). Backwards compatible — `ok` / `message` unchanged.
      if (result.ok) {
        const pending = pendingAgentPayloadRef.current;
        const data = synthesizeProStudioData(action, pending, tab);
        if (data) return { ...result, data };
      }
      return result;
    },
  });

  function synthesizeProStudioData(
    action: AgentAction,
    pending: PendingAgentPayload | null,
    activeTab: string
  ): Record<string, unknown> | null {
    switch (action.type) {
      case "setTab": {
        const t = TABS.find(x => x.id === action.tabId);
        return { activeTab: action.tabId, activeTabLabel: t?.label };
      }
      case "setModel": {
        const m = PRO_MODELS.find(x => x.id === action.modelId);
        return {
          modelId: action.modelId,
          modelLabel: m?.label,
          modelTab: m?.tab,
        };
      }
      case "fillPrompt": {
        const expectedTab = pending?.targetTab ?? activeTab;
        return {
          promptApplied: expectedTab === activeTab,
          promptQueuedForTab: expectedTab !== activeTab ? expectedTab : undefined,
          promptPreview: String(action.text).slice(0, 120),
        };
      }
      case "setParam": {
        const expectedTab = pending?.targetTab ?? activeTab;
        return {
          paramKey: action.key,
          paramApplied: expectedTab === activeTab,
          paramQueuedForTab: expectedTab !== activeTab ? expectedTab : undefined,
        };
      }
      case "submit": {
        const expectedTab = pending?.targetTab ?? activeTab;
        return {
          submitted: expectedTab === activeTab && !pending?.fillPrompt && !pending?.setParam?.length,
          waitingFor: pending?.fillPrompt ? "prompt" : pending?.setParam?.length ? "params" : expectedTab !== activeTab ? "tab" : undefined,
        };
      }
      case "reset":
        return { reset: true };
      case "applyPreset":
        return { presetId: action.presetId };
      default:
        return null;
    }
  }

  async function runProStudioAction(
    action: AgentAction
  ): Promise<AgentActionResult> {
      const queueAgent = (
        update: (prev: PendingAgentPayload) => PendingAgentPayload,
        targetTab: string
      ) => {
        const existing = pendingAgentPayloadRef.current;
        const base: PendingAgentPayload =
          existing && existing.targetTab === targetTab
            ? existing
            : { targetTab };
        pendingAgentPayloadRef.current = update(base);
        requestAgentDrain();
      };

      switch (action.type) {
        case "setTab": {
          const t = TABS.find(x => x.id === action.tabId);
          if (!t) return { ok: false, reason: `unknown tabId: ${action.tabId}` };
          // 切到不同分頁時，把舊的暫存 payload 清掉避免錯灌到新分頁
          const existing = pendingAgentPayloadRef.current;
          if (existing && existing.targetTab !== t.id) {
            pendingAgentPayloadRef.current = null;
          }
          setTab(t.id);
          return { ok: true };
        }
        case "setModel": {
          const m = PRO_MODELS.find(x => x.id === action.modelId);
          if (!m) return { ok: false, reason: `unknown modelId: ${action.modelId}` };
          // Try bridge first (same tab); if not ready, store as pending for after tab switch
          const modelSet = bridgeRef.current.setModel?.(action.modelId);
          if (!modelSet) pendingModelIdRef.current = action.modelId;
          setTab(m.tab);
          return {
            ok: true,
            message: `已切換到「${m.label}」（${TABS.find(t => t.id === m.tab)?.label}）`,
          };
        }
        case "focusElement":
          return { ok: true };
        case "fillPrompt": {
          // 如果目前 bridge 已就緒且使用者沒有正在等待 tab 切換，直接灌進去
          const fn = bridgeRef.current.fillPrompt;
          const pending = pendingAgentPayloadRef.current;
          const expectedTab = pending?.targetTab ?? tab;
          if (fn && expectedTab === tab) {
            fn(action.text);
            return { ok: true, message: "已填入提示詞" };
          }
          // 否則暫存，等 tab 真正切到目標 + bridge 註冊完再 drain
          queueAgent(prev => ({ ...prev, fillPrompt: action.text }), expectedTab);
          return {
            ok: true,
            message: `提示詞已暫存，等切到「${TABS.find(t => t.id === expectedTab)?.label ?? expectedTab}」分頁後自動填入`,
          };
        }
        case "setParam": {
          const fn = bridgeRef.current.setParam;
          const pending = pendingAgentPayloadRef.current;
          const expectedTab = pending?.targetTab ?? tab;
          if (fn && expectedTab === tab) {
            const ok = fn(action.key, String(action.value));
            return ok ? { ok: true } : { ok: false, reason: `無法設定 ${action.key}=${action.value}` };
          }
          queueAgent(prev => ({
            ...prev,
            setParam: [...(prev.setParam ?? []), { key: action.key, value: String(action.value) }],
          }), expectedTab);
          return { ok: true, message: "參數已暫存，等分頁就緒後套用" };
        }
        case "submit": {
          const fn = bridgeRef.current.submit;
          const getState = bridgeRef.current.getState;
          const pending = pendingAgentPayloadRef.current;
          const expectedTab = pending?.targetTab ?? tab;
          if (fn && expectedTab === tab && !pending?.fillPrompt && !pending?.setParam?.length) {
            const promptState = getState?.() ?? {};
            const validation = validatePromptBeforeSubmit(expectedTab, promptState);
            if (!validation.ok) return { ok: false, reason: validation.reason };
            const ok = fn();
            return ok ? { ok: true } : { ok: false, reason: "提交條件不足：請先補齊必要欄位後再送出" };
          }
          queueAgent(prev => ({ ...prev, submit: true }), expectedTab);
          return { ok: true, message: "送出已排入佇列，等分頁與提示詞就緒後執行" };
        }
        case "reset": {
          const fn = bridgeRef.current.reset;
          if (!fn) return { ok: false, reason: "當前分頁尚未註冊 reset" };
          fn();
          return { ok: true, message: "已清空當前分頁的輸入" };
        }
        case "applyPreset": {
          // 音訊預設（preset）對應到「氛圍包」：每個 preset 把 prompt + tags + duration 一次填好
          const preset = AUDIO_PRESETS[action.presetId];
          if (!preset) {
            return {
              ok: false,
              reason: `未知 presetId: ${action.presetId}（可用：${Object.keys(AUDIO_PRESETS).join(" / ")}）`,
            };
          }
          // 切到 preset 指定分頁
          if (preset.tab !== tab) setTab(preset.tab);
          // 套用模型
          if (preset.modelId) {
            const setOk = bridgeRef.current.setModel?.(preset.modelId);
            if (!setOk) pendingModelIdRef.current = preset.modelId;
          }
          // 套用 prompt + 參數
          bridgeRef.current.fillPrompt?.(preset.prompt);
          for (const [key, value] of Object.entries(preset.params ?? {})) {
            bridgeRef.current.setParam?.(key, String(value));
          }
          return { ok: true, message: `已套用「${preset.label}」氛圍預設` };
        }
        default:
          return { ok: false, reason: "unsupported action" };
      }
  }

  const currentTabModels = PRO_MODELS.filter(m => m.tab === tab);
  const visualDensity = getVisualDensity();
  const showAdvanced = shouldShowAdvanced(visualDensity);
  const [guideKeyword, setGuideKeyword] = useState("");
  const [openGuideModelId, setOpenGuideModelId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const filteredGuideModels = useMemo(() => {
    const q = guideKeyword.trim().toLowerCase();
    if (!q) return currentTabModels;
    return currentTabModels.filter(model =>
      `${model.label} ${model.desc} ${model.bestFor ?? ""} ${model.tip ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [currentTabModels, guideKeyword]);

  return (
    <AgentBridgeContext.Provider value={bridgeRef}>
    <div className="page-shell page-shell-narrow px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-5">
      {/* 標題 */}
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
        <div className="p-2.5 sm:p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-violet-500/10 border border-purple-200/40 dark:border-purple-700/30 shrink-0">
          <Sparkles className="w-6 h-6 sm:w-7 sm:h-7 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="hs-h2 !mb-0 text-foreground">音樂配音創作室</h1>
          <p className="hs-small !mb-0 text-muted-foreground mt-0.5 leading-relaxed">
            音樂創作・配音制作・聲音克隆・AI 形像影片
            <span className="text-muted-foreground/50">
              {" "}· 點擊卡片展開使用
            </span>
          </p>
          <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-2">
            {(
              [
                "Sonauto",
                "ACE-Step",
                "Stable Audio",
                "MusicGen",
                "ElevenLabs",
                "Qwen TTS",
                "Kling",
              ] as string[]
            ).map(tag => (
              <Badge key={tag} variant="outline" className="text-[10px] transition-colors hover:bg-accent">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <button
            onClick={() => openAssetsDrawer()}
            className="hidden flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border/40 hover:bg-accent text-muted-foreground text-xs font-medium transition-colors min-h-[36px]"
            aria-label="開啟素材庫"
          >
            <Package className="w-3.5 h-3.5" /> 素材
          </button>
          {hasKey === false && (
            <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 shrink-0">
              <AlertCircle className="w-4 h-4" />
              <span className="text-[11px] sm:text-xs font-medium whitespace-nowrap">
                需設定 FAL_API_KEY
              </span>
            </div>
          )}
        </div>
      </div>

      {/* API Key 提示 */}
      {hasKey === false && (
        <div className="p-3 sm:p-4 rounded-xl bg-amber-50/80 border border-amber-200/60">
          <p className="text-sm font-medium text-amber-800 mb-1">
            ⚙️ 需要設定 FAL_API_KEY
          </p>
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

      {/* Tab 選擇 — 置頂吸附 */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-lg -mx-3 sm:-mx-4 px-3 sm:px-4 py-2.5 border-b border-border/30 shadow-sm">
        <div className="flex overflow-x-auto gap-1.5 pb-0.5 no-scrollbar scroll-fade-x">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-healing min-h-[40px] border ${
                tab === id
                  ? "bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]"
                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground active:scale-[0.98] border-border/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-primary/40" />
          {TABS.find(t => t.id === tab)?.desc}
        </p>
      </div>

      {/* 模型細膩導覽已移除 — 功能與光球助手重複，且佔用大量空間 */}
      <Collapsible open={guideOpen} onOpenChange={setGuideOpen} className="hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full px-3 sm:px-4 py-3 sm:py-4 text-left flex items-center justify-between gap-2 hover:bg-accent/20 rounded-2xl transition-colors"
          >
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-primary" />
              模型細膩導覽 · {TABS.find(t => t.id === tab)?.label}
            </p>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0 ${guideOpen ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 sm:px-4 pb-3 sm:pb-4">
        <div className="rounded-xl border border-border/40 bg-background/70 px-2.5 py-2 mb-2 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={guideKeyword}
            onChange={e => setGuideKeyword(e.target.value)}
            placeholder="搜尋模型用途、優勢或建議..."
            className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {filteredGuideModels.map(model => {
            const isOpen = openGuideModelId === model.id;
            return (
              <Collapsible
                key={model.id}
                open={isOpen}
                onOpenChange={open => setOpenGuideModelId(open ? model.id : null)}
                className="rounded-xl border border-border/35 bg-background/70"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-accent/30 rounded-xl transition-colors"
                  >
                    <div>
                      <p className="text-xs font-medium text-foreground">{model.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                        {model.desc}
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-2.5">
                  {model.bestFor && (
                    <p className="text-[11px] text-primary mt-1">適合：{model.bestFor}</p>
                  )}
                  {model.tip && (
                    <p className="text-[11px] text-muted-foreground/90 mt-0.5 leading-relaxed">建議：{model.tip}</p>
                  )}
                  {!!model.advantages?.length && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {model.advantages.map(adv => (
                        <span key={adv} className="text-[10px] rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-primary/80">
                          {adv}
                        </span>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
          {filteredGuideModels.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-border/50 bg-background/60 py-6 text-center text-xs text-muted-foreground">
              沒有符合搜尋條件的模型，請換個關鍵字試試。
            </div>
          )}
        </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── 來自導演 AI 的橫幅（含「回到導演 AI」按鈕） ── */}
      {directorContext && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-50/40 dark:bg-amber-900/10 px-3 py-2 text-xs">
          <span className="text-amber-700 dark:text-amber-300">
            ↩ 此次任務來自導演 AI 場景「{directorContext.sceneName}」
          </span>
          <button
            type="button"
            onClick={handleReturnToDirector}
            className="ml-auto rounded-lg border border-amber-400/50 bg-background/60 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 transition"
          >
            回到導演 AI
          </button>
        </div>
      )}

      {/* 世界觀上下文（僅在用戶選定創作專案時顯示為視覺參考；
          ProStudio 不自動注入到語音腳本/音樂標籤——避免污染輸出） */}
      {worldCtx.currentProjectId !== null && (
        <WorldContextSidebar defaultOpen={false} hideSwitcher={false} />
      )}

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
      <div className="mt-6 sm:mt-8 p-4 sm:p-5 rounded-2xl bg-muted/30 border border-border/20 text-xs text-muted-foreground">
        <p className="font-medium text-foreground text-sm mb-2.5 flex items-center gap-2">
          <span className="p-1 rounded-lg bg-primary/10"><AlertCircle className="w-3.5 h-3.5 text-primary" /></span>
          使用說明
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 leading-relaxed">
          <p>🎵 音樂生成支援 Sonauto、ACE-Step、Stable Audio、MusicGen</p>
          <p>🎤 語音合成支援中英文，可調整語速和情緒強度</p>
          <p>🎭 聲音克隆需上傳 3-10 秒的清晰語音樣本</p>
          <p>🎬 AI 形像影片可由照片 + 音訊生成口型同步影片</p>
        </div>
      </div>
      <div className="text-center pb-2">
        <p className="text-[11px] text-muted-foreground/60">
          Powered by fal.ai · ElevenLabs · Sonauto · Qwen · Kling · LTX
        </p>
      </div>
    </div>
    </AgentBridgeContext.Provider>
  );
}
