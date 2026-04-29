import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { DEFAULT_AGENT_PREFERENCES, type AgentConfirmationPolicy } from "@shared/agent-preferences";

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
    description:
      "光球只回覆文字、不執行任何動作。適合不確定要不要交給代理人時的安全模式。",
    tone: "🌿",
  },
  semi_auto: {
    title: "半自動（推薦）",
    description:
      "安全動作（導航、聚焦）自動執行；破壞性動作（送出、套用預設、重設、跨頁工作流）會先彈確認卡。",
    tone: "✨",
  },
  auto: {
    title: "自動模式",
    description:
      "信任光球的計畫，安全動作直接做。但 submit / reset / 跨頁工作流仍強制需要你按確認，這是寫死的安全底線。",
    tone: "🚀",
  },
};

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

  const [mode, setMode] = useState<BehaviorMode>("semi_auto");
  const [confirmationPolicy, setConfirmationPolicy] = useState<AgentConfirmationPolicy>(
    DEFAULT_AGENT_PREFERENCES.confirmationPolicy
  );
  const [maxAutoStepsPerTask, setMaxAutoStepsPerTask] = useState<number>(
    DEFAULT_AGENT_PREFERENCES.maxAutoStepsPerTask
  );
  const [notifyOnCompletion, setNotifyOnCompletion] = useState<boolean>(
    DEFAULT_AGENT_PREFERENCES.notifyOnCompletion
  );
  const [notifyOnError, setNotifyOnError] = useState<boolean>(
    DEFAULT_AGENT_PREFERENCES.notifyOnError
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync UI when DB row arrives.
  useEffect(() => {
    const policy = (initial.confirmationPolicy ?? "confirm_high_risk") as AgentConfirmationPolicy;
    setConfirmationPolicy(policy);
    setMode(POLICY_TO_MODE[policy]);
    setMaxAutoStepsPerTask(initial.maxAutoStepsPerTask ?? 5);
    setNotifyOnCompletion(initial.notifyOnCompletion ?? true);
    setNotifyOnError(initial.notifyOnError ?? true);
  }, [
    initial.confirmationPolicy,
    initial.maxAutoStepsPerTask,
    initial.notifyOnCompletion,
    initial.notifyOnError,
  ]);

  const policyForMode = useMemo<AgentConfirmationPolicy>(
    () => MODE_TO_POLICY[mode],
    [mode]
  );

  const policyToSave = showAdvanced ? confirmationPolicy : policyForMode;

  const handleModeChange = (next: BehaviorMode) => {
    setMode(next);
    setConfirmationPolicy(MODE_TO_POLICY[next]);
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
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">光球代理人偏好</h1>
        <p className="text-sm text-muted-foreground">
          設定光球幫你執行動作時的確認策略。模糊或不確定的需求，光球永遠都會
          先反問再行動，不會跳過這一步。
        </p>
      </header>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <h2 className="text-base font-semibold">行為模式</h2>
        <p className="text-xs text-muted-foreground">
          一鍵切換最常見的三檔行為。需要更細的控制可展開「進階」覆寫單一原則。
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(MODE_DESCRIPTIONS) as BehaviorMode[]).map(option => {
            const meta = MODE_DESCRIPTIONS[option];
            const active = mode === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleModeChange(option)}
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
          <button
            type="button"
            onClick={() => setShowAdvanced(prev => !prev)}
            className="text-xs text-primary hover:underline"
          >
            {showAdvanced ? "關閉進階" : "展開進階"}
          </button>
        </div>
        {showAdvanced ? (
          <fieldset className="space-y-2 text-sm">
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              確認策略
            </legend>
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
          <input
            className="ml-2 w-20 rounded border px-2 py-1"
            type="number"
            min={1}
            max={20}
            value={maxAutoStepsPerTask}
            onChange={event =>
              setMaxAutoStepsPerTask(
                Math.max(1, Math.min(20, Number(event.target.value) || 1))
              )
            }
          />
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4">
        <h2 className="text-base font-semibold">通知</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyOnCompletion}
            onChange={event => setNotifyOnCompletion(event.target.checked)}
          />
          任務完成時通知我
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyOnError}
            onChange={event => setNotifyOnError(event.target.checked)}
          />
          任務失敗時通知我
        </label>
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={updateMutation.isPending || !isAuthenticated}
          className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {updateMutation.isPending ? "儲存中..." : "儲存設定"}
        </button>
      </div>

      {!isAuthenticated && (
        <p className="text-xs text-muted-foreground">
          請先登入帳號才能保存偏好。未登入時光球會用預設策略（半自動）。
        </p>
      )}
    </div>
  );
}
