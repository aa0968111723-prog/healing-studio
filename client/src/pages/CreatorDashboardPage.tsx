/**
 * CreatorDashboardPage.tsx — AIDV-277 Creator 可見性儀表板（收斂 AIDV-272/273）
 *
 * /creator/dashboard：
 *   - QuotaWidget           ← 當月用量配額計量表 + 已花費 + 80% 超限預警（AIDV-273）
 *   - VideoPerformanceTable ← 每部影片觀看數 + 完播率（複用既有 videoAnalytics，AIDV-272）
 *
 * 旗標 FEATURE_CREATOR_DASHBOARD OFF → 渲染「未啟用」佔位（零行為改變、可秒回滾）。
 * 全部唯讀（trpc query）；不觸發任何生成或扣款。
 */

import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { FEATURE_CREATOR_DASHBOARD } from "@/config/featureFlags";
import { BarChart3, AlertTriangle, Gauge, Video, TrendingUp } from "lucide-react";

// ─── QuotaWidget（AIDV-273）────────────────────────────────────────────────────

function QuotaWidget() {
  const { data, isLoading, isError } = trpc.creatorDashboard.quotaStatus.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-4 text-sm text-muted-foreground">
        暫時無法載入配額資料，請稍後再試。
      </div>
    );
  }

  const cm = data.currentMonth;
  const limitLabel = cm.isUnlimited ? "∞" : String(cm.quotaLimit ?? 0);
  const remainingLabel = cm.isUnlimited ? "∞" : String(cm.remaining ?? 0);
  const resetsDate = new Date(data.quotaResetsAt).toLocaleDateString();
  const barPct = cm.isUnlimited ? 0 : cm.quotaUsedPct;
  const barColor = data.alertActive ? "bg-amber-500" : "bg-emerald-500";

  return (
    <section
      aria-label="用量配額"
      className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="w-4 h-4" />
        本月用量配額
        <span className="ml-auto text-xs text-muted-foreground uppercase tracking-wide">
          {data.plan}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{cm.videosGenerated}</span>
        <span className="text-sm text-muted-foreground">/ {limitLabel} 部影片</span>
        {!cm.isUnlimited && (
          <span className="ml-auto text-sm text-muted-foreground">{cm.quotaUsedPct}%</span>
        )}
      </div>

      {!cm.isUnlimited && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            role="progressbar"
            aria-valuenow={cm.quotaUsedPct}
            aria-valuemin={0}
            aria-valuemax={100}
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${barPct}%` }}
          />
        </div>
      )}

      {data.alertActive && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            已使用 {cm.quotaUsedPct}%，達到 {data.alertThresholdPct}% 預警門檻
            {cm.quotaExceeded ? "（本月配額已用盡）" : ""}。
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>剩餘：{remainingLabel} 部</div>
        <div>已花費：${cm.costUsdSoFar.toFixed(2)}</div>
        <div>用完估算：${cm.costEstimateRemaining.toFixed(2)}</div>
        <div>重置：{resetsDate}</div>
      </div>
    </section>
  );
}

// ─── VideoPerformanceTable（AIDV-272）──────────────────────────────────────────

interface VideoRow {
  id: number;
  title: string;
}

function VideoPerfRow({ video }: { video: VideoRow }) {
  const { data, isLoading } = trpc.videoAnalytics.getSummary.useQuery(
    { videoProjectId: video.id, days: 30 },
    { staleTime: 60_000 }
  );

  return (
    <tr className="border-b border-border/30 last:border-0">
      <td className="py-2 pr-3 font-medium truncate max-w-[16rem]">{video.title}</td>
      <td className="py-2 px-3 text-right tabular-nums">
        {isLoading ? "…" : (data?.totalPlays ?? 0)}
      </td>
      <td className="py-2 px-3 text-right tabular-nums">
        {isLoading ? "…" : `${Math.round((data?.completionRate ?? 0) * 100)}%`}
      </td>
      <td className="py-2 pl-3 text-right tabular-nums">
        {isLoading ? "…" : `${data?.avgCompletionDurationSeconds ?? 0}s`}
      </td>
    </tr>
  );
}

function VideoPerformanceTable() {
  const { data, isLoading, isError } = trpc.videoProject.list.useQuery(
    { limit: 20 },
    { staleTime: 60_000 }
  );

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-border/40 bg-card/40 p-4 text-sm text-muted-foreground">
        暫時無法載入影片列表。
      </div>
    );
  }

  const videos = data?.items ?? [];

  return (
    <section
      aria-label="影片表現"
      className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <TrendingUp className="w-4 h-4" />
        影片表現（近 30 天）
      </div>

      {videos.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Video className="h-4 w-4" />
          還沒有影片專案，先去建立第一部影片吧。
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground text-left">
              <th className="py-1 pr-3 font-normal">影片</th>
              <th className="py-1 px-3 font-normal text-right">觀看數</th>
              <th className="py-1 px-3 font-normal text-right">完播率</th>
              <th className="py-1 pl-3 font-normal text-right">平均觀看</th>
            </tr>
          </thead>
          <tbody>
            {videos.map(v => (
              <VideoPerfRow key={v.id} video={{ id: v.id, title: v.title }} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function CreatorDashboardPage() {
  if (!FEATURE_CREATOR_DASHBOARD) {
    return (
      <div className="mx-auto max-w-3xl p-4 space-y-4">
        <PageHeader
          icon={<BarChart3 className="w-5 h-5" />}
          title="創作者儀表板"
          subtitle="用量配額與影片表現"
        />
        <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-sm text-muted-foreground">
          此功能尚未啟用。
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <PageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        title="創作者儀表板"
        subtitle="用量配額與影片表現，一頁看懂本月狀況"
      />
      <QuotaWidget />
      <VideoPerformanceTable />
    </div>
  );
}
