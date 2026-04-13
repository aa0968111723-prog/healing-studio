import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { toast } from "sonner";
import {
  Image, Video, Music, Mic, Bookmark, BookmarkCheck,
  Star, Trash2, Filter, Clock, Search, ChevronDown,
  Send, Wand2, RefreshCw, Download, FileText, Timer, Coins, Tag,
  Archive, Sparkles, X,
} from "lucide-react";
import JSZip from "jszip";

import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAIState } from "@/contexts/AIStateContext";
import { useIsMobile } from "@/hooks/useMobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ─── Modality Config ───────────────────────────────────────────────────────

const MODALITY_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string; bg: string }> = {
  image: { icon: <Image className="w-3.5 h-3.5" />, label: "圖片", color: "text-blue-600", bg: "bg-blue-50" },
  video: { icon: <Video className="w-3.5 h-3.5" />, label: "影片", color: "text-purple-600", bg: "bg-purple-50" },
  audio: { icon: <Music className="w-3.5 h-3.5" />, label: "音樂", color: "text-amber-600", bg: "bg-amber-50" },
  voice: { icon: <Mic className="w-3.5 h-3.5" />, label: "語音", color: "text-emerald-600", bg: "bg-emerald-50" },
};

// ─── Star Rating Component ─────────────────────────────────────────────────

