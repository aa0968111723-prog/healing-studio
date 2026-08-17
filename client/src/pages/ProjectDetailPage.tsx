import { Link, useLocation, useParams } from "wouter";
import { useProjects } from "@/contexts/ProjectsContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  type Project,
} from "@/types/projects";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  ExternalLink,
  FileText,
  Home,
  Layers3,
  Sparkles,
} from "lucide-react";

interface WorkflowStep {
  key: "world" | "storyboard" | "director";
  label: string;
  description: string;
  href: string;
  value?: string;
  testId: string;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-Hant", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nextWorkspaceFor(binding: Project["binding"]): {
  href: string;
  label: string;
} {
  const hasWorld = Boolean(binding?.worldFramework?.trim());
  const hasStoryboard = Boolean(binding?.storyboard?.trim());
  if (!hasWorld) return { href: "/worldbuilding", label: "前往建立世界觀" };
  if (!hasStoryboard) return { href: "/animation", label: "前往建立分鏡" };
  return { href: "/director", label: "進入導演工作室生成" };
}

function workflowSteps(project: Project): WorkflowStep[] {
  return [
    {
      key: "world",
      label: "世界觀",
      description: "建立作品的核心設定與語氣",
      href: "/worldbuilding",
      value: project.binding?.worldFramework,
      testId: "binding-world-framework",
    },
    {
      key: "storyboard",
      label: "分鏡板",
      description: "把想法拆成可執行的畫面節奏",
      href: "/animation",
      value: project.binding?.storyboard,
      testId: "binding-storyboard",
    },
    {
      key: "director",
      label: "導演工作室",
      description: "整合素材並開始生成與調整",
      href: "/director",
      value: project.binding?.directorSession,
      testId: "binding-director-session",
    },
  ];
}

