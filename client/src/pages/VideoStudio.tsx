/**
 * VideoStudio.tsx — 影片專業工作室
 *
 * 整合 FAL.AI 頂尖影片生成模型
 * 分類：
 *  🎬 文生影 | 🖼️ 圖生影 | 🎞️ 影生影 | ✨ 畫質優化 | 🎛️ 進階控制
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
import {
  Film,
  Image,
  Video,
  Zap,
  Wand2,
  Download,
  Loader2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Star,
  ChevronDown,
  ChevronUp,
  Layers,
  Move,
  Eye,
  Maximize2,
  RefreshCw,
  ArrowUpCircle,
  Clapperboard,
  Camera,
  Cpu,
  Upload,
  X,
  Link,
  Copy,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { uploadFileToS3 } from "@/lib/upload";
import { useRegisterBgTask } from "@/contexts/BackgroundTasksContext";
import { normalizeEngineModelId } from "@shared/engineModelIds";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";

// ─── 類型 ────────────────────────────────────────────────────────────────────

interface VideoResult {
  video_url?: string | null;
  request_id?: string | null;
  raw?: unknown;
}

// ─── 常數：標籤定義 ──────────────────────────────────────────────────────────

const TABS = [
  { id: "t2v", label: "文生影", icon: Film, desc: "用文字描述生成影片 · Text-to-Video" },
  { id: "i2v", label: "圖生影", icon: Image, desc: "用圖片生成動態影片 · Image-to-Video" },
  { id: "v2v", label: "影生影", icon: Video, desc: "將影片重新風格化 · Video-to-Video" },
  {
    id: "enhance",
    label: "畫質優化",
    icon: ArrowUpCircle,
    desc: "超解析度 · 補幀 · 降噪增強",
  },
  { id: "control", label: "進階控制", icon: Wand2, desc: "鏡頭運動 · 骨架控制 · 深度圖" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const OVERRIDE_TAB_BY_ENGINE: Array<{ prefix: string; tab: TabId }> = [
  { prefix: "fal-ai/kling-video/v2.1/pro/text-to-video", tab: "t2v" },
  { prefix: "fal-ai/kling-video/v2.1/standard/text-to-video", tab: "t2v" },
  { prefix: "fal-ai/wan-t2v", tab: "t2v" },
  { prefix: "fal-ai/minimax-video/text-to-video", tab: "t2v" },
  { prefix: "fal-ai/cogvideox-5b", tab: "t2v" },
  { prefix: "fal-ai/ltx-video", tab: "t2v" },
  { prefix: "fal-ai/kling-video/v2.1/pro/image-to-video", tab: "i2v" },
  { prefix: "fal-ai/minimax-video/image-to-video", tab: "i2v" },
  { prefix: "fal-ai/runway-gen3/turbo/image-to-video", tab: "i2v" },
  { prefix: "fal-ai/luma-dream-machine/image-to-video", tab: "i2v" },
  { prefix: "fal-ai/wan/v2.1/video-to-video", tab: "v2v" },
  { prefix: "fal-ai/kling-video/v2.1/standard/video-to-video", tab: "v2v" },
  { prefix: "fal-ai/cogvideox-5b/video-to-video", tab: "v2v" },
  { prefix: "fal-ai/stable-video", tab: "enhance" },
  { prefix: "fal-ai/topaz-video", tab: "enhance" },
];

// ─── 子元件：影片播放器 ──────────────────────────────────────────────────────

function VideoPlayer({ url, label }: { url: string; label?: string }) {
  return (
    <div className="mt-4 p-3 sm:p-4 rounded-2xl bg-gradient-to-br from-blue-500/8 to-purple-500/5 border border-blue-200/40">
      {label && (
        <p className="text-xs text-muted-foreground mb-2 font-medium flex items-center gap-1.5">
          <Film className="w-3 h-3" />
          {label}
          <span className="ml-auto text-[10px] text-emerald-600 font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded-full">✓ 完成</span>
        </p>
      )}
      <video
        controls
        className="w-full rounded-xl max-h-64 sm:max-h-80 lg:max-h-96 bg-black/5"
        src={url}
        preload="metadata"
      >
        <track kind="captions" />
      </video>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <button
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 px-2.5 py-1.5 rounded-lg hover:bg-primary/5 transition-all font-medium"
          onClick={async () => {
            try {
              // Use server proxy to bypass CORS on CDN URLs
              const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(url)}`;
              const resp = await fetch(proxyUrl);
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
              const blob = await resp.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = blobUrl;
              a.download = `ai-video-${Date.now()}.mp4`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
              toast.success("影片已下載");
            } catch {
              window.open(url, "_blank");
              toast.info("已在新分頁開啟，請右鍵另存新檔");
            }
          }}
        >
          <Download className="w-3 h-3" />
          下載 MP4
        </button>
        <button
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-accent transition-all"
          onClick={() => {
            navigator.clipboard.writeText(url);
            toast.success("已複製影片 URL");
          }}
        >
          <Copy className="w-3 h-3" />
          複製 URL
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-lg hover:bg-accent transition-all"
        >
          <ExternalLink className="w-3 h-3" />
          新分頁
        </a>
      </div>
    </div>
  );
}

// ─── 子元件：URL 輸入框 ──────────────────────────────────────────────────────

// ─── 子元件：MediaInput（支援 URL 貼上 + 檔案上傳） ────────────────────────
function MediaInput({
  label,
  value,
  onChange,
  placeholder,
  accept = "video",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accept?: "video" | "image";
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileAccept = accept === "image" ? "image/*" : "video/*,image/*";
  const defaultPlaceholder =
    accept === "image"
      ? "貼上圖片 URL 或點擊上傳（jpg/png/webp）"
      : "貼上影片 URL 或點擊上傳（mp4/mov/webm）";

  const handleUpload = useCallback(
    async (file: File) => {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("檔案不能超過 50MB");
        return;
      }
      setUploading(true);
      try {
        const { url } = await uploadFileToS3(file);
        onChange(url);
        toast.success("✅ 已上傳");
      } catch (e: any) {
        toast.error("上傳失敗：" + (e.message || "未知錯誤"));
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileAccept;
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleUpload(file);
    };
    input.click();
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div
        className={`relative rounded-xl border transition-all ${isDragOver ? "border-primary/50 bg-primary/5" : "border-border/40"}`}
        onDragOver={e => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 p-1">
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? defaultPlaceholder}
            className="text-sm font-mono border-0 shadow-none focus-visible:ring-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleFileSelect}
            disabled={uploading}
            title="上傳檔案"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => onChange("")}
              title="清除"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {/* Preview */}
        {value && accept === "image" && (
          <div className="px-2 pb-2">
            <img
              src={value}
              alt="preview"
              className="w-full max-h-32 object-cover rounded-lg"
              loading="lazy"
              onError={e => (e.currentTarget.style.display = "none")}
            />
          </div>
        )}
        {value && accept === "video" && (
          <div className="px-2 pb-2">
            <video
              src={value}
              className="w-full max-h-32 rounded-lg bg-black/5"
              controls
              preload="metadata"
            />
          </div>
        )}
      </div>
      <p className="hs-small !mb-0 text-muted-foreground/60">
        支援貼上 URL 或直接拖放上傳（最大 50MB）
      </p>
    </div>
  );
}

// Keep UrlInput as alias for backward-compat
const UrlInput = MediaInput;

// ─── 子元件：ToolCard 卡片容器 ───────────────────────────────────────────────

type CardColor =
  | "blue"
  | "purple"
  | "green"
  | "orange"
  | "pink"
  | "cyan"
  | "indigo"
  | "rose";

const CARD_COLORS: Record<CardColor, { bg: string; icon: string }> = {
  blue: {
    bg: "from-blue-500/10 to-sky-500/5 border-blue-200/50 dark:from-blue-500/15 dark:to-sky-500/8 dark:border-blue-700/30",
    icon: "text-blue-500",
  },
  purple: {
    bg: "from-purple-500/10 to-violet-500/5 border-purple-200/50 dark:from-purple-500/15 dark:to-violet-500/8 dark:border-purple-700/30",
    icon: "text-purple-500",
  },
  green: {
    bg: "from-emerald-500/10 to-teal-500/5 border-emerald-200/50 dark:from-emerald-500/15 dark:to-teal-500/8 dark:border-emerald-700/30",
    icon: "text-emerald-500",
  },
  orange: {
    bg: "from-orange-500/10 to-amber-500/5 border-orange-200/50 dark:from-orange-500/15 dark:to-amber-500/8 dark:border-orange-700/30",
    icon: "text-orange-500",
  },
  pink: {
    bg: "from-pink-500/10 to-rose-500/5 border-pink-200/50 dark:from-pink-500/15 dark:to-rose-500/8 dark:border-pink-700/30",
    icon: "text-pink-500",
  },
  cyan: {
    bg: "from-cyan-500/10 to-sky-500/5 border-cyan-200/50 dark:from-cyan-500/15 dark:to-sky-500/8 dark:border-cyan-700/30",
    icon: "text-cyan-500",
  },
  indigo: {
    bg: "from-indigo-500/10 to-blue-500/5 border-indigo-200/50 dark:from-indigo-500/15 dark:to-blue-500/8 dark:border-indigo-700/30",
    icon: "text-indigo-500",
  },
  rose: {
    bg: "from-rose-500/10 to-pink-500/5 border-rose-200/50 dark:from-rose-500/15 dark:to-pink-500/8 dark:border-rose-700/30",
    icon: "text-rose-500",
  },
};

