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
import { Trash2, CalendarPlus, Save } from "lucide-react";
import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentConfirmationPolicy,
} from "@shared/agent-preferences";

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
 */
const CRON_PRESETS: Array<{ id: string; label: string; cron: string }> = [
  { id: "every-morning", label: "每天早上 09:00", cron: "0 9 * * *" },
  { id: "every-noon", label: "每天中午 12:00", cron: "0 12 * * *" },
  { id: "every-evening", label: "每天晚上 21:00", cron: "0 21 * * *" },
  { id: "weekday-morning", label: "工作日早上 09:00", cron: "0 9 * * 1-5" },
  { id: "weekly-monday", label: "每週一 09:00", cron: "0 9 * * 1" },
  { id: "every-hour", label: "每小時整點", cron: "0 * * * *" },
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
    });
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
              </TabsContent>

              {/* ── 自動排程 ──────────────────────────────────────── */}
              <TabsContent value="schedule" className="space-y-3 pt-4">
                <ScheduleSection isAuthenticated={isAuthenticated} />
              </TabsContent>

              {/* ── 工具許可 ──────────────────────────────────────── */}
              <TabsContent value="tools" className="space-y-3 pt-4">
                <section className="space-y-3 rounded-2xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    用逗號或換行分隔工具名稱。白名單裡的工具會直接執行不問你；黑名單裡的工具一律拒絕。輸入{" "}
                    <code className="rounded bg-muted px-1">*</code>{" "}
                    代表所有工具。
                  </p>
                  <label className="block text-sm">
                    <span className="font-medium">白名單（自動同意）</span>
                    <textarea
                      className="mt-1 w-full rounded border p-2 text-xs font-mono"
                      rows={3}
                      value={autoApproveCsv}
                      onChange={event => setAutoApproveCsv(event.target.value)}
                      placeholder="例：fal.imagine, gemini.tts"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium">黑名單（永遠拒絕）</span>
                    <textarea
                      className="mt-1 w-full rounded border p-2 text-xs font-mono"
                      rows={3}
                      value={blockedCsv}
                      onChange={event => setBlockedCsv(event.target.value)}
                      placeholder="例：deploy.preview, github.pr.create"
                    />
                  </label>
                </section>
              </TabsContent>

              {/* ── 全站開關 ──────────────────────────────────────── */}
              <TabsContent value="global" className="space-y-3 pt-4">
                <section className="space-y-3 rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">代理人總開關</h3>
                  <p className="text-xs text-muted-foreground">
                    跟隨環境設定 = 讓站方決定；強制啟用 / 關閉 會覆寫整個帳號的設定。
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        [null, "跟隨環境"],
                        [true, "強制啟用"],
                        [false, "強制關閉"],
                      ] as Array<[boolean | null, string]>
                    ).map(([value, label]) => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setOrbAgentEnabled(value)}
                        className={`rounded-xl border px-2 py-2 text-xs transition ${
                          orbAgentEnabled === value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-3 rounded-2xl border bg-card p-4">
                  <h3 className="text-sm font-semibold">跨頁工作流</h3>
                  <p className="text-xs text-muted-foreground">
                    多步驟、跨頁面的任務（例如「先生圖、再剪片、再上字幕」）。
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        [null, "跟隨環境"],
                        [true, "啟用工作流"],
                        [false, "停用工作流"],
                      ] as Array<[boolean | null, string]>
                    ).map(([value, label]) => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setWorkflowsEnabled(value)}
                        className={`rounded-xl border px-2 py-2 text-xs transition ${
                          workflowsEnabled === value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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

  const [id, setId] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [taskDescription, setTaskDescription] = useState("");

  const matchedPreset = useMemo(
    () => CRON_PRESETS.find(preset => preset.cron === cron.trim())?.id ?? null,
    [cron]
  );

  const handleCreate = () => {
    if (!isAuthenticated) {
      toast.error("請先登入再建立排程");
      return;
    }
    const trimmedId = id.trim();
    const trimmedCron = cron.trim();
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
            className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{job.id}</div>
              <div className="truncate text-xs text-muted-foreground">
                <code className="rounded bg-muted px-1 mr-1">
                  {job.cronExpression}
                </code>
                {job.taskDescription}
              </div>
              {job.lastRunAt && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  上次執行：{new Date(job.lastRunAt).toLocaleString("zh-TW")}
                </div>
              )}
              {job.lastError && (
                <div className="text-[10px] text-destructive mt-0.5 truncate">
                  上次錯誤：{job.lastError}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => unscheduleMutation.mutate({ jobId: job.id })}
              disabled={unscheduleMutation.isPending}
              aria-label={`取消排程 ${job.id}`}
              title="取消排程"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
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
          <span className="text-xs font-medium">執行時間</span>
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
          <p className="text-[10px] text-muted-foreground">
            cron 格式：分(0-59) 時(0-23) 日(1-31) 月(1-12) 週(0-6, 週日為 0)。
          </p>
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
