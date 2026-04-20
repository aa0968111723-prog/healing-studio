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

import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Sparkles, X, RotateCcw, FastForward, MessageCircle, Navigation2, Send, Loader2, ChevronDown } from "lucide-react";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import VisualSoul from "./VisualSoul";
import { useAIState } from "@/contexts/AIStateContext";
import { usePersonality } from "@/contexts/PersonalityContext";
import { trpc } from "@/lib/trpc";
import type { OrbGuideStepRewrite } from "../../../shared/agent-actions";
import { summarizeOrbGuideActions } from "../../../shared/orb-guide-plans";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";

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
  /** When true, renders as a full-screen bottom sheet overlay (mobile responsive) */
  fullscreen?: boolean;
}

export default function OrbGuidePanel({ onClose, fullscreen: fullscreenProp }: OrbGuidePanelProps) {
  const isMobile = useIsMobile();
  const fullscreen = fullscreenProp ?? isMobile;
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

  // ── Panel mode: guided flow or free chat ──────────────────────────────────
  const [panelMode, setPanelMode] = useState<"guide" | "chat">("guide");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "orb"; text: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const aiChatMutation = trpc.ai.chat.useMutation();

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  useEffect(() => {
    if (panelMode === "chat") {
      setTimeout(() => chatInputRef.current?.focus(), 100);
    }
  }, [panelMode]);

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading) return;
    const userMsg = chatInput.trim();
    const updated = [...chatMessages, { role: "user" as const, text: userMsg }];
    setChatMessages(updated);
    setChatInput("");
    setIsChatLoading(true);
    try {
      const contextParts = ["光球引導面板"];
      if (intent) contextParts.push(`意圖: ${INTENT_CONFIGS[intent].label}`);
      const data = await aiChatMutation.mutateAsync({
        messages: updated.map(m => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.text,
        })),
        personality,
        context: contextParts.join(" · "),
      });
      setChatMessages(prev => [...prev, { role: "orb", text: data.reply }]);
    } catch {
      setChatMessages(prev => [
        ...prev,
        { role: "orb", text: "🌸 剛才有點問題，再說一次好嗎？" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatInput, chatMessages, isChatLoading, personality, intent, aiChatMutation]);

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

  // ── Fullscreen (mobile bottom-sheet) wrapper ──
  const panelContent = (
    <motion.div
      className={cn(
        "relative flex flex-col overflow-hidden",
        fullscreen
          ? "w-full h-full rounded-t-3xl sm:rounded-3xl"
          : "w-[320px] max-h-[520px] rounded-3xl",
        "border border-white/15",
        "bg-gradient-to-b from-black/75 via-black/65 to-black/75",
        "backdrop-blur-2xl shadow-2xl shadow-black/50"
      )}
      initial={fullscreen ? { opacity: 0, y: "100%" } : { opacity: 0, scale: 0.9, y: 16 }}
      animate={fullscreen ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
      exit={fullscreen ? { opacity: 0, y: "60%" } : { opacity: 0, scale: 0.88, y: 10 }}
      transition={fullscreen ? { type: "spring", stiffness: 300, damping: 30 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── 頂部光暈裝飾 ── */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* ── Mobile drag indicator ── */}
      {fullscreen && (
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/25" />
        </div>
      )}

      {/* ── Header ── */}
      <div className={cn(
        "flex items-center justify-between shrink-0",
        fullscreen ? "px-5 pt-3 pb-2" : "px-4 pt-4 pb-2"
      )}>
        <div className="flex items-center gap-2.5">
          <VisualSoul
            state={step === "confirming" ? "acting" : step === "ask_detail" ? "thinking" : panelMode === "chat" && isChatLoading ? "thinking" : "idle"}
            personality={personality}
            size={fullscreen ? "md" : "sm"}
          />
          <span className={cn(
            "font-medium text-white/60 tracking-wide",
            fullscreen ? "text-sm" : "text-xs"
          )}>光球助手</span>
        </div>
        <div className="flex items-center gap-1">
          {panelMode === "guide" && step !== "ask_intent" && (
            <motion.button
              onClick={reset}
              className={cn(
                "rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all",
                fullscreen ? "p-2" : "p-1.5"
              )}
              whileTap={{ scale: 0.9 }}
              title="重新選擇"
            >
              <RotateCcw className={fullscreen ? "w-4 h-4" : "w-3.5 h-3.5"} />
            </motion.button>
          )}
          <motion.button
            onClick={onClose}
            className={cn(
              "rounded-full hover:bg-white/10 text-white/40 hover:text-white/70 transition-all",
              fullscreen ? "p-2" : "p-1.5"
            )}
            whileTap={{ scale: 0.9 }}
          >
            {fullscreen ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
          </motion.button>
        </div>
      </div>

      {/* ── Mode Tabs ── */}
      <div className={cn(
        "flex items-center gap-1 shrink-0",
        fullscreen ? "px-5 pb-3" : "px-4 pb-3"
      )}>
        <button
          onClick={() => setPanelMode("guide")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all",
            fullscreen ? "py-2.5 text-sm" : "py-1.5 text-xs",
            panelMode === "guide"
              ? "bg-white/15 text-white"
              : "text-white/40 hover:text-white/70 hover:bg-white/8"
          )}
        >
          <Navigation2 className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
          引導帶路
        </button>
        <button
          onClick={() => setPanelMode("chat")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all",
            fullscreen ? "py-2.5 text-sm" : "py-1.5 text-xs",
            panelMode === "chat"
              ? "bg-white/15 text-white"
              : "text-white/40 hover:text-white/70 hover:bg-white/8"
          )}
        >
          <MessageCircle className={fullscreen ? "w-4 h-4" : "w-3 h-3"} />
          自由聊天
        </button>
      </div>

      {/* ── Chat Mode ── */}
      {panelMode === "chat" && (
        <div className={cn(
          "flex flex-col flex-1 overflow-hidden gap-2",
          fullscreen ? "px-5 pb-4" : "px-4 pb-3"
        )}>
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-white/10">
            {chatMessages.length === 0 && (
              <OrbSpeechBubble
                text={
                  intent
                    ? `說說你想要的${INTENT_CONFIGS[intent].label}作品？隨便說幾個字就好，我來幫你規劃。`
                    : "有任何問題都可以直接問我，或是告訴我你想做什麼 ✨"
                }
              />
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] px-3 py-2 rounded-2xl leading-relaxed",
                    fullscreen ? "text-sm" : "text-xs",
                    msg.role === "user"
                      ? "bg-white/20 text-white rounded-br-sm"
                      : "bg-white/8 text-white/85 rounded-bl-sm border border-white/10"
                  )}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className={cn(
                  "px-3 py-2 rounded-2xl rounded-bl-sm bg-white/8 border border-white/10 text-white/50 flex items-center gap-1.5",
                  fullscreen ? "text-sm" : "text-xs"
                )}>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  思考中…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Chat input */}
          <div className={cn(
            "flex items-center gap-2 bg-white/8 rounded-2xl border border-white/10 shrink-0",
            fullscreen ? "px-4 py-3" : "px-3 py-2"
          )}>
            <input
              ref={chatInputRef}
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleChatSend();
                }
              }}
              placeholder="說一句話就好…"
              className="flex-1 bg-transparent text-xs text-white placeholder:text-white/30 outline-none"
            />
            <button
              onClick={() => void handleChatSend()}
              disabled={!chatInput.trim() || isChatLoading}
              className="p-1 rounded-lg hover:bg-white/10 disabled:opacity-30 transition-all"
            >
              <Send className="w-3 h-3 text-white/70" />
            </button>
          </div>
        </div>
      )}

      {/* ── Guide Mode (Scrollable Content) ── */}
      {panelMode === "guide" && (
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto space-y-3 scrollbar-thin scrollbar-thumb-white/10",
          fullscreen ? "px-5 pb-5" : "px-4 pb-4"
        )}
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

              <div className={cn(
                "gap-2 pt-1",
                fullscreen ? "grid grid-cols-2" : "grid grid-cols-1"
              )}>
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

                {/* Phase 3e：列出到站會做的動作（setTab / fillPrompt…），讓使用者有預期 */}
                {(() => {
                  const preview = summarizeOrbGuideActions(plan.actions).filter(
                    // fillPrompt 已有自己的區塊顯示完整內容，這邊的摘要就不重覆
                    line => !line.startsWith("填入提示詞")
                  );
                  if (!preview.length) return null;
                  return (
                    <div className="pt-1 border-t border-white/8 space-y-1">
                      <p className="text-xs text-white/40">到站會幫你做</p>
                      <ul className="text-xs text-white/70 space-y-0.5 pl-1">
                        {preview.map((line, i) => (
                          <li key={i}>・{line}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

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
      )}

      {/* ── 底部光暈線 ── */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* ── 底部安全區 (mobile fullscreen) ── */}
      {fullscreen && (
        <div className="shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} />
      )}
    </motion.div>
  );

  // ── Fullscreen: wrap in fixed overlay; Desktop: return panel directly ──
  if (fullscreen) {
    return (
      <>
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />
        {/* Bottom sheet container */}
        <div
          className="fixed inset-x-0 bottom-0 z-[71] flex flex-col"
          style={{
            maxHeight: "calc(92vh - env(safe-area-inset-top, 0px))",
          }}
        >
          {panelContent}
        </div>
      </>
    );
  }

  return panelContent;
}
