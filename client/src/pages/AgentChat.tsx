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
import {
  Send,
  Loader2,
  ArrowRight,
  Navigation2,
  MessageCircle,
  ChevronDown,
  Clock3,
  Paperclip,
  X,
  Settings2,
  Sparkles,
  Eraser,
  Workflow,
  ListChecks,
  CornerUpRight,
  HelpCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePersonality } from "@/contexts/PersonalityContext";
import VisualSoul from "@/components/VisualSoul";
import {
  parseLLMActions,
  usePageAgent,
  useRegisterPageAgent,
  type AgentAction,
} from "@/contexts/PageAgentContext";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getAgentHomeEntries } from "@/config/appRegistry";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { inferSuggestionEmoji } from "@/lib/orbChatHelpers";
import { useOrbAttachments, attachmentKindEmoji } from "@/hooks/useOrbAttachments";
import { ORB_UPLOAD_ACCEPT } from "../../../shared/orb-chat-multimodal";
import { toast } from "sonner";
import AgentSettingsSheet from "@/components/AgentSettingsSheet";
import ChatMessageText from "@/components/ChatMessageText";

// ─── 型別 ─────────────────────────────────────────────────────────────────

type ChatRole = "user" | "orb";
interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
  /** 光球此輪附上的意圖摘要（若有） */
  intent?: string;
}

type StarterQuickAction = {
  id: string;
  label: string;
  description: string;
  path?: string;
  action?: AgentAction;
  prompt?: string;
};

type StarterEntry = {
  id: string;
  label: string;
  path: string;
  description: string;
  group: "create" | "train" | "project" | "assets" | "learn" | "orb" | "settings" | "admin";
  quickAction?: StarterQuickAction;
  quickActions: StarterQuickAction[];
  prompt?: string;
  starterText: string;
};

// ─── 依人格挑選柔軟的開場問候 ───────────────────────────────────────────

const GREETINGS: Record<string, string[]> = {
  calm: [
    "嗨 🌿 我是光球。先跟我說想完成的成果、要用在哪裡，我會陪你慢慢找到對的入口。",
    "歡迎來到這裡 ✨ 有什麼想做的嗎？告訴我目標、手上素材或限制，我一步步帶你。",
  ],
  creative: [
    "嗨！我是光球 🌸 今天腦海裡想生成什麼？用在什麼場合？告訴我一些線索，我幫你配好流程。",
    "你來啦 ✨ 先說說想要的成品、風格或靈感來源，我會問幾個小問題，帶你去對的頁面試做看。",
  ],
  technical: [
    "嗨，我是光球 🌿 告訴我想要的輸出、用途與手邊素材，我幫你挑模型、參數和頁面。",
    "歡迎 ✨ 先說需求與限制（格式、時長、設備），我會拆解成步驟並引導操作。",
  ],
};

const AGENT_HOME_ENTRIES = getAgentHomeEntries();

const NEED_CLUES = [
  "想要的成品與用途（平台/受眾/格式）",
  "尺寸/長寬比/時長/檔案格式",
  "手上已有的素材或參考（圖片、影片、腳本、聲音）",
  "限制條件（設備、時間、風格偏好、點數預算）",
];

/**
 * 「如何使用」分步說明 — 在第一輪對話前展開，告訴使用者怎麼跟光球互動，
 * 才不會打開頁面只看到一句「先聊聊看就好」就不知道下一步要做什麼。
 */
