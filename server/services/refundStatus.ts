/**
 * refundStatus.ts — AIDV-650 任務退款狀態透明化（唯讀推導服務）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 目的：任務失敗後使用者不知道「有沒有被扣點、退了沒」。此服務把退款狀態
 * 變成可查詢的唯讀事實，供前端在失敗任務卡上顯示徽章。
 *
 * 真相來源：`background_jobs.resultJson` 內的三個旗標
 *   - `costPoints`      扣點金額（計費站點於扣點成功後寫入；server 端計算值）
 *   - `refunded`        退款冪等旗標（AIDV-577 atomicClaimJobRefund CAS 寫入）
 *   - `refundedPoints`  已退回點數（與 refunded 同批 JSON_SET 寫入）
 *
 * 為什麼不是 cost_ledger：cost_ledger 記的是 AI API 真實成本（USD）複式分錄，
 * refType 只有 "ai_usage_event"、member 帳戶目前零 credit——點數退款完全不寫
 * ledger，因此以 ledger 推導退款狀態必然全面誤判。詳見 AIDV-650 研究。
 *
 * 安全約束（HARD）：
 *   - 純唯讀：只 SELECT background_jobs，絕不觸碰扣款/退款寫入路徑。
 *   - 嚴格 user 隔離：SQL 端 WHERE userId = 本人；非本人/不存在的 id 一律回
 *     `unknown`，回應形狀不可區分（防 IDOR / 存在性枚舉）。
 *   - 單一批次 SQL（inArray），輸入上限 100（超出截斷）。
 *   - 任何內部錯誤 fallback 為 `unknown`，永不 throw 到 UI。
 */

import * as db from "../db";

/** 每批查詢的任務 id 上限；超出直接截斷（非拒絕）。 */
export const MAX_REFUND_STATUS_IDS = 100;

/**
 * 退款狀態枚舉：
 *   - `none`         查得到任務但無扣點紀錄（如 submitStudioJob 登錄型任務）→ 前端不顯示
 *   - `not_refunded` 有扣點、尚無退款旗標（完成任務屬正常；失敗任務＝退點待入帳）
 *   - `partial`      已退款但金額小於扣點
 *   - `full`         已全額退款
 *   - `unknown`      查不到（非本人／不存在／DB 錯誤／demo 無 DB）→ 前端不顯示
 */
export type RefundStatus = "none" | "not_refunded" | "partial" | "full" | "unknown";

export interface JobRefundStatusEntry {
  taskId: number;
  /** 扣點金額（點數）；無紀錄為 0 */
  chargedPoints: number;
  /** 已退回點數；clamp 至 chargedPoints（不顯示超退） */
  refundedPoints: number;
  refundStatus: RefundStatus;
}

/** 防禦性讀取點數欄位：只接受有限正數（或純數字字串），其餘視為 0。 */
function readPoints(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw.trim())) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

/**
 * 純函式：由單一任務的 resultJson 推導退款狀態。
 *
 * 推導規則（與 refundJobIfBilled / atomicClaimJobRefund 的寫入語意對齊）：
 *   - 無 costPoints（或非法值）→ `none`（無扣點紀錄，不可斷言被扣費）
 *   - costPoints > 0 且無 refunded 旗標 → `not_refunded`
 *   - refunded 旗標在：refundedPoints ≥ costPoints → `full`（clamp 封頂）；
 *     0 < refundedPoints < costPoints → `partial`；
 *     金額缺失（防禦）→ 視為全額（旗標與金額由同一 JSON_SET 寫入，缺失屬異常）
 *   - 防禦特例：有 refunded + refundedPoints 但 costPoints 缺 → 仍回報 `full`
 *
 * 注意：refunded=true 嚴格說是「退款鎖已搶到」（AIDV-577 旗標先設後退款，
 * refundUserPoints 失敗時旗標留存待人工稽核）。此處依產品語意視為已退款。
 */
export function deriveJobRefundStatus(
  taskId: number,
  resultJson: unknown
): JobRefundStatusEntry {
  const meta =
    resultJson && typeof resultJson === "object" && !Array.isArray(resultJson)
      ? (resultJson as Record<string, unknown>)
      : {};
  const charged = readPoints(meta.costPoints);
  const refundedFlag = meta.refunded === true || meta.refunded === "true";
  const refundedRaw = readPoints(meta.refundedPoints);

  if (charged <= 0) {
    if (refundedFlag && refundedRaw > 0) {
      // 防禦：costPoints 缺但退款旗標＋金額俱在 → 以退回金額回報全額退款。
      return {
        taskId,
        chargedPoints: refundedRaw,
        refundedPoints: refundedRaw,
        refundStatus: "full",
      };
    }
    return { taskId, chargedPoints: 0, refundedPoints: 0, refundStatus: "none" };
  }

  if (!refundedFlag) {
    return {
      taskId,
      chargedPoints: charged,
      refundedPoints: 0,
      refundStatus: "not_refunded",
    };
  }

  const refunded = Math.min(refundedRaw > 0 ? refundedRaw : charged, charged);
  return {
    taskId,
    chargedPoints: charged,
    refundedPoints: refunded,
    refundStatus: refunded >= charged ? "full" : "partial",
  };
}

/** 建立 unknown 佔位（查不到／出錯時的統一回應形狀）。 */
function unknownEntry(taskId: number): JobRefundStatusEntry {
  return { taskId, chargedPoints: 0, refundedPoints: 0, refundStatus: "unknown" };
}

/**
 * 批次查詢多個任務的退款狀態（單一 SQL、嚴格本人隔離、永不 throw）。
 *
 * - ids 先去重、截斷至 MAX_REFUND_STATUS_IDS。
 * - 每個（去重後的）id 保證有一筆輸出；查不到或出錯 → `unknown`。
 * - 空陣列直接回空結果，不打 DB。
 */
export async function getJobRefundStatuses(
  userId: number,
  jobIds: number[]
): Promise<JobRefundStatusEntry[]> {
  const ids = Array.from(new Set(jobIds)).slice(0, MAX_REFUND_STATUS_IDS);
  const byId = new Map<number, JobRefundStatusEntry>();
  for (const id of ids) byId.set(id, unknownEntry(id));
  if (ids.length === 0) return [];

  try {
    const rows = await db.getBackgroundJobsRefundMeta(userId, ids);
    for (const row of rows) {
      // 只填我們請求過的 id（防禦：忽略任何多餘列）
      if (byId.has(row.id)) {
        byId.set(row.id, deriveJobRefundStatus(row.id, row.resultJson));
      }
    }
  } catch (err) {
    // DB 錯誤 → 整批維持 unknown，絕不 throw 到 UI（HARD SAFETY #6）。
    console.warn(
      "[refundStatus] getJobRefundStatuses failed — falling back to unknown:",
      err instanceof Error ? err.message : err
    );
  }

  return Array.from(byId.values());
}
