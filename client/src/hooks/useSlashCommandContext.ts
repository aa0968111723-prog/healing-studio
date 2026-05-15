/**
 * useSlashCommandContext — 把現有的 GlobalOrbChat / wouter / trpc / toast
 * 接成 slashCommandRunner 需要的 SlashCommandContext。
 *
 * 用法：
 *   const slashCtx = useSlashCommandContext();
 *   await runSlashCommand(input, slashCtx);
 *
 * 抽成 hook 而不是寫在每個頁面，是因為這些動作的「正確接法」散在 4 個
 * 地方：sendMessage 走 globalChat、navigate 走 wouter、清記憶走 trpc
 * mutation、開 ⌘K 走 window.dispatchEvent。Hook 把整合點集中在一處，
 * AgentChat / ProactiveOrbWidget / 未來新增的 chat 入口都可以重用。
 */

import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import { trpc } from "@/lib/trpc";
import type { SlashCommandContext } from "@/lib/slashCommandRunner";

export function useSlashCommandContext(): SlashCommandContext {
  const [, setLocation] = useLocation();
  const globalChat = useGlobalOrbChat();
  const utils = trpc.useUtils();
  const clearMemoryMutation = trpc.orbProxy.clearAllPreferenceMemory.useMutation();

  const navigate = useCallback(
    (path: string) => {
      setLocation(path);
    },
    [setLocation]
  );

  const showMemory = useCallback(() => {
    // 沿用既有「打 phrase 進 chat 觸發 OrbMemoryDashboard」流程，避免另外
    // 建一條獨立 UI；clearMemory 的「光球記得我什麼」phrase 走過驗證了。
    globalChat.open();
    void globalChat.sendMessage("光球記得我什麼？");
  }, [globalChat]);

  const exportChatPdf = useCallback(() => {
    // 透過既有 sendMessage + [ACTION:exportChatPdf] 路徑；但這條路會被
    // server LLM 攔截。較直接的作法：直接觸發 globalChat 的內建 phrase
    // — 同 CommandPalette 的「匯出今天的對話成 PDF」。
    globalChat.open();
    void globalChat.sendMessage("把今天的對話匯出成 PDF");
  }, [globalChat]);

  const shareLastWorkflow = useCallback(() => {
    globalChat.open();
    void globalChat.sendMessage("把剛剛的流程做成連結");
  }, [globalChat]);

  const clearMemory = useCallback(async () => {
    const result = await clearMemoryMutation.mutateAsync();
    // 清完之後讓畫面上的「光球記得什麼」儀表板重新抓
    void utils.orbProxy.getRememberedPreferences.invalidate();
    return { removed: result.removed ?? 0 };
  }, [clearMemoryMutation, utils.orbProxy.getRememberedPreferences]);

  const openCommandPalette = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("open-command-palette"));
    }
  }, []);

  const openCodex = useCallback(
    (query?: string) => {
      const trimmed = (query ?? "").trim();
      const path = trimmed ? `/codex?q=${encodeURIComponent(trimmed)}` : "/codex";
      setLocation(path);
    },
    [setLocation]
  );

  return useMemo<SlashCommandContext>(
    () => ({
      sendMessage: (text, attachments, options) =>
        globalChat.sendMessage(text, attachments, options),
      navigate,
      openChat: globalChat.open,
      toast: {
        info: (m: string) => toast.info(m),
        success: (m: string) => toast.success(m),
        error: (m: string) => toast.error(m),
      },
      resetConversation: globalChat.resetConversation,
      createConversation: globalChat.createConversation,
      clearMemory,
      showMemory,
      exportChatPdf,
      shareLastWorkflow,
      openCommandPalette,
      openCodex,
    }),
    [
      globalChat.sendMessage,
      globalChat.open,
      globalChat.resetConversation,
      globalChat.createConversation,
      navigate,
      clearMemory,
      showMemory,
      exportChatPdf,
      shareLastWorkflow,
      openCommandPalette,
      openCodex,
    ]
  );
}
