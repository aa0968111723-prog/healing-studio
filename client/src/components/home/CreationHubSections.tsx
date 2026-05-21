/**
 * CreationHubSections.tsx — pure sections rendered by the post-login home.
 *
 * These components stay free of context hooks so the home page can unit-test
 * them without mounting the whole provider stack. Home.tsx wires data +
 * callbacks in.
 *
 * Section A (繼續上次專案) now drives off the Step 3 Project shape — title /
 * type / status / progress / currentStep / nextAction / updatedAt — backed
 * by ProjectsContext + MOCK_PROJECTS for now.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SectionCard } from "@/components/layout/SectionCard";
import { NextStepPanel } from "@/components/layout/NextStepPanel";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  type Project,
} from "@/types/projects";
import {
  ArrowRight,
  FolderPlus,
  FolderOpen,
  Sparkles,
  Film,
  Image as ImageIcon,
  Music,
  Layers,
  Cpu,
  ImagePlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── A. 繼續上次專案 ─────────────────────────────────────────────────────────

export interface ContinueProjectSectionProps {
  /** Latest-updated project to surface. `null` triggers the empty CTA. */
  activeProject: Project | null;
  loading?: boolean;
}

export function ContinueProjectSection({
  activeProject,
  loading,
}: ContinueProjectSectionProps) {
  if (loading) {
    return (
      <SectionCard
        title="繼續上次專案"
        description="載入你的創作專案…"
        icon={<FolderOpen className="size-4" aria-hidden />}
      >
        <div
          data-testid="continue-project-loading"
          className="h-16 animate-pulse rounded-lg bg-muted/40"
        />
      </SectionCard>
    );
  }

  if (activeProject) {
    return (
      <SectionCard
        title="繼續上次專案"
        description="從上次離開的地方接著做。"
        icon={<FolderOpen className="size-4" aria-hidden />}
      >
        <div data-testid="continue-project-active" className="space-y-3">
          <NextStepPanel
            title={activeProject.title}
            description={activeProject.nextAction}
            status={
              <Badge variant="outline" className="text-[10px]">
                {PROJECT_STATUS_LABELS[activeProject.status]}
              </Badge>
            }
            reason={`目前步驟：${activeProject.currentStep}`}
            primaryAction={
              <Button asChild size="sm">
                <Link href={`/projects/${activeProject.id}`}>
                  繼續這個專案
                  <ArrowRight className="ml-1 size-4" aria-hidden />
                </Link>
              </Button>
            }
            secondaryActions={
              <Button asChild size="sm" variant="ghost">
                <Link href="/projects">查看所有專案</Link>
              </Button>
            }
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {PROJECT_TYPE_LABELS[activeProject.type]} · 進度{" "}
                {activeProject.progress}%
              </span>
            </div>
            <Progress value={activeProject.progress} className="h-1.5" />
          </div>
        </div>
      </SectionCard>
    );
  }

  // Empty state — phrased as an invitation, not an error.
  return (
    <SectionCard
      title="繼續上次專案"
      description="還沒有專案。建立一個，把腳本、世界觀、素材綁在一起。"
      icon={<FolderOpen className="size-4" aria-hidden />}
    >
      <div
        data-testid="continue-project-empty"
        className="flex flex-wrap items-center gap-3"
      >
        <Button asChild>
          <Link href="/projects">
            <FolderPlus className="mr-1 size-4" aria-hidden />
            建立創作專案
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          建立後就會出現在這裡，下次登入直接繼續。
        </p>
      </div>
    </SectionCard>
  );
}

// ─── B. 快速開始 ─────────────────────────────────────────────────────────────

export interface QuickStartEntry {
  id: string;
  label: string;
  description: string;
  /** 卡片底部按鈕文字（每張卡都有自己的動詞）。 */
  buttonLabel: string;
  href: string;
  icon: LucideIcon;
}

