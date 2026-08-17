import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useProjects } from "@/contexts/ProjectsContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  type Project,
  type ProjectStatus,
} from "@/types/projects";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  MoreVertical,
  Search,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const STATUS_FILTERS: Array<{ value: "all" | ProjectStatus; label: string }> = [
  { value: "all", label: "全部狀態" },
  { value: "active", label: "進行中" },
  { value: "draft", label: "草稿" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已封存" },
];

function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatRelativeUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return formatUpdatedAt(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days < 7) return `${days} 天前更新`;
  return `${formatUpdatedAt(iso)} 更新`;
}

function ProjectStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "primary" | "success";
}) {
  const toneClass = {
    default: "bg-card/70",
    primary: "border-primary/30 bg-primary/5",
    success: "border-emerald-300/50 bg-emerald-50/45 dark:bg-emerald-950/20",
  }[tone];
  return (
    <div className={`rounded-2xl border border-border/55 p-4 ${toneClass}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function ProjectCard({
  project,
  onContinue,
  onDuplicate,
  duplicatePending,
}: {
  project: Project;
  onContinue: (project: Project) => void;
  onDuplicate: (project: Project) => void;
  duplicatePending: boolean;
}) {
  const progress = Math.min(100, Math.max(0, project.progress));
  const isComplete = project.status === "completed" || progress === 100;

  return (
    <li key={project.id} data-testid={`project-card-${project.id}`}>
      <article className="group flex h-full flex-col rounded-2xl border border-border/55 bg-card/65 p-5 shadow-[var(--shadow-healing-sm)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-healing-md)]">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              {isComplete ? (
                <CheckCircle2 className="size-5" aria-hidden />
              ) : (
                <LayoutGrid className="size-5" aria-hidden />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold" title={project.title}>
                {project.title}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {PROJECT_TYPE_LABELS[project.type]} · {formatRelativeUpdatedAt(project.updatedAt)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant={isComplete ? "secondary" : "outline"} className="text-[10px]">
              {PROJECT_STATUS_LABELS[project.status]}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`${project.title} 專案選項`}
                  disabled={project.isPending}
                >
                  <MoreVertical className="size-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => onDuplicate(project)}
                  disabled={duplicatePending || project.isPending}
                >
                  <Copy className="mr-2 size-3.5" aria-hidden />
                  複製專案
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="mt-5 space-y-2">
          <div className="flex items-end justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">完成進度</span>
            <span
              data-testid={`project-progress-${project.id}`}
              className="text-sm font-semibold"
            >
              {progress}%
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <div className="mt-5 space-y-3 rounded-xl bg-muted/35 p-3.5 text-xs">
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">目前步驟</p>
            <p className="mt-1 line-clamp-2 leading-relaxed">{project.currentStep}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted-foreground">下一步</p>
            <p className="mt-1 line-clamp-2 leading-relaxed">{project.nextAction}</p>
          </div>
        </div>

        <footer className="mt-auto flex items-end justify-between gap-3 pt-5">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock3 className="size-3" aria-hidden />
            {project.isPending ? "同步中…" : formatUpdatedAt(project.updatedAt)}
          </span>
          <Button
            size="sm"
            onClick={() => onContinue(project)}
            disabled={project.isPending}
            data-testid={`continue-${project.id}`}
          >
            繼續創作
            <ArrowRight className="ml-1 size-4" aria-hidden />
          </Button>
        </footer>
      </article>
    </li>
  );
}

export default function ProjectsListPage() {
  const { projects, setActiveProjectId, isLoading, error } = useProjects();
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");
  const [sortBy, setSortBy] = useState<"updated" | "progress">("updated");
  const utils = trpc.useUtils();

  const duplicateMutation = trpc.creativeProject.duplicate.useMutation({
    onSuccess: data => {
      utils.creativeProject.list.invalidate();
      setActiveProjectId(String(data.id));
      setLocation(`/projects/${data.id}`);
    },
    onError: () => {
      toast.error("複製專案失敗，請稍後再試");
    },
  });

  const continueProject = (project: Project) => {
    // 樂觀臨時列（負數 id）沒有真實路由可去 —— 等 refetch 換上真列再導。
    if (project.isPending) return;
    setActiveProjectId(project.id);
    setLocation(`/projects/${project.id}`);
  };

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return projects
      .filter(project => {
        const matchesStatus = statusFilter === "all" || project.status === statusFilter;
        const haystack = [project.title, project.currentStep, project.nextAction]
          .join(" ")
          .toLocaleLowerCase();
        return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
      })
      .sort((a, b) => {
        if (sortBy === "progress") return b.progress - a.progress;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [projects, query, sortBy, statusFilter]);

  const counts = useMemo(
    () => ({
      total: projects.length,
      active: projects.filter(project => project.status === "active").length,
      completed: projects.filter(project => project.status === "completed").length,
      average: projects.length
        ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
        : 0,
    }),
    [projects],
  );

  return (
    <div className="page-shell page-shell-wide space-y-6">
      <PageHeader
        title="我的創作專案"
        subtitle="集中查看每個專案的進度，選擇一個繼續往下做。"
        primaryAction={
          <Button variant="outline" onClick={() => setLocation("/")}>
            回到創作中樞
          </Button>
        }
      />

      {isLoading && projects.length === 0 ? (
        <SectionCard
          title="載入專案中…"
          description="正在從伺服器取回你的創作專案。"
          icon={<FolderOpen className="size-4" aria-hidden />}
        >
          <div
            data-testid="projects-list-loading"
            className="h-2 w-1/2 animate-pulse rounded bg-muted"
          />
        </SectionCard>
      ) : error && projects.length === 0 ? (
        <SectionCard
          title="載入失敗"
          description="專案清單暫時拿不回來，稍後再試一次。"
          icon={<FolderOpen className="size-4" aria-hidden />}
        >
          <p data-testid="projects-list-error" className="text-xs text-muted-foreground">
            {error}
          </p>
        </SectionCard>
      ) : projects.length === 0 ? (
        <SectionCard
          title="還沒有專案"
          description="建立一個專案後就會出現在這裡。"
          icon={<FolderOpen className="size-4" aria-hidden />}
        >
          <Button onClick={() => setLocation("/")}>
            <FolderPlus className="mr-1 size-4" aria-hidden />
            建立創作專案
          </Button>
        </SectionCard>
      ) : (
        <>
          <section
            aria-label="專案概覽"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <ProjectStat label="全部專案" value={counts.total} tone="primary" />
            <ProjectStat label="進行中" value={counts.active} />
            <ProjectStat label="已完成" value={counts.completed} tone="success" />
            <div className="rounded-2xl border border-border/55 bg-card/70 p-4">
              <p className="text-xs text-muted-foreground">平均完成度</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{counts.average}%</p>
            </div>
          </section>

          <section
            aria-label="專案篩選工具列"
            className="rounded-2xl border border-border/55 bg-card/65 p-4 shadow-[var(--shadow-healing-sm)]"
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <label className="relative block min-w-0 flex-1 xl:max-w-md">
                <span className="sr-only">搜尋專案</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="搜尋專案名稱、目前步驟或下一步…"
                  aria-label="搜尋專案"
                  data-testid="projects-search"
                  className="pl-9"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>狀態</span>
                  <select
                    value={statusFilter}
                    onChange={event => setStatusFilter(event.target.value as "all" | ProjectStatus)}
                    aria-label="專案狀態篩選"
                    data-testid="projects-status-filter"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                  >
                    {STATUS_FILTERS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>排序</span>
                  <select
                    value={sortBy}
                    onChange={event => setSortBy(event.target.value as "updated" | "progress")}
                    aria-label="專案排序方式"
                    data-testid="projects-sort"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring"
                  >
                    <option value="updated">最近更新</option>
                    <option value="progress">完成度最高</option>
                  </select>
                </label>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
              <Sparkles className="size-3.5 text-primary" aria-hidden />
              顯示 {visibleProjects.length} / {projects.length} 個專案
            </p>
          </section>

          {visibleProjects.length > 0 ? (
            <ul
              data-testid="projects-list"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
              {visibleProjects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onContinue={continueProject}
                  onDuplicate={projectToDuplicate =>
                    duplicateMutation.mutate({ id: Number(projectToDuplicate.id) })
                  }
                  duplicatePending={duplicateMutation.isPending}
                />
              ))}
            </ul>
          ) : (
            <SectionCard
              title="沒有符合條件的專案"
              description="試著換一個關鍵字或清除狀態篩選。"
              icon={<Search className="size-4" aria-hidden />}
            >
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                清除篩選
              </Button>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
