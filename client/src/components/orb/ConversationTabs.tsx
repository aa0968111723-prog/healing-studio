/**
 * ConversationTabs.tsx — horizontal tab bar for parallel orb conversations.
 *
 * Sits at the top of the chat scroll area on /agent. Each pill is a
 * conversation in the user's `orb_conversations` list; click to switch,
 * double-click to rename, ✕ to delete (with a confirm gate). The trailing
 * "+" opens a fresh empty conversation.
 *
 * State + persistence live in `GlobalOrbChatContext`. This component is
 * purely presentational and owns only the in-progress rename/delete UI
 * state for the row currently being edited.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, X, MessageSquare, Loader2 } from "lucide-react";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";

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
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

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

  const visible = conversations.filter(c => !c.archivedAt);

  return (
    <div
      role="tablist"
      aria-label="光球對話分頁"
      data-testid="conversation-tabs"
      className="flex items-center gap-1.5 overflow-x-auto py-1.5 px-1 scrollbar-thin"
    >
      {visible.length === 0 && (
        <div className="text-xs text-slate-400 px-2 py-1">
          還沒有對話 — 點 + 開新對話
        </div>
      )}
      {visible.map(conv => {
        const isActive = conv.conversationId === activeConversationId;
        const isRenaming = renamingId === conv.conversationId;
        const isPending = pendingId === conv.conversationId;
        return (
          <div
            key={conv.conversationId}
            role="tab"
            aria-selected={isActive}
            data-testid={`conversation-tab-${conv.conversationId}`}
            className={[
              "group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors max-w-[180px]",
              isActive
                ? "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-900/30 dark:border-emerald-600/60 dark:text-emerald-200"
                : "bg-white/70 border-slate-200/80 text-slate-600 hover:bg-slate-50 hover:border-slate-300 dark:bg-slate-800/60 dark:border-slate-700/70 dark:text-slate-300 dark:hover:bg-slate-700/60",
            ].join(" ")}
          >
            <MessageSquare
              className={`w-3 h-3 shrink-0 ${
                isActive ? "text-emerald-500" : "text-slate-400"
              }`}
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
                title={`${conv.title}${
                  conv.messageCount ? ` · ${conv.messageCount} 則` : ""
                }（雙擊重新命名）`}
              >
                {conv.title || "新對話"}
              </button>
            )}
            {isPending ? (
              <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
            ) : (
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  void handleDelete(conv.conversationId, conv.title);
                }}
                className={[
                  "rounded p-0.5 -mr-1 transition-opacity",
                  isActive
                    ? "opacity-60 hover:opacity-100 hover:bg-emerald-100 dark:hover:bg-emerald-800/40"
                    : "opacity-0 group-hover:opacity-60 hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-700",
                ].join(" ")}
                aria-label={`刪除對話：${conv.title}`}
                title="刪除這個對話"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={pendingId === "__new__"}
        data-testid="conversation-tab-new"
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-400 hover:border-emerald-400 hover:text-emerald-600 dark:hover:border-emerald-500 dark:hover:text-emerald-300 transition-colors disabled:opacity-50"
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
  );
}

export default ConversationTabs;
