/**
 * ArticleDialog.tsx — 情報站文章完整內容展開對話框
 *
 * 點擊 BentoCard 後以 Radix Dialog 彈出完整文章：
 *   - Lazy fetch: 點擊後才呼叫 news.getById 取得 bodyMarkdown
 *   - Framer Motion 絲滑動畫過渡（overlay fade + content slide-up + scale）
 *   - Streamdown 渲染 Markdown 內容
 *   - 顯示來源名稱、發佈時間、原始連結
 *   - 場景自適應樣式
 */

import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { trpc } from "@/lib/trpc";
import { Streamdown } from "streamdown";
import {
  X, ExternalLink, Clock, Eye, Loader2, Newspaper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SceneId } from "@/components/AmbientEnvironment";

// ─── Scene-adaptive dialog styles ──────────────────────────────────────────

interface DialogSceneStyles {
  overlayBg: string;
  panelBg: string;
  panelBorder: string;
  headerBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentColor: string;
  closeBtnBg: string;
  closeBtnHover: string;
  divider: string;
  proseClass: string;
}

const DIALOG_SCENE_STYLES: Record<SceneId, DialogSceneStyles> = {
  nightSky: {
    overlayBg: "rgba(5,8,25,0.75)",
    panelBg: "rgba(15,18,45,0.95)",
    panelBorder: "rgba(100,120,200,0.15)",
    headerBg: "rgba(20,25,60,0.6)",
    textPrimary: "text-white",
    textSecondary: "text-slate-300",
    textMuted: "text-slate-400",
    accentColor: "text-indigo-300",
    closeBtnBg: "bg-white/5 hover:bg-white/10",
    closeBtnHover: "hover:text-white",
    divider: "border-white/5",
    proseClass: "prose-invert prose-p:text-slate-300 prose-headings:text-white prose-a:text-indigo-300 prose-strong:text-white prose-blockquote:border-indigo-400/30 prose-blockquote:text-slate-400 prose-code:text-indigo-200 prose-code:bg-indigo-900/30",
  },
  morning: {
    overlayBg: "rgba(255,240,220,0.6)",
    panelBg: "rgba(255,252,248,0.97)",
    panelBorder: "rgba(220,180,140,0.2)",
    headerBg: "rgba(255,245,230,0.6)",
    textPrimary: "text-amber-950",
    textSecondary: "text-amber-800",
    textMuted: "text-amber-700/60",
    accentColor: "text-amber-600",
    closeBtnBg: "bg-amber-100/50 hover:bg-amber-100",
    closeBtnHover: "hover:text-amber-900",
    divider: "border-amber-200/30",
    proseClass: "prose-amber prose-p:text-amber-900 prose-headings:text-amber-950 prose-a:text-amber-600 prose-strong:text-amber-950 prose-blockquote:border-amber-300 prose-blockquote:text-amber-700 prose-code:text-amber-800 prose-code:bg-amber-50",
  },
  cafe: {
    overlayBg: "rgba(240,230,215,0.6)",
    panelBg: "rgba(252,248,242,0.97)",
    panelBorder: "rgba(200,180,150,0.2)",
    headerBg: "rgba(245,238,225,0.6)",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-700",
    textMuted: "text-stone-500",
    accentColor: "text-stone-600",
    closeBtnBg: "bg-stone-100/50 hover:bg-stone-200/70",
    closeBtnHover: "hover:text-stone-900",
    divider: "border-stone-200/30",
    proseClass: "prose-stone prose-p:text-stone-700 prose-headings:text-stone-900 prose-a:text-stone-600 prose-strong:text-stone-900 prose-blockquote:border-stone-300 prose-blockquote:text-stone-500 prose-code:text-stone-800 prose-code:bg-stone-100",
  },
  deepSea: {
    overlayBg: "rgba(5,20,40,0.75)",
    panelBg: "rgba(8,30,55,0.95)",
    panelBorder: "rgba(60,140,180,0.15)",
    headerBg: "rgba(10,40,70,0.6)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200",
    textMuted: "text-cyan-300/60",
    accentColor: "text-cyan-300",
    closeBtnBg: "bg-white/5 hover:bg-white/10",
    closeBtnHover: "hover:text-cyan-50",
    divider: "border-cyan-500/10",
    proseClass: "prose-invert prose-p:text-cyan-200 prose-headings:text-cyan-50 prose-a:text-cyan-300 prose-strong:text-cyan-50 prose-blockquote:border-cyan-400/30 prose-blockquote:text-cyan-300/60 prose-code:text-cyan-200 prose-code:bg-cyan-900/30",
  },
};

