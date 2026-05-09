/**
 * AgentSettingsSheet — 全站光球代理設定面板（從 /agent 頁開啟）
 * ────────────────────────────────────────────────────────────────────────────
 * 提供使用者直接在聊天頁開啟詳細的光球代理設定，包含：
 *   - 行為模式（純聊天 / 半自動 / 自動）與單次任務最多步數
 *   - 通知偏好
 *   - 工具白黑名單
 *   - 自動排程（cron）：建立 / 取消 / 列出排程任務
 *   - 全站開關（代理 / 跨頁工作流）
 *
 * 與 /settings/agent 共用 trpc.agentPreferences 與 trpc.orbScheduler，
 * 因此設定真實寫入並影響全站光球行為，不只是一個示意 UI。
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useGlobalOrbChat } from "@/contexts/GlobalOrbChatContext";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Trash2,
  CalendarPlus,
  Save,
  Play,
  Pause,
  Clock,
  AlertCircle,
  Check,
  Search,
  Eraser,
} from "lucide-react";
import {
  DEFAULT_AGENT_PREFERENCES,
  DEFAULT_PROACTIVE_TRIGGER_SETTINGS,
  resolveProactiveTriggerSettings,
  type AgentConfirmationPolicy,
  type ProactiveTriggerSettings,
  type ProactiveTriggerSettingsMap,
} from "@shared/agent-preferences";
import {
  SPIRIT_PROACTIVE_TRIGGERS,
  type ProactiveTriggerEvent,
} from "@shared/orb-agent-roles";
import ToolQuickSelectChips from "@/components/ToolQuickSelectChips";
import { SPIRITS, getSpiritVisual } from "@/lib/spiritsVisual";

type BehaviorMode = "pure_chat" | "semi_auto" | "auto";

const MODE_TO_POLICY: Record<BehaviorMode, AgentConfirmationPolicy> = {
  pure_chat: "manual",
  semi_auto: "confirm_high_risk",
  auto: "always_approve",
};

const POLICY_TO_MODE: Record<AgentConfirmationPolicy, BehaviorMode> = {
  manual: "pure_chat",
  confirm_high_risk: "semi_auto",
  confirm_all: "semi_auto",
  always_approve: "auto",
};

const MODE_DESCRIPTIONS: Record<
  BehaviorMode,
  { title: string; description: string; tone: string }
> = {
  pure_chat: {
    title: "純聊天",
    description: "光球只回字、不執行動作。最安全。",
    tone: "🌿",
  },
  semi_auto: {
    title: "半自動（推薦）",
    description: "安全動作直接做；submit / 套預設 / 跨頁工作流會先彈確認。",
    tone: "✨",
  },
  auto: {
    title: "自動",
    description: "信任光球，安全動作直接做。多步驟仍會先確認。",
    tone: "🚀",
  },
};

/**
 * 預設 cron 範例，幫使用者快速套用，避免不熟 cron 語法。
 * 顯示給人看的標籤是繁中、寫進設定的是標準 cron。
 * 全部以 台灣時間 (Asia/Taipei, UTC+8) 解讀。
 */
const CRON_PRESETS: Array<{ id: string; label: string; cron: string }> = [
  { id: "every-morning", label: "每天早上 09:00", cron: "0 9 * * *" },
  { id: "every-noon", label: "每天中午 12:00", cron: "0 12 * * *" },
  { id: "every-evening", label: "每天晚上 21:00", cron: "0 21 * * *" },
  { id: "every-late-night", label: "每天凌晨 03:00", cron: "0 3 * * *" },
  { id: "weekday-morning", label: "工作日早上 09:00", cron: "0 9 * * 1-5" },
  { id: "weekly-monday", label: "每週一 09:00", cron: "0 9 * * 1" },
  { id: "weekly-friday-evening", label: "每週五 18:00", cron: "0 18 * * 5" },
  { id: "monthly-first", label: "每月 1 號 09:00", cron: "0 9 1 * *" },
  { id: "every-hour", label: "每小時整點", cron: "0 * * * *" },
  { id: "every-30-min", label: "每 30 分鐘", cron: "*/30 * * * *" },
];

const TASK_TEMPLATES: Array<{ id: string; label: string; text: string }> = [
  {
    id: "daily-summary",
    label: "整理昨日生成紀錄",
    text: "幫我整理昨天的生成紀錄成一段短報告，列出主要主題與表現最好的 3 張作品。",
  },
  {
    id: "weekly-plan",
    label: "排出本週創作清單",
    text: "根據我最近的目標與已完成作品，排一份本週的創作清單，每天 1-2 個重點。",
  },
  {
    id: "asset-cleanup",
    label: "盤點素材庫",
    text: "盤點我素材庫裡 30 天沒用到的圖片與影片，列出可清理或重用的清單。",
  },
];

function csvToArray(csv: string): string[] {
  return csv
    .split(/[,\n]/g)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, 64);
}

function arrayToCsv(values: string[] | undefined | null): string {
  if (!Array.isArray(values)) return "";
  return values.join(", ");
}

