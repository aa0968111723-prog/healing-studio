// ============================================================================
// shells/video/StageBar.tsx — 五階段條 + 旗艦動作（引導式創作 / 生成就緒鏡）
// ----------------------------------------------------------------------------
// 階段：世界觀 → 腳本 → 分鏡 → 生成 → 成片（對映 CreativeProject.stageIndex 0..4）。
// 「生成就緒鏡」數量＝確認門 ready 計數（countGate），點擊走 scheduleGeneration 批次。
// ============================================================================
import { useMemo } from "react";
import { Wand2, Zap, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { countGate } from "@/spine/gate";

const STAGES = ["世界觀", "腳本", "分鏡", "生成", "成片"];

export function StageBar({ onGuided }: { onGuided: () => void }) {
  const spine = useProjectSpine();
  const p = spine.project;
  const gate = useMemo(
    () => (p ? countGate(p.shots, p.characters, p.scenes) : { ready: 0, partial: 0, blocked: 0, stale: 0, total: 0 }),
    [p],
  );
  if (!p) return null;

  return (
    <Card className="glass-card-static">
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <ol className="flex flex-1 flex-wrap items-center gap-1">
          {STAGES.map((st, i) => {
            const done = i < p.stageIndex;
            const cur = i === p.stageIndex;
            return (
              <li key={st} className="flex items-center gap-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-healing",
                    done && "bg-primary/15 text-primary",
                    cur && "bg-primary text-primary-foreground shadow-sm",
                    !done && !cur && "bg-muted text-muted-foreground",
                  )}
                >
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-background/30 text-[10px]">
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  {st}
                </span>
                {i < STAGES.length - 1 && <span className="mx-0.5 h-px w-4 bg-border" aria-hidden />}
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onGuided}>
            <Wand2 className="size-4" /> 引導式創作
          </Button>
          <Button size="sm" onClick={() => spine.scheduleGeneration()} disabled={gate.ready === 0}>
            <Zap className="size-4" /> 生成就緒鏡（{gate.ready}）
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default StageBar;
