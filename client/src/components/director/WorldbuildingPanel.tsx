/**
 * WorldbuildingPanel — 導演 AI 的世界觀儀表板
 *
 * 重新設計：取代舊的草稿編輯器，改為任務表 / 儀表板形式。
 *   - 展示所有已建立的世界觀框架（角色數、場景數、LoRA 連結）
 *   - 動態計算完成度（依角色、場景、風格、音樂、配音的加權平均）
 *   - 卡片可展開查看細節（每個角色、每個場景的標籤）
 *   - 缺漏項目顯示 warning 提示
 *   - 最上方有「進入世界觀系統」的主要 CTA 按鈕
 *   - 深度編輯一律引導到 /animation 完整世界觀系統
 */

import { memo, useMemo, useState } from "react";
import { useLocation } from "wouter";
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

type LoadedFramework = WorldbuildingFrameworkData & {
  id: number;
  createdAt?: Date;
  updatedAt?: Date;
};

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
              <span className="text-[11px] font-medium truncate">{c.name || "(未命名)"}</span>
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
            <span className="text-[11px] font-medium truncate">{s.name || "(未命名)"}</span>
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
  onNavigate,
}: {
  fw: LoadedFramework;
  onNavigate: (id: number) => void;
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

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 hover:bg-card/60 transition-all group">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/20">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Film className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{fw.name}</div>
            {fw.genre && (
              <div className="text-[10px] text-muted-foreground truncate">
                {fw.genre}
                {fw.era ? ` · ${fw.era}` : ""}
              </div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => onNavigate(fw.id)}
          className="h-7 text-xs gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          進入編輯
          <ChevronRight className="w-3 h-3" />
        </Button>
      </div>

      {/* Overall progress bar */}
      <div className="px-3 pt-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">
            整體完成度 {progress.completedCount}/{progress.totalCount}
          </span>
          <span className="text-[11px] font-bold text-primary tabular-nums">
            {progress.overall}%
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${overallColorClass} transition-all`}
            style={{ width: `${progress.overall}%` }}
          />
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
          onOpenChange={open =>
            setExpandedDetail(open ? "characters" : null)
          }
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

export default function WorldbuildingPanel() {
  const [, navigate] = useLocation();
  const listQuery = trpc.worldbuilding.list.useQuery(undefined, {
    retry: false,
  });

  const frameworks = (listQuery.data ?? []) as LoadedFramework[];

  const handleNavigateToWorld = (worldId?: number) => {
    if (worldId) {
      navigate(`/animation?worldId=${worldId}`);
    } else {
      navigate("/animation");
    }
  };

  return (
    <div className="space-y-4">
      {/* 主要 CTA — 進入世界觀系統 */}
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/[0.06] to-transparent p-5">
        <div className="flex items-center gap-4">
          <div className="rounded-xl bg-primary/15 p-3 shrink-0">
            <Film className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-primary flex items-center gap-1.5">
              世界觀系統
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                完整功能
              </Badge>
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              三視圖 · 表情包 · 穿衣集 · 口氣 · 配音 · 腳本定位 · LoRA · 分鏡時間軸 · 渲染管線
            </p>
          </div>
          <Button
            onClick={() => navigate("/animation")}
            className="shrink-0 gap-2 rounded-xl"
          >
            <Wand2 className="w-4 h-4" />
            進入世界觀系統
            <ArrowRight className="w-4 h-4" />
          </Button>
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
              在世界觀系統建立第一個世界，開始配置角色與場景
            </p>
          </div>
          <Button
            onClick={() => navigate("/animation")}
            className="gap-2 rounded-xl"
          >
            <Plus className="w-4 h-4" />
            建立第一個世界觀
          </Button>
        </div>
      ) : (
        /* 世界觀任務列表 */
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              我的世界觀（{frameworks.length}）
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/animation")}
              className="h-7 text-xs gap-1 rounded-lg"
            >
              <Plus className="w-3 h-3" />
              新增
            </Button>
          </div>

          <ScrollArea className="max-h-[calc(100vh-420px)]">
            <div className="space-y-2.5 pr-1">
              {frameworks.map(fw => (
                <WorldCard
                  key={fw.id}
                  fw={fw}
                  onNavigate={handleNavigateToWorld}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* 底部說明 */}
      <div className="rounded-xl border border-border/30 bg-card/20 px-3 py-2.5 text-[11px] text-muted-foreground space-y-0.5">
        <div className="flex items-center gap-1.5 font-medium text-foreground/70">
          <Sparkles className="w-3 h-3" /> 關於世界觀系統
        </div>
        <p>
          本頁僅供快速瀏覽與進入。完成度依角色 / 場景 / 風格 / 配樂 / 配音
          加權計算（30/30/20/10/10），缺漏會以提示說明影響的生成品質。
          深度編輯（三視圖、表情、穿衣、配音、腳本定位、LoRA、分鏡時間軸）請進入世界觀系統。
        </p>
      </div>
    </div>
  );
}
