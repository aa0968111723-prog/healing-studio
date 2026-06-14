// ============================================================================
// shells/video/console/ProjectFlowGuide.tsx — I-6 創作流程嚮導（AIDV-84 · Phase 1 唯讀）
// ----------------------------------------------------------------------------
// 【定位】把「創作專案」做成影片工作流的主入口：在 Story Spine 頂端顯示一條
//   世界觀 → 劇本 → 分鏡 → 生成 的四步脊椎，每步狀態由既有專案資料即時推導，並
//   一鍵切到對應的中欄畫布。讓使用者隨時知道「我在工作流的哪一步、下一步點哪」，
//   且世界上下文（I-2 風格注入 / 連結的世界 framework）一路被帶著走 —— 這正是
//   「Creative Projects 成為影片工作流主入口」的可見化。
//
// 【Phase 1 邊界】純唯讀導航：只讀 useProjectSpine() 的 project 與 useDirectorConsole()
//   的畫布切換；不寫任何後端、不改既有生成/確認門行為。Phase 2（待 Bruce 拍板）才把
//   「新專案 → 選世界 → 自動分鏡 → 預載世界上下文」串成單一引導動作鏈。
//
// 【旗標】掛載端（StorySpineColumn）以 ENABLE_PROJECT_HUB 守門，預設 OFF＝不渲染＝
//   零行為改變；本元件本身不持有旗標，純呈現。
// ============================================================================
import { useMemo, type ReactNode } from "react";
import { Globe2, FileText, LayoutGrid, Sparkles, Check, ChevronRight, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole, type CanvasMode } from "../DirectorConsoleProvider";
import { ENABLE_WORLD_STYLE_INJECTION } from "@/config/videoFlags";
import { countGate } from "@/spine/gate";

interface FlowStep {
  id: string;
  name: string;
  icon: ReactNode;
  done: boolean;
  detail: string;
  /** 點擊切到的中欄畫布；無＝此步唯狀態（如世界觀在世界觀頁建立，座艙內不接管）。 */
  canvasMode?: CanvasMode;
  hint?: string;
}

export function ProjectFlowGuide() {
  const { project } = useProjectSpine();
  const console_ = useDirectorConsole();

  const steps = useMemo<FlowStep[]>(() => {
    if (!project) return [];
    const gate = countGate(project.shots, project.characters, project.scenes);
    const worldLinked = project.worldFrameworkId != null;
    const hasScript = project.stageIndex >= 1 || project.shots.length > 0 || project.logline.trim().length > 0;
    const hasShots = project.shots.length > 0;
    const generated = project.assets.length > 0 || project.shots.some((s) => s.gen.status === "done");

    return [
      {
        id: "world",
        name: "世界觀",
        icon: <Globe2 className="size-3.5" />,
        done: worldLinked,
        detail: worldLinked
          ? `已連結世界 #${project.worldFrameworkId}${ENABLE_WORLD_STYLE_INJECTION && project.worldStyle ? " · 風格自動注入" : ""}`
          : "尚未連結世界（到世界觀建立角色／場景後回填）",
        hint: worldLinked ? undefined : "連結世界後，自動分鏡骨架與生成會帶入該世界的風格與角色一致性。",
      },
      {
        id: "script",
        name: "劇本",
        icon: <FileText className="size-3.5" />,
        done: hasScript,
        detail: hasScript ? "已有劇本意圖" : "用一句話生成初稿，或貼長腳本匯入",
        canvasMode: "script",
      },
      {
        id: "storyboard",
        name: "分鏡",
        icon: <LayoutGrid className="size-3.5" />,
        done: hasShots,
        detail: hasShots ? `${project.shots.length} 鏡 · ${project.scenes.length} 景` : "從劇本一鍵自動分鏡骨架",
        canvasMode: hasShots ? "shot" : "script",
      },
      {
        id: "generate",
        name: "生成",
        icon: <Sparkles className="size-3.5" />,
        done: generated,
        detail: generated
          ? `${project.assets.length} 件素材${gate.ready > 0 ? ` · 另 ${gate.ready} 鏡就緒` : ""}`
          : gate.ready > 0 ? `${gate.ready} 鏡就緒可生成` : "先讓角色／場景就緒",
        canvasMode: "shot",
      },
    ];
  }, [project]);

  if (!project || steps.length === 0) return null;

  const currentIdx = steps.findIndex((s) => !s.done);
  const allDone = currentIdx === -1;

  return (
    <div className="rounded-xl border bg-card/50 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Route className="size-3.5 text-primary" /> 創作流程
        <span className="ml-auto text-[10px]">
          {allDone ? "全部就緒" : `下一步：${steps[currentIdx].name}`}
        </span>
      </div>
      <ol className="space-y-1">
        {steps.map((st, i) => {
          const isCurrent = i === currentIdx;
          const clickable = !!st.canvasMode;
          const inner: ReactNode = (
            <>
              <span
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px]",
                  st.done
                    ? "bg-primary/15 text-primary"
                    : isCurrent
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {st.done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  {st.icon}
                  {st.name}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{st.detail}</span>
              </span>
              {clickable && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
            </>
          );
          const className = cn(
            "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-healing",
            isCurrent ? "border-primary bg-primary/10" : "border-transparent",
            clickable && !isCurrent && "hover:border-border hover:bg-muted/50",
          );
          return (
            <li key={st.id}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => console_.setCanvasMode(st.canvasMode!)}
                  title={st.hint ?? `前往「${st.name}」`}
                  className={className}
                >
                  {inner}
                </button>
              ) : (
                <div title={st.hint} className={cn(className, "cursor-default")}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default ProjectFlowGuide;
