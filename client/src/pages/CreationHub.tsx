import { useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/contexts/ProjectsContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { ArrowRight, Layers, Plus } from "lucide-react";

interface ProgressBindingProps {
  label: string;
  done: boolean;
  onAdd?: () => void;
}

function ProgressBinding({ label, done, onAdd }: ProgressBindingProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
        done
          ? "border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/30"
          : "border-dashed border-muted-foreground/30 bg-muted/30"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {done ? (
          <span className="text-emerald-600 dark:text-emerald-300">✓</span>
        ) : (
          <Plus className="size-3 text-muted-foreground" />
        )}
        {label}
      </span>
      {done ? (
        <span className="text-[10px] text-muted-foreground">已綁定</span>
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

export default function CreationHub() {
  const [, setLocation] = useLocation();
  const { activeProject, projects } = useProjects();

  const projectStage = useMemo(() => {
    if (!activeProject) return "尚未啟動";
    return activeProject.updatedAt ? "製作中" : "概念規劃";
  }, [activeProject]);

  const updatedAtLabel = useMemo(() => {
    if (!activeProject?.updatedAt) return "尚無紀錄";
    try {
      return new Date(activeProject.updatedAt).toLocaleString();
    } catch {
      return String(activeProject.updatedAt);
    }
  }, [activeProject?.updatedAt]);

  useRegisterPageAgent({
    pageId: "create",
    pageLabel: "創作作業系統",
    pagePath: "/create",
    capabilities: [],
    state: { surface: "creation-dashboard" },
    handle: async () => ({ ok: false, reason: "create: no-op" }),
  });

  const hasProject = !!activeProject;
  const projectCount = projects.length;

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
          {projectCount > 0 ? `共 ${projectCount} 個專案` : "尚未建立專案"}
        </Badge>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pb-10">
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm">
          {hasProject ? (
            <>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    當前專案
                  </p>
                  <h2 className="mt-1 text-xl font-semibold leading-tight">
                    {activeProject!.title}
                  </h2>
                </div>
                <Badge className="shrink-0" variant="secondary">
                  {projectStage}
                </Badge>
              </div>

              <p className="mb-4 text-xs text-muted-foreground">
                最後更新：{updatedAtLabel}
              </p>

              <div className="mb-5 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  目前進度
                </p>
                <ProgressBinding
                  label="世界觀"
                  done
                  onAdd={() => setLocation("/director")}
                />
                <ProgressBinding
                  label="腳本"
                  done
                  onAdd={() => setLocation("/director")}
                />
                <ProgressBinding
                  label="分鏡"
                  done={false}
                  onAdd={() => setLocation("/animation")}
                />
                <ProgressBinding
                  label="素材"
                  done={false}
                  onAdd={() => setLocation("/assets")}
                />
              </div>

              <Button
                size="lg"
                className="w-full text-base"
                onClick={() => setLocation("/projects")}
              >
                繼續創作
                <ArrowRight className="ml-1 size-4" />
              </Button>
              <Button
                variant="link"
                className="mt-2 w-full text-xs"
                onClick={() => setLocation("/projects")}
              >
                查看所有專案
              </Button>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Layers className="mb-3 size-10 text-primary/60" />
              <h2 className="text-lg font-semibold">建立你的第一個影片專案</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                把世界觀、腳本、分鏡與素材綁在同一個專案下,光球可以跨頁協助。
              </p>
              <Button
                className="mt-5"
                onClick={() => setLocation("/creative-projects")}
              >
                <Plus className="mr-1 size-4" />
                建立影片專案
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
