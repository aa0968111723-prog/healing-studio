/**
 * adminApiUsageEstimate.ts — fal/gemini 估算快照的前端解析 helper（AIDV-561／AIDV-194）
 *
 * providerSnapshotJob 對 fal_ai/gemini 產生的是「目錄單價×用量」估算快照：
 * quota/remaining/balanceUsd 一律不寫（那些語意上是供應商權威值），估算數字與
 * estimated=true / reconciled=false / estimateAvailable 標記落在 extraData。
 *
 * 此 helper 把 unknown 的 extraData 安全解析成 UI 可渲染的估算資訊：
 *   - 回 null       → 非估算快照（elevenlabs/suno 權威值，或舊版占位快照），
 *                     UI 走原本的 quota/remaining/balance 呈現，行為不變（加性承諾）。
 *   - 回非 null     → 估算快照，UI 應渲染「估算值・未對帳」badge 並以估算數字
 *                     取代誤導性的 quota 0／remaining 0／$0.00。
 *
 * 防禦性解析：extraData 來自 DB JSON 欄位，任何欄位缺失/型別不符/NaN/負值
 * 都降級為 null（該格顯示 "—"），絕不丟例外、絕不顯示離譜數字。
 */

export interface SnapshotEstimateInfo {
  /** 當日估算是否可得（job 聚合失敗時為 false，仍標 estimated）。 */
  estimateAvailable: boolean;
  /** 今日呼叫數（估算窗口＝本地零點起）；不可得時 null。 */
  todayCallCount: number | null;
  /** 今日費用 USD（目錄單價×用量）；不可得時 null。 */
  todayCostUsd: number | null;
}

/**
 * 解析 provider_snapshots.extraData。
 * 只有 extraData.estimated === true（嚴格布林）才視為估算快照。
 */
export function readSnapshotEstimate(extraData: unknown): SnapshotEstimateInfo | null {
  if (!extraData || typeof extraData !== "object" || Array.isArray(extraData)) {
    return null;
  }
  const d = extraData as Record<string, unknown>;
  if (d.estimated !== true) return null;

  const rawCost = d.todayCostUsd;
  const parsedCost =
    typeof rawCost === "number" ||
    (typeof rawCost === "string" && rawCost.trim() !== "")
      ? Number(rawCost)
      : null;

  return {
    estimateAvailable: d.estimateAvailable === true,
    todayCallCount:
      typeof d.todayCallCount === "number" &&
      Number.isFinite(d.todayCallCount) &&
      d.todayCallCount >= 0
        ? d.todayCallCount
        : null,
    todayCostUsd:
      parsedCost != null && Number.isFinite(parsedCost) && parsedCost >= 0
        ? parsedCost
        : null,
  };
}
