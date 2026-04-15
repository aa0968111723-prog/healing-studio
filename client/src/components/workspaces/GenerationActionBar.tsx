import { type ActionMode, type WorkspaceMode } from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import {
  Wand2,
  RefreshCw,
  GitBranch,
  GraduationCap,
  Wrench,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface GenerationActionBarProps {
  actionMode: ActionMode;
  onActionModeChange: (mode: ActionMode) => void;
  /** @deprecated Use creativeMode in Studio instead. Still accepted for backwards compat. */
  workspaceMode?: WorkspaceMode;
  /** @deprecated Use creativeMode in Studio instead. */
  onWorkspaceModeChange?: (mode: WorkspaceMode) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  hasResult: boolean;
  /** When true, render a bigger more prominent generate button (zen mode) */
  zenMode?: boolean;
}

const actionModes = [
  {
    mode: "generate" as const,
    label: "生成",
    Icon: Wand2,
    activeColor: "bg-emerald-600 text-white shadow-emerald-500/30",
    description: "第一次生成 — 根據所有設定產出新作品",
    buttonLabel: "開始創作",
    alwaysEnabled: true,
  },
  {
    mode: "refine" as const,
    label: "精修",
    Icon: RefreshCw,
    activeColor: "bg-blue-600 text-white shadow-blue-500/30",
    description: "精修模式 — 保留核心內容，只修改局部條件",
    buttonLabel: "精修生成",
    alwaysEnabled: false,
  },
  {
    mode: "branch" as const,
    label: "分支",
    Icon: GitBranch,
    activeColor: "bg-violet-600 text-white shadow-violet-500/30",
    description: "分支模式 — 從當前結果另開新方向探索",
    buttonLabel: "分支生成",
    alwaysEnabled: false,
  },
] satisfies Array<{
  mode: ActionMode;
  label: string;
  Icon: typeof Wand2;
  activeColor: string;
  description: string;
  buttonLabel: string;
  alwaysEnabled: boolean;
}>;

const workspaceModes = [
  {
    mode: "beginner" as const,
    label: "初學者",
    Icon: GraduationCap,
    description: "精簡介面，推薦值與範本",
  },
  {
    mode: "advanced" as const,
    label: "進階",
    Icon: Wrench,
    description: "完整欄位、編譯預覽、權重控制",
  },
] satisfies Array<{
  mode: WorkspaceMode;
  label: string;
  Icon: typeof GraduationCap;
  description: string;
}>;

export function GenerationActionBar({
  actionMode,
  onActionModeChange,
  workspaceMode,
  onWorkspaceModeChange,
  onGenerate,
  isGenerating,
  hasResult,
  zenMode = false,
}: GenerationActionBarProps) {
  const current = actionModes.find((a) => a.mode === actionMode) ?? actionModes[0];
  const currentWsMode = workspaceModes.find((w) => w.mode === workspaceMode) ?? workspaceModes[0];

  /* Zen mode: only show the big generate button */
  if (zenMode) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full h-14 rounded-2xl text-base font-semibold shadow-lg hover:shadow-xl transition-all bg-emerald-600 hover:bg-emerald-500"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Wand2 className="mr-2 h-5 w-5" />
          )}
          {isGenerating ? "生成中…" : "開始創作"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Action mode selector */}
      <div className="flex gap-1.5 rounded-xl bg-white/5 backdrop-blur-sm p-1">
        {actionModes.map(({ mode, label, Icon, activeColor, alwaysEnabled }) => {
          const enabled = alwaysEnabled || hasResult;
          const active = actionMode === mode;
          return (
            <button
              key={mode}
              disabled={!enabled}
              onClick={() => onActionModeChange(mode)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all",
                active
                  ? cn(activeColor, "shadow-sm")
                  : "text-white/60 hover:text-white/90 hover:bg-white/10",
                !enabled && "opacity-40 cursor-not-allowed",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Description */}
      <p className="text-[11px] text-white/50 text-center leading-relaxed">
        {current.description}
      </p>

      {/* Main generate button */}
      <Button
        className={cn(
          "w-full h-11 rounded-xl text-sm font-medium shadow-md hover:shadow-lg transition-all",
          actionMode === "generate" && "bg-emerald-600 hover:bg-emerald-500",
          actionMode === "refine" && "bg-blue-600 hover:bg-blue-500",
          actionMode === "branch" && "bg-violet-600 hover:bg-violet-500",
        )}
        disabled={isGenerating}
        onClick={onGenerate}
      >
        {isGenerating ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <current.Icon className="mr-2 h-4 w-4" />
        )}
        {isGenerating ? "生成中…" : current.buttonLabel}
      </Button>

      {/* Workspace mode toggle — hidden when creativeMode is used in Studio */}
      {onWorkspaceModeChange && (
        <div className="space-y-1.5">
          <div className="flex gap-1 rounded-lg bg-white/5 backdrop-blur-sm p-0.5">
            {workspaceModes.map(({ mode, label, Icon }) => {
              const active = workspaceMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => onWorkspaceModeChange(mode)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all",
                    active
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/50 hover:text-white/80 hover:bg-white/5",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-white/40 text-center">
            {currentWsMode.description}
          </p>
        </div>
      )}
    </div>
  );
}