function WorkflowCard({ project }: { project: Project }) {
  const nextWorkspace = nextWorkspaceFor(project.binding);
  const steps = workflowSteps(project);

  return (
    <section
      className="rounded-2xl border border-border/60 bg-card/70 p-5 shadow-[var(--shadow-healing-sm)]"
      aria-labelledby="project-workflow-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            創作路徑
          </p>
          <h2 id="project-workflow-title" className="mt-1 text-lg font-semibold">
            從想法走到作品
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            每個階段都會把成果帶到下一個工作區，隨時可以回頭調整。
          </p>
        </div>
        <Layers3 className="mt-1 size-5 shrink-0 text-primary/70" aria-hidden />
      </div>

      <ul
        data-testid="project-detail-bindings"
        className="mt-5 grid gap-3 xl:grid-cols-3"
      >
        {steps.map((step, index) => {
          const bound = Boolean(step.value?.trim());
          const isNext = step.href === nextWorkspace.href;
          return (
            <li
              key={step.key}
              data-testid={step.testId}
              data-bound={bound ? "true" : "false"}
              className="relative"
            >
              <Link
                href={step.href}
                className={`group flex h-full min-h-40 flex-col rounded-xl border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-healing-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  bound
                    ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/25"
                    : isNext
                      ? "border-primary/45 bg-primary/5"
                      : "border-dashed border-border bg-muted/25"
                }`}
                title={step.value ?? `前往${step.label}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <span
                      className={`flex size-7 items-center justify-center rounded-full ${
                        bound
                          ? "bg-emerald-600 text-white"
                          : isNext
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {bound ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </span>
                    {step.label}
                  </span>
                  <ExternalLink
                    className="size-3.5 text-muted-foreground transition group-hover:text-foreground"
                    aria-hidden
                  />
                </span>
                <span className="mt-4 flex-1">
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {step.description}
                  </span>
                  <span
                    className={`mt-3 block truncate text-sm ${
                      bound ? "font-medium text-foreground" : "italic text-muted-foreground"
                    }`}
                  >
                    {bound ? step.value : "尚未綁定"}
                  </span>
                </span>
                <span className="mt-3 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  {bound ? "已綁定，可開啟" : isNext ? "目前建議步驟" : "待開始"}
                  <ArrowRight className="size-3 transition group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        想改綁定到別的世界觀或分鏡板？到{" "}
        <Link
          href="/creative-projects"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          創作專案主控台
        </Link>{" "}
        上點該專案的「綁定」即可。
      </p>
    </section>
  );
}

function ProjectDetailLoading() {
  return (
    <div className="page-shell page-shell-default space-y-6">
      <PageHeader title="載入專案中…" subtitle="正在從伺服器取回專案內容。" />
      <SectionCard title="請稍候" description="專案資料載入中。">
        <div
          data-testid="project-detail-loading"
          className="h-2 w-1/2 animate-pulse rounded bg-muted"
        />
      </SectionCard>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { getProjectById, isLoading } = useProjects();
  const [, setLocation] = useLocation();
  const project = params.id ? getProjectById(params.id) : undefined;

  if (!project && isLoading) return <ProjectDetailLoading />;

  if (!project) {
    return (
      <div className="page-shell page-shell-default space-y-6">
        <PageHeader
          title="找不到這個專案"
          subtitle="這個專案可能已被封存或不存在。"
          primaryAction={
            <Button onClick={() => setLocation("/projects")}>回到專案列表</Button>
          }
        />
        <SectionCard
          title="專案不存在"
          description={`找不到 id 為「${params.id ?? ""}」的專案。`}
        >
          <Button asChild variant="ghost">
            <Link href="/">
              <Home className="mr-1 size-4" aria-hidden />
              回到創作中樞
            </Link>
          </Button>
        </SectionCard>
      </div>
    );
  }

  const nextWorkspace = nextWorkspaceFor(project.binding);
  const progress = Math.min(100, Math.max(0, project.progress));
  const statusLabel = PROJECT_STATUS_LABELS[project.status];

  return (
    <div className="page-shell page-shell-wide space-y-6">
      <header
        data-testid="project-detail-hero"
        className="overflow-hidden rounded-3xl border border-primary/25 bg-[linear-gradient(135deg,rgba(194,97,63,0.1),rgba(255,255,255,0.48)_52%,rgba(240,231,216,0.62))] p-6 shadow-[var(--shadow-healing-md)] lg:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            data-testid="project-detail-back-home"
          >
            <Link href="/projects">
              <ArrowLeft className="mr-1 size-4" aria-hidden />
              返回專案列表
            </Link>
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            最後更新 {formatDateTime(project.updatedAt)}
          </span>
        </div>

        <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              專案工作台
            </p>
            <h1 className="mt-2 max-w-3xl truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {project.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {project.currentStep}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="outline" data-testid="project-detail-type">
                {PROJECT_TYPE_LABELS[project.type]}
              </Badge>
              <Badge variant="outline" data-testid="project-detail-status">
                {statusLabel}
              </Badge>
              <Badge variant="secondary" data-testid="project-detail-progress">
                進度 {progress}%
              </Badge>
            </div>
          </div>

          <div className="rounded-2xl border border-primary/25 bg-background/65 p-4 backdrop-blur-sm">
            <p className="text-xs font-medium text-muted-foreground">目前進度</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <span className="text-4xl font-semibold tracking-tight">{progress}%</span>
              <span className="pb-1 text-xs text-muted-foreground">完成度</span>
            </div>
            <Progress value={progress} className="mt-3 h-2" />
            <Button
              asChild
              size="lg"
              className="mt-5 w-full shadow-sm"
              data-testid="project-detail-continue"
            >
              <Link href={nextWorkspace.href}>
                {nextWorkspace.label}
                <ArrowRight className="ml-1 size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <main className="min-w-0 space-y-6">
          <section
            data-testid="project-detail-current-step"
            className="grid gap-3 rounded-2xl border border-border/60 bg-card/60 p-5 shadow-[var(--shadow-healing-sm)] sm:grid-cols-[minmax(0,1.2fr)_minmax(12rem,0.8fr)]"
          >
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                目前步驟
              </div>
              <p
                data-testid="project-detail-current-step-text"
                className="mt-3 text-base font-medium leading-relaxed"
              >
                {project.currentStep}
              </p>
            </div>
            <div className="rounded-xl bg-muted/45 p-4">
              <p className="text-xs text-muted-foreground">專案狀態</p>
              <p className="mt-1 text-sm font-medium">{statusLabel}</p>
              <p className="mt-3 text-xs text-muted-foreground">建立於</p>
              <p className="mt-1 text-sm font-medium">{formatDateTime(project.createdAt)}</p>
            </div>
          </section>

          <WorkflowCard project={project} />
        </main>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <section className="rounded-2xl border border-primary/35 bg-primary/5 p-5 shadow-[var(--shadow-healing-md)]">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <Sparkles className="size-3.5" aria-hidden />
              下一步建議
            </p>
            <h2 className="mt-3 text-lg font-semibold">把進度往前推一步</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {project.nextAction}
            </p>
            <Button asChild className="mt-5 w-full" data-testid="project-detail-continue-aside">
              <Link href={nextWorkspace.href}>
                {nextWorkspace.label}
                <ArrowRight className="ml-1 size-4" aria-hidden />
              </Link>
            </Button>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card/60 p-5 shadow-[var(--shadow-healing-sm)]">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" aria-hidden />
              <h2 className="font-semibold">快速進入工作區</h2>
            </div>
            <div className="mt-4 grid gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="justify-between"
                data-testid="project-detail-open-worldview"
              >
                <Link href="/worldbuilding">
                  世界觀
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="justify-between"
                data-testid="project-detail-open-storyboard"
              >
                <Link href="/animation">
                  分鏡
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="justify-between"
                data-testid="project-detail-open-director"
              >
                <Link href="/director">
                  導演工作室
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            <Button asChild variant="ghost" size="sm" className="mt-3 w-full">
              <Link href="/">
                <Home className="mr-1 size-3.5" aria-hidden />
                回到創作中樞
              </Link>
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