const HOW_TO_STEPS: Array<{ title: string; description: string }> = [
  {
    title: "1. 用一句話告訴光球目標",
    description:
      "直接打字、貼圖、附素材都可以。例：「我要做 30 秒 IG Reels 預告，已有 3 張產品照」。",
  },
  {
    title: "2. 回答光球的反問",
    description:
      "光球會先問尺寸、風格、限制 — 模糊的地方它會繼續確認，不會自己亂猜。",
  },
  {
    title: "3. 看到「意圖卡」再決定要不要動",
    description:
      "送出、套預設、跨頁這類動作會先彈卡片給你看。確認沒問題再按，光球才會真的執行。",
  },
  {
    title: "4. 點下方意圖卡跳到對的工具頁",
    description:
      "「圖片 / 影片 / 音樂 / 配音 / 腳本 / LoRA」按下去會帶你到對應頁，光球會繼續陪你完成。",
  },
  {
    title: "5. 隨時叫光球幫你跑長期任務",
    description:
      "右上角「代理設定」可以開排程，例如「每天早上整理昨日生成紀錄」— 光球會自己跑、出事再叫你。",
  },
];

const NEED_PROMPTS = [
  "我想做 ______，要用在 ______。目前有／沒有素材 ______，限制是 ______。請幫我決定先去哪個頁面並帶我做第一步。",
  "我想把這張圖做成影片，最終想在 IG Reels 用。幫我安排流程、比例與模型，先帶我去適合的頁面。",
  "我要做一支 ______ 秒的影片，受眾是 ______。我有的素材：______。請問要先去哪裡、按哪些按鈕？",
];

