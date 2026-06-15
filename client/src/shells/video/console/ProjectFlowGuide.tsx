// ============================================================================
// shells/video/console/ProjectFlowGuide.tsx — I-6 創作流程嚮導（AIDV-84）
// ----------------------------------------------------------------------------
// 【北極星對位】把「創作專案」做成影片工作流的主入口，並讓嚮導鏡像北極星 DoD：
//   一句話 → 成片。五步脊椎＝世界觀 → 劇本 → 分鏡 → 生成 → 成片（對映 creative_projects
//   .stageIndex 0..4 的階段語意）。每步狀態由既有專案資料即時推導。
//
// 【Phase 1（唯讀導航）】每步一鍵切到對應中欄畫布；世界上下文（I-2 風格注入／連結世界
//   framework）一路可見。
// 【Phase 2（動作化／動作鏈）】「下一步」給一顆主要動作鈕，直接執行該步動作：
//   劇本/分鏡 → 開引導式創作（onGuided）；生成 → 一鍵排程就緒鏡（spine.scheduleGeneration，
//   走既有確認門＋先估成本）。世界自動連結與成片匯出＝待後端（Phase 2b），維持唯狀態、不假裝。
//
// 純前端、唯讀消費既有脊椎資料與既有動作；不改 Sense/生成合約、零新後端、零金鑰。
//
// 【旗標】掛載端（StorySpineColumn）以 ENABLE_PROJECT_HUB 守門，預設 OFF＝不渲染＝
//   線上零變化；本元件本身不持有旗標，純呈現。
// ============================================================================
import { useMemo, type ReactNode } from "react";
import { Globe2, FileText, LayoutGrid, Sparkles, Clapperboard, Check, ChevronRight, ArrowRight, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole, type CanvasMode } from "../DirectorConsoleProvider";
import { ENABLE_WORLD_STYLE_INJECTION } from "@/config/videoFlags";
import { countGate, isShotGeneratable } from "@/spine/gate";
import { WorldLinkPicker } from "./WorldLinkPicker";

type StepId = "world" | "script" | "storyboard" | "generate" | "film";

interface FlowStep {
  id: StepId;
  name: string;
  icon: ReactNode;
  done: boolean;
  detail: string;
  /** 點擊切到的中欄畫布；無＝此步唯狀態（世界觀在世界觀頁建立、成片匯出待後端）。 */
  canvasMode?: CanvasMode;
  hint?: string;
}

export function ProjectFlowGuide({ onGuided }: { onGuided?: () => void }) {
  const spine = useProjectSpine();
  const project = spine.project;
  const console_ = useDirectorConsole();

  // 可排程數＝與 spine.scheduleGeneration / CreationFlowBar 同判準（就緒、未過期、未生成）。
  const schedulable = useMemo(
    () => (project ? project.shots.filter((s) => isShotGeneratable(s, project.characters, project.scenes) && s.gen.status !== "done").length : 0),
    [project],
  );

  const steps = useMemo<FlowStep[]>(() => {
    if (!project) return [];
    const gate = countGate(project.shots, project.characters, project.scenes);
    const worldLinked = project.worldFrameworkId != null;
    const hasScript = project.stageIndex >= 1 || project.shots.length > 0 || project.logline.trim().length > 0;
    const hasShots = project.shots.length > 0;
    const someGenerated = project.assets.length > 0 || project.shots.some((s) => s.gen.status === "done");
    const allGenerated = hasShots && project.shots.every((s) => s.gen.status === "done");

    return [
      {
        id: "world",
        name: "世界觀",
        icon: <Globe2 className="size-3.5" />,
        done: worldLinked,
        detail: worldLinked
          ? `已連結世界 #${project.worldFrameworkId}${ENABLE_WORLD_STYLE_INJECTION && project.worldStyle ? " · 風格自動注入" : ""}`
          : "尚未連結世界（到世界觀建立角色／場景後回填）",
        hint: worldLinked ? undefined : "連結世界後，自動分鏡與生成會帶入該世界的風格與角色一致性。",
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
        // 完成＝有生成過且「無就緒可排程的剩鏡」（Codex P2：部分生成 S01 done/S02 ready
        // 時不可標完成，否則使用者失去『繼續生成』的工作流提示）。blocked 鏡走確認門另解。
        done: someGenerated && schedulable === 0,
        detail: someGenerated
          ? `${project.assets.length} 件素材${schedulable > 0 ? ` · 另 ${schedulable} 鏡就緒` : ""}`
          : schedulable > 0
            ? `${schedulable} 鏡就緒可生成`
            : `就緒 ${gate.ready}／擋下 ${gate.blocked}（先讓角色／場景就緒）`,
        canvasMode: "shot",
      },
      {
        id: "film",
        name: "成片",
        icon: <Clapperboard className="size-3.5" />,
        done: allGenerated,
        detail: allGenerated ? "全部鏡已生成，可進配音／配樂／匯出" : "所有鏡生成後即可成片",
        hint: "北極星：一句話 → 成片。配音／配樂／匯出為後續階段（待後端）。",
      },
    ];
  }, [project, schedulable]);

  if (!project || steps.length === 0) return null;

  const currentIdx = steps.findIndex((s) => !s.done);
  const allDone = currentIdx === -1;
  const current = allDone ? null : steps[currentIdx];

  // Phase 2 動作鏈：當前步的主要動作（世界連結／成片匯出＝待後端，故唯狀態、無主鈕）。
  let primary: { label: string; run: () => void } | null = null;
  if (current?.id === "script" && onGuided) primary = { label: "開始引導式創作", run: onGuided };
  else if (current?.id === "storyboard" && onGuided) primary = { label: "自動拆分鏡", run: onGuided };
  else if ((current?.id === "generate" || allDone) && schedulable > 0) {
    primary = { label: `生成就緒鏡（${schedulable}）`, run: () => void spine.scheduleGeneration() };
  }

  return (
    <div className="rounded-xl border bg-card/50 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Route className="size-3.5 text-primary" /> 創作流程
        <span className="ml-auto text-[10px]">{allDone ? "🎬 可成片" : `下一步：${current!.name}`}</span>
      </div>

      {primary && (
        <button
          type="button"
          onClick={primary.run}
          className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-healing hover:opacity-90"
        >
          <ArrowRight className="size-3.5" /> {primary.label}
        </button>
      )}

      {/* I-6 Phase 2b（AIDV-100）：世界步為當前步（未連結）時，內嵌世界連結選單 */}
      {current?.id === "world" && <WorldLinkPicker />}

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
