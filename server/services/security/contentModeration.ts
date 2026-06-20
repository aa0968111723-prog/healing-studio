/**
 * contentModeration.ts — AIDV-65 ⑧-M2 內容審核 fail-closed 旗標
 *
 * 兩件事的旗標 gate（皆**預設 OFF＝零行為改變**）：
 *  (1) checkSafety（server/routers.ts）逾時／錯誤／無法解析時：
 *      - 旗標 OFF（現行）：fail-open → 回 `{ safe: true }`（放行）。
 *      - 旗標 ON：fail-closed → 回 `{ safe: false, reason }`（擋下，帶清楚原因）。
 *  (2) fal 生成呼叫的 enable_safety_checker：
 *      - 旗標 OFF（現行）：保持現行值（videoStudio wanTextToVideo＝input.enableSafety；
 *        imageGeneration（legacy 無呼叫端）＝false）。
 *      - 旗標 ON：開回 → true。
 *
 * ⚠️ HARD SAFETY（AIDV-65）：
 *  - 旗標 OFF＝**完全保持現行行為**（位元相同）：checkSafety 失敗仍 fail-open、
 *    fal enable_safety_checker 維持現值。生成關鍵路徑不受影響。
 *  - fail-closed 只在「旗標 ON＋safety 檢查真的逾時／錯誤／無法解析」時擋；
 *    safety 檢查正常「通過」時（旗標 ON 或 OFF）一律正常放行 → 不誤擋。
 *
 * 旗標 helper：isStrictContentModerationEnabled()（讀 process.env
 * ENABLE_STRICT_CONTENT_MODERATION，**預設 OFF**，仿 ragInjectionGuard.ts /
 * director.ts 既有型樣）。
 */

/**
 * AIDV-65：內容審核嚴格模式旗標。**預設 OFF＝零行為改變**：未開啟時 checkSafety
 * 失敗仍 fail-open、fal enable_safety_checker 維持現值。
 *
 * 設 ENABLE_STRICT_CONTENT_MODERATION=1（或 true/on/yes）開啟。真值集合與既有
 * server 端聚焦旗標（ENABLE_RAG_INJECTION_GUARD / ENABLE_DIRECTOR_WORLD_CONTEXT）一致。
 */
export function isStrictContentModerationEnabled(): boolean {
  const raw = process.env.ENABLE_STRICT_CONTENT_MODERATION;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * 旗標 ON 時 checkSafety 在「逾時／錯誤／無法解析」分支回傳的 fail-closed 結果。
 * 旗標 OFF 時維持現行 fail-open（`{ safe: true }`）。
 *
 * 用法：在 checkSafety 的 catch 與 parse-fail fallback 兩處呼叫，取代原本硬寫死
 * 的 `return { safe: true }`。
 *
 * @param reason  擋下時的人類可讀原因（會被帶到呼叫端的錯誤訊息／SSE error 節點）。
 */
export function resolveSafetyFallback(reason: string): {
  safe: boolean;
  reason?: string;
} {
  return isStrictContentModerationEnabled()
    ? { safe: false, reason }
    : { safe: true };
}

/**
 * 旗標 gate 後的 fal enable_safety_checker 值。
 * 旗標 ON＝true（開回 fal 內建 safety checker）；旗標 OFF＝維持 currentValue（現行值）。
 *
 * @param currentValue  現行值（videoStudio＝input.enableSafety；imageGeneration＝false）。
 */
export function resolveFalSafetyChecker(currentValue: boolean): boolean {
  return isStrictContentModerationEnabled() ? true : currentValue;
}
