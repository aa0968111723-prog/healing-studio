/**
 * RefundDetailLink — AIDV-969 任務結果 →「點數紀錄」小連結（承 AIDV-650 驗收 3）
 *
 * 掛在 RefundStatusBadge 旁的純加性小連結，導向積分帳戶頁
 * /dashboard?section=credits（App.tsx 實存路由；由測試對照源碼釘住）。
 *
 * 顯示條件與徽章完全一致：只有 full / partial / not_refunded 才渲染；
 * none / unknown / 無資料（loading・error）一律不渲染 —— 不破壞既有
 * 安靜降級行為，絕不影響任務卡本身。
 */

import { Link } from "wouter";
import {
  describeRefundLedgerLink,
  type JobRefundInfo,
} from "./refundStatus";

export function RefundDetailLink({
  info,
  className = "",
}: {
  info?: JobRefundInfo | null;
  className?: string;
}) {
  const spec = describeRefundLedgerLink(info);
  if (!spec) return null;
  return (
    <Link
      href={spec.href}
      title={spec.title}
      aria-label={spec.title}
      className={`text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground whitespace-nowrap ${className}`}
    >
      {spec.label} →
    </Link>
  );
}
