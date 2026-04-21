import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, NotebookPen } from "lucide-react";

type PlanningPage = "notes" | "calendar";

const PLANNING_GUIDE: Record<
  PlanningPage,
  { title: string; badge: string; tips: string[] }
> = {
  notes: {
    title: "筆記頁高效整理流程",
    badge: "筆記",
    tips: [
      "先把靈感落地成短筆記，再補齊標籤與用途。",
      "將可執行任務拆成清單，避免只留下概念句。",
      "高價值筆記加上固定前綴，方便後續搜尋。",
    ],
  },
  calendar: {
    title: "排程頁落地執行流程",
    badge: "排程",
    tips: [
      "先把未排程筆記拖曳上日曆，再補精確時段。",
      "大型任務分段排程（腳本/素材/生成/校對）。",
      "每日保留緩衝時段，避免任務互相擠壓。",
    ],
  },
};

export function PlanningSubpageGuide({ page }: { page: PlanningPage }) {
  const [open, setOpen] = useState(false);
  const content = useMemo(() => PLANNING_GUIDE[page], [page]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-2xl border border-border/50 bg-background/70 p-3"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <NotebookPen className="w-4 h-4 text-primary shrink-0" />
            <p className="text-xs sm:text-sm font-medium text-left truncate">
              {content.title}
            </p>
            <Badge variant="secondary" className="text-[10px] rounded-full">
              {content.badge}
            </Badge>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <ul className="space-y-1 list-disc pl-5">
          {content.tips.map(tip => (
            <li key={tip} className="text-xs text-muted-foreground">
              {tip}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
