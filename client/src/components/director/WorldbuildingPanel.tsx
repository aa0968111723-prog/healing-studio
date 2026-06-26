/**
 * WorldbuildingPanel — 導演 AI 的世界觀儀表板
 *
 * 一條龍設計：清單 + 內嵌編輯器在同一頁面，避免跳到 /animation。
 *   - 上方：每個世界觀的摘要卡（完成度、角色 / 場景數、LoRA、警告）
 *   - 點卡片 → 在下方展開 WorldbuildingInlineEditor 直接編輯
 *   - 一鍵新增世界觀（呼叫 worldbuilding.create，不跳頁）
 *   - 一鍵把目前世界觀的腳本帶到分鏡 tab
 *   - 進階功能（LoRA 訓練、分鏡時間軸、製作管線）才開新分頁到 /animation
 */

import { memo, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Film,
  Users,
  MapPin,
  Link2,
  ChevronRight,
  ChevronDown,
  Plus,
  CheckCircle2,
  Circle,
  Sparkles,
  Wand2,
  Volume2,
  AlertTriangle,
  Music,
  Palette,
  ArrowRight,
  X,
  Loader2,
} from "lucide-react";
import type {
  WorldbuildingFrameworkData,
  WorldCharacter,
  WorldScene,
} from "../../../../shared/worldbuilding-types";
import {
  calculateWorldbuildingProgress,
  type WorldProgressCategory,
  type WorldProgressCategoryKey,
  type WorldProgressResult,
} from "../../../../shared/worldbuilding-progress";
import { getWorldbuildingActionPlan } from "../../../../shared/worldbuilding-actions";
import { ProductionPackagePreview } from "@/components/animation/ProductionPackagePreview";
import WorldbuildingInlineEditor from "./WorldbuildingInlineEditor";

