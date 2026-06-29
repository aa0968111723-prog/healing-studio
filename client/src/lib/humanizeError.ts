/**
 * humanizeError.ts — 把後端 / SDK / tRPC 丟回的「工程字串」翻成使用者讀得懂的繁中。
 *
 * 為什麼放這裡（對照 workflowFailureMessages.ts 的同源治理）：
 *   - 全站數十處 `catch (e) { toast.error(e.message) }` 直接把 zod 驗證字串、
 *     `fetch failed`、provider SDK 內部訊息丟到使用者臉上，創作者看不懂、不知道
 *     下一步該怎麼辦（AIDV-582）。
 *   - 集中成一個純函式對照表：之後要新增 code→白話 只改這裡，UI 不用動。
 *   - 純函式、零 import、零 side-effect → vitest 直接測，避免某次改 mapping
 *     悄悄退化。要顯示 toast 時走 [[toastError]]（它會順手 console.error 工程細節）。
 *
 * 設計原則：
 *   1. 後端若已經回「乾淨的繁中短句」（例如 `點數不足`）→ 原樣保留，不要蓋掉好訊息。
 *   2. 否則依 tRPC / HTTP code 或英文訊息特徵歸類，回對應白話 + 重試提示。
 *   3. 都對不到 → 通用 fallback，**絕不**把原始 message 外露給使用者。
 */

export interface HumanizeOptions {
  /** 前綴情境，例如「生成失敗」。會組成「生成失敗：<白話>」。 */
  context?: string;
  /** 找不到對應分類時的白話 fallback（預設通用訊息）。 */
  fallback?: string;
}

/** 都對不到分類時的最後防線 — 永遠是白話，不含任何技術細節。 */
export const GENERIC_FALLBACK = "發生未預期的問題，請稍後再試。";

/** 從各種錯誤物件盡力取出 tRPC / HTTP 錯誤碼字串（大寫正規化）。 */
function extractCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as Record<string, any>;
  const raw =
    anyErr?.data?.code ??
    anyErr?.shape?.data?.code ??
    anyErr?.code ??
    anyErr?.data?.httpStatus ??
    anyErr?.status;
  if (raw === undefined || raw === null) return undefined;
  return String(raw).toUpperCase();
}

/** 從各種錯誤物件盡力取出 message 字串。 */
function extractMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object") {
    const m = (err as Record<string, any>).message;
    if (typeof m === "string") return m;
  }
  return "";
}

/**
 * 判斷一段 message 是否「本來就是乾淨的繁中人話」（後端刻意寫好的）。
 * 條件：含中日韓字、夠短、且不含技術雜訊（括號 / 換行 / Error / URL / 堆疊味）。
 */
function looksHumanReadable(message: string): boolean {
  const m = message.trim();
  if (!m || m.length > 60) return false;
  if (!/[一-鿿]/.test(m)) return false; // 沒中文 → 多半是英文工程字串
  if (/[{}[\]<>]/.test(m)) return false; // JSON / 泛型 / 標籤味
  if (/\r|\n/.test(m)) return false; // 多行 → 堆疊
  if (/Error|Exception|:\/\/|undefined|null\b|stack|\bat\s/i.test(m)) return false;
  return true;
}

/** code → 白話 body（不含 context 前綴）。對不到回 undefined。 */
function bodyFromCode(code: string | undefined): string | undefined {
  if (!code) return undefined;
  switch (code) {
    case "UNAUTHORIZED":
    case "401":
      return "登入狀態可能過期了，請重新登入後再試。";
    case "FORBIDDEN":
    case "403":
      return "你沒有權限執行這個操作。";
    case "NOT_FOUND":
    case "404":
      return "找不到要操作的項目，可能已被刪除或移動。";
    case "TIMEOUT":
    case "408":
    case "504":
      return "伺服器回應逾時，請稍後再試一次。";
    case "TOO_MANY_REQUESTS":
    case "429":
      return "操作太頻繁了，請稍等一下再試。";
    case "PAYLOAD_TOO_LARGE":
    case "413":
      return "檔案或內容太大，請縮小後再試。";
    case "CONFLICT":
    case "409":
      return "操作衝突，可能已有其他變更，請重新整理後再試。";
    case "BAD_REQUEST":
    case "PARSE_ERROR":
    case "UNPROCESSABLE_CONTENT":
    case "400":
    case "422":
      return "輸入的資料有點問題，請檢查後再送出。";
    case "PAYMENT_REQUIRED":
    case "402":
      return "點數或額度不足，請確認後再試。";
    case "INTERNAL_SERVER_ERROR":
    case "500":
    case "502":
    case "503":
      return "伺服器忙線或暫時出錯，請稍後再試。";
    default:
      return undefined;
  }
}

/** 英文 / 技術 message 特徵 → 白話 body。對不到回 undefined。 */
function bodyFromMessage(message: string): string | undefined {
  const m = message.toLowerCase();
  if (!m) return undefined;
  if (/fetch failed|failed to fetch|networkerror|err_network|econnrefused|net::|network request failed/.test(m))
    return "網路連線不穩，請檢查網路後再試。";
  if (/timeout|timed out|etimedout|aborterror|operation was aborted/.test(m))
    return "連線逾時，請稍後再試一次。";
  if (/quota|insufficient|資源不足|額度|點數|payment required|\b402\b|resource_exhausted/.test(m))
    return "點數或額度不足，請確認後再試。";
  if (/rate limit|too many requests|\b429\b/.test(m))
    return "操作太頻繁了，請稍等一下再試。";
  if (/unauthorized|\b401\b|not authenticated|invalid (token|session|api[\s-]?key)|jwt/.test(m))
    return "登入狀態可能過期了，請重新登入後再試。";
  if (/forbidden|\b403\b|permission denied|not allowed/.test(m))
    return "你沒有權限執行這個操作。";
  if (/not found|\b404\b/.test(m))
    return "找不到要操作的項目，可能已被刪除或移動。";
  if (/required|invalid input|expected .* received|zoderror|\bzod\b|validation failed|must be/.test(m))
    return "輸入的資料有點問題，請檢查後再送出。";
  if (/internal server error|\b5\d\d\b|bad gateway|service unavailable|gateway timeout/.test(m))
    return "伺服器忙線或暫時出錯，請稍後再試。";
  return undefined;
}

/**
 * 把任意錯誤翻成使用者讀得懂的繁中訊息（永不外露原始工程字串）。
 *
 * @param err 任意 catch 到的錯誤（Error / TRPCClientError / string / unknown）
 * @param options 字串＝context 前綴的捷徑；或 { context, fallback }
 *
 * @example toast.error(humanizeError(e, "生成失敗"))
 *          // → 「生成失敗：網路連線不穩，請檢查網路後再試。」
 */
export function humanizeError(
  err: unknown,
  options?: HumanizeOptions | string
): string {
  const opts: HumanizeOptions =
    typeof options === "string" ? { context: options } : options ?? {};
  const context = opts.context?.trim();
  const fallback = opts.fallback ?? GENERIC_FALLBACK;

  const message = extractMessage(err);

  // 1) 後端已給乾淨繁中 → 尊重它，原樣顯示。
  // 2) 否則照 code / 英文特徵歸類。
  // 3) 都不中 → 白話 fallback（不外露原文）。
  const body =
    (looksHumanReadable(message) ? message.trim() : undefined) ??
    bodyFromCode(extractCode(err)) ??
    bodyFromMessage(message) ??
    fallback;

  return context ? `${context}：${body}` : body;
}
