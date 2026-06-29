import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import ThoughtIslandChain, { type ThoughtNode } from "./ThoughtIslandChain";
import { Button } from "./ui/button";
import { ArrowRight, Sparkles, SkipForward, Loader2 } from "lucide-react";
import { toast } from "sonner";

// ─── Typewriter Hook ────────────────────────────────────────────────────────

function useTypewriter(text: string, speed = 40) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    if (!text) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        setDone(true);
        clearInterval(interval);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

// ─── Static starter chips (shown before user types) ─────────────────────────

const STARTER_CHIPS = [
  "星空下的森林小屋",
  "海邊的金色日落",
  "未來城市的霓虹街道",
  "雪山上的孤獨旅人",
  "水彩風格的花園",
  "賽博龐克的東京夜景",
];

// ─── Onboarding Steps ───────────────────────────────────────────────────────

type OnboardingStep = "greeting" | "input" | "thinking" | "result" | "complete";

const GREETING_MESSAGES = [
  "你好！我是你的 AI 創作夥伴。",
  "讓我們在 90 秒內完成你的第一件作品。",
  "今天想創作什麼畫面？輸入幾個字就好 ✨",
];

// ─── Result guard (AIDV-637) ────────────────────────────────────────────────
// 生成完成回呼可能回傳空 resultUrl。空值（null/undefined/空字串/純空白）不可進入
// 「你的第一件作品完成了！」慶祝態，否則新手最關鍵的首次體驗會看到「完成了」卻
// 一片空白的誤導性成功態。比 `|| null` 更嚴：純空白字串也視為無作品。
export function isUsableResultUrl(url: unknown): url is string {
  return typeof url === "string" && url.trim().length > 0;
}

// ─── Component ──────────────────────────────────────────────────────────────

type Props = {
  onComplete: () => void;
  onSkip: () => void;
};

