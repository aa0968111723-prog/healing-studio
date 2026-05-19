/**
 * OrbUnifiedAssistant.tsx — 全站光球助理（in-orb，不跳頁）
 *
 * 把這五項全站功能塞進光球面板，使用者不離開當前頁面就能用：
 *   1. 個人提示詞與參考提示詞（promptLibrary.list / listPublic）
 *   2. 專注流（重用 FocusFlowMini）
 *   3. 代理聊天（直接調用 GlobalOrbChatContext.sendMessage，inline 顯示對話）
 *   4. 積分試算（credits.pricingCatalog + credits.myBalance + accountant.estimate）
 *   5. 該頁資訊查詢與學習資訊（appRegistry 的 description / orbHints / quickActions
 *      + 一鍵丟學習問題給光球）
 *
 * 設計原則：
 *   - 純 inline UI：不 navigate、不 toast 跳頁、不 redirect
 *   - 所有副作用都走既有的 context / tRPC，避免重複實作
 *   - 五個分頁 lazy 計算，未開的 tab 不發 tRPC 請求（query enabled）
 */

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  Coins,
  Globe2,
  Leaf,
  MessageCircle,
  Lightbulb,
  Search,
  Star,
  Copy,
  Send,
  Loader2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { getPageByPath } from "@/config/appRegistry";
import { useFocusFlow } from "@/contexts/FocusFlowContext";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import FocusFlowMini from "./FocusFlowMini";

// ─── Types ────────────────────────────────────────────────────────────────

export type UnifiedTab = "prompts" | "focus" | "chat" | "credits" | "page";

interface Props {
  fullscreen?: boolean;
  /** 初始預設打開哪一個 sub-tab。預設 "page"（本頁資訊），最不需要登入 */
  initialTab?: UnifiedTab;
  /** 關閉整個面板（給 X 按鈕用，可選） */
  onClose?: () => void;
}

const TABS: { key: UnifiedTab; label: string; icon: typeof Lightbulb }[] = [
  { key: "page", label: "本頁", icon: Globe2 },
  { key: "prompts", label: "提示詞", icon: Lightbulb },
  { key: "chat", label: "對話", icon: MessageCircle },
  { key: "focus", label: "專注流", icon: Leaf },
  { key: "credits", label: "積分", icon: Coins },
];

// ─── Main Component ───────────────────────────────────────────────────────