function ToolCard({
  icon: Icon,
  title,
  description,
  badge,
  modelId,
  color = "blue",
  isNew,
  defaultOpen = false,
  children,
}: {
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  badge?: string;
  modelId?: string;
  color?: CardColor;
  isNew?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const c = CARD_COLORS[color];
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl bg-gradient-to-br ${c.bg} border backdrop-blur-sm transition-all duration-300 ${open ? "shadow-md ring-1 ring-primary/10" : "shadow-sm hover:shadow-md hover:-translate-y-0.5"}`}
      >
        <CollapsibleTrigger asChild>
          <button
            className="w-full text-left p-3.5 sm:p-4 flex items-center gap-2.5 sm:gap-3 cursor-pointer group"
          >
            <div
              className={`p-1.5 sm:p-2 rounded-xl bg-white/60 dark:bg-white/10 shadow-sm ${c.icon} shrink-0 transition-transform duration-300 ${open ? "scale-110" : "group-hover:scale-105"}`}
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
                {isNew && (
                  <Badge className="text-[10px] px-1.5 py-0 bg-emerald-500 text-white motion-safe:animate-pulse">
                    NEW
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                {description}
              </p>
            </div>
            <div className={`p-1 rounded-lg transition-all duration-200 ${open ? "bg-primary/10" : "group-hover:bg-accent"}`}>
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? "rotate-180 text-primary" : ""}`}
              />
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 overflow-hidden">
          <div className="px-3.5 sm:px-4 pb-3.5 sm:pb-4 pt-0">
            {modelId && (
              <a
                href={`https://fal.ai/models/${modelId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-primary/60 hover:text-primary mb-3 transition-colors"
              >
                <ExternalLink className="w-2.5 h-2.5" />
                {modelId}
              </a>
            )}
            {children}
          </div>
        </CollapsibleContent>
      </motion.div>
    </Collapsible>
  );
}

// ─── 子元件：API Key 提示橫條 ────────────────────────────────────────────────

function ApiKeyBanner() {
  const { data } = trpc.videoStudio.checkApiKey.useQuery(undefined, {
    retry: false,
  });
  if (data?.configured) return null;
  return (
    <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        尚未設定 FAL_API_KEY，請至{" "}
        <a
          href="https://fal.ai/dashboard/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium"
        >
          fal.ai → Keys
        </a>{" "}
        取得金鑰後在 Railway / 環境變數中新增，影片生成功能才能正常運作。
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 AsyncVideoPoller — 非同步影片輪詢元件（防止 504 的核心機制）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * AsyncVideoPoller — 當後端回傳 request_id 時，每 3 秒輪詢 checkVideoStatus
 * 完成後自動顯示 VideoPlayer；生成中顯示動態等待畫面
 */
function AsyncVideoPoller({
  result,
  onUpdate,
  label,
}: {
  result: VideoResult;
  onUpdate: (r: VideoResult) => void;
  label?: string;
}) {
  const modelId = (result.raw as any)?.raw_model_id ?? "";
  const [dismissed, setDismissed] = useState(false);

  const { data, isError, error } = trpc.videoStudio.checkVideoStatus.useQuery(
    { requestId: result.request_id ?? "", modelId },
    {
      enabled: !!(result.request_id && !result.video_url && modelId),
      refetchInterval: query => {
        const s = (query.state.data as any)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );

  useEffect(() => {
    if ((data as any)?.status === "COMPLETED" && (data as any)?.video_url) {
      setDismissed(false); // 完成時自動顯示結果
      toast.success(`✅ ${label ?? "影片"} 生成完成！`);
      onUpdate({
        ...result,
        video_url: (data as any).video_url,
        raw: (data as any).raw,
      });
    } else if ((data as any)?.status === "FAILED") {
      toast.error(`❌ ${label ?? "影片"} 生成失敗`);
      onUpdate({ ...result, raw: { ...(result.raw as any), failed: true } });
    }
  }, [(data as any)?.status, (data as any)?.video_url, label]);

  // 已有影片 URL → 直接顯示
  if (result.video_url) {
    return <VideoPlayer url={result.video_url} label={label} />;
  }

  // API 錯誤或任務失敗
  if (isError || (result.raw as any)?.failed) {
    return (
      <div className="mt-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-xs flex items-center gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>
          生成失敗：{(error as any)?.message ?? "請重試或檢查網路連線"}
        </span>
      </div>
    );
  }

  // 使用者已關閉等待畫面
  if (dismissed) return null;

  // 等待中（有 request_id 但沒有 video_url）— 可關閉
  if (result.request_id && !result.video_url) {
    return (
      <div className="mt-4 p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-primary/5 to-purple-500/5 border border-primary/20 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
        {/* Subtle animated background shimmer */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/3 to-transparent motion-safe:animate-pulse pointer-events-none" />
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-accent active:bg-accent/70 transition-colors z-10"
          title="隱藏等待畫面（背景任務會繼續）"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="relative">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <div className="absolute inset-0 w-8 h-8 rounded-full border-2 border-primary/20 motion-safe:animate-ping" />
        </div>
        <div className="text-center relative z-10">
          <p className="text-sm font-semibold text-foreground">
            🎬 {label ?? "影片"} 背景生成中...
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            已轉入背景任務，完成後會自動通知你
          </p>
          <p className="text-[11px] text-primary/70 mt-1">
            💡 你可以關閉此面板繼續其他操作，不影響生成進度
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎬 Tab 1 — 文生影 Text-to-Video
// ═══════════════════════════════════════════════════════════════════════════════

function TextToVideoTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  // ─ Kling
  const [klingPrompt, setKlingPrompt] = useState("");
  const [klingNeg, setKlingNeg] = useState("");
  const [klingDuration, setKlingDuration] = useState<"5" | "10">("5");
  const [klingAspect, setKlingAspect] = useState<"16:9" | "9:16" | "1:1">(
    "16:9"
  );
  const [klingCfg, setKlingCfg] = useState(0.5);
  const [klingResult, setKlingResult] = useState<VideoResult | null>(null);

  // ─ Wan
  const [wanPrompt, setWanPrompt] = useState("");
  const [wanNeg, setWanNeg] = useState("");
  const [wanRes, setWanRes] = useState<"480p" | "720p">("720p");
  const [wanFrames, setWanFrames] = useState(81);
  const [wanResult, setWanResult] = useState<VideoResult | null>(null);

  // ─ MiniMax
  const [mmPrompt, setMmPrompt] = useState("");
  const [mmOptimize, setMmOptimize] = useState(true);
  const [mmResult, setMmResult] = useState<VideoResult | null>(null);

  // ─ Veo3
  const [veoPrompt, setVeoPrompt] = useState("");
  const [veoAspect, setVeoAspect] = useState<"16:9" | "9:16">("16:9");
  const [veoAudio, setVeoAudio] = useState(true);
  const [veoResult, setVeoResult] = useState<VideoResult | null>(null);

  // ─ LTX
  const [ltxPrompt, setLtxPrompt] = useState("");
  const [ltxNeg, setLtxNeg] = useState("");
  const [ltxResult, setLtxResult] = useState<VideoResult | null>(null);

  // ─ Sora
  const [soraPrompt, setSoraPrompt] = useState("");
  const [soraDuration, setSoraDuration] = useState(10);
  const [soraRes, setSoraRes] = useState<"480p" | "720p" | "1080p">("720p");
  const [soraAspect, setSoraAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [soraResult, setSoraResult] = useState<VideoResult | null>(null);

  // ─ Mutations
  const klingMut = trpc.videoStudio.klingTextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const wanMut = trpc.videoStudio.wanTextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const mmMut = trpc.videoStudio.minimaxTextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const veoMut = trpc.videoStudio.veo3TextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const ltxMut = trpc.videoStudio.ltxTextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const soraMut = trpc.videoStudio.soraTextToVideo.useMutation({
    onError: e => toast.error(e.message),
  });

  async function runKling() {
    if (!klingPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await klingMut.mutateAsync({
        prompt: klingPrompt,
        negativePrompt: klingNeg || undefined,
        duration: klingDuration,
        aspectRatio: klingAspect,
        cfgScale: klingCfg,
      });
      setKlingResult(r);
      registerBgTask(r, "video", "Kling 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runWan() {
    if (!wanPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await wanMut.mutateAsync({
        prompt: wanPrompt,
        negativePrompt: wanNeg || undefined,
        resolution: wanRes,
        numFrames: wanFrames,
      });
      setWanResult(r);
      registerBgTask(r, "video", "Wan 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runMinimax() {
    if (!mmPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await mmMut.mutateAsync({
        prompt: mmPrompt,
        promptOptimizer: mmOptimize,
      });
      setMmResult(r);
      registerBgTask(r, "video", "MiniMax 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runVeo3() {
    if (!veoPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await veoMut.mutateAsync({
        prompt: veoPrompt,
        aspectRatio: veoAspect,
        generateAudio: veoAudio,
      });
      setVeoResult(r);
      registerBgTask(r, "video", "Veo 3 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runLtx() {
    if (!ltxPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await ltxMut.mutateAsync({
        prompt: ltxPrompt,
        negativePrompt: ltxNeg || undefined,
      });
      setLtxResult(r);
      registerBgTask(r, "video", "LTX 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runSora() {
    if (!soraPrompt.trim()) return toast.error("請輸入提詞");
    setAIState("generating");
    try {
      const r = await soraMut.mutateAsync({
        prompt: soraPrompt,
        duration: soraDuration,
        resolution: soraRes,
        aspectRatio: soraAspect,
      });
      setSoraResult(r);
      registerBgTask(r, "video", "Sora 文生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* Kling v2.1 */}
      <ToolCard
        icon={Clapperboard}
        title="Kling v2.1 文生影"
        description="快手 Kling 業界頂尖，卓越中文語意，5s/10s，多種比例"
        badge="Kling 2.1"
        modelId="fal-ai/kling-video/v2.1/standard/text-to-video"
        color="purple"
        isNew
        defaultOpen
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={klingPrompt}
              onChange={e => setKlingPrompt(e.target.value)}
              placeholder="描述你想要的影片畫面，中英文均可..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
            {klingPrompt.length > 0 && (
              <p className="text-[10px] text-muted-foreground/60 mt-1 text-right">{klingPrompt.length} 字</p>
            )}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              負面提詞（選填）
            </Label>
            <Input
              value={klingNeg}
              onChange={e => setKlingNeg(e.target.value)}
              placeholder="不想出現的內容..."
              className="mt-1 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">時長</Label>
              <Select
                value={klingDuration}
                onValueChange={v => setKlingDuration(v as "5" | "10")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 秒</SelectItem>
                  <SelectItem value="10">10 秒</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">寬高比</Label>
              <Select
                value={klingAspect}
                onValueChange={v =>
                  setKlingAspect(v as "16:9" | "9:16" | "1:1")
                }
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9（橫屏）</SelectItem>
                  <SelectItem value="9:16">9:16（豎屏）</SelectItem>
                  <SelectItem value="1:1">1:1（方形）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              創意強度 CFG：{klingCfg.toFixed(2)}
            </Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[klingCfg]}
              onValueChange={([v]) => setKlingCfg(v)}
              className="mt-2"
            />
          </div>
          <Button
            onClick={runKling}
            disabled={klingMut.isPending}
            className="w-full btn-healing"
          >
            {klingMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Kling 文生影
              </>
            )}
          </Button>
          {klingResult && (
            <AsyncVideoPoller
              result={klingResult}
              onUpdate={setKlingResult}
              label="Kling 生成結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Wan 2.1 */}
      <ToolCard
        icon={Zap}
        title="Wan 2.1 文生影"
        description="阿里開源最強，720p 高畫質，精細動態表現"
        badge="Wan 2.1"
        modelId="fal-ai/wan-ai/wan2.1-t2v-720p"
        color="blue"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={wanPrompt}
              onChange={e => setWanPrompt(e.target.value)}
              placeholder="描述想要的影片內容..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              負面提詞（選填）
            </Label>
            <Input
              value={wanNeg}
              onChange={e => setWanNeg(e.target.value)}
              placeholder="不想要的元素..."
              className="mt-1 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">解析度</Label>
              <Select
                value={wanRes}
                onValueChange={v => setWanRes(v as "480p" | "720p")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p（高畫質）</SelectItem>
                  <SelectItem value="480p">480p（快速）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                幀數：{wanFrames}
              </Label>
              <Slider
                min={16}
                max={81}
                step={5}
                value={[wanFrames]}
                onValueChange={([v]) => setWanFrames(v)}
                className="mt-3"
              />
            </div>
          </div>
          <Button
            onClick={runWan}
            disabled={wanMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {wanMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Film className="w-4 h-4 mr-2" />
                Wan 文生影
              </>
            )}
          </Button>
          {wanResult && (
            <AsyncVideoPoller
              result={wanResult}
              onUpdate={setWanResult}
              label="Wan 生成結果"
            />
          )}
        </div>
      </ToolCard>

      {/* MiniMax Hailuo */}
      <ToolCard
        icon={Star}
        title="MiniMax Hailuo-02 文生影"
        description="MiniMax 旗艦影片模型，電影級動態，6s 超長鏡頭"
        badge="MiniMax"
        modelId="fal-ai/minimax/video-01"
        color="orange"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={mmPrompt}
              onChange={e => setMmPrompt(e.target.value)}
              placeholder="描述電影場景與運鏡方式..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={mmOptimize}
              onCheckedChange={setMmOptimize}
              id="mm-opt"
            />
            <Label htmlFor="mm-opt" className="text-xs cursor-pointer">
              AI 提詞優化
            </Label>
          </div>
          <Button
            onClick={runMinimax}
            disabled={mmMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {mmMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                MiniMax 文生影
              </>
            )}
          </Button>
          {mmResult && (
            <AsyncVideoPoller
              result={mmResult}
              onUpdate={setMmResult}
              label="MiniMax 生成結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Veo 3 */}
      <ToolCard
        icon={Cpu}
        title="Google Veo 3 Flash 文生影"
        description="Google 最新旗艦影片模型，8秒，具備原生音頻生成能力"
        badge="Veo 3"
        modelId="fal-ai/veo3"
        color="green"
        isNew
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={veoPrompt}
              onChange={e => setVeoPrompt(e.target.value)}
              placeholder="詳細描述場景、動作、音效..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">寬高比</Label>
              <Select
                value={veoAspect}
                onValueChange={v => setVeoAspect(v as "16:9" | "9:16")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9（橫屏）</SelectItem>
                  <SelectItem value="9:16">9:16（豎屏）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <Switch
                checked={veoAudio}
                onCheckedChange={setVeoAudio}
                id="veo-audio"
              />
              <Label htmlFor="veo-audio" className="text-xs cursor-pointer">
                生成配音
              </Label>
            </div>
          </div>
          <Button
            onClick={runVeo3}
            disabled={veoMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {veoMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中（約 3-8 分鐘）...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Veo 3 文生影
              </>
            )}
          </Button>
          {veoResult && (
            <AsyncVideoPoller
              result={veoResult}
              onUpdate={setVeoResult}
              label="Veo 3 生成結果"
            />
          )}
        </div>
      </ToolCard>

      {/* LTX-Video */}
      <ToolCard
        icon={Zap}
        title="LTX-Video 13B 文生影"
        description="Lightricks 開源旗艦，超快速蒸餾版，720p 高品質"
        badge="LTX 13B"
        modelId="fal-ai/ltx-video-13b-distilled"
        color="cyan"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={ltxPrompt}
              onChange={e => setLtxPrompt(e.target.value)}
              placeholder="詳細描述場景，越具體效果越好..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              負面提詞（選填）
            </Label>
            <Input
              value={ltxNeg}
              onChange={e => setLtxNeg(e.target.value)}
              placeholder="不希望出現的元素..."
              className="mt-1 text-sm"
            />
          </div>
          <Button
            onClick={runLtx}
            disabled={ltxMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {ltxMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                LTX 文生影
              </>
            )}
          </Button>
          {ltxResult && (
            <AsyncVideoPoller
              result={ltxResult}
              onUpdate={setLtxResult}
              label="LTX-Video 生成結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Sora Turbo */}
      <ToolCard
        icon={Sparkles}
        title="OpenAI Sora Turbo 文生影"
        description="OpenAI Sora Turbo，最長 20s，多解析度多比例"
        badge="Sora"
        modelId="fal-ai/sora"
        color="indigo"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={soraPrompt}
              onChange={e => setSoraPrompt(e.target.value)}
              placeholder="以英文描述影片場景效果最佳..."
              className="mt-1 text-sm resize-none"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                時長（秒）：{soraDuration}
              </Label>
              <Slider
                min={5}
                max={20}
                step={1}
                value={[soraDuration]}
                onValueChange={([v]) => setSoraDuration(v)}
                className="mt-2"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">解析度</Label>
              <Select
                value={soraRes}
                onValueChange={v => setSoraRes(v as "480p" | "720p" | "1080p")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="480p">480p</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">寬高比</Label>
              <Select
                value={soraAspect}
                onValueChange={v => setSoraAspect(v as "16:9" | "9:16" | "1:1")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={runSora}
            disabled={soraMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {soraMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Sora 文生影
              </>
            )}
          </Button>
          {soraResult && (
            <AsyncVideoPoller
              result={soraResult}
              onUpdate={setSoraResult}
              label="Sora 生成結果"
            />
          )}
        </div>
      </ToolCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🖼️ Tab 2 — 圖生影 Image-to-Video
// ═══════════════════════════════════════════════════════════════════════════════

function ImageToVideoTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [klingPrompt, setKlingPrompt] = useState("");
  const [klingImage, setKlingImage] = useState("");
  const [klingTail, setKlingTail] = useState("");
  const [klingDuration, setKlingDuration] = useState<"5" | "10">("5");
  const [klingResult, setKlingResult] = useState<VideoResult | null>(null);

  const [wanPrompt, setWanPrompt] = useState("");
  const [wanImage, setWanImage] = useState("");
  const [wanRes, setWanRes] = useState<"480p" | "720p">("720p");
  const [wanResult, setWanResult] = useState<VideoResult | null>(null);

  const [runwayPrompt, setRunwayPrompt] = useState("");
  const [runwayImage, setRunwayImage] = useState("");
  const [runwayDuration, setRunwayDuration] = useState<"5" | "10">("5");
  const [runwayRatio, setRunwayRatio] = useState("1280:720");
  const [runwayResult, setRunwayResult] = useState<VideoResult | null>(null);

  const [pvPrompt, setPvPrompt] = useState("");
  const [pvImage, setPvImage] = useState("");
  const [pvDuration, setPvDuration] = useState<"4" | "8">("4");
  const [pvQuality, setPvQuality] = useState<
    "360p" | "540p" | "720p" | "1080p"
  >("720p");
  const [pvResult, setPvResult] = useState<VideoResult | null>(null);

  const [mmPrompt, setMmPrompt] = useState("");
  const [mmImage, setMmImage] = useState("");
  const [mmOptimize, setMmOptimize] = useState(true);
  const [mmResult, setMmResult] = useState<VideoResult | null>(null);

  const klingMut = trpc.videoStudio.klingImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const wanMut = trpc.videoStudio.wanImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const runwayMut = trpc.videoStudio.runwayImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const pvMut = trpc.videoStudio.pixverseImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const mmMut = trpc.videoStudio.minimaxImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });

  async function runKling() {
    if (!klingPrompt.trim() || !klingImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await klingMut.mutateAsync({
        prompt: klingPrompt,
        imageUrl: klingImage,
        tailImageUrl: klingTail || undefined,
        duration: klingDuration,
      });
      setKlingResult(r);
      registerBgTask(r, "video", "Kling 圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runWan() {
    if (!wanPrompt.trim() || !wanImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await wanMut.mutateAsync({
        prompt: wanPrompt,
        imageUrl: wanImage,
        resolution: wanRes,
      });
      setWanResult(r);
      registerBgTask(r, "video", "Wan 圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runRunway() {
    if (!runwayPrompt.trim() || !runwayImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await runwayMut.mutateAsync({
        prompt: runwayPrompt,
        imageUrl: runwayImage,
        duration: runwayDuration,
        ratio: runwayRatio as any,
      });
      setRunwayResult(r);
      registerBgTask(r, "video", "Runway 圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runPixverse() {
    if (!pvPrompt.trim() || !pvImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await pvMut.mutateAsync({
        prompt: pvPrompt,
        imageUrl: pvImage,
        duration: pvDuration,
        quality: pvQuality,
      });
      setPvResult(r);
      registerBgTask(r, "video", "Pixverse 圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runMinimax() {
    if (!mmPrompt.trim() || !mmImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await mmMut.mutateAsync({
        prompt: mmPrompt,
        imageUrl: mmImage,
        promptOptimizer: mmOptimize,
      });
      setMmResult(r);
      registerBgTask(r, "video", "MiniMax 圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* Kling i2v */}
      <ToolCard
        icon={Clapperboard}
        title="Kling v2.1 圖生影"
        description="業界最自然圖片動態化，支援起始幀 + 結束幀雙控"
        badge="Kling 2.1"
        modelId="fal-ai/kling-video/v2.1/standard/image-to-video"
        color="purple"
        defaultOpen
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={klingPrompt}
              onChange={e => setKlingPrompt(e.target.value)}
              placeholder="描述圖片應如何運動..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="起始圖片 URL *"
            value={klingImage}
            onChange={setKlingImage}
            accept="image"
            required
          />
          <UrlInput
            label="結束圖片 URL（選填，固定最後一幀）"
            value={klingTail}
            onChange={setKlingTail}
            accept="image"
          />
          <div>
            <Label className="text-xs text-muted-foreground">時長</Label>
            <Select
              value={klingDuration}
              onValueChange={v => setKlingDuration(v as "5" | "10")}
            >
              <SelectTrigger className="mt-1 text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 秒</SelectItem>
                <SelectItem value="10">10 秒</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={runKling}
            disabled={klingMut.isPending}
            className="w-full btn-healing"
          >
            {klingMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Kling 圖生影
              </>
            )}
          </Button>
          {klingResult && (
            <AsyncVideoPoller
              result={klingResult}
              onUpdate={setKlingResult}
              label="Kling 圖生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Wan i2v */}
      <ToolCard
        icon={Zap}
        title="Wan 2.1 圖生影"
        description="阿里開源旗艦圖生影，720p，流暢自然的物理動態"
        badge="Wan 2.1"
        modelId="fal-ai/wan-ai/wan2.1-i2v-720p"
        color="blue"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={wanPrompt}
              onChange={e => setWanPrompt(e.target.value)}
              placeholder="描述圖片的動態方式..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="圖片 URL *"
            value={wanImage}
            onChange={setWanImage}
            accept="image"
            required
          />
          <div>
            <Label className="text-xs text-muted-foreground">解析度</Label>
            <Select
              value={wanRes}
              onValueChange={v => setWanRes(v as "480p" | "720p")}
            >
              <SelectTrigger className="mt-1 text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="720p">720p（高畫質）</SelectItem>
                <SelectItem value="480p">480p（快速）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={runWan}
            disabled={wanMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {wanMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Film className="w-4 h-4 mr-2" />
                Wan 圖生影
              </>
            )}
          </Button>
          {wanResult && (
            <AsyncVideoPoller
              result={wanResult}
              onUpdate={setWanResult}
              label="Wan 圖生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Runway Gen4 */}
      <ToolCard
        icon={Camera}
        title="Runway Gen4 Turbo 圖生影"
        description="Runway Gen4，電影級品質，精確動態控制，5s/10s"
        badge="Gen4"
        modelId="fal-ai/runway-gen4-turbo/image-to-video"
        color="green"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={runwayPrompt}
              onChange={e => setRunwayPrompt(e.target.value)}
              placeholder="描述場景動態與鏡頭運動..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="圖片 URL *"
            value={runwayImage}
            onChange={setRunwayImage}
            accept="image"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">時長</Label>
              <Select
                value={runwayDuration}
                onValueChange={v => setRunwayDuration(v as "5" | "10")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 秒</SelectItem>
                  <SelectItem value="10">10 秒</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">寬高比</Label>
              <Select value={runwayRatio} onValueChange={setRunwayRatio}>
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1280:720">1280:720（16:9）</SelectItem>
                  <SelectItem value="720:1280">720:1280（9:16）</SelectItem>
                  <SelectItem value="960:960">960:960（1:1）</SelectItem>
                  <SelectItem value="1104:832">1104:832（4:3）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={runRunway}
            disabled={runwayMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {runwayMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4 mr-2" />
                Runway 圖生影
              </>
            )}
          </Button>
          {runwayResult && (
            <AsyncVideoPoller
              result={runwayResult}
              onUpdate={setRunwayResult}
              label="Runway 圖生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* PixVerse */}
      <ToolCard
        icon={Star}
        title="PixVerse v4.5 圖生影"
        description="PixVerse 旗艦，強大物理動態，1080p 超高清，支援特效"
        badge="PixVerse 4.5"
        modelId="fal-ai/pixverse/v4.5/image-to-video"
        color="orange"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={pvPrompt}
              onChange={e => setPvPrompt(e.target.value)}
              placeholder="描述想要的視覺效果與動態..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="圖片 URL *"
            value={pvImage}
            onChange={setPvImage}
            accept="image"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">時長</Label>
              <Select
                value={pvDuration}
                onValueChange={v => setPvDuration(v as "4" | "8")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 秒</SelectItem>
                  <SelectItem value="8">8 秒</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">畫質</Label>
              <Select
                value={pvQuality}
                onValueChange={v => setPvQuality(v as any)}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="540p">540p</SelectItem>
                  <SelectItem value="360p">360p</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            onClick={runPixverse}
            disabled={pvMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {pvMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                PixVerse 圖生影
              </>
            )}
          </Button>
          {pvResult && (
            <AsyncVideoPoller
              result={pvResult}
              onUpdate={setPvResult}
              label="PixVerse 圖生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* MiniMax i2v */}
      <ToolCard
        icon={Star}
        title="MiniMax Hailuo-02 圖生影"
        description="MiniMax 圖生影，超強首幀固定效果，電影級動態"
        badge="MiniMax"
        modelId="fal-ai/minimax/video-01/image-to-video"
        color="rose"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={mmPrompt}
              onChange={e => setMmPrompt(e.target.value)}
              placeholder="描述圖片中的場景如何動起來..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="圖片 URL *"
            value={mmImage}
            onChange={setMmImage}
            accept="image"
            required
          />
          <div className="flex items-center gap-3">
            <Switch
              checked={mmOptimize}
              onCheckedChange={setMmOptimize}
              id="mm-i2v-opt"
            />
            <Label htmlFor="mm-i2v-opt" className="text-xs cursor-pointer">
              AI 提詞優化
            </Label>
          </div>
          <Button
            onClick={runMinimax}
            disabled={mmMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {mmMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                MiniMax 圖生影
              </>
            )}
          </Button>
          {mmResult && (
            <AsyncVideoPoller
              result={mmResult}
              onUpdate={setMmResult}
              label="MiniMax 圖生影結果"
            />
          )}
        </div>
      </ToolCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎞️ Tab 3 — 影生影 Video-to-Video
// ═══════════════════════════════════════════════════════════════════════════════

function VideoToVideoTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [wanPrompt, setWanPrompt] = useState("");
  const [wanVideo, setWanVideo] = useState("");
  const [wanStrength, setWanStrength] = useState(0.7);
  const [wanResult, setWanResult] = useState<VideoResult | null>(null);

  const [klingPrompt, setKlingPrompt] = useState("");
  const [klingVideo, setKlingVideo] = useState("");
  const [klingCfg, setKlingCfg] = useState(0.5);
  const [klingResult, setKlingResult] = useState<VideoResult | null>(null);

  const [ltxPrompt, setLtxPrompt] = useState("");
  const [ltxImage, setLtxImage] = useState("");
  const [ltxNeg, setLtxNeg] = useState("");
  const [ltxResult, setLtxResult] = useState<VideoResult | null>(null);

  const wanMut = trpc.videoStudio.wanVideoToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const klingMut = trpc.videoStudio.klingVideoToVideo.useMutation({
    onError: e => toast.error(e.message),
  });
  const ltxMut = trpc.videoStudio.ltxImageToVideo.useMutation({
    onError: e => toast.error(e.message),
  });

  async function runWan() {
    if (!wanPrompt.trim() || !wanVideo.trim())
      return toast.error("請輸入提詞與影片 URL");
    setAIState("generating");
    try {
      const r = await wanMut.mutateAsync({
        prompt: wanPrompt,
        videoUrl: wanVideo,
        strength: wanStrength,
      });
      setWanResult(r);
      registerBgTask(r, "video", "Wan 影生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runKling() {
    if (!klingPrompt.trim() || !klingVideo.trim())
      return toast.error("請輸入提詞與影片 URL");
    setAIState("generating");
    try {
      const r = await klingMut.mutateAsync({
        prompt: klingPrompt,
        videoUrl: klingVideo,
        cfgScale: klingCfg,
      });
      setKlingResult(r);
      registerBgTask(r, "video", "Kling 影生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runLtx() {
    if (!ltxPrompt.trim() || !ltxImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await ltxMut.mutateAsync({
        prompt: ltxPrompt,
        imageUrl: ltxImage,
        negativePrompt: ltxNeg || undefined,
      });
      setLtxResult(r);
      registerBgTask(r, "video", "LTX 影生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* Wan v2v */}
      <ToolCard
        icon={RefreshCw}
        title="Wan 2.1 影片風格化"
        description="將現有影片依照提詞重新渲染，保持原始動態結構"
        badge="Wan 2.1"
        modelId="fal-ai/wan-ai/wan2.1-v2v-480p"
        color="blue"
        defaultOpen
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">
              新風格提詞 *
            </Label>
            <Textarea
              value={wanPrompt}
              onChange={e => setWanPrompt(e.target.value)}
              placeholder="描述新的視覺風格，例如「水彩動畫風格，柔和色彩」..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="原始影片 URL *"
            value={wanVideo}
            onChange={setWanVideo}
            required
          />
          <div>
            <Label className="text-xs text-muted-foreground">
              重繪強度：{(wanStrength * 100).toFixed(0)}%（越高越偏向新風格）
            </Label>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={[wanStrength]}
              onValueChange={([v]) => setWanStrength(v)}
              className="mt-2"
            />
          </div>
          <Button
            onClick={runWan}
            disabled={wanMut.isPending}
            className="w-full btn-healing"
          >
            {wanMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                重繪中...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Wan 影片風格化
              </>
            )}
          </Button>
          {wanResult && (
            <AsyncVideoPoller
              result={wanResult}
              onUpdate={setWanResult}
              label="Wan 影生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Kling v2v */}
      <ToolCard
        icon={Clapperboard}
        title="Kling v1.6 影片重繪"
        description="Kling 高品質影片重繪，精確保持原始動態，電影級風格"
        badge="Kling 1.6"
        modelId="fal-ai/kling-video/v1.6/standard/video-to-video"
        color="purple"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">重繪提詞 *</Label>
            <Textarea
              value={klingPrompt}
              onChange={e => setKlingPrompt(e.target.value)}
              placeholder="描述想要的新視覺風格..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="原始影片 URL *"
            value={klingVideo}
            onChange={setKlingVideo}
            required
          />
          <div>
            <Label className="text-xs text-muted-foreground">
              CFG 強度：{klingCfg.toFixed(2)}
            </Label>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={[klingCfg]}
              onValueChange={([v]) => setKlingCfg(v)}
              className="mt-2"
            />
          </div>
          <Button
            onClick={runKling}
            disabled={klingMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {klingMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                重繪中...
              </>
            ) : (
              <>
                <Clapperboard className="w-4 h-4 mr-2" />
                Kling 影片重繪
              </>
            )}
          </Button>
          {klingResult && (
            <AsyncVideoPoller
              result={klingResult}
              onUpdate={setKlingResult}
              label="Kling 影生影結果"
            />
          )}
        </div>
      </ToolCard>

      {/* LTX keyframe */}
      <ToolCard
        icon={Layers}
        title="LTX-Video 關鍵幀生成"
        description="以圖片為關鍵幀，LTX 生成連貫流暢的影片動態"
        badge="LTX 13B"
        modelId="fal-ai/ltx-video/image-to-video"
        color="cyan"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">動態描述 *</Label>
            <Textarea
              value={ltxPrompt}
              onChange={e => setLtxPrompt(e.target.value)}
              placeholder="描述畫面如何從這張圖開始運動..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="關鍵幀圖片 URL *"
            value={ltxImage}
            onChange={setLtxImage}
            accept="image"
            required
          />
          <div>
            <Label className="text-xs text-muted-foreground">
              負面提詞（選填）
            </Label>
            <Input
              value={ltxNeg}
              onChange={e => setLtxNeg(e.target.value)}
              placeholder="不希望出現的元素..."
              className="mt-1 text-sm"
            />
          </div>
          <Button
            onClick={runLtx}
            disabled={ltxMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {ltxMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Layers className="w-4 h-4 mr-2" />
                LTX 關鍵幀生成
              </>
            )}
          </Button>
          {ltxResult && (
            <AsyncVideoPoller
              result={ltxResult}
              onUpdate={setLtxResult}
              label="LTX 影片結果"
            />
          )}
        </div>
      </ToolCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✨ Tab 4 — 畫質優化 Enhancement
// ═══════════════════════════════════════════════════════════════════════════════

function EnhancementTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [upVideo, setUpVideo] = useState("");
  const [upFactor, setUpFactor] = useState<"2" | "4">("2");
  const [upResult, setUpResult] = useState<VideoResult | null>(null);

  const [rifeVideo, setRifeVideo] = useState("");
  const [rifeMult, setRifeMult] = useState<"2" | "4">("2");
  const [rifeFps, setRifeFps] = useState(60);
  const [rifeResult, setRifeResult] = useState<VideoResult | null>(null);

  const [topazVideo, setTopazVideo] = useState("");
  const [topazModel, setTopazModel] = useState<
    "iris" | "artemis" | "theia" | "gaia" | "nyx"
  >("iris");
  const [topazScale, setTopazScale] = useState(2);
  const [topazResult, setTopazResult] = useState<VideoResult | null>(null);

  const upscaleMut = trpc.videoStudio.videoUpscale.useMutation({
    onError: e => toast.error(e.message),
  });
  const rifeMut = trpc.videoStudio.frameInterpolation.useMutation({
    onError: e => toast.error(e.message),
  });
  const topazMut = trpc.videoStudio.topazEnhance.useMutation({
    onError: e => toast.error(e.message),
  });

  async function runUpscale() {
    if (!upVideo.trim()) return toast.error("請輸入影片 URL");
    setAIState("generating");
    try {
      const r = await upscaleMut.mutateAsync({
        videoUrl: upVideo,
        upscaleFactor: upFactor,
      });
      setUpResult(r);
      registerBgTask(r, "video", "影片超解析度");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runRife() {
    if (!rifeVideo.trim()) return toast.error("請輸入影片 URL");
    setAIState("generating");
    try {
      const r = await rifeMut.mutateAsync({
        videoUrl: rifeVideo,
        multiplier: rifeMult,
        outputFps: rifeFps,
      });
      setRifeResult(r);
      registerBgTask(r, "video", "幀插補");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runTopaz() {
    if (!topazVideo.trim()) return toast.error("請輸入影片 URL");
    setAIState("generating");
    try {
      const r = await topazMut.mutateAsync({
        videoUrl: topazVideo,
        model: topazModel,
        outputScale: topazScale,
      });
      setTopazResult(r);
      registerBgTask(r, "video", "Topaz 畫質增強");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* ByteDance Upscaler */}
      <ToolCard
        icon={Maximize2}
        title="ByteDance 影片超解析度"
        description="業界頂尖 2x/4x 影片超分辨率，細節清晰鮮明"
        badge="ByteDance"
        modelId="fal-ai/bytedance/upscaler/video"
        color="orange"
        defaultOpen
      >
        <div className="space-y-3">
          <UrlInput
            label="原始影片 URL *"
            value={upVideo}
            onChange={setUpVideo}
            required
          />
          <div>
            <Label className="text-xs text-muted-foreground">放大倍率</Label>
            <Select
              value={upFactor}
              onValueChange={v => setUpFactor(v as "2" | "4")}
            >
              <SelectTrigger className="mt-1 text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2x（推薦）</SelectItem>
                <SelectItem value="4">4x（超高清）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={runUpscale}
            disabled={upscaleMut.isPending}
            className="w-full btn-healing"
          >
            {upscaleMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                超分中...
              </>
            ) : (
              <>
                <Maximize2 className="w-4 h-4 mr-2" />
                影片超解析度
              </>
            )}
          </Button>
          {upResult && (
            <AsyncVideoPoller
              result={upResult}
              onUpdate={setUpResult}
              label="超分結果"
            />
          )}
        </div>
      </ToolCard>

      {/* RIFE */}
      <ToolCard
        icon={Zap}
        title="RIFE v4.6 影片補幀"
        description="業界最佳補幀算法，2x/4x 幀率提升，動態更流暢"
        badge="RIFE 4.6"
        modelId="fal-ai/rife-v4.6/video"
        color="green"
      >
        <div className="space-y-3">
          <UrlInput
            label="原始影片 URL *"
            value={rifeVideo}
            onChange={setRifeVideo}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">補幀倍率</Label>
              <Select
                value={rifeMult}
                onValueChange={v => setRifeMult(v as "2" | "4")}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2x 補幀</SelectItem>
                  <SelectItem value="4">4x 補幀</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                目標幀率：{rifeFps} fps
              </Label>
              <Slider
                min={24}
                max={120}
                step={6}
                value={[rifeFps]}
                onValueChange={([v]) => setRifeFps(v)}
                className="mt-3"
              />
            </div>
          </div>
          <Button
            onClick={runRife}
            disabled={rifeMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {rifeMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                補幀中...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                影片補幀
              </>
            )}
          </Button>
          {rifeResult && (
            <AsyncVideoPoller
              result={rifeResult}
              onUpdate={setRifeResult}
              label="補幀結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Topaz */}
      <ToolCard
        icon={Eye}
        title="Topaz Video Enhance AI"
        description="Topaz Labs 專業影片降噪 + 超解析，電影後期品質"
        badge="Topaz"
        modelId="fal-ai/topaz/video-enhance"
        color="indigo"
      >
        <div className="space-y-3">
          <UrlInput
            label="原始影片 URL *"
            value={topazVideo}
            onChange={setTopazVideo}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">AI 模型</Label>
              <Select
                value={topazModel}
                onValueChange={v => setTopazModel(v as any)}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iris">Iris（人臉/細節）</SelectItem>
                  <SelectItem value="artemis">Artemis（通用）</SelectItem>
                  <SelectItem value="theia">Theia（細膩）</SelectItem>
                  <SelectItem value="gaia">Gaia（極高解析）</SelectItem>
                  <SelectItem value="nyx">Nyx（低光/降噪）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                輸出倍率：{topazScale}x
              </Label>
              <Slider
                min={1}
                max={4}
                step={1}
                value={[topazScale]}
                onValueChange={([v]) => setTopazScale(v)}
                className="mt-3"
              />
            </div>
          </div>
          <Button
            onClick={runTopaz}
            disabled={topazMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {topazMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                增強中（可能需要 5-10 分鐘）...
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Topaz 影片增強
              </>
            )}
          </Button>
          {topazResult && (
            <AsyncVideoPoller
              result={topazResult}
              onUpdate={setTopazResult}
              label="Topaz 增強結果"
            />
          )}
        </div>
      </ToolCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎛️ Tab 5 — 進階控制 Advanced Control
// ═══════════════════════════════════════════════════════════════════════════════

function AdvancedControlTab() {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();
  const [camPrompt, setCamPrompt] = useState("");
  const [camImage, setCamImage] = useState("");
  const [camMotion, setCamMotion] = useState("push_in");
  const [camDuration, setCamDuration] = useState(5);
  const [camResult, setCamResult] = useState<VideoResult | null>(null);

  const [adPrompt, setAdPrompt] = useState("");
  const [adNeg, setAdNeg] = useState("");
  const [adVideo, setAdVideo] = useState("");
  const [adControlNet, setAdControlNet] = useState<
    "openpose" | "canny" | "depth" | "none"
  >("openpose");
  const [adGuide, setAdGuide] = useState(7.5);
  const [adResult, setAdResult] = useState<VideoResult | null>(null);

  const [dcVideo, setDcVideo] = useState("");
  const [dcResult, setDcResult] = useState<VideoResult | null>(null);

  const [viduPrompt, setViduPrompt] = useState("");
  const [viduImages, setViduImages] = useState(["", ""]);
  const [viduDuration, setViduDuration] = useState<"4" | "8">("4");
  const [viduResult, setViduResult] = useState<VideoResult | null>(null);

  const camMut = trpc.videoStudio.camMaster.useMutation({
    onError: e => toast.error(e.message),
  });
  const adMut = trpc.videoStudio.animateDiff.useMutation({
    onError: e => toast.error(e.message),
  });
  const dcMut = trpc.videoStudio.depthCrafter.useMutation({
    onError: e => toast.error(e.message),
  });
  const viduMut = trpc.videoStudio.viduReferenceToVideo.useMutation({
    onError: e => toast.error(e.message),
  });

  async function runCam() {
    if (!camPrompt.trim() || !camImage.trim())
      return toast.error("請輸入提詞與圖片 URL");
    setAIState("generating");
    try {
      const r = await camMut.mutateAsync({
        prompt: camPrompt,
        imageUrl: camImage,
        cameraMotion: camMotion as any,
        duration: camDuration,
      });
      setCamResult(r);
      registerBgTask(r, "video", "CamMaster 鏡頭控制");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runAnimateDiff() {
    if (!adPrompt.trim() || !adVideo.trim())
      return toast.error("請輸入提詞與影片 URL");
    setAIState("generating");
    try {
      const r = await adMut.mutateAsync({
        prompt: adPrompt,
        videoUrl: adVideo,
        controlNet: adControlNet,
        guidanceScale: adGuide,
        negativePrompt: adNeg || undefined,
      });
      setAdResult(r);
      registerBgTask(r, "video", "AnimateDiff 風格化");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runDepthCrafter() {
    if (!dcVideo.trim()) return toast.error("請輸入影片 URL");
    setAIState("generating");
    try {
      const r = await dcMut.mutateAsync({ videoUrl: dcVideo });
      setDcResult(r);
      registerBgTask(r, "video", "DepthCrafter 深度圖");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  async function runVidu() {
    const urls = viduImages.filter(u => u.trim());
    if (!viduPrompt.trim() || urls.length === 0)
      return toast.error("請輸入提詞與至少一張圖片 URL");
    setAIState("generating");
    try {
      const r = await viduMut.mutateAsync({
        prompt: viduPrompt,
        imageUrls: urls,
        duration: viduDuration,
      });
      setViduResult(r);
      registerBgTask(r, "video", "Vidu 參考圖生影");
      toast.success("📤 任務已提交！稍後自動更新結果...");
      reportSuccess();
    } catch {
      reportFailure();
    } finally {
      setAIState("idle");
    }
  }

  const CAMERA_MOTIONS = [
    { value: "static", label: "靜態（無鏡頭移動）" },
    { value: "push_in", label: "推鏡（向前推進）" },
    { value: "pull_out", label: "拉鏡（向後拉遠）" },
    { value: "pan_left", label: "搖鏡（向左平移）" },
    { value: "pan_right", label: "搖鏡（向右平移）" },
    { value: "tilt_up", label: "仰鏡（向上傾斜）" },
    { value: "tilt_down", label: "俯鏡（向下傾斜）" },
    { value: "orbit_left", label: "環繞左旋（Arc Shot）" },
    { value: "orbit_right", label: "環繞右旋（Arc Shot）" },
    { value: "crane_up", label: "升鏡（往上升）" },
    { value: "crane_down", label: "降鏡（往下降）" },
    { value: "roll_clockwise", label: "荷蘭角（順時針）" },
    { value: "roll_counterclockwise", label: "荷蘭角（逆時針）" },
    { value: "move_left", label: "橫移左" },
    { value: "move_right", label: "橫移右" },
    { value: "move_up", label: "垂直上移" },
    { value: "move_down", label: "垂直下移" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* CamMaster */}
      <ToolCard
        icon={Camera}
        title="CamMaster 精確鏡頭控制"
        description="17 種專業鏡頭運動指令，電影運鏡精確控制"
        badge="CamMaster"
        modelId="fal-ai/cammaster"
        color="purple"
        isNew
        defaultOpen
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">場景描述 *</Label>
            <Textarea
              value={camPrompt}
              onChange={e => setCamPrompt(e.target.value)}
              placeholder="描述場景主體與氛圍..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <UrlInput
            label="參考圖片 URL *"
            value={camImage}
            onChange={setCamImage}
            accept="image"
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">鏡頭運動</Label>
              <Select value={camMotion} onValueChange={setCamMotion}>
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAMERA_MOTIONS.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                時長：{camDuration}s
              </Label>
              <Slider
                min={3}
                max={10}
                step={1}
                value={[camDuration]}
                onValueChange={([v]) => setCamDuration(v)}
                className="mt-3"
              />
            </div>
          </div>
          <Button
            onClick={runCam}
            disabled={camMut.isPending}
            className="w-full btn-healing"
          >
            {camMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4 mr-2" />
                CamMaster 生成
              </>
            )}
          </Button>
          {camResult && (
            <AsyncVideoPoller
              result={camResult}
              onUpdate={setCamResult}
              label="CamMaster 結果"
            />
          )}
        </div>
      </ToolCard>

      {/* AnimateDiff */}
      <ToolCard
        icon={Move}
        title="AnimateDiff + ControlNet 動作控制"
        description="以骨架姿勢 / Canny 邊緣精確控制每一幀的動作"
        badge="AnimateDiff"
        modelId="fal-ai/animatediff-v2v"
        color="indigo"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">提詞 *</Label>
            <Textarea
              value={adPrompt}
              onChange={e => setAdPrompt(e.target.value)}
              placeholder="描述生成目標的外觀風格..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              負面提詞（選填）
            </Label>
            <Input
              value={adNeg}
              onChange={e => setAdNeg(e.target.value)}
              placeholder="不想要的元素..."
              className="mt-1 text-sm"
            />
          </div>
          <UrlInput
            label="控制影片 URL *（姿勢 / Canny 來源）"
            value={adVideo}
            onChange={setAdVideo}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                ControlNet 類型
              </Label>
              <Select
                value={adControlNet}
                onValueChange={v => setAdControlNet(v as any)}
              >
                <SelectTrigger className="mt-1 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openpose">OpenPose（骨架）</SelectItem>
                  <SelectItem value="canny">Canny（邊緣）</SelectItem>
                  <SelectItem value="depth">Depth（深度）</SelectItem>
                  <SelectItem value="none">無控制</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                引導強度：{adGuide.toFixed(1)}
              </Label>
              <Slider
                min={1}
                max={20}
                step={0.5}
                value={[adGuide]}
                onValueChange={([v]) => setAdGuide(v)}
                className="mt-3"
              />
            </div>
          </div>
          <Button
            onClick={runAnimateDiff}
            disabled={adMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {adMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Move className="w-4 h-4 mr-2" />
                AnimateDiff 生成
              </>
            )}
          </Button>
          {adResult && (
            <AsyncVideoPoller
              result={adResult}
              onUpdate={setAdResult}
              label="AnimateDiff 結果"
            />
          )}
        </div>
      </ToolCard>

      {/* DepthCrafter */}
      <ToolCard
        icon={Eye}
        title="DepthCrafter 深度感知生成"
        description="從單目影片重建深度時序，產生 3D 視差效果深度圖影片"
        badge="DepthCrafter"
        modelId="fal-ai/depthcrafter"
        color="green"
      >
        <div className="space-y-3">
          <UrlInput
            label="原始影片 URL *"
            value={dcVideo}
            onChange={setDcVideo}
            required
          />
          <p className="hs-small !mb-0 text-muted-foreground">
            DepthCrafter 將分析影片每一幀的深度信息，輸出深度圖影片，可用於後期
            3D 效果合成。
          </p>
          <Button
            onClick={runDepthCrafter}
            disabled={dcMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {dcMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                深度重建中...
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-2" />
                DepthCrafter 深度重建
              </>
            )}
          </Button>
          {dcResult && (
            <AsyncVideoPoller
              result={dcResult}
              onUpdate={setDcResult}
              label="DepthCrafter 深度圖結果"
            />
          )}
        </div>
      </ToolCard>

      {/* Vidu Reference */}
      <ToolCard
        icon={Cpu}
        title="Vidu Q1 角色一致性生成"
        description="最多 3 張參考圖，強力保持角色外觀一致性"
        badge="Vidu Q1"
        modelId="fal-ai/vidu/q1/reference-to-video"
        color="rose"
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">場景提詞 *</Label>
            <Textarea
              value={viduPrompt}
              onChange={e => setViduPrompt(e.target.value)}
              placeholder="描述角色的動作與場景..."
              className="mt-1 text-sm resize-none"
              rows={2}
            />
          </div>
          {viduImages.map((url, i) => (
            <UrlInput
              key={i}
              label={`參考圖片 ${i + 1} URL${i === 0 ? " *" : "（選填）"}`}
              value={url}
              onChange={v => {
                const next = [...viduImages];
                next[i] = v;
                setViduImages(next);
              }}
              accept="image"
              required={i === 0}
            />
          ))}
          {viduImages.length < 3 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => setViduImages([...viduImages, ""])}
            >
              + 新增參考圖片
            </Button>
          )}
          <div>
            <Label className="text-xs text-muted-foreground">時長</Label>
            <Select
              value={viduDuration}
              onValueChange={v => setViduDuration(v as "4" | "8")}
            >
              <SelectTrigger className="mt-1 text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 秒</SelectItem>
                <SelectItem value="8">8 秒</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={runVidu}
            disabled={viduMut.isPending}
            className="w-full btn-healing"
            variant="secondary"
          >
            {viduMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Cpu className="w-4 h-4 mr-2" />
                Vidu 角色一致性生成
              </>
            )}
          </Button>
          {viduResult && (
            <AsyncVideoPoller
              result={viduResult}
              onUpdate={setViduResult}
              label="Vidu 生成結果"
            />
          )}
        </div>
      </ToolCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🎬 主頁面元件
// ═══════════════════════════════════════════════════════════════════════════════

export default function VideoStudio() {
  // 全站新手引導
  usePageTour("video-studio");

  // ── AI Agent Integration ──
  const {
    aiState,
    setAIState,
    reportSuccess,
    reportFailure,
    setPageContext,
    personality,
  } = useAIState();

  const [activeTab, setActiveTab] = useState<TabId>("t2v");
  const [appliedModelBanner, setAppliedModelBanner] = useState<string | null>(
    null
  );

  // ── AI Agent: broadcast page context ──
  useEffect(() => {
    setPageContext({
      pageId: "video-studio",
      pageLabel: "影片專業工作室",
      activeTab,
    });
    return () => setPageContext(null);
  }, [activeTab, setPageContext]);

  // ── Restore applied model from ModelsPage (via sessionStorage) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("applyModel");
      if (raw) {
        const modelData = JSON.parse(raw);
        if (modelData?.name) {
          setAppliedModelBanner(
            `角色模型「${modelData.name}」已就緒${modelData.triggerWord ? ` (觸發詞: ${modelData.triggerWord})` : ""}，請在提示詞中加入觸發詞以啟用角色一致性`
          );
          sessionStorage.removeItem("applyModel");
        }
      }
    } catch {
      // silent
    }
  }, []);

  // ── Restore Director AI sendToStudio payload (video path) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sendToStudio");
      if (!raw) return;
      const data = JSON.parse(raw) as {
        generationType?: string;
        overrideEngine?: string;
        source?: string;
        sceneName?: string;
      };
      if (data.generationType !== "video") return;

      if (data.overrideEngine) {
        const canonical = normalizeEngineModelId(data.overrideEngine);
        const matched = OVERRIDE_TAB_BY_ENGINE.find(x =>
          canonical.startsWith(x.prefix)
        );
        if (matched) {
          setActiveTab(matched.tab);
        }
      }

      sessionStorage.removeItem("sendToStudio");
      toast.success(
        data.source === "director_ai" && data.sceneName
          ? `已從導演 AI 載入「${data.sceneName}」到影片創作室`
          : "已載入導演 AI 設定到影片創作室"
      );
    } catch {
      // silent
    }
  }, []);

  const MODEL_COUNT = {
    t2v: 6,
    i2v: 5,
    v2v: 3,
    enhance: 3,
    control: 4,
  };

  // ── 光球代理人：註冊頁面能力 ─────────────────────────────────────────
  // VideoStudio 的子分頁各自維護 prompt/model 狀態，光球在這層可以：
  //   1. 切分頁（setTab）
  //   2. 告訴 LLM 每個分頁底下有哪些模型（讓 LLM 能用自然語言引導）
  const VIDEO_MODELS: Array<{
    id: string;
    label: string;
    tab: TabId;
    desc: string;
  }> = [
    // t2v
    { id: "kling-t2v", label: "Kling 2.1 文生影", tab: "t2v", desc: "高品質、支援 5/10s、負向提示詞、CFG" },
    { id: "wan-t2v", label: "Wan 2.1 文生影", tab: "t2v", desc: "480p / 720p、可調 frames" },
    { id: "minimax-t2v", label: "MiniMax Hailuo 文生影", tab: "t2v", desc: "快速原型、支援 prompt optimization" },
    { id: "veo3-t2v", label: "Veo 3 文生影", tab: "t2v", desc: "Google Veo、可加音訊、16:9/9:16" },
    { id: "ltx-t2v", label: "LTX 13B 文生影", tab: "t2v", desc: "開源高品質、支援負向提示詞" },
    { id: "sora-t2v", label: "Sora 文生影", tab: "t2v", desc: "OpenAI Sora、480p/720p/1080p" },
    // i2v
    { id: "kling-i2v", label: "Kling 2.1 圖生影", tab: "i2v", desc: "首尾幀、5/10s" },
    { id: "wan-i2v", label: "Wan 2.1 圖生影", tab: "i2v", desc: "480p / 720p" },
    { id: "runway-i2v", label: "Runway Gen4 圖生影", tab: "i2v", desc: "5/10s、可設 aspect ratio" },
    { id: "pixverse-i2v", label: "PixVerse 4.5 圖生影", tab: "i2v", desc: "4s/8s、多品質檔次" },
    { id: "minimax-i2v", label: "MiniMax 圖生影", tab: "i2v", desc: "支援 prompt optimization" },
    // v2v
    { id: "wan-v2v", label: "Wan 2.1 影生影", tab: "v2v", desc: "風格轉換、strength 可調" },
    { id: "kling-v2v", label: "Kling 影生影", tab: "v2v", desc: "CFG 控制原影片保留度" },
    { id: "ltx-v2v", label: "LTX 影生影", tab: "v2v", desc: "開源、高品質" },
    // enhance
    { id: "video-upscale", label: "影片超解析", tab: "enhance", desc: "SeedVR 超解析、×2/×4" },
    { id: "frame-interp", label: "RIFE 補幀", tab: "enhance", desc: "流暢度提升、60fps 化" },
    { id: "topaz-enhance", label: "Topaz 畫質增強", tab: "enhance", desc: "去噪、去模糊、專業級" },
    // control
    { id: "cam-master", label: "CamMaster 運鏡控制", tab: "control", desc: "指定攝影機運動" },
    { id: "animate-diff", label: "AnimateDiff", tab: "control", desc: "精準動作控制" },
    { id: "depth-crafter", label: "DepthCrafter", tab: "control", desc: "深度圖生成、3D 感" },
    { id: "vidu-ref", label: "Vidu Q1 參考生影", tab: "control", desc: "多參考圖、角色一致" },
  ];

  const agentCapabilities: AgentCapability[] = [
    {
      action: "setTab",
      label: "分頁",
      currentId: activeTab,
      options: TABS.map(t => ({
        id: t.id,
        label: t.label,
        description: t.desc,
        meta: { count: MODEL_COUNT[t.id] },
      })),
      hint: "切換 t2v / i2v / v2v / enhance / control 五大影片能力分頁",
    },
    {
      action: "setModel",
      label: "模型（僅提示用途）",
      options: VIDEO_MODELS.map(m => ({
        id: m.id,
        label: m.label,
        description: m.desc,
        meta: { tab: m.tab },
      })),
      hint: "影片工作室的模型 UI 為每分頁並列多個卡片，setModel 僅供 LLM 做語意對照；實際請透過 setTab + 自然語引導",
    },
    {
      action: "focusElement",
      label: "視覺指引",
      hint: "可用 elementId=video-tab-t2v / video-tab-i2v 等 id，搭配 message 說明",
    },
  ];

  useRegisterPageAgent({
    pageId: "video-studio",
    pageLabel: "影片專業工作室",
    pagePath: "/video-studio",
    capabilities: agentCapabilities,
    state: { activeTab, modelCount: VIDEO_MODELS.length },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const tab = TABS.find(t => t.id === action.tabId);
          if (!tab) return { ok: false, reason: `unknown tabId: ${action.tabId}` };
          setActiveTab(tab.id);
          return { ok: true };
        }
        case "setModel": {
          const m = VIDEO_MODELS.find(x => x.id === action.modelId);
          if (!m) return { ok: false, reason: `unknown modelId: ${action.modelId}` };
          // 切到對應分頁；具體選模型由使用者在該分頁點選
          setActiveTab(m.tab);
          return {
            ok: true,
            message: `已切到「${TABS.find(t => t.id === m.tab)?.label}」分頁，你可以用裡面的 ${m.label}`,
          };
        }
        case "focusElement":
          return { ok: true };
        case "fillPrompt":
        case "submit":
        case "reset":
        case "applyPreset":
        case "setParam":
          return {
            ok: false,
            reason: "影片工作室的提示詞與參數由各模型卡片各自管理，無法從頁面層統一操作",
          };
        default:
          return { ok: false, reason: "unsupported action" };
      }
    },
  });

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-5">
      {/* 頁面標題 */}
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="p-2.5 sm:p-3 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/10 border border-blue-200/40 dark:border-blue-700/30 shrink-0">
          <Film className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="hs-h2 !mb-0 text-foreground">影片專業工作室</h1>
          <p className="hs-small !mb-0 text-muted-foreground mt-0.5 leading-relaxed">
            整合 FAL.AI 頂尖影片生成模型，共{" "}
            <span className="font-semibold text-foreground/80">{Object.values(MODEL_COUNT).reduce((a, b) => a + b, 0)}</span>{" "}個模型
            <span className="text-muted-foreground/50">
              {" "}· 點擊卡片展開使用
            </span>
          </p>
          <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-2">
            {(
              [
                "Kling 2.1",
                "Wan 2.1",
                "Veo 3",
                "Sora",
                "Runway Gen4",
                "PixVerse 4.5",
                "MiniMax",
                "LTX 13B",
                "Topaz",
                "RIFE",
                "CamMaster",
                "Vidu Q1",
              ] as string[]
            ).map(tag => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[10px] transition-colors hover:bg-accent"
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
        <VisualSoul
          size="sm"
          state={aiState}
          personality={personality}
          className="!w-7 !h-7 shrink-0"
        />
      </div>

      {/* API Key 提示 */}
      <ApiKeyBanner />

      {/* Applied Model Banner */}
      {appliedModelBanner && (
        <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 dark:bg-amber-900/20 px-4 py-3 flex items-center justify-between gap-2">
          <p className="hs-small !mb-0 text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <span>🎭</span>
            {appliedModelBanner}
          </p>
          <button
            onClick={() => setAppliedModelBanner(null)}
            className="text-amber-500 hover:text-amber-700 transition-colors text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* 標籤列 */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-lg -mx-3 sm:-mx-4 px-3 sm:px-4 py-2.5 border-b border-border/30 shadow-sm">
        <div className="flex overflow-x-auto gap-1.5 pb-0.5 no-scrollbar scroll-fade-x">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = MODEL_COUNT[tab.id];
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 min-h-[40px] border
                  ${
                    isActive
                      ? "bg-primary text-primary-foreground border-primary shadow-md scale-[1.02]"
                      : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground active:scale-[0.98] border-border/40"
                  }
                `}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full leading-none ${isActive ? "bg-white/20" : "bg-primary/10 text-primary"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-primary/40" />
          {TABS.find(t => t.id === activeTab)?.desc}
        </p>
      </div>

      {/* 標籤內容 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "t2v" && <TextToVideoTab />}
          {activeTab === "i2v" && <ImageToVideoTab />}
          {activeTab === "v2v" && <VideoToVideoTab />}
          {activeTab === "enhance" && <EnhancementTab />}
          {activeTab === "control" && <AdvancedControlTab />}
        </motion.div>
      </AnimatePresence>

      {/* 頁腳說明 */}
      <div className="mt-6 sm:mt-8 p-4 sm:p-5 rounded-2xl bg-muted/30 border border-border/20 text-xs text-muted-foreground">
        <p className="font-medium text-foreground text-sm mb-2.5 flex items-center gap-2">
          <span className="p-1 rounded-lg bg-primary/10"><AlertCircle className="w-3.5 h-3.5 text-primary" /></span>
          使用說明
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 leading-relaxed">
          <p>🔄 所有影片生成任務為非同步處理，通常需 1-10 分鐘</p>
          <p>🌏 提詞建議使用英文，Kling 模型對中文有優化</p>
          <p>🔗 影片 URL 需為公開可存取的直連 URL</p>
          <p>💰 Veo 3 和 Sora 費用較高，建議確認需求後再生成</p>
        </div>
      </div>
    </div>
  );
}
