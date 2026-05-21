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
  href: string;
  icon: LucideIcon;
}

export const DEFAULT_QUICK_START_ENTRIES: QuickStartEntry[] = [
  {
    id: "video",
    label: "做一支影片",
    description: "走影片創作室、世界觀或導演分鏡。",
    href: "/video-studio",
    icon: Film,
  },
  {
    id: "poster",
    label: "做一張海報 / 文宣",
    description: "用圖片創作室排版主視覺、文案排版。",
    href: "/image-studio",
    icon: ImagePlus,
  },
  {
    id: "image",
    label: "產生圖片",
    description: "從提示詞、風格、模型快速生成圖片。",
    href: "/image-studio",
    icon: ImageIcon,
  },
  {
    id: "audio",
    label: "產生配音 / 音樂",
    description: "音樂、語音、音效專業工作台。",
    href: "/pro-studio",
    icon: Music,
  },
  {
    id: "assets",
    label: "整理素材",
    description: "上傳並管理素材，建立創作資料庫。",
    href: "/teaching-archive",
    icon: Layers,
  },
  {
    id: "train",
    label: "訓練模型",
    description: "LoRA 訓練流程、角色鍛造、版本管理。",
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
      description="挑一個任務直接開工，光球會跟著你進到那個系統。"
      icon={<Sparkles className="size-4" aria-hidden />}
    >
      <ul
        data-testid="quick-start-list"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {entries.map(entry => {
          const Icon = entry.icon;
          return (
            <li key={entry.id}>
              <Link
                href={entry.href}
                data-testid={`quick-start-${entry.id}`}
                className="group flex h-full flex-col gap-2 rounded-xl border border-border/40 bg-card/40 p-3 transition hover:border-primary/40 hover:bg-card/70"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {entry.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {entry.description}
                </span>
                <span className="mt-auto inline-flex items-center gap-1 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  前往
                  <ArrowRight className="size-3" aria-hidden />
                </span>
              </Link>
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
