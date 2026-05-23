/**
 * WorkflowStepper — 導演 AI 一條龍流程指示器
 *
 * 顯示「對話 → 腳本 → 世界觀 → 分鏡 → 生成」五個階段，
 * 每階段都可點擊切到對應 tab，並顯示完成狀態（角色 / 場景 / 分鏡數量）。
 */

import {
  MessageSquare,
  FileText,
  Globe2,
  Camera,
  Sparkles,
  ChevronRight,
} from "lucide-react";

export type WorkflowStep =
  | "chat"
  | "script"
  | "worldbuilding"
  | "storyboard"
  | "generation";

interface StepConfig {
  id: WorkflowStep;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** 切換到哪個 tab（沿用 DirectorAI 既有的 tab 名稱）。 */
  tabId: string;
}

const STEPS: StepConfig[] = [
  { id: "chat", label: "對話", icon: MessageSquare, tabId: "chat" },
  { id: "script", label: "腳本", icon: FileText, tabId: "script" },
  {
    id: "worldbuilding",
    label: "世界觀",
    icon: Globe2,
    tabId: "worldbuilding",
  },
  { id: "storyboard", label: "分鏡", icon: Camera, tabId: "worldbuilding" },
  { id: "generation", label: "生成", icon: Sparkles, tabId: "worldbuilding" },
];

export interface WorkflowStepperProps {
  activeTab: string;
  onSwitch: (tabId: string) => void;
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

function getStepStatus(
  step: WorkflowStep,
  counts: WorkflowStepperProps["counts"]
): "empty" | "partial" | "complete" {
  if (!counts) return "empty";
  switch (step) {
    case "chat":
      return (counts.scripts ?? 0) > 0 ? "complete" : "empty";
    case "script":
      if ((counts.segments ?? 0) === 0) return "empty";
      return "complete";
    case "worldbuilding": {
      const chars = counts.characters ?? 0;
      const scenes = counts.scenes ?? 0;
      if (chars === 0 && scenes === 0) return "empty";
      if (chars > 0 && scenes > 0) return "complete";
      return "partial";
    }
    case "storyboard":
      if ((counts.storyboards ?? 0) === 0) return "empty";
      return "complete";
    case "generation":
      return (counts.generation ?? 0) > 0 ? "complete" : "empty";
  }
}

function statusClasses(
  status: "empty" | "partial" | "complete",
  isActive: boolean
) {
  if (isActive) {
    return "border-primary bg-primary/15 text-primary";
  }
  if (status === "complete") {
    return "border-primary/40 bg-primary/[0.06] text-primary/80 hover:bg-primary/10";
  }
  if (status === "partial") {
    return "border-amber-400/40 bg-amber-50/40 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100/40";
  }
  return "border-border/40 bg-card/30 text-muted-foreground hover:bg-card/60";
}

function stepDetail(
  step: WorkflowStep,
  counts: WorkflowStepperProps["counts"]
): string {
  if (!counts) return "尚未開始";
  switch (step) {
    case "chat":
      return (counts.scripts ?? 0) > 0
        ? `${counts.scripts} 個腳本`
        : "尚未對話";
    case "script":
      return (counts.segments ?? 0) > 0
        ? `${counts.segments} 個分鏡段`
        : "尚未匯入";
    case "worldbuilding": {
      const ch = counts.characters ?? 0;
      const sc = counts.scenes ?? 0;
      if (ch === 0 && sc === 0) return "尚未建立";
      return `${ch} 角色 · ${sc} 場景`;
    }
    case "storyboard":
      return (counts.storyboards ?? 0) > 0
        ? `${counts.storyboards} 個分鏡板`
        : "尚未建立";
    case "generation":
      return (counts.generation ?? 0) > 0
        ? `${counts.generation} 個任務`
        : "尚未開始";
  }
}

export function WorkflowStepper({
  activeTab,
  onSwitch,
  counts,
}: WorkflowStepperProps) {
  return (
    <div className="rounded-2xl border border-border/30 bg-card/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1 shrink-0">
          一條龍流程
        </span>
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const status = getStepStatus(step.id, counts);
          const isActive = activeTab === step.tabId && step.id !== "generation";
          // generation 視為 worldbuilding tab 內的下游階段，不主動標 active
          const detail = stepDetail(step.id, counts);
          return (
            <div key={step.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSwitch(step.tabId)}
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 transition ${statusClasses(status, isActive)}`}
                title={`${step.label}：${detail}`}
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="text-[11px] font-medium">{step.label}</span>
                <span className="text-[9px] opacity-70 hidden sm:inline">
                  {detail}
                </span>
              </button>
              {idx < STEPS.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
