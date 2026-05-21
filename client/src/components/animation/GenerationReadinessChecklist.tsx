import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function GenerationReadinessChecklist({ readiness, actionPlan, onAction }: { readiness: any; actionPlan: any; onAction: (a: any) => void }) {
  const rows = [
    ["角色一致性", readiness.visualCoverage?.characterCoverage?.filter((c: any) => c.percent < 100).length ?? 0, "characters"],
    ["場景一致性", readiness.visualCoverage?.sceneCoverage?.filter((c: any) => c.percent < 100).length ?? 0, "scenes"],
    ["風格一致性", 0, "style"],
    ["聲音一致性", actionPlan.readinessFlags?.readyForAudioGeneration ? 0 : 1, "music"],
    ["分鏡完整度", actionPlan.readinessFlags?.readyForVideoGeneration ? 0 : 1, "storyboards"],
    ["視覺素材", readiness.visualAssetPercent >= 70 ? 0 : 1, "characters"],
    ["製作包", 0, "production"],
  ];
  return <div className="rounded-xl border p-3 space-y-2"><h3 className="text-sm font-semibold">生成前檢查</h3>{rows.map(([label, miss, tab]) => <div key={String(label)} className="flex items-center justify-between text-xs"><div><Badge variant={Number(miss)===0?"default":"outline"}>{Number(miss)===0?"完成":`缺 ${miss} 項`}</Badge><span className="ml-2">{label}</span></div><Button size="sm" variant="outline" className="h-6" onClick={() => onAction({ targetTab: tab })}>修復</Button></div>)}</div>;
}
