import { memo, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowDown,
  Compass,
  Cpu,
  Download,
  LayoutGrid,
  Link2,
  ListChecks,
  Pencil,
  Sliders,
  Sparkles,
  Target,
  PlayCircle,
  RotateCcw,
  PanelTopOpen,
  Search,
  ToggleRight,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AgentAction } from "../../../../shared/agent-actions";
import { getPageLabelByPath } from "@/lib/orbChatHelpers";
import { cn } from "@/lib/utils";

/**
 * OrbActionFlow — 把光球回覆的 AgentAction[] 用「圖示流程圖」呈現。
 *
 * 文字描述抽象時，使用者通常難以一眼看懂引導路徑；這個元件把每一步
 * 動作對應到一個 Lucide 圖示卡片，並用箭頭連接，讓「先去哪、再做什
 * 麼、最後送出」的心智地圖一目瞭然。
 *
 * 設計：
 *   - 垂直排列（聊天面板很窄），每張卡片：序號 + 圖示 + 標籤 + 細節。
 *   - 步驟之間有 ArrowDown 連接線，最末步加 ✨ 表示完成點。
 *   - 兩種主題：light（白底，用於 ProactiveOrbWidget）與 dark
 *     （半透明深底，用於 OrbGuidePanel）。
 *   - prefers-reduced-motion 時退化為瞬時呈現。
 */

export type OrbActionFlowTheme = "light" | "dark";

interface ActionVisual {
  icon: LucideIcon;
  label: string;
  detail?: string;
}

function visualForAction(action: AgentAction): ActionVisual {
  switch (action.type) {
    case "navigate": {
      const label = getPageLabelByPath(action.path);
      return {
        icon: Compass,
        label: label ? `前往 ${label}` : "前往頁面",
        detail: action.path,
      };
    }
    case "setModel":
      return { icon: Cpu, label: "選擇模型", detail: action.modelId };
    case "setTab":
      return { icon: LayoutGrid, label: "切換分頁", detail: action.tabId };
    case "setMode":
      return { icon: Sliders, label: "切換模式", detail: action.modeId };
    case "setModality":
      return {
        icon: Sparkles,
        label: "切換創作類型",
        detail: action.modality,
      };
    case "fillPrompt":
      return {
        icon: Pencil,
        label: action.append ? "追加提示詞" : "填入提示詞",
        detail: action.text?.slice(0, 28),
      };
    case "setParam":
      return {
        icon: Sliders,
        label: "調整參數",
        detail: `${action.key}${action.value !== undefined ? ` = ${String(action.value).slice(0, 18)}` : ""}`,
      };
    case "applyPreset":
      return { icon: Sparkles, label: "套用預設", detail: action.presetId };
    case "submit":
      return { icon: PlayCircle, label: "送出生成" };
    case "reset":
      return { icon: RotateCcw, label: "重設表單" };
    case "openDialog":
      return {
        icon: PanelTopOpen,
        label: "開啟對話框",
        detail: action.dialogId,
      };
    case "search":
      return {
        icon: Search,
        label: "搜尋",
        detail: action.query,
      };
    case "toggleSetting":
      return {
        icon: ToggleRight,
        label: "切換設定",
        detail: `${action.key}${action.value !== undefined ? ` → ${action.value ? "開" : "關"}` : ""}`,
      };
    case "focusElement":
      return {
        icon: Target,
        label: "聚焦元素",
        detail: action.elementId,
      };
    case "runWorkflow":
      return {
        icon: Workflow,
        label: action.name || "執行工作流",
        detail: `${action.steps?.length ?? 0} 步`,
      };
    case "exportChatPdf":
      return {
        icon: Download,
        label: "匯出聊天 PDF",
        detail: action.scope ?? "all",
      };
    case "shareViaLink":
      return {
        icon: Link2,
        label: "產生分享連結",
        detail: action.target,
      };
    default:
      return { icon: ListChecks, label: (action as { type: string }).type };
  }
}

const THEME_CLASSES: Record<
  OrbActionFlowTheme,
  {
    container: string;
    header: string;
    headerIcon: string;
    card: string;
    iconWrap: string;
    iconStroke: string;
    label: string;
    detail: string;
    badge: string;
    arrow: string;
    finish: string;
  }
