/**
 * AgentChat.tsx — Phase 2a 全頁光球代理人聊天緩衝頁（/agent）
 * ────────────────────────────────────────────────────────────────────────────
 * 目的：給新進或猶豫中的使用者一個「先說話，再看頁面」的入口。
 *   - 不密密麻麻 — 置中、留白、呼吸感
 *   - 用 Phase 1.5 的 ai.chat（MiniMax M2.7）、結構化 pageSnapshot、
 *     意圖確認卡（AgentIntentPreview）、回饋 bus
 *   - 光球回覆的 [ACTION:navigate:/path] 會真的把使用者帶去目標頁
 *   - [ACTION:submit/reset/applyPreset/...] 會走確認閘，不會一鍵執行
 *   - [SUGGEST:...] 變成柔軟的快速回覆按鈕，讓使用者不用自己打字
 *
 * 這頁同時也是 Phase 2 第一個接入 PageAgent bus 的頁面，
 * useRegisterPageAgent 裡宣告的「能力」只是「引導去其他頁」——
 * 故意保持極簡，所有動作都轉給對應頁面的 handler 或走 navigate。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, ArrowRight, Navigation2, MessageCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePersonality } from "@/contexts/PersonalityContext";
import {
  parseLLMActions,
  usePageAgent,
  useRegisterPageAgent,
  type AgentAction,
} from "@/contexts/PageAgentContext";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import { Button } from "@/components/ui/button";
import { getAgentHomeEntries } from "@/config/appRegistry";

// ─── 型別 ─────────────────────────────────────────────────────────────────

type ChatRole = "user" | "orb";
interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
  /** 光球此輪附上的意圖摘要（若有） */
  intent?: string;
}

type StarterEntry = {
  id: string;
  label: string;
  path: string;
  description: string;
  quickAction?: {
    action?: AgentAction;
    prompt?: string;
    description?: string;
  };
  prompt?: string;
  starterText: string;
};

// ─── 依人格挑選柔軟的開場問候 ───────────────────────────────────────────

const GREETINGS: Record<string, string[]> = {
  calm: [
    "嗨 🌿 我是光球。你想慢慢聊聊今天心情如何嗎？或是有什麼創作想試試看。",
    "歡迎來到這裡 ✨ 深呼吸一下。有沒有想哪種類型的創作？或是只是想看看可以玩什麼都很好。",
  ],
  creative: [
    "嗨！我是光球 🌸 今天想做點什麼？圖片？影片？還是一首小歌？不急，我陪你慢慢挑。",
    "你來啦 ✨ 有畫面、有聲音、還是一段故事在腦海裡？告訴我一點點就好，我來想辦法接下去。",
  ],
  technical: [
    "嗨，我是光球 🌿 想做什麼類型的內容？我可以幫你挑模型和參數，不用你記一堆。",
    "歡迎 ✨ 直接說你想要的結果，我幫你拆解成工具和步驟，沒有壓力。",
  ],
};

const AGENT_HOME_ENTRIES = getAgentHomeEntries();

function buildStarterEntry(page: (typeof AGENT_HOME_ENTRIES)[number]): StarterEntry {
  const primaryQuickAction = page.quickActions[0];
  return {
    id: page.id,
    label: page.label,
    path: page.path,
    description: page.description,
    quickAction: primaryQuickAction
      ? {
          action: primaryQuickAction.action,
          prompt: primaryQuickAction.prompt,
          description: primaryQuickAction.description,
        }
      : undefined,
    prompt: primaryQuickAction?.prompt ?? page.orbHints[0],
    starterText:
      primaryQuickAction?.description ?? page.orbHints[0] ?? `帶我去${page.label}`,
  };
}

// ─── 元件 ────────────────────────────────────────────────────────────────

