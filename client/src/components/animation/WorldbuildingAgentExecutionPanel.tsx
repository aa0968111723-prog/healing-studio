import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { WorldbuildingGenerationTask } from "../../../../shared/worldbuilding-generation-tasks";
import { buildAgentWorkflowFromGenerationTasks } from "../../../../shared/worldbuilding-agent-workflow";

export function WorldbuildingAgentExecutionPanel({ tasks }: { tasks: WorldbuildingGenerationTask[] }) {
  const blocked = tasks.filter(t => t.status === "blocked");
  const ready = tasks.filter(t => t.status === "ready");
  const workflow = useMemo(() => buildAgentWorkflowFromGenerationTasks({ tasks }), [tasks]);
  const copy = (text: string, label: string) => navigator.clipboard.writeText(text).then(() => toast.success(`已複製${label}`));
  return <div className="rounded border p-3 space-y-2">
    <div className="flex gap-2 flex-wrap text-xs"><Badge>任務 {tasks.length}</Badge><Badge variant="secondary">ready {ready.length}</Badge><Badge variant="destructive">blocked {blocked.length}</Badge></div>
    {blocked.map(t => <div key={t.id} className="text-xs text-amber-700">{t.title}: {t.blockers.join("、")}</div>)}
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" onClick={() => copy(JSON.stringify(tasks, null, 2), "任務 JSON")}>複製任務 JSON</Button>
      <Button size="sm" variant="outline" onClick={() => copy(JSON.stringify(workflow, null, 2), "workflow JSON")}>建立代理工作流</Button>
      <Button size="sm" variant="outline" onClick={() => toast.success("dry-run 僅預覽 payload，不會執行模型。")}>Dry-run 內建模型呼叫</Button>
      <Button size="sm" disabled>執行內建模型呼叫（coming soon）</Button>
    </div>
  </div>;
}