export default function OrbUnifiedAssistant({
  fullscreen = false,
  initialTab = "page",
}: Props) {
  const [tab, setTab] = useState<UnifiedTab>(initialTab);

  const baseTextSize = fullscreen ? "text-sm" : "text-xs";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar — 五顆並排，等寬 */}
      <div
        className={cn(
          "shrink-0 grid grid-cols-5 gap-1 px-2 pb-2",
          fullscreen ? "pt-1" : "pt-1"
        )}
      >
        {TABS.map(t => {
          const active = t.key === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                fullscreen ? "text-[11px]" : "text-[10px]",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/45 hover:text-white/80 hover:bg-white/6"
              )}
            >
              <Icon className={fullscreen ? "w-4 h-4" : "w-3.5 h-3.5"} />
              <span className="leading-none">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10",
          fullscreen ? "px-4 pb-4" : "px-3 pb-3"
        )}
      >
        <AnimatePresence mode="wait">
          {tab === "page" && (
            <motion.div
              key="page"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <PageInfoPanel
                fullscreen={fullscreen}
                baseTextSize={baseTextSize}
              />
            </motion.div>
          )}
          {tab === "prompts" && (
            <motion.div
              key="prompts"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <PromptsPanel fullscreen={fullscreen} />
            </motion.div>
          )}
          {tab === "chat" && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <InlineChatPanel fullscreen={fullscreen} />
            </motion.div>
          )}
          {tab === "focus" && (
            <motion.div
              key="focus"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="rounded-2xl bg-white/4 border border-white/10"
            >
              {/* FocusFlowMini 預設亮底，要包個深色容器讓它在光球面板裡讀起來舒服 */}
              <div className="orb-unified-focus-skin">
                <FocusFlowMini />
              </div>
            </motion.div>
          )}
          {tab === "credits" && (
            <motion.div
              key="credits"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <CreditsPanel fullscreen={fullscreen} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Sub-panel: 本頁資訊與學習 ─────────────────────────────────────────────

function PageInfoPanel({
  fullscreen,
  baseTextSize,
}: {
  fullscreen: boolean;
  baseTextSize: string;
}) {
  const [locationPath] = useLocation();
  const globalChat = useGlobalOrbChat();
  const page = useMemo(() => getPageByPath(locationPath), [locationPath]);

  const handleAsk = useCallback(
    (prompt: string) => {
      globalChat.open();
      void globalChat.sendMessage(prompt);
      toast.success("已送進對話，切到「對話」分頁看光球回覆 ✨");
    },
    [globalChat]
  );

  return (
    <div className={cn("space-y-2.5", baseTextSize, "text-white/85")}>
      {/* 頁面卡 */}
      <div className="rounded-2xl border border-white/12 bg-white/5 p-3">
        <div className="flex items-start gap-2">
          <Globe2 className="w-4 h-4 mt-0.5 text-cyan-200/80 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-white">
              {page?.label ?? "目前頁面"}
            </p>
            <p className="text-[11px] text-white/50 mt-0.5 break-all">
              {locationPath}
            </p>
            {page?.description && (
              <p className="text-[12px] text-white/70 mt-1.5 leading-relaxed">
                {page.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 學習提示 / orbHints */}
      {page?.orbHints?.length ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/8 p-3">
          <p className="text-[11px] font-medium text-amber-100/90 mb-1.5 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            這頁可以這樣問光球
          </p>
          <div className="space-y-1.5">
            {page.orbHints.map((hint, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleAsk(hint)}
                className="w-full text-left rounded-lg border border-white/8 bg-white/5 hover:bg-white/12 px-2.5 py-2 text-[12px] text-white/85 leading-snug transition-colors"
              >
                <span className="text-amber-200/70 mr-1">💬</span>
                {hint}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 快速動作 / quickActions */}
      {page?.quickActions?.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/45 px-1">這頁可以這樣開始</p>
          {page.quickActions.map(qa => (
            <button
              key={qa.id}
              type="button"
              onClick={() => {
                if (qa.prompt) {
                  handleAsk(qa.prompt);
                } else {
                  handleAsk(`告訴我${qa.label}怎麼用，並列出步驟。`);
                }
              }}
              className="w-full flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/12 px-3 py-2 text-left transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 mt-0.5 text-violet-200/80 shrink-0" />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-white truncate">
                  {qa.label}
                </p>
                {qa.description && (
                  <p className="text-[10px] text-white/55 truncate">
                    {qa.description}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {/* 通用學習問題 — 永遠都有 */}
      <div className="space-y-1.5 pt-1">
        <p className="text-[11px] text-white/45 px-1">學習這頁</p>
        {[
          { label: "這頁有什麼功能？", emoji: "📖" },
          { label: "用一個小例子教我", emoji: "🎓" },
          { label: "我可能會踩到什麼雷？", emoji: "⚠️" },
        ].map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() =>
              handleAsk(
                `關於「${page?.label ?? "目前頁面"}」(${locationPath})：${item.label}`
              )
            }
            className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/12 px-3 py-2 text-left transition-colors"
          >
            <span aria-hidden>{item.emoji}</span>
            <span className="text-[12px] text-white/85">{item.label}</span>
          </button>
        ))}
      </div>

      {!page && (
        <p className="text-[11px] text-white/50 text-center py-4">
          這個頁面還沒登錄到 appRegistry，光球只能用通用問題協助你 ✨
        </p>
      )}
    </div>
  );
}

// ─── Sub-panel: 提示詞（個人 + 參考） ────────────────────────────────────────

function PromptsPanel({ fullscreen }: { fullscreen: boolean }) {
  const [scope, setScope] = useState<"mine" | "reference">("mine");
  const [search, setSearch] = useState("");
  const globalChat = useGlobalOrbChat();

  // 兩支查詢都接受 search；切換 scope 時保留 search 文字
  const mine = trpc.promptLibrary.list.useQuery(
    { page: 1, pageSize: 20, search: search || undefined },
    { enabled: scope === "mine", staleTime: 30_000 }
  );
  const reference = trpc.promptLibrary.listPublic.useQuery(
    { page: 1, pageSize: 20, search: search || undefined },
    { enabled: scope === "reference", staleTime: 60_000 }
  );

  const activeQuery = scope === "mine" ? mine : reference;
  const items = activeQuery.data?.items ?? [];

  const incrementMutation = trpc.promptLibrary.incrementUseCount.useMutation();
  const utils = trpc.useUtils();

  const handleCopy = useCallback(
    async (content: string, id: number) => {
      try {
        await navigator.clipboard.writeText(content);
        toast.success("已複製到剪貼簿");
        // 公開提示詞才有「全站使用次數」這個概念；個人提示詞也記錄一下方便排序
        incrementMutation.mutate(
          { id },
          {
            onSuccess: () => {
              // 順手讓 listPublic 重新排序（依 useCount desc）
              if (scope === "reference") {
                void utils.promptLibrary.listPublic.invalidate();
              }
            },
          }
        );
      } catch {
        toast.error("瀏覽器不允許複製，請手動長按文字選取");
      }
    },
    [incrementMutation, scope, utils]
  );

  const handleApplyToChat = useCallback(
    (content: string, id: number) => {
      globalChat.open();
      globalChat.setInput(content);
      incrementMutation.mutate({ id });
      toast.success("已塞進對話輸入欄，切到「對話」按送出");
    },
    [globalChat, incrementMutation]
  );

  return (
    <div className="space-y-2.5">
      {/* Scope toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/4 p-0.5">
        {(["mine", "reference"] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            aria-pressed={scope === s}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-medium transition-all",
              scope === s
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/85"
            )}
          >
            {s === "mine" ? "個人提示詞" : "參考提示詞"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2.5 py-1.5">
        <Search className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            scope === "mine" ? "搜尋我的提示詞…" : "搜尋公開提示詞…"
          }
          className={cn(
            "flex-1 bg-transparent text-white placeholder:text-white/30 outline-none",
            fullscreen ? "text-sm" : "text-xs"
          )}
          aria-label="搜尋提示詞"
        />
      </div>

      {/* List */}
      <div className="space-y-2">
        {activeQuery.isLoading && (
          <div className="flex items-center justify-center py-6 text-white/40 text-[11px] gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            載入中…
          </div>
        )}

        {activeQuery.isError && (
          <p className="text-[11px] text-rose-200/80 text-center py-4">
            {scope === "mine"
              ? "需要登入才能看個人提示詞"
              : "暫時抓不到參考提示詞，等等再試"}
          </p>
        )}

        {!activeQuery.isLoading && !activeQuery.isError && items.length === 0 && (
          <div className="text-[11px] text-white/55 text-center py-6 space-y-1">
            <p>{scope === "mine" ? "你還沒有個人提示詞" : "沒找到符合的參考提示詞"}</p>
            {scope === "mine" && (
              <p className="text-white/35">
                在創作頁存下喜歡的提示詞，這裡就會出現
              </p>
            )}
          </div>
        )}

        {items.map(item => (
          <div
            key={item.id}
            className="rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/8 transition-colors"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-white truncate flex items-center gap-1.5">
                  {item.isFavorite && (
                    <Star className="w-3 h-3 text-amber-300 fill-amber-300 shrink-0" />
                  )}
                  {item.title}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">
                  {item.category}
                  {item.useCount > 0 && (
                    <span className="ml-2">使用 {item.useCount} 次</span>
                  )}
                </p>
                <p className="text-[11px] text-white/65 mt-1 line-clamp-2 leading-snug whitespace-pre-wrap break-words">
                  {item.content}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => handleCopy(item.content, item.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/8 hover:bg-white/15 text-white/85 px-2 py-1 text-[10px] transition-colors"
                title="複製到剪貼簿"
              >
                <Copy className="w-3 h-3" />
                複製
              </button>
              <button
                type="button"
                onClick={() => handleApplyToChat(item.content, item.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/30 bg-emerald-400/15 hover:bg-emerald-400/25 text-emerald-100 px-2 py-1 text-[10px] transition-colors"
                title="把這條提示詞丟進光球對話"
              >
                <Send className="w-3 h-3" />
                帶到對話
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Sub-panel: Inline 代理聊天 ───────────────────────────────────────────

function InlineChatPanel({ fullscreen }: { fullscreen: boolean }) {
  const globalChat = useGlobalOrbChat();
  const endRef = useRef<HTMLDivElement>(null);
  const messagesCount = globalChat.messages.length;
  const openChat = globalChat.open;

  // 開面板時把 globalChat.isOpen 設成 true，這樣 GlobalOrbChat 的 floating
  // 卡片堆疊（clarification / workflow…）才不會被當成已關閉。只跑一次。
  useEffect(() => {
    openChat();
  }, [openChat]);

  // 訊息有變就 scroll 到底；用「訊息數」當 dep，避免每次 globalChat memo 換手
  // 都觸發 scroll。
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesCount]);

  const handleSend = useCallback(async () => {
    const text = globalChat.input.trim();
    if (!text || globalChat.isSending) return;
    await globalChat.sendMessage(text);
  }, [globalChat]);

  // 只顯示最近 12 則訊息，避免 inline 面板被歷史灌爆；想看完整歷史可以走
  // 既有的 OrbGuidePanel "自由聊天" 分頁，那邊是完整版。
  const visibleMessages = globalChat.messages.slice(-12);

  return (
    <div className="flex flex-col gap-2 h-[60vh] max-h-[480px]">
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10">
        {visibleMessages.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-[12px] text-white/65 leading-relaxed">
            嗨 ✨ 直接告訴我你想做什麼，或是把問題打進來。光球會在這裡回你，
            不用跳頁。
          </div>
        )}
        {visibleMessages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "max-w-[88%] px-3 py-2 rounded-2xl leading-relaxed whitespace-pre-wrap break-words",
                fullscreen ? "text-sm" : "text-[12px]",
                msg.role === "user"
                  ? "bg-white/20 text-white rounded-br-sm"
                  : "bg-white/8 text-white/85 rounded-bl-sm border border-white/10"
              )}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {globalChat.isSending && (
          <div className="flex justify-start">
            <div
              className={cn(
                "px-3 py-2 rounded-2xl rounded-bl-sm bg-white/8 border border-white/10 text-white/55 flex items-center gap-1.5",
                fullscreen ? "text-sm" : "text-xs"
              )}
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              思考中…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer — 跟 OrbGuidePanel 的 chat tab 用同一個 globalChat.input */}
      <div className="shrink-0 flex items-center gap-1.5 rounded-2xl bg-white/8 border border-white/10 px-3 py-2">
        <input
          value={globalChat.input}
          onChange={e => globalChat.setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={fullscreen ? "輸入訊息給光球…" : "說一句話就好…"}
          className={cn(
            "flex-1 bg-transparent text-white placeholder:text-white/30 outline-none",
            fullscreen ? "text-sm" : "text-xs"
          )}
          aria-label="輸入訊息給光球"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!globalChat.input.trim() || globalChat.isSending}
          className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-30 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          aria-label="傳送訊息"
        >
          {globalChat.isSending ? (
            <Loader2 className="w-4 h-4 text-white/70 animate-spin" />
          ) : (
            <Send className="w-4 h-4 text-white/70" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Sub-panel: 積分試算 ─────────────────────────────────────────────────

function CreditsPanel({ fullscreen }: { fullscreen: boolean }) {
  const catalogQuery = trpc.credits.pricingCatalog.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const balanceQuery = trpc.credits.myBalance.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });

  // 攤平所有模型 + 第一層分類，讓使用者能挑模型；預設選第一個
  const flatModels = useMemo(() => {
    if (!catalogQuery.data) return [] as Array<{
      modelId: string;
      label: string;
      category: string;
      basePoints: number;
      unit: string;
    }>;
    const out: Array<{
      modelId: string;
      label: string;
      category: string;
      basePoints: number;
      unit: string;
    }> = [];
    for (const [cat, models] of Object.entries(catalogQuery.data)) {
      for (const m of models) {
        out.push({
          modelId: m.modelId,
          label: m.label,
          category: cat,
          basePoints: m.basePoints,
          unit: m.unit,
        });
      }
    }
    return out;
  }, [catalogQuery.data]);

  const [selectedModelId, setSelectedModelId] = useState<string>("");
  useEffect(() => {
    if (!selectedModelId && flatModels[0]) {
      setSelectedModelId(flatModels[0].modelId);
    }
  }, [flatModels, selectedModelId]);

  const selectedModel = useMemo(
    () => flatModels.find(m => m.modelId === selectedModelId),
    [flatModels, selectedModelId]
  );

  // 三個常用變數，依模型 unit 顯示對應欄位
  const [durationSec, setDurationSec] = useState<number>(5);
  const [charCount, setCharCount] = useState<number>(200);
  const [imageCount, setImageCount] = useState<number>(1);

  const unit = selectedModel?.unit ?? "";
  const showDuration = unit.includes("second") || unit.includes("video");
  const showChars = unit.includes("char") || unit.includes("text");
  const showImages = unit.includes("image") || unit === "per-image";

  const estimateQuery = trpc.accountant.estimate.useQuery(
    {
      modelId: selectedModelId,
      durationSec: showDuration ? durationSec : undefined,
      charCount: showChars ? charCount : undefined,
      imageCount: showImages ? imageCount : undefined,
    },
    {
      enabled: !!selectedModelId,
      staleTime: 10_000,
    }
  );

  const balance = balanceQuery.data;
  const estimate = estimateQuery.data;
  const estimatedPoints = estimate?.totalPoints;

  return (
    <div className="space-y-2.5">
      {/* 個人餘額 */}
      <div className="rounded-2xl border border-white/12 bg-gradient-to-br from-emerald-400/12 to-cyan-400/8 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-white/45">
              我的餘額
            </p>
            <p className={cn("font-bold text-white tabular-nums", fullscreen ? "text-2xl" : "text-xl")}>
              {balanceQuery.isLoading
                ? "…"
                : balanceQuery.isError
                  ? "需登入"
                  : (balance?.remaining ?? 0).toLocaleString()}
              <span className="text-[11px] font-normal text-white/55 ml-1">pts</span>
            </p>
          </div>
          {balance?.topModel && (
            <div className="text-right">
              <p className="text-[10px] text-white/45">近 30 天最常用</p>
              <p className="text-[11px] text-white/85 truncate max-w-[120px]">
                {balance.topModel}
              </p>
            </div>
          )}
        </div>
        {balance && balance.usedPct > 0 && (
          <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-emerald-300/80"
              style={{ width: `${Math.min(100, balance.usedPct)}%` }}
            />
          </div>
        )}
      </div>

      {/* 模型選擇 */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
        <label className="block">
          <span className="text-[11px] text-white/55 mb-1 block">模型</span>
          <select
            value={selectedModelId}
            onChange={e => setSelectedModelId(e.target.value)}
            className={cn(
              "w-full rounded-lg bg-white/8 border border-white/12 text-white px-2 py-1.5 outline-none focus:border-white/25",
              fullscreen ? "text-sm" : "text-xs"
            )}
          >
            {catalogQuery.isLoading && <option>載入中…</option>}
            {flatModels.length === 0 && !catalogQuery.isLoading && (
              <option>找不到任何模型</option>
            )}
            {/* 用 category 分組 — 同 category 的模型放一起 */}
            {Array.from(new Set(flatModels.map(m => m.category))).map(cat => (
              <optgroup key={cat} label={cat} className="bg-neutral-900 text-white">
                {flatModels
                  .filter(m => m.category === cat)
                  .map(m => (
                    <option key={m.modelId} value={m.modelId} className="bg-neutral-900">
                      {m.label}（{m.basePoints} pts/{m.unit}）
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        {/* 動態欄位 */}
        {showDuration && (
          <NumberRow
            label="影片秒數"
            value={durationSec}
            onChange={setDurationSec}
            min={1}
            max={60}
            suffix="秒"
            fullscreen={fullscreen}
          />
        )}
        {showChars && (
          <NumberRow
            label="文字字數"
            value={charCount}
            onChange={setCharCount}
            min={1}
            max={5000}
            step={50}
            suffix="字"
            fullscreen={fullscreen}
          />
        )}
        {showImages && (
          <NumberRow
            label="生成張數"
            value={imageCount}
            onChange={setImageCount}
            min={1}
            max={20}
            suffix="張"
            fullscreen={fullscreen}
          />
        )}
        {!showDuration && !showChars && !showImages && selectedModel && (
          <p className="text-[10px] text-white/40 leading-relaxed">
            這個模型用 <span className="text-white/70">{unit}</span> 計費，沒有可調整參數。
          </p>
        )}
      </div>

      {/* 試算結果 */}
      <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3">
        <p className="text-[10px] uppercase tracking-wider text-amber-100/70">
          本次預估
        </p>
        <div className="flex items-baseline gap-1.5 mt-1">
          {estimateQuery.isLoading ? (
            <span className="text-white/55 text-sm">計算中…</span>
          ) : estimateQuery.isError ? (
            <span className="text-rose-200/80 text-sm">無法估算</span>
          ) : (
            <>
              <span className={cn("font-bold text-amber-50 tabular-nums", fullscreen ? "text-3xl" : "text-2xl")}>
                {estimatedPoints != null
                  ? Number(estimatedPoints).toLocaleString()
                  : "—"}
              </span>
              <span className="text-[11px] text-amber-100/70">pts</span>
            </>
          )}
        </div>
        {estimate?.breakdown && (
          <p className="text-[10px] text-amber-100/60 mt-1 leading-snug">
            {estimate.breakdown}
          </p>
        )}
        {balance && estimatedPoints != null && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px]">
            {balance.remaining >= Number(estimatedPoints) ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                <span className="text-emerald-200/85">
                  餘額足夠（剩 {(balance.remaining - Number(estimatedPoints)).toLocaleString()} pts）
                </span>
              </>
            ) : (
              <span className="text-rose-200/85">
                ⚠️ 餘額不足，差 {(Number(estimatedPoints) - balance.remaining).toLocaleString()} pts
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  fullscreen,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  fullscreen: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] text-white/55 shrink-0 w-16">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-emerald-300"
      />
      <span
        className={cn(
          "tabular-nums text-white/85 text-right shrink-0 w-12",
          fullscreen ? "text-sm" : "text-xs"
        )}
      >
        {value}
        {suffix && <span className="text-white/45 ml-0.5">{suffix}</span>}
      </span>
    </label>
  );
}
