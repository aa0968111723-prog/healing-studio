/**
 * ProjectContextStrip — 影片製作工作台脈絡列（M1-A ↔ M1-B 整合）
 * ────────────────────────────────────────────────────────────────────────────
 * 在 /director 等影片製作頁面頂部顯示一條輕量脈絡列：目前在哪個創作專案、世界觀
 * 摘要、還有幾筆未完成的創作意圖。對應「舒適創作體驗」的核心原則之一：永遠讓
 * 使用者知道自己在哪個 project，而不需要回到 /create 才看得到上下文。
 *
 * 資料一律來自 useActiveProject 的 project context summary（其 openTasks 由 M1-B
 * orchestration runs 帶入），不另外建立查詢，也不呼叫任何外部 API。
 */

import { Link } from "wouter";
import { useActiveProject } from "@/hooks/useActiveProject";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, ListChecks, ArrowRight, Loader2 } from "lucide-react";
import {
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@/components/create/projectContextFormat";
import { summarizeOpenTasks } from "@/components/create/commanderFormat";

export function ProjectContextStrip() {
  const { activeProjectId, summary, isSummaryLoading } = useActiveProject();

  // 未綁定專案：不阻塞創作，只給一個淡提示 + 前往 /create。
  if (activeProjectId === null) {
    return (
      <div
        data-testid="project-context-strip-empty"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      >
        <FolderKanban className="size-3.5 shrink-0" />
        <span>尚未綁定創作專案，這支影片的腳本、素材與意圖不會被保存。</span>
        <Link
          href="/create"
          className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
        >
          選擇或建立專案 <ArrowRight className="size-3" />
        </Link>
      </div>
    );
  }

  if (isSummaryLoading || !summary) {
    return (
      <div
        data-testid="project-context-strip-loading"
        className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" /> 載入專案脈絡…
      </div>
    );
  }

  const { count, headline } = summarizeOpenTasks(summary.openTasks);

  return (
    <div
      data-testid="project-context-strip"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <FolderKanban className="size-3.5 text-primary" />
        <span className="max-w-[220px] truncate" title={summary.title}>
          {summary.title}
        </span>
      </span>
      <Badge variant="secondary" className="text-[10px]">
        {PROJECT_STATUS_LABELS[summary.status as ProjectStatus] ?? summary.status}
      </Badge>
      {summary.worldview ? (
        <span
          className="hidden max-w-[260px] truncate text-muted-foreground sm:inline"
          title={summary.worldview}
        >
          {summary.worldview}
        </span>
      ) : null}
      <span
        className="flex items-center gap-1 text-muted-foreground"
        data-testid="project-context-strip-tasks"
      >
        <ListChecks className="size-3.5" />
        {count > 0 ? headline : "尚無待辦意圖"}
      </span>
      <Link
        href="/create"
        className="ml-auto inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
      >
        在創作頁管理 <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}

export default ProjectContextStrip;
