/**
 * refundStatus.ts — AIDV-650 退款狀態徽章的純顯示邏輯（可獨立測試，無 React）
 *
 * 對應後端 credits.jobRefundStatus 的回傳條目。徽章只在有明確事實時顯示：
 *   - full         → 「已退回 N 點」（成功色）
 *   - partial      → 「部分退點 m/n」（警示色）
 *   - not_refunded → 「未退點」（警示色；補充說明放 title）
 *   - none/unknown → 不顯示（無扣點紀錄／查不到／出錯，安靜降級）
 */

export type RefundStatus =
  | "none"
  | "not_refunded"
  | "partial"
  | "full"
  | "unknown";

export interface JobRefundInfo {
  taskId: number;
  chargedPoints: number;
  refundedPoints: number;
  refundStatus: RefundStatus;
}

export interface RefundBadgeSpec {
  /** 徽章文字（zh-TW，簡短） */
  label: string;
  /** 完整語意說明（title / aria-label 用） */
  title: string;
  /** 色調：ok=成功綠、warn=警示琥珀（對齊全域 --ok / --warn token） */
  tone: "ok" | "warn";
}

/**
 * 純函式：由退款狀態條目決定徽章顯示內容；回 null 表示不顯示。
 * loading / error / 無資料（info undefined）一律 null —— 安靜降級，
 * 絕不把「查不到」渲染成「未退款」誤導使用者。
 */
export function describeRefundBadge(
  info: JobRefundInfo | undefined | null
): RefundBadgeSpec | null {
  if (!info) return null;
  switch (info.refundStatus) {
    case "full":
      return {
        label: `已退回 ${info.refundedPoints} 點`,
        title: `此任務已全額退回 ${info.refundedPoints} 點`,
        tone: "ok",
      };
    case "partial":
      return {
        label: `部分退點 ${info.refundedPoints}/${info.chargedPoints}`,
        title: `此任務已退回 ${info.refundedPoints} 點（原扣 ${info.chargedPoints} 點）`,
        tone: "warn",
      };
    case "not_refunded":
      return {
        label: "未退點",
        title: `此任務已扣 ${info.chargedPoints} 點；若符合退款條件，退點會稍後自動入帳`,
        tone: "warn",
      };
    // none：無扣點紀錄（未計費任務）— 不顯示；unknown：查不到／出錯 — 不顯示
    default:
      return null;
  }
}

// ─── AIDV-969：任務結果 →「點數異動」導向（承 AIDV-650 驗收 3） ────────────────
//
// 站內目前沒有「單筆任務的點數交易明細頁」；最接近的實存落點是積分帳戶頁
// /dashboard?section=credits（App.tsx 註冊的 <Route path="/dashboard">，
// DashboardPage 支援 ?section=credits → 渲染 CreditsInfoPage：餘額＋退還機制）。
// 該頁不支援 jobId query，連結因此不帶 jobId（誠實，不假裝能跳到單筆）。

/** 點數帳戶頁的 pathname —— 必須是 App.tsx 實存路由（測試對照源碼釘住）。 */
export const CREDITS_LEDGER_PATHNAME = "/dashboard";
/** 點數帳戶頁完整 href（DashboardPage 的 section=credits 分頁）。 */
export const CREDITS_LEDGER_HREF = "/dashboard?section=credits";

export interface RefundLedgerLinkSpec {
  /** 站內連結（wouter href） */
  href: string;
  /** 連結文字（zh-TW，簡短） */
  label: string;
  /** 完整語意說明（title / aria-label 用） */
  title: string;
}

/**
 * 純函式：任務退款條目 →「查看點數紀錄」小連結；回 null 表示不顯示。
 * 顯示條件與徽章完全一致（full / partial / not_refunded 才顯示）；
 * none / unknown / 無資料一律 null —— 不破壞既有安靜降級行為。
 */
export function describeRefundLedgerLink(
  info: JobRefundInfo | undefined | null
): RefundLedgerLinkSpec | null {
  if (!describeRefundBadge(info)) return null;
  return {
    href: CREDITS_LEDGER_HREF,
    label: "點數紀錄",
    title: "前往積分帳戶查看餘額與退還機制",
  };
}

/**
 * 純函式：任務退款條目 →「本任務扣點 X／退回 Y」一行摘要；回 null 表示不顯示。
 * 資料完全來自 credits.jobRefundStatus 既有唯讀回傳（零新後端）。
 * 顯示條件與徽章一致：none / unknown / 無資料一律 null（安靜降級）。
 */
export function describeRefundSummary(
  info: JobRefundInfo | undefined | null
): string | null {
  if (!describeRefundBadge(info) || !info) return null;
  return `本任務扣點 ${info.chargedPoints} 點・已退回 ${info.refundedPoints} 點`;
}
