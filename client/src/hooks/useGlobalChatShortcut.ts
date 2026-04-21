/**
 * useGlobalChatShortcut.ts — 全域光球聊天快捷鍵
 * ────────────────────────────────────────────────────────────────────────────
 * 提供全域快捷鍵（Cmd+K / Ctrl+K）來喚起光球聊天面板
 */

import { useEffect } from "react";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";

/**
 * 註冊全域快捷鍵來開啟光球聊天
 * 快捷鍵：Cmd+K (Mac) / Ctrl+K (Windows/Linux)
 */
export function useGlobalChatShortcut() {
  const { toggle, isOpen } = useGlobalOrbChat();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+K (Mac) 或 Ctrl+K (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }

      // ESC 關閉聊天面板
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggle, isOpen]);
}
