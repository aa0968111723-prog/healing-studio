/**
 * ProjectsListPage — /projects
 *
 * Step 3 skeleton: lists every project in ProjectsContext as a card so the
 * user can pick one to continue. Each card surfaces the required fields
 * (title / type / status / progress / currentStep / nextAction / updatedAt)
 * plus a 繼續創作 button that pins activeProjectId and routes to detail.
 */
import { useLocation } from "wouter";
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
import { ArrowRight, FolderOpen, FolderPlus } from "lucide-react";

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("zh-Hant", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function ProjectsListPage() {
  const { projects, setActiveProjectId } = useProjects();
  const [, setLocation] = useLocation();

  const continueProject = (project: Project) => {
    setActiveProjectId(project.id);
    setLocation(`/projects/${project.id}`);
  };

  return (
    <div className="page-shell page-shell-default space-y-6">
      <PageHeader
        title="我的創作專案"
        subtitle="挑一個專案繼續創作，或從首頁開始新的。"
        primaryAction={
          <Button variant="outline" onClick={() => setLocation("/")}>
            回到創作中樞
          </Button>
        }
      />

      {projects.length === 0 ? (
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
        <ul
          data-testid="projects-list"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {projects.map(project => (
            <li key={project.id} data-testid={`project-card-${project.id}`}>
              <article className="flex h-full flex-col gap-3 rounded-xl border border-border/40 bg-card/40 p-4">
                <header className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold">
                      {project.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {PROJECT_TYPE_LABELS[project.type]} ·{" "}
                      {PROJECT_STATUS_LABELS[project.status]}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {PROJECT_STATUS_LABELS[project.status]}
                  </Badge>
                </header>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>進度</span>
                    <span data-testid={`project-progress-${project.id}`}>
                      {project.progress}%
                    </span>
                  </div>
                  <Progress value={project.progress} className="h-1.5" />
                </div>

                <div className="space-y-1 text-xs">
                  <p>
                    <span className="text-muted-foreground">目前步驟：</span>
                    {project.currentStep}
                  </p>
                  <p>
                    <span className="text-muted-foreground">下一步：</span>
                    {project.nextAction}
                  </p>
                </div>

                <footer className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="text-[11px] text-muted-foreground">
                    更新於 {formatUpdatedAt(project.updatedAt)}
                  </span>
                  <Button
                    size="sm"
                    onClick={() => continueProject(project)}
                    data-testid={`continue-${project.id}`}
                  >
                    繼續創作
                    <ArrowRight className="ml-1 size-4" aria-hidden />
                  </Button>
                </footer>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
