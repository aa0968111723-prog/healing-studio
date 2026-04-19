/**
 * OrbGuidePanel.tsx — 光球引導對話面板
 *
 * 這是升級後的光球核心 UI：
 *   - 全新「今天想做什麼？」意圖選擇介面
 *   - 逐步問題收集（每次只問一題，不壓迫）
 *   - 確認畫面 + 一鍵跳轉
 *   - 設計：溫暖、療癒、零壓力
 *
 * 使用方式：
 *   在 ProactiveOrbWidget 的 showPanel 時 render 此元件
 */

import { useRef, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, X, RotateCcw, FastForward } from "lucide-react";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import VisualSoul from "./VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import { usePersonality } from "@/contexts/PersonalityContext";
import { trpc } from "@/lib/trpc";
import type { OrbGuideStepRewrite } from "../../../shared/agent-actions";
import { cn } from "@/lib/utils";

// ─── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(text: string, speed = 35) {
  const [displayed, setDisplayed] = [
    useRef(""),
    useRef<ReturnType<typeof setInterval> | null>(null),
  ];
  const [, forceUpdate] = [useRef(0), (n: number) => n];

  // simple approach: just return text for now, animate via CSS
  return text;
}

// ─── Intent Card ─────────────────────────────────────────────────────────────

function IntentCard({
  intent,
  onSelect,
}: {
  intent: Exclude<GuideIntent, null>;
  onSelect: () => void;
}) {
  const cfg = INTENT_CONFIGS[intent];
  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        "relative flex flex-col items-start gap-1.5 p-3.5 rounded-2xl",
        "bg-white/8 hover:bg-white/15 border border-white/10 hover:border-white/25",
        "transition-all duration-200 text-left group w-full"
      )}
      whileHover={{ scale: 1.02, y: -1 }}
      whileTap={{ scale: 0.97 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{cfg.emoji}</span>
        <span className="text-sm font-medium text-white/90">{cfg.label}</span>
      </div>
      <p className="text-xs text-white/50 leading-relaxed pl-0.5">{cfg.description}</p>
      <ArrowRight className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" />
    </motion.button>
  );
}

// ─── Answer Option Button ─────────────────────────────────────────────────────

function AnswerOption({
  label,
  emoji,
  onSelect,
  delay,
}: {
  label: string;
  emoji: string;
  onSelect: () => void;
  delay: number;
}) {
  return (
    <motion.button
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 px-4 py-3 rounded-2xl w-full text-left",
        "bg-white/8 hover:bg-white/18 border border-white/10 hover:border-white/30",
        "transition-all duration-200 group"
      )}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.25 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
    >
      <span className="text-base leading-none">{emoji}</span>
      <span className="text-sm text-white/85 group-hover:text-white transition-colors">{label}</span>
      <ArrowRight className="ml-auto w-3 h-3 text-white/20 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" />
    </motion.button>
  );
}

// ─── OrbSpeechBubble ─────────────────────────────────────────────────────────