export default function OnboardingFlow({ onComplete, onSkip }: Props) {
  const { setAIState, personality } = useAIState();
  const [step, setStep] = useState<OnboardingStep>("greeting");
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [userInput, setUserInput] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [thoughtChain, setThoughtChain] = useState<ThoughtNode[]>([]);
  const [choiceChips, setChoiceChips] = useState<string[]>(STARTER_CHIPS);
  const [loadingChips, setLoadingChips] = useState(false);
  const [chipsSource, setChipsSource] = useState<"static" | "ai">("static");
  const inputRef = useRef<HTMLInputElement>(null);
  const chipDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the input value that triggered the current chip request
  const lastChipQueryRef = useRef<string>("");

  // Current greeting message typewriter
  const currentGreeting =
    step === "greeting" ? GREETING_MESSAGES[greetingIndex] : "";
  const { displayed: greetingText, done: greetingDone } = useTypewriter(
    currentGreeting,
    35
  );

  // Auto-advance greeting messages
  useEffect(() => {
    if (step !== "greeting" || !greetingDone) return;
    if (greetingIndex < GREETING_MESSAGES.length - 1) {
      const timer = setTimeout(() => setGreetingIndex(i => i + 1), 800);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setStep("input");
        setAIState("idle");
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [greetingDone, greetingIndex, step, setAIState]);

  // Focus input when step changes to input
  useEffect(() => {
    if (step === "input") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [step]);

  // ─── Dedicated LLM-powered Choice Chips via evaluate.suggestChips ─────────
  const suggestChipsMutation = trpc.evaluate.suggestChips.useMutation({
    onSuccess: data => {
      if (data.chips && data.chips.length > 0) {
        setChoiceChips(data.chips);
        setChipsSource("ai");
      }
      setLoadingChips(false);
    },
    onError: () => {
      setLoadingChips(false);
    },
  });

  // Debounced chip suggestion: 500ms after user stops typing
  useEffect(() => {
    if (step !== "input") return;
    if (chipDebounceRef.current) clearTimeout(chipDebounceRef.current);

    const trimmed = userInput.trim();
    if (trimmed.length >= 2) {
      // Don't re-query if the same text was already queried
      if (trimmed === lastChipQueryRef.current) return;
      chipDebounceRef.current = setTimeout(() => {
        lastChipQueryRef.current = trimmed;
        setLoadingChips(true);
        suggestChipsMutation.mutate({ partial: trimmed });
      }, 500);
    } else if (trimmed.length === 0) {
      setChoiceChips(STARTER_CHIPS);
      setChipsSource("static");
      lastChipQueryRef.current = "";
    }

    return () => {
      if (chipDebounceRef.current) clearTimeout(chipDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userInput, step]);

  // Generation mutations (two-step: prepareJob -> multimodal)
  const prepareJobMutation = trpc.generate.prepareJob.useMutation();
  const generateMutation = trpc.generate.multimodal.useMutation({
    onMutate: () => setAIState("generating"),
    onSuccess: data => {
      setThoughtChain((data as any).thoughtChain || []);
      setAIState("idle");
      // 生成未產出作品（resultUrl 空/純空白）→ 不進慶祝態，回 input 步驟重試（AIDV-637）
      if (!isUsableResultUrl(data.resultUrl)) {
        setResultUrl(null);
        toast.error("生成未產出圖片，請再試一次");
        setStep("input");
        return;
      }
      setResultUrl(data.resultUrl);
      setStep("result");
    },
    onError: err => {
      setAIState("idle");
      toast.error(err.message);
      setStep("input");
    },
  });

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (!userInput.trim()) return;
    setStep("thinking");
    setAIState("thinking");

    // Build simulated thought chain for the thinking phase
    const thinkingNodes: ThoughtNode[] = [
      {
        id: "safety",
        label: "安全檢查",
        status: "processing",
        detail: "正在驗證內容安全性...",
        timestamp: Date.now(),
      },
      {
        id: "compile",
        label: "提示詞編譯",
        status: "queued",
        detail: "等待編譯...",
        timestamp: Date.now(),
      },
      {
        id: "generate",
        label: "AI 生成",
        status: "queued",
        detail: "等待生成...",
        timestamp: Date.now(),
      },
    ];
    setThoughtChain(thinkingNodes);

    // Animate thought chain progression
    setTimeout(() => {
      setThoughtChain(prev =>
        prev.map(n =>
          n.id === "safety"
            ? { ...n, status: "completed" as const, detail: "內容安全 ✓" }
            : n.id === "compile"
              ? { ...n, status: "processing", detail: "正在編譯提示詞..." }
              : n
        )
      );
    }, 800);

    setTimeout(() => {
      setThoughtChain(prev =>
        prev.map(n =>
          n.id === "compile"
            ? { ...n, status: "completed", detail: "提示詞已優化 ✓" }
            : n.id === "generate"
              ? { ...n, status: "processing", detail: "AI 正在創作..." }
              : n
        )
      );
      setAIState("generating");
    }, 1600);

    // Actually trigger generation (two-step: prepareJob -> multimodal)
    setTimeout(async () => {
      try {
        const { jobId } = await prepareJobMutation.mutateAsync({
          generationType: "image",
        });
        generateMutation.mutate({
          jobId,
          prompt: userInput,
          generationType: "image",
          mode: "lightning",
          vibeCardIds: [],
          temperature: 0.6,
        });
      } catch {
        setAIState("idle");
        setStep("input");
      }
    }, 2000);
  }, [userInput, generateMutation, prepareJobMutation, setAIState]);

  const handleComplete = useCallback(() => {
    localStorage.setItem("ai-director-onboarded", "true");
    onComplete();
  }, [onComplete]);

  // Handle chip click: replace input with chip text
  const handleChipClick = useCallback((chip: string) => {
    setUserInput(chip);
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, #F5F3F0 0%, #EAC9C1 25%, #D4C5E2 50%, #C8D5E0 75%, #F5F3F0 100%)",
      }}
    >
      {/* Skip button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        onClick={() => {
          localStorage.setItem("ai-director-onboarded", "true");
          onSkip();
        }}
        className="absolute top-6 right-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors z-10"
      >
        <SkipForward className="w-4 h-4" />
        跳過引導
      </motion.button>

      <div className="max-w-2xl w-full mx-4 flex flex-col items-center">
        {/* ── Central Orb ── */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", duration: 0.8 }}
          className="mb-8"
        >
          <VisualSoul
            size="lg"
            state={
              step === "thinking"
                ? "thinking"
                : step === "result"
                  ? "generating"
                  : "idle"
            }
            personality={personality}
            className="!w-24 !h-24"
          />
        </motion.div>

        {/* ── Greeting Phase ── */}
        <AnimatePresence mode="wait">
          {step === "greeting" && (
            <motion.div
              key="greeting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="text-center"
            >
              <div className="min-h-[3rem] flex items-center justify-center">
                <p className="hs-h2 !mb-0 text-foreground">
                  {greetingText}
                  {!greetingDone && (
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.5, repeat: Infinity }}
                      className="inline-block w-0.5 h-5 bg-foreground ml-0.5 align-middle"
                    />
                  )}
                </p>
              </div>

              {/* Previous messages (faded) */}
              <div className="mt-4 space-y-1">
                {GREETING_MESSAGES.slice(0, greetingIndex).map((msg, i) => (
                  <p key={i} className="text-sm text-muted-foreground/60">
                    {msg}
                  </p>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Input Phase with Choice Chips ── */}
          {step === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full text-center"
            >
              <p className="hs-h2 !mb-0 text-foreground mb-6">
                今天想創作什麼畫面？
              </p>

              <div className="relative max-w-md mx-auto">
                <input
                  ref={inputRef}
                  type="text"
                  value={userInput}
                  onChange={e => setUserInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  placeholder="例如：星空下的森林小屋、海邊的日落..."
                  className="w-full h-14 px-5 pr-14 rounded-2xl text-base text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                  style={{
                    background: "rgba(255,255,255,0.7)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.6)",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!userInput.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl h-10 w-10 p-0"
                >
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>

              {/* ── Choice Chips: AI-powered suggestions ── */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-5 max-w-lg mx-auto"
              >
                {/* Chips header label */}
                <div className="flex items-center justify-center gap-1.5 mb-2.5">
                  {loadingChips && (
                    <Loader2 className="w-3 h-3 animate-spin text-primary/60" />
                  )}
                  <p className="hs-small !mb-0 text-muted-foreground/60">
                    {loadingChips
                      ? "AI 正在為你延展靈感..."
                      : chipsSource === "ai"
                        ? `根據「${userInput.trim()}」的延展靈感`
                        : "點擊快速開始"}
                  </p>
                </div>

                {/* Chips grid */}
                <div className="flex flex-wrap justify-center gap-2">
                  <AnimatePresence mode="popLayout">
                    {loadingChips
                      ? // Skeleton loading chips
                        Array.from({ length: 4 }).map((_, i) => (
                          <motion.div
                            key={`skeleton-${i}`}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ delay: i * 0.05 }}
                            className="h-8 rounded-full animate-pulse"
                            style={{
                              width: `${80 + Math.random() * 40}px`,
                              background: "rgba(255,255,255,0.4)",
                              border: "1px solid rgba(255,255,255,0.3)",
                            }}
                          />
                        ))
                      : choiceChips.map((chip, i) => (
                          <motion.button
                            key={`${chip}-${i}`}
                            layout
                            initial={{ opacity: 0, scale: 0.85, y: 6 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.85, y: -6 }}
                            transition={{
                              delay: i * 0.06,
                              type: "spring",
                              stiffness: 400,
                              damping: 25,
                            }}
                            onClick={() => handleChipClick(chip)}
                            className="group px-3.5 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 active:scale-95 cursor-pointer"
                            style={{
                              background:
                                chipsSource === "ai"
                                  ? "rgba(255,255,255,0.75)"
                                  : "rgba(255,255,255,0.6)",
                              backdropFilter: "blur(8px)",
                              border:
                                chipsSource === "ai"
                                  ? "1px solid rgba(var(--primary-rgb, 139,92,246),0.25)"
                                  : "1px solid rgba(255,255,255,0.5)",
                              color: "hsl(var(--foreground))",
                              boxShadow:
                                chipsSource === "ai"
                                  ? "0 2px 12px rgba(139,92,246,0.08)"
                                  : "0 2px 8px rgba(0,0,0,0.04)",
                            }}
                          >
                            <Sparkles
                              className={`w-3 h-3 inline mr-1 transition-opacity ${
                                chipsSource === "ai"
                                  ? "opacity-70 text-primary"
                                  : "opacity-50"
                              }`}
                            />
                            {chip}
                          </motion.button>
                        ))}
                  </AnimatePresence>
                </div>
              </motion.div>

              <p className="mt-4 text-xs text-muted-foreground">
                按 Enter 或點擊箭頭開始創作
              </p>
            </motion.div>
          )}

          {/* ── Thinking Phase ── */}
          {step === "thinking" && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full"
            >
              <p className="text-center hs-h2 !mb-0 text-foreground mb-4">
                AI 正在為「{userInput}」構思...
              </p>

              {/* Thought Island Chain - elevated visibility */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
              >
                <ThoughtIslandChain nodes={thoughtChain} isVisible={true} />
              </motion.div>

              <p className="text-center text-xs text-muted-foreground mt-4 animate-pulse">
                請稍候，AI 正在創作中...
              </p>
            </motion.div>
          )}

          {/* ── Result Phase ── */}
          {step === "result" && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full text-center"
            >
              {/* 僅在真的有作品時才慶祝；無作品時改顯示重試引導（AIDV-637 防呆） */}
              {resultUrl ? (
                <>
                  <p className="hs-h2 !mb-0 text-foreground mb-2">
                    你的第一件作品完成了！
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">
                    這就是 AI Director 的魔法
                  </p>
                </>
              ) : (
                <>
                  <p className="hs-h2 !mb-0 text-foreground mb-2">
                    生成沒有產出作品
                  </p>
                  <p className="text-sm text-muted-foreground mb-6">
                    這次沒有成功產出畫面，要再試一次嗎？
                  </p>
                </>
              )}

              {/* Result image */}
              {resultUrl && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.6 }}
                  className="max-w-sm mx-auto mb-6 rounded-2xl overflow-hidden shadow-xl"
                  style={{ border: "2px solid rgba(255,255,255,0.5)" }}
                >
                  <img
                    src={resultUrl}
                    alt="Your first creation"
                    className="w-full"
                    loading="lazy"
                  />
                </motion.div>
              )}

              {/* Thought chain summary */}
              {thoughtChain.length > 0 && (
                <div className="mb-6">
                  <ThoughtIslandChain nodes={thoughtChain} isVisible={true} />
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                {!resultUrl && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setResultUrl(null);
                      setStep("input");
                    }}
                    className="rounded-xl h-12 px-8 gap-2 text-sm"
                  >
                    <ArrowRight className="w-4 h-4 rotate-180" />
                    再試一次
                  </Button>
                )}
                <Button
                  onClick={handleComplete}
                  className="rounded-xl h-12 px-8 gap-2 text-sm shadow-lg"
                >
                  <Sparkles className="w-4 h-4" />
                  進入完整工作室
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
