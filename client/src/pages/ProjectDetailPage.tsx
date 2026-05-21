/**
 * ProjectDetailPage — /projects/:id
 *
 * Step 3 placeholder. Renders project name / type / status / current step /
 * next-action plus a 「回到創作中樞」 button. No editing or generation flow
 * yet — those land in later steps.
 */
import { Link, useParams, useLocation } from "wouter";
import { useProjects } from "@/contexts/ProjectsContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { SectionCard } from "@/components/layout/SectionCard";
import { NextStepPanel } from "@/components/layout/NextStepPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
} from "@/types/projects";
import { ArrowLeft, Home } from "lucide-react";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { getProjectById } = useProjects();
  const [, setLocation] = useLocation();
  const project = params.id ? getProjectById(params.id) : undefined;

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

  return (
    <div className="page-shell page-shell-default space-y-6">
      <PageHeader
        title={project.title}
        subtitle={`${PROJECT_TYPE_LABELS[project.type]} · ${PROJECT_STATUS_LABELS[project.status]}`}
        badges={
          <>
            <Badge variant="outline" data-testid="project-detail-type">
              {PROJECT_TYPE_LABELS[project.type]}
            </Badge>
            <Badge variant="outline" data-testid="project-detail-status">
              {PROJECT_STATUS_LABELS[project.status]}
            </Badge>
            <Badge variant="secondary" data-testid="project-detail-progress">
              進度 {project.progress}%
            </Badge>
          </>
        }
        primaryAction={
          <Button asChild data-testid="project-detail-back-home">
            <Link href="/">
              <ArrowLeft className="mr-1 size-4" aria-hidden />
              回到創作中樞
            </Link>
          </Button>
        }
        secondaryActions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/projects">查看所有專案</Link>
          </Button>
        }
      />

      <SectionCard
        title="進度"
        description={`目前完成 ${project.progress}%`}
      >
        <Progress value={project.progress} className="h-2" />
      </SectionCard>

      <SectionCard title="目前步驟" data-testid="project-detail-current-step">
        <p className="text-sm" data-testid="project-detail-current-step-text">
          {project.currentStep}
        </p>
      </SectionCard>

      <SectionCard
        title="綁定狀態"
        description="世界觀、分鏡板、導演對話會在這裡跟著專案走。"
      >
        <ul
          data-testid="project-detail-bindings"
          className="space-y-1.5 text-sm"
        >
          <BindingRow
            label="世界觀"
            value={project.binding?.worldFramework}
            testId="binding-world-framework"
          />
          <BindingRow
            label="分鏡板"
            value={project.binding?.storyboard}
            testId="binding-storyboard"
          />
          <BindingRow
            label="導演對話"
            value={project.binding?.directorSession}
            testId="binding-director-session"
          />
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          想改綁定到別的世界觀或分鏡板？到{" "}
          <Link
            href="/creative-projects"
            className="text-primary underline-offset-2 hover:underline"
          >
            創作專案主控台
          </Link>{" "}
          上點該專案的「綁定」即可。
        </p>
      </SectionCard>

      <NextStepPanel
        title="下一步建議"
        description={project.nextAction}
        primaryAction={
          <Button variant="outline" asChild>
            <Link href="/projects">回到專案列表</Link>
          </Button>
        }
      />
    </div>
  );
}

function BindingRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | undefined;
  testId: string;
}) {
  const bound = Boolean(value && value.trim());
  return (
    <li
      data-testid={testId}
      data-bound={bound ? "true" : "false"}
      className="flex items-center justify-between gap-3"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={bound ? "text-foreground" : "italic text-muted-foreground"}>
        {bound ? value : "未綁定"}
      </span>
    </li>
  );
}
