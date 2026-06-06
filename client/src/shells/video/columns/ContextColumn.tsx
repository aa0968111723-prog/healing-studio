// ============================================================================
// shells/video/columns/ContextColumn.tsx — 左欄：專案 + 索引上下文 + Context Packet
// ----------------------------------------------------------------------------
// 來源：模擬 VideoShell 左欄。資料走 useProjectSpine()：
//   • 專案切換器（projects；真實＝WorldContext 同步，mock＝本地）
//   • 已索引上下文（packet.sourceRefs；☁ 雲端來源 / 💾 機內來源 + 新鮮度）
//   • Context Packet（tokenEstimate 進度條 + TTL + 權限 + 重建鈕 → contextPacket.compileProject）
// ============================================================================
import { Layers, RefreshCw, Cloud, HardDrive, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";

const CLOUD_RE = /教材|Drive|發佈|選題|品牌|news/i;

export function ContextColumn() {
  const spine = useProjectSpine();
  const p = spine.project!;
  const packet = p.packet;
  const tokenPct = Math.min(100, (packet.tokenEstimate / 8000) * 100);

  return (
    <Card className="glass-card-static self-start">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" /> 專案 · 上下文
          <Badge variant="outline" className="ml-auto text-[10px]">
            {spine.mode === "mock" ? "mock" : "機 + 雲"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 專案切換器 */}
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

        {/* 專案標題 + logline */}
        <div>
          <div className="text-sm font-semibold">{p.emoji} {p.name}</div>
          <p className="mt-1 text-xs text-muted-foreground">{p.logline || "（未填 logline）"}</p>
        </div>

        {/* 已索引上下文 */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" /> 已索引上下文
          </div>
          {packet.sourceRefs.length === 0 ? (
            <div className="text-xs text-muted-foreground">（尚無來源）</div>
          ) : (
            <ul className="space-y-1">
              {packet.sourceRefs.map((r, i) => {
                const cloud = CLOUD_RE.test(r.kind);
                return (
                  <li key={i} className="flex items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                    {cloud ? <Cloud className="size-3.5 shrink-0 text-sky-500" /> : <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium">{r.kind}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{r.ref}</span>
                    </span>
                    <Badge variant={r.fresh ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                      {r.fresh ? "新鮮" : "過期"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Context Packet 計量 */}
        <div className="rounded-xl border bg-card/60 p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Context Packet</span>
            <span className="font-mono text-primary">{packet.tokenEstimate.toLocaleString()} tok</span>
          </div>
          <Progress value={tokenPct} className="mt-2 h-1.5" />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              TTL {Math.round(packet.ttlSec / 60)} 分 · {packet.permissions}
            </span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => spine.rebuildPacket()}>
              <RefreshCw className="size-3" /> 重建
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ContextColumn;
