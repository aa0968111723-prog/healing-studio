/**
 * WorkflowStepper — 導演 AI 桌面版一條龍流程指示器
 *
 * 把「腳本輸入 → AI 解析 → 解析確認 → 建立分鏡板 → 生成」
 * 呈現成單一可恢復流程。每個階段都會顯示目前狀態、摘要與可回到的入口，
 * 右側主行動則指向當下最值得做的下一步。
 */

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  FileText,
  LoaderCircle,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type { ComponentType } from "react";

export type WorkflowStageId =
  | "input"
  | "parse"
  | "review"
  | "storyboard"
  | "generation";

export type WorkflowStageState =
  | "idle"
  | "ready"
  | "active"
  | "in-progress"
  | "complete"
  | "blocked";

interface StageConfig {
  id: WorkflowStageId;
  label: string;
  helper: string;
  icon: ComponentType<{ className?: string }>;
  tabId: string;
}

const STAGES: StageConfig[] = [
  {
    id: "input",
    label: "輸入腳本",
    helper: "貼上或上傳素材",
    icon: FileText,
    tabId: "script",
  },
  {
    id: "parse",
    label: "AI 解析",
    helper: "拆出角色、場景與鏡頭",
    icon: Sparkles,
    tabId: "script",
  },
  {
    id: "review",
    label: "確認分鏡",
    helper: "補齊欄位並確認內容",
    icon: CheckCircle2,
    tabId: "script",
  },
  {
    id: "storyboard",
    label: "建立分鏡板",
    helper: "套用世界觀並建立工作板",
    icon: Clapperboard,
    tabId: "worldbuilding",
  },
  {
    id: "generation",
    label: "生成畫面",
    helper: "進入影像與影片生成",
    icon: WandSparkles,
    tabId: "worldbuilding",
  },
];

export interface WorkflowStepperProps {
  activeTab: string;
  onSwitch: (tabId: string) => void;
  currentStage?: WorkflowStageId;
  stageStates?: Partial<Record<WorkflowStageId, WorkflowStageState>>;
  stageDetails?: Partial<Record<WorkflowStageId, string>>;
  primaryAction?: {
    label: string;
    disabled?: boolean;
  };
  onPrimaryAction?: () => void;
  /** 舊版 counts API 保留作為其他頁面或舊資料的 fallback。 */
  counts?: Partial<{
    scripts: number;
    segments: number;
    worlds: number;
    characters: number;
    scenes: number;
    storyboards: number;
    generation: number;
  }>;
}

function legacyState(
  stage: WorkflowStageId,
  counts: WorkflowStepperProps["counts"]
): WorkflowStageState {
  if (!counts) return "idle";
  switch (stage) {
    case "input":
      return (counts.scripts ?? 0) > 0 ? "complete" : "idle";
    case "parse":
      return (counts.segments ?? 0) > 0 ? "complete" : "idle";
    case "review":
      return (counts.segments ?? 0) > 0 ? "ready" : "idle";
    case "storyboard":
      return (counts.storyboards ?? 0) > 0 ? "complete" : "idle";
    case "generation":
      return (counts.generation ?? 0) > 0 ? "complete" : "idle";
  }
}

function defaultDetail(
  stage: WorkflowStageId,
  state: WorkflowStageState,
  counts: WorkflowStepperProps["counts"]
): string {
  if (stage === "input") {
    if (state === "complete") return "已送出腳本";
    if (state === "ready") return "草稿已保存";
    return "等待輸入";
  }
  if (stage === "parse") {
    if (state === "in-progress") return "解析中…";
    if ((counts?.segments ?? 0) > 0) return `${counts?.segments} 個段落`;
    return "等待開始";
  }
  if (stage === "review") {
    return state === "complete" ? "內容已確認" : "等待確認";
  }
  if (stage === "storyboard") {
    if (state === "in-progress") return "建立中…";
    if (state === "blocked") return "需要世界觀";
    return (counts?.storyboards ?? 0) > 0 ? "已建立" : "等待建立";
  }
  if (state === "complete") return `${counts?.generation ?? 0} 個任務`;
  return "尚未開始";
}

function statusClasses(
  state: WorkflowStageState,
  isCurrent: boolean
): string {
  if (isCurrent) {
    return "border-primary bg-primary/12 text-primary shadow-[var(--shadow-healing-sm)]";
  }
  if (state === "complete") {
    return "border-emerald-500/35 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-950/20 dark:text-emerald-300";
  }
  if (state === "in-progress") {
    return "border-primary/40 bg-primary/[0.08] text-primary";
  }
  if (state === "ready") {
    return "border-amber-400/45 bg-amber-50/60 text-amber-700 hover:bg-amber-50 dark:bg-amber-950/20 dark:text-amber-300";
  }
  if (state === "blocked") {
    return "border-red-300/50 bg-red-50/60 text-red-700 hover:bg-red-50 dark:bg-red-950/20 dark:text-red-300";
  }
  return "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60";
}

function StatusIcon({
  state,
  className,
}: {
  state: WorkflowStageState;
  className?: string;
}) {
  if (state === "complete") return <Check className={className} />;
  if (state === "in-progress") {
    return <LoaderCircle className={`${className ?? ""} animate-spin`} />;
  }
  if (state === "blocked") return <AlertCircle className={className} />;
  return null;
}

export function WorkflowStepper({
  activeTab,
  onSwitch,
  currentStage,
  stageStates,
  stageDetails,
  primaryAction,
  onPrimaryAction,
  counts,
}: WorkflowStepperProps) {
  return (
    <section
      aria-label="導演 AI 製作流程"
      className="rounded-2xl border border-border/30 bg-card/30 px-3 py-3"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              製作流程
            </span>
            <span className="text-2xs text-muted-foreground/80">
              每一步都可返回修改，草稿會保留
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STAGES.map((stage, idx) => {
              const Icon = stage.icon;
              const state =
                stageStates?.[stage.id] ?? legacyState(stage.id, counts);
              const isCurrent = currentStage === stage.id;
              const detail =
                stageDetails?.[stage.id] ?? defaultDetail(stage.id, state, counts);
              const isActiveTab = activeTab === stage.tabId;
              return (
                <div key={stage.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSwitch(stage.tabId)}
                    aria-current={isCurrent ? "step" : undefined}
                    className={`group flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) ${statusClasses(state, isCurrent || (isActiveTab && !currentStage))}`}
                    title={`${stage.label}：${detail}。${stage.helper}`}
                  >
                    <span className="relative flex h-4 w-4 items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5" />
                      <StatusIcon
                        state={state}
                        className="absolute -right-1.5 -top-1.5 w-2.5 h-2.5 rounded-full bg-background"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold leading-tight whitespace-nowrap">
                        {stage.label}
                      </span>
                      <span className="block text-[9px] leading-tight opacity-70 whitespace-nowrap">
                        {detail}
                      </span>
                    </span>
                  </button>
                  {idx < STAGES.length - 1 && (
                    <ChevronRight className="w-3 h-3 text-muted-foreground/35 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {primaryAction && onPrimaryAction && (
          <button
            type="button"
            onClick={onPrimaryAction}
            disabled={primaryAction.disabled}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-healing-sm)] transition hover:bg-primary/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-healing-strong) focus-visible:ring-offset-2"
          >
            {primaryAction.label}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
