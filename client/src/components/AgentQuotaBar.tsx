/**
 * AgentQuotaBar — AIDV-639
 *
 * 顯示目前使用者本小時代理呼叫額度（used / max）。
 * 使用 trpc.videoProject.agentQuota 端點；每分鐘自動重整。
 * used=0 時不渲染（未用過額度不打擾使用者）。
 * 達到 80% 以上顯示橙色警告。
 */

import { trpc } from "@/lib/trpc";

export function AgentQuotaBar() {
  const { data } = trpc.videoProject.agentQuota.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!data || data.used === 0) return null;

  const pct = Math.min(100, Math.round((data.used / data.max) * 100));
  const nearLimit = pct >= 80;

  const resetMins =
    data.resetAt != null
      ? Math.max(1, Math.ceil((data.resetAt - Date.now()) / 60_000))
      : null;

  return (
    <div className="w-full px-4 pt-2 pb-1">
      <div className="flex items-center justify-between mb-1 text-xs text-muted-foreground">
        <span className={nearLimit ? "text-orange-500 font-medium" : undefined}>
          本小時代理呼叫：{data.used} / {data.max}
          {nearLimit && " — 接近上限"}
        </span>
        {resetMins != null && (
          <span className="tabular-nums">{resetMins} 分鐘後重置</span>
        )}
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20"
        role="progressbar"
        aria-valuenow={data.used}
        aria-valuemin={0}
        aria-valuemax={data.max}
        aria-label={`代理呼叫額度 ${data.used}/${data.max}`}
      >
        <div
          className={`h-full rounded-full transition-all ${nearLimit ? "bg-orange-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
