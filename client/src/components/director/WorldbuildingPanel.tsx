/**
 * WorldbuildingPanel — 導演 AI 的世界觀儀表板
 *
 * 重新設計：取代舊的草稿編輯器，改為任務表 / 儀表板形式。
 *   - 展示所有已建立的世界觀框架（角色數、場景數、LoRA 連結）
 *   - 每個世界觀有任務進度指示（待辦事項 checklist）
 *   - 最上方有「進入世界觀系統」的主要 CTA 按鈕
 *   - 深度編輯一律引導到 /animation 完整世界觀系統
 */

import { memo, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Film,
  Users,
  MapPin,
  Link2,
  ChevronRight,
  Plus,
  CheckCircle2,
  Circle,
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Smile,
  Shirt,
  Volume2,
  Theater,
  Camera,
  ArrowRight,
} from "lucide-react";
import type { WorldbuildingFrameworkData } from "../../../../shared/worldbuilding-types";

type LoadedFramework = WorldbuildingFrameworkData & {
  id: number;
  createdAt?: Date;
  updatedAt?: Date;
};

// ─── 任務進度指示器 ──────────────────────────────────────────────────────────

type TaskItem = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  done: boolean;
  count?: number;
};

function getWorldTasks(fw: LoadedFramework): TaskItem[] {
  const hasCharacters = (fw.characters?.length ?? 0) > 0;
  const hasScenes = (fw.scenes?.length ?? 0) > 0;
  const hasLoRA = (fw.linkedModelIds?.length ?? 0) > 0;
  const hasStyleProfile = (fw.styleProfiles?.length ?? 0) > 0;
  const hasMusicTheme = (fw.musicThemes?.length ?? 0) > 0;

  const chars = fw.characters ?? [];
  const hasThreeView = chars.some(
    c =>
      c.threeViewSheet?.frontImageUrl ||
      c.threeViewSheet?.sideImageUrl ||
      c.threeViewSheet?.backImageUrl
  );
  const hasExpression = chars.some(c => (c.expressions?.length ?? 0) > 0);
  const hasVoice = chars.some(
    c => c.voiceProfile?.voiceId || c.voiceProfile?.engine
  );

  return [
    {
      key: "characters",
      label: "角色",
      Icon: Users,
      done: hasCharacters,
      count: fw.characters?.length,
    },
    {
      key: "scenes",
      label: "場景",
      Icon: MapPin,
      done: hasScenes,
      count: fw.scenes?.length,
    },
    {
      key: "threeview",
      label: "三視圖",
      Icon: ImageIcon,
      done: hasThreeView,
    },
    {
      key: "expression",
      label: "表情包",
      Icon: Smile,
      done: hasExpression,
    },
    {
      key: "outfit",
      label: "穿衣集",
      Icon: Shirt,
      done: chars.some(c => (c.outfits?.length ?? 0) > 0),
    },
    {
      key: "voice",
      label: "配音",
      Icon: Volume2,
      done: hasVoice,
    },
    {
      key: "script-role",
      label: "腳本定位",
      Icon: Theater,
      done: chars.some(
        c => c.scriptRole?.archetype || c.scriptRole?.arcType
      ),
    },
    {
      key: "style",
      label: "風格設定",
      Icon: Sparkles,
      done: hasStyleProfile,
      count: fw.styleProfiles?.length,
    },
    {
      key: "music",
      label: "配樂主題",
      Icon: Camera,
      done: hasMusicTheme,
      count: fw.musicThemes?.length,
    },
    {
      key: "lora",
      label: "LoRA 連結",
      Icon: Link2,
      done: hasLoRA,
      count: fw.linkedModelIds?.length,
    },
  ];
}

// ─── 世界觀任務卡 ──────────────────────────────────────────────────────────

const WorldCard = memo(function WorldCard({
  fw,
  onNavigate,
}: {
  fw: LoadedFramework;
  onNavigate: (id: number) => void;
}) {
  const tasks = useMemo(() => getWorldTasks(fw), [fw]);
  const doneCount = tasks.filter(t => t.done).length;
  const pct = Math.round((doneCount / tasks.length) * 100);

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

      {/* Progress bar */}
      <div className="px-3 pt-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">
            完成度 {doneCount}/{tasks.length}
          </span>
          <span className="text-[10px] font-semibold text-primary">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Task grid */}
      <div className="p-3 grid grid-cols-5 gap-1.5">
        {tasks.map(task => {
          const Icon = task.Icon;
          return (
            <button
              key={task.key}
              type="button"
              onClick={() => onNavigate(fw.id)}
              title={task.label + (task.done ? "（已完成）" : "（待設定）")}
              className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg text-[9px] font-medium transition border ${
                task.done
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-muted/20 text-muted-foreground border-border/20 hover:bg-muted/40"
              }`}
            >
              <Icon className="w-3 h-3" />
              <span className="leading-tight text-center">
                {task.label}
                {task.count != null && task.count > 0 && (
                  <span className="ml-0.5 font-mono">({task.count})</span>
                )}
              </span>
              {task.done ? (
                <CheckCircle2 className="w-2.5 h-2.5 text-primary" />
              ) : (
                <Circle className="w-2.5 h-2.5 opacity-30" />
              )}
            </button>
          );
        })}
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
          本頁僅供快速瀏覽與進入。角色三視圖、表情、穿衣、配音、腳本定位、LoRA 連結、風格設定、分鏡時間軸等深度功能請前往世界觀系統完成。
        </p>
      </div>
    </div>
  );
}