export const DEFAULT_QUICK_START_ENTRIES: QuickStartEntry[] = [
  {
    id: "video",
    label: "做一支影片",
    description: "從想法、腳本、分鏡到素材生成，建立一個影片專案。",
    buttonLabel: "開始製作",
    href: "/video-studio",
    icon: Film,
  },
  {
    id: "poster",
    label: "做一張海報 / 文宣",
    description: "快速產生活動文案、視覺方向與設計草稿。",
    buttonLabel: "開始設計",
    href: "/image-studio",
    icon: ImagePlus,
  },
  {
    id: "image",
    label: "產生圖片",
    description: "進入圖像工作室,生成角色圖、場景圖或宣傳圖。",
    buttonLabel: "前往圖像",
    href: "/image-studio",
    icon: ImageIcon,
  },
  {
    id: "audio",
    label: "產生配音 / 音樂",
    description: "製作旁白、角色聲音、背景音樂或音效。",
    buttonLabel: "前往聲音",
    href: "/pro-studio",
    icon: Music,
  },
  {
    id: "assets",
    label: "整理素材",
    description: "管理圖片、影片、音訊、提示詞與生成紀錄。",
    buttonLabel: "整理資料",
    href: "/teaching-archive",
    icon: Layers,
  },
  {
    id: "train",
    label: "訓練模型",
    description: "建立角色模型、風格模型或 LoRA 訓練任務。",
    buttonLabel: "開始訓練",
    href: "/models",
    icon: Cpu,
  },
];

export interface QuickStartSectionProps {
  entries?: QuickStartEntry[];
}

export function QuickStartSection({
  entries = DEFAULT_QUICK_START_ENTRIES,
}: QuickStartSectionProps) {
  return (
    <SectionCard
      title="快速開始"
      description="今天想創作什麼？"
      icon={<Sparkles className="size-4" aria-hidden />}
    >
      <ul
        data-testid="quick-start-list"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {entries.map(entry => {
          const Icon = entry.icon;
          return (
            <li key={entry.id}>
              <article
                data-testid={`quick-start-${entry.id}`}
                className={[
                  // 卡片本體 — 圓角 + 邊框 + 柔光 + 漸層底
                  "group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl p-4",
                  "border border-border/50 bg-gradient-to-br from-card/70 via-card/50 to-card/30",
                  "shadow-sm",
                  // hover 互動 — 微上浮 + 邊框發亮 + 陰影加深
                  "transition-all duration-200 ease-out",
                  "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10",
                ].join(" ")}
              >
                {/* 內側 highlight — 給卡片一點科技感的玻璃光感 */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/0 via-transparent to-primary/5 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                />

                <header className="relative flex items-center gap-2">
                  <span className="inline-flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 transition-transform duration-200 group-hover:scale-105">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-semibold tracking-tight">
                    {entry.label}
                  </h3>
                </header>

                <p className="relative text-xs leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>

                <div className="relative mt-auto pt-1">
                  <Button
                    asChild
                    size="sm"
                    variant="secondary"
                    className="w-full justify-between gap-1 rounded-xl transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
                    data-testid={`quick-start-${entry.id}-button`}
                  >
                    <Link href={entry.href}>
                      {entry.buttonLabel}
                      <ArrowRight
                        className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </Button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

// ─── C. 直接問光球 ──────────────────────────────────────────────────────────

export interface AskOrbSectionProps {
  /** Called when the user submits a non-empty goal. Home wires this to a
   *  navigate-to-/agent + sessionStorage hand-off. */
  onSubmit: (prompt: string) => void;
  /** Called when the user clicks "直接打開光球" without typing anything. */
  onOpenAgent: () => void;
  /** Optional extra block rendered below the form — e.g. for an example chip
   *  row. Home doesn't pass one today; tests use it to assert composition. */
  footer?: ReactNode;
}

export function AskOrbSection({
  onSubmit,
  onOpenAgent,
  footer,
}: AskOrbSectionProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      onOpenAgent();
      return;
    }
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <SectionCard
      title="直接問光球"
      description="告訴光球你的目標，它會幫你定位到正確系統。"
      icon={<Sparkles className="size-4" aria-hidden />}
    >
      <form
        data-testid="ask-orb-form"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={handleSubmit}
      >
        <Input
          data-testid="ask-orb-input"
          aria-label="告訴光球你的目標"
          placeholder="例如：幫我做一支 30 秒的療癒短片"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <div className="flex gap-2 sm:shrink-0">
          <Button type="submit" data-testid="ask-orb-submit">
            交給光球
            <ArrowRight className="ml-1 size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenAgent}
            data-testid="ask-orb-open"
          >
            直接打開光球
          </Button>
        </div>
      </form>
      {footer}
    </SectionCard>
  );
}
