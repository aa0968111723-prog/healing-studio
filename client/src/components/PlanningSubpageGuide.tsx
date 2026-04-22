import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CalendarCheck2, ChevronDown, Link2, NotebookPen } from "lucide-react";

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

const PLANNING_SUBPAGES: { key: PlanningPage; label: string; path: string }[] = [
  { key: "notes", label: "專案筆記", path: "/notes" },
  { key: "calendar", label: "創作排程", path: "/calendar" },
];

const PLANNING_HANDOFFS = [
  { label: "導演 AI", path: "/director" },
  { label: "創作工作室", path: "/studio" },
  { label: "儀表板", path: "/dashboard" },
];

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
        <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-primary" />
            <p className="text-[11px] font-medium text-foreground/80">
              規劃筆記 2 子頁
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLANNING_SUBPAGES.map(item => {
              const isActive = item.key === page;
              return (
                <Link
                  key={item.key}
                  href={item.path}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    isActive
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-background/70 border-border/60 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-border/50 bg-muted/20 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <CalendarCheck2 className="w-3.5 h-3.5 text-primary" />
            <p className="text-[11px] font-medium text-foreground/80">
              轉入生產建議入口
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PLANNING_HANDOFFS.map(item => (
              <Link
                key={item.path}
                href={item.path}
                className="text-[11px] px-2 py-1 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors bg-background/70"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