function OrbSpeechBubble({ text, small = false }: { text: string; small?: boolean }) {
  return (
    <motion.div
      className={cn(
        "relative px-4 py-3 rounded-2xl rounded-bl-sm",
        "bg-gradient-to-br from-white/12 to-white/6 border border-white/15",
        "text-white/90 leading-relaxed",
        small ? "text-xs" : "text-sm"
      )}
      initial={{ opacity: 0, scale: 0.92, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {text}
    </motion.div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface OrbGuidePanelProps {
  onClose: () => void;
}

export default function OrbGuidePanel({ onClose }: OrbGuidePanelProps) {
  const {
    step,
    intent,
    answers,
    plan,
    selectIntent,
    submitAnswer,
    confirmAndNavigate,
    reset,
    patchPlan,
  } = useOrbGuide();
  const { aiState } = useAIState();
  const { personality } = usePersonality();

  // Current question index based on answers already collected
  const currentQuestionIndex = intent
    ? Object.keys(answers).length
    : 0;
  const currentQuestion = intent
    ? INTENT_CONFIGS[intent]?.questions[currentQuestionIndex]
    : null;

  // Scroll to bottom when new content appears
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [step, currentQuestionIndex]);

  // ── Phase 3d-hybrid：LLM 軟化 / 補選項 / 跳題 ──
  // 每個 step 有一個 cache key，避免重複 fire；LLM 任何失敗都 fallback 到 stock。
  const stepKey = intent
    ? step === "confirming"
      ? `${intent}:final`
      : currentQuestion
      ? `${intent}:${currentQuestion.id}`
      : null
    : null;
  const [rewriteByKey, setRewriteByKey] = useState<
    Record<string, OrbGuideStepRewrite>
  >({});
  const rewrite = stepKey ? rewriteByKey[stepKey] : undefined;
  const firedKeysRef = useRef<Set<string>>(new Set());

  const stepMutation = trpc.orbGuide.step.useMutation({
    onError: () => {
      /* stay on stock, no UX disruption */
    },
  });

  useEffect(() => {
    if (!intent || !stepKey) return;
    if (firedKeysRef.current.has(stepKey)) return;
    firedKeysRef.current.add(stepKey);

    const cfg = INTENT_CONFIGS[intent];
    if (!cfg) return;
    const answeredSoFar = Object.entries(answers).map(([qid, val]) => {
      // 找該答案在該題 options 裡對應的中文 label（幫 LLM 讀懂）
      const q = cfg.questions.find(x => x.id === qid);
      const opt = q?.options.find(o => o.value === val);
      return { questionId: qid, value: val, label: opt?.label };
    });
    const isFinalStep = step === "confirming";

    stepMutation.mutate(
      {
        intent,
        intentLabel: cfg.label,
        targetLabel: cfg.targetLabel,
        personality,
        answeredSoFar,
        currentQuestion:
          !isFinalStep && currentQuestion
            ? {
                id: currentQuestion.id,
                stockText: currentQuestion.text,
                stockOptions: currentQuestion.options,
              }
            : undefined,
        isFinalStep,
        stockOrbMessage: isFinalStep ? plan?.orbMessage : undefined,
        stockPromptHint: isFinalStep ? plan?.autoFillPrompt : undefined,
      },
      {
        onSuccess: (data: OrbGuideStepRewrite) => {
          setRewriteByKey(prev => ({ ...prev, [stepKey]: data }));
          // 收尾步驟：LLM 有改寫的話，把 plan 同步 patch 掉，讓 autoFillPrompt 真的送到目標頁
          if (isFinalStep && (data.orbMessageOverride || data.promptHintOverride)) {
            patchPlan({
              orbMessage: data.orbMessageOverride,
              autoFillPrompt: data.promptHintOverride,
            });
          }
        },
      }
    );
    // 只在 stepKey 變動時重 fire；stepMutation 來自 hook，身份會變但內部有 guard
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // 清 cache：reset / 換 intent 時，清掉已發射的 key
  useEffect(() => {
    if (!intent) {
      firedKeysRef.current.clear();
      setRewriteByKey({});
    }
  }, [intent]);

  // 當前題目合併 stock + LLM 補的 options
  const mergedOptions = useMemo(() => {
    if (!currentQuestion) return [];
    const stock = currentQuestion.options;
    const extra = rewrite?.extraOptions ?? [];
    return [...stock, ...extra];
  }, [currentQuestion, rewrite]);

  // 如果 LLM 建議可跳題，露出「直接帶你走」按鈕（不自動跳）
  // 實作：用當前題目的第一個 stock option 當預設，推進到下一題/確認步驟。
  // 這樣 buildPromptHint 仍會收到合法答案值，prompt 不會壞掉。
  const canSkipNext = !!rewrite?.skipNext && !!currentQuestion;
  const handleSkipNext = () => {
    if (!currentQuestion || !currentQuestion.options.length) return;
    const defaultValue = currentQuestion.options[0].value;
    submitAnswer(currentQuestion.id, defaultValue);
  };

  // ── Intents to show (ordered for best UX) ──
  const intentOrder: Exclude<GuideIntent, null>[] = [
    "image", "video", "music", "voice", "script", "lora", "explore",
  ];

  return (
    <motion.div
      className={cn(
        "relative flex flex-col overflow-hidden",
        "w-[320px] max-h-[520px]",
        "rounded-3xl border border-white/15",
        "bg-gradient-to-b from-black/75 via-black/65 to-black/75",
        "backdrop-blur-2xl shadow-2xl shadow-black/50"
      )}
      initial={{ opacity: 0, scale: 0.9, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.88, y: 10 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── 頂部光暈裝飾 ── */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2.5">
          <VisualSoul
            state={step === "confirming" ? "acting" : step === "ask_detail" ? "thinking" : "idle"}
            personality={personality}
            size="sm"
          />
          <span className="text-xs font-medium text-white/60 tracking-wide">光球助手</span>
        </div>
        <div className="flex items-center gap-1">
          {step !== "ask_intent" && (
            <motion.button
              onClick={reset}
              className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
              whileTap={{ scale: 0.9 }}
              title="重新選擇"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </motion.button>
          )}
          <motion.button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all"
            whileTap={{ scale: 0.9 }}
          >
            <X className="w-3.5 h-3.5" />
          </motion.button>
        </div>
      </div>

      {/* ── Scrollable Content ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 scrollbar-thin scrollbar-thumb-white/10"
      >
        <AnimatePresence mode="wait">

          {/* ═══ STEP: ask_intent ═══ */}
          {step === "ask_intent" && (
            <motion.div
              key="ask_intent"
              className="space-y-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <OrbSpeechBubble text="嘿 👋 今天想做什麼？選一個，我帶你去。" />

              <div className="grid grid-cols-1 gap-2 pt-1">
                {intentOrder.map((id, i) => (
                  <motion.div
                    key={id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <IntentCard
                      intent={id}
                      onSelect={() => selectIntent(id)}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ═══ STEP: ask_detail ═══ */}
          {step === "ask_detail" && intent && currentQuestion && (
            <motion.div
              key={`ask_detail_${currentQuestionIndex}`}
              className="space-y-3"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* 顯示已選的意圖 */}
              <div className="flex items-center gap-2 px-1">
                <span className="text-lg">{INTENT_CONFIGS[intent].emoji}</span>
                <span className="text-xs text-white/50">{INTENT_CONFIGS[intent].label}</span>
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-xs text-white/30">
                  {currentQuestionIndex + 1} / {INTENT_CONFIGS[intent].questions.length}
                </span>
              </div>

              <OrbSpeechBubble
                text={rewrite?.softenedQuestion || currentQuestion.text}
              />

              <div className="space-y-2 pt-1">
                {mergedOptions.map((opt, i) => (
                  <AnswerOption
                    key={opt.value}
                    label={opt.label}
                    emoji={opt.emoji}
                    delay={i * 0.06}
                    onSelect={() => submitAnswer(currentQuestion.id, opt.value)}
                  />
                ))}

                {canSkipNext && (
                  <motion.button
                    onClick={handleSkipNext}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-xl w-full text-left",
                      "bg-white/4 hover:bg-white/10 border border-white/8 hover:border-white/20",
                      "transition-all text-xs text-white/60 hover:text-white/85"
                    )}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: mergedOptions.length * 0.06 + 0.1 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <FastForward className="w-3 h-3" />
                    <span>光球覺得資訊夠了，直接帶你走</span>
                  </motion.button>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ STEP: confirming ═══ */}
          {step === "confirming" && plan && (
            <motion.div
              key="confirming"
              className="space-y-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* 光球說的話 */}
              <OrbSpeechBubble text={plan.orbMessage} />

              {/* 目標預覽卡 */}
              <motion.div
                className="p-4 rounded-2xl bg-white/8 border border-white/15 space-y-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{plan.intent ? INTENT_CONFIGS[plan.intent].emoji : "✨"}</span>
                  <div>
                    <p className="text-sm font-medium text-white/90">前往 {plan.targetLabel}</p>
                    <p className="text-xs text-white/45">{plan.targetPath}</p>
                  </div>
                </div>

                {plan.autoFillPrompt && (
                  <div className="pt-1 border-t border-white/8">
                    <p className="text-xs text-white/40 mb-1">光球幫你準備的提示詞</p>
                    <p className="text-xs text-white/65 bg-white/5 rounded-xl px-3 py-2 font-mono leading-relaxed">
                      {plan.autoFillPrompt}
                    </p>
                  </div>
                )}
              </motion.div>

              {/* 確認按鈕 */}
              <motion.button
                onClick={confirmAndNavigate}
                className={cn(
                  "w-full flex items-center justify-center gap-2.5 py-3.5 rounded-2xl",
                  "bg-gradient-to-r from-white/20 to-white/12 hover:from-white/28 hover:to-white/18",
                  "border border-white/20 hover:border-white/35",
                  "text-sm font-medium text-white transition-all duration-200",
                  "shadow-lg shadow-black/20"
                )}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                <Sparkles className="w-4 h-4" />
                帶我去 {plan.targetLabel}
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── 底部光暈線 ── */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </motion.div>
  );
}
