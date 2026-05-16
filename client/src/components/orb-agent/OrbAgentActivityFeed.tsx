/**
 * OrbAgentActivityFeed.tsx — Recent agent action feed for the
 * settings page 概覽 tab.
 *
 * Goal: turn the abstract preference panel into something concrete by
 * showing what the orb actually did recently — action type, page,
 * outcome, when. Pulls from `agentPreferences.getRecentActivity` which
 * returns the same OrbFeedback events the planner aggregates for
 * preference distillation. This is the "audit log" half of trust.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CircleSlash,
  Clock,
  Edit3,
  RefreshCw,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

type FeedbackStatus =
  | "accepted"
  | "edited"
  | "cancelled"
  | "completed"
  | "failed"
  | string;

interface ActivityEvent {
  id: number;
  at: number;
  status: FeedbackStatus;
  actionType: string;
  note: string | null;
  pageId: string | null;
}

interface StatusMeta {
  label: string;
  icon: LucideIcon;
  tone: string;
  textTone: string;
}

const STATUS_META: Record<FeedbackStatus, StatusMeta> = {
  accepted: {
    label: "你接受",
    icon: Check,
    tone: "bg-emerald-100 border-emerald-200",
    textTone: "text-emerald-700",
  },
  edited: {
    label: "你改寫後送",
    icon: Edit3,
    tone: "bg-cyan-100 border-cyan-200",
    textTone: "text-cyan-700",
  },
  completed: {
    label: "完成",
    icon: Sparkles,
    tone: "bg-violet-100 border-violet-200",
    textTone: "text-violet-700",
  },
  cancelled: {
    label: "你取消",
    icon: CircleSlash,
    tone: "bg-amber-100 border-amber-200",
    textTone: "text-amber-700",
  },
  failed: {
    label: "失敗",
    icon: X,
    tone: "bg-rose-100 border-rose-200",
    textTone: "text-rose-700",
  },
};

const FALLBACK_META: StatusMeta = {
  label: "未知",
  icon: Clock,
  tone: "bg-muted border-border",
  textTone: "text-foreground/90",
};

const ACTION_TYPE_LABEL: Record<string, string> = {
  fillPrompt: "填提示詞",
  setModel: "切模型",
  setTab: "切分頁",
  setMode: "切模式",
  setModality: "切模態",
  setParam: "改參數",
  applyPreset: "套預設",
  submit: "送出生成",
  reset: "重置表單",
  navigate: "頁面跳轉",
  focusElement: "指出元素",
  openDialog: "打開對話框",
  search: "頁內搜尋",
  toggleSetting: "切換設定",
  runWorkflow: "跨頁工作流",
  exportChatPdf: "匯出 PDF",
  shareViaLink: "分享連結",
};

function formatRelative(ms: number, now: number = Date.now()): string {
  const ageSec = Math.max(0, Math.floor((now - ms) / 1000));
  if (ageSec < 60) return "剛剛";
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)} 分鐘前`;
  if (ageSec < 86_400) return `${Math.floor(ageSec / 3600)} 小時前`;
  if (ageSec < 7 * 86_400) return `${Math.floor(ageSec / 86_400)} 天前`;
  return new Date(ms).toLocaleDateString("zh-TW");
}

interface Props {
  /** Override fetch limit. Default 12. */
  limit?: number;
}

export default function OrbAgentActivityFeed({ limit = 12 }: Props) {
  const query = trpc.agentPreferences.getRecentActivity.useQuery(
    { limit },
    { refetchOnWindowFocus: false, staleTime: 15_000 }
  );

  const events = useMemo<ActivityEvent[]>(
    () => query.data?.events ?? [],
    [query.data]
  );

  if (query.isLoading) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card/60 p-3" data-testid="orb-agent-activity-feed">
        <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          整理光球最近做了什麼…
        </div>
      </div>
    );
  }

  if (!events.length) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border bg-muted/60 p-3 text-center"
        data-testid="orb-agent-activity-feed-empty"
      >
        <Clock className="w-4 h-4 text-muted-foreground/60 inline-block mr-1.5 -mt-0.5" />
        <span className="text-[12px] text-muted-foreground">
          還沒有活動紀錄。光球幫你做動作後（接受／取消／完成）會自動出現在這裡。
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-200/40 bg-card/80 p-3" data-testid="orb-agent-activity-feed">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-cyan-500" />
          <span className="text-[12px] font-semibold text-foreground/90">
            光球最近做了什麼
          </span>
          <span className="text-[10px] text-muted-foreground/70">· {events.length} 條</span>
        </div>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="text-[10px] text-muted-foreground/70 hover:text-foreground/90 inline-flex items-center gap-1"
          data-testid="orb-agent-activity-refresh"
        >
          <RefreshCw className={`w-2.5 h-2.5 ${query.isRefetching ? "animate-spin" : ""}`} />
          重新整理
        </button>
      </div>

      <ol className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
        {events.map((evt, idx) => {
          const meta = STATUS_META[evt.status] ?? FALLBACK_META;
          const Icon = meta.icon;
          const actionLabel = ACTION_TYPE_LABEL[evt.actionType] ?? evt.actionType;
          return (
            <motion.li
              key={evt.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.02 * idx, duration: 0.18 }}
              data-testid="orb-agent-activity-row"
              className={`flex items-start gap-2 rounded-xl border ${meta.tone} px-2 py-1.5`}
            >
              <span
                className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-md bg-card/80 ${meta.textTone}`}
              >
                <Icon className="w-3 h-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`text-[11px] font-medium ${meta.textTone}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-foreground/90">{actionLabel}</span>
                  {evt.pageId ? (
                    <span className="text-[10px] text-muted-foreground/70">@{evt.pageId}</span>
                  ) : null}
                </div>
                {evt.note ? (
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{evt.note}</div>
                ) : null}
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground/70 mt-0.5">
                {formatRelative(evt.at)}
              </span>
            </motion.li>
          );
        })}
      </ol>

      <p className="mt-2 text-[10px] text-muted-foreground/70 leading-snug">
        每次光球動作（接受／取消／完成／失敗）會即時記錄，作為下一輪偏好學習的依據。
      </p>
    </div>
  );
}
