/**
 * IntentComposer — M1-B createIntent Skeleton（/create 區塊）
 * ────────────────────────────────────────────────────────────────────────────
 * 使用者輸入一句創作意圖 + 選擇 mode → 呼叫 `commander.createIntent`，只建立一筆
 * pending orchestration run（不呼叫任何昂貴模型 / Perplexity / SubQ / MCP）。
 * 建立後顯示 run created / pending 狀態，並在有 active project 時列出最近意圖。
 *
 * 未選 active project 時仍可送出（run 不綁定專案），但提示「不會綁定專案」。
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Loader2, ListChecks } from "lucide-react";
import {
  ORCHESTRATION_MODE_OPTIONS,
  modeLabel,
  runStatusLabel,
  costPreviewLabel,
  type OrchestrationMode,
} from "./commanderFormat";

type RunView = {
  id: number;
  mode: string;
  intent: string;
  status: string;
  estimatedCostUsd: number | null;
  hasProjectContext: boolean;
  createdAt: string;
};

export function IntentComposer() {
  const { activeProjectId } = useActiveProject();
  const utils = trpc.useUtils();

  const [intent, setIntent] = useState("");
  const [mode, setMode] = useState<OrchestrationMode>("create");
  const [lastRun, setLastRun] = useState<RunView | null>(null);

  const runsQuery = trpc.commander.listRunsByProject.useQuery(
    { projectId: activeProjectId ?? 0, limit: 5 },
    { enabled: activeProjectId !== null, staleTime: 5_000, retry: false },
  );

  const createIntentMutation = trpc.commander.createIntent.useMutation({
    onSuccess: run => {
      toast.success("已記錄創作意圖");
      setIntent("");
      setLastRun(run as RunView);
      if (activeProjectId !== null) {
        utils.commander.listRunsByProject.invalidate();
      }
    },
    onError: err => toast.error(err.message || "記錄意圖失敗"),
  });

  const submit = () => {
    const trimmed = intent.trim();
    if (!trimmed || createIntentMutation.isPending) return;
    createIntentMutation.mutate({
      projectId: activeProjectId,
      mode,
      intent: trimmed,
    });
  };

  const runs: RunView[] =
    activeProjectId !== null
      ? ((runsQuery.data as RunView[] | undefined) ?? [])
      : lastRun
        ? [lastRun]
        : [];

  return (
    <section
      data-testid="intent-composer"
      className="rounded-2xl border border-border bg-card p-6 shadow-sm"
    >
      <div className="mb-3">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          創作意圖
        </p>
        <h2 className="text-lg font-semibold leading-tight">想做什麼？</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          先用一句話描述創作意圖。這一步只會記錄你的想法，不會立即生成或產生費用。
        </p>
      </div>

      <Textarea
        value={intent}
        onChange={e => setIntent(e.target.value)}
        placeholder="例：幫我規劃一支關於放下與呼吸的三分鐘療癒短片"
        rows={3}
        data-testid="intent-input"
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
        }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={mode} onValueChange={v => setMode(v as OrchestrationMode)}>
          <SelectTrigger
            className="h-9 w-[150px] text-xs"
            aria-label="選擇創作模式"
            data-testid="intent-mode-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORCHESTRATION_MODE_OPTIONS.map(m => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={submit}
          disabled={!intent.trim() || createIntentMutation.isPending}
          data-testid="intent-submit"
        >
          {createIntentMutation.isPending ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Send className="mr-1 size-4" />
          )}
          記錄意圖
        </Button>

        <span className="text-[11px] text-muted-foreground">
          {activeProjectId !== null
            ? "將綁定目前專案"
            : "未選專案，此意圖不會綁定專案"}
        </span>
      </div>

      {runs.length > 0 ? (
        <div className="mt-5" data-testid="intent-runs">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <ListChecks className="size-3" /> 最近意圖
          </p>
          <ul className="space-y-2">
            {runs.map(run => (
              <li
                key={run.id}
                className="rounded-lg border border-border/70 bg-background/60 p-3"
                data-testid={`intent-run-${run.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm" title={run.intent}>
                    {run.intent}
                  </p>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {modeLabel(run.mode)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span data-testid={`intent-run-status-${run.id}`}>
                    狀態：{runStatusLabel(run.status)}
                  </span>
                  <span>{costPreviewLabel(run.estimatedCostUsd)}</span>
                  {!run.hasProjectContext ? (
                    <span className="italic">無專案綁定</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default IntentComposer;
