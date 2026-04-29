import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_AGENT_PREFERENCES,
  type AgentConfirmationPolicy,
  type AgentVoiceName,
  type OrbWidgetCorner,
} from "@shared/agent-preferences";
import { APP_PAGE_REGISTRY } from "@shared/appRegistry";

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

const MODE_DESCRIPTIONS: Record<BehaviorMode, { title: string; description: string; tone: string }> = {
  pure_chat: {
    title: "純聊天模式",
    description: "光球只回覆文字、不執行任何動作。最安全。",
    tone: "🌿",
  },
  semi_auto: {
    title: "半自動（推薦）",
    description: "安全動作自動執行；submit / reset / 套用預設 / 跨頁工作流會先彈確認。",
    tone: "✨",
  },
  auto: {
    title: "自動模式",
    description: "信任光球，安全動作直接做。submit / reset / 多步驟仍強制確認。",
    tone: "🚀",
  },
};

const VOICE_OPTIONS: AgentVoiceName[] = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"];
const CORNER_OPTIONS: { id: OrbWidgetCorner; label: string }[] = [
  { id: "bottom-right", label: "右下" },
  { id: "bottom-left", label: "左下" },
  { id: "top-right", label: "右上" },
  { id: "top-left", label: "左上" },
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

export default function AgentPreferencesPage() {
  const meQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const isAuthenticated = Boolean(meQuery.data);
  const prefsQuery = trpc.agentPreferences.getPreferences.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const updateMutation = trpc.agentPreferences.updatePreferences.useMutation({
    onSuccess: () => {
      toast.success("已儲存代理人偏好設定");
      prefsQuery.refetch();
    },
    onError: error => toast.error(`儲存失敗：${error.message ?? "未知錯誤"}`),
  });

  const initial = prefsQuery.data ?? DEFAULT_AGENT_PREFERENCES;

  // ── Behavior ──
  const [mode, setMode] = useState<BehaviorMode>("semi_auto");
  const [confirmationPolicy, setConfirmationPolicy] = useState<AgentConfirmationPolicy>(
    DEFAULT_AGENT_PREFERENCES.confirmationPolicy
  );
  const [maxAutoStepsPerTask, setMaxAutoStepsPerTask] = useState<number>(5);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Notify ──
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true);
  const [notifyOnError, setNotifyOnError] = useState(true);

  // ── Voice ──
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [preferredVoiceName, setPreferredVoiceName] = useState<AgentVoiceName>("Puck");
  const [voiceAutoActivate, setVoiceAutoActivate] = useState(false);

  // ── Tools ──
  const [autoApproveCsv, setAutoApproveCsv] = useState("");
  const [blockedCsv, setBlockedCsv] = useState("");

  // ── Per-page permissions ──
  const [disabledPageAgents, setDisabledPageAgents] = useState<string[]>([]);

  // ── Assistant UI ──
  const [orbAgentEnabled, setOrbAgentEnabled] = useState<boolean | null>(null);
  const [workflowsEnabled, setWorkflowsEnabled] = useState<boolean | null>(null);
  const [orbWidgetCorner, setOrbWidgetCorner] = useState<OrbWidgetCorner>("bottom-right");
  const [orbWelcomeMessage, setOrbWelcomeMessage] = useState<string>("");
  const [orbShortcutEnabled, setOrbShortcutEnabled] = useState(true);
  const [orbProactiveSuggestions, setOrbProactiveSuggestions] = useState(true);

  useEffect(() => {
    if (!prefsQuery.data) return;
    const policy = (initial.confirmationPolicy ?? "confirm_high_risk") as AgentConfirmationPolicy;
    setConfirmationPolicy(policy);
    setMode(POLICY_TO_MODE[policy]);
    setMaxAutoStepsPerTask(initial.maxAutoStepsPerTask ?? 5);
    setNotifyOnCompletion(initial.notifyOnCompletion ?? true);
    setNotifyOnError(initial.notifyOnError ?? true);
    setVoiceEnabled(initial.voiceEnabled ?? false);
    setPreferredVoiceName((initial.preferredVoiceName ?? "Puck") as AgentVoiceName);
    setVoiceAutoActivate(initial.voiceAutoActivate ?? false);
    setAutoApproveCsv(arrayToCsv(initial.autoApproveTools));
    setBlockedCsv(arrayToCsv(initial.blockedTools));
    setDisabledPageAgents(Array.isArray(initial.disabledPageAgents) ? initial.disabledPageAgents : []);
    setOrbAgentEnabled(
      typeof initial.orbAgentEnabled === "boolean" ? initial.orbAgentEnabled : null
    );
    setWorkflowsEnabled(
      typeof initial.workflowsEnabled === "boolean" ? initial.workflowsEnabled : null
    );
    setOrbWidgetCorner((initial.orbWidgetCorner ?? "bottom-right") as OrbWidgetCorner);
    setOrbWelcomeMessage(initial.orbWelcomeMessage ?? "");
    setOrbShortcutEnabled(initial.orbShortcutEnabled ?? true);
    setOrbProactiveSuggestions(initial.orbProactiveSuggestions ?? true);
  }, [
    prefsQuery.data,
    initial.confirmationPolicy,
    initial.maxAutoStepsPerTask,
    initial.notifyOnCompletion,
    initial.notifyOnError,
    initial.voiceEnabled,
    initial.preferredVoiceName,
    initial.voiceAutoActivate,
    initial.autoApproveTools,
    initial.blockedTools,
    initial.disabledPageAgents,
    initial.orbAgentEnabled,
    initial.workflowsEnabled,
    initial.orbWidgetCorner,
    initial.orbWelcomeMessage,
    initial.orbShortcutEnabled,
    initial.orbProactiveSuggestions,
  ]);

  const policyForMode = useMemo<AgentConfirmationPolicy>(() => MODE_TO_POLICY[mode], [mode]);
  const policyToSave = showAdvanced ? confirmationPolicy : policyForMode;

  const togglePageDisabled = (pageId: string) => {
    setDisabledPageAgents(prev =>
      prev.includes(pageId) ? prev.filter(id => id !== pageId) : [...prev, pageId]
    );
  };

  const handleSave = () => {
    if (!isAuthenticated) {
      toast.error("請先登入後再調整代理人偏好");
      return;
    }
    updateMutation.mutate({
      confirmationPolicy: policyToSave,
      maxAutoStepsPerTask,
      notifyOnCompletion,
      notifyOnError,
      voiceEnabled,
      preferredVoiceName,
      voiceAutoActivate,
      autoApproveTools: csvToArray(autoApproveCsv),
      blockedTools: csvToArray(blockedCsv),
      disabledPageAgents,
      orbAgentEnabled,
      workflowsEnabled,
      orbWidgetCorner,
      orbWelcomeMessage: orbWelcomeMessage.trim().length > 0 ? orbWelcomeMessage.trim() : null,
      orbShortcutEnabled,
      orbProactiveSuggestions,
    });
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">光球代理人 + 助手 設定</h1>
        <p className="text-sm text-muted-foreground">
          一次調整全站光球代理（AI agent）與光球助手（chat assistant）的所有細節。模糊輸入時光球永遠會先反問再行動。
        </p>
      </header>

      <Tabs defaultValue="behavior" className="w-full" data-testid="agent-prefs-tabs">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="behavior" data-testid="tab-behavior">行為</TabsTrigger>
          <TabsTrigger value="notify" data-testid="tab-notify">通知</TabsTrigger>
          <TabsTrigger value="voice" data-testid="tab-voice">語音</TabsTrigger>
          <TabsTrigger value="tools" data-testid="tab-tools">工具白黑名單</TabsTrigger>
          <TabsTrigger value="pages" data-testid="tab-pages">頁面權限</TabsTrigger>
          <TabsTrigger value="ui" data-testid="tab-ui">助手 UI</TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-schedule">自動排程</TabsTrigger>
        </TabsList>

        {/* ───── 行為 ───── */}
        <TabsContent value="behavior" className="space-y-4 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="text-base font-semibold">行為模式</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(MODE_DESCRIPTIONS) as BehaviorMode[]).map(option => {
                const meta = MODE_DESCRIPTIONS[option];
                const active = mode === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setMode(option);
                      setConfirmationPolicy(MODE_TO_POLICY[option]);
                    }}
                    className={`flex h-full flex-col rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-primary bg-primary/5 ring-2 ring-primary/40"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="text-lg">{meta.tone}</div>
                    <div className="mt-1 text-sm font-semibold">{meta.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{meta.description}</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">進階：自訂確認策略</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(prev => !prev)}>
                {showAdvanced ? "關閉" : "展開"}
              </Button>
            </div>
            {showAdvanced ? (
              <fieldset className="space-y-2 text-sm">
                {(
                  [
                    ["always_approve", "永遠自動同意（除了寫死的破壞性動作）"],
                    ["confirm_high_risk", "只在高風險動作詢問"],
                    ["confirm_all", "每一步都詢問"],
                    ["manual", "全手動 — 光球只當聊天，不執行動作"],
                  ] as Array<[AgentConfirmationPolicy, string]>
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="confirmationPolicy"
                      checked={confirmationPolicy === value}
                      onChange={() => setConfirmationPolicy(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-xs text-muted-foreground">
                目前等效策略：<code className="rounded bg-muted px-1">{policyForMode}</code>
              </p>
            )}
            <label className="block text-sm">
              單次任務最多自動執行步驟數
              <Input
                className="ml-2 inline w-24"
                type="number"
                min={1}
                max={20}
                value={maxAutoStepsPerTask}
                onChange={event =>
                  setMaxAutoStepsPerTask(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                }
              />
            </label>
          </section>
        </TabsContent>

        {/* ───── 通知 ───── */}
        <TabsContent value="notify" className="space-y-3 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <label className="flex items-center justify-between text-sm">
              <span>任務完成時通知我</span>
              <Switch checked={notifyOnCompletion} onCheckedChange={setNotifyOnCompletion} />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>任務失敗時通知我</span>
              <Switch checked={notifyOnError} onCheckedChange={setNotifyOnError} />
            </label>
          </section>
        </TabsContent>

        {/* ───── 語音 ───── */}
        <TabsContent value="voice" className="space-y-3 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <label className="flex items-center justify-between text-sm">
              <span>啟用光球語音回覆</span>
              <Switch checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>進入頁面時自動啟動語音</span>
              <Switch
                checked={voiceAutoActivate}
                onCheckedChange={setVoiceAutoActivate}
                disabled={!voiceEnabled}
              />
            </label>
            <div>
              <p className="mb-2 text-sm font-medium">偏好語音</p>
              <div className="grid gap-2 sm:grid-cols-5">
                {VOICE_OPTIONS.map(voice => (
                  <button
                    key={voice}
                    type="button"
                    onClick={() => setPreferredVoiceName(voice)}
                    disabled={!voiceEnabled}
                    className={`rounded-2xl border p-2 text-sm transition ${
                      preferredVoiceName === voice
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    } disabled:opacity-50`}
                  >
                    {voice}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </TabsContent>

        {/* ───── 工具白黑名單 ───── */}
        <TabsContent value="tools" className="space-y-3 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              用逗號或換行分隔工具名稱。白名單裡的工具會跳過確認；黑名單裡的工具一律拒絕執行。輸入 <code>*</code> 代表全部工具。
            </p>
            <label className="block text-sm">
              <span className="font-medium">白名單（auto-approve）</span>
              <textarea
                className="mt-1 w-full rounded border p-2"
                rows={3}
                value={autoApproveCsv}
                onChange={event => setAutoApproveCsv(event.target.value)}
                placeholder="例：fal.imagine, gemini.tts"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium">黑名單（block）</span>
              <textarea
                className="mt-1 w-full rounded border p-2"
                rows={3}
                value={blockedCsv}
                onChange={event => setBlockedCsv(event.target.value)}
                placeholder="例：deploy.preview, github.pr.create"
              />
            </label>
          </section>
        </TabsContent>

        {/* ───── 頁面權限 ───── */}
        <TabsContent value="pages" className="space-y-3 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">
              關閉某頁的代理權限後，光球在那個頁面只會聊天，不會 dispatch 任何動作。共 {APP_PAGE_REGISTRY.length} 個頁面。
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {APP_PAGE_REGISTRY.filter(page => page.supportsPageAgent).map(page => {
                const disabled = disabledPageAgents.includes(page.id);
                return (
                  <label
                    key={page.id}
                    className="flex items-center justify-between gap-3 rounded-xl border p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{page.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{page.path}</div>
                    </div>
                    <Switch
                      checked={!disabled}
                      onCheckedChange={() => togglePageDisabled(page.id)}
                      aria-label={`${page.label} 代理開關`}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        </TabsContent>

        {/* ───── 助手 UI ───── */}
        <TabsContent value="ui" className="space-y-3 pt-4">
          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="text-base font-semibold">代理人總開關</h2>
            <p className="text-xs text-muted-foreground">
              不選 = 跟隨環境變數；明確選 開／關 後會覆寫整個帳號的設定。
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  [null, "跟隨環境設定"],
                  [true, "強制啟用"],
                  [false, "強制關閉（純聊天）"],
                ] as Array<[boolean | null, string]>
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setOrbAgentEnabled(value)}
                  className={`rounded-2xl border p-2 text-sm ${
                    orbAgentEnabled === value
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <h2 className="pt-2 text-base font-semibold">跨頁工作流</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  [null, "跟隨環境設定"],
                  [true, "啟用工作流"],
                  [false, "停用工作流"],
                ] as Array<[boolean | null, string]>
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setWorkflowsEnabled(value)}
                  className={`rounded-2xl border p-2 text-sm ${
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

          <section className="space-y-3 rounded-2xl border bg-card p-4">
            <h2 className="text-base font-semibold">浮動光球外觀</h2>
            <div>
              <p className="mb-1 text-sm">浮動光球位置</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {CORNER_OPTIONS.map(corner => (
                  <button
                    key={corner.id}
                    type="button"
                    onClick={() => setOrbWidgetCorner(corner.id)}
                    className={`rounded-2xl border p-2 text-sm ${
                      orbWidgetCorner === corner.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {corner.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="font-medium">自訂歡迎訊息（清空恢復預設）</span>
              <Input
                className="mt-1"
                maxLength={280}
                value={orbWelcomeMessage}
                onChange={event => setOrbWelcomeMessage(event.target.value)}
                placeholder="例：嗨，我是你的光球。今天想創作什麼？"
              />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>啟用 Cmd+K / Ctrl+K 喚起聊天</span>
              <Switch checked={orbShortcutEnabled} onCheckedChange={setOrbShortcutEnabled} />
            </label>

            <label className="flex items-center justify-between text-sm">
              <span>顯示主動建議（快速回覆按鈕）</span>
              <Switch
                checked={orbProactiveSuggestions}
                onCheckedChange={setOrbProactiveSuggestions}
              />
            </label>
          </section>
        </TabsContent>

        {/* ───── 自動排程 ───── */}
        <TabsContent value="schedule" className="space-y-3 pt-4">
          <ScheduleTab isAuthenticated={isAuthenticated} />
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-end gap-2">
        <Button onClick={handleSave} disabled={updateMutation.isPending || !isAuthenticated}>
          {updateMutation.isPending ? "儲存中..." : "儲存全部設定"}
        </Button>
      </div>

      {!isAuthenticated && (
        <p className="text-xs text-muted-foreground">
          請先登入帳號才能保存偏好。未登入時光球會用預設策略（半自動）。
        </p>
      )}
    </div>
  );
}

// ───────────── 自動排程子元件 ─────────────

function ScheduleTab({ isAuthenticated }: { isAuthenticated: boolean }) {
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

  const handleCreate = () => {
    if (!id.trim() || !cron.trim() || !taskDescription.trim()) {
      toast.error("ID、cron 與任務描述都要填");
      return;
    }
    scheduleMutation.mutate({ id: id.trim(), cronExpression: cron.trim(), taskDescription: taskDescription.trim(), enabled: true });
    setId("");
    setTaskDescription("");
  };

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold">已排程任務</h2>
        <p className="text-xs text-muted-foreground">
          光球會依 cron 自動執行任務（schema-first planner 規劃 → 工具執行）。任務描述支援繁中自然語言。
        </p>
      </div>

      <div className="space-y-2">
        {!isAuthenticated && (
          <p className="text-xs text-muted-foreground">登入後才能管理自動排程。</p>
        )}
        {isAuthenticated && jobsQuery.isLoading && (
          <p className="text-xs text-muted-foreground">載入中...</p>
        )}
        {isAuthenticated && jobsQuery.data && jobsQuery.data.length === 0 && (
          <p className="text-xs text-muted-foreground">目前沒有排程任務。</p>
        )}
        {jobsQuery.data?.map(job => (
          <div
            key={job.id}
            className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{job.id}</div>
              <div className="truncate text-xs text-muted-foreground">
                {job.cronExpression} · {job.taskDescription}
              </div>
              {job.lastRunAt && (
                <div className="text-[10px] text-muted-foreground">
                  上次執行：{new Date(job.lastRunAt).toLocaleString()}
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => unscheduleMutation.mutate({ jobId: job.id })}
              disabled={unscheduleMutation.isPending}
            >
              取消
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border-t pt-4">
        <h3 className="text-sm font-semibold">新增排程</h3>
        <Input
          placeholder="ID（例：daily-summary）"
          value={id}
          onChange={event => setId(event.target.value)}
        />
        <Input
          placeholder="Cron 表達式（例：0 9 * * * 每天早上九點）"
          value={cron}
          onChange={event => setCron(event.target.value)}
        />
        <Input
          placeholder="任務描述（例：幫我整理昨天的生成紀錄成短報告）"
          value={taskDescription}
          onChange={event => setTaskDescription(event.target.value)}
        />
        <Button onClick={handleCreate} disabled={!isAuthenticated || scheduleMutation.isPending}>
          {scheduleMutation.isPending ? "建立中..." : "建立排程"}
        </Button>
      </div>
    </section>
  );
}
