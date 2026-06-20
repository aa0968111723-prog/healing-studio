/**
 * contentModeration.ts — AIDV-65 內容審核 fail-closed 安全門
 *
 * ⚠️ 方向：這是**內容審核安全控制**（safety > availability），與一般「可用性鎖」
 *   方向相反，刻意預設 **ON = fail-closed**。checkSafety（server/routers.ts 的 LLM
 *   內容審核）在「逾時／錯誤／無法可靠解析」時 **擋下** 內容（回 { safe:false, reason }），
 *   不放行未經審核的內容。
 *
 * 兩件事由旗標 CONTENT_SAFETY_FAIL_CLOSED（env.validated，**預設 ON**）gate：
 *  (1) checkSafety 逾時／錯誤／無法解析時：
 *      - 旗標 ON（預設）：fail-closed → 回 `{ safe: false, reason }`（擋下，帶清楚原因）。
 *      - 旗標 OFF（明確設 false/0/off/no，緊急回退）：fail-open → 回 `{ safe: true }`（放行）。
 *  (2) fal 生成呼叫的 enable_safety_checker：
 *      - 旗標 ON（預設）：開回 → true（供應商端安檢）。
 *      - 旗標 OFF（緊急回退）：保持現行值（videoStudio wanTextToVideo＝input.enableSafety）。
 *
 * ⚠️⚠️ fal enable_safety_checker 的「實際涵蓋邊界」（翻旗標前務必先讀）⚠️⚠️
 *  本批 resolveFalSafetyChecker() 只接在 **一個 live 注入點**：
 *    ✅ server/routers/videoStudio.ts wanTextToVideo（live，旗標可控；fal-ai/wan-t2v
 *       接受 enable_safety_checker，開回 true 不會造成 422＝不破壞生成）。
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
 *  → 結論：旗標 ON（預設）時，**只有** videoStudio.wanTextToVideo 這條的 fal safety
 *    checker 會被開回 true；主圖片／影片 dispatch 路徑不受此旗標影響。
 *    若要讓 falDispatcher 主路徑也受控，需另開卡（逐模型確認支援 enable_safety_checker
 *    後再注入），不在 AIDV-65 範圍。
 *
 * ⚠️ checkSafety（LLM 內容審核）fail-closed 的涵蓋邊界：
 *  本批 resolveSafetyFallback() 只接在 server/routers.ts 的 checkSafety（兩個 generate.*
 *  呼叫端共用）。videoStudio.wanTextToVideo 只 forward enable_safety_checker、不呼叫
 *  checkSafety；orb 主生成路徑（agentToolExecutor→falDispatcher）也無 checkSafety gate。
 *  enable_safety_checker（fal 內建）與 checkSafety（LLM 審核）是兩套各自獨立、互不補位
 *  的機制，本卡的 LLM fail-closed 僅限 routers.ts checkSafety 兩個呼叫端。
 *
 * ⚠️ 與 LLM 不可用的交互（HARD SAFETY 必讀）：
 *  checkSafety 透過 invokeLLM 走同一條 LLM 路由（Anthropic/OpenRouter/Gemini/…）。
 *  當 LLM 無額度／金鑰失效時 checkSafety 必然逾時或錯誤 → fail-closed 會擋下這些生成。
 *  但生成關鍵路徑（compileElitePrompt 等）本就依賴同一 LLM、在 LLM 壞時也跑不動，
 *  故 fail-closed **無新增**負面影響（只是把「LLM 一旦壞掉就漏審放行」修正為「審核
 *  失敗就擋」）。為避免「審核服務一抖動就把所有生成永久卡死」，checkSafety 端帶
 *  合理 timeout＋一次重試（見 server/routers.ts），且本旗標可被明確回退到 fail-open。
 */

import { serverEnv } from "../../_core/env.validated";

/**
 * 把字串解析為「明確的關閉值」（"0"/"false"/"off"/"no"，含大小寫與前後空白）。
 * 只有明確關閉值才回 true；留空／未設／其他值皆回 false（→ 沿用預設）。
 */
function isExplicitlyFalsy(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off" || v === "no";
}

/**
 * AIDV-65：內容審核 fail-closed 安全門。**預設 ON＝fail-closed**（safety > availability）。
 *
 * 主旗標：CONTENT_SAFETY_FAIL_CLOSED（env.validated，預設 "true"）。
 *  - 明確設為 "false"/"0"/"off"/"no" → 回退 fail-open（緊急用，明確人工決定）。
 *  - 留空／未設／"true"/"1"/"on"/"yes" → fail-closed ON（預設）。
 */
export function isContentSafetyFailClosed(): boolean {
  // 緊急回退：CONTENT_SAFETY_FAIL_CLOSED 被明確關閉時 fail-open。
  if (isExplicitlyFalsy(serverEnv.CONTENT_SAFETY_FAIL_CLOSED)) return false;
  // 預設（含留空/未設/真值）＝fail-closed ON。
  return true;
}

/**
 * 旗標 ON（預設）時 checkSafety 在「逾時／錯誤／無法解析」分支回傳的 fail-closed 結果。
 * 旗標明確回退 OFF 時維持 fail-open（`{ safe: true }`，緊急用）。
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
  return isContentSafetyFailClosed() ? { safe: false, reason } : { safe: true };
}

/**
 * 旗標 gate 後的 fal enable_safety_checker 值。
 * 旗標 ON（預設）＝true（開回 fal 內建 safety checker）；
 * 旗標明確回退 OFF＝維持 currentValue（現行值，緊急用）。
 *
 * @param currentValue  現行值（videoStudio＝input.enableSafety）。
 */
export function resolveFalSafetyChecker(currentValue: boolean): boolean {
  return isContentSafetyFailClosed() ? true : currentValue;
}