type LoadedFramework = WorldbuildingFrameworkData & {
  id: number;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface WorldbuildingPanelProps {
  /** 由父層（DirectorAI）傳入：被選中的世界觀 id；用於跨分頁同步狀態 */
  selectedWorldId?: number | null;
  /** 由父層通知選擇變更（讓「腳本 → 分鏡」可以共享同一個世界觀） */
  onSelectWorld?: (worldId: number | null) => void;
  /** 由父層處理「生成分鏡」按鈕（通常會切到 script tab 或開分鏡 dialog） */
  onCreateStoryboard?: (worldId: number) => void;
}

const CATEGORY_ICON: Record<
  WorldProgressCategoryKey,
  React.ComponentType<{ className?: string }>
> = {
  characters: Users,
  scenes: MapPin,
  style: Palette,
  music: Music,
  voice: Volume2,
};

// ─── 類別小條 ──────────────────────────────────────────────────────────────

function CategoryRow({ cat }: { cat: WorldProgressCategory }) {
  const Icon = CATEGORY_ICON[cat.key];
  const colorClass =
    cat.status === "complete"
      ? "text-primary"
      : cat.status === "partial"
        ? "text-amber-500"
        : "text-muted-foreground/60";
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium truncate">
            {cat.label}
            {cat.count > 0 && (
              <span className="ml-1 text-[10px] font-mono text-muted-foreground">
                ({cat.count})
              </span>
            )}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {cat.completedItems}/{cat.totalItems}
            <span className="ml-1.5 text-[10px] font-semibold text-primary">
              {cat.percent}%
            </span>
          </span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
          <div
            className={`h-full rounded-full transition-all ${
              cat.status === "complete"
                ? "bg-primary"
                : cat.status === "partial"
                  ? "bg-amber-400/80"
                  : "bg-muted-foreground/30"
            }`}
            style={{ width: `${cat.percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── 展開後的細節清單 ─────────────────────────────────────────────────────

function CharactersDetail({ characters }: { characters: WorldCharacter[] }) {
  if (characters.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        尚未建立任何角色。
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {characters.slice(0, 8).map(c => {
        const tags: string[] = [];
        if (c.role) tags.push(c.role);
        if (c.body?.ageStage) tags.push(c.body.ageStage);
        if (c.scriptRole?.archetype) tags.push(c.scriptRole.archetype);
        return (
          <div
            key={c.id}
            className="rounded border border-border/20 bg-card/30 p-2"
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[11px] font-medium truncate">
                {c.name || "(未命名)"}
              </span>
              {tags.map(t => (
                <Badge key={t} variant="outline" className="text-[9px] h-3.5 px-1">
                  {t}
                </Badge>
              ))}
            </div>
            {c.appearance ? (
              <p className="text-[10px] text-muted-foreground line-clamp-2">
                {c.appearance}
              </p>
            ) : (
              <p className="text-[10px] text-amber-500/80 italic">
                尚未填寫外觀
              </p>
            )}
          </div>
        );
      })}
      {characters.length > 8 && (
        <p className="text-[10px] text-muted-foreground italic">
          … 另有 {characters.length - 8} 個角色
        </p>
      )}
    </div>
  );
}

function ScenesDetail({ scenes }: { scenes: WorldScene[] }) {
  if (scenes.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        尚未建立任何場景。
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {scenes.slice(0, 8).map(s => (
        <div
          key={s.id}
          className="rounded border border-border/20 bg-card/30 p-2"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-medium truncate">
              {s.name || "(未命名)"}
            </span>
            {s.mood && (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                {s.mood}
              </Badge>
            )}
          </div>
          {s.environment || s.tagline ? (
            <p className="text-[10px] text-muted-foreground line-clamp-2">
              {s.tagline ?? s.environment}
            </p>
          ) : (
            <p className="text-[10px] text-amber-500/80 italic">
              尚未填寫場景說明
            </p>
          )}
        </div>
      ))}
      {scenes.length > 8 && (
        <p className="text-[10px] text-muted-foreground italic">
          … 另有 {scenes.length - 8} 個場景
        </p>
      )}
    </div>
  );
}

// ─── 世界觀任務卡 ──────────────────────────────────────────────────────────

const WorldCard = memo(function WorldCard({
  fw,
  isSelected,
  onSelect,
  onCreateStoryboard,
  onOpenCanvas,
}: {
  fw: LoadedFramework;
  isSelected: boolean;
  onSelect: () => void;
  onCreateStoryboard?: () => void;
  onOpenCanvas?: () => void;
}) {
  const progress: WorldProgressResult = useMemo(
    () => calculateWorldbuildingProgress(fw),
    [fw]
  );
  const [expandedDetail, setExpandedDetail] = useState<
    "characters" | "scenes" | null
  >(null);

  const overallColorClass =
    progress.status === "complete"
      ? "from-primary/80 to-primary"
      : progress.status === "partial"
        ? "from-amber-400/70 to-primary/80"
        : "from-muted-foreground/30 to-muted-foreground/40";

  const lora = fw.linkedModelIds ?? [];
  const topWarnings = progress.blockingWarnings.slice(0, 2);
  const actionPlan = useMemo(() => getWorldbuildingActionPlan(fw), [fw]);
  const topBlockers = actionPlan.blockers.slice(0, 2);

  return (
    <div
      className={`rounded-xl border transition-all group ${
        isSelected
          ? "border-primary/70 bg-primary/[0.06] ring-2 ring-primary/30"
          : "border-border/40 bg-card/40 hover:bg-card/60"
      }`}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onSelect}
        className="w-full flex items-center justify-between p-3 border-b border-border/20 text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Film
            className={`w-4 h-4 shrink-0 ${
              isSelected ? "text-primary" : "text-primary/70"
            }`}
          />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate flex items-center gap-1.5">
              {fw.name}
              {isSelected && (
                <Badge variant="default" className="text-[9px] h-4 px-1.5">
                  編輯中
                </Badge>
              )}
            </div>
            {fw.genre && (
              <div className="text-[10px] text-muted-foreground truncate">
                {fw.genre}
                {fw.era ? ` · ${fw.era}` : ""}
              </div>
            )}
          </div>
        </div>
        <span className="text-[10px] gap-1 shrink-0 inline-flex items-center text-muted-foreground group-hover:text-foreground transition">
          {isSelected ? "收合" : "展開編輯"}
          <ChevronRight
            className={`w-3 h-3 transition-transform ${isSelected ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {/* Overall progress meter — 完成度 Meter */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center gap-3">
          {/* Circular percentage badge */}
          <div
            className={`relative flex items-center justify-center w-12 h-12 rounded-full shrink-0 bg-gradient-to-br ${overallColorClass}`}
            style={{ padding: "3px" }}
          >
            <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
              <span
                className={`text-[13px] font-extrabold tabular-nums leading-none ${
                  progress.status === "complete"
                    ? "text-primary"
                    : progress.status === "partial"
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }`}
              >
                {progress.overall}
                <span className="text-[8px]">%</span>
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-foreground/80">
                整體完成度
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {progress.completedCount}/{progress.totalCount} 項目
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${overallColorClass} transition-all`}
                style={{ width: `${progress.overall}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Per-category progress rows */}
      <div className="px-3 pt-2 pb-2 space-y-0.5">
        {Object.values(progress.categories).map(cat => (
          <CategoryRow key={cat.key} cat={cat} />
        ))}
        {/* LoRA 連結補一行（非進度，但給使用者看狀態） */}
        <div className="flex items-center gap-2 py-1">
          <Link2
            className={`w-3.5 h-3.5 shrink-0 ${
              lora.length > 0
                ? "text-primary"
                : "text-muted-foreground/60"
            }`}
          />
          <div className="flex-1 min-w-0 flex items-center justify-between">
            <span className="text-[11px] font-medium">
              LoRA 連結
              {lora.length > 0 && (
                <span className="ml-1 text-[10px] font-mono text-muted-foreground">
                  ({lora.length})
                </span>
              )}
            </span>
            {lora.length > 0 ? (
              <CheckCircle2 className="w-3 h-3 text-primary" />
            ) : (
              <Circle className="w-3 h-3 text-muted-foreground/30" />
            )}
          </div>
        </div>
      </div>

      {/* Action plan */}
      <div className="mx-3 mt-2 rounded border border-primary/20 bg-primary/[0.04] px-2 py-1.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-primary">
            建議下一步：{actionPlan.primaryAction.label}
          </span>
          <Badge
            variant={actionPlan.readyForGeneration ? "default" : "outline"}
            className="text-[9px] h-4 px-1.5"
          >
            {actionPlan.readyForGeneration ? "可生成" : "尚需補齊"}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {actionPlan.primaryAction.description}
        </p>
        {topBlockers.length > 0 && (
          <ul className="text-[10px] text-amber-700 dark:text-amber-300 list-disc ml-4">
            {topBlockers.map(b => (
              <li key={b.id}>{b.reason}</li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* 入口 1：內嵌編輯（在頁面下方展開 WorldbuildingInlineEditor） */}
          <Button
            size="sm"
            className="h-6 text-[10px]"
            onClick={e => {
              e.stopPropagation();
              onSelect();
            }}
          >
            {isSelected ? "收合編輯器" : actionPlan.primaryAction.cta}
          </Button>
          {/* 入口 2：進入世界觀畫布（AnimationStudio 完整製作管線） */}
          {onOpenCanvas && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] gap-1"
              onClick={e => {
                e.stopPropagation();
                onOpenCanvas();
              }}
            >
              <Film className="w-2.5 h-2.5" />
              進入畫布
            </Button>
          )}
          {actionPlan.readyForGeneration && onCreateStoryboard && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] gap-1"
              onClick={e => {
                e.stopPropagation();
                onCreateStoryboard();
              }}
            >
              <Sparkles className="w-2.5 h-2.5" />
              生成分鏡
            </Button>
          )}
          <ProductionPackagePreview world={fw} />
        </div>
      </div>

      {/* Warning banner */}
      {topWarnings.length > 0 && (
        <div className="mx-3 mb-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
          <div className="flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 text-amber-500 mt-[1px] shrink-0" />
            <div className="flex-1 min-w-0 space-y-0.5">
              {topWarnings.map((w, idx) => (
                <p
                  key={idx}
                  className="text-[10px] text-amber-700 dark:text-amber-300 leading-tight"
                >
                  {w}
                </p>
              ))}
              {progress.blockingWarnings.length > topWarnings.length && (
                <p className="text-[9px] text-muted-foreground">
                  …另有 {progress.blockingWarnings.length - topWarnings.length} 個提示
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expandable detail panels */}
      <div className="border-t border-border/20 px-3 py-2 space-y-1.5">
        <Collapsible
          open={expandedDetail === "characters"}
          onOpenChange={open => setExpandedDetail(open ? "characters" : null)}
        >
          <CollapsibleTrigger className="w-full flex items-center justify-between text-[10px] font-medium text-muted-foreground hover:text-foreground transition">
            <span className="flex items-center gap-1.5">
              {expandedDetail === "characters" ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              查看角色細節（{fw.characters?.length ?? 0}）
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <CharactersDetail characters={fw.characters ?? []} />
          </CollapsibleContent>
        </Collapsible>
        <Collapsible
          open={expandedDetail === "scenes"}
          onOpenChange={open => setExpandedDetail(open ? "scenes" : null)}
        >
          <CollapsibleTrigger className="w-full flex items-center justify-between text-[10px] font-medium text-muted-foreground hover:text-foreground transition">
            <span className="flex items-center gap-1.5">
              {expandedDetail === "scenes" ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
              查看場景細節（{fw.scenes?.length ?? 0}）
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ScenesDetail scenes={fw.scenes ?? []} />
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
});

// ─── 主面板 ───────────────────────────────────────────────────────────────

export default function WorldbuildingPanel({
  selectedWorldId,
  onSelectWorld,
  onCreateStoryboard,
}: WorldbuildingPanelProps = {}) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const listQuery = trpc.worldbuilding.list.useQuery(undefined, {
    retry: false,
  });

  // 內部備援：如果父層沒給 selectedWorldId，自己管。
  const [internalSelected, setInternalSelected] = useState<number | null>(null);
  const effectiveSelected =
    selectedWorldId !== undefined ? selectedWorldId : internalSelected;

  const setSelected = (id: number | null) => {
    if (onSelectWorld) onSelectWorld(id);
    else setInternalSelected(id);
  };

  const frameworks = (listQuery.data ?? []) as LoadedFramework[];

  // 進入頁面時自動選第一個（讓使用者不用再點一次）
  useEffect(() => {
    if (effectiveSelected !== null) return;
    if (frameworks.length > 0) {
      setSelected(frameworks[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameworks.length, effectiveSelected]);

  const createMut = trpc.worldbuilding.create.useMutation({
    onSuccess: data => {
      toast.success("世界觀已建立，往下捲動就能開始填寫");
      utils.worldbuilding.list.invalidate();
      setSelected(data.id);
    },
    onError: e => toast.error(`建立失敗：${e.message}`),
  });

  const handleCreateBlankWorld = () => {
    const name = `新世界觀 ${new Date().toLocaleDateString("zh-TW", {
      month: "numeric",
      day: "numeric",
    })}`;
    createMut.mutate({
      name,
      description: "",
      characters: [],
      scenes: [],
    });
  };

  return (
    <div className="space-y-4">
      {/* 主要 CTA — 一條龍提示 */}
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/[0.06] to-transparent p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="rounded-xl bg-primary/15 p-2.5 shrink-0">
            <Film className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
              世界觀系統
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                內嵌編輯
              </Badge>
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              在本頁就能編輯角色、場景、風格——下方點任何世界觀卡片就會展開編輯器，不用跳到 /animation。
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateBlankWorld}
              disabled={createMut.isPending}
              className="gap-1.5 rounded-xl h-8 text-xs"
            >
              {createMut.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              空白新增
            </Button>
            <Button
              onClick={() => navigate("/animation")}
              size="sm"
              className="shrink-0 gap-1.5 rounded-xl h-8 text-xs"
            >
              <Wand2 className="w-3.5 h-3.5" />
              貼劇本 AI 全自動
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* 儀表板主體 */}
      {listQuery.isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground animate-pulse">
          載入中…
        </div>
      ) : frameworks.length === 0 ? (
        /* 沒有世界觀時的空狀態 */
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center space-y-3">
          <Film className="w-10 h-10 mx-auto text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              還沒有世界觀
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              世界觀幫你把腳本變成可生成的影片專案：整理角色、場景、風格、聲音、分鏡與生成提示詞。
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleCreateBlankWorld}
              disabled={createMut.isPending}
              className="gap-2 rounded-xl"
            >
              {createMut.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              空白新增
            </Button>
            <Button
              onClick={() => navigate("/animation")}
              className="gap-2 rounded-xl"
            >
              <Wand2 className="w-4 h-4" />
              從一句話建立世界觀
            </Button>
          </div>
        </div>
      ) : (
        /* 世界觀任務列表 */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              我的世界觀（{frameworks.length}）
            </h4>
            {effectiveSelected !== null && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(null)}
                className="h-7 text-xs gap-1 rounded-lg"
              >
                <X className="w-3 h-3" />
                收合編輯器
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-[35vh]">
            <div className="space-y-2.5 pr-1">
              {frameworks.map(fw => (
                <WorldCard
                  key={fw.id}
                  fw={fw}
                  isSelected={effectiveSelected === fw.id}
                  onSelect={() =>
                    setSelected(
                      effectiveSelected === fw.id ? null : fw.id
                    )
                  }
                  onCreateStoryboard={
                    onCreateStoryboard
                      ? () => onCreateStoryboard(fw.id)
                      : undefined
                  }
                  onOpenCanvas={() => navigate("/animation")}
                />
              ))}
            </div>
          </ScrollArea>

          {/* 內嵌編輯器 */}
          {effectiveSelected !== null && (
            <WorldbuildingInlineEditor
              key={effectiveSelected}
              worldId={effectiveSelected}
              onCreateStoryboard={
                onCreateStoryboard
                  ? () => onCreateStoryboard(effectiveSelected)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {/* 底部說明 */}
      <div className="rounded-xl border border-border/30 bg-card/20 px-3 py-2.5 text-[11px] text-muted-foreground space-y-0.5">
        <div className="flex items-center gap-1.5 font-medium text-foreground/70">
          <Sparkles className="w-3 h-3" /> 一條龍工作流
        </div>
        <p>
          對話 → 腳本 → 世界觀（內嵌編輯） → 分鏡 → 生成，全部在「導演 AI」這頁完成。
          深度功能（三視圖、表情包、配音匯入、LoRA 訓練、分鏡時間軸、製作管線）會在世界觀卡片內顯示「進階編輯」連結。
        </p>
      </div>
    </div>
  );
}
