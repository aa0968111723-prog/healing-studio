import { useMemo, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { WorldbuildingFrameworkData } from "../../../../shared/worldbuilding-types";
import { buildWorldbuildingProductionPackage } from "../../../../shared/worldbuilding-production-package";
import { buildWorldbuildingGenerationTasks } from "../../../../shared/worldbuilding-generation-tasks";
import { WorldbuildingAgentExecutionPanel } from "./WorldbuildingAgentExecutionPanel";

export function ProductionPackagePreview({ world, storyboards, readinessPercent, warnings }: { world: WorldbuildingFrameworkData; storyboards?: any[]; readinessPercent?: number; warnings?: string[] }) {
  const [open, setOpen] = useState(false);
  const pkg = useMemo(() => buildWorldbuildingProductionPackage(world, storyboards), [world, storyboards]);
  const mergedWarnings = [...(warnings ?? []), ...pkg.warnings];
  const taskList = useMemo(() => buildWorldbuildingGenerationTasks({ world, productionPackage: pkg, storyboards: storyboards as any[] }), [world, pkg, storyboards]);
  const copy = (text: string, label: string) => copyToClipboard(text, `已複製${label}`);
  const download = (name: string, text: string, type: string) => { const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" className="h-7 text-xs">產生完整製作包</Button></DialogTrigger>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>製作包預覽</DialogTitle></DialogHeader>
        <Badge variant="secondary">生成準備度 {readinessPercent ?? pkg.readinessPercent}%</Badge>
        {mergedWarnings.length > 0 && <div className="text-xs text-amber-700">尚缺資訊會影響生成一致性。{mergedWarnings.map((w, i) => <div key={i}>- {w}</div>)}</div>}
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => copy(pkg.markdown, "Markdown")}>複製 Markdown</Button>
          <Button size="sm" variant="outline" onClick={() => copy([...(pkg.json.imagePromptSeeds ?? []), ...(pkg.json.videoPromptSeeds ?? []), ...(pkg.json.voiceDirections ?? [])].join("\n"), "所有 Prompt")}>複製所有 Prompt</Button>
          <Button size="sm" variant="outline" onClick={() => copy((pkg.json.imagePromptSeeds ?? []).join("\n"), "圖像 Prompt")}>複製圖像 Prompt</Button>
          <Button size="sm" variant="outline" onClick={() => copy((pkg.json.videoPromptSeeds ?? []).join("\n"), "影片 Prompt")}>複製影片 Prompt</Button>
          <Button size="sm" variant="outline" onClick={() => copy((pkg.json.voiceDirections ?? []).join("\n"), "配音稿")}>複製配音稿</Button>
          <Button size="sm" variant="outline" onClick={() => download("worldbuilding-production-package.md", pkg.markdown, "text/markdown")}>下載 Markdown</Button>
        </div>

        <div className="rounded border p-2 space-y-2">
          <h4 className="text-xs font-semibold">可建立的生成任務</h4>
          {[
            ["角色圖生成任務", taskList.filter(t => t.type === "character_image").length],
            ["場景圖生成任務", taskList.filter(t => t.type === "scene_image").length],
            ["逐鏡圖像任務", taskList.filter(t => t.type === "shot_image").length],
            ["逐鏡影片任務", taskList.filter(t => t.type === "shot_video").length],
            ["配音任務", taskList.filter(t => t.type === "voice").length],
            ["配樂任務", taskList.filter(t => t.type === "music").length],
            ["音效任務", taskList.filter(t => t.type === "sound").length],
            ["發布文案任務", taskList.filter(t => t.type === "publishing").length],
          ].map(([label, count]) => (
            <div key={String(label)} className="flex items-center justify-between text-xs gap-2">
              <span>{label}：{Number(count)} 個</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => copy(`${label}\n` + JSON.stringify(taskList, null, 2), "任務清單")}>複製任務清單</Button>
                <Button size="sm" disabled className="h-6 text-[11px]">建立任務（即將支援）</Button>
              </div>
            </div>
          ))}
        </div>
        <WorldbuildingAgentExecutionPanel tasks={taskList} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ScrollArea className="h-[45vh] rounded border p-2"><h4 className="text-xs font-semibold mb-2">Markdown 預覽</h4><pre className="text-xs whitespace-pre-wrap">{pkg.markdown}</pre></ScrollArea>
          <ScrollArea className="h-[45vh] rounded border p-2"><h4 className="text-xs font-semibold mb-2">Prompt Seeds</h4><pre className="text-xs whitespace-pre-wrap">{(pkg.json.imagePromptSeeds ?? []).concat(pkg.json.videoPromptSeeds ?? []).concat(pkg.json.voiceDirections ?? []).concat(pkg.json.musicPromptSeeds ?? []).join("\n") || "（待補）"}</pre></ScrollArea>
          <ScrollArea className="h-[45vh] rounded border p-2"><h4 className="text-xs font-semibold mb-2">缺漏提醒</h4><pre className="text-xs whitespace-pre-wrap">{(pkg.json.missingItems ?? []).join("\n") || "無"}</pre></ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
