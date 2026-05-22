import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useProjects } from "@/contexts/ProjectsContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import {
  ArrowRight,
  Sparkles,
  Clapperboard,
  Image,
  Music2,
  FolderKanban,
  Brain,
  Wand2,
  Layers,
  Plus,
  BookOpen,
  Bot,
  Database,
  Settings,
  Palette,
} from "lucide-react";

const quickActions = [
  { label: "做一支影片", icon: Clapperboard, path: "/studio/video" },
  { label: "做一張海報文宣", icon: Wand2, path: "/design" },
  { label: "產生圖片", icon: Image, path: "/studio/image" },
  { label: "產生配音音樂", icon: Music2, path: "/studio/pro" },
  { label: "整理素材", icon: FolderKanban, path: "/library" },
  { label: "訓練模型", icon: Brain, path: "/lora" },
] as const;

const sixSystems = [
  {
    id: "orb",
    name: "光球代理系統",
    icon: Bot,
    path: "/orb",
    blurb: "告訴光球目標,讓它幫你決定下一步去哪裡。",
  },
  {
    id: "design",
    name: "設計 / 規劃 / 執行",
    icon: Palette,
    path: "/design",
    blurb: "把點子排成設計案、規劃流程,逐步交付。",
  },
  {
    id: "director",
    name: "影片腳本 / 世界觀",
    icon: Clapperboard,
    path: "/director",
    blurb: "從世界觀到分鏡腳本,一條線生成完整影片。",
  },
  {
    id: "library",
    name: "資料庫系統",
    icon: Database,
    path: "/library",
    blurb: "彙整素材、模型訓練資料與資產池。",
  },
  {
    id: "settings",
    name: "全站設定系統",
    icon: Settings,
    path: "/settings",
    blurb: "管理創作偏好、權限、訂閱與帳號。",
  },
  {
    id: "learn",
    name: "學習文件系統",
    icon: BookOpen,
    path: "/learn",
    blurb: "從新手導覽到進階,逐步建立創作能力。",
  },
] as const;

type OrbPromptGroup = {
  id: "video" | "design" | "models";
  label: string;
  template: string;
};

const ORB_PROMPT_GROUPS: OrbPromptGroup[] = [
  {
    id: "video",
    label: "影片創作",
    template:
      "我想做一支短影片,幫我從世界觀、腳本、分鏡到生成排出可執行的下一步。",
  },
  {
    id: "design",
    label: "設計文宣",
    template:
      "我要設計一張海報/社群文宣,幫我規劃版面、風格與必要素材清單。",
  },
  {
    id: "models",
    label: "模型工具",
    template:
      "我想找適合的 AI 模型完成這個任務,幫我比較選項並推薦組合。",
  },
];

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
  const [orbPrompt, setOrbPrompt] = useState("");

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

  const submitOrbPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setLocation(`/agent?prompt=${encodeURIComponent(trimmed)}`);
  };

  const hasProject = !!activeProject;
  const projectCount = projects.length;

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            創作作業系統
          </p>
          <h1 className="text-2xl font-semibold">全站創作系統專案管理區</h1>
        </div>
        <Badge variant="outline" className="text-xs">
          {projectCount > 0 ? `共 ${projectCount} 個專案` : "尚未建立專案"}
        </Badge>
      </header>

      <main className="mx-auto grid w-full max-w-6xl gap-5 px-6 pb-6 lg:grid-cols-3">
        {/* ── 左欄：快速開始（縮小,降為輔助）── */}
        <section className="rounded-2xl border bg-card/60 p-5 lg:col-span-1">
          <h2 className="mb-1 text-sm font-semibold text-muted-foreground">
            快速開始
          </h2>
          <p className="mb-3 text-xs text-muted-foreground/80">
            一鍵跳到單一工作室。
          </p>
          <div className="grid gap-1.5">
            {quickActions.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => setLocation(item.path)}
                className="group flex items-center justify-between rounded-lg border border-transparent bg-muted/40 px-3 py-2 text-sm transition hover:border-primary/30 hover:bg-primary/10"
              >
                <span className="inline-flex items-center gap-2">
                  <item.icon className="size-4 text-muted-foreground group-hover:text-primary" />
                  {item.label}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            ))}
          </div>
        </section>

        {/* ── 中欄：當前專案主控（放大,升為主角）── */}
        <section className="rounded-2xl border border-primary/30 bg-primary/5 p-6 shadow-sm lg:col-span-1">
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
              <h2 className="text-lg font-semibold">建立你的第一個創作專案</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                把世界觀、腳本、分鏡與素材綁在同一個專案下,光球可以跨頁協助。
              </p>
              <Button
                className="mt-5"
                onClick={() => setLocation("/creative-projects")}
              >
                <Plus className="mr-1 size-4" />
                建立創作專案
              </Button>
            </div>
          )}
        </section>

        {/* ── 右欄：詢問光球 ── */}
        <section className="rounded-2xl border bg-card p-5 lg:col-span-1">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" /> 詢問光球
          </h2>
          <p className="mb-3 text-xs text-muted-foreground/80">
            告訴光球你的目標,它會幫你定位到正確系統。
          </p>
          <textarea
            value={orbPrompt}
            onChange={e => setOrbPrompt(e.target.value)}
            placeholder="告訴光球你的目標,它會幫你定位到正確系統"
            className="min-h-24 w-full resize-none rounded-xl border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {ORB_PROMPT_GROUPS.map(group => (
              <Button
                key={group.id}
                size="sm"
                variant="outline"
                onClick={() => setOrbPrompt(group.template)}
                className="text-xs"
              >
                {group.label}
              </Button>
            ))}
          </div>
          <Button
            className="mt-3 w-full"
            onClick={() => submitOrbPrompt(orbPrompt)}
            disabled={!orbPrompt.trim()}
          >
            送出給光球
            <ArrowRight className="ml-1 size-4" />
          </Button>
        </section>
      </main>

      {/* ── 六大系統快速入口 ── */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-8">
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
          六大系統快速入口
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {sixSystems.map(sys => (
            <button
              key={sys.id}
              type="button"
              onClick={() => setLocation(sys.path)}
              className="group flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-md"
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <sys.icon className="size-4" />
              </span>
              <span className="text-sm font-semibold">{sys.name}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                {sys.blurb}
              </span>
              <ArrowRight className="ml-auto size-3.5 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
