import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useProjects } from "@/contexts/ProjectsContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { PROJECT_STATUS_LABELS, type Project } from "@/types/projects";
import {
  ArrowRight,
  Check,
  Clapperboard,
  Plus,
  Sparkles,
} from "lucide-react";

interface BindingRowProps {
  label: string;
  value: string | undefined;
  onAdd: () => void;
  onOpen: () => void;
}

function BindingRow({ label, value, onAdd, onOpen }: BindingRowProps) {
  const bound = Boolean(value && value.trim());
  return (
    <div
      data-bound={bound ? "true" : "false"}
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
        bound
          ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/30"
          : "border-dashed border-muted-foreground/30 bg-muted/30"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {bound ? (
          <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-300" />
        ) : (
          <Plus className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 font-medium">{label}</span>
        {bound ? (
          <button
            type="button"
            onClick={onOpen}
            className="ml-1 min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
            title={value}
          >
            {value}
          </button>
        ) : (
          <span className="ml-1 italic text-muted-foreground">未綁定</span>
        )}
      </span>
      {bound ? (
        <span className="text-[10px] text-emerald-700 dark:text-emerald-300">
          已綁定
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="text-[10px] text-primary hover:underline"
        >
          + 新增
        </button>
      )}
    </div>
  );
}

interface VideoProjectCardProps {
  project: Project;
  onContinue: () => void;
  onOpenWorldview: () => void;
  onOpenScript: () => void;
  onOpenStoryboard: () => void;
  onViewAll: () => void;
}

function VideoProjectCard({
  project,
  onContinue,
  onOpenWorldview,
  onOpenScript,
  onOpenStoryboard,
  onViewAll,
}: VideoProjectCardProps) {
  const progress = Math.min(100, Math.max(0, project.progress));
  const updatedAtLabel = useMemo(() => {
    try {
      return new Date(project.updatedAt).toLocaleString();
    } catch {
      return project.updatedAt;
    }
  }, [project.updatedAt]);

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            當前影片專案
          </p>
          <h2
            className="mt-1 truncate text-xl font-semibold leading-tight"
            data-testid="video-project-title"
          >
            {project.title}
          </h2>
        </div>
        <Badge className="shrink-0" variant="secondary">
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>

      <div className="mb-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>進度</span>
          <span data-testid="video-project-progress">{progress}%</span>
        </div>
        <Progress value={progress} className="h-2" />
        <p className="pt-1 text-xs text-muted-foreground">
          目前步驟：{project.currentStep}
        </p>
      </div>

      <div className="mb-5 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">進度綁定</p>
        <BindingRow
          label="世界觀"
          value={project.binding?.worldFramework}
          onAdd={onOpenWorldview}
          onOpen={onOpenWorldview}
        />
        <BindingRow
          label="腳本"
          value={project.binding?.directorSession}
          onAdd={onOpenScript}
          onOpen={onOpenScript}
        />
        <BindingRow
          label="分鏡"
          value={project.binding?.storyboard}
          onAdd={onOpenStoryboard}
          onOpen={onOpenStoryboard}
        />
      </div>

      <div className="mb-5 rounded-xl border border-primary/40 bg-background/60 p-4">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3" /> 下一步
        </p>
        <p
          className="text-sm leading-relaxed"
          data-testid="video-project-next-action"
        >
          {project.nextAction}
        </p>
      </div>

      <Button
        size="lg"
        className="w-full text-base"
        onClick={onContinue}
        data-testid="video-project-continue"
      >
        繼續創作
        <ArrowRight className="ml-1 size-4" />
      </Button>
      <Button
        variant="link"
        className="mt-2 w-full text-xs"
        onClick={onViewAll}
      >
        查看所有影片專案
      </Button>

      <p className="mt-3 text-[11px] text-muted-foreground">
        最後更新：{updatedAtLabel}
      </p>
    </section>
  );
}

interface NewVideoProjectFormProps {
  onCreate: (draft: { title: string; worldFramework?: string }) => void;
}

function NewVideoProjectForm({ onCreate }: NewVideoProjectFormProps) {
  const [title, setTitle] = useState("");
  const [worldFramework, setWorldFramework] = useState("");

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      title: trimmed,
      worldFramework: worldFramework.trim() || undefined,
    });
    setTitle("");
    setWorldFramework("");
  };

  return (
    <section
      data-testid="video-project-empty-form"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm"
    >
      <div className="mb-4 flex flex-col items-center text-center">
        <Clapperboard className="mb-2 size-9 text-primary/70" />
        <h2 className="text-lg font-semibold">建立你的第一個影片專案</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          先取個名字，世界觀可以之後再綁。建立完會自動鎖定為當前專案。
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-xs font-medium">
          <span className="mb-1 block text-muted-foreground">專案名稱</span>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例：禪修短片企劃"
            data-testid="new-video-title-input"
            onKeyDown={e => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>
        <label className="block text-xs font-medium">
          <span className="mb-1 block text-muted-foreground">
            世界觀（選填）
          </span>
          <Input
            value={worldFramework}
            onChange={e => setWorldFramework(e.target.value)}
            placeholder="例：禪修世界觀 v1，或留空"
          />
        </label>
      </div>

      <Button
        className="mt-5 w-full"
        size="lg"
        onClick={submit}
        disabled={!canSubmit}
        data-testid="new-video-submit"
      >
        <Plus className="mr-1 size-4" />
        建立並開始
      </Button>
    </section>
  );
}

