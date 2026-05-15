/**
 * ConversationTabs.tsx — horizontal tab bar for parallel orb conversations.
 *
 * Layout:
 *   [ scrollable visible tabs ............ ] [ ⋯ overflow ] [ + 新對話 ]
 *
 * The overflow and "新對話" buttons live in their own `shrink-0` flex slot
 * pinned to the right, so they never get squeezed off-screen or wrap
 * vertically when the tab list overflows. Tabs beyond `MAX_VISIBLE_TABS`
 * collapse into the overflow dropdown so the inline strip stays scannable.
 *
 * Identity for default-titled rows: when a user spins up several empty
 * conversations in a row they all carry the placeholder title "新對話",
 * which makes the strip a wall of identical chips. We assign each one a
 * stable display index (#2, #3…) keyed off creation order so users can
 * tell them apart at a glance, without mutating the underlying title.
 *
 * Cleanup affordance: the overflow dropdown surfaces a "清掉空對話" bulk
 * action that prunes welcome-only tabs in one shot. Active conversation is
 * always preserved.
 *
 * State + persistence live in `GlobalOrbChatContext`. This component is
 * purely presentational and owns only the in-progress rename/delete UI
 * state for the row currently being edited.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  X,
  MessageSquare,
  Loader2,
  MoreHorizontal,
  Trash2,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { formatRelativeTime } from "@/lib/orbChatHelpers";
import { cn } from "@/lib/utils";

const DEFAULT_TITLE = "新對話";
const MAX_VISIBLE_TABS = 6;

export function ConversationTabs() {
  const {
    conversations,
    activeConversationId,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
  } = useGlobalOrbChat();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Sort: pinned first, then by recency (lastMessageAt / updatedAt). Empty,
  // default-titled rows get a sequence label so the user can distinguish
  // them without having to open each one.
  const visible = useMemo(() => {
    const live = conversations.filter(c => !c.archivedAt);
    const ranked = [...live].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTs = a.lastMessageAt ?? a.updatedAt ?? a.createdAt;
      const bTs = b.lastMessageAt ?? b.updatedAt ?? b.createdAt;
      return bTs - aTs;
    });
    // Stable display index for default-titled rows, keyed off creation order
    // (oldest #1, next #2…) so the same chip keeps the same number across
    // re-sorts.
    const defaults = [...live]
      .filter(c => !c.title?.trim() || c.title.trim() === DEFAULT_TITLE)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(c => c.conversationId);
    const defaultIndex = new Map<string, number>();
    defaults.forEach((id, i) => defaultIndex.set(id, i + 1));
    return ranked.map(c => ({
      ...c,
      displayLabel: deriveDisplayLabel(c.title, defaultIndex.get(c.conversationId)),
      isEmpty: isEmptyConversation(c.messageCount, c.title),
    }));
  }, [conversations]);

  // Keep the active tab visible inline even when there are many tabs — if
  // the active row would land in the overflow menu, swap it into the
  // visible slice so the user always sees their current conversation.
  const { inline, overflow } = useMemo(() => {
    if (visible.length <= MAX_VISIBLE_TABS) {
      return { inline: visible, overflow: [] as typeof visible };
    }
    const headInline = visible.slice(0, MAX_VISIBLE_TABS);
    const tailOverflow = visible.slice(MAX_VISIBLE_TABS);
    const activeInHead = headInline.some(
      c => c.conversationId === activeConversationId
    );
    if (activeInHead) {
      return { inline: headInline, overflow: tailOverflow };
    }
    const activeIdx = visible.findIndex(
      c => c.conversationId === activeConversationId
    );
    if (activeIdx < 0) {
      return { inline: headInline, overflow: tailOverflow };
    }
    // Push the active tab into the inline slice; drop the last inline row
    // into overflow to keep MAX_VISIBLE_TABS total.
    const promoted = visible[activeIdx];
    const newInline = [...headInline.slice(0, -1), promoted];
    const newOverflow = visible.filter(
      c => !newInline.includes(c)
    );
    return { inline: newInline, overflow: newOverflow };
  }, [visible, activeConversationId]);

  const emptyCount = visible.filter(
    c => c.isEmpty && c.conversationId !== activeConversationId
  ).length;

  const beginRename = (conversationId: string, current: string) => {
    setRenamingId(conversationId);
    setRenameDraft(current);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const cleaned = renameDraft.trim();
    if (cleaned.length > 0) {
      await renameConversation(renamingId, cleaned);
    }
    setRenamingId(null);
    setRenameDraft("");
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  const handleDelete = async (conversationId: string, title: string) => {
    if (
      !window.confirm(
        `確定要刪除「${title || "此對話"}」？此動作無法復原（伺服器與本機歷史都會清掉）。`
      )
    ) {
      return;
    }
    setPendingId(conversationId);
    try {
      await deleteConversation(conversationId);
    } finally {
      setPendingId(prev => (prev === conversationId ? null : prev));
    }
  };

  const handleCreate = async () => {
    setPendingId("__new__");
    try {
      await createConversation();
    } finally {
      setPendingId(prev => (prev === "__new__" ? null : prev));
    }
  };

  const handleClearEmpty = async () => {
    const targets = visible.filter(
      c => c.isEmpty && c.conversationId !== activeConversationId
    );
    if (targets.length === 0) return;
    if (
      !window.confirm(
        `要清掉 ${targets.length} 個還沒講過話的空對話嗎？目前這個對話會留著。`
      )
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      // Serial delete keeps the optimistic state predictable — the context's
      // `deleteConversation` reads `conversations` from closure each call.
      for (const t of targets) {
        await deleteConversation(t.conversationId);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const renderTabPill = (conv: (typeof visible)[number]) => {
    const isActive = conv.conversationId === activeConversationId;
    const isRenaming = renamingId === conv.conversationId;
    const isPending = pendingId === conv.conversationId;
    const tooltipParts = [conv.displayLabel];
    if (conv.messageCount && conv.messageCount > 1) {
      tooltipParts.push(`${conv.messageCount} 則`);
    }
    if (conv.lastMessageAt) {
      tooltipParts.push(formatRelativeTime(conv.lastMessageAt));
    }
    tooltipParts.push("雙擊重新命名");
    return (
      <div
        key={conv.conversationId}
        role="tab"
        aria-selected={isActive}
        data-testid={`conversation-tab-${conv.conversationId}`}
        className={cn(
          "group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors shrink-0 max-w-[180px]",
          isActive
            ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-600/60 dark:text-emerald-200"
            : conv.isEmpty
              ? "bg-card/40 border-border/70 text-muted-foreground/70 hover:bg-muted/60 hover:border-border hover:text-foreground/90"
              : "bg-card/70 border-border/70 text-muted-foreground hover:bg-muted/60 hover:border-border"
        )}
      >
        <MessageSquare
          className={cn(
            "w-3 h-3 shrink-0",
            isActive
              ? "text-emerald-500"
              : conv.isEmpty
                ? "text-muted-foreground/60"
                : "text-muted-foreground/70"
          )}
        />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            maxLength={120}
            onChange={e => setRenameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            className="bg-transparent border border-emerald-300 rounded px-1 py-0 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            aria-label="重新命名對話"
          />
        ) : (
          <button
            type="button"
            onClick={() => void switchConversation(conv.conversationId)}
            onDoubleClick={() => beginRename(conv.conversationId, conv.title)}
            className="truncate text-left max-w-[120px]"
            title={tooltipParts.join(" · ")}
          >
            {conv.displayLabel}
          </button>
        )}
        {conv.messageCount > 1 && !isRenaming && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1 text-[10px] leading-none py-0.5 tabular-nums",
              isActive
                ? "bg-emerald-200/80 text-emerald-800 dark:bg-emerald-800/60 dark:text-emerald-100"
                : "bg-muted/80 text-muted-foreground"
            )}
            aria-label={`${conv.messageCount} 則訊息`}
          >
            {conv.messageCount > 99 ? "99+" : conv.messageCount}
          </span>
        )}
        {isPending ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/70 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              void handleDelete(conv.conversationId, conv.title);
            }}
            className={cn(
              "rounded p-0.5 -mr-1 transition-opacity shrink-0",
              isActive
                ? "opacity-60 hover:opacity-100 hover:bg-emerald-100 dark:hover:bg-emerald-800/40"
                : "opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-slate-200"
            )}
            aria-label={`刪除對話：${conv.displayLabel}`}
            title="刪除這個對話"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  const hasOverflow = overflow.length > 0;
  const showActionsMenu = hasOverflow || emptyCount > 0;

  return (
    <div
      role="tablist"
      aria-label="光球對話分頁"
      data-testid="conversation-tabs"
      className="flex items-center gap-1.5 py-1.5 px-1"
    >
      {visible.length === 0 ? (
        <div className="text-xs text-muted-foreground/70 px-2 py-1 flex-1">
          還沒有對話 — 點 + 開新對話
        </div>
      ) : (
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-thin"
          data-testid="conversation-tabs-scroll"
        >
          {inline.map(renderTabPill)}
        </div>
      )}

      {/* Right-pinned controls — always visible, never wrap. */}
      <div className="flex items-center gap-1 shrink-0">
        {showActionsMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                data-testid="conversation-tabs-overflow"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border/60 surface-2 text-xs text-muted-foreground hover:border-border hover:text-foreground/90 transition-colors whitespace-nowrap"
                aria-label={
                  hasOverflow
                    ? `還有 ${overflow.length} 個對話`
                    : "對話分頁選單"
                }
                title={
                  hasOverflow
                    ? `還有 ${overflow.length} 個對話`
                    : "對話分頁選單"
                }
              >
                <MoreHorizontal className="w-3 h-3" />
                {hasOverflow && (
                  <span className="tabular-nums">+{overflow.length}</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {hasOverflow && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    其他對話（{overflow.length}）
                  </DropdownMenuLabel>
                  {overflow.slice(0, 20).map(conv => {
                    const isActive =
                      conv.conversationId === activeConversationId;
                    return (
                      <DropdownMenuItem
                        key={conv.conversationId}
                        onSelect={() =>
                          void switchConversation(conv.conversationId)
                        }
                        className={cn(
                          "flex items-center justify-between gap-2",
                          isActive && "bg-emerald-50 dark:bg-emerald-900/30"
                        )}
                        data-testid={`conversation-overflow-${conv.conversationId}`}
                      >
                        <span className="flex items-center gap-2 min-w-0 flex-1">
                          <MessageSquare
                            className={cn(
                              "w-3.5 h-3.5 shrink-0",
                              isActive
                                ? "text-emerald-500"
                                : conv.isEmpty
                                  ? "text-muted-foreground/60"
                                  : "text-muted-foreground/70"
                            )}
                          />
                          <span
                            className={cn(
                              "truncate",
                              conv.isEmpty &&
                                !isActive &&
                                "text-muted-foreground"
                            )}
                          >
                            {conv.displayLabel}
                          </span>
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
                          {conv.messageCount > 1
                            ? `${conv.messageCount > 99 ? "99+" : conv.messageCount} 則`
                            : conv.lastMessageAt
                              ? formatRelativeTime(conv.lastMessageAt)
                              : "—"}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                  {overflow.length > 20 && (
                    <div className="px-2 py-1 text-[10px] text-muted-foreground/70">
                      只列前 20 個。更舊的可以從對話設定找回。
                    </div>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onSelect={e => {
                  e.preventDefault();
                  void handleClearEmpty();
                }}
                disabled={emptyCount === 0 || bulkBusy}
                data-testid="conversation-tabs-clear-empty"
                variant="destructive"
                className="gap-2"
              >
                {bulkBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span className="flex-1">清掉空對話</span>
                {emptyCount > 0 && (
                  <span className="text-[10px] tabular-nums opacity-70">
                    {emptyCount}
                  </span>
                )}
              </DropdownMenuItem>
              {emptyCount === 0 && !hasOverflow && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground/70 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  沒有可以清的空對話
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={pendingId === "__new__"}
          data-testid="conversation-tab-new"
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-emerald-400 hover:text-emerald-600 dark:hover:border-emerald-500 dark:hover:text-emerald-300 transition-colors disabled:opacity-50 whitespace-nowrap"
          title="新開一個對話"
          aria-label="新增對話"
        >
          {pendingId === "__new__" ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          <span>新對話</span>
        </button>
      </div>
    </div>
  );
}

function deriveDisplayLabel(title: string, defaultIndex?: number): string {
  const cleaned = title?.trim() ?? "";
  if (!cleaned || cleaned === DEFAULT_TITLE) {
    return defaultIndex && defaultIndex > 1
      ? `${DEFAULT_TITLE} ${defaultIndex}`
      : DEFAULT_TITLE;
  }
  return cleaned;
}

function isEmptyConversation(messageCount: number, title: string): boolean {
  // "Empty" = no user turn has landed yet. The seed welcome message counts as
  // 1; anything <=1 with the default placeholder title is still untouched.
  const cleaned = title?.trim() ?? "";
  return messageCount <= 1 && (!cleaned || cleaned === DEFAULT_TITLE);
}

export default ConversationTabs;
