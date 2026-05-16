/**
 * FeedbackDialog — 意見回饋 / 功能詢問對話框
 *
 * 從光球快捷選單觸發，提供簡潔的表單讓使用者提交：
 *   - 意見回饋（bug / quality_issue / general）
 *   - 功能詢問（feature_request）
 *
 * 提交後自動通知 Owner 並顯示感謝訊息。
 */
import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MessageSquarePlus,
  Lightbulb,
  Bug,
  Star,
  Send,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { SceneId } from "@/components/AmbientEnvironment";

// ─── Types ─────────────────────────────────────────────────────────────────

type FeedbackMode = "feedback" | "feature";

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  mode: FeedbackMode;
  sceneId: SceneId;
  isDark: boolean;
}

// ─── Scene-Adaptive Styles ─────────────────────────────────────────────────

interface DialogStyle {
  bg: string;
  border: string;
  text: string;
  textMuted: string;
  inputBg: string;
  inputBorder: string;
  btnBg: string;
  btnText: string;
  tagBg: string;
  overlay: string;
}

const DIALOG_STYLES: Record<"dark" | "light", DialogStyle> = {
  dark: {
    bg: "rgba(15,18,50,0.95)",
    border: "rgba(100,120,220,0.2)",
    text: "text-slate-100",
    textMuted: "text-slate-400",
    inputBg: "bg-white/5",
    inputBorder: "border-white/10 focus:border-indigo-400/50",
    btnBg: "bg-indigo-500 hover:bg-indigo-400",
    btnText: "text-white",
    tagBg: "bg-white/8 hover:bg-white/12 text-slate-300",
    overlay: "bg-black/60",
  },
  light: {
    bg: "rgba(255,250,245,0.98)",
    border: "rgba(200,180,150,0.25)",
    text: "text-stone-900",
    textMuted: "text-stone-500",
    inputBg: "bg-black/3",
    inputBorder: "border-black/8 focus:border-amber-500/40",
    btnBg: "bg-stone-800 hover:bg-stone-700",
    btnText: "text-white",
    tagBg: "bg-black/5 hover:bg-black/8 text-stone-600",
    overlay: "bg-black/30",
  },
};

// ─── Category Options ──────────────────────────────────────────────────────

const FEEDBACK_CATEGORIES = [
  {
    value: "bug" as const,
    label: "錯誤回報",
    icon: Bug,
    description: "功能異常或錯誤",
  },
  {
    value: "quality_issue" as const,
    label: "品質建議",
    icon: Star,
    description: "使用體驗改善",
  },
  {
    value: "general" as const,
    label: "一般意見",
    icon: MessageSquarePlus,
    description: "其他想法或建議",
  },
];

const PRIORITY_OPTIONS = [
  { value: "low" as const, label: "低" },
  { value: "medium" as const, label: "中" },
  { value: "high" as const, label: "高" },
];

// ─── Component ─────────────────────────────────────────────────────────────

