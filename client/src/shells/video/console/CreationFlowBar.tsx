// ============================================================================
// shells/video/console/CreationFlowBar.tsx — 頂部創作流程列 ＋ 常駐確認門/成本儀表
// ----------------------------------------------------------------------------
// 一體成形主軸：頂部流程列串起子系統（點階段 → 切中欄畫布，不整頁離場）。常駐儀表＝
//   確認門讀數 + 成本階梯（provider 階梯／估點／退款風險），只有高成本/刪除/權限才用 modal。
// 流程列反映「可設定工作流」當前啟用步驟集（console_.steps）。
// ============================================================================
import { useMemo } from "react";
import { Wand2, Zap, Wrench, Check, Coins } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { countGate, isShotGeneratable } from "@/spine/gate";
import { ReadinessChip } from "./ReadinessChip";
import type { ProviderId } from "@/spine/types";
// U-2（AIDV-92）逐殼採用 · /video S2：旗標 ON 時頂部創作流程列改用 design-kit 亮色暖光 FlowBar
// （與 ReadinessChip／ShotPanel／ConfirmGate 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝沿用既有版＝零變化。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, FlowBar as DkFlowBar } from "@/components/design-kit";

/** 生成引擎成本階梯（B 案；對齊原型 PROVIDERS · $/張）。 */
const PROVIDER_LADDER: { id: ProviderId; label: string; cost: number }[] = [
  { id: "hf", label: "HF", cost: 0.012 },
  { id: "gemini", label: "Gemini", cost: 0.02 },
  { id: "fal", label: "fal", cost: 0.04 },
  { id: "mock", label: "Mock", cost: 0 },
];

export function CreationFlowBar({ onGuided }: { onGuided: () => void }) {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;

  const gate = useMemo(() => countGate(p.shots, p.characters, p.scenes), [p]);
  // 可排程數＝與 spine.scheduleGeneration 同一判準（就緒、未過期、未生成），避免「按鈕顯示 N 但點了說沒有」。
  const schedulable = useMemo(
    () => p.shots.filter((s) => isShotGeneratable(s, p.characters, p.scenes) && s.gen.status !== "done").length,
    [p],
  );
  const activeSteps = useMemo(() => console_.steps.filter((s) => s.enabled), [console_.steps]);

  return (
    <Card className="glass-card-static">
      <CardContent className="space-y-3 py-3">
        {/* 創作流程列（一體成形主軸） */}
        <div className="flex flex-wrap items-center gap-2">
          {ENABLE_AIDV_CHROME ? (
            // 旗標 ON：頂部流程列改用 design-kit FlowBar（薄 adapter WorkflowStep→DkWorkflowStep 取 4 欄）。
            // current＝目前畫布模式對應的啟用步驟索引（找不到退 0）；onJump 接回既有「待後端 toast / setCanvasMode」。
            <AidvKit className="flex flex-1">
              <DkFlowBar
                steps={activeSteps.map((s) => ({ id: s.id, name: s.name, required: s.required, enabled: s.enabled }))}
                current={Math.max(0, activeSteps.findIndex((s) => s.canvasMode === console_.canvasMode))}
                onJump={(i) => {
                  const st = activeSteps[i];
                  if (!st) return;
                  if (st.pending) { toast(`「${st.name}」待後端`, { description: "此步驟尚無後端接點，先佔位。" }); return; }
                  if (st.canvasMode) console_.setCanvasMode(st.canvasMode);
                }}
              />
            </AidvKit>
          ) : (
            <ol className="flex flex-1 flex-wrap items-center gap-1">
              {activeSteps.map((st, i) => {
                const active = st.canvasMode === console_.canvasMode;
                const done = i < p.stageIndex;
                return (
                  <li key={st.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (st.pending) { toast(`「${st.name}」待後端`, { description: "此步驟尚無後端接點，先佔位。" }); return; }
                        if (st.canvasMode) console_.setCanvasMode(st.canvasMode);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-healing",
                        active && "bg-primary text-primary-foreground shadow-sm",
                        !active && done && "bg-primary/15 text-primary",
                        !active && !done && "bg-muted text-muted-foreground hover:bg-muted/70",
                      )}
                      title={st.pending ? "待後端" : undefined}
                    >
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-background/30 text-[10px]">
                        {done ? <Check className="size-3" /> : i + 1}
                      </span>
                      {st.name}
                      {!st.required && <span className="text-[9px] opacity-70">可選</span>}
                    </button>
                    {i < activeSteps.length - 1 && <span className="mx-0.5 h-px w-3 bg-border" aria-hidden />}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => console_.openDrawer("workflow")}>
              <Wrench className="size-4" /> 工作流
            </Button>
            <Button variant="outline" size="sm" onClick={onGuided}>
              <Wand2 className="size-4" /> 引導式創作
            </Button>
            <Button size="sm" onClick={() => spine.scheduleGeneration()} disabled={schedulable === 0}>
              <Zap className="size-4" /> 生成就緒鏡（{schedulable}）
            </Button>
          </div>
        </div>

        {/* 常駐確認門 + 成本儀表 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">確認門</span>
            <ReadinessChip state="ready" label={`可量產 ${gate.ready}`} />
            <ReadinessChip state="partial" label={`部分 ${gate.partial}`} />
            <ReadinessChip state="blocked" label={`擋下 ${gate.blocked}`} />
          </div>

          <div className="flex items-center gap-1.5">
            <Coins className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">成本階梯</span>
            {PROVIDER_LADDER.map((pv) => (
              <button
                key={pv.id}
                type="button"
                onClick={() => spine.setProvider(pv.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[10px] transition-healing",
                  spine.provider === pv.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
                title={`切換生成引擎 → ${pv.label}`}
              >
                {pv.label} ${pv.cost}
              </button>
            ))}
          </div>

          <span className="text-muted-foreground">
            先估成本 · 失敗 <span className="text-emerald-600 dark:text-emerald-400">全額退還</span>
            {gate.stale > 0 && <span className="ml-2 text-amber-600 dark:text-amber-400">· {gate.stale} 鏡過期</span>}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default CreationFlowBar;
