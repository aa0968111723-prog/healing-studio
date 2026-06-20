/**
 * contentModeration.ts — AIDV-65 ⑧-M2 內容審核 fail-closed 旗標
 *
 * 兩件事的旗標 gate（皆**預設 OFF＝零行為改變**）：
 *  (1) checkSafety（server/routers.ts）逾時／錯誤／無法解析時：
 *      - 旗標 OFF（現行）：fail-open → 回 `{ safe: true }`（放行）。
 *      - 旗標 ON：fail-closed → 回 `{ safe: false, reason }`（擋下，帶清楚原因）。
 *  (2) fal 生成呼叫的 enable_safety_checker：
 *      - 旗標 OFF（現行）：保持現行值（videoStudio wanTextToVideo＝input.enableSafety）。
 *      - 旗標 ON：開回 → true。
 *
 * ⚠️⚠️ fal enable_safety_checker 的「實際涵蓋邊界」（翻旗標前務必先讀）⚠️⚠️
 *  本批 resolveFalSafetyChecker() 只接在 **一個 live 注入點**：
 *    ✅ server/routers/videoStudio.ts wanTextToVideo（live，旗標可控）。
 *  以下 **不在**本批涵蓋範圍：
 *    ❌ server/services/falDispatcher.ts 主 dispatch 路徑 — 這才是光球主要的出圖／
 *       出影路徑（agentToolExecutor → imageSpecialistTools.dispatchGenerationJob →
 *       falDispatcher.callFalModel；routers.ts 註解「all 4 modalities go through
 *       falDispatcher」）。falDispatcher 建構 finalInput 時**完全不設**
 *       enable_safety_checker，本批**不改**（避免對不接受此欄位的 fal 模型造成 422＝
 *       破壞生成，違反 HARD SAFETY「不破壞生成」）。此主路徑的內容安全靠**上游**
 *       moderateOrbContent gate，不靠 fal 內建 safety checker。
 *    ❌ server/_core/imageGeneration.ts — dead/legacy（零 production 呼叫端），
 *       不視為受控注入點，維持原硬寫 false（見該檔註解）。
 *  → 結論：把 ENABLE_STRICT_CONTENT_MODERATION 翻 ON，**只有** videoStudio.wanTextToVideo
 *    這條的 fal safety checker 會被開回；主圖片／影片 dispatch 路徑不受此旗標影響。
 *    若要讓 falDispatcher 主路徑也受控，需另開卡（逐模型確認支援 enable_safety_checker
 *    後再注入），不在 AIDV-65 範圍。
 *
 * ⚠️ checkSafety（LLM 內容審核）fail-closed 的涵蓋邊界：
 *  本批 resolveSafetyFallback() 只接在 server/routers.ts 的 checkSafety（兩個 legacy
 *  generate.* 呼叫端共用）。videoStudio.wanTextToVideo 只 forward enable_safety_checker、
 *  不呼叫 checkSafety；orb 主生成路徑（agentToolExecutor→falDispatcher）也無 checkSafety
 *  gate。enable_safety_checker（fal 內建）與 checkSafety（LLM 審核）是兩套各自獨立、
 *  互不補位的機制，本卡的 LLM fail-closed 僅限 routers.ts checkSafety 兩個呼叫端。
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
