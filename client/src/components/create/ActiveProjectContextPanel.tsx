/**
 * ActiveProjectContextPanel — M1-A Active Project Context（/create 區塊）
 * ────────────────────────────────────────────────────────────────────────────
 * `/create` 最上方的「目前創作專案」區塊：
 *   - 顯示 / 切換 / 建立 server-backed 創作專案（CreativeProject 主幹）
 *   - 顯示專案上下文摘要：世界觀、風格、最近素材、更新時間
 *   - 未選專案時不阻塞創作，只提示「建立專案後可保存上下文」
 *
 * 作用中專案沿用既有 WorldContextContext（透過 useActiveProject 包裝），與全站
 * 光球 / Studio 頁面共用同一份 active project，不另外建立狀態。
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderKanban,
  Plus,
  Sparkles,
  Globe2,
  Image as ImageIcon,
  Clock,
  Loader2,
  ListChecks,
} from "lucide-react";
import {
  PROJECT_STATUS_LABELS,
  assetTypeLabel,
  pendingSectionLabels,
  formatUpdatedAt,
  NO_ACTIVE_PROJECT_HINT,
  type ProjectStatus,
} from "./projectContextFormat";
import { modeLabel, runStatusLabel, costPreviewLabel } from "./commanderFormat";

function isMissingCreativeProjectsTable(error: unknown): boolean {
  const message = (error as { message?: string } | null)?.message ?? "";
  return /ER_NO_SUCH_TABLE/i.test(message) && /creative_projects/i.test(message);
}

export function ActiveProjectContextPanel() {
  const { activeProjectId, setActiveProjectId, summary, isSummaryLoading } =
    useActiveProject();
  const utils = trpc.useUtils();

  const listQuery = trpc.creativeProject.list.useQuery(undefined, {
    staleTime: 5_000,
    retry: false,
  });
  const projects = listQuery.data ?? [];
  const tableMissing = isMissingCreativeProjectsTable(listQuery.error);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [dismissedHint, setDismissedHint] = useState(false);

  const createMutation = trpc.creativeProject.create.useMutation({
    onSuccess: ({ id }) => {
      toast.success("已建立並切換到新的創作專案");
      setNewTitle("");
      setCreating(false);
      utils.creativeProject.list.invalidate();
      setActiveProjectId(id);
    },
    onError: err => {
      if (isMissingCreativeProjectsTable(err)) {
        toast.error("創作專案資料表尚未建立，請執行資料庫 migration。");
        return;
      }
      toast.error(err.message || "建立失敗");
    },
  });

  const submitCreate = () => {
    const title = newTitle.trim();
    if (!title || createMutation.isPending) return;
    createMutation.mutate({ title });
  };

  const activeTitle = useMemo(() => {
    if (summary?.title) return summary.title;
    const fromList = projects.find(p => p.id === activeProjectId);
    return fromList?.title ?? null;
  }, [summary, projects, activeProjectId]);

  return (
    <section
      data-testid="active-project-context-panel"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FolderKanban className="size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              目前創作專案
            </p>
            <h2
              className="truncate text-lg font-semibold leading-tight"
              data-testid="active-project-title"
            >
              {activeTitle ?? "尚未選擇專案"}
            </h2>
          </div>
          {summary ? (
            <Badge variant="secondary" className="ml-1 shrink-0">
              {PROJECT_STATUS_LABELS[summary.status as ProjectStatus] ??
                summary.status}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {projects.length > 0 ? (
            <Select
              value={activeProjectId ? String(activeProjectId) : undefined}
              onValueChange={val => setActiveProjectId(Number(val))}
            >
              <SelectTrigger
                className="h-9 w-[180px] text-xs"
                aria-label="切換創作專案"
                data-testid="active-project-select"
              >
                <SelectValue placeholder="選擇專案" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1 text-xs"
            onClick={() => setCreating(v => !v)}
            data-testid="active-project-create-toggle"
          >
            <Plus className="size-3.5" /> 建立專案
          </Button>
        </div>
      </div>

      {tableMissing ? (
        <p className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          創作專案資料表尚未建立（creative_projects）。請管理員執行資料庫
          migration 後再使用專案上下文。
        </p>
      ) : null}

      {creating ? (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-primary/40 bg-background/60 p-3">
          <label className="min-w-[200px] flex-1 text-xs font-medium">
            <span className="mb-1 block text-muted-foreground">專案名稱</span>
            <Input
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="例：禪修短片企劃"
              data-testid="active-project-title-input"
              onKeyDown={e => {
                if (e.key === "Enter") submitCreate();
              }}
            />
          </label>
          <Button
            size="sm"
            onClick={submitCreate}
            disabled={!newTitle.trim() || createMutation.isPending}
            data-testid="active-project-create-submit"
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 size-3.5" />
            )}
            建立並切換
          </Button>
        </div>
      ) : null}

      {!activeProjectId ? (
        dismissedHint ? null : (
          <div
            className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/30 p-4"
            data-testid="active-project-empty-hint"
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              {NO_ACTIVE_PROJECT_HINT}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={() => setCreating(true)}
                data-testid="active-project-empty-create"
              >
                <Plus className="mr-1 size-3.5" /> 建立專案
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDismissedHint(true)}
              >
                稍後再說
              </Button>
            </div>
          </div>
        )
      ) : isSummaryLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 載入專案上下文…
        </div>
      ) : summary ? (
        <ProjectSummaryBody summary={summary} />
      ) : null}
    </section>
  );
}

function ProjectSummaryBody({
  summary,
}: {
  summary: NonNullable<ReturnType<typeof useActiveProject>["summary"]>;
}) {
  const pending = pendingSectionLabels(summary.pendingSections);
  return (
    <div className="space-y-3" data-testid="active-project-summary">
      {summary.worldview ? (
        <SummaryRow icon={<Globe2 className="size-3.5" />} label="世界觀">
          <span>{summary.worldview}</span>
          {summary.styleBible ? (
            <span className="block text-[11px] text-muted-foreground">
              風格：{summary.styleBible}
            </span>
          ) : null}
        </SummaryRow>
      ) : (
        <SummaryRow icon={<Globe2 className="size-3.5" />} label="世界觀">
          <span className="italic text-muted-foreground">
            尚未綁定世界觀。到導演工作室或動畫工作室綁定後，這裡會帶入一致性摘要。
          </span>
        </SummaryRow>
      )}

      <SummaryRow icon={<ImageIcon className="size-3.5" />} label="最近素材">
        {summary.recentAssets.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {summary.recentAssets.map(a => (
              <Badge
                key={a.id}
                variant="outline"
                className="max-w-[160px] truncate text-[11px] font-normal"
                title={a.title}
              >
                {assetTypeLabel(a.assetType)}・{a.title}
              </Badge>
            ))}
            {summary.recentAssetsScope === "user" ? (
              <span className="w-full text-[11px] text-muted-foreground">
                目前顯示你最近的素材；依專案篩選將於資產庫里程碑（M2-A）接上。
              </span>
            ) : null}
          </span>
        ) : (
          <span className="italic text-muted-foreground">尚無素材。</span>
        )}
      </SummaryRow>

      <SummaryRow icon={<ListChecks className="size-3.5" />} label="未完成任務">
        {summary.openTasks.length > 0 ? (
          <ul className="space-y-1" data-testid="active-project-open-tasks">
            {summary.openTasks.map(task => (
              <li
                key={task.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                data-testid={`active-project-open-task-${task.id}`}
              >
                <span
                  className="min-w-0 max-w-[240px] truncate text-[13px]"
                  title={task.title}
                >
                  {task.title}
                </span>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {modeLabel(task.mode)}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {runStatusLabel(task.status)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {costPreviewLabel(task.estimatedCostUsd)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="italic text-muted-foreground">
            目前沒有待處理的創作意圖。在下方輸入一句話即可記錄。
          </span>
        )}
      </SummaryRow>

      <SummaryRow icon={<Clock className="size-3.5" />} label="更新時間">
        <span>{formatUpdatedAt(summary.updatedAt)}</span>
      </SummaryRow>

      {pending.length > 0 ? (
        <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" />
          即將推出：{pending.map(p => p.label).join("、")}
        </p>
      ) : null}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="mt-0.5 flex shrink-0 items-center gap-1 font-medium text-muted-foreground">
        {icon}
        <span className="w-16">{label}</span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default ActiveProjectContextPanel;
