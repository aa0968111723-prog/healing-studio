// ============================================================================
// shells/video/panels/ScenePanel.tsx — 場景卡（餵養確認門「場景缺實景」狀態）
// ----------------------------------------------------------------------------
// 對映 worldbuilding_frameworks.scenesJson。具名實景（named-place）未鎖 → 確認門擋為「場景缺實景」；
// 這裡提供「鎖定實景」切換（toggleSceneLock）讓該狀態可被解除（完整狀態機的場景解法）。
// ============================================================================
import { Lock, Unlock, MapPin, Home, Mountain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { Empty } from "./ShotPanel";
import type { Scene } from "@/spine/types";

function sceneIcon(kind: Scene["kind"]) {
  if (kind === "interior") return <Home className="size-4 text-muted-foreground" />;
  if (kind === "named-place") return <MapPin className="size-4 text-amber-500" />;
  return <Mountain className="size-4 text-muted-foreground" />;
}

export function ScenePanel() {
  const spine = useProjectSpine();
  const p = spine.project!;
  if (p.scenes.length === 0) return <Empty icon="🗺" title="尚無場景" desc="引導式拆解會自動抽出場景。" />;
  return (
    <div className="space-y-2">
      {p.scenes.map((sc) => {
        const needsLock = sc.kind === "named-place" && !sc.locked;
        return (
          <div key={sc.id} className="flex items-center gap-2 rounded-xl border p-2.5">
            {sceneIcon(sc.kind)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{sc.name}</div>
              <div className="text-[10px] text-muted-foreground">{sc.kind}</div>
            </div>
            {needsLock && <Badge variant="outline" className="shrink-0 text-[10px]">缺實景</Badge>}
            <Button
              size="sm"
              variant={sc.locked ? "secondary" : "outline"}
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => spine.toggleSceneLock(sc.id)}
            >
              {sc.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              {sc.locked ? "已鎖定" : "鎖定實景"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export default ScenePanel;