> = {
  light: {
    container:
      "rounded-xl border border-emerald-200/60 bg-gradient-to-b from-emerald-50/70 to-white/90 px-2.5 py-2.5",
    header: "text-[11px] text-emerald-700 font-medium",
    headerIcon: "text-emerald-500",
    card:
      "flex items-start gap-2 rounded-lg border border-emerald-100/80 bg-card px-2 py-1.5 shadow-sm",
    iconWrap: "p-1.5 rounded-md bg-emerald-100",
    iconStroke: "text-emerald-700",
    label: "text-[11px] font-medium text-foreground leading-tight",
    detail: "text-[10px] text-muted-foreground truncate",
    badge:
      "w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-semibold flex items-center justify-center shrink-0 mt-0.5",
    arrow: "text-emerald-300",
    finish: "text-emerald-500",
  },
  dark: {
    container:
      "rounded-xl border border-white/10 bg-gradient-to-b from-white/5 to-white/0 px-2.5 py-2.5",
    header: "text-[11px] text-white/65 font-medium",
    headerIcon: "text-cyan-200",
    card:
      "flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5",
    iconWrap: "p-1.5 rounded-md bg-cyan-300/15",
    iconStroke: "text-cyan-100",
    label: "text-[11px] font-medium text-white/90 leading-tight",
    detail: "text-[10px] text-white/55 truncate",
    badge:
      "w-4 h-4 rounded-full bg-cyan-300/25 border border-cyan-200/40 text-cyan-100 text-[9px] font-semibold flex items-center justify-center shrink-0 mt-0.5",
    arrow: "text-white/25",
    finish: "text-amber-200",
  },
};

interface Props {
  actions: AgentAction[];
  /** 顏色主題：聊天泡泡是淺色用 light；引導面板深色用 dark。 */
  theme?: OrbActionFlowTheme;
  /** 最多顯示幾步（防止超長 LLM 計畫塞爆面板）。 */
  maxSteps?: number;
  /** 標題（預設「圖示流程圖」）；傳空字串可隱藏 header。 */
  title?: string;
  className?: string;
}

const OrbActionFlow = memo(function OrbActionFlow({
  actions,
  theme = "light",
  maxSteps = 5,
  title = "圖示流程圖",
  className,
}: Props) {
  const reduceMotion = useReducedMotion() ?? false;
  const t = THEME_CLASSES[theme];

  const visibleSteps = useMemo(() => {
    if (!actions || actions.length === 0) return [];
    return actions.slice(0, maxSteps).map(visualForAction);
  }, [actions, maxSteps]);

  if (visibleSteps.length === 0) return null;

  const overflow = Math.max(0, actions.length - visibleSteps.length);

  return (
    <div
      className={cn(t.container, className)}
      role="group"
      aria-label={title || "光球引導流程"}
    >
      {title ? (
        <div className="flex items-center gap-1.5 mb-1.5">
          <Workflow className={cn("w-3 h-3", t.headerIcon)} aria-hidden />
          <p className={t.header}>{title}</p>
        </div>
      ) : null}

      <ol className="space-y-1">
        {visibleSteps.map((step, idx) => {
          const Icon = step.icon;
          const isLast = idx === visibleSteps.length - 1 && overflow === 0;
          return (
            <li key={`${step.label}-${idx}`} className="space-y-1">
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: reduceMotion ? 0 : idx * 0.05,
                  duration: reduceMotion ? 0.15 : 0.25,
                }}
                className={t.card}
              >
                <span className={t.badge} aria-hidden>
                  {idx + 1}
                </span>
                <div className={cn(t.iconWrap, "shrink-0")} aria-hidden>
                  <Icon className={cn("w-3.5 h-3.5", t.iconStroke)} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={t.label}>{step.label}</p>
                  {step.detail ? (
                    <p className={t.detail}>{step.detail}</p>
                  ) : null}
                </div>
                {isLast ? (
                  <Sparkles className={cn("w-3 h-3", t.finish)} aria-hidden />
                ) : null}
              </motion.div>
              {idx < visibleSteps.length - 1 && (
                <div className="flex justify-center" aria-hidden>
                  <ArrowDown className={cn("w-3 h-3", t.arrow)} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {overflow > 0 ? (
        <p
          className={cn(
            "mt-1.5 text-center",
            theme === "light" ? "text-[10px] text-muted-foreground/70" : "text-[10px] text-white/40"
          )}
        >
          …還有 {overflow} 步
        </p>
      ) : null}
    </div>
  );
});

export default OrbActionFlow;