export default function FeedbackDialog({
  open,
  onClose,
  mode,
  sceneId,
  isDark,
}: FeedbackDialogProps) {
  const s = DIALOG_STYLES[isDark ? "dark" : "light"];

  // Form state
  const [category, setCategory] = useState<
    "bug" | "feature_request" | "quality_issue" | "general"
  >(mode === "feature" ? "feature_request" : "general");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [submitted, setSubmitted] = useState(false);

  const createFeedback = trpc.feedback.create.useMutation({
    onSuccess: () => {
      setSubmitted(true);
    },
  });

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;
    createFeedback.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      category,
      priority,
    });
  }, [title, description, category, priority, createFeedback]);

  const handleClose = useCallback(() => {
    // Reset state on close
    setTitle("");
    setDescription("");
    setCategory(mode === "feature" ? "feature_request" : "general");
    setPriority("medium");
    setSubmitted(false);
    onClose();
  }, [mode, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 z-[70] flex items-center justify-center p-4 ${s.overlay}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleClose}
        >
          <motion.div
            className="relative w-full max-w-md rounded-2xl backdrop-blur-xl shadow-2xl overflow-hidden"
            style={{
              background: s.bg,
              border: `1px solid ${s.border}`,
            }}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Success State ── */}
            {submitted ? (
              <div className="p-8 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <CheckCircle2
                    className={`w-12 h-12 mx-auto mb-4 ${
                      isDark ? "text-emerald-400" : "text-emerald-600"
                    }`}
                  />
                </motion.div>
                <h3 className={`hs-h3-lg mb-2 ${s.text}`}>
                  感謝你的{mode === "feature" ? "詢問" : "回饋"}！
                </h3>
                <p className={`text-sm ${s.textMuted}`}>
                  {mode === "feature"
                    ? "我們已收到你的功能詢問，會盡快評估並回覆。"
                    : "你的意見對我們非常重要，我們會認真處理。"}
                </p>
                <button
                  onClick={handleClose}
                  className={`mt-6 px-6 py-2 rounded-xl text-sm font-medium transition-all ${s.btnBg} ${s.btnText}`}
                >
                  好的
                </button>
              </div>
            ) : (
              <>
                {/* ── Header ── */}
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                  <div className="flex items-center gap-2.5">
                    {mode === "feature" ? (
                      <Lightbulb
                        className={`w-5 h-5 ${isDark ? "text-amber-400" : "text-amber-600"}`}
                      />
                    ) : (
                      <MessageSquarePlus
                        className={`w-5 h-5 ${isDark ? "text-indigo-400" : "text-stone-600"}`}
                      />
                    )}
                    <h2 className={`text-base font-semibold ${s.text}`}>
                      {mode === "feature" ? "功能詢問" : "意見回饋"}
                    </h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className={`p-1.5 rounded-lg transition-colors ${s.textMuted} hover:bg-white/10`}
                    aria-label="關閉"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* ── Form ── */}
                <div className="px-6 pb-6 space-y-4">
                  {/* Category selector (only for feedback mode) */}
                  {mode === "feedback" && (
                    <div>
                      <label
                        className={`text-[11px] font-medium uppercase tracking-wide mb-2 block ${s.textMuted}`}
                      >
                        回饋類型
                      </label>
                      <div className="flex gap-2">
                        {FEEDBACK_CATEGORIES.map(cat => {
                          const Icon = cat.icon;
                          const isActive = category === cat.value;
                          return (
                            <button
                              key={cat.value}
                              onClick={() => setCategory(cat.value)}
                              className={`flex-1 flex flex-col items-center gap-1 py-2.5 px-2 rounded-xl text-[11px] transition-healing ${
                                isActive
                                  ? isDark
                                    ? "bg-indigo-500/20 ring-1 ring-indigo-400/40 text-indigo-300"
                                    : "bg-stone-800/10 ring-1 ring-stone-400/30 text-stone-800"
                                  : s.tagBg
                              }`}
                            >
                              <Icon className="w-4 h-4" />
                              <span className="font-medium">{cat.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Title */}
                  <div>
                    <label
                      className={`text-[11px] font-medium uppercase tracking-wide mb-1.5 block ${s.textMuted}`}
                    >
                      {mode === "feature" ? "你想要什麼功能？" : "標題"}
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder={
                        mode === "feature"
                          ? "例如：希望能支援批次生成圖片"
                          : "簡短描述你的回饋"
                      }
                      className={`w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors ${s.inputBg} ${s.inputBorder} ${s.text}`}
                      maxLength={200}
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label
                      className={`text-[11px] font-medium uppercase tracking-wide mb-1.5 block ${s.textMuted}`}
                    >
                      詳細說明{" "}
                      <span className={`font-normal ${s.textMuted}`}>
                        (選填)
                      </span>
                    </label>
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={
                        mode === "feature"
                          ? "描述你的使用場景和期望的效果..."
                          : "提供更多細節幫助我們理解..."
                      }
                      rows={3}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors resize-none ${s.inputBg} ${s.inputBorder} ${s.text}`}
                      maxLength={2000}
                    />
                  </div>

                  {/* Priority (compact) */}
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-[11px] font-medium uppercase tracking-wide ${s.textMuted}`}
                    >
                      重要程度
                    </span>
                    <div className="flex gap-1.5">
                      {PRIORITY_OPTIONS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setPriority(p.value)}
                          className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            priority === p.value
                              ? isDark
                                ? "bg-white/15 text-white ring-1 ring-white/20"
                                : "bg-stone-800/10 text-stone-800 ring-1 ring-stone-300"
                              : s.tagBg
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={!title.trim() || createFeedback.isPending}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${s.btnBg} ${s.btnText} disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {createFeedback.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        提交中...
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        提交{mode === "feature" ? "詢問" : "回饋"}
                      </>
                    )}
                  </button>

                  {createFeedback.isError && (
                    <p className="text-xs text-red-400 text-center">
                      提交失敗，請稍後再試
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
