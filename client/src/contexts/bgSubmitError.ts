// ============================================================================
// contexts/bgSubmitError.ts — 背景任務送出失敗的 toast 文案正規化（單一真相源）
// ----------------------------------------------------------------------------
// 問題：BackgroundTasksContext.submitTask 先前在 catch 區塊只做
//   `return null`，把送出失敗整個吞掉。而唯一的呼叫端 useRegisterBgTask 會
//   **丟棄**這個回傳值（只 await 不看結果），於是任務沒登錄成功時使用者
//   端完全沒有任何回饋——沒有 toast、沒有 log，看起來像成功了。
//
// 解法：把「任意錯誤 → 友善標題 + 可選技術細節」的正規化集中在這裡，讓
//   catch 區塊能一致地 toast.error，同時仍保留 `return null` 契約（呼叫端
//   對 null 的判斷不變）。抽成純函式是為了能在不依賴 jsdom/React 的情況下
//   單元測試各種錯誤形態（Error / 字串 / null / 未知物件）。
//
// 標題固定為友善措辭、技術細節只放在 description（且只取得到時才帶），避免
//   把 tRPC 內部訊息當主標題嚇到非技術創作者。
// ============================================================================

export interface BgSubmitErrorToast {
  /** 友善、固定的主標題。 */
  title: string;
  /** 可選的技術細節（取自 error message / 字串）；取不到時省略。 */
  description?: string;
}

/** 對非技術創作者友善的固定標題。 */
export const BG_SUBMIT_ERROR_TITLE = "背景任務送出失敗";

/**
 * 把 submitTask catch 到的任意錯誤正規化成 toast 內容。
 *
 * - `Error`（含 tRPC error）：標題保持友善固定詞，message 放 description；
 *   message 為空白時不帶 description。
 * - 非空白字串：當作 description。
 * - null / undefined / 其他物件：只回友善標題（無 description）。
 */
export function describeBgSubmitError(err: unknown): BgSubmitErrorToast {
  if (err instanceof Error) {
    const detail = err.message.trim();
    return detail
      ? { title: BG_SUBMIT_ERROR_TITLE, description: detail }
      : { title: BG_SUBMIT_ERROR_TITLE };
  }
  if (typeof err === "string") {
    const detail = err.trim();
    return detail
      ? { title: BG_SUBMIT_ERROR_TITLE, description: detail }
      : { title: BG_SUBMIT_ERROR_TITLE };
  }
  return { title: BG_SUBMIT_ERROR_TITLE };
}
