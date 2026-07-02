/**
 * RefundStatusBadge — AIDV-650 失敗任務卡的退款狀態徽章
 *
 * - useJobRefundStatuses：批次一次查詢（credits.jobRefundStatus，可與其他
 *   credits.* 便宜查詢共 batch），回 jobId → 條目的 map。
 * - RefundStatusBadge：條目 → 徽章；無資料（loading / error / none / unknown）
 *   一律不渲染，安靜降級，絕不影響任務卡本身。
 */

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  describeRefundBadge,
  type JobRefundInfo,
} from "./refundStatus";

export type { JobRefundInfo } from "./refundStatus";

/** 全域語意色 token（--ok / --warn，深淺色雙主題皆已定義於 index.css）。 */
const TONE_CLASS: Record<"ok" | "warn", string> = {
  ok: "text-[var(--ok)] border-[rgba(92,138,85,.3)] bg-[var(--ok-tint)]",
  warn: "text-[var(--warn)] border-[rgba(200,146,47,.3)] bg-[var(--warn-tint)]",
};

/**
 * 批次查詢多個任務的退款狀態。jobIds 為空時不發查詢；查詢失敗或載入中
 * 回空 map（呼叫端據此不顯示徽章）。呼叫端請 useMemo 穩定 jobIds。
 */
export function useJobRefundStatuses(
  jobIds: number[]
): Record<number, JobRefundInfo> {
  const query = trpc.credits.jobRefundStatus.useQuery(
    { jobIds },
    {
      enabled: jobIds.length > 0,
      staleTime: 30_000,
      retry: 1,
    }
  );
  return useMemo(() => {
    const map: Record<number, JobRefundInfo> = {};
    for (const entry of query.data ?? []) {
      map[entry.taskId] = entry;
    }
    return map;
  }, [query.data]);
}

export function RefundStatusBadge({
  info,
  className = "",
}: {
  info?: JobRefundInfo | null;
  className?: string;
}) {
  const spec = describeRefundBadge(info);
  if (!spec) return null;
  return (
    <Badge
      variant="outline"
      title={spec.title}
      aria-label={spec.title}
      className={`h-4 px-1.5 text-[10px] font-medium whitespace-nowrap ${TONE_CLASS[spec.tone]} ${className}`}
    >
      {spec.label}
    </Badge>
  );
}
