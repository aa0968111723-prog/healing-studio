/**
 * AgentOpsPanel.tsx — W3-D 代理操作面板（唯讀版 AIDV-49）
 *
 * 顯示目前使用者的 orchestration_runs 列表，點選展開 planJson 詳情。
 * Phase 1 = 純唯讀觀測；步驟確認（approval）留 Wave 4。
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronRight, Loader2, Bot, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type RunStatus =
  | "pending"
  | "planned"
  | "waiting_confirmation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const STATUS_META: Record<RunStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:              { label: "等待中",   color: "text-muted-foreground bg-muted",              icon: Clock },
  planned:              { label: "已規劃",   color: "text-blue-700 bg-blue-100",                   icon: Bot },
  waiting_confirmation: { label: "等確認",   color: "text-amber-700 bg-amber-100",                 icon: Clock },
  running:              { label: "執行中",   color: "text-violet-700 bg-violet-100",               icon: Loader2 },
  completed:            { label: "完成",     color: "text-emerald-700 bg-emerald-100",             icon: CheckCircle2 },
  failed:               { label: "失敗",     color: "text-rose-700 bg-rose-100",                   icon: AlertCircle },
  cancelled:            { label: "取消",     color: "text-slate-600 bg-slate-100",                 icon: AlertCircle },
};

const MODE_LABELS: Record<string, string> = {
  create: "創作",
  director: "導演",
  video: "影片",
  assets: "素材",
  database: "資料",
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as RunStatus] ?? { label: status, color: "text-muted-foreground bg-muted", icon: Clock };
  const Icon = meta.icon as React.ElementType<{ className?: string }>;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", meta.color)}>
      <Icon className={cn("w-2.5 h-2.5", status === "running" && "animate-spin")} />
      {meta.label}
    </span>
  );
}

function RunRow({ run }: { run: ReturnType<typeof useRunsData>["runs"][number] }) {
  const [open, setOpen] = useState(false);
  const plan = run.planJson as Record<string, unknown> | null;

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={run.status} />
            <span className="text-[10px] text-muted-foreground/70 rounded bg-muted px-1.5 py-0.5 font-mono">
              {MODE_LABELS[run.mode] ?? run.mode}
            </span>
            {run.commander && (
              <span className="text-[10px] text-muted-foreground/60">{run.commander}</span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-foreground/80 truncate">{run.intent}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">
            {new Date(run.createdAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/40 bg-muted/30 px-3 py-2.5 space-y-2">
          {run.errorMessage && (
            <div className="rounded bg-rose-50 border border-rose-200 px-2 py-1.5 text-[11px] text-rose-700">
              {run.errorMessage}
            </div>
          )}
          {plan ? (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">執行計畫</p>
              <pre className="text-[10px] text-foreground/70 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto rounded bg-background/60 p-2 border border-border/40">
                {JSON.stringify(plan, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">尚無計畫詳情</p>
          )}
          {(run.estimatedCostUsd || run.actualCostUsd) && (
            <div className="flex gap-3 text-[11px] text-muted-foreground/70">
              {run.estimatedCostUsd && <span>預估 ${parseFloat(String(run.estimatedCostUsd)).toFixed(4)}</span>}
              {run.actualCostUsd && <span>實際 ${parseFloat(String(run.actualCostUsd)).toFixed(4)}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function useRunsData() {
  const q = trpc.orchestrationRuns.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  return { runs: q.data?.runs ?? [], isLoading: q.isLoading, isError: q.isError };
}

export function AgentOpsPanelBody() {
  const { runs, isLoading, isError } = useRunsData();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[12px] text-muted-foreground/70 justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        載入代理執行記錄…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 py-8 text-[12px] text-rose-600 justify-center">
        <AlertCircle className="w-3.5 h-3.5" />
        載入失敗，請重試
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="py-8 text-center">
        <Bot className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-[12px] text-muted-foreground/70">尚無代理執行記錄</p>
        <p className="text-[11px] text-muted-foreground/50 mt-0.5">和光球對話後，代理執行記錄會顯示在這裡</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 pt-2">
      <p className="text-[10px] text-muted-foreground/60 mb-2">{runs.length} 筆最近執行記錄（唯讀）</p>
      {runs.map(run => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}
