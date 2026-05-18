/**
 * OrbThinkingStepsPanel — slide-in sheet that surfaces the orb's
 * reasoning chain for a single past assistant message.
 *
 * Two complementary views, mirroring the screenshots the user referenced:
 *
 *   1. 思考步驟 — bold-titled "Identifying the Context / Clarifying the
 *      Limitations / Formulating the Response" cards (driven by
 *      `chain.sections`).
 *   2. 行動軌跡 — chronological pipeline timeline (sanitize → research →
 *      plan → call specialist → finalize), driven by `chain.actions`.
 *
 * The panel is purely presentational. The data already lives on the
 * ChatMessage, so opening / closing is free; we don't re-call the LLM.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Sparkles, Clock, AlertTriangle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type {
  OrbReasoningAction,
  OrbReasoningChain,
} from "../../../../shared/orb-reasoning";

const STAGE_EMOJI: Record<OrbReasoningAction["stage"], string> = {
  received: "🌟",
  sanitizing: "🧹",
  guarding_attachments: "📎",
  extracting_pdf: "📄",
  selecting_provider: "🧭",
  analyzing_terms: "🔎",
  researching_web: "🔍",
  planning: "🧠",
  calling_specialist: "🎨",
  materializing_task: "📋",
  executing_tool: "🛠️",
  finalizing: "✨",
  error: "⚠️",
};

const STAGE_LABEL_ZH: Record<OrbReasoningAction["stage"], string> = {
  received: "收到請求",
  sanitizing: "檢查訊息",
  guarding_attachments: "驗證附件",
  extracting_pdf: "讀取 PDF",
  selecting_provider: "選擇模型",
  analyzing_terms: "辨識專有名詞",
  researching_web: "查詢資料",
  planning: "規劃步驟",
  calling_specialist: "召喚精靈",
  materializing_task: "整理任務",
  executing_tool: "執行工具",
  finalizing: "整理回應",
  error: "錯誤",
};

export interface OrbThinkingStepsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chain: OrbReasoningChain | undefined;
  /** Wall-clock time of the assistant message — used for the panel header. */
  messageAt?: number;
}

type Tab = "thinking" | "actions";

function formatElapsedMs(dt: number): string {
  if (!Number.isFinite(dt) || dt <= 0) return "+0.0s";
  if (dt < 1000) return `+${Math.round(dt)}ms`;
  return `+${(dt / 1000).toFixed(1)}s`;
}

export default function OrbThinkingStepsPanel({
  open,
  onOpenChange,
  chain,
  messageAt,
}: OrbThinkingStepsPanelProps) {
  const initialTab: Tab = useMemo(() => {
    // L11:`chain?.sections.length` 等同 `(chain?.sections).length`,
    // 若 server 回 chain={} 缺 sections 就是 `.length of undefined` 直接
    // crash。所有 chain 子欄位都改 optional chain。
    if (chain?.sections?.length) return "thinking";
    if (chain?.actions?.length) return "actions";
    return "thinking";
  }, [chain]);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const sections = chain?.sections ?? [];
  const actions = chain?.actions ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0"
        data-testid="orb-thinking-steps-panel"
      >
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-border">
          <SheetTitle className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" aria-hidden />
            思考步驟
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {chain?.modelLabel ? <span>{chain.modelLabel}</span> : null}
            {chain?.modelLabel && typeof chain?.durationMs === "number" ? (
              <span className="px-1.5">·</span>
            ) : null}
            {typeof chain?.durationMs === "number" ? (
              <span>耗時 {(chain.durationMs / 1000).toFixed(1)}s</span>
            ) : null}
            {messageAt ? (
              <>
                <span className="px-1.5">·</span>
                <span>
                  {new Date(messageAt).toLocaleTimeString("zh-TW", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            ) : null}
          </SheetDescription>
          <div className="mt-3 inline-flex rounded-lg bg-muted p-0.5 self-start">
            <TabButton
              active={tab === "thinking"}
              onClick={() => setTab("thinking")}
              count={sections.length}
            >
              思考
            </TabButton>
            <TabButton
              active={tab === "actions"}
              onClick={() => setTab("actions")}
              count={actions.length}
            >
              行動
            </TabButton>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!chain || (sections.length === 0 && actions.length === 0) ? (
            <EmptyState />
          ) : tab === "thinking" ? (
            <ThinkingSections sections={sections} />
          ) : (
            <ActionsTimeline actions={actions} />
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border text-[11px] text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
          <span>
            完成
            {chain?.plannerStatus
              ? ` · ${chain.plannerStatus}`
              : ""}
          </span>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1 text-xs font-medium rounded-md transition-colors",
        active
          ? "bg-card text-foreground shadow-sm dark:text-white"
          : "text-muted-foreground hover:text-foreground dark:hover:text-white"
      )}
    >
      {children}
      {count > 0 ? (
        <span
          className={cn(
            "ml-1 rounded-full px-1.5 py-0.5 text-[10px]",
            active
              ? "bg-muted text-muted-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-12 gap-2">
      <AlertTriangle className="w-6 h-6 opacity-60" aria-hidden />
      <p className="text-sm">這一輪沒有產生額外的思考紀錄。</p>
      <p className="text-[11px]">
        簡短的招呼或快速確認回覆通常不會經過完整的規劃流程。
      </p>
    </div>
  );
}

function ThinkingSections({
  sections,
}: {
  sections: OrbReasoningChain["sections"];
}) {
  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        這次回覆沒有結構化的思考片段。切到「行動」分頁看執行軌跡。
      </p>
    );
  }
  return (
    <div className="relative pl-4">
      <span
        aria-hidden
        className="absolute left-0 top-1 bottom-1 w-px bg-muted"
      />
      <ol className="space-y-5">
        {sections.map((section, idx) => (
          <li key={`${idx}-${section.title}`} className="relative">
            <h3 className="text-[15px] font-semibold text-foreground leading-snug">
              {section.title}
            </h3>
            <p className="mt-1 text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
              {section.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ActionsTimeline({
  actions,
}: {
  actions: OrbReasoningChain["actions"];
}) {
  if (actions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        這一輪沒有觸發任何子流程。
      </p>
    );
  }
  const t0 = actions[0]?.at ?? 0;
  return (
    <ol className="space-y-3">
      {actions.map((event, idx) => {
        const dt = event.at - t0;
        const stageLabel = STAGE_LABEL_ZH[event.stage] ?? event.stage;
        return (
          <li
            key={`${event.stage}-${idx}-${event.at}`}
            className="flex items-start gap-3"
          >
            <span
              aria-hidden
              className="mt-0.5 inline-flex w-7 h-7 items-center justify-center rounded-full bg-muted text-base"
            >
              {STAGE_EMOJI[event.stage] ?? "·"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="font-medium uppercase tracking-wider text-[10px]">
                  {stageLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden />
                  {formatElapsedMs(dt)}
                </span>
              </div>
              <p className="text-sm text-foreground leading-snug truncate">
                {event.label}
              </p>
              {event.detail ? <ActionDetail detail={event.detail} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ActionDetail({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).filter(
    ([, v]) =>
      (typeof v === "string" && v.length > 0) ||
      typeof v === "number" ||
      typeof v === "boolean"
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.slice(0, 4).map(([k, v]) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          <span className="font-medium">{k}</span>
          <span>{String(v)}</span>
        </span>
      ))}
    </div>
  );
}
