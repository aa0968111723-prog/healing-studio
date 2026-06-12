// ============================================================================
// shells/video/console/StorySpineColumn.tsx — 左欄：Story Spine（導航主軸）
// ----------------------------------------------------------------------------
// 專案 → 場景 → 鏡頭 S0X → 任務樹。S0X 為導航主軸：點任一鏡 deep-link 到中欄「分鏡修復」
// 畫布；每個節點掛 readiness chip（computeGate），點 chip 也到修復點。角色群組另列，
// 角色 readiness（來源分級）chip deep-link 到第一個引用該角色的鏡。
// 資料／動作全走 useProjectSpine()；導航狀態走 useDirectorConsole()。
// ============================================================================
import { useMemo } from "react";
import {
  FolderTree, Film, MapPin, Home, Mountain, UserRound, Layers, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PanelEmpty } from "@/shells/_shared/PanelState";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { useDirectorConsole } from "../DirectorConsoleProvider";
import { computeGate, countGate, GRADE_LABEL, isCharacterProductionReady } from "@/spine/gate";
import { ReadinessChip } from "./ReadinessChip";
import type { Scene, Shot } from "@/spine/types";

function sceneIcon(kind: Scene["kind"]) {
  if (kind === "interior") return <Home className="size-3.5 text-muted-foreground" />;
  if (kind === "named-place") return <MapPin className="size-3.5 text-amber-500" />;
  return <Mountain className="size-3.5 text-muted-foreground" />;
}

export function StorySpineColumn() {
  const spine = useProjectSpine();
  const console_ = useDirectorConsole();
  const p = spine.project!;

  const gate = useMemo(() => countGate(p.shots, p.characters, p.scenes), [p]);

  // 依場景分組鏡頭（含「未歸場景」）。
  const groups = useMemo(() => {
    const byScene = new Map<string | null, Shot[]>();
    for (const sh of p.shots) {
      const key = sh.sceneId ?? null;
      const arr = byScene.get(key) ?? [];
      arr.push(sh);
      byScene.set(key, arr);
    }
    return byScene;
  }, [p.shots]);

  return (
    <Card className="glass-card-static self-start">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FolderTree className="size-4 text-primary" /> Story Spine
          <Badge variant="outline" className="ml-auto text-[10px]">
            {p.shots.length} 鏡 · {p.scenes.length} 景
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 專案切換器（脊椎） */}
        {spine.projects.length > 1 && (
          <Select value={spine.activeProjectId ?? undefined} onValueChange={(v) => spine.setActiveProject(v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="切換專案" />
            </SelectTrigger>
            <SelectContent>
              {spine.projects.map((pr) => (
                <SelectItem key={pr.id} value={pr.id} className="text-xs">
                  {pr.emoji} {pr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* 專案標題 + 進度 */}
        <div>
          <div className="text-sm font-semibold">{p.emoji} {p.name}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.logline || "（未填 logline）"}</p>
        </div>

        {/* 確認門總覽（量產讀數） */}
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-muted-foreground">就緒</span>
          <ReadinessChip state="ready" label={`可量產 ${gate.ready}`} />
          <ReadinessChip state="partial" label={`待補 ${gate.partial}`} />
          <ReadinessChip state="blocked" label={`擋下 ${gate.blocked}`} />
        </div>

        {/* 場景 → 鏡頭 樹 */}
        <div className="max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
          {p.shots.length === 0 ? (
            <PanelEmpty
              className="py-6"
              icon={<span className="text-xl">🎞</span>}
              title={<span className="text-xs">尚無分鏡</span>}
              hint="用「引導式創作」貼長腳本自動拆幕／分鏡"
            />
          ) : (
            [...groups.entries()].map(([sceneId, shots]) => {
              const scene = sceneId ? p.scenes.find((s) => s.id === sceneId) : undefined;
              return (
                <div key={sceneId ?? "__none"}>
                  <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">
                    {scene ? sceneIcon(scene.kind) : <Layers className="size-3.5" />}
                    <span className="truncate">{scene ? scene.name : "未歸場景"}</span>
                    {scene?.kind === "named-place" && !scene.locked && (
                      <Badge variant="outline" className="ml-auto text-[9px]">缺實景</Badge>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {shots.map((sh) => {
                      const g = computeGate(sh, p.characters, p.scenes);
                      const active = console_.focusShotId === sh.id;
                      return (
                        <li key={sh.id}>
                          <button
                            type="button"
                            onClick={() => console_.deepLinkToShot(sh.id)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-healing",
                              active
                                ? "border-primary bg-primary/10"
                                : "border-transparent hover:border-border hover:bg-muted/50",
                            )}
                          >
                            <Film className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="rounded bg-primary/15 px-1 py-px font-mono text-[9px] text-primary">{sh.no}</span>
                                <span className="truncate text-xs">{sh.title}</span>
                              </span>
                            </span>
                            <ReadinessChip
                              state={g.state}
                              onClick={() => console_.deepLinkToShot(sh.id)}
                              title="前往此鏡修復／生成"
                            />
                            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>

        {/* 角色任務樹 */}
        {p.characters.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground">
              <UserRound className="size-3.5" /> 角色
            </div>
            <ul className="space-y-1">
              {p.characters.map((c) => {
                const ready = isCharacterProductionReady(c);
                return (
                  <li key={c.id}>
                    <div className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1 hover:bg-muted/40">
                      <span className="text-base leading-none">{c.emoji}</span>
                      <span className="min-w-0 flex-1 truncate text-xs">{c.name}</span>
                      <ReadinessChip
                        state={ready ? "ready" : c.sourceGrade === "unconfirmed" ? "blocked" : "partial"}
                        label={GRADE_LABEL[c.sourceGrade]}
                        onClick={() => {
                          const sh = p.shots.find((s) => s.characterIds.includes(c.id));
                          if (sh) console_.deepLinkToShot(sh.id);
                          else console_.setCanvasMode("shot");
                        }}
                        title="前往引用此角色的鏡修復"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StorySpineColumn;