export default function AgentChat() {
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const [, setLocation] = useLocation();
  const { openPanel: openOrbGuide, selectIntent: selectOrbIntent } = useOrbGuide();

  // Ref to hold the latest `send` for use in handler (avoids stale closures)
  const sendRef = useRef<(raw: string) => Promise<void>>(undefined);

  // ── 把 /agent 本身也登記成一個 PageAgent 頁面 ──────────────────────
  //
  // 這頁自己的能力包括「帶你去別頁」和「搜尋」——
  // 其他結構化動作留給目的地頁面的 handler（透過 pending queue 傳遞）。
  useRegisterPageAgent({
    pageId: "agent-chat",
    pageLabel: "光球聊天",
    pagePath: "/agent",
    capabilities: [
      {
        action: "navigate",
        label: "前往頁面",
        hint: "使用者在聊天頁時，navigate 會直接帶他過去",
      },
      {
        action: "search",
        label: "全站搜尋",
        hint: "搜尋功能頁面、工作流程、模型名稱",
      },
    ],
    handle: async action => {
      if (action.type === "navigate") {
        setLocation(action.path);
        return { ok: true, message: "navigated" };
      }
      if (action.type === "search") {
        // 在聊天頁搜尋：用搜尋關鍵字自動送出一次 chat
        try {
          void sendRef.current?.(`搜尋：${action.query}`);
        } catch {
          console.warn("[AgentChat] search dispatch failed for:", action.query);
        }
        return { ok: true, message: "searching" };
      }
      // 其他動作：這頁沒有工具可執行，讓 bus 自己 enqueue 給目標頁
      return { ok: false, reason: "not-applicable-on-agent-chat" };
    },
  });

  // ─── Chat 狀態 ─────────────────────────────────────────────────────
  const greeting = useMemo(() => {
    const list = GREETINGS[personality] ?? GREETINGS.creative;
    return list[Math.floor(Math.random() * list.length)];
  }, [personality]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: "orb", text: greeting, at: Date.now() },
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const starterEntries = useMemo(
    () =>
      AGENT_HOME_ENTRIES
        .filter(page => page.id !== "home")
        .slice(0, 6)
        .map(buildStarterEntry),
    []
  );

  const aiChat = trpc.ai.chat.useMutation();

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // ─── 送出訊息 ───────────────────────────────────────────────────────
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || isSending) return;
      const nextHistory: ChatMessage[] = [
        ...messages,
        { role: "user", text, at: Date.now() },
      ];
      setMessages(nextHistory);
      setInput("");
      setSuggestions([]);
      setIsSending(true);

      try {
        const data = await aiChat.mutateAsync({
          messages: nextHistory
            .filter(m => m.at !== messages[0]?.at || m.role === "user") // skip first greeting
            .map(m => ({
              role: m.role === "user" ? ("user" as const) : ("assistant" as const),
              content: m.text,
            })),
          personality,
          context: "光球聊天頁（/agent）",
          pageSnapshot: pageAgent.snapshot ?? undefined,
          recentFeedback: pageAgent.recentFeedback,
          // 緩衝頁上，所有結構化動作都先預覽再執行（額外柔軟）
          alwaysConfirm: true,
        });

        const intent =
          typeof (data as { intent?: string | null }).intent === "string"
            ? ((data as { intent?: string | null }).intent as string)
            : undefined;
        const askBeforeAct =
          (data as { askBeforeAct?: boolean }).askBeforeAct === true;
        const sugg = (data as { suggestions?: string[] }).suggestions ?? [];

        setMessages(prev => [
          ...prev,
          { role: "orb", text: data.reply, at: Date.now(), intent },
        ]);
        setSuggestions(sugg.slice(0, 4));

        // ── Dispatch 結構化 actions ──────────────────────────────
        // navigate 在這頁會被我們自己的 handler 直接吃掉（帶去目標頁）；
        // 其他動作若是目標頁能力，會進 pending queue 等目標頁 drain；
        // 破壞性動作則由 AgentIntentPreview 先問使用者。
        const structured = parseLLMActions(data.actions);
        for (const action of structured) {
          if (action.type === "navigate") {
            // navigate 本身不走確認閘（使用者可隨時回上一頁）
            setLocation(action.path);
            continue;
          }
          void pageAgent.dispatch(action, {
            source: "ai-chat",
            intentSummary: intent,
            requireConfirmation: askBeforeAct ? true : undefined,
          });
        }
      } catch {
        setMessages(prev => [
          ...prev,
          {
            role: "orb",
            text: "🌸 抱歉，我剛才恍神了一下。再跟我說一次好嗎？",
            at: Date.now(),
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [aiChat, isSending, messages, pageAgent, personality, setLocation]
  );

  // Keep sendRef in sync with the latest `send` callback
  sendRef.current = send;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send]
  );

  const isFirstTurn = messages.length <= 1;
  const quickStarters = useMemo(
    () => starterEntries.map(entry => entry.starterText).slice(0, 4),
    [starterEntries]
  );
  const handleStarterEntryClick = useCallback(
    async (entry: StarterEntry) => {
      // 1) 有 path -> 先導頁
      if (entry.path && entry.path !== "/agent") {
        setLocation(entry.path);
      }
      // 2) quickAction 有 action -> dispatch 第一個
      if (entry.quickAction?.action) {
        await pageAgent.dispatch(entry.quickAction.action, {
          source: "manual",
        });
      }
      // 3) 有 prompt -> 直接送出 chat
      if (entry.prompt) {
        await send(entry.prompt);
        return;
      }
      if (entry.path === "/agent") {
        await send(entry.starterText);
      }
    },
    [pageAgent, send, setLocation]
  );

  return (
    <div className="flex-1 flex flex-col items-center w-full min-h-full">
      {/* 柔和漸層背景，呼吸感 */}
      <div
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(167, 243, 208, 0.18) 0%, transparent 60%), radial-gradient(50% 50% at 80% 100%, rgba(196, 181, 253, 0.15) 0%, transparent 60%)",
        }}
      />

      <div className="w-full max-w-2xl flex-1 flex flex-col px-4 sm:px-6 py-8 sm:py-12 gap-6">
        {/* 開場區塊 */}
        <div className="flex flex-col items-center text-center gap-3 pb-2">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-300 via-sky-300 to-violet-300 shadow-lg flex items-center justify-center"
          >
            <div className="absolute inset-0 rounded-full bg-white/30 blur-md" />
            <Sparkles className="relative w-7 h-7 text-white" />
          </motion.div>
          <h1 className="text-xl sm:text-2xl font-medium text-slate-800 dark:text-slate-100">
            先聊聊看就好 🌿
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
            不用急著學工具，也不用先研究模型。先讓光球帶你快速操作；想深入時，再去「學習文件中心」慢慢學就好。
          </p>

          {/* ── 第一輪：意圖選擇 grid ── */}
          {isFirstTurn && (
            <AnimatePresence>
              <motion.div
                key="intent-grid"
                className="w-full mt-2 space-y-3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  你想做什麼？選一個，光球帶你去：
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(["image", "video", "music", "voice", "script", "lora", "explore"] as Exclude<GuideIntent, null>[]).map((intentId, i) => {
                    const cfg = INTENT_CONFIGS[intentId];
                    return (
                      <motion.div
                        key={intentId}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.05 }}
                        className="group relative flex flex-col gap-1 rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/40 px-3 py-2.5 text-left hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-sm transition-all"
                      >
                        {/* 意圖主體：點擊 → 開啟引導流程 */}
                        <button
                          type="button"
                          className="flex items-center gap-2 w-full"
                          onClick={() => {
                            selectOrbIntent(intentId);
                            openOrbGuide();
                          }}
                        >
                          <span className="text-lg leading-none">{cfg.emoji}</span>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                              {cfg.label}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                              {cfg.description}
                            </p>
                          </div>
                          <Navigation2 className="w-3.5 h-3.5 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </button>
                        {/* 聊天捷徑：點擊 → 在聊天中問這個意圖 */}
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors pl-7"
                          onClick={() => void send(`我想要${cfg.label}`)}
                        >
                          <MessageCircle className="w-3 h-3" />
                          先聊聊這個
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                  或是直接在下方輸入框說說你的想法 ✨
                </p>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* 聊天區 */}
        <div
          ref={scrollRef}
          className="flex-1 min-h-[22rem] max-h-[55vh] overflow-y-auto space-y-3 px-1 scroll-smooth"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={`${msg.at}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-emerald-400 to-sky-400 text-white rounded-2xl rounded-br-md shadow-md"
                      : "bg-white/80 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-md border border-slate-200/60 dark:border-slate-700/60 backdrop-blur"
                  }`}
                >
                  {msg.intent && msg.role === "orb" && (
                    <div className="mb-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      💭 {msg.intent}
                    </div>
                  )}
                  {msg.text}
                </div>
              </motion.div>
            ))}
            {isSending && (
              <motion.div
                key="typing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-start"
              >
                <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 text-sm flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  讓我想想…
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 快速回覆（對話中途的建議） */}
        {!isFirstTurn && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => void send(s)}
                disabled={isSending}
                className="text-xs px-3 py-1.5 rounded-full bg-white/80 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:border-emerald-200 dark:hover:border-emerald-500/40 transition disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {/* 學習中心捷徑（對話中途顯示） */}
        {!isFirstTurn && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              想系統化學習 📚
            </p>
            <button
              type="button"
              onClick={() => setLocation("/learn")}
              className="text-[11px] px-2 py-1 rounded-md border border-slate-200/70 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
            >
              學習文件中心
            </button>
          </div>
        )}

        {/* 輸入列 */}
        <div className="sticky bottom-4 flex items-center gap-2 bg-white/90 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200/70 dark:border-slate-700/60 shadow-lg p-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isSending}
            placeholder="說一句話就好…"
            className="flex-1 bg-transparent outline-none px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
          />
          <Button
            onClick={() => void send(input)}
            disabled={!input.trim() || isSending}
            size="sm"
            className="bg-gradient-to-r from-emerald-400 to-sky-400 hover:from-emerald-500 hover:to-sky-500 text-white border-0 shadow-md disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
          隨時可以關掉這一頁、換地方、反悔。這裡沒有進度條在追你 ✨
        </p>
      </div>
    </div>
  );
}
