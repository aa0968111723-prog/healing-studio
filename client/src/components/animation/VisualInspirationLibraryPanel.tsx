import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorldbuildingFrameworkData } from "../../../../shared/worldbuilding-types";
import { buildVisualInspirationLibrary, scoreVisualInspirationCompleteness } from "../../../../shared/visual-inspiration-library";

export function VisualInspirationLibraryPanel({ world }: { world: WorldbuildingFrameworkData }) {
  const [filter, setFilter] = useState<string>("all");
  const library = useMemo(() => buildVisualInspirationLibrary(world), [world]);
  const score = useMemo(() => scoreVisualInspirationCompleteness(world, library), [world, library]);
  const items = library.items.filter(i => filter === "all" ? true : i.kind === filter);
  return <div className="rounded-lg border p-3 space-y-2">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">視覺靈感庫</h3><Badge variant="secondary">覆蓋率 {score.overallPercent}%</Badge></div>
    <p className="text-xs text-muted-foreground">把角色、場景、風格與分鏡參考集中管理，讓 AI 生成時不容易跑版。</p>
    <div className="flex gap-1 flex-wrap">{["all","character","scene","style","shot","prop","lighting","composition"].map(f=><Button key={f} size="sm" variant={filter===f?"default":"outline"} className="h-6 text-[11px]" onClick={()=>setFilter(f)}>{f}</Button>)}</div>
    {items.length===0?<div className="text-xs text-muted-foreground">還沒有視覺靈感。你可以上傳角色圖、場景圖、風格參考，或從腳本自動產生靈感草稿。</div>:<div className="grid grid-cols-1 md:grid-cols-2 gap-2">{items.map(it=><div key={it.id} className="border rounded p-2 text-xs space-y-1">{it.imageUrl?<img src={it.imageUrl} alt={it.title || `${it.kind} 視覺靈感`} className="w-full h-24 object-cover rounded"/>:<div className="h-24 rounded bg-muted grid place-items-center">prompt-only</div>}<div className="font-medium">{it.title}</div><div>{it.kind}</div><div>{it.promptSeed || ""}</div>{!it.licenseNote && <div className="text-amber-600">授權狀態未標記，建議只作為私人參考。</div>}</div>)}</div>}
  </div>;
}
