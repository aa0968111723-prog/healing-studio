/**
 * useSlashCommandMenu — 把 SlashCommandMenu 的「篩選 + 鍵盤導覽 + 套用」三件事
 * 包成一個可重複使用的 hook。任何含 chat-input 的元件都能直接接上。
 *
 * 用法（在 input 旁的 wrapper）：
 *
 *   const slash = useSlashCommandMenu(input, setInput);
 *   <div className="relative">
 *     <SlashCommandMenu {...slash.menuProps} />
 *     <input
 *       value={input}
 *       onChange={e => setInput(e.target.value)}
 *       onKeyDown={e => {
 *         if (slash.handleKeyDown(e)) return; // menu 接走了
 *         // ...原本的 enter-to-send 邏輯
 *       }}
 *     />
 *   </div>
 *
 * 行為：
 *   - 偵測 input 是否以 `/` 開頭 → open=true
 *   - 字串改變時重設 activeIndex
 *   - 上下鍵 / 換頁鍵在 commands 間移動，包到頭尾
 *   - Enter / Tab：套用目前選中的指令（寫回 input + 移游標到尾端 + 關選單）
 *   - Esc：關選單但保留輸入字串（讓使用者選擇手動繼續輸入）
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  parseSlashInput,
  suggestSlashCommands,
  type SlashCommand,
} from "../../../shared/slash-commands";

interface SlashMenuProps {
  open: boolean;
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (cmd: SlashCommand) => void;
  onDismiss: () => void;
  onHoverIndex: (index: number) => void;
}

export interface UseSlashCommandMenuResult {
  /** Spread 給 <SlashCommandMenu /> 用。 */
  menuProps: SlashMenuProps;
  /**
   * 接在 input 的 onKeyDown 上。回傳 true 表示 menu 已經處理掉了這個按鍵
   * （例如 ↑↓ Enter Esc），caller 不該繼續送 Enter→sendMessage 的預設邏輯。
   */
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => boolean;
  /**
   * 在使用者打字之外、外部主動關閉選單時呼叫（例如送出訊息後）。
   * 內部會把 input 沒以 / 開頭時的關閉做好；這 method 是給「就算還在 /
   * 開頭也要強制關掉」的場景用，例如送完訊息之後。
   */
  forceClose: () => void;
  /** 是否有候選命令（給 caller 控制要不要顯示 hint）。 */
  hasCandidates: boolean;
}

export function useSlashCommandMenu(
  input: string,
  setInput: (next: string) => void
): UseSlashCommandMenuResult {
  const parsed = useMemo(() => parseSlashInput(input), [input]);
  const candidates = useMemo<SlashCommand[]>(
    () => (parsed.isCommand ? suggestSlashCommands(parsed.rawName, 20) : []),
    [parsed.isCommand, parsed.rawName]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // 字串改變時重設選中項
  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.rawName, parsed.isCommand]);

  // 字串不再是指令時自動解除 dismissed（讓使用者下次打 / 又能開）
  useEffect(() => {
    if (!parsed.isCommand) setDismissed(false);
  }, [parsed.isCommand]);

  const open = parsed.isCommand && !dismissed && candidates.length > 0;

  const onPick = useCallback(
    (cmd: SlashCommand) => {
      // 寫回輸入框：保留現有 argument；游標放到尾端讓使用者繼續打
      // 如果指令不需 argument，直接整段換成指令名稱即可
      const arg = parsed.argument;
      const next = cmd.takesArgument
        ? `${cmd.name} ${arg}`.trimEnd() + (arg ? "" : " ")
        : cmd.name;
      setInput(next);
      setDismissed(true);
    },
    [parsed.argument, setInput]
  );

  const onDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const onHoverIndex = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const forceClose = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!open) return false;
      const max = candidates.length;
      if (max === 0) return false;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex(i => (i + 1) % max);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex(i => (i - 1 + max) % max);
          return true;
        case "Tab":
          e.preventDefault();
          // Tab = 補全成完整指令名稱（不關選單，方便繼續看候選）
          {
            const cmd = candidates[activeIndex];
            if (cmd) {
              const next = cmd.takesArgument
                ? `${cmd.name} ${parsed.argument}`.trimEnd() + (parsed.argument ? "" : " ")
                : cmd.name;
              setInput(next);
            }
          }
          return true;
        case "Enter":
          // 只有「使用者還沒手動補完整個指令名稱」時才攔 Enter；如果命令已經
          // 完全匹配（parsed.matched 不為 null）且使用者按 Enter，表示他想送出
          // → 不攔，讓 caller 的 sendMessage 邏輯接手。
          if (!parsed.matched) {
            e.preventDefault();
            const cmd = candidates[activeIndex];
            if (cmd) onPick(cmd);
            return true;
          }
          return false;
        case "Escape":
          e.preventDefault();
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [open, candidates, activeIndex, parsed.argument, parsed.matched, onPick, setInput]
  );

  return {
    menuProps: {
      open,
      commands: candidates,
      activeIndex,
      onPick,
      onDismiss,
      onHoverIndex,
    },
    handleKeyDown,
    forceClose,
    hasCandidates: candidates.length > 0,
  };
}