interface AgentSettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AgentSettingsSheet({
  open,
  onOpenChange,
}: AgentSettingsSheetProps) {
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const isAuthenticated = Boolean(meQuery.data);

  const prefsQuery = trpc.agentPreferences.getPreferences.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated && open,
  });
  const updateMutation = trpc.agentPreferences.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("已儲存代理設定");
      prefsQuery.refetch();
    },
    onError: error => toast.error(`儲存失敗：${error.message ?? "未知錯誤"}`),
  });

  const initial = prefsQuery.data ?? DEFAULT_AGENT_PREFERENCES;

  const [mode, setMode] = useState<BehaviorMode>("semi_auto");
  const [maxAutoStepsPerTask, setMaxAutoStepsPerTask] = useState<number>(5);
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);
  const [autoApproveCsv, setAutoApproveCsv] = useState("");
  const [blockedCsv, setBlockedCsv] = useState("");
  const [orbAgentEnabled, setOrbAgentEnabled] = useState<boolean | null>(null);
  const [workflowsEnabled, setWorkflowsEnabled] = useState<boolean | null>(null);
  // 15 精靈：靜音 / 最愛清單。儲存型態 = AgentRole id 字串陣列。
  // mute = 路由跳過該精靈；favorite = 純 UI hint（deck 顯示星星 + 未來 ProactiveEventBus 優先通知）。
  const [mutedSpirits, setMutedSpirits] = useState<string[]>([]);
  const [favoriteSpirits, setFavoriteSpirits] = useState<string[]>([]);
  // 主動精靈通知設定 — partial map（沒列的事件 fallback 到 DEFAULT_*）。
  // UI 編輯時直接寫進這個 state，handleSave 整包送出。
  const [proactiveTriggerSettings, setProactiveTriggerSettings] =
    useState<ProactiveTriggerSettingsMap>({});

  useEffect(() => {
    if (!prefsQuery.data) return;
    const policy =
      (initial.confirmationPolicy ?? "confirm_high_risk") as AgentConfirmationPolicy;
    setMode(POLICY_TO_MODE[policy]);
    setMaxAutoStepsPerTask(initial.maxAutoStepsPerTask ?? 5);
    setNotifyOnCompletion(initial.notifyOnCompletion ?? true);
    setNotifyOnError(initial.notifyOnError ?? true);
    setAutoApproveCsv(arrayToCsv(initial.autoApproveTools));
    setBlockedCsv(arrayToCsv(initial.blockedTools));
    setOrbAgentEnabled(
      typeof initial.orbAgentEnabled === "boolean" ? initial.orbAgentEnabled : null
    );
    setWorkflowsEnabled(
      typeof initial.workflowsEnabled === "boolean" ? initial.workflowsEnabled : null
    );
    setMutedSpirits(Array.isArray(initial.mutedSpirits) ? initial.mutedSpirits : []);
    setFavoriteSpirits(Array.isArray(initial.favoriteSpirits) ? initial.favoriteSpirits : []);
    const rawTriggerSettings = (initial as { proactiveTriggerSettings?: unknown })
      ?.proactiveTriggerSettings;
    setProactiveTriggerSettings(
      rawTriggerSettings && typeof rawTriggerSettings === "object" && !Array.isArray(rawTriggerSettings)
        ? (rawTriggerSettings as ProactiveTriggerSettingsMap)
        : {},
    );
  }, [
    prefsQuery.data,
    initial.confirmationPolicy,
    initial.maxAutoStepsPerTask,
    initial.notifyOnCompletion,
    initial.notifyOnError,
    initial.autoApproveTools,
    initial.blockedTools,
    initial.orbAgentEnabled,
    initial.workflowsEnabled,
    initial.mutedSpirits,
    initial.favoriteSpirits,
    initial,
  ]);

  const handleSave = () => {
    if (!isAuthenticated) {
      toast.error("請先登入再調整代理設定");
      return;
    }
    updateMutation.mutate({
      confirmationPolicy: MODE_TO_POLICY[mode],
      maxAutoStepsPerTask,
      notifyOnCompletion,
      notifyOnError,
      autoApproveTools: csvToArray(autoApproveCsv),
      blockedTools: csvToArray(blockedCsv),
      orbAgentEnabled,
      workflowsEnabled,
      mutedSpirits,
      favoriteSpirits,
      proactiveTriggerSettings,
    });
  };

  /**
   * Update one trigger event 的設定 — partial overrides 與既有 entry 合併，
   * 把全等於預設的 entry 直接刪掉維持 map 精簡（避免使用者改回預設後 row
   * 還留著一堆無意義的 entries）。
   */
  const updateTriggerSetting = (
    event: ProactiveTriggerEvent,
    patch: Partial<ProactiveTriggerSettings>,
  ) => {
    setProactiveTriggerSettings(prev => {
      const merged: ProactiveTriggerSettings = {
        ...DEFAULT_PROACTIVE_TRIGGER_SETTINGS,
        ...(prev[event] ?? {}),
        ...patch,
      };
      const isAllDefault =
        merged.enabled === DEFAULT_PROACTIVE_TRIGGER_SETTINGS.enabled &&
        merged.minIntervalMs === DEFAULT_PROACTIVE_TRIGGER_SETTINGS.minIntervalMs &&
        merged.requireAck === DEFAULT_PROACTIVE_TRIGGER_SETTINGS.requireAck;
      const next = { ...prev };
      if (isAllDefault) {
        delete next[event];
      } else {
        next[event] = merged;
      }
      return next;
    });
  };

  // 15 精靈：toggle helper — 加入 / 移除某 id。state 仍 string[]，
  // 但 SPIRITS 的 id 都是 AgentRole 列表中的有效值，不會多寫進無關字串。
  const toggleInList = (
    list: string[],
    setList: (next: string[]) => void,
    id: string,
  ) => {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">全站光球代理設定</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            這裡的設定會直接影響光球在全站的行為。沒登入也可以瀏覽，但要登入後才會儲存。
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-5 py-4">
            <Tabs defaultValue="behavior" className="w-full">
              <TabsList className="flex w-full flex-wrap">
                <TabsTrigger value="behavior" className="text-xs">
                  行為模式
                </TabsTrigger>
                <TabsTrigger value="schedule" className="text-xs">
                  自動排程
                </TabsTrigger>
                <TabsTrigger value="tools" className="text-xs">
                  工具許可
                </TabsTrigger>
                <TabsTrigger value="spirits" className="text-xs">
                  15 精靈
                </TabsTrigger>
                <TabsTrigger value="global" className="text-xs">
                  全站開關
                </TabsTrigger>
              </TabsList>

              {/* ── 行為模式 ──────────────────────────────────────── */}
              <TabsContent value="behavior" className="space-y-4 pt-4">
                <section className="space-y-3 rounded-2xl border bg-card p-4">
                  <div>
                    <h3 className="text-sm font-semibold">挑一種預設模式</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      設定後光球會用這個策略決定要不要先問你再做事。
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(Object.keys(MODE_DESCRIPTIONS) as BehaviorMode[]).map(
                      option => {
                        const meta = MODE_DESCRIPTIONS[option];
                        const active = mode === option;
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setMode(option)}
                            className={`flex h-full flex-col rounded-xl border p-3 text-left transition ${
                              active
                                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            <div className="text-base">{meta.tone}</div>
                            <div className="mt-1 text-sm font-medium">
                              {meta.title}
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
                              {meta.description}
                            </div>
                          </button>
                        );
                      }
                    )}
                  </div>
                </section>

                <section className="space-y-3 rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">通知</h3>
                  <label className="flex items-center justify-between text-sm">
                    <span>任務完成時通知我</span>
                    <Switch
                      checked={notifyOnCompletion}
                      onCheckedChange={setNotifyOnCompletion}
                    />
                  </label>
                  <label className="flex items-center justify-between text-sm">
                    <span>任務失敗時通知我</span>
                    <Switch
                      checked={notifyOnError}
                      onCheckedChange={setNotifyOnError}
                    />
                  </label>
                </section>

                <section className="space-y-2 rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">每個任務最多自動執行</h3>
                  <p className="text-xs text-muted-foreground">
                    超過這個步數光球會先停下來問你下一步怎麼走。
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-24"
                      type="number"
                      min={1}
                      max={20}
                      value={maxAutoStepsPerTask}
                      onChange={event =>
                        setMaxAutoStepsPerTask(
                          Math.max(
                            1,
                            Math.min(20, Number(event.target.value) || 1)
                          )
                        )
                      }
                    />
                    <span className="text-xs text-muted-foreground">步</span>
                  </div>
                </section>

                <section className="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
                    目前生效
                  </h3>
                  <ul className="text-xs text-foreground space-y-1 leading-relaxed">
                    <li>
                      <span className="text-muted-foreground">行為模式：</span>
                      {MODE_DESCRIPTIONS[mode].title}（
                      <code className="font-mono text-[10px] bg-muted px-1 rounded">
                        {MODE_TO_POLICY[mode]}
                      </code>
                      ）— {MODE_DESCRIPTIONS[mode].description}
                    </li>
                    <li>
                      <span className="text-muted-foreground">單一任務上限：</span>
                      {maxAutoStepsPerTask} 步（超過會先暫停問你）
                    </li>
                    <li>
                      <span className="text-muted-foreground">完成通知：</span>
                      {notifyOnCompletion ? "開啟" : "關閉"}
                      <span className="text-muted-foreground">，失敗通知：</span>
                      {notifyOnError ? "開啟" : "關閉"}
                    </li>
                  </ul>
                  <p className="text-[10px] text-muted-foreground pt-1">
                    記得按下方「儲存設定」才會寫入。
                  </p>
                </section>
              </TabsContent>

              {/* ── 自動排程 ──────────────────────────────────────── */}
              <TabsContent value="schedule" className="space-y-3 pt-4">
                <ScheduleSection isAuthenticated={isAuthenticated} />
              </TabsContent>

              {/* ── 工具許可 ──────────────────────────────────────── */}
              <TabsContent value="tools" className="space-y-3 pt-4">
                <ToolsPickerSection
                  autoApproveCsv={autoApproveCsv}
                  setAutoApproveCsv={setAutoApproveCsv}
                  blockedCsv={blockedCsv}
                  setBlockedCsv={setBlockedCsv}
                />
              </TabsContent>

              {/* ── 全站開關 ──────────────────────────────────────── */}
              {/* ── 15 精靈關係 ────────────────────────────────────── */}
              <TabsContent value="spirits" className="space-y-3 pt-4">
                <section className="space-y-2">
                  <header>
                    <h3 className="text-sm font-medium">15 精靈關係偏好</h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      靜音 = 路由不再交給這位（你 @點名 仍然會接）。最愛 = 視覺加星標，未來主動精靈通知會優先這幾位。
                    </p>
                  </header>
                  <div className="space-y-1.5">
                    {SPIRITS.map(spirit => {
                      const isMuted = mutedSpirits.includes(spirit.id);
                      const isFavorite = favoriteSpirits.includes(spirit.id);
                      return (
                        <div
                          key={spirit.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/30 px-3 py-2"
                          data-testid={`spirit-pref-row-${spirit.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span
                              className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br ${spirit.gradient} text-white text-sm shadow-sm shrink-0`}
                              aria-hidden
                            >
                              {spirit.emoji}
                            </span>
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate">
                                {spirit.nickname}
                                <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                  {spirit.label}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {spirit.vibe}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => toggleInList(favoriteSpirits, setFavoriteSpirits, spirit.id)}
                              data-testid={`spirit-pref-favorite-${spirit.id}`}
                              aria-pressed={isFavorite}
                              aria-label={`${isFavorite ? "取消" : "加入"}最愛：${spirit.nickname}`}
                              className={`text-base leading-none transition-transform hover:scale-110 ${
                                isFavorite ? "opacity-100" : "opacity-30"
                              }`}
                              title={isFavorite ? "已加入最愛 — 點一下取消" : "加入最愛"}
                            >
                              ⭐
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleInList(mutedSpirits, setMutedSpirits, spirit.id)}
                              data-testid={`spirit-pref-mute-${spirit.id}`}
                              aria-pressed={isMuted}
                              aria-label={`${isMuted ? "取消靜音" : "靜音"}：${spirit.nickname}`}
                              className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                                isMuted
                                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-300"
                                  : "bg-muted/40 text-muted-foreground hover:bg-muted"
                              }`}
                              title={isMuted ? "已靜音 — 點一下解除" : "靜音這位精靈（@點名仍會接）"}
                            >
                              {isMuted ? "已靜音" : "靜音"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                    記得按下方的「儲存」才會送到後端 selectRoleForIntent。
                  </p>
                </section>

                <section className="space-y-2 pt-2 border-t border-border/50">
                  <header>
                    <h3 className="text-sm font-medium">主動精靈通知（守守 / 巧巧 / 財財）</h3>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      決定他們什麼時候可以主動跳出來。關掉某事件 = 完全不通知；
                      間隔 = 同事件兩次顯現的最短時間；打勾消失 = 通知卡片要使用者
                      按「✓ 知道了」才會收掉（關掉就走 toast 自動消失）。
                    </p>
                  </header>
                  <div className="space-y-1.5">
                    {SPIRIT_PROACTIVE_TRIGGERS.map(trigger => {
                      const spirit = getSpiritVisual(trigger.spirit);
                      const eff = resolveProactiveTriggerSettings(
                        trigger.event as ProactiveTriggerEvent,
                        proactiveTriggerSettings,
                      );
                      const intervalMin = Math.max(
                        1,
                        Math.round(eff.minIntervalMs / 60_000),
                      );
                      return (
                        <div
                          key={`${trigger.spirit}_${trigger.event}`}
                          className="rounded-lg border border-border/50 bg-card/30 px-3 py-2 space-y-2"
                          data-testid={`proactive-trigger-row-${trigger.event}`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br ${spirit?.gradient ?? "from-slate-400 to-slate-500"} text-white text-sm shadow-sm`}
                              aria-hidden
                            >
                              {spirit?.emoji ?? "✨"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium">
                                {spirit?.nickname ?? trigger.spirit}
                                <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">
                                  {trigger.event}
                                </span>
                                <span
                                  className={`ml-1.5 inline-block text-[9px] uppercase font-mono px-1 rounded ${
                                    trigger.surface === "blocking"
                                      ? "bg-rose-500/15 text-rose-600"
                                      : trigger.surface === "inline"
                                        ? "bg-amber-500/15 text-amber-700"
                                        : "bg-slate-500/15 text-slate-600"
                                  }`}
                                >
                                  {trigger.surface}
                                </span>
                              </div>
                              <div className="text-[10px] text-muted-foreground leading-snug truncate">
                                {trigger.defaultPrompt}
                              </div>
                            </div>
                            <Switch
                              checked={eff.enabled}
                              onCheckedChange={v =>
                                updateTriggerSetting(
                                  trigger.event as ProactiveTriggerEvent,
                                  { enabled: v },
                                )
                              }
                              data-testid={`proactive-trigger-enabled-${trigger.event}`}
                              aria-label={`${eff.enabled ? "關閉" : "啟用"}：${trigger.event}`}
                            />
                          </div>
                          <div
                            className={`flex items-center gap-3 text-[11px] ${
                              eff.enabled ? "" : "opacity-40 pointer-events-none"
                            }`}
                          >
                            <label className="flex items-center gap-1.5 flex-1">
                              <span className="text-muted-foreground shrink-0">間隔</span>
                              <input
                                type="range"
                                min={1}
                                max={120}
                                step={1}
                                value={intervalMin}
                                onChange={e =>
                                  updateTriggerSetting(
                                    trigger.event as ProactiveTriggerEvent,
                                    { minIntervalMs: Number(e.target.value) * 60_000 },
                                  )
                                }
                                className="flex-1 accent-emerald-500"
                                data-testid={`proactive-trigger-interval-${trigger.event}`}
                                aria-label="同事件最短間隔（分鐘）"
                              />
                              <span className="font-mono text-muted-foreground shrink-0 w-12 text-right">
                                {intervalMin} 分
                              </span>
                            </label>
                            <label className="flex items-center gap-1.5 shrink-0">
                              <Switch
                                checked={eff.requireAck}
                                onCheckedChange={v =>
                                  updateTriggerSetting(
                                    trigger.event as ProactiveTriggerEvent,
                                    { requireAck: v },
                                  )
                                }
                                data-testid={`proactive-trigger-ack-${trigger.event}`}
                              />
                              <span className="text-muted-foreground">打勾才消失</span>
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                    blocking 等級的事件（例如即將跑高成本任務）一律強制要打勾，
                    不論你這裡怎麼設。
                  </p>
                </section>
              </TabsContent>

              <TabsContent value="global" className="space-y-3 pt-4">
                <TriStateSection
                  title="代理人總開關"
                  intro="這個開關控制全站的光球代理人能不能執行動作（不只聊天）。"
                  options={[
                    {
                      value: null,
                      label: "跟隨環境",
                      detail:
                        "用站方在 ORB_AGENT_ENABLED 設定的預設值。多數時候建議選這個。",
                    },
                    {
                      value: true,
                      label: "強制啟用",
                      detail:
                        "覆寫站方設定，永遠開著。即使站方暫時關閉光球（例如維護），你的帳號仍會嘗試執行。",
                    },
                    {
                      value: false,
                      label: "強制關閉",
                      detail:
                        "覆寫站方設定，整個帳號的光球代理人會停止執行任何動作（聊天還是可以用）。排程也會被略過。",
                    },
                  ]}
                  selected={orbAgentEnabled}
                  onChange={setOrbAgentEnabled}
                />

                <TriStateSection
                  title="跨頁工作流"
                  intro="多步驟、跨頁面的任務（例如「先生圖、再剪片、再上字幕」）。關閉後光球只能在當前頁完成單一動作。"
                  options={[
                    {
                      value: null,
                      label: "跟隨環境",
                      detail:
                        "用站方在 ORB_WORKFLOWS_ENABLED 設定的預設值。",
                    },
                    {
                      value: true,
                      label: "啟用工作流",
                      detail:
                        "覆寫站方設定，允許光球串連多步任務、跨頁規劃，並使用排程預先準備素材。",
                    },
                    {
                      value: false,
                      label: "停用工作流",
                      detail:
                        "只允許單頁、單步的工具呼叫；自動排程仍會依 cron 觸發，但只會跑「單步」任務。",
                    },
                  ]}
                  selected={workflowsEnabled}
                  onChange={setWorkflowsEnabled}
                />

                <section className="space-y-2 rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">時區與生效範圍</h3>
                  <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed list-disc pl-4">
                    <li>
                      所有自動排程都按 <span className="font-medium text-foreground">台灣時間（Asia/Taipei, UTC+8）</span>
                      解讀，伺服器位於哪個時區都不會影響。
                    </li>
                    <li>
                      上方兩個總開關套用到全站每一頁的光球（首頁、生圖、設定…），按下「儲存設定」後立即生效，不需要重新整理。
                    </li>
                    <li>
                      強制覆寫只影響你自己的帳號，其他使用者仍依站方預設或自己的設定。
                    </li>
                  </ul>
                </section>

                <section className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                  <h3 className="text-sm font-semibold text-destructive">
                    清除對話
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    把光球目前的聊天紀錄與快速回覆建議全部清掉，重新開始。不會影響你的排程、設定或帳號資料。
                  </p>
                  <ClearChatButton />
                </section>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>

        <div className="border-t px-5 py-3 flex items-center justify-between gap-2 bg-card/40">
          {!isAuthenticated ? (
            <p className="text-[11px] text-muted-foreground">
              登入後才會儲存。未登入時光球用預設策略（半自動）。
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              改完記得按「儲存」才會生效。
            </p>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMutation.isPending || !isAuthenticated}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {updateMutation.isPending ? "儲存中..." : "儲存設定"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ───────────── 自動排程子區塊 ─────────────

function ScheduleSection({ isAuthenticated }: { isAuthenticated: boolean }) {
  const jobsQuery = trpc.orbScheduler.listJobs.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const scheduleMutation = trpc.orbScheduler.scheduleJob.useMutation({
    onSuccess: () => {
      toast.success("排程已建立");
      jobsQuery.refetch();
    },
    onError: error => toast.error(`建立失敗：${error.message ?? "未知錯誤"}`),
  });
  const unscheduleMutation = trpc.orbScheduler.unscheduleJob.useMutation({
    onSuccess: () => {
      toast.success("已取消排程");
      jobsQuery.refetch();
    },
    onError: error => toast.error(`取消失敗：${error.message ?? "未知錯誤"}`),
  });
  const setEnabledMutation = trpc.orbScheduler.setEnabled.useMutation({
    onSuccess: () => jobsQuery.refetch(),
    onError: error => toast.error(`切換失敗：${error.message ?? "未知錯誤"}`),
  });
  const runNowMutation = trpc.orbScheduler.runNow.useMutation({
    onSuccess: () => {
      toast.success("已觸發執行 — 結果會回寫到「上次執行」");
      // Give the orb a beat before refetching so lastRunAt updates show up.
      setTimeout(() => jobsQuery.refetch(), 1500);
    },
    onError: error => toast.error(`執行失敗：${error.message ?? "未知錯誤"}`),
  });

  const [id, setId] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [taskDescription, setTaskDescription] = useState("");

  const trimmedCron = cron.trim();
  const previewQuery = trpc.orbScheduler.previewCron.useQuery(
    { cronExpression: trimmedCron, count: 3 },
    {
      enabled: isAuthenticated && trimmedCron.length > 0,
      retry: false,
      staleTime: 30_000,
    }
  );

  const matchedPreset = useMemo(
    () => CRON_PRESETS.find(preset => preset.cron === trimmedCron)?.id ?? null,
    [trimmedCron]
  );

  const handleCreate = () => {
    if (!isAuthenticated) {
      toast.error("請先登入再建立排程");
      return;
    }
    const trimmedId = id.trim();
    const trimmedTask = taskDescription.trim();
    if (!trimmedId || !trimmedCron || !trimmedTask) {
      toast.error("ID、cron 與任務描述都要填");
      return;
    }
    scheduleMutation.mutate({
      id: trimmedId,
      cronExpression: trimmedCron,
      taskDescription: trimmedTask,
      enabled: true,
    });
    setId("");
    setTaskDescription("");
  };

  const jobs = jobsQuery.data ?? [];

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">已排程任務</h3>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          光球會依 cron 自動跑任務（先 plan、再呼叫工具）。任務描述用繁中自然語言就可以。
        </p>
      </div>

      <div className="space-y-2">
        {!isAuthenticated && (
          <p className="text-xs text-muted-foreground">登入後才能管理自動排程。</p>
        )}
        {isAuthenticated && jobsQuery.isLoading && (
          <p className="text-xs text-muted-foreground">載入中...</p>
        )}
        {isAuthenticated && !jobsQuery.isLoading && jobs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            還沒有排程。下面挑個範本，10 秒就能設好第一個。
          </p>
        )}
        {jobs.map(job => (
          <div
            key={job.id}
            className="flex flex-col gap-2 rounded-xl border p-3 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{job.id}</span>
                  {!job.enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                      已暫停
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  <code className="rounded bg-muted px-1 mr-1 font-mono text-[10px]">
                    {job.cronExpression}
                  </code>
                  {job.cronDescription && (
                    <span className="text-foreground/80">{job.cronDescription}</span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {job.taskDescription}
                </div>
                {job.enabled && job.nextRun && (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    下次執行：{job.nextRun.label}
                    <span className="opacity-70">· {job.nextRun.relative}</span>
                  </div>
                )}
                {job.lastRunAt && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    上次執行：
                    {new Date(job.lastRunAt).toLocaleString("zh-TW", {
                      timeZone: "Asia/Taipei",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })}
                    <span className="ml-1 opacity-70">（台灣時間）</span>
                  </div>
                )}
                {job.lastError && (
                  <div className="text-[10px] text-destructive mt-0.5 flex items-start gap-1">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{job.lastError}</span>
                  </div>
                )}
                {job.lastRunStatus && (
                  <div className="text-[10px] mt-0.5">
                    <ScheduledJobStatusBadge status={job.lastRunStatus} />
                  </div>
                )}
                {job.lastResult && (
                  <details className="mt-1 text-[11px] text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">
                      查看上次產出（{job.lastResult.length} 字）
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px] leading-relaxed text-foreground/90 max-h-48 overflow-auto">
                      {job.lastResult}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => runNowMutation.mutate({ jobId: job.id })}
                  disabled={runNowMutation.isPending || !job.enabled}
                  aria-label={`立即執行 ${job.id}`}
                  title={
                    job.enabled
                      ? "立即執行一次"
                      : "排程暫停中，先恢復才能執行"
                  }
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    setEnabledMutation.mutate({
                      jobId: job.id,
                      enabled: !job.enabled,
                    })
                  }
                  disabled={setEnabledMutation.isPending}
                  aria-label={
                    job.enabled
                      ? `暫停排程 ${job.id}`
                      : `恢復排程 ${job.id}`
                  }
                  title={job.enabled ? "暫停（不刪除）" : "恢復排程"}
                >
                  {job.enabled ? (
                    <Pause className="h-3.5 w-3.5" />
                  ) : (
                    <Play className="h-3.5 w-3.5 text-emerald-500" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    if (
                      window.confirm(
                        `確定刪除排程「${job.id}」？刪除後光球會停止自動執行這個任務。`
                      )
                    ) {
                      unscheduleMutation.mutate({ jobId: job.id });
                    }
                  }}
                  disabled={unscheduleMutation.isPending}
                  aria-label={`刪除排程 ${job.id}`}
                  title="刪除排程"
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3 rounded-xl border-t pt-4">
        <h4 className="text-sm font-semibold">新增排程</h4>

        <label className="block text-xs space-y-1">
          <span className="font-medium">排程 ID</span>
          <Input
            placeholder="例：daily-summary（英數，唯一識別）"
            value={id}
            onChange={event => setId(event.target.value)}
          />
        </label>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">執行時間</span>
            <div className="flex items-center gap-1">
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40"
                title="所有 cron 都以 Asia/Taipei 解讀，下方預覽就是真實會跑的時間。"
              >
                台灣時間 UTC+8
              </span>
              <BrowserTimezoneHint />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CRON_PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setCron(preset.cron)}
                className={`text-[11px] px-2 py-1 rounded-full border transition ${
                  matchedPreset === preset.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/40 text-muted-foreground"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Input
            placeholder="或自訂 cron：0 9 * * *（分 時 日 月 週）"
            value={cron}
            onChange={event => setCron(event.target.value)}
            className="font-mono text-xs"
          />
          <CronPreview
            query={previewQuery}
            cron={trimmedCron}
            isAuthenticated={isAuthenticated}
          />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            cron 格式：分(0-59) 時(0-23) 日(1-31) 月(1-12) 週(0-6, 週日為 0)。
            所有時間都按 <span className="font-medium">台灣時間（Asia/Taipei）</span>解讀，
            不受瀏覽器或伺服器所在時區影響。
          </p>
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              cron 範例
            </summary>
            <ul className="mt-1 space-y-0.5 pl-3 list-disc">
              <li>
                <code className="font-mono">0 9 * * *</code> — 每天 09:00
              </li>
              <li>
                <code className="font-mono">30 14 * * 1-5</code> — 工作日 14:30
              </li>
              <li>
                <code className="font-mono">0 */2 * * *</code> — 每 2 小時整點
              </li>
              <li>
                <code className="font-mono">0 9 1 * *</code> — 每月 1 號 09:00
              </li>
              <li>
                <code className="font-mono">15,45 * * * *</code> — 每小時 15 分、45 分
              </li>
            </ul>
          </details>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">任務描述</span>
          <div className="flex flex-wrap gap-1.5">
            {TASK_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setTaskDescription(tpl.text);
                  if (!id.trim()) setId(tpl.id);
                }}
                className="text-[11px] px-2 py-1 rounded-full border border-border hover:border-primary/40 text-muted-foreground"
              >
                {tpl.label}
              </button>
            ))}
          </div>
          <textarea
            className="w-full rounded border p-2 text-xs"
            rows={3}
            placeholder="例：幫我整理昨天的生成紀錄成短報告"
            value={taskDescription}
            onChange={event => setTaskDescription(event.target.value)}
          />
        </div>

        <Button
          onClick={handleCreate}
          disabled={!isAuthenticated || scheduleMutation.isPending}
          size="sm"
          className="gap-1.5"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          {scheduleMutation.isPending ? "建立中..." : "建立排程"}
        </Button>
      </div>
    </section>
  );
}

// ───────────── 上次執行狀態徽章 ─────────────

/**
 * Render a one-line, colour-coded badge that summarises the most recent
 * scheduled run. The status string comes from the server:
 *
 *   - "completed"         → orchestrator finished every step
 *   - "outcome:<x>"       → orchestrator ran but ended on a non-completed FSM
 *                            outcome (failed / awaiting_approval / cancelled)
 *   - "fallback:<x>"      → planner could not produce a tasked plan; a direct
 *                            LLM completion was used instead, see lastResult
 *   - "error"             → the run threw before producing any output
 */
function ScheduledJobStatusBadge({ status }: { status: string }) {
  let label = status;
  let tone =
    "bg-muted text-muted-foreground border border-border";
  if (status === "completed") {
    label = "已完成";
    tone =
      "bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/40";
  } else if (status.startsWith("fallback:")) {
    const inner = status.slice("fallback:".length);
    const innerLabel =
      inner === "invalid"
        ? "（規劃無工具）"
        : inner === "clarification"
          ? "（需澄清）"
          : inner === "blocked"
            ? "（安全阻擋）"
            : inner === "converted"
              ? "（單頁工作流）"
              : `（${inner}）`;
    label = `已產出報告 ${innerLabel}`;
    tone =
      "bg-sky-50 text-sky-700 border border-sky-200/70 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-700/40";
  } else if (status.startsWith("outcome:")) {
    label = `未完成（${status.slice("outcome:".length)}）`;
    tone =
      "bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40";
  } else if (status === "error") {
    label = "執行錯誤";
    tone =
      "bg-rose-50 text-rose-700 border border-rose-200/70 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-700/40";
  }
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] ${tone}`}
    >
      {label}
    </span>
  );
}

// ───────────── 瀏覽器時區提示 ─────────────

/**
 * If the user's browser is in a timezone other than UTC+8, surface a small
 * hint so they understand "中午 12:00" means Taipei noon, which may not
 * match their phone's wall-clock.
 */
function BrowserTimezoneHint() {
  const hint = useMemo(() => {
    if (typeof Intl === "undefined") return null;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      // Collapse Asia/Taipei (or any +08:00 zone) — no need to nag the user.
      const offsetMin = -new Date().getTimezoneOffset(); // browser → minutes east of UTC
      if (offsetMin === 480) return null; // already UTC+8
      const sign = offsetMin >= 0 ? "+" : "-";
      const abs = Math.abs(offsetMin);
      const hh = Math.floor(abs / 60);
      const mm = abs % 60;
      const browserLabel = `UTC${sign}${String(hh).padStart(2, "0")}${
        mm ? `:${String(mm).padStart(2, "0")}` : ""
      }`;
      const diffH = (offsetMin - 480) / 60;
      const direction =
        diffH > 0 ? `比台灣早 ${diffH} 小時` : `比台灣晚 ${Math.abs(diffH)} 小時`;
      return { tz, browserLabel, direction };
    } catch {
      return null;
    }
  }, []);
  if (!hint) return null;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/70 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/40"
      title={`你的瀏覽器時區：${hint.tz} (${hint.browserLabel})，${hint.direction}。下方預覽顯示的是台灣時間。`}
    >
      你的瀏覽器：{hint.browserLabel}
    </span>
  );
}

// ───────────── Cron 即時預覽 ─────────────

interface CronPreviewData {
  ok: boolean;
  timezone?: string;
  description?: string;
  nextRuns: string[];
  nextRunsLocal?: Array<{ iso: string; label: string; relative: string }>;
  error?: string;
}

interface CronPreviewProps {
  query: { isLoading: boolean; data: CronPreviewData | undefined };
  cron: string;
  isAuthenticated: boolean;
}

function CronPreview({ query, cron, isAuthenticated }: CronPreviewProps) {
  if (!isAuthenticated || !cron) return null;
  if (query.isLoading) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3 animate-pulse" />
        計算下 3 次執行時間…
      </p>
    );
  }
  const data = query.data;
  if (!data) return null;
  if (!data.ok) {
    return (
      <p className="text-[11px] text-destructive flex items-start gap-1">
        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
        <span>{data.error ?? "cron 表達式無法解析"}</span>
      </p>
    );
  }
  // Prefer server-formatted Taiwan-localized strings; fall back to ISO if the
  // server is on an older shape (e.g. during a rolling deploy).
  const rows: Array<{ iso: string; label: string; relative: string }> =
    data.nextRunsLocal ??
    data.nextRuns.map(iso => ({
      iso,
      label: new Date(iso).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }),
      relative: "",
    }));
  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" />
        在未來 1 年內找不到符合的執行時間（cron 可能定義過嚴格）
      </p>
    );
  }
  return (
    <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-start gap-1.5 bg-emerald-50/60 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-700/40 rounded-md px-2 py-1.5">
      <Clock className="h-3 w-3 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-0.5">
        {data.description && (
          <p className="font-medium leading-snug">{data.description}</p>
        )}
        <p className="text-[10px] opacity-80">
          接下來 {rows.length} 次執行（{data.timezone ?? "Asia/Taipei"}）：
        </p>
        {rows.map(row => (
          <p key={row.iso} className="font-mono flex items-baseline gap-1.5">
            <span>{row.label}</span>
            {row.relative && (
              <span className="text-[10px] opacity-70 font-sans">
                · {row.relative}
              </span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

// ───────────── 工具許可子區塊 ─────────────

interface ToolsPickerSectionProps {
  autoApproveCsv: string;
  setAutoApproveCsv: (value: string) => void;
  blockedCsv: string;
  setBlockedCsv: (value: string) => void;
}

function ToolsPickerSection({
  autoApproveCsv,
  setAutoApproveCsv,
  blockedCsv,
  setBlockedCsv,
}: ToolsPickerSectionProps) {
  const toolsQuery = trpc.agentPreferences.listAvailableTools.useQuery(
    undefined,
    { retry: false, staleTime: 60_000 }
  );
  const tools = toolsQuery.data ?? [];

  const autoApprove = useMemo(
    () =>
      new Set(
        autoApproveCsv
          .split(/[,\n]/g)
          .map(s => s.trim())
          .filter(Boolean)
      ),
    [autoApproveCsv]
  );
  const blocked = useMemo(
    () =>
      new Set(
        blockedCsv
          .split(/[,\n]/g)
          .map(s => s.trim())
          .filter(Boolean)
      ),
    [blockedCsv]
  );

  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tools;
    return tools.filter(
      tool =>
        tool.name.toLowerCase().includes(f) ||
        tool.description.toLowerCase().includes(f)
    );
  }, [tools, filter]);

  const setStatus = (
    toolName: string,
    status: "neutral" | "allow" | "block"
  ) => {
    const nextAllow = new Set(autoApprove);
    const nextBlock = new Set(blocked);
    nextAllow.delete(toolName);
    nextBlock.delete(toolName);
    if (status === "allow") nextAllow.add(toolName);
    if (status === "block") nextBlock.add(toolName);
    setAutoApproveCsv(Array.from(nextAllow).join(", "));
    setBlockedCsv(Array.from(nextBlock).join(", "));
  };

  const customAllow = Array.from(autoApprove).filter(
    name => !tools.some(tool => tool.name === name) && name !== "*"
  );
  const customBlock = Array.from(blocked).filter(
    name => !tools.some(tool => tool.name === name) && name !== "*"
  );

  const allowAll = autoApprove.has("*");
  const blockAll = blocked.has("*");

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">工具許可</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          綠色 = 自動同意（不彈確認）；紅色 = 一律拒絕。點按鈕直接切換，不熟工具就保持灰色。
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          目前狀態：
          <span className="text-emerald-700 dark:text-emerald-400 font-medium ml-1">
            ✓ {autoApprove.size} 個自動同意
          </span>
          <span className="text-destructive font-medium ml-2">
            ✕ {blocked.size} 個封鎖
          </span>
          <span className="text-muted-foreground ml-2">
            · 其餘 {Math.max(0, tools.length - autoApprove.size - blocked.size)} 個跟隨整體策略
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <Switch
            checked={allowAll}
            onCheckedChange={value => {
              const next = new Set(autoApprove);
              if (value) next.add("*");
              else next.delete("*");
              setAutoApproveCsv(Array.from(next).join(", "));
            }}
          />
          <span>全部自動同意（*）</span>
        </label>
        <label className="flex items-center gap-1.5">
          <Switch
            checked={blockAll}
            onCheckedChange={value => {
              const next = new Set(blocked);
              if (value) next.add("*");
              else next.delete("*");
              setBlockedCsv(Array.from(next).join(", "));
            }}
          />
          <span>全部一律拒絕（*）</span>
        </label>
      </div>

      {toolsQuery.isLoading && (
        <p className="text-xs text-muted-foreground">載入工具清單中…</p>
      )}

      {!toolsQuery.isLoading && tools.length === 0 && (
        <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground space-y-1">
          <p>
            站方目前沒有對外公開的光球工具（後端 ORB_TOOL_REGISTRY_JSON 尚未設定）。
          </p>
          <p>
            你還是可以在下方「進階」用工具名稱手動加入名單，名稱要跟後端註冊一致。
          </p>
        </div>
      )}

      {tools.length > 0 && (
        <>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              placeholder="搜尋工具名稱或用途…"
              className="pl-7 text-xs"
            />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {filtered.map(tool => {
              const isAllow = autoApprove.has(tool.name);
              const isBlock = blocked.has(tool.name);
              const status: "allow" | "block" | "neutral" = isAllow
                ? "allow"
                : isBlock
                  ? "block"
                  : "neutral";
              return (
                <div
                  key={tool.name}
                  className={`rounded-lg border p-2 text-xs transition ${
                    isAllow
                      ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/20"
                      : isBlock
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <code className="font-mono font-medium truncate">
                          {tool.name}
                        </code>
                        <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                          {tool.method}
                        </span>
                        {tool.requireConfirmation && (
                          <span
                            className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="此工具預設需要確認"
                          >
                            需確認
                          </span>
                        )}
                        {tool.riskLevel && tool.riskLevel !== "low" && (
                          <span
                            className={`text-[10px] px-1 py-0.5 rounded ${
                              tool.riskLevel === "high"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                            }`}
                          >
                            {tool.riskLevel}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground truncate mt-0.5">
                        {tool.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setStatus(tool.name, "allow")}
                        title="加入白名單（自動同意）"
                        className={`h-6 w-6 rounded inline-flex items-center justify-center border ${
                          status === "allow"
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-border hover:border-emerald-400 text-muted-foreground hover:text-emerald-500"
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatus(tool.name, "block")}
                        title="加入黑名單（一律拒絕）"
                        className={`h-6 w-6 rounded inline-flex items-center justify-center border ${
                          status === "block"
                            ? "border-destructive bg-destructive text-white"
                            : "border-border hover:border-destructive text-muted-foreground hover:text-destructive"
                        }`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatus(tool.name, "neutral")}
                        title="重設（跟隨整體策略）"
                        className={`h-6 w-6 rounded inline-flex items-center justify-center border text-[10px] ${
                          status === "neutral"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/40 text-muted-foreground"
                        }`}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                找不到符合「{filter}」的工具
              </p>
            )}
          </div>
        </>
      )}

      {(customAllow.length > 0 || customBlock.length > 0) && (
        <div className="space-y-1.5 border-t pt-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            自訂工具名稱（站方 registry 沒有，直接用名稱比對）
          </p>
          {customAllow.length > 0 && (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
              ✓ {customAllow.join(", ")}
            </p>
          )}
          {customBlock.length > 0 && (
            <p className="text-[11px] text-destructive">
              ✕ {customBlock.join(", ")}
            </p>
          )}
        </div>
      )}

      <details className="text-xs" open={tools.length === 0}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          進階：直接編輯名單（CSV）
        </summary>
        <div className="space-y-3 mt-2">
          <div className="space-y-2">
            <span className="text-xs font-medium">白名單</span>
            <ToolQuickSelectChips
              csv={autoApproveCsv}
              setCsv={setAutoApproveCsv}
              variant="allow"
            />
            <textarea
              className="w-full rounded border p-2 text-[11px] font-mono"
              rows={2}
              value={autoApproveCsv}
              onChange={event => setAutoApproveCsv(event.target.value)}
              placeholder="例：studio.generateImage, gemini.tts, *"
            />
          </div>
          <div className="space-y-2">
            <span className="text-xs font-medium">黑名單</span>
            <ToolQuickSelectChips
              csv={blockedCsv}
              setCsv={setBlockedCsv}
              variant="block"
            />
            <textarea
              className="w-full rounded border p-2 text-[11px] font-mono"
              rows={2}
              value={blockedCsv}
              onChange={event => setBlockedCsv(event.target.value)}
              placeholder="例：deploy.preview, github.pr.create"
            />
          </div>
        </div>
      </details>
    </section>
  );
}

// ───────────── 三段選擇器（跟隨環境 / 強制啟用 / 強制關閉） ─────────────

interface TriStateOption {
  value: boolean | null;
  label: string;
  detail: string;
}

interface TriStateSectionProps {
  title: string;
  intro: string;
  options: TriStateOption[];
  selected: boolean | null;
  onChange: (value: boolean | null) => void;
}

function TriStateSection({
  title,
  intro,
  options,
  selected,
  onChange,
}: TriStateSectionProps) {
  const activeOption = options.find(opt => opt.value === selected) ?? options[0];
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {intro}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(option => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected === option.value}
            className={`rounded-xl border px-2 py-2 text-xs transition ${
              selected === option.value
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "border-border hover:border-primary/40"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">目前選擇：</span>
        {activeOption.label} — {activeOption.detail}
      </div>
    </section>
  );
}

// ───────────── Clear chat button ─────────────

function ClearChatButton() {
  const globalChat = useGlobalOrbChat();
  const messageCount = globalChat.messages.length;
  const handleClear = () => {
    if (
      messageCount > 0 &&
      !window.confirm(
        `確定清除這段對話？目前有 ${messageCount} 則訊息會被刪除。`
      )
    ) {
      return;
    }
    globalChat.resetConversation();
    toast.success("對話已清除，重新開始");
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">
        目前有 {messageCount} 則訊息
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClear}
        className="h-8 px-3 text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
      >
        <Eraser className="h-3.5 w-3.5" />
        清除對話
      </Button>
    </div>
  );
}
