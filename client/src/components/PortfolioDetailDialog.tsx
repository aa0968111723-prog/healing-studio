/**
 * PortfolioDetailDialog.tsx — 精選作品詳情 Modal
 *
 * 展示單一作品的完整資訊：標題、描述、模型、提示詞、愛心/評論統計，
 * 並提供「進入工作室」CTA 讓使用者帶著配方跳轉到 Studio 編輯。
 *
 * 資料來源：
 *   - 基本欄位：showcase.list 的 ShowcaseItem（傳入 basic）
 *   - 進階欄位：showcase.getById（傳入 detail，可選；載入期間顯示骨架）
 *   - 模型：由 modality + parameters 推導
 */

import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  GitFork,
  Copy,
  Check,
  ArrowRight,
  Cpu,
  Sparkles,
  Image as ImageIcon,
  Film,
  Music,
  Mic,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PortfolioBasicItem {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  modality: string;
  likeCount: number;
  forkCount: number;
  sortWeight: number;
  createdAt: Date | string;
}

export interface PortfolioDetailData {
  originalPrompt: string | null;
  completelyDeconstructedBlocks: {
    compiledPrompt?: string;
    parameters?: Record<string, unknown>;
  } | null;
}

interface Props {
  basic: PortfolioBasicItem | null;
  detail: PortfolioDetailData | null;
  isLoadingDetail: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnterStudio: () => void;
  isDark?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MODALITY_META: Record<
  string,
  { label: string; icon: typeof ImageIcon; accent: string; model: string }
> = {
  image: {
    label: "圖像",
    icon: ImageIcon,
    accent: "#a78bfa",
    model: "Seedream 4.0",
  },
  video: {
    label: "影片",
    icon: Film,
    accent: "#fb7185",
    model: "Veo 3",
  },
  audio: {
    label: "音樂",
    icon: Music,
    accent: "#34d399",
    model: "Suno v4",
  },
  voice: {
    label: "語音",
    icon: Mic,
    accent: "#38bdf8",
    model: "ElevenLabs Turbo",
  },
};

/** Derive the AI model name from the deconstructed blocks parameters, or fall back to modality default. */
function resolveAiModel(
  modality: string,
  parameters?: Record<string, unknown>
): string {
  const fromParams =
    parameters &&
    (parameters.model ?? parameters.modelName ?? parameters.engine);
  if (typeof fromParams === "string" && fromParams.trim()) return fromParams;
  return MODALITY_META[modality]?.model ?? "AI Studio Engine";
}

function formatDate(value: Date | string): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PortfolioDetailDialog({
  basic,
  detail,
  isLoadingDetail,
  open,
  onOpenChange,
  onEnterStudio,
  isDark = true,
}: Props) {
  const [copied, setCopied] = useState(false);

  const meta = useMemo(
    () =>
      (basic && MODALITY_META[basic.modality]) ?? MODALITY_META.image,
    [basic]
  );

  const aiModel = useMemo(() => {
    if (!basic) return "";
    return resolveAiModel(
      basic.modality,
      detail?.completelyDeconstructedBlocks?.parameters
    );
  }, [basic, detail]);

  const prompt = useMemo(() => {
    if (!detail) return "";
    return (
      detail.originalPrompt ??
      detail.completelyDeconstructedBlocks?.compiledPrompt ??
      ""
    );
  }, [detail]);

  const handleCopyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // silent fail
    }
  };

  if (!basic) return null;

  const Icon = meta.icon;
  const displayImg = basic.imageUrl ?? basic.thumbnailUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className={`sm:max-w-2xl lg:max-w-3xl max-h-[92vh] overflow-y-auto p-0 border-0 rounded-3xl ${
          isDark
            ? "bg-slate-900/90 text-slate-100"
            : "bg-white/95 text-stone-900"
        }`}
        style={{
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          boxShadow: `0 24px 80px -20px ${meta.accent}40, 0 0 0 1px ${meta.accent}25`,
        }}
      >
        {/* Hero image */}
        <div
          className="relative aspect-[16/9] w-full overflow-hidden rounded-t-3xl"
          style={{
            background: `linear-gradient(135deg, ${meta.accent}22, ${meta.accent}08)`,
          }}
        >
          {displayImg ? (
            <img
              src={displayImg}
              alt={basic.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{
                  background: `${meta.accent}18`,
                  border: `1px solid ${meta.accent}25`,
                }}
              >
                <Icon className="w-10 h-10" style={{ color: meta.accent }} />
              </div>
            </div>
          )}
          {/* Modality tag */}
          <div
            className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium tracking-wider uppercase"
            style={{
              background: `${meta.accent}22`,
              color: meta.accent,
              border: `1px solid ${meta.accent}30`,
              backdropFilter: "blur(12px)",
            }}
          >
            <Icon className="w-3 h-3" />
            {meta.label}
          </div>
          {basic.sortWeight > 0 && (
            <div
              className="absolute top-4 right-4 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
              style={{
                background: "rgba(255,255,255,0.12)",
                color: "#fff",
                backdropFilter: "blur(12px)",
              }}
            >
              <Sparkles className="w-3 h-3" />
              精選
            </div>
          )}
        </div>

        {/* Body */}
        <div className="px-6 sm:px-8 py-7 sm:py-8 space-y-6">
          {/* Title */}
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-1 h-5 rounded-full"
                style={{ background: meta.accent }}
              />
              <DialogTitle className="text-2xl sm:text-3xl font-semibold tracking-tight">
                {basic.title}
              </DialogTitle>
            </div>
            {basic.description && (
              <DialogDescription
                className={`text-[15px] leading-relaxed ${
                  isDark ? "text-slate-300" : "text-stone-600"
                }`}
              >
                {basic.description}
              </DialogDescription>
            )}
          </div>

          {/* Stats */}
          <div
            className={`flex flex-wrap items-center gap-5 pb-5 border-b ${
              isDark ? "border-white/10" : "border-black/8"
            }`}
          >
            <StatBlock
              icon={<Heart className="w-3.5 h-3.5" style={{ color: "#f472b6" }} />}
              label="愛心"
              value={basic.likeCount.toLocaleString()}
              isDark={isDark}
            />
            <StatBlock
              icon={
                <GitFork
                  className="w-3.5 h-3.5"
                  style={{ color: meta.accent }}
                />
              }
              label="複製配方"
              value={basic.forkCount.toLocaleString()}
              isDark={isDark}
            />
            <div className="ml-auto">
              <StatBlock
                icon={<span className="text-[10px]">📅</span>}
                label="發布"
                value={formatDate(basic.createdAt)}
                isDark={isDark}
              />
            </div>
          </div>

          {/* AI Model */}
          <div>
            <div
              className={`text-[11px] tracking-[0.18em] uppercase mb-2 ${
                isDark ? "text-white/40" : "text-black/40"
              }`}
            >
              使用模型
            </div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium"
              style={{
                background: `${meta.accent}15`,
                border: `1px solid ${meta.accent}30`,
                color: meta.accent,
              }}
            >
              <Cpu className="w-3.5 h-3.5" />
              {aiModel}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div
                className={`text-[11px] tracking-[0.18em] uppercase ${
                  isDark ? "text-white/40" : "text-black/40"
                }`}
              >
                提示詞 Prompt
              </div>
              {prompt && (
                <button
                  type="button"
                  onClick={handleCopyPrompt}
                  className={`inline-flex items-center gap-1 text-[11px] transition-colors ${
                    isDark
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  <AnimatePresence mode="wait">
                    {copied ? (
                      <motion.span
                        key="copied"
                        initial={{ opacity: 0, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 2 }}
                        className="inline-flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> 已複製
                      </motion.span>
                    ) : (
                      <motion.span
                        key="copy"
                        initial={{ opacity: 0, y: -2 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 2 }}
                        className="inline-flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3" /> 複製
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              )}
            </div>
            <div
              className={`rounded-2xl p-4 text-[13px] leading-relaxed font-mono max-h-48 overflow-y-auto ${
                isDark
                  ? "bg-black/30 text-slate-200 border border-white/5"
                  : "bg-stone-50 text-stone-800 border border-stone-200"
              }`}
            >
              {isLoadingDetail && !prompt ? (
                <div className="flex items-center gap-2 opacity-70">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>載入完整配方...</span>
                </div>
              ) : prompt ? (
                <p className="whitespace-pre-wrap break-words">{prompt}</p>
              ) : (
                <p className="opacity-50">（此作品未保留原始提示詞）</p>
              )}
            </div>
          </div>

          {/* CTA */}
          <div
            className={`flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t ${
              isDark ? "border-white/10" : "border-black/8"
            }`}
          >
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={`text-sm transition-colors ${
                isDark
                  ? "text-slate-400 hover:text-slate-200"
                  : "text-stone-500 hover:text-stone-800"
              }`}
            >
              稍後再看
            </button>
            <Button
              onClick={onEnterStudio}
              className="rounded-2xl h-11 px-6 gap-2 text-white font-medium shadow-lg hover:shadow-xl transition-all"
              style={{
                background: `linear-gradient(135deg, ${meta.accent}, ${meta.accent}d0)`,
                boxShadow: `0 8px 24px -8px ${meta.accent}80`,
              }}
            >
              <span>進入工作室</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatBlock({
  icon,
  label,
  value,
  isDark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center ${
          isDark ? "bg-white/5" : "bg-black/5"
        }`}
      >
        {icon}
      </div>
      <div className="leading-tight">
        <div
          className={`text-[10px] tracking-[0.16em] uppercase ${
            isDark ? "text-white/40" : "text-black/40"
          }`}
        >
          {label}
        </div>
        <div
          className={`text-[13px] font-semibold ${
            isDark ? "text-slate-100" : "text-stone-900"
          }`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
