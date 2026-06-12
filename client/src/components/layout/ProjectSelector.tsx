/**
 * ProjectSelector — 頂部全站專案選擇器
 *
 * 樣式參考 GitHub 的 repo 選擇器 / Linear 的 team 選擇器。
 * 顯示當前 active project 名稱 + 狀態 badge,點擊展開可切換或建立。
 *
 * 來源：ProjectsContext。實際的 server-backed 創作專案在 /creative-projects
 * 頁面建立 — 這顆 selector 是跨頁面導覽用的快速切換器。
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { ChevronsUpDown, Check, Plus, FolderKanban } from "lucide-react";
import { useProjects } from "@/contexts/ProjectsContext";
import { PROJECT_STATUS_LABELS } from "@/types/projects";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function ProjectSelector({ className }: { className?: string }) {
  const [, setLocation] = useLocation();
  const {
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    isLoading,
  } = useProjects();
  const [open, setOpen] = useState(false);

  const handleSelect = (id: string) => {
    setActiveProjectId(id);
    setOpen(false);
  };

  const handleCreateNew = () => {
    setOpen(false);
    setLocation("/creative-projects");
  };

  const handleViewAll = () => {
    setOpen(false);
    setLocation("/projects");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-9 gap-2 rounded-full px-3 text-xs sm:text-sm",
            className,
          )}
          aria-label="切換創作專案"
        >
          <FolderKanban className="size-3.5 text-muted-foreground" />
          <span className="max-w-[160px] truncate">
            {activeProject?.title ?? "選擇專案"}
          </span>
          {activeProject ? (
            <Badge
              variant="secondary"
              className="ml-1 h-5 px-1.5 text-[10px] font-normal"
            >
              {PROJECT_STATUS_LABELS[activeProject.status]}
            </Badge>
          ) : null}
          <ChevronsUpDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            專案
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {projects.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {isLoading ? "載入專案中…" : "尚無專案"}
            </p>
          ) : (
            projects.map(p => {
              const selected = p.id === activeProjectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p.id)}
                  disabled={p.isPending}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.title}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.currentStep}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[10px] font-normal"
                    >
                      {PROJECT_STATUS_LABELS[p.status]}
                    </Badge>
                    {selected ? (
                      <Check className="size-3.5 text-primary" />
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t p-1">
          <button
            type="button"
            onClick={handleCreateNew}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-muted/60"
          >
            <Plus className="size-3.5" /> 建立新專案
          </button>
          <button
            type="button"
            onClick={handleViewAll}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-muted/60"
          >
            查看所有專案 →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ProjectSelector;
