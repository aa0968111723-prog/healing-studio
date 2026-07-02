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