export default function CreationHub() {
  const [, setLocation] = useLocation();
  const { projects, activeProjectId, setActiveProjectId, createProject } =
    useProjects();

  const videoProjects = useMemo<Project[]>(
    () =>
      projects
        .filter(p => p.type === "video")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects],
  );

  const activeVideoProject = useMemo<Project | null>(() => {
    if (videoProjects.length === 0) return null;
    const pinned = videoProjects.find(p => p.id === activeProjectId);
    return pinned ?? videoProjects[0];
  }, [videoProjects, activeProjectId]);

  useRegisterPageAgent({
    pageId: "create",
    pageLabel: "影片專案管理區",
    pagePath: "/create",
    capabilities: [],
    state: { surface: "creation-dashboard" },
    handle: async () => ({ ok: false, reason: "create: no-op" }),
  });

  const projectCount = videoProjects.length;

  const handleCreate = ({
    title,
    worldFramework,
  }: {
    title: string;
    worldFramework?: string;
  }) => {
    createProject({ title, type: "video", worldFramework });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            創作作業系統
          </p>
          <h1 className="text-2xl font-semibold">影片專案管理區</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {projectCount > 0
            ? `共 ${projectCount} 個影片專案`
            : "尚未建立影片專案"}
        </Badge>
      </header>

      <main className="mx-auto w-full max-w-3xl space-y-4 px-6 pb-10">
        {videoProjects.length > 0 ? (
          <>
            <nav
              data-testid="video-project-switcher"
              className="flex flex-wrap items-center gap-2"
              aria-label="切換影片專案"
            >
              {videoProjects.map(p => {
                const selected = p.id === activeVideoProject?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProjectId(p.id)}
                    data-testid={`video-project-tab-${p.id}`}
                    data-selected={selected ? "true" : "false"}
                    className={`max-w-[180px] truncate rounded-full border px-3 py-1.5 text-xs transition ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-card hover:border-primary/40 hover:bg-primary/5"
                    }`}
                    title={p.title}
                  >
                    {p.title}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setLocation("/creative-projects")}
                data-testid="video-project-new-link"
                className="flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
              >
                <Plus className="size-3" />
                新增影片專案
              </button>
            </nav>

            <VideoProjectCard
              project={activeVideoProject!}
              onContinue={() => setLocation(`/projects/${activeVideoProject!.id}`)}
              onOpenWorldview={() => setLocation("/worldbuilding")}
              onOpenScript={() => setLocation("/director")}
              onOpenStoryboard={() => setLocation("/animation")}
              onViewAll={() => setLocation("/projects")}
            />
          </>
        ) : (
          <NewVideoProjectForm onCreate={handleCreate} />
        )}
      </main>
    </div>
  );
}