function buildStarterEntry(page: (typeof AGENT_HOME_ENTRIES)[number]): StarterEntry {
  const primaryQuickAction = page.quickActions[0];
  return {
    id: page.id,
    label: page.label,
    path: page.path,
    description: page.description,
    group: page.group,
    quickAction: primaryQuickAction
      ? {
          id: primaryQuickAction.id,
          label: primaryQuickAction.label,
          description: primaryQuickAction.description,
          path: primaryQuickAction.path,
          action: primaryQuickAction.action,
          prompt: primaryQuickAction.prompt,
        }
      : undefined,
    quickActions: page.quickActions.map(action => ({
      id: action.id,
      label: action.label,
      description: action.description,
      path: action.path,
      action: action.action,
      prompt: action.prompt,
    })),
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

  // ─── Global Orb Chat Integration ──────────────────────────────────────
  const globalChat = useGlobalOrbChat();

  // Ref to hold the latest `send` for use in handler (avoids stale closures)
  const sendRef = useRef<(raw: string) => Promise<void>>(undefined);

  // ── 把 /agent 本身也登記成一個 PageAgent 頁面 ──────────────────────
  //
  // 這頁自己的能力包括「帶你去別頁」和「搜尋」——
  // 其他結構化動作留給目的地頁面的 handler（透過 pending queue 傳遞）。
  useRegisterPageAgent({
    pageId: "agent-chat",
    pageLabel: "全站光球代理",
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
  // Use global chat state instead of local state
  const messages = globalChat.messages;
  const input = globalChat.input;
  const setInput = globalChat.setInput;
  const isSending = globalChat.isSending;
  const suggestions = globalChat.suggestions.map(s => s.text);
  const setSuggestions = (_newSuggestions: string[]) => {
    // Global chat manages suggestions internally
  };
  const [needGuideOpen, setNeedGuideOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const starterEntries = useMemo(
    () =>
      AGENT_HOME_ENTRIES
        .filter(page => page.id !== "home")
        .slice(0, 9)
        .map(buildStarterEntry),
    []
  );
  const groupedStarterEntries = useMemo(
    () => ({
      create: starterEntries.filter(entry => entry.group === "create"),
      assets: starterEntries.filter(entry => entry.group === "assets"),
      train: starterEntries.filter(entry => entry.group === "train"),
    }),
    [starterEntries]
  );

  const {
    attachments,
    isUploading,
    fileInputRef,
    pickAttachment,
    removeAttachment,
    clearAttachments,
    handleFiles,
  } = useOrbAttachments(message => toast.error(message));

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // Open global chat when this page loads
  useEffect(() => {
    globalChat.open();
  }, [globalChat]);

  // ─── 模式工具列：點亮後送出時把模式作為結構化 metadata 傳給 sendMessage。
  // 不再把長段中文指令塞到使用者的 prompt 前面 — 使用者打的字就是聊天紀錄
  // 看到的字。每個模式的行為由程式直接處理（navigate / ask-feature 走純客
  // 端捷徑；plan / multi-step 走 LLM 但用 context 帶模式提示）。
  const modeOptions = useMemo(
    () => [
      {
        id: "multi-step" as const,
        label: "多步驟代理",
        shortLabel: "自動",
        description: "全自動拆解工作流程並執行",
        accent: "violet" as const,
        icon: Workflow,
        defaultPrompt: "幫我把這件事拆成完整流程並自動執行到完成。",
        placeholder: "說一句目標，光球會自動拆步驟…",
      },
      {
        id: "plan" as const,
        label: "計畫",
        shortLabel: "計畫",
        description: "先擬一份可執行的計畫",
        accent: "emerald" as const,
        icon: ListChecks,
        defaultPrompt: "幫我擬一份可執行的計畫。",
        placeholder: "說一個想完成的目標，光球先擬計畫…",
      },
      {
        id: "navigate" as const,
        label: "跳頁",
        shortLabel: "跳頁",
        description: "幫我帶到對應的功能頁面",
        accent: "sky" as const,
        icon: CornerUpRight,
        defaultPrompt: "帶我去合適的功能頁。",
        placeholder: "想去哪個工具頁？描述一下…",
      },
      {
        id: "ask-feature" as const,
        label: "功能詢問",
        shortLabel: "功能",
        description: "問光球這個站有什麼功能",
        accent: "amber" as const,
        icon: HelpCircle,
        defaultPrompt: "這個站目前有哪些功能可以用？",
        placeholder: "想知道哪個功能？問我吧…",
      },
    ],
    []
  );

  const activeModeOption = useMemo(
    () => modeOptions.find(option => option.id === activeMode) ?? null,
    [activeMode, modeOptions]
  );

  const toggleMode = useCallback((modeId: string) => {
    setActiveMode(prev => (prev === modeId ? null : modeId));
  }, []);

  // ─── 送出訊息 ───────────────────────────────────────────────────────
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if ((!text && attachments.length === 0) || isSending) return;
      // 使用者打什麼，聊天紀錄就顯示什麼。模式以 requestedMode 結構化欄位
      // 傳遞，由 GlobalOrbChatContext 內的 hard-coded 邏輯接手 — 不再注入
      // 一段中文 instruction 蓋掉使用者原文。
      const promptToSend = text || activeModeOption?.defaultPrompt || "";
      await globalChat.sendMessage(promptToSend, attachments, {
        requestedMode: activeModeOption?.id,
      });
      clearAttachments();
      // 送出後自動關閉模式，避免下一句又意外帶到模式上下文。
      if (activeModeOption) setActiveMode(null);
    },
    [isSending, globalChat, attachments, clearAttachments, activeModeOption]
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
  const handleStarterQuickAction = useCallback(
    async (entry: StarterEntry, action: StarterQuickAction) => {
      if (action.path && action.path !== "/agent") {
        setLocation(action.path);
      }
      if (action.action) {
        await pageAgent.dispatch(action.action, { source: "manual" });
      }
      if (action.prompt) {
        await send(action.prompt);
        return;
      }
      await send(`請帶我在「${entry.label}」處理「${action.label}」。`);
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

      <div className="w-full max-w-2xl flex-1 flex flex-col px-4 sm:px-6 py-6 sm:py-8 gap-4 relative">
        {/* 右上角：低頻工具（清除對話 / 代理設定）做成圖示，不搶版面 */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1 z-10">
          <button
            type="button"
            onClick={() => {
              if (messages.length === 0) {
                globalChat.resetConversation();
                toast.success("已重新開始對話");
                return;
              }
              if (
                window.confirm(
                  `確定要清除這段對話嗎？目前有 ${messages.length} 則訊息會被刪除（不影響排程與設定）。`
                )
              ) {
                globalChat.resetConversation();
                toast.success("對話已清除，重新開始");
              }
            }}
            disabled={isSending}
            title="清除對話"
            aria-label="清除目前的光球對話"
            data-testid="clear-chat-trigger"
            className="p-1.5 rounded-lg text-slate-400 hover:text-destructive hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <Eraser className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="代理設定"
            aria-haspopup="dialog"
            data-testid="agent-settings-trigger"
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {/* 開場區塊 */}
        <div className="flex flex-col items-center text-center gap-3">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <VisualSoul size="lg" personality={personality} />
          </motion.div>
          <h1 className="text-xl sm:text-2xl font-medium text-slate-800 dark:text-slate-100">
            先聊聊看就好 🌿
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
            我會先問幾個關鍵問題（目標、用途、素材、限制），幫你定位到正確的頁面，並一步步告訴你怎麼做。
          </p>

          {/* 主要輔助按鈕：如何使用光球（單一） */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHowToOpen(prev => !prev)}
            className="h-8 px-3 text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            aria-expanded={howToOpen}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            如何使用光球
            <ChevronDown
              className={`w-3 h-3 transition-transform ${howToOpen ? "rotate-180" : ""}`}
            />
          </Button>

          {/* 如何使用 — 分步說明 */}
          <AnimatePresence initial={false}>
            {howToOpen && (
              <motion.div
                key="how-to"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="w-full mt-1 overflow-hidden"
              >
                <div className="rounded-2xl border border-emerald-200/70 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-900/10 px-4 py-3 text-left space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      五步學會用光球
                    </p>
                  </div>
                  <ol className="space-y-2">
                    {HOW_TO_STEPS.map(step => (
                      <li
                        key={step.title}
                        className="flex flex-col gap-0.5 rounded-lg bg-white/70 dark:bg-slate-900/30 border border-emerald-100/80 dark:border-emerald-700/30 px-3 py-2"
                      >
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          {step.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {step.description}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void send("我是新手，請用 30 秒帶我認識這個聊天頁的用法。")}
                      className="text-[11px] px-2 py-1 rounded-full border border-emerald-300/70 text-emerald-700 hover:bg-emerald-100/60 transition-colors"
                    >
                      🚀 讓光球親自示範
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocation("/learn")}
                      className="text-[11px] px-2 py-1 rounded-full border border-slate-200/80 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
                    >
                      📚 看完整文件
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 需求釐清提示 */}
          <div className="w-full mt-3 sm:mt-4">
            <Collapsible
              open={needGuideOpen}
              onOpenChange={setNeedGuideOpen}
              className="rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/40 px-4 py-3 text-left shadow-sm"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2"
                >
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    提前告訴我這些，導引會更精準
                  </p>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${needGuideOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {NEED_CLUES.map(item => (
                    <span
                      key={item}
                      className="text-[11px] px-2 py-1 rounded-full border border-slate-200/80 dark:border-slate-700/70 text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/50"
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {NEED_PROMPTS.map((template, i) => (
                    <Button
                      key={template}
                      variant="outline"
                      size="sm"
                      className="text-[11px] h-8 px-3 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                      onClick={() => void send(template)}
                    >
                      示範 {i + 1}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          {/* ── 第一輪：意圖選擇 grid（主要 CTA） ── */}
          {isFirstTurn && (
            <AnimatePresence>
              <motion.div
                key="intent-grid"
                className="w-full mt-1 space-y-3"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  你想做什麼？選一個，光球會先釐清需求，再帶你去對的地方：
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
                        className="group relative flex items-center gap-2 rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/70 dark:bg-slate-900/40 pl-3 pr-1 py-2 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-sm transition-all"
                      >
                        {/* 意圖主體：點擊 → 開啟引導流程 */}
                        <button
                          type="button"
                          className="flex items-center gap-2 flex-1 min-w-0 text-left py-0.5"
                          onClick={() => {
                            selectOrbIntent(intentId);
                            openOrbGuide();
                          }}
                        >
                          <span className="text-lg leading-none shrink-0">{cfg.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                              {cfg.label}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {cfg.description}
                            </p>
                          </div>
                          <Navigation2 className="w-3.5 h-3.5 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </button>
                        {/* 次要：先聊聊這個（小圖示） */}
                        <button
                          type="button"
                          title={`先聊聊「${cfg.label}」`}
                          aria-label={`先聊聊 ${cfg.label}`}
                          className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors"
                          onClick={() => void send(`我想要${cfg.label}`)}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>

                {/* 進階：全部頁面入口（深度整合）— 預設收合，避免一次塞太多 */}
                <Collapsible className="rounded-xl border border-slate-200/70 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/30">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 group"
                    >
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        瀏覽全部頁面入口（含參數、素材、模型子項目）
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-2.5 pb-2.5 pt-0 space-y-2">
                    {([
                      ["create", "創作工作流"],
                      ["assets", "素材 / 模型整合"],
                      ["train", "訓練流程"],
                    ] as const).map(([groupKey, groupLabel]) => {
                      const entries = groupedStarterEntries[groupKey];
                      if (!entries.length) return null;
                      return (
                        <div key={groupKey} className="space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 px-1">
                            {groupLabel}
                          </p>
                          <div className="space-y-1.5">
                            {entries.map(entry => (
                              <div
                                key={entry.id}
                                className="rounded-lg border border-slate-200/70 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/40 p-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => void handleStarterEntryClick(entry)}
                                  className="w-full flex items-center justify-between gap-2 text-left"
                                >
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                                      {entry.label}
                                    </p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                      {entry.description}
                                    </p>
                                  </div>
                                  <ArrowRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                </button>
                                {entry.quickActions.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {entry.quickActions.slice(0, 3).map(action => (
                                      <button
                                        type="button"
                                        key={action.id}
                                        onClick={() =>
                                          void handleStarterQuickAction(entry, action)
                                        }
                                        className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-200/80 text-emerald-700 bg-emerald-50/70 hover:bg-emerald-100/80 transition-colors"
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
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
                  <ChatMessageText
                    text={msg.text}
                    linkClassName={
                      msg.role === "user"
                        ? "underline decoration-white/60 underline-offset-2 hover:text-white inline-flex items-center gap-0.5"
                        : "underline decoration-cyan-400 underline-offset-2 text-cyan-700 hover:text-cyan-800 inline-flex items-center gap-0.5"
                    }
                  />
                  {msg.attachments?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.attachments.map(attachment => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            msg.role === "user"
                              ? "border-white/30 bg-white/15 text-white hover:bg-white/25"
                              : "border-slate-200/70 bg-slate-50/70 text-slate-600 hover:bg-slate-100 dark:border-slate-600/60 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:bg-slate-700/70"
                          }`}
                        >
                          <span>{attachmentKindEmoji(attachment.kind)}</span>
                          <span className="truncate max-w-[200px]">{attachment.name}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {msg.webSources?.length ? (
                    <div className="mt-2 border-t border-slate-200/40 dark:border-slate-700/40 pt-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        來源 · Sources
                      </div>
                      {msg.webSources.map((src, idx) => (
                        <a
                          key={`${src.url}-${idx}`}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block text-[11px] text-cyan-700 dark:text-cyan-300 hover:underline truncate"
                          title={src.url}
                        >
                          {idx + 1}. {src.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-1.5 text-[10px] opacity-60 flex items-center gap-1">
                    <Clock3 className="w-3 h-3" />
                    {new Date(msg.at).toLocaleTimeString("zh-TW", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
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

        {/* 快速回覆（對話中途的反問建議）— 用快選圖卡呈現，比小膠囊更好讀 */}
        {!isFirstTurn && suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400 dark:text-slate-500 px-1">
              快選回應 ✨
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.map(s => {
                const emoji = inferSuggestionEmoji(s);
                return (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={isSending}
                    className="group flex items-start gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white/85 dark:bg-slate-800/70 px-3 py-2.5 text-left shadow-sm backdrop-blur hover:border-emerald-300 hover:bg-emerald-50/70 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-900/30 disabled:opacity-50 transition-all"
                  >
                    <span className="text-base leading-none mt-0.5 shrink-0">{emoji}</span>
                    <span className="text-xs leading-snug text-slate-700 dark:text-slate-200 line-clamp-3">
                      {s}
                    </span>
                  </button>
                );
              })}
            </div>
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
        <div className="sticky bottom-4 space-y-2">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
              {attachments.map(attachment => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  title="移除附件"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm hover:bg-white dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-200"
                >
                  <span>{attachmentKindEmoji(attachment.kind)}</span>
                  <span className="max-w-[160px] truncate">{attachment.name}</span>
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={ORB_UPLOAD_ACCEPT}
            multiple
            className="hidden"
            onChange={e => {
              void handleFiles(e.target.files);
            }}
          />

          {/* 模式工具列：點下去會亮起來，再輸入自己的提示詞送出即可。 */}
          <div className="flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
            {modeOptions.map(option => {
              const Icon = option.icon;
              const isActive = activeMode === option.id;
              const accentClasses = isActive
                ? {
                    violet:
                      "border-violet-300 bg-violet-100 text-violet-700 shadow-sm shadow-violet-200/60 dark:border-violet-500/60 dark:bg-violet-500/20 dark:text-violet-200",
                    emerald:
                      "border-emerald-300 bg-emerald-100 text-emerald-700 shadow-sm shadow-emerald-200/60 dark:border-emerald-500/60 dark:bg-emerald-500/20 dark:text-emerald-200",
                    sky: "border-sky-300 bg-sky-100 text-sky-700 shadow-sm shadow-sky-200/60 dark:border-sky-500/60 dark:bg-sky-500/20 dark:text-sky-200",
                    amber:
                      "border-amber-300 bg-amber-100 text-amber-700 shadow-sm shadow-amber-200/60 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200",
                  }[option.accent]
                : "border-slate-200/70 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:text-slate-200";
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleMode(option.id)}
                  disabled={isSending}
                  aria-pressed={isActive}
                  title={option.description}
                  className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all disabled:opacity-40 ${accentClasses}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{option.label}</span>
                  {isActive && (
                    <span
                      aria-hidden
                      className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* 已點亮模式的提示條：清楚告訴使用者「現在輸入會以這個模式送出」 */}
          {activeModeOption && (
            <motion.div
              key={activeModeOption.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-900/20 px-3 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 truncate">
                  目前模式：<span className="font-semibold">{activeModeOption.label}</span>
                  <span className="opacity-70"> · {activeModeOption.description}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveMode(null)}
                className="text-[11px] text-emerald-700/70 hover:text-emerald-800 dark:text-emerald-300/70 dark:hover:text-emerald-200 shrink-0"
              >
                取消
              </button>
            </motion.div>
          )}

          <div className="flex items-center gap-2 bg-white/90 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200/70 dark:border-slate-700/60 shadow-lg p-2">
            <button
              type="button"
              onClick={pickAttachment}
              disabled={isSending || isUploading}
              title="上傳圖片 / 影片 / 音訊 / PDF"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-40 transition-colors"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={isSending}
              placeholder={activeModeOption?.placeholder ?? "說一句話就好…"}
              className="flex-1 bg-transparent outline-none px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
            />
            <Button
              onClick={() => void send(input)}
              disabled={(!input.trim() && attachments.length === 0 && !activeModeOption) || isSending || isUploading}
              size="sm"
              className="bg-gradient-to-r from-emerald-400 to-sky-400 hover:from-emerald-500 hover:to-sky-500 text-white border-0 shadow-md disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>

      </div>

      <AgentSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
