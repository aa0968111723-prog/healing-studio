/**
 * SlashCommandMenu — Claude Code 風格的 / 指令自動完成選單
 *
 * 行為：
 *   - 當 chat 輸入字串以 `/` 開頭、且選單被 `open` 控制為 true 時顯示
 *   - 鍵盤導覽：↑↓ 移動、Enter / Tab 套用、Esc 關閉
 *   - 點擊指令會把該指令名稱寫回輸入框（保留游標、保留 argument）
 *   - 視覺：固定在 input 上方的浮動卡片，依分組顯示
 *
 * 設計重點：
 *   - 純展示元件 — 篩選 / 鍵盤狀態都從父層 useSlashCommandMenu hook 來
 *   - 不直接執行指令 — 只負責 `onPick(command)` 回傳事件
 *   - 不依賴 Radix Popover，因為 chat input 本身就是 focused element，
 *     用浮層 div + framer-motion 就夠了；省一個 portal 的麻煩
 */

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Brain,
  Compass,
  CornerUpRight,
  Download,
  HelpCircle,
  Home,
  ListChecks,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";

import {
  SLASH_GROUP_LABELS,
  type SlashCommand,
  type SlashCommandGroup,
} from "../../../shared/slash-commands";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const ICON_MAP: Record<string, typeof Sparkles> = {
  sparkles: Sparkles,
  workflow: Workflow,
  "list-checks": ListChecks,
  "corner-up-right": CornerUpRight,
  "help-circle": HelpCircle,
  compass: Compass,
  home: Home,
  settings: Settings,
  search: Search,
  download: Download,
  "share-2": Share2,
  brain: Brain,
  "trash-2": Trash2,
  plus: Plus,
  "rotate-ccw": RotateCcw,
  users: Users,
  "book-open": BookOpen,
};

function iconFor(iconKey: string) {
  return ICON_MAP[iconKey] ?? Sparkles;
}

interface Props {
  open: boolean;
  /** 篩選後的命令清單，順序＝顯示順序。 */
  commands: SlashCommand[];
  /** 目前選中的索引（在 commands 裡的 index）。 */
  activeIndex: number;
  /** 使用者點擊或按 Enter 確認時。caller 接著決定要寫回輸入框還是執行。 */
  onPick: (cmd: SlashCommand) => void;
  /** 選單關閉（Esc / blur / 點外面） */
  onDismiss: () => void;
  /** 滑鼠 hover 時更新 activeIndex，鍵盤與滑鼠不打架 */
  onHoverIndex: (index: number) => void;
  /** 顯示位置：默認 above（在 input 上方）。 */
  placement?: "above" | "below";
  /** 自訂 className 給容器（覆寫寬度／圓角等）。 */
  className?: string;
}

export function SlashCommandMenu({
  open,
  commands,
  activeIndex,
  onPick,
  onDismiss,
  onHoverIndex,
  placement = "above",
  className,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // 鍵盤導覽時把選中項滾入視野（jsdom 沒有 scrollIntoView，所以要 typeof check）
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-slash-cmd-index="${activeIndex}"]`
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  // Esc 關閉
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onDismiss]);

  // 依 group 分組（保留 commands 的相對順序）
  const groupedCommands = useMemo(() => {
    const map = new Map<SlashCommandGroup, { cmd: SlashCommand; index: number }[]>();
    commands.forEach((cmd, index) => {
      const list = map.get(cmd.group) ?? [];
      list.push({ cmd, index });
      map.set(cmd.group, list);
    });
    return Array.from(map.entries());
  }, [commands]);

  return (
    <AnimatePresence>
      {open && commands.length > 0 && (
        <motion.div
          key="slash-menu"
          initial={{ opacity: 0, y: placement === "above" ? 4 : -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: placement === "above" ? 4 : -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={cn(
            "absolute z-50 left-0 right-0 mx-auto w-[min(100%,28rem)]",
            "rounded-2xl border border-border",
            "bg-white/95 dark:bg-slate-900/95 backdrop-blur-md",
            "shadow-2xl shadow-slate-900/10 dark:shadow-black/40",
            "overflow-hidden",
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2",
            className
          )}
          role="listbox"
          aria-label="Slash 指令"
          data-testid="slash-command-menu"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground">
              Slash 指令
            </span>
            <KbdGroup className="text-muted-foreground">
              <Kbd>
                <ArrowUp />
              </Kbd>
              <Kbd>
                <ArrowDown />
              </Kbd>
              <Kbd>Enter</Kbd>
              <Kbd>Esc</Kbd>
            </KbdGroup>
          </div>
          <div
            ref={listRef}
            className="max-h-[20rem] overflow-y-auto py-1"
          >
            {groupedCommands.map(([group, items]) => (
              <div key={group}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {SLASH_GROUP_LABELS[group] ?? group}
                </div>
                {items.map(({ cmd, index }) => {
                  const Icon = iconFor(cmd.iconKey);
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={cmd.name}
                      type="button"
                      data-slash-cmd-index={index}
                      data-slash-cmd-name={cmd.name}
                      onMouseEnter={() => onHoverIndex(index)}
                      onMouseDown={e => {
                        // mousedown 而不是 click — 避免 input blur 先觸發
                        // 把選單關掉、讓 onClick 來不及觸發
                        e.preventDefault();
                        onPick(cmd);
                      }}
                      className={cn(
                        "w-full flex items-start gap-3 px-3 py-2 text-left transition-colors",
                        "focus:outline-none",
                        isActive
                          ? "bg-emerald-50 dark:bg-emerald-900/20"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      )}
                      role="option"
                      aria-selected={isActive}
                    >
                      <span
                        className={cn(
                          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                          isActive
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-baseline gap-2">
                          <span
                            className={cn(
                              "font-mono text-sm font-medium",
                              isActive
                                ? "text-emerald-700 dark:text-emerald-300"
                                : "text-foreground/90"
                            )}
                          >
                            {cmd.name}
                          </span>
                          {cmd.takesArgument && cmd.argumentHint && (
                            <span className="text-xs text-muted-foreground truncate">
                              {cmd.argumentHint}
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {cmd.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