// ─── Helper: format date ───────────────────────────────────────────────────

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Framer Motion variants ────────────────────────────────────────────────

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const contentVariants = {
  hidden: {
    opacity: 0,
    scale: 0.92,
    y: 40,
    filter: "blur(8px)",
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      type: "spring" as const,
      damping: 28,
      stiffness: 300,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    filter: "blur(4px)",
    transition: {
      duration: 0.2,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
    },
  },
};

// ─── Weight label config (mirrored from IntelBentoGrid) ────────────────────

const WEIGHT_LABEL_ZH: Record<string, string> = {
  "Model Breakthrough": "模型突破",
  "Inspiration Tip": "靈感技巧",
  "Industry Shift": "產業動態",
  "Creative Tool": "創作工具",
  "Community Spotlight": "社群焦點",
  "Tutorial Guide": "教學指南",
  "General Update": "一般更新",
};

const WEIGHT_LABEL_COLOR: Record<string, string> = {
  "Model Breakthrough": "text-amber-400 bg-amber-400/10",
  "Inspiration Tip": "text-emerald-400 bg-emerald-400/10",
  "Industry Shift": "text-blue-400 bg-blue-400/10",
  "Creative Tool": "text-violet-400 bg-violet-400/10",
  "Community Spotlight": "text-rose-400 bg-rose-400/10",
  "Tutorial Guide": "text-cyan-400 bg-cyan-400/10",
  "General Update": "text-slate-400 bg-slate-400/10",
};

function getWeightLabel(tags: string[] | null | undefined): string {
  if (!tags) return "General Update";
  const known = Object.keys(WEIGHT_LABEL_ZH);
  for (const tag of tags) {
    if (known.includes(tag)) return tag;
  }
  return "General Update";
}

// ─── Component ─────────────────────────────────────────────────────────────

interface ArticleDialogProps {
  newsId: number | null;
  onClose: () => void;
  sceneId: SceneId;
}

