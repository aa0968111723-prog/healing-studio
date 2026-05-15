/**
 * SlashCommandChip — 輸入框內的「目前是 slash 指令」徽章
 *
 * 當使用者輸入字串以 / 開頭且命中已知指令時，在 input 左上角顯示一個
 * 視覺 chip：圖示 + 指令名稱 + 模式色。這樣使用者不用記得自己是不是
 * 已經在「計畫」或「跳頁」模式裡。
 *
 * 與 SlashCommandMenu 互補：menu 是「選什麼」，chip 是「我選了什麼」。
 */

import {
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
  parseSlashInput,
  type SlashCommand,
} from "../../../shared/slash-commands";
import { cn } from "@/lib/utils";

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
};

/** 每個 group 的主色（chip 邊框 + 圖示底）。 */
const GROUP_COLORS: Record<string, string> = {
  mode: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800",
  spirit: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  navigate: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800",
  memory: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  action: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  session: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700",
  help: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
};

interface Props {
  /** 目前 input 完整字串。chip 會自己解析；不命中時 render nothing。 */
  input: string;
  /** 取消 chip（同時清掉輸入框）— 點 chip 上的 X 觸發。 */
  onClear?: () => void;
  className?: string;
}

export function SlashCommandChip({ input, onClear, className }: Props) {
  const parsed = parseSlashInput(input);
  if (!parsed.isCommand || !parsed.matched) return null;
  const cmd: SlashCommand = parsed.matched;
  const Icon = ICON_MAP[cmd.iconKey] ?? Sparkles;
  const colors = GROUP_COLORS[cmd.group] ?? GROUP_COLORS.action;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        colors,
        className
      )}
      data-testid="slash-command-chip"
      data-command={cmd.name}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="font-mono">{cmd.name}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 text-current/70 hover:text-current focus:outline-none"
          aria-label={`清除 ${cmd.name} 指令`}
        >
          ×
        </button>
      )}
    </span>
  );
}
