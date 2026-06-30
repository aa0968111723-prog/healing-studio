// ============================================================================
// shells/video/console/StageGapWizard.tsx — S2「補齊精靈」對話框（AIDV-95 / U-5）
// ----------------------------------------------------------------------------
// 規格 §2：跳到下游階段但前置缺料時，彈出此精靈列出缺項，提供「回頭引導」（回上一階段
//   補齊）或「就地快速補 / 仍要前往」（非阻斷，不變量＝跳階不丟已完成資料）。
//
// 純展示元件：缺料清單由 stageGate.ts 純函式算好後傳入；本元件不持有業務狀態、不直接讀脊椎，
//   只把使用者選擇（回頭引導 backTo / 仍要前往 proceed）回呼給 CreationFlowBar。
//
// 只在旗標 ENABLE_VIDEO_GATE_KIT ON 時由 CreationFlowBar 掛載；OFF（預設）＝不渲染＝零變化。
// ============================================================================
import { AlertTriangle, ArrowRight, CornerUpLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CanvasMode } from "../DirectorConsoleProvider";
import type { StageGap } from "./stageGate";

export interface StageGapWizardProps {
  open: boolean;
  /** 欲前往的目標畫布人話名稱（標題用）。 */
  targetLabel: string;
  /** stageGate.stageGaps 算出的缺料清單。 */
  gaps: StageGap[];
  /** 關閉（取消）。 */
  onClose: () => void;
  /** 「回頭引導」：切到該缺料的補齊畫布。 */
  onBack: (mode: CanvasMode) => void;
  /** 「仍要前往」：忽略缺料、直接前往目標（非阻斷不變量）。 */
  onProceed: () => void;
}

/** S2 補齊精靈：列缺項 + 回頭引導 / 仍要前往。 */
export function StageGapWizard({
  open, targetLabel, gaps, onClose, onBack, onProceed,
}: StageGapWizardProps) {
  // 第一個缺料的回頭目標＝主要「回頭引導」按鈕（多缺料時各列各自的回頭鈕）。
  const primary = gaps[0];
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" /> 前往「{targetLabel}」前，還有待補
          </DialogTitle>
          <DialogDescription>
            這個階段的前置條件尚未齊備。你可以回頭補齊，或仍要前往（已完成的資料不會遺失）。
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2.5">
          {gaps.map((g) => (
            <li key={g.kind} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <AlertTriangle className="size-3.5 text-amber-500" /> {g.label}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{g.detail}</p>
              {g.refs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.refs.map((r) => (
                    <span
                      key={r.id}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2.5 h-7 gap-1 text-xs"
                onClick={() => onBack(g.backTo)}
              >
                <CornerUpLeft className="size-3.5" /> {g.backToLabel}
              </Button>
            </li>
          ))}
        </ul>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          {primary && (
            <Button variant="secondary" size="sm" className="gap-1" onClick={() => onProceed()}>
              仍要前往 <ArrowRight className="size-3.5" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StageGapWizard;
