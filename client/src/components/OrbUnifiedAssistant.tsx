/**
 * OrbUnifiedAssistant.tsx — 全站光球助理（in-orb，全部不跳頁）
 *
 * 把這五項全站功能塞進光球面板，使用者不離開當前頁面就能用：
 *   1. 個人提示詞與參考提示詞（建立 / 編輯 / 刪除 / 收藏 / 套用到當頁）
 *   2. 專注流（番茄鐘 / 療癒呼吸 / 想法收集）
 *   3. 代理聊天（與「自由聊天」共用同一條對話 + clarification / suggestions）
 *   4. 積分試算（餘額 / 估算 / 同類別比價 / 近 30 天用量 / 一鍵切模型）
 *   5. 本頁資訊查詢與學習資訊（描述 / 提示問題 / 快速動作 / Page 即時狀態）
 *
 * 設計原則：
 *   - 絕不 navigate：所有操作走 PageAgent.dispatch / GlobalOrbChat.sendMessage
 *   - 共用既有 tRPC / context，不重複實作
 *   - 未開啟的 sub-tab 不發 tRPC 請求（query enabled gate）
 *   - 對應頁面收不到 action（capability 不支援）時，按鈕會 disable + 顯示原因
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
  Plus,
  Trash2,
  Pencil,
  X,
  Filter,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Target,
  Wand2,
  StickyNote,
  Circle,
  CircleDot,
  CircleCheck,
  Calendar,
  Tag,
  Check,
  CalendarDays,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { trpc } from "@/lib/trpc";
import { getPageByPath } from "@/config/appRegistry";
import { useFocusFlow } from "@/contexts/FocusFlowContext";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { usePageAgent } from "@/contexts/PageAgentContext";
import type { AgentAction, AgentActionType } from "../../../shared/agent-actions";
import FocusFlowMini from "./FocusFlowMini";

// ─── Types ────────────────────────────────────────────────────────────────

export type UnifiedTab = "prompts" | "focus" | "chat" | "credits" | "page" | "notes";

interface Props {
  fullscreen?: boolean;
  /** 初始預設打開哪一個 sub-tab。預設 "page"（本頁資訊） */
  initialTab?: UnifiedTab;
}

const TABS: { key: UnifiedTab; label: string; icon: typeof Lightbulb }[] = [
  { key: "page", label: "本頁", icon: Globe2 },
  { key: "prompts", label: "提示詞", icon: Lightbulb },
  { key: "chat", label: "對話", icon: MessageCircle },
  { key: "focus", label: "專注流", icon: Leaf },
  { key: "credits", label: "積分", icon: Coins },
  { key: "notes", label: "筆記", icon: StickyNote },
];

const PROMPT_CATEGORIES = [
  "general",
  "image",
  "video",
  "audio",
  "voice",
  "story",
  "system",
] as const;
type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

const CATEGORY_LABEL: Record<PromptCategory, string> = {
  general: "通用",
  image: "圖像",
  video: "影片",
  audio: "音樂",
  voice: "配音",
  story: "腳本",
  system: "系統",
};

// ─── Main Component ───────────────────────────────────────────────────────

