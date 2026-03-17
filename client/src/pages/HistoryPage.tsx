import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { GlassCard, ZenSkeleton } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import { toast } from "sonner";
import {
  Image, Video, Music, Mic, Bookmark, BookmarkCheck,
  Star, Trash2, Filter, Clock, Search, ChevronDown,
  Send, Wand2, RefreshCw,
} from "lucide-react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
  const starSize = size === "sm" ? "w-3.5 h-3.5" : "w-4.5 h-4.5";

  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          onClick={(e) => { e.stopPropagation(); onChange(star); }}
          className="transition-transform hover:scale-110"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* Stats Bar */}
      <div className="flex gap-2 flex-wrap">
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
            className="rounded-xl text-xs gap-1.5 h-8"
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="搜尋提示詞..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 rounded-xl bg-white/40 border-white/60 h-9 text-sm"
        />
      </div>

      {/* History Grid */}
      {filteredHistory.length === 0 ? (
        <GlassCard hover={false} className="flex flex-col items-center justify-center py-16 text-center">
          <VisualSoul size="md" />
          <p className="text-sm text-muted-foreground mt-4">
            {filter === "bookmarked"
              ? "尚無收藏的生成紀錄"
              : searchQuery
              ? "找不到符合條件的紀錄"
              : "尚無生成歷史，前往工作室開始創作吧"}
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                        className="shrink-0 p-1 rounded-md hover:bg-muted/50 transition-colors"
                      >
                        {item.isBookmarked ? (
                          <BookmarkCheck className="w-4 h-4 text-amber-500 fill-amber-500" />
                        ) : (
                          <Bookmark className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </button>
                    </div>

                    {/* Rating */}
                    <div className="flex items-center justify-between">
                      <StarRating
                        value={item.userRating}
                        onChange={(rating) => rateMutation.mutate({ id: item.id, rating })}
                      />
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {item.costCredits} 配額
                      </span>
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
                          <div className="pt-3 border-t border-border/30 space-y-2">
                            {item.compiledPrompt && (
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  編譯後提示詞
                                </span>
                                <p className="text-xs text-foreground/80 mt-1 leading-relaxed line-clamp-4">
                                  {item.compiledPrompt}
                                </p>
                              </div>
                            )}
                            {item.parameterSnapshot && (
                              <div>
                                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                  參數快照
                                </span>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {Object.entries(item.parameterSnapshot as Record<string, unknown>)
                                    .filter(([, v]) => v != null && typeof v !== "object")
                                    .slice(0, 6)
                                    .map(([k, v]) => (
                                      <span
                                        key={k}
                                        className="text-[10px] bg-muted/30 px-1.5 py-0.5 rounded-md text-muted-foreground"
                                      >
                                        {k}: {String(v)}
                                      </span>
                                    ))}
                                </div>
                              </div>
                            )}
                            {/* Cross-modal Quick Actions */}
                            <div className="flex flex-wrap gap-1.5 pt-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 rounded-lg"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sessionStorage.setItem("sendToStudio", JSON.stringify({
                                    prompt: item.prompt || item.compiledPrompt || "",
                                    generationType: item.modality,
                                    parameterSnapshot: item.parameterSnapshot,
                                  }));
                                  navigate("/studio");
                                  toast.success("已發送到工作室");
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
                                      generationType: "video",
                                      referenceImageUrl: item.resultUrl,
                                      parameterSnapshot: item.parameterSnapshot,
                                    }));
                                    navigate("/studio");
                                    toast.success("已發送到影片工作區");
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
                                      prompt: `為這個${item.modality === "image" ? "圖片" : "影片"}創作配樂`,
                                      generationType: "audio",
                                      parameterSnapshot: item.parameterSnapshot,
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

                            <div className="flex justify-end pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 text-xs gap-1"
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
    </div>
  );
}
