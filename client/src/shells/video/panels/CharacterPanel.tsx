// ============================================================================
// shells/video/panels/CharacterPanel.tsx — 角色卡（確認門核心：來源分級 / 四鎖 / 上傳參考 / 改設定）
// ----------------------------------------------------------------------------
// 對映 consistency_vault：來源分級（✅精準/⚠估算/⚠未確認）、四鎖（臉/髮/裝/配飾）、LoRA 狀態。
// 動作：toggleLock（→ vault.update）、uploadReference（升精準+鎖全=解鎖）、changeCharacterSetting
//（→ worldbuilding.update，觸發既有鏡 stale）。全部 useProjectSpine()，樂觀更新。
// ============================================================================
import { Lock, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { GRADE_LABEL, isCharacterProductionReady } from "@/spine/gate";
import { Empty } from "./ShotPanel";
import type { Character } from "@/spine/types";

const LOCK_LABEL: Record<keyof Character["locks"], string> = {
  face: "臉", hair: "髮", costume: "服裝", accessory: "配飾",
};

export function CharacterPanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  if (p.characters.length === 0) return <Empty icon="👤" title="尚無角色" desc="引導式拆解會自動抽出角色。" />;
  return (
    <div className="space-y-2">
      {p.characters.map((c) => <CharacterCard key={c.id} c={c} />)}
    </div>
  );
}

function CharacterCard({ c }: { c: Character }) {
  const spine = useProjectSpine();
  const gradeTone = c.sourceGrade === "precise" ? "secondary" : c.sourceGrade === "estimate" ? "outline" : "destructive";
  const ready = isCharacterProductionReady(c);

  return (
    <div className={cn("rounded-xl border p-2.5", ready && "border-emerald-500/30")}>
      <div className="flex items-center gap-2">
        <span className="text-xl leading-none">{c.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.name}</div>
          <div className="text-[10px] text-muted-foreground">LoRA：{c.loraStatus} · 參考圖 {c.refImages}</div>
        </div>
        <Badge variant={gradeTone} className="shrink-0 text-[10px]">{GRADE_LABEL[c.sourceGrade]}</Badge>
      </div>

      {/* 四鎖 */}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {(Object.keys(LOCK_LABEL) as (keyof Character["locks"])[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => spine.toggleLock(c.id, k)}
            className={cn(
              "inline-flex items-center justify-center gap-0.5 rounded-md border py-1 text-[10px] transition-healing",
              c.locks[k] ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
            )}
          >
            <Lock className="size-2.5" /> {LOCK_LABEL[k]}
          </button>
        ))}
      </div>

      {/* 動作 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.sourceGrade !== "precise" && (
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => spine.uploadReference(c.id)}>
            <Upload className="size-3" /> 上傳參考
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => spine.changeCharacterSetting(c.id)}>
          <RefreshCw className="size-3" /> 改設定
        </Button>
      </div>
    </div>
  );
}

export default CharacterPanel;