export default function OrbUnifiedAssistant({
  fullscreen = false,
  initialTab = "page",
}: Props) {
  const [tab, setTab] = useState<UnifiedTab>(initialTab);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar — 五顆並排，等寬 */}
      <div
        className={cn(
          "shrink-0 grid grid-cols-6 gap-0.5 px-2 pt-1 pb-2"
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
              <PageInfoPanel fullscreen={fullscreen} />
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
          {tab === "notes" && (
            <motion.div
              key="notes"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <NotesSchedulePanel fullscreen={fullscreen} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── 共用：可不可以對當前頁面 dispatch 這個 action ─────────────────────────

function usePageCapability(actionType: AgentActionType) {
  const pageAgent = usePageAgent();
  const caps = pageAgent.snapshot?.capabilities ?? [];
  const supports =
    caps.length === 0
      ? false // 沒登記 capabilities 的頁面 = 純資訊頁，不允許 dispatch
      : caps.some(c => c.action === actionType);
  return { pageAgent, supports };
}

// ─── Sub-panel: 本頁資訊與學習 ─────────────────────────────────────────────

function PageInfoPanel({ fullscreen }: { fullscreen: boolean }) {
  const [locationPath] = useLocation();
  const pageAgent = usePageAgent();
  const page = useMemo(() => getPageByPath(locationPath), [locationPath]);
  const snapshot = pageAgent.snapshot;
  const [expandedCapability, setExpandedCapability] = useState<string | null>(null);
  const [showPageDetails, setShowPageDetails] = useState(false);

  const baseTextSize = fullscreen ? "text-sm" : "text-xs";

  // 本頁面板已改成「直接抓取資料」模式：所有按鈕都從 appRegistry / PageAgent
  // snapshot 直接顯示資料或 dispatch 結構化 action，不再透過 globalChat
  // 送訊息給光球代理。

  return (
    <div className={cn("space-y-2.5", baseTextSize, "text-white/85")}>
      {/* 頁面卡 */}
      <div className="rounded-2xl border border-white/12 bg-white/5 p-3">
        <div className="flex items-start gap-2">
          <Globe2 className="w-4 h-4 mt-0.5 text-cyan-200/80 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">
              {page?.label ?? snapshot?.pageLabel ?? "目前頁面"}
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

      {/* Page Agent 即時狀態 — 知道使用者「現在實際上選了什麼」 */}
      {snapshot && (
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/8 p-3 space-y-1.5">
          <p className="text-[11px] font-medium text-emerald-100/90 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5" />
            這頁此刻的狀態
          </p>
          <div className="space-y-1 text-[11px] text-white/80">
            {snapshot.activeModel && (
              <Row label="模型" value={snapshot.activeModel} />
            )}
            {snapshot.activeMode && (
              <Row label="模式" value={snapshot.activeMode} />
            )}
            {snapshot.selectedPreset && (
              <Row label="預設" value={snapshot.selectedPreset} />
            )}
            {snapshot.currentPrompt && (
              <Row
                label="提示詞"
                value={
                  snapshot.currentPrompt.length > 60
                    ? snapshot.currentPrompt.slice(0, 60) + "…"
                    : snapshot.currentPrompt
                }
              />
            )}
            {typeof snapshot.state?.remainingCredits === "number" && (
              <Row
                label="餘額"
                value={`${snapshot.state.remainingCredits.toLocaleString()} pts`}
              />
            )}
            {snapshot.capabilities.length > 0 && (
              <Row
                label="可操作"
                value={snapshot.capabilities
                  .map(c => c.label)
                  .slice(0, 4)
                  .join(" · ")}
              />
            )}
          </div>
          {snapshot.warnings && snapshot.warnings.length > 0 && (
            <div className="rounded-lg bg-amber-300/15 border border-amber-300/30 px-2 py-1.5 mt-1">
              {snapshot.warnings.map((w, i) => (
                <p key={i} className="text-[10px] text-amber-100">
                  ⚠️ {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 學習提示 / orbHints — 直接顯示，不再送進光球對話 */}
      {page?.orbHints?.length ? (
        <div className="rounded-2xl border border-amber-300/20 bg-amber-300/8 p-3">
          <p className="text-[11px] font-medium text-amber-100/90 mb-1.5 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            這頁常見的問題
          </p>
          <ul className="space-y-1 list-none">
            {page.orbHints.map((hint, i) => (
              <li
                key={i}
                className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5 text-[12px] text-white/85 leading-snug"
              >
                <span className="text-amber-200/70 mr-1">💬</span>
                {hint}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 快速動作 / quickActions — 只有結構化 action 會 dispatch，
          純對話 prompt 改成直接顯示資料卡，不再呼叫光球代理 */}
      {page?.quickActions?.length ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/45 px-1">這頁可以這樣開始</p>
          {page.quickActions.map(qa => {
            const dispatchable = !!qa.action;
            return (
              <button
                key={qa.id}
                type="button"
                disabled={!dispatchable}
                onClick={() => {
                  if (!qa.action) return;
                  void pageAgent
                    .dispatch(qa.action, { source: "manual" })
                    .then(r => {
                      if (r.ok) toast.success(`已執行：${qa.label}`);
                      else toast.error(r.reason || "這個動作這頁不支援");
                    });
                }}
                className={cn(
                  "w-full flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                  dispatchable
                    ? "border-white/10 bg-white/5 hover:bg-white/12 cursor-pointer"
                    : "border-white/8 bg-white/3 cursor-default"
                )}
                title={dispatchable ? undefined : "這個項目只有說明，沒有可直接執行的動作"}
              >
                <Sparkles className="w-3.5 h-3.5 mt-0.5 text-violet-200/80 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-white truncate">
                    {qa.label}
                  </p>
                  {qa.description && (
                    <p className="text-[10px] text-white/55 truncate">
                      {qa.description}
                    </p>
                  )}
                </div>
                {dispatchable && (
                  <span className="shrink-0 rounded-full bg-emerald-400/15 border border-emerald-300/30 px-1.5 py-0.5 text-[9px] text-emerald-100">
                    一鍵
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 頁面能力 — 點一下直接展開該能力的說明，不再呼叫光球代理 */}
      {snapshot?.capabilities && snapshot.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/45 px-1 flex items-center gap-1">
            <Wand2 className="w-3 h-3" />
            這頁能調整的東西（點一下看說明）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {snapshot.capabilities.slice(0, 8).map(cap => {
              const active = expandedCapability === cap.action;
              return (
                <button
                  key={cap.action}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setExpandedCapability(active ? null : cap.action)
                  }
                  className={cn(
                    "rounded-full border px-2 py-1 text-[10px] transition-colors",
                    active
                      ? "border-cyan-300/45 bg-cyan-300/25 text-cyan-50"
                      : "border-cyan-300/25 bg-cyan-300/10 hover:bg-cyan-300/20 text-cyan-100"
                  )}
                  title={cap.hint || cap.action}
                >
                  {cap.label}
                </button>
              );
            })}
          </div>
          {expandedCapability && (() => {
            const cap = snapshot.capabilities.find(
              c => c.action === expandedCapability
            );
            if (!cap) return null;
            return (
              <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/8 p-2.5 text-[11px] text-white/85 leading-relaxed space-y-1">
                <p className="font-medium text-cyan-100">{cap.label}</p>
                <p className="text-white/75">
                  {cap.hint || "這個調整在這頁可以使用，但沒有提供額外說明。"}
                </p>
                <p className="text-[10px] text-white/45 font-mono">
                  動作代號：{cap.action}
                  {cap.currentId ? ` · 目前：${cap.currentId}` : ""}
                </p>
                {cap.options && cap.options.length > 0 && (
                  <div className="pt-1">
                    <p className="text-[10px] text-white/45 mb-0.5">可選值</p>
                    <div className="flex flex-wrap gap-1">
                      {cap.options.slice(0, 12).map(opt => (
                        <span
                          key={opt.id}
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[9px]",
                            opt.id === cap.currentId
                              ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
                              : "border-white/12 bg-white/4 text-white/65"
                          )}
                          title={opt.description || opt.label}
                        >
                          {opt.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* 這頁有什麼功能 — 直接展開 appRegistry 裡的頁面說明，不送光球 */}
      {(page || snapshot) && (
        <div className="space-y-1.5 pt-1">
          <button
            type="button"
            aria-expanded={showPageDetails}
            onClick={() => setShowPageDetails(v => !v)}
            className="w-full flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/12 px-3 py-2 text-left transition-colors"
          >
            <span className="text-[12px] text-white/85 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-amber-200/80" />
              這頁有什麼功能
            </span>
            {showPageDetails ? (
              <ChevronDown className="w-3.5 h-3.5 text-white/40" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-white/40" />
            )}
          </button>
          {showPageDetails && (
            <div className="rounded-xl border border-white/8 bg-white/4 p-3 space-y-2 text-[11px] text-white/80">
              {page?.description && (
                <div>
                  <p className="text-white/45 text-[10px] mb-0.5">頁面用途</p>
                  <p className="text-white/85 leading-relaxed">
                    {page.description}
                  </p>
                </div>
              )}
              {page?.aliases && page.aliases.length > 0 && (
                <div>
                  <p className="text-white/45 text-[10px] mb-0.5">別稱</p>
                  <p className="text-white/70">{page.aliases.join("、")}</p>
                </div>
              )}
              {snapshot?.capabilities && snapshot.capabilities.length > 0 && (
                <div>
                  <p className="text-white/45 text-[10px] mb-0.5">可操作項目</p>
                  <p className="text-white/70">
                    {snapshot.capabilities.map(c => c.label).join(" · ")}
                  </p>
                </div>
              )}
              {page?.supportedActions && page.supportedActions.length > 0 && (
                <div>
                  <p className="text-white/45 text-[10px] mb-0.5">支援的結構化動作</p>
                  <p className="text-white/65 font-mono text-[10px] break-all">
                    {page.supportedActions.join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!page && !snapshot && (
        <p className="text-[11px] text-white/50 text-center py-4">
          這個頁面還沒登錄到 appRegistry / PageAgent，沒有可顯示的本頁資料 ✨
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-white/45 shrink-0 w-12 text-[10px]">{label}</span>
      <span className="text-white/85 break-all">{value}</span>
    </div>
  );
}

// ─── Sub-panel: 提示詞（個人 + 參考） ────────────────────────────────────────

function PromptsPanel({ fullscreen }: { fullscreen: boolean }) {
  const [scope, setScope] = useState<"mine" | "reference">("mine");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<PromptCategory | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);

  const globalChat = useGlobalOrbChat();
  const fillPromptCap = usePageCapability("fillPrompt");

  const utils = trpc.useUtils();

  const mine = trpc.promptLibrary.list.useQuery(
    {
      page: 1,
      pageSize: 30,
      search: search || undefined,
      category: category === "all" ? undefined : category,
      favoritesOnly: favoritesOnly || undefined,
    },
    { enabled: scope === "mine", staleTime: 30_000 }
  );
  const reference = trpc.promptLibrary.listPublic.useQuery(
    {
      page: 1,
      pageSize: 30,
      search: search || undefined,
      category: category === "all" ? undefined : category,
    },
    { enabled: scope === "reference", staleTime: 60_000 }
  );

  const activeQuery = scope === "mine" ? mine : reference;
  const items = activeQuery.data?.items ?? [];

  const incrementMutation = trpc.promptLibrary.incrementUseCount.useMutation();
  const toggleFavoriteMutation =
    trpc.promptLibrary.toggleFavorite.useMutation({
      onSuccess: () => {
        void utils.promptLibrary.list.invalidate();
      },
    });
  const deleteMutation = trpc.promptLibrary.delete.useMutation({
    onSuccess: () => {
      toast.success("已刪除");
      void utils.promptLibrary.list.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const handleCopy = useCallback(
    async (content: string, id: number) => {
      try {
        await copyToClipboard(content, "已複製到剪貼簿");
        incrementMutation.mutate(
          { id },
          {
            onSuccess: () => {
              if (scope === "reference") {
                void utils.promptLibrary.listPublic.invalidate();
              }
            },
          }
        );
      } catch {
        /* error toast shown by copyToClipboard */
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

  const handleApplyToPage = useCallback(
    async (content: string, id: number) => {
      if (!fillPromptCap.supports) {
        toast.error("這頁沒有提示詞輸入欄，改用「帶到對話」或「複製」");
        return;
      }
      const result = await fillPromptCap.pageAgent.dispatch(
        { type: "fillPrompt", text: content },
        { source: "manual" }
      );
      if (result.ok) {
        toast.success("已套到當前頁面的提示詞欄");
        incrementMutation.mutate({ id });
      } else {
        toast.error(result.reason || "套用失敗，這頁沒收到");
      }
    },
    [fillPromptCap, incrementMutation]
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

      {/* Search + filter */}
      <div className="flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-2.5 py-1.5">
        <Search className="w-3.5 h-3.5 text-white/50 shrink-0" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={
            scope === "mine" ? "搜尋我的提示詞…" : "搜尋公開提示詞…"
          }
          className={cn(
            "flex-1 bg-transparent text-white placeholder:text-white/30 outline-none min-w-0",
            fullscreen ? "text-sm" : "text-xs"
          )}
          aria-label="搜尋提示詞"
        />
      </div>

      {/* Category chips + favorite toggle */}
      <div className="flex flex-wrap items-center gap-1">
        <Filter className="w-3 h-3 text-white/40" />
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] border transition-colors",
            category === "all"
              ? "border-white/40 bg-white/15 text-white"
              : "border-white/10 bg-white/4 text-white/55 hover:text-white/85"
          )}
        >
          全部
        </button>
        {PROMPT_CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] border transition-colors",
              category === c
                ? "border-white/40 bg-white/15 text-white"
                : "border-white/10 bg-white/4 text-white/55 hover:text-white/85"
            )}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        {scope === "mine" && (
          <button
            type="button"
            onClick={() => setFavoritesOnly(v => !v)}
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] border transition-colors flex items-center gap-1",
              favoritesOnly
                ? "border-amber-300/50 bg-amber-300/15 text-amber-100"
                : "border-white/10 bg-white/4 text-white/55 hover:text-white/85"
            )}
          >
            <Star
              className={cn(
                "w-2.5 h-2.5",
                favoritesOnly && "fill-amber-300 text-amber-300"
              )}
            />
            收藏
          </button>
        )}
      </div>

      {/* New prompt creator — 只在個人提示詞顯示 */}
      {scope === "mine" && (
        <div>
          {!creatorOpen ? (
            <button
              type="button"
              onClick={() => setCreatorOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-100 px-3 py-2 text-[11px] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              新增提示詞
            </button>
          ) : (
            <PromptCreator
              fullscreen={fullscreen}
              onClose={() => setCreatorOpen(false)}
              onCreated={() => {
                setCreatorOpen(false);
                void utils.promptLibrary.list.invalidate();
              }}
            />
          )}
        </div>
      )}

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

        {!activeQuery.isLoading &&
          !activeQuery.isError &&
          items.length === 0 && (
            <div className="text-[11px] text-white/55 text-center py-6 space-y-1">
              <p>
                {scope === "mine"
                  ? "你還沒有符合條件的提示詞"
                  : "沒找到符合的參考提示詞"}
              </p>
              {scope === "mine" && (
                <p className="text-white/35">
                  按上面的「新增提示詞」開始收集
                </p>
              )}
            </div>
          )}

        {items.map(item => {
          const expanded = expandedId === item.id;
          const isEditing = editingId === item.id;
          if (isEditing) {
            return (
              <PromptEditor
                key={item.id}
                item={item}
                fullscreen={fullscreen}
                onClose={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  void utils.promptLibrary.list.invalidate();
                }}
              />
            );
          }
          return (
            <div
              key={item.id}
              className="rounded-xl border border-white/10 bg-white/5 p-2.5 hover:bg-white/8 transition-colors"
            >
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-white flex items-center gap-1.5">
                    {item.isFavorite && (
                      <Star className="w-3 h-3 text-amber-300 fill-amber-300 shrink-0" />
                    )}
                    <span className="truncate">{item.title}</span>
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5">
                    {CATEGORY_LABEL[item.category as PromptCategory] ??
                      item.category}
                    {item.useCount > 0 && (
                      <span className="ml-2">使用 {item.useCount} 次</span>
                    )}
                    {item.isPublic && scope === "mine" && (
                      <span className="ml-2 text-emerald-200/80">· 公開</span>
                    )}
                  </p>
                  <p
                    className={cn(
                      "text-[11px] text-white/70 mt-1 leading-snug whitespace-pre-wrap break-words",
                      expanded ? "" : "line-clamp-2"
                    )}
                  >
                    {item.content}
                  </p>
                  {item.content.length > 100 && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                      className="mt-1 text-[10px] text-cyan-200/80 hover:text-cyan-100 inline-flex items-center gap-0.5"
                    >
                      {expanded ? (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          收起
                        </>
                      ) : (
                        <>
                          <ChevronRight className="w-3 h-3" />
                          展開全文
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 mt-2">
                {scope === "mine" && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        toggleFavoriteMutation.mutate({ id: item.id })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] transition-colors",
                        item.isFavorite
                          ? "border-amber-300/40 bg-amber-300/15 text-amber-100 hover:bg-amber-300/25"
                          : "border-white/12 bg-white/8 hover:bg-white/15 text-white/70"
                      )}
                      title="切換收藏"
                    >
                      <Star
                        className={cn(
                          "w-3 h-3",
                          item.isFavorite && "fill-amber-300"
                        )}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/8 hover:bg-white/15 text-white/70 px-2 py-1 text-[10px] transition-colors"
                      title="編輯"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`刪除「${item.title}」？`)) {
                          deleteMutation.mutate({ id: item.id });
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-300/30 bg-rose-400/10 hover:bg-rose-400/20 text-rose-100 px-2 py-1 text-[10px] transition-colors"
                      title="刪除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleCopy(item.content, item.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-white/8 hover:bg-white/15 text-white/85 px-2 py-1 text-[10px] transition-colors"
                  title="複製"
                >
                  <Copy className="w-3 h-3" />
                  複製
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyToChat(item.content, item.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-300/30 bg-violet-400/15 hover:bg-violet-400/25 text-violet-100 px-2 py-1 text-[10px] transition-colors"
                  title="把這條提示詞丟進光球對話"
                >
                  <Send className="w-3 h-3" />
                  對話
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyToPage(item.content, item.id)}
                  disabled={!fillPromptCap.supports}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] transition-colors",
                    fillPromptCap.supports
                      ? "border-emerald-300/30 bg-emerald-400/15 hover:bg-emerald-400/25 text-emerald-100"
                      : "border-white/8 bg-white/4 text-white/30 cursor-not-allowed"
                  )}
                  title={
                    fillPromptCap.supports
                      ? "套到當前頁面的提示詞欄"
                      : "這頁沒有提示詞輸入欄"
                  }
                >
                  <Wand2 className="w-3 h-3" />
                  套到本頁
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 新增提示詞 inline form ───────────────────────────────────────────────

function PromptCreator({
  fullscreen,
  onClose,
  onCreated,
}: {
  fullscreen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PromptCategory>("general");
  const [isPublic, setIsPublic] = useState(false);

  // 預填當前頁面的 prompt（如果有）— 「快速把當頁正在寫的存起來」
  const pageAgent = usePageAgent();
  const currentPrompt = pageAgent.snapshot?.currentPrompt;

  const createMutation = trpc.promptLibrary.create.useMutation({
    onSuccess: () => {
      toast.success("已存到提示詞庫");
      onCreated();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-emerald-300/25 bg-emerald-400/8 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-emerald-100">新提示詞</p>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/10 text-white/55"
          aria-label="關閉"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="標題（必填）"
        maxLength={255}
        className={cn(
          "w-full rounded-lg bg-white/8 border border-white/12 text-white placeholder:text-white/30 px-2 py-1.5 outline-none focus:border-emerald-300/40",
          fullscreen ? "text-sm" : "text-xs"
        )}
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="提示詞內容（必填）"
        rows={4}
        className={cn(
          "w-full rounded-lg bg-white/8 border border-white/12 text-white placeholder:text-white/30 px-2 py-1.5 outline-none focus:border-emerald-300/40 resize-y",
          fullscreen ? "text-sm" : "text-xs"
        )}
      />
      {currentPrompt && currentPrompt !== content && (
        <button
          type="button"
          onClick={() => setContent(currentPrompt)}
          className="text-[10px] text-cyan-200/80 hover:text-cyan-100"
        >
          ↓ 套入當前頁面的提示詞（{currentPrompt.length} 字）
        </button>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={category}
          onChange={e => setCategory(e.target.value as PromptCategory)}
          className="rounded-lg bg-white/8 border border-white/12 text-white text-[11px] px-2 py-1 outline-none"
        >
          {PROMPT_CATEGORIES.map(c => (
            <option key={c} value={c} className="bg-neutral-900">
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-[11px] text-white/65 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={e => setIsPublic(e.target.checked)}
            className="accent-emerald-300"
          />
          公開分享
        </label>
        <button
          type="button"
          onClick={() => {
            if (!title.trim() || !content.trim()) {
              toast.error("標題與內容都要填");
              return;
            }
            createMutation.mutate({
              title: title.trim(),
              content: content.trim(),
              category,
              isPublic,
            });
          }}
          disabled={createMutation.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-emerald-300/40 bg-emerald-400/20 hover:bg-emerald-400/30 text-emerald-50 px-2 py-1 text-[11px] disabled:opacity-50"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          存起來
        </button>
      </div>
    </div>
  );
}

// ─── 編輯提示詞 inline form ───────────────────────────────────────────────

function PromptEditor({
  item,
  fullscreen,
  onClose,
  onSaved,
}: {
  item: {
    id: number;
    title: string;
    content: string;
    category: string;
    isPublic: boolean;
  };
  fullscreen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [category, setCategory] = useState<PromptCategory>(
    (PROMPT_CATEGORIES.includes(item.category as PromptCategory)
      ? item.category
      : "general") as PromptCategory
  );
  const [isPublic, setIsPublic] = useState(item.isPublic);

  const updateMutation = trpc.promptLibrary.update.useMutation({
    onSuccess: () => {
      toast.success("已更新");
      onSaved();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-cyan-300/25 bg-cyan-400/8 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-cyan-100">編輯提示詞</p>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/10 text-white/55"
          aria-label="取消"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        maxLength={255}
        className={cn(
          "w-full rounded-lg bg-white/8 border border-white/12 text-white px-2 py-1.5 outline-none focus:border-cyan-300/40",
          fullscreen ? "text-sm" : "text-xs"
        )}
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={4}
        className={cn(
          "w-full rounded-lg bg-white/8 border border-white/12 text-white px-2 py-1.5 outline-none focus:border-cyan-300/40 resize-y",
          fullscreen ? "text-sm" : "text-xs"
        )}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={category}
          onChange={e => setCategory(e.target.value as PromptCategory)}
          className="rounded-lg bg-white/8 border border-white/12 text-white text-[11px] px-2 py-1 outline-none"
        >
          {PROMPT_CATEGORIES.map(c => (
            <option key={c} value={c} className="bg-neutral-900">
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-[11px] text-white/65 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={e => setIsPublic(e.target.checked)}
            className="accent-cyan-300"
          />
          公開
        </label>
        <button
          type="button"
          onClick={() => {
            if (!title.trim() || !content.trim()) {
              toast.error("標題與內容都要填");
              return;
            }
            updateMutation.mutate({
              id: item.id,
              title: title.trim(),
              content: content.trim(),
              category,
              isPublic,
            });
          }}
          disabled={updateMutation.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-cyan-300/40 bg-cyan-400/20 hover:bg-cyan-400/30 text-cyan-50 px-2 py-1 text-[11px] disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3 h-3" />
          )}
          儲存
        </button>
      </div>
    </div>
  );
}

// ─── Sub-panel: Inline 代理聊天 — 完整版 ─────────────────────────────────

function InlineChatPanel({ fullscreen }: { fullscreen: boolean }) {
  const globalChat = useGlobalOrbChat();
  const endRef = useRef<HTMLDivElement>(null);
  const messagesCount = globalChat.messages.length;
  const openChat = globalChat.open;

  useEffect(() => {
    openChat();
  }, [openChat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesCount]);

  const handleSend = useCallback(async () => {
    const text = globalChat.input.trim();
    if (!text || globalChat.isSending) return;
    await globalChat.sendMessage(text);
  }, [globalChat]);

  // 顯示最近 50 則 — 比之前的 12 寬鬆很多，但不會把整段歷史拖進記憶體
  const visibleMessages = globalChat.messages.slice(-50);
  const clarification = globalChat.pendingClarification;
  const clarifyOptions =
    clarification?.options?.filter(
      (o): o is string => typeof o === "string" && o.trim().length > 0
    ) ?? [];

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        fullscreen ? "h-[calc(100vh-280px)] min-h-[400px]" : "h-[58vh] max-h-[500px]"
      )}
    >
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-white/10">
        {visibleMessages.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/4 p-3 text-[12px] text-white/65 leading-relaxed">
            嗨 ✨ 直接告訴我你想做什麼，或是把問題打進來。光球會在這裡回你，
            不用跳頁。
          </div>
        )}
        {visibleMessages.map((msg, i) => (
          <div
            key={`${msg.at ?? i}`}
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

      {/* Clarification — 光球反問時的多選按鈕 */}
      {clarification && clarifyOptions.length > 0 && (
        <div className="shrink-0 rounded-xl border border-violet-300/30 bg-violet-400/8 p-2">
          <p className="text-[10px] text-violet-100/80 mb-1">
            光球想確認：{clarification.question}
          </p>
          <div className="flex flex-wrap gap-1">
            {clarifyOptions.slice(0, 6).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => void globalChat.answerClarification(opt)}
                className="rounded-full border border-violet-300/30 bg-violet-400/15 hover:bg-violet-400/25 text-violet-50 px-2.5 py-1 text-[11px] transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions — 光球給的後續快速回覆 */}
      {!clarification && globalChat.suggestions.length > 0 && !globalChat.isSending && (
        <div className="shrink-0 flex flex-wrap gap-1">
          {globalChat.suggestions.slice(0, 4).map((s, i) => (
            <button
              key={`${s.text}-${i}`}
              type="button"
              onClick={() => void globalChat.sendMessage(s.text)}
              className="rounded-full border border-white/12 bg-white/6 hover:bg-white/12 text-white/80 hover:text-white px-2.5 py-1 text-[11px] transition-colors"
            >
              {s.text}
            </button>
          ))}
        </div>
      )}

      {/* Composer — 跟 OrbGuidePanel 的 chat tab 共用 globalChat.input */}
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
            "flex-1 bg-transparent text-white placeholder:text-white/30 outline-none min-w-0",
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

// ─── Sub-panel: 積分試算 — 完整版 ────────────────────────────────────────

type CreditsView = "estimate" | "compare" | "usage";

function CreditsPanel({ fullscreen }: { fullscreen: boolean }) {
  const [view, setView] = useState<CreditsView>("estimate");

  return (
    <div className="space-y-2.5">
      <BalanceCard fullscreen={fullscreen} />

      {/* View toggle */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/4 p-0.5">
        {(
          [
            { key: "estimate", label: "試算" },
            { key: "compare", label: "比價" },
            { key: "usage", label: "用量" },
          ] as const
        ).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(t.key)}
            aria-pressed={view === t.key}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-medium transition-all",
              view === t.key
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white/85"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === "estimate" && <EstimateView fullscreen={fullscreen} />}
      {view === "compare" && <CompareView fullscreen={fullscreen} />}
      {view === "usage" && <UsageView fullscreen={fullscreen} />}
    </div>
  );
}

function BalanceCard({ fullscreen }: { fullscreen: boolean }) {
  const balanceQuery = trpc.credits.myBalance.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });
  const balance = balanceQuery.data;

  return (
    <div className="rounded-2xl border border-white/12 bg-gradient-to-br from-emerald-400/12 to-cyan-400/8 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/45">
            我的餘額
          </p>
          <p
            className={cn(
              "font-bold text-white tabular-nums",
              fullscreen ? "text-2xl" : "text-xl"
            )}
          >
            {balanceQuery.isLoading
              ? "…"
              : balanceQuery.isError
                ? "需登入"
                : (balance?.remaining ?? 0).toLocaleString()}
            <span className="text-[11px] font-normal text-white/55 ml-1">
              pts
            </span>
          </p>
        </div>
        {balance?.topModel && (
          <div className="text-right">
            <p className="text-[10px] text-white/45">近 30 天最常用</p>
            <p className="text-[11px] text-white/85 truncate max-w-[140px]">
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
  );
}

// 試算頁 — 含「一鍵把這個模型套到當前頁」
function EstimateView({ fullscreen }: { fullscreen: boolean }) {
  const catalogQuery = trpc.credits.pricingCatalog.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const balanceQuery = trpc.credits.myBalance.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });

  const setModelCap = usePageCapability("setModel");

  const flatModels = useMemo(() => {
    if (!catalogQuery.data)
      return [] as Array<{
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

  const handleApplyToPage = useCallback(async () => {
    if (!setModelCap.supports || !selectedModelId) return;
    const result = await setModelCap.pageAgent.dispatch(
      { type: "setModel", modelId: selectedModelId },
      { source: "manual" }
    );
    if (result.ok) toast.success(`已把模型切到「${selectedModel?.label}」`);
    else toast.error(result.reason || "這頁不支援這個模型");
  }, [setModelCap, selectedModelId, selectedModel]);

  return (
    <div className="space-y-2.5">
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
            {Array.from(new Set(flatModels.map(m => m.category))).map(cat => (
              <optgroup
                key={cat}
                label={cat}
                className="bg-neutral-900 text-white"
              >
                {flatModels
                  .filter(m => m.category === cat)
                  .map(m => (
                    <option
                      key={m.modelId}
                      value={m.modelId}
                      className="bg-neutral-900"
                    >
                      {m.label}（{m.basePoints} pts/{m.unit}）
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

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
            這個模型用 <span className="text-white/70">{unit}</span>{" "}
            計費，沒有可調整參數。
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
              <span
                className={cn(
                  "font-bold text-amber-50 tabular-nums",
                  fullscreen ? "text-3xl" : "text-2xl"
                )}
              >
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
                  餘額足夠（剩{" "}
                  {(
                    balance.remaining - Number(estimatedPoints)
                  ).toLocaleString()}{" "}
                  pts）
                </span>
              </>
            ) : (
              <span className="text-rose-200/85">
                ⚠️ 餘額不足，差{" "}
                {(
                  Number(estimatedPoints) - balance.remaining
                ).toLocaleString()}{" "}
                pts
              </span>
            )}
          </div>
        )}
        {/* 一鍵把這個模型套到當前頁 */}
        {setModelCap.supports && selectedModelId && (
          <button
            type="button"
            onClick={handleApplyToPage}
            className="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-300/40 bg-emerald-400/20 hover:bg-emerald-400/30 text-emerald-50 px-2 py-1.5 text-[11px] transition-colors"
          >
            <Wand2 className="w-3 h-3" />
            把這個模型套到當前頁面
          </button>
        )}
      </div>
    </div>
  );
}

// 同類比價 — 自動拿當前選的模型分類去 compare
function CompareView({ fullscreen }: { fullscreen: boolean }) {
  const catalogQuery = trpc.credits.pricingCatalog.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const setModelCap = usePageCapability("setModel");

  const categories = useMemo(
    () => Object.keys(catalogQuery.data ?? {}),
    [catalogQuery.data]
  );
  const [category, setCategory] = useState<string>("");
  useEffect(() => {
    if (!category && categories[0]) setCategory(categories[0]);
  }, [categories, category]);

  const [durationSec, setDurationSec] = useState(5);
  const [charCount, setCharCount] = useState(200);
  const [imageCount, setImageCount] = useState(1);

  const showDuration = category.includes("video") || category.includes("audio");
  const showChars = category.includes("text") || category.includes("speech");
  const showImages = category.includes("image");

  const compareQuery = trpc.accountant.compare.useQuery(
    {
      category,
      durationSec: showDuration ? durationSec : undefined,
      charCount: showChars ? charCount : undefined,
      imageCount: showImages ? imageCount : undefined,
      limit: 8,
    },
    { enabled: !!category, staleTime: 30_000 }
  );

  return (
    <div className="space-y-2.5">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 space-y-2">
        <label className="block">
          <span className="text-[11px] text-white/55 mb-1 block">類別</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className={cn(
              "w-full rounded-lg bg-white/8 border border-white/12 text-white px-2 py-1.5 outline-none",
              fullscreen ? "text-sm" : "text-xs"
            )}
          >
            {categories.map(c => (
              <option key={c} value={c} className="bg-neutral-900">
                {c}
              </option>
            ))}
          </select>
        </label>
        {showDuration && (
          <NumberRow
            label="秒數"
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
            label="字數"
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
            label="張數"
            value={imageCount}
            onChange={setImageCount}
            min={1}
            max={20}
            suffix="張"
            fullscreen={fullscreen}
          />
        )}
      </div>

      {compareQuery.isLoading && (
        <div className="flex items-center justify-center py-4 text-white/40 text-[11px] gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          比價中…
        </div>
      )}
      {compareQuery.data && compareQuery.data.rows.length > 0 && (
        <div className="space-y-1.5">
          {compareQuery.data.rows.map((r, i) => {
            const isCheapest = i === 0;
            return (
              <div
                key={r.modelId}
                className={cn(
                  "rounded-xl border px-2.5 py-2 flex items-center gap-2",
                  isCheapest
                    ? "border-emerald-300/30 bg-emerald-400/10"
                    : "border-white/10 bg-white/5"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-white truncate flex items-center gap-1">
                    {isCheapest && (
                      <span className="rounded-full bg-emerald-400/30 text-emerald-50 px-1.5 py-0.5 text-[9px]">
                        最便宜
                      </span>
                    )}
                    {r.label}
                  </p>
                  <p className="text-[9px] text-white/45 truncate">
                    {r.provider} · {r.tier}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-bold text-white tabular-nums">
                    {r.totalPoints.toLocaleString()}
                    <span className="text-[9px] text-white/55 ml-0.5">pts</span>
                  </p>
                  {!isCheapest && r.premiumOverCheapest > 0 && (
                    <p className="text-[9px] text-rose-200/70">
                      +{r.premiumOverCheapest} ({r.pctOfCheapest}%)
                    </p>
                  )}
                </div>
                {setModelCap.supports && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await setModelCap.pageAgent.dispatch(
                        { type: "setModel", modelId: r.modelId },
                        { source: "manual" }
                      );
                      if (ok.ok) toast.success(`已切到「${r.label}」`);
                      else
                        toast.error(ok.reason || "這頁不支援這個模型");
                    }}
                    className="shrink-0 rounded-lg border border-emerald-300/30 bg-emerald-400/15 hover:bg-emerald-400/25 text-emerald-100 px-2 py-1 text-[10px] transition-colors"
                    title="用這個模型"
                  >
                    切換
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {compareQuery.data && compareQuery.data.rows.length === 0 && (
        <p className="text-[11px] text-white/50 text-center py-4">
          這個類別還沒有可比較的模型
        </p>
      )}
    </div>
  );
}

// 近 30 天用量
function UsageView({ fullscreen }: { fullscreen: boolean }) {
  const usageQuery = trpc.accountant.usage.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });

  if (usageQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-white/40 text-[11px] gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        載入中…
      </div>
    );
  }

  if (usageQuery.isError) {
    return (
      <p className="text-[11px] text-rose-200/80 text-center py-4">
        需要登入才能看用量
      </p>
    );
  }

  const u = usageQuery.data;
  if (!u) return null;

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="text-[10px] uppercase tracking-wider text-white/45 flex items-center gap-1">
          <BarChart3 className="w-3 h-3" />
          近 30 天總計
        </p>
        <div className="flex items-baseline gap-3 mt-1">
          <div>
            <p
              className={cn(
                "font-bold text-white tabular-nums",
                fullscreen ? "text-2xl" : "text-xl"
              )}
            >
              {u.totalCostPoints.toLocaleString()}
              <span className="text-[10px] text-white/55 ml-1">pts</span>
            </p>
            <p className="text-[10px] text-white/50">
              {u.totalRequests} 次呼叫
            </p>
          </div>
        </div>
      </div>

      {u.topModel && (
        <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-100/70">
            最常用模型
          </p>
          <p className="text-[12px] text-amber-50 font-medium truncate mt-0.5">
            {u.topModel.modelId}
          </p>
          <p className="text-[10px] text-amber-100/60 mt-0.5">
            {u.topModel.totalCalls} 次 · ${u.topModel.totalCostUsd.toFixed(3)}
          </p>
        </div>
      )}

      {u.modalityBreakdown.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-white/45 px-1">模態拆解</p>
          {u.modalityBreakdown.slice(0, 6).map(row => (
            <div
              key={row.requestType}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5"
            >
              <span className="text-[11px] text-white/85 truncate">
                {row.requestType}
              </span>
              <span className="text-[10px] text-white/55 tabular-nums shrink-0">
                {row.count} 次 · ${row.totalCostUsd.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      )}

      {u.totalRequests === 0 && (
        <p className="text-[11px] text-white/50 text-center py-4">
          最近 30 天還沒有用量紀錄
        </p>
      )}
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
      <span className="text-[11px] text-white/55 shrink-0 w-14">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-emerald-300 min-w-0"
      />
      <span
        className={cn(
          "tabular-nums text-white/85 text-right shrink-0 w-14",
          fullscreen ? "text-sm" : "text-xs"
        )}
      >
        {value}
        {suffix && <span className="text-white/45 ml-0.5">{suffix}</span>}
      </span>
    </label>
  );
}

// ─── NotesSchedulePanel ────────────────────────────────────────────────────
// 在光球內直接編輯筆記與排程，即時同步到主頁面（共用 tRPC 快取）

type OrbNoteStatus = "todo" | "in_progress" | "done";

const orbStatusInfo: Record<OrbNoteStatus, { label: string; icon: React.ReactNode; pill: string }> = {
  todo: { label: "待辦", icon: <Circle className="w-3 h-3" />, pill: "bg-sky-400/15 text-sky-300 border-sky-400/30" },
  in_progress: { label: "進行中", icon: <CircleDot className="w-3 h-3" />, pill: "bg-amber-400/15 text-amber-300 border-amber-400/30" },
  done: { label: "完成", icon: <CircleCheck className="w-3 h-3" />, pill: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30" },
};

function orbNextStatus(s: OrbNoteStatus): OrbNoteStatus {
  if (s === "todo") return "in_progress";
  if (s === "in_progress") return "done";
  return "todo";
}

const ORB_NOTE_TYPE_LABELS: Record<string, string> = {
  note: "筆記",
  script: "腳本",
  calendar_event: "行事曆",
};

function NotesSchedulePanel({ fullscreen }: { fullscreen: boolean }) {
  const utils = trpc.useUtils();

  const notesQuery = trpc.notes.list.useQuery(undefined, {
    staleTime: 15_000,
    retry: false,
  });

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
      utils.notes.summary.invalidate();
      setShowCreate(false);
      setNewTitle("");
      setNewContent("");
      setNewTags("");
      setNewType("note");
      toast.success("筆記已建立");
    },
    onError: e => toast.error(e.message),
  });

  const updateNote = trpc.notes.update.useMutation({
    onSuccess: (_d, vars) => {
      utils.notes.list.invalidate();
      utils.notes.summary.invalidate();
      if (vars?.status === "done") toast.success("已標記完成 ✓");
      else if (vars?.status) toast.success("狀態已更新");
      else { toast.success("筆記已更新"); setEditingId(null); }
    },
    onError: e => toast.error(e.message),
  });

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate();
      utils.notes.summary.invalidate();
      toast.success("已刪除");
    },
  });

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newType, setNewType] = useState<"note" | "script" | "calendar_event">("note");

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");

  // View toggle
  const [view, setView] = useState<"notes" | "schedule">("notes");

  const allNotes = notesQuery.data ?? [];

  const recentNotes = useMemo(
    () =>
      [...allNotes]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [allNotes]
  );

  const upcomingNotes = useMemo(() => {
    const now = Date.now();
    return [...allNotes]
      .filter(
        n =>
          n.scheduledDate &&
          new Date(n.scheduledDate).getTime() >= now - 24 * 60 * 60 * 1000 &&
          (n.status ?? "todo") !== "done"
      )
      .sort(
        (a, b) =>
          new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime()
      )
      .slice(0, 8);
  }, [allNotes]);

  const startEdit = (note: { id: number; title: string; content?: string | null; tags?: string[] | null }) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content ?? "");
    setEditTags(((note.tags as string[] | null) ?? []).join(", "));
  };

  const saveEdit = () => {
    if (!editTitle.trim() || editingId === null) return;
    const tags = editTags.trim()
      ? editTags.split(",").map(t => t.trim()).filter(Boolean)
      : [];
    updateNote.mutate({
      id: editingId,
      title: editTitle.trim(),
      content: editContent.trim() || undefined,
      tags: tags.length ? tags : undefined,
    });
  };

  const handleCreate = () => {
    if (!newTitle.trim()) { toast.error("請輸入標題"); return; }
    const tags = newTags.trim()
      ? newTags.split(",").map(t => t.trim()).filter(Boolean)
      : undefined;
    createNote.mutate({ title: newTitle.trim(), content: newContent.trim() || undefined, noteType: newType, tags });
  };

  const baseText = fullscreen ? "text-sm" : "text-xs";

  return (
    <div className={cn("space-y-2.5", baseText, "text-white/85")}>
      {/* View toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/4 p-0.5">
        {(["notes", "schedule"] as const).map(v => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={cn(
              "rounded-lg py-1.5 text-[11px] font-medium transition-all flex items-center justify-center gap-1",
              view === v ? "bg-white/15 text-white" : "text-white/50 hover:text-white/85"
            )}
          >
            {v === "notes" ? <StickyNote className="w-3 h-3" /> : <CalendarDays className="w-3 h-3" />}
            {v === "notes" ? "筆記" : "排程"}
          </button>
        ))}
      </div>

      {/* Quick create */}
      {!showCreate ? (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-100 px-3 py-2 text-[11px] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新增筆記
        </button>
      ) : (
        <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/8 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-100/90 font-medium">新增筆記</span>
            <button type="button" onClick={() => setShowCreate(false)} className="text-white/40 hover:text-white/70">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="標題 *"
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-emerald-300/50"
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="內容（選填）"
            rows={3}
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 outline-none resize-none focus:border-emerald-300/50"
          />
          <input
            value={newTags}
            onChange={e => setNewTags(e.target.value)}
            placeholder="標籤（逗號分隔，選填）"
            className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 outline-none focus:border-emerald-300/50"
          />
          {/* Type selector */}
          <div className="flex gap-1">
            {(["note", "script", "calendar_event"] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setNewType(t)}
                className={cn(
                  "flex-1 py-1 rounded-lg text-[10px] font-medium border transition-all",
                  newType === t
                    ? "border-emerald-300/50 bg-emerald-400/20 text-emerald-100"
                    : "border-white/10 bg-white/5 text-white/50 hover:text-white/80"
                )}
              >
                {ORB_NOTE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewTitle(""); setNewContent(""); setNewTags(""); }}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/12 text-white/60 py-1.5 text-[11px] transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newTitle.trim() || createNote.isPending}
              className="flex-1 rounded-lg bg-emerald-500/80 hover:bg-emerald-500 text-white py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {createNote.isPending ? "建立中…" : "建立"}
            </button>
          </div>
        </div>
      )}

      {/* Content: notes list or schedule list */}
      {notesQuery.isLoading ? (
        <div className="flex items-center justify-center py-6 text-white/40 text-[11px] gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          載入中…
        </div>
      ) : view === "notes" ? (
        <div className="space-y-1.5">
          {recentNotes.length === 0 ? (
            <p className="text-[11px] text-white/40 text-center py-4">尚無筆記，點上方按鈕新增</p>
          ) : (
            recentNotes.map(note => {
              const status = (note.status ?? "todo") as OrbNoteStatus;
              const sInfo = orbStatusInfo[status];
              const isEditing = editingId === note.id;
              const tags = (note.tags as string[] | null) ?? [];

              return (
                <div
                  key={note.id}
                  className={cn(
                    "rounded-xl border bg-white/5 hover:bg-white/8 transition-colors",
                    isEditing ? "border-emerald-300/30" : "border-white/10"
                  )}
                >
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    {/* Status toggle */}
                    <button
                      type="button"
                      onClick={() => updateNote.mutate({ id: note.id, status: orbNextStatus(status) })}
                      title={`狀態：${sInfo.label}`}
                      className={cn("shrink-0 rounded-full p-0.5 border hover:scale-110 transition-transform", sInfo.pill)}
                    >
                      {sInfo.icon}
                    </button>

                    {/* Title / edit field */}
                    {isEditing ? (
                      <input
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="flex-1 bg-white/8 border border-white/20 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-emerald-300/50 min-w-0"
                        onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={cn(
                          "flex-1 text-[12px] truncate cursor-pointer",
                          status === "done" ? "line-through text-white/40" : "text-white/90"
                        )}
                        onClick={() => startEdit(note)}
                        title="點擊編輯"
                      >
                        {note.title}
                      </span>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={updateNote.isPending}
                            className="rounded-lg p-1 bg-emerald-400/20 hover:bg-emerald-400/35 text-emerald-200 transition-colors"
                            title="儲存"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-lg p-1 hover:bg-white/10 text-white/50 transition-colors"
                            title="取消"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            className="rounded-lg p-1 hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                            title="編輯"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteNote.mutate({ id: note.id })}
                            className="rounded-lg p-1 hover:bg-red-500/20 text-white/30 hover:text-red-300 transition-colors"
                            title="刪除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded edit fields */}
                  {isEditing && (
                    <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/8 mt-1 pt-2">
                      <textarea
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        placeholder="內容…"
                        rows={4}
                        className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 outline-none resize-none focus:border-emerald-300/50"
                      />
                      <input
                        value={editTags}
                        onChange={e => setEditTags(e.target.value)}
                        placeholder="標籤（逗號分隔）"
                        className="w-full bg-white/8 border border-white/15 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 outline-none focus:border-emerald-300/50"
                      />
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={!editTitle.trim() || updateNote.isPending}
                        className="w-full rounded-lg bg-emerald-500/80 hover:bg-emerald-500 text-white py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
                      >
                        {updateNote.isPending ? "儲存中…" : "儲存變更"}
                      </button>
                    </div>
                  )}

                  {/* Type + tags info (non-editing) */}
                  {!isEditing && (
                    <div className="flex items-center gap-1.5 px-2.5 pb-2 flex-wrap">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/8 text-white/45">
                        {ORB_NOTE_TYPE_LABELS[note.noteType] ?? note.noteType}
                      </span>
                      {note.scheduledDate && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 flex items-center gap-0.5">
                          <Calendar className="w-2 h-2" />
                          {new Date(note.scheduledDate).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
                        </span>
                      )}
                      {tags.slice(0, 2).map(tag => (
                        <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-violet-400/15 text-violet-300 flex items-center gap-0.5">
                          <Tag className="w-2 h-2" />{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        // Schedule view
        <div className="space-y-1.5">
          {upcomingNotes.length === 0 ? (
            <p className="text-[11px] text-white/40 text-center py-4">目前沒有排程中的筆記</p>
          ) : (
            upcomingNotes.map(note => {
              const status = (note.status ?? "todo") as OrbNoteStatus;
              const sInfo = orbStatusInfo[status];
              const dt = note.scheduledDate ? new Date(note.scheduledDate) : null;
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const isOverdue = dt ? dt.getTime() < now.getTime() : false;
              const isToday = dt ? dt.toDateString() === now.toDateString() : false;

              return (
                <div
                  key={note.id}
                  className={cn(
                    "rounded-xl border p-2.5 bg-white/5 transition-colors",
                    isOverdue ? "border-red-400/30" : isToday ? "border-amber-400/30" : "border-white/10"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateNote.mutate({ id: note.id, status: orbNextStatus(status) })}
                      title={`狀態：${sInfo.label}`}
                      className={cn("shrink-0 rounded-full p-0.5 border hover:scale-110 transition-transform", sInfo.pill)}
                    >
                      {sInfo.icon}
                    </button>
                    <span className={cn("flex-1 text-[12px] truncate", status === "done" ? "line-through text-white/40" : "text-white/90")}>
                      {note.title}
                    </span>
                    {dt && (
                      <span
                        className={cn(
                          "text-[10px] tabular-nums shrink-0 font-medium",
                          isOverdue ? "text-red-300" : isToday ? "text-amber-300" : "text-white/55"
                        )}
                      >
                        {isOverdue
                          ? `逾期 ${Math.max(1, Math.floor((now.getTime() - dt.getTime()) / (24 * 60 * 60 * 1000)))}天`
                          : isToday
                          ? dt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })
                          : dt.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