function StarRating({
  value,
  onChange,
  size = "sm",
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState(0);
  const starSize = size === "sm" ? "w-5 h-5 sm:w-3.5 sm:h-3.5" : "w-5 h-5 sm:w-4.5 sm:h-4.5";

  return (
    <div className="flex gap-1 sm:gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={(e) => { e.stopPropagation(); onChange(star); }}
          className="p-1 sm:p-0 transition-transform hover:scale-110"
        >
          <Star
            className={cn(
              starSize,
              "transition-colors",
              (hover || value || 0) >= star
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/30"
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ─── History Page ──────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { personality } = useAIState();

  // 全站新手引導
  usePageTour("history");
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const [filter, setFilter] = useState<"all" | "image" | "video" | "audio" | "voice" | "bookmarked">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: allHistory, isLoading } = trpc.history.list.useQuery({ limit: 200 });
  const { data: bookmarkedHistory } = trpc.history.bookmarked.useQuery();

  const toggleBookmark = trpc.history.toggleBookmark.useMutation({
    onMutate: async ({ id, isBookmarked }) => {
      await utils.history.list.cancel();
      const prev = utils.history.list.getData({ limit: 200 });
      utils.history.list.setData({ limit: 200 }, (old) =>
        old?.map((h) => (h.id === id ? { ...h, isBookmarked } : h))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.history.list.setData({ limit: 200 }, ctx.prev);
      toast.error("操作失敗");
    },
    onSettled: () => {
      utils.history.list.invalidate();
      utils.history.bookmarked.invalidate();
    },
  });

  const rateMutation = trpc.history.rate.useMutation({
    onMutate: async ({ id, rating }) => {
      await utils.history.list.cancel();
      const prev = utils.history.list.getData({ limit: 200 });
      utils.history.list.setData({ limit: 200 }, (old) =>
        old?.map((h) => (h.id === id ? { ...h, userRating: rating } : h))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) utils.history.list.setData({ limit: 200 }, ctx.prev);
    },
    onSettled: () => utils.history.list.invalidate(),
  });

  const deleteMutation = trpc.history.delete.useMutation({
    onSuccess: () => {
      utils.history.list.invalidate();
      utils.history.bookmarked.invalidate();
      toast.success("已刪除");
    },
  });

  // ── Promote to Showcase ──
  const [promoteDialogId, setPromoteDialogId] = useState<number | null>(null);
  const [promoteTitle, setPromoteTitle] = useState("");
  const [promoteDesc, setPromoteDesc] = useState("");
  const promoteMutation = trpc.showcase.promote.useMutation({
    onSuccess: () => {
      toast.success("已加入首頁精選作品集！", { duration: 5000 });
      setPromoteDialogId(null);
      setPromoteTitle("");
      setPromoteDesc("");
    },
    onError: (e) => toast.error(e.message),
  });

  const handlePromote = () => {
    if (!promoteTitle.trim()) { toast.error("請輸入作品標題"); return; }
    if (!promoteDialogId) return;
    promoteMutation.mutate({ historyId: promoteDialogId, title: promoteTitle.trim(), description: promoteDesc.trim() || undefined });
  };

  const filteredHistory = useMemo(() => {
    let items = filter === "bookmarked"
      ? (bookmarkedHistory || [])
      : (allHistory || []);

    if (filter !== "all" && filter !== "bookmarked") {
      items = items.filter((h) => h.modality === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (h) =>
          h.prompt?.toLowerCase().includes(q) ||
          h.compiledPrompt?.toLowerCase().includes(q)
      );
    }

    return items;
  }, [allHistory, bookmarkedHistory, filter, searchQuery]);

  const stats = useMemo(() => {
    const all = allHistory || [];
    return {
      total: all.length,
      image: all.filter((h) => h.modality === "image").length,
      video: all.filter((h) => h.modality === "video").length,
      audio: all.filter((h) => h.modality === "audio").length,
      voice: all.filter((h) => h.modality === "voice").length,
      bookmarked: all.filter((h) => h.isBookmarked).length,
    };
  }, [allHistory]);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">生成歷史</h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <ZenSkeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">生成歷史</h1>
          <span className="text-xs text-muted-foreground tabular-nums">
            共 {stats.total} 筆紀錄
          </span>
        </div>
      </div>

      {/* Stats Bar — horizontal scroll on mobile */}
      <div className="-mx-4 sm:mx-0 px-4 sm:px-0">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide no-scrollbar" style={{ scrollbarWidth: "none" }}>
          {[
            { key: "all" as const, label: "全部", count: stats.total },
            { key: "image" as const, label: "圖片", count: stats.image },
            { key: "video" as const, label: "影片", count: stats.video },
            { key: "audio" as const, label: "音樂", count: stats.audio },
            { key: "voice" as const, label: "語音", count: stats.voice },
            { key: "bookmarked" as const, label: "收藏", count: stats.bookmarked },
          ].map((item) => (
            <Button
              key={item.key}
              variant={filter === item.key ? "default" : "outline"}
              size="sm"
              className="rounded-xl text-xs gap-1.5 h-10 sm:h-8 shrink-0"
              onClick={() => setFilter(item.key)}
            >
              {item.key === "bookmarked" ? (
                <BookmarkCheck className="w-3 h-3" />
              ) : item.key !== "all" ? (
                MODALITY_CONFIG[item.key]?.icon
              ) : (
                <Filter className="w-3 h-3" />
              )}
              {item.label}
              <span className="tabular-nums opacity-70">{item.count}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜尋提示詞..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 rounded-xl bg-white/40 border-white/60 h-11 sm:h-9 text-base sm:text-sm"
        />
      </div>

      {/* History Grid */}
      {filteredHistory.length === 0 ? (
        <GlassCard hover={false} className="flex flex-col items-center justify-center py-16 text-center">
          <VisualSoul size="md" personality={personality} />
          <p className="text-sm text-muted-foreground mt-4">
            {filter === "bookmarked"
              ? "尚無收藏的生成紀錄"
              : searchQuery
              ? "找不到符合條件的紀錄"
              : "尚無生成歷史，前往工作室開始創作吧"}
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          <AnimatePresence mode="popLayout">
            {filteredHistory.map((item) => {
              const config = MODALITY_CONFIG[item.modality] || MODALITY_CONFIG.image;
              const isExpanded = expandedId === item.id;

              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                >
                  <div onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                  <GlassCard
                    hover
                    className="cursor-pointer space-y-3"
                  >
                    {/* Thumbnail / Preview */}
                    {item.resultUrl && item.modality === "image" ? (
                      <div className="rounded-lg overflow-hidden aspect-video bg-muted/20">
                        <img
                          src={item.thumbnailUrl || item.resultUrl}
                          alt={item.prompt || "Generated"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : item.resultUrl && item.modality === "video" ? (
                      <div className="rounded-lg overflow-hidden aspect-video bg-black/5">
                        <video
                          src={item.resultUrl}
                          controls
                          preload="metadata"
                          className="w-full h-full object-contain"
                          poster={item.thumbnailUrl || undefined}
                        />
                      </div>
                    ) : item.resultUrl && (item.modality === "audio" || item.modality === "voice") ? (
                      <div className={cn(
                        "rounded-lg aspect-video flex flex-col items-center justify-center gap-3",
                        config.bg,
                      )}>
                        <div className={cn("w-12 h-12 rounded-full flex items-center justify-center", config.color)}>
                          {item.modality === "audio" ? <Music className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                        </div>
                        <audio
                          src={item.resultUrl}
                          controls
                          preload="metadata"
                          className="w-[85%] h-8"
                        />
                      </div>
                    ) : (
                      <div className={cn(
                        "rounded-lg aspect-video flex items-center justify-center",
                        config.bg,
                      )}>
                        <div className={cn("w-12 h-12 rounded-full flex items-center justify-center", config.color)}>
                          {item.modality === "image" && <Image className="w-6 h-6" />}
                          {item.modality === "video" && <Video className="w-6 h-6" />}
                          {item.modality === "audio" && <Music className="w-6 h-6" />}
                          {item.modality === "voice" && <Mic className="w-6 h-6" />}
                        </div>
                      </div>
                    )}

                    {/* Info Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                            config.bg, config.color,
                          )}>
                            {config.icon}
                            {config.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(item.createdAt).toLocaleDateString("zh-TW", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                          {item.prompt || "（無提示詞）"}
                        </p>
                      </div>

                      {/* Bookmark */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleBookmark.mutate({
                            id: item.id,
                            isBookmarked: !item.isBookmarked,
                          });
                        }}
                        className="shrink-0 p-2 sm:p-1 rounded-md hover:bg-muted/50 active:bg-muted/70 transition-colors"
                      >
                        {item.isBookmarked ? (
                          <BookmarkCheck className="w-4 h-4 text-amber-500 fill-amber-500" />
                        ) : (
                          <Bookmark className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </button>
                    </div>

                    {/* Rating + Quick Download */}
                    <div className="flex items-center justify-between">
                      <StarRating
                        value={item.userRating}
                        onChange={(rating) => rateMutation.mutate({ id: item.id, rating })}
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {item.costCredits} 配額
                        </span>
                        {item.resultUrl && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(item.resultUrl!)}`;
                                const resp = await fetch(proxyUrl);
                                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                const blob = await resp.blob();
                                const ext = item.modality === "image" ? (blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg")
                                  : item.modality === "video" ? "mp4"
                                  : item.modality === "audio" ? (blob.type.includes("wav") ? "wav" : "mp3")
                                  : item.modality === "voice" ? (blob.type.includes("wav") ? "wav" : "mp3")
                                  : "bin";
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `ai-director-${item.modality}-${item.id}.${ext}`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                                toast.success(`已下載`);
                              } catch {
                                window.open(item.resultUrl!, "_blank");
                                toast.info("已在新分頁開啟");
                              }
                            }}
                            className="p-2 sm:p-1 rounded-md hover:bg-muted/50 active:bg-muted/70 transition-colors"
                            title="快速下載"
                          >
                            <Download className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-muted-foreground/60 hover:text-foreground" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="pt-3 border-t border-border/30 space-y-3">
                            {/* ── Compiled Prompt (full, no truncation) ── */}
                            {item.compiledPrompt && (
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                  <FileText className="w-3 h-3" /> 編譯後提示詞
                                </span>
                                <p className="text-xs text-foreground/80 mt-1 leading-relaxed whitespace-pre-wrap">
                                  {item.compiledPrompt}
                                </p>
                              </div>
                            )}

                            {/* ── Parameter Snapshot (ALL fields, no slice) ── */}
                            {item.parameterSnapshot && (
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                  <Tag className="w-3 h-3" /> 完整參數快照
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {Object.entries(item.parameterSnapshot as Record<string, unknown>)
                                    .filter(([, v]) => v != null)
                                    .map(([k, v]) => (
                                      <span
                                        key={k}
                                        className="text-[10px] bg-muted/30 px-1.5 py-0.5 rounded-md text-muted-foreground"
                                      >
                                        {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}

                            {/* ── Duration & Cost ── */}
                            <div className="flex flex-wrap gap-3">
                              {item.durationMs != null && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                  <Timer className="w-3 h-3" /> 耗時：{(item.durationMs / 1000).toFixed(1)}s
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Coins className="w-3 h-3" /> 消耗配額：{item.costCredits}
                              </span>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {new Date(item.createdAt).toLocaleString("zh-TW")}
                              </span>
                            </div>

                            {/* ── Download & ZIP Export Buttons ── */}
                            {item.resultUrl && (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs gap-1.5 rounded-lg w-full"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      // Use server proxy to bypass CORS on CDN URLs
                                      const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(item.resultUrl!)}`;
                                      const resp = await fetch(proxyUrl);
                                      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                      const blob = await resp.blob();
                                      const ext = item.modality === "image" ? (blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg")
                                        : item.modality === "video" ? "mp4"
                                        : item.modality === "audio" ? (blob.type.includes("wav") ? "wav" : "mp3")
                                        : item.modality === "voice" ? (blob.type.includes("wav") ? "wav" : "mp3")
                                        : "bin";
                                      const objectUrl = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = objectUrl;
                                      a.download = `ai-director-${item.modality}-${item.id}.${ext}`;
                                      document.body.appendChild(a);
                                      a.click();
                                      document.body.removeChild(a);
                                      URL.revokeObjectURL(objectUrl);
                                      toast.success(`已下載 ${ext.toUpperCase()} 檔案`);
                                    } catch {
                                      window.open(item.resultUrl!, "_blank");
                                      toast.info("已在新分頁開啟，請右鍵另存新檔");
                                    }
                                  }}
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  下載{item.modality === "image" ? " PNG" : item.modality === "video" ? " MP4" : item.modality === "audio" ? " 音樂" : item.modality === "voice" ? " 語音" : " 檔案"}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs gap-1.5 rounded-lg w-full"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      const zip = new JSZip();
                                      const timestamp = new Date(item.createdAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
                                      const modalityLabel = item.modality === "image" ? "圖片" : item.modality === "video" ? "影片" : item.modality === "audio" ? "音樂" : "語音";

                                      // Download and add the generated asset
                                      const extMap: Record<string, string> = { image: "png", video: "mp4", audio: "mp3", voice: "wav" };
                                      const defaultExt = extMap[item.modality] || "bin";
                                      try {
                                        const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(item.resultUrl!)}`;
                                        const resp = await fetch(proxyUrl);
                                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                                        const blob = await resp.blob();
                                        let ext = defaultExt;
                                        if (item.modality === "image") {
                                          ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
                                        }
                                        zip.file(`generated-${item.modality}.${ext}`, blob);
                                      } catch {
                                        zip.file("asset-url.txt", item.resultUrl!);
                                      }

                                      // Build parameters.txt
                                      const lines: string[] = [];
                                      lines.push("═══════════════════════════════════════");
                                      lines.push("  AI Director — 生成參數說明");
                                      lines.push("═══════════════════════════════════════");
                                      lines.push("");
                                      lines.push(`生成時間：${new Date(item.createdAt).toLocaleString("zh-TW")}`);
                                      lines.push(`模態：${modalityLabel}`);
                                      lines.push("");
                                      lines.push("── 提示詞 ──");
                                      lines.push(`原始輸入：${item.prompt || "(空)"}`);
                                      lines.push(`編譯結果：${item.compiledPrompt || "(未編譯)"}`);
                                      lines.push("");

                                      // Extract params from parameterSnapshot
                                      const snap = (item.parameterSnapshot || {}) as Record<string, unknown>;

                                      // Common params
                                      if (snap.mode) lines.push(`模式：${snap.mode === "lightning" ? "閃電模式 (Flash)" : "專業模式 (Pro)"}`);
                                      if (snap.temperature != null) lines.push(`創意溫度：${snap.temperature}`);
                                      if (snap.seed) lines.push(`種子碼：${snap.seed}`);
                                      if (snap.loraWeight != null) lines.push(`LoRA 權重：${snap.loraWeight}`);

                                      // Modality-specific params
                                      if (item.modality === "image") {
                                        lines.push("");
                                        lines.push("── 圖片參數 ──");
                                        if (snap.aspectRatio) lines.push(`長寬比：${snap.aspectRatio}`);
                                        if (snap.negativePrompt) lines.push(`負面提示詞：${snap.negativePrompt}`);
                                        if (snap.styleReferenceUrl) lines.push(`風格參考圖：${snap.styleReferenceUrl}`);
                                        if (snap.vibeReferenceUrl) lines.push(`氛圍參考圖：${snap.vibeReferenceUrl}`);
                                      } else if (item.modality === "video") {
                                        lines.push("");
                                        lines.push("── 影片參數 ──");
                                        if (snap.duration) lines.push(`時長：${snap.duration}`);
                                        if (snap.cameraMotion) lines.push(`鏡頭運動：${snap.cameraMotion}`);
                                        if (snap.firstFrameUrl) lines.push(`首幀圖片：${snap.firstFrameUrl}`);
                                        if (snap.lastFrameUrl) lines.push(`末幀圖片：${snap.lastFrameUrl}`);
                                        if (snap.characterRefUrl) lines.push(`角色參考：${snap.characterRefUrl}`);
                                      } else if (item.modality === "audio") {
                                        lines.push("");
                                        lines.push("── 音樂參數 ──");
                                        if (snap.musicStyle) lines.push(`音樂風格：${snap.musicStyle}`);
                                        if (snap.energy) lines.push(`能量等級：${snap.energy}`);
                                        if (snap.isInstrumental != null) lines.push(`純樂器：${snap.isInstrumental ? "是" : "否"}`);
                                        if (snap.lyrics) lines.push(`自訂歌詞：${snap.lyrics}`);
                                      } else if (item.modality === "voice") {
                                        lines.push("");
                                        lines.push("── 語音參數 ──");
                                        if (snap.voiceModelId) lines.push(`語音角色：${snap.voiceModelId}`);
                                        if (snap.speed != null) lines.push(`語速：${snap.speed}`);
                                        if (snap.emotionType) lines.push(`情緒類型：${snap.emotionType}`);
                                        if (snap.emotionIntensity != null) lines.push(`情緒強度：${snap.emotionIntensity}`);
                                        if (snap.stability != null) lines.push(`穩定度：${snap.stability}`);
                                        if (snap.text) lines.push(`文案：${snap.text}`);
                                      }

                                      // Duration & cost
                                      lines.push("");
                                      lines.push("── 生成資訊 ──");
                                      if (item.durationMs != null) lines.push(`生成耗時：${(item.durationMs / 1000).toFixed(1)} 秒`);
                                      lines.push(`消耗配額：${item.costCredits}`);

                                      zip.file("parameters.txt", lines.join("\n"));

                                      // Also add structured JSON metadata
                                      zip.file("metadata.json", JSON.stringify({
                                        modality: item.modality,
                                        prompt: item.prompt,
                                        compiledPrompt: item.compiledPrompt,
                                        parameterSnapshot: snap,
                                        resultUrl: item.resultUrl,
                                        costCredits: item.costCredits,
                                        durationMs: item.durationMs,
                                        createdAt: item.createdAt,
                                      }, null, 2));

                                      const content = await zip.generateAsync({ type: "blob" });
                                      if (content.size === 0) {
                                        toast.error("ZIP 檔案為空，請稍後再試");
                                        return;
                                      }
                                      const blobUrl = URL.createObjectURL(content);
                                      const anchor = document.createElement("a");
                                      anchor.href = blobUrl;
                                      anchor.download = `ai-director-${item.modality}-${timestamp}.zip`;
                                      document.body.appendChild(anchor);
                                      anchor.click();
                                      document.body.removeChild(anchor);
                                      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
                                      toast.success("已匯出 ZIP 包");
                                    } catch {
                                      toast.error("匯出失敗，請稍後再試");
                                    }
                                  }}
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                  匯出 ZIP
                                </Button>
                              </div>
                            )}

                            {/* ── Cross-modal Quick Actions ── */}
                            <div className="flex flex-wrap gap-1.5 pt-1 justify-start">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 rounded-lg"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 完整傳遞：prompt + compiledPrompt + parameterSnapshot（含 seed/ratio/model 等）
                                  sessionStorage.setItem("sendToStudio", JSON.stringify({
                                    prompt: item.prompt || item.compiledPrompt || "",
                                    compiledPrompt: item.compiledPrompt || "",
                                    generationType: item.modality,
                                    source: "history",
                                    historyId: item.id,
                                    resultUrl: item.resultUrl,
                                    parameterSnapshot: item.parameterSnapshot || {},
                                  }));
                                  navigate("/studio");
                                  toast.success("已完整還原生成配置，前往工作室重現", { duration: 4000 });
                                }}
                              >
                                <RefreshCw className="w-3 h-3" />
                                重新生成
                              </Button>
                              {item.modality === "image" && item.resultUrl && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 rounded-lg"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    sessionStorage.setItem("sendToStudio", JSON.stringify({
                                      prompt: item.prompt || "",
                                      compiledPrompt: item.compiledPrompt || "",
                                      generationType: "video",
                                      source: "history_cross",
                                      historyId: item.id,
                                      referenceImageUrl: item.resultUrl,
                                      parameterSnapshot: {
                                        ...(item.parameterSnapshot || {}),
                                        firstFrameUrl: item.resultUrl,
                                      },
                                    }));
                                    navigate("/studio");
                                    toast.success("已發送到影片工作區（以圖片為首幀）");
                                  }}
                                >
                                  <Video className="w-3 h-3" />
                                  發送到影片工作區
                                </Button>
                              )}
                              {(item.modality === "image" || item.modality === "video") && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 rounded-lg"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    sessionStorage.setItem("sendToStudio", JSON.stringify({
                                      prompt: `為這個${item.modality === "image" ? "圖片" : "影片"}創作配樂：${item.prompt || ""}`,
                                      generationType: "audio",
                                      source: "history_cross",
                                      historyId: item.id,
                                      parameterSnapshot: {
                                        musicStyle: (item.parameterSnapshot as any)?.musicStyle || "ambient",
                                        audioDuration: 30,
                                      },
                                    }));
                                    navigate("/studio");
                                    toast.success("已發送到音樂工作區");
                                  }}
                                >
                                  <Music className="w-3 h-3" />
                                  發送到音樂工作區
                                </Button>
                              )}
                            </div>

                            <div className="flex justify-between items-center pt-1">
                              {/* Set as Featured */}
                              {item.resultUrl && (item.modality === "image" || item.modality === "video") && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1 rounded-lg text-amber-600 border-amber-200 hover:bg-amber-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPromoteTitle(item.prompt?.slice(0, 100) || "精選作品");
                                    setPromoteDesc(item.compiledPrompt?.slice(0, 200) || "");
                                    setPromoteDialogId(item.id);
                                  }}
                                >
                                  <Sparkles className="w-3 h-3" />
                                  加入精選
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 text-xs gap-1 ml-auto"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteMutation.mutate({ id: item.id });
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                                刪除
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Expand Hint */}
                    <div className="flex justify-center">
                      <ChevronDown
                        className={cn(
                          "w-3.5 h-3.5 text-muted-foreground/30 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </div>
                  </GlassCard>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── 加入精選 Dialog ── */}
      <Dialog open={!!promoteDialogId} onOpenChange={(open) => { if (!open) { setPromoteDialogId(null); setPromoteTitle(""); setPromoteDesc(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              加入首頁精選作品集
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              精選作品將顯示在首頁的作品展示區，讓所有訪客欣賞你的創作。每天最多可提交 5 件。
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">作品標題 *</label>
              <Input
                value={promoteTitle}
                onChange={(e) => setPromoteTitle(e.target.value)}
                placeholder="給你的作品取個名字..."
                className="rounded-xl"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">作品描述（選填）</label>
              <Input
                value={promoteDesc}
                onChange={(e) => setPromoteDesc(e.target.value)}
                placeholder="描述創作靈感或使用的技巧..."
                className="rounded-xl"
                maxLength={500}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handlePromote}
                disabled={promoteMutation.isPending || !promoteTitle.trim()}
                className="flex-1 rounded-xl gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {promoteMutation.isPending ? "提交中..." : "確認加入精選"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setPromoteDialogId(null); setPromoteTitle(""); setPromoteDesc(""); }}
                className="rounded-xl"
              >
                取消
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
