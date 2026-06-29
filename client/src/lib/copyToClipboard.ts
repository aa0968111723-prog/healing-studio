/**
 * copyToClipboard.ts — 統一的「複製到剪貼簿」入口（AIDV-579）。
 *
 * 問題：全站約 30 處直接呼叫 `navigator.clipboard.writeText(...)`，但多半未
 * `await`／未 `.catch`，就立刻 `toast.success("已複製")`。在剪貼簿權限被拒、
 * 非安全環境（非 HTTPS）、或焦點不在頁時，實際沒複製成功卻謊報，且丟出無人接的
 * Promise rejection（unhandled rejection）。
 *
 * 解法：複製成功才報成功，失敗給白話提示；對不支援 Clipboard API 的舊環境用
 * `document.execCommand('copy')` 兜底。
 *
 * 用法：
 *   import { copyToClipboard } from "@/lib/copyToClipboard";
 *   onClick={() => void copyToClipboard(url, "訂閱連結")}   // 自動 toast「已複製訂閱連結」/「複製失敗，請手動選取」
 *   const ok = await copyToClipboard(text);                 // 需要結果時可 await（true=成功）
 */
import { toast } from "sonner";

/** execCommand 兜底：在不支援 Clipboard API 或被拒時使用（舊瀏覽器/非安全環境）。 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // 移到畫面外、避免捲動跳動，並保持可被選取。
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface CopyToClipboardOptions {
  /** 成功時顯示的 toast 文案；預設「已複製{label}」或「已複製」。 */
  successMessage?: string;
  /** 失敗時顯示的 toast 文案；預設「複製失敗，請手動選取」。 */
  errorMessage?: string;
  /** 設為 true 則不顯示任何 toast，僅回傳成功與否（呼叫端自行處理回饋）。 */
  silent?: boolean;
}

/**
 * 把 `text` 複製到剪貼簿。成功才報成功、失敗給提示，並消除 unhandled rejection。
 *
 * @param text  要複製的文字
 * @param label 可選的物件名稱（用於組「已複製{label}」），或直接給 options
 * @returns 是否成功複製
 */
export async function copyToClipboard(
  text: string,
  label?: string | CopyToClipboardOptions,
  maybeOptions?: CopyToClipboardOptions
): Promise<boolean> {
  const options: CopyToClipboardOptions =
    typeof label === "object" && label !== null ? label : maybeOptions ?? {};
  const labelText = typeof label === "string" ? label : undefined;

  const successMessage =
    options.successMessage ?? `已複製${labelText ?? ""}`;
  const errorMessage = options.errorMessage ?? "複製失敗，請手動選取";

  let ok = false;
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText
    ) {
      await navigator.clipboard.writeText(text);
      ok = true;
    } else {
      ok = legacyCopy(text);
    }
  } catch (err) {
    // Clipboard API 被拒/失敗 → 嘗試 execCommand 兜底。
    ok = legacyCopy(text);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error("[copyToClipboard] 複製失敗", err);
    }
  }

  if (!options.silent) {
    if (ok) {
      toast.success(successMessage);
    } else {
      toast.error(errorMessage);
    }
  }
  return ok;
}