export default function ArticleDialog({ newsId, onClose, sceneId }: ArticleDialogProps) {
  const isOpen = newsId !== null;
  const styles = DIALOG_SCENE_STYLES[sceneId];
  const contentRef = useRef<HTMLDivElement>(null);

  // Lazy fetch: only when dialog is open
  const { data: article, isLoading, error } = trpc.news.getById.useQuery(
    { id: newsId! },
    {
      enabled: isOpen && newsId !== null,
      staleTime: 5 * 60_000, // Cache for 5 minutes
      retry: 1,
    }
  );

  // Reset scroll position when article changes
  useEffect(() => {
    if (article && contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [article]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose]
  );

  const weightLabel = article ? getWeightLabel(article.tags) : "General Update";
  const weightLabelZh = WEIGHT_LABEL_ZH[weightLabel] || "一般更新";
  const weightLabelColor = WEIGHT_LABEL_COLOR[weightLabel] || "text-slate-400 bg-slate-400/10";

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount>
            {/* ── Animated Overlay ── */}
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 backdrop-blur-sm"
                style={{ backgroundColor: styles.overlayBg }}
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </DialogPrimitive.Overlay>

            {/* ── Animated Content ── */}
            <DialogPrimitive.Content asChild forceMount onOpenAutoFocus={(e) => e.preventDefault()}>
              <motion.div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8"
                variants={contentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <div
                  className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
                  style={{
                    background: styles.panelBg,
                    border: `1px solid ${styles.panelBorder}`,
                    backdropFilter: "blur(20px)",
                  }}
                >
                  {/* ── Close Button ── */}
                  <DialogPrimitive.Close asChild>
                    <button
                      className={`absolute top-4 right-4 z-20 rounded-full p-2 transition-all duration-200 ${styles.closeBtnBg} ${styles.textMuted} ${styles.closeBtnHover}`}
                      aria-label="關閉"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </DialogPrimitive.Close>

                  {/* ── Loading State ── */}
                  {isLoading && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 className={`w-8 h-8 ${styles.textMuted}`} />
                      </motion.div>
                      <p className={`text-sm ${styles.textMuted}`}>載入文章中...</p>
                    </div>
                  )}

                  {/* ── Error State ── */}
                  {error && !isLoading && (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                      <Newspaper className={`w-10 h-10 ${styles.textMuted} opacity-40`} />
                      <p className={`text-sm ${styles.textMuted}`}>無法載入文章內容</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onClose}
                        className="mt-2"
                      >
                        關閉
                      </Button>
                    </div>
                  )}

                  {/* ── Article Content ── */}
                  {article && !isLoading && (
                    <>
                      {/* Header */}
                      <div
                        className="px-6 sm:px-8 pt-6 pb-4 flex-shrink-0"
                        style={{ background: styles.headerBg }}
                      >
                        {/* Weight badge + date */}
                        <div className="flex items-center gap-3 mb-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wide ${weightLabelColor}`}
                          >
                            {weightLabelZh}
                          </span>
                          <span className={`text-[11px] flex items-center gap-1 ${styles.textMuted}`}>
                            <Clock className="w-3 h-3" />
                            {formatDate(article.publishedAt)}
                          </span>
                        </div>

                        {/* Title */}
                        <DialogPrimitive.Title asChild>
                          <h2 className={`text-xl sm:text-2xl font-bold leading-tight tracking-tight ${styles.textPrimary}`}>
                            {article.title}
                          </h2>
                        </DialogPrimitive.Title>

                        {/* Meta row */}
                        <div className={`flex items-center gap-4 mt-3 text-[11px] ${styles.textMuted}`}>
                          <span className="truncate max-w-[200px]">{article.sourceName}</span>
                          {article.viewCount > 0 && (
                            <span className="flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {article.viewCount} 次閱讀
                            </span>
                          )}
                        </div>

                        {/* OARS Summary as lead paragraph */}
                        {article.oarsSummary && (
                          <motion.p
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15, duration: 0.4 }}
                            className={`mt-4 text-sm leading-relaxed ${styles.textSecondary} italic`}
                          >
                            {article.oarsSummary}
                          </motion.p>
                        )}
                      </div>

                      {/* Divider */}
                      <div className={`mx-6 sm:mx-8 border-t ${styles.divider}`} />

                      {/* Body */}
                      <ScrollArea className="flex-1 min-h-0" ref={contentRef}>
                        <motion.div
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                          className="px-6 sm:px-8 py-6"
                        >
                          {article.bodyMarkdown ? (
                            <div className={`prose prose-sm max-w-none ${styles.proseClass} prose-p:leading-relaxed prose-headings:tracking-tight prose-img:rounded-xl prose-pre:rounded-xl`}>
                              <Streamdown>{article.bodyMarkdown}</Streamdown>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center py-8 gap-3">
                              <p className={`text-sm ${styles.textMuted}`}>
                                此文章尚無完整內容
                              </p>
                              {article.sourceUrl && (
                                <a
                                  href={article.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`inline-flex items-center gap-1.5 text-sm font-medium ${styles.accentColor} hover:underline`}
                                >
                                  前往原始來源閱讀
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          )}
                        </motion.div>
                      </ScrollArea>

                      {/* Footer */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3, duration: 0.4 }}
                        className={`px-6 sm:px-8 py-4 flex items-center justify-between flex-shrink-0 border-t ${styles.divider}`}
                        style={{ background: styles.headerBg }}
                      >
                        <span className={`text-[11px] ${styles.textMuted}`}>
                          來源：{article.sourceName}
                        </span>
                        {article.sourceUrl && (
                          <a
                            href={article.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105 ${styles.accentColor}`}
                            style={{ background: `${styles.panelBorder}` }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            閱讀原文
                          </a>
                        )}
                      </motion.div>
                    </>
                  )}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
