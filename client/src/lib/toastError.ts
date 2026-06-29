/**
 * toastError.ts — 顯示「白話錯誤 toast」的統一入口（AIDV-582）。
 *
 *   - 使用者只看到 [[humanizeError]] 翻好的白話 + 重試提示。
 *   - 工程細節（原始 error 物件）只進 console.error 保留給開發者排查，不外露。
 *
 * 用法：把 `toast.error(`生成失敗：${e.message}`)` 換成 `toastError(e, "生成失敗")`。
 */
import { toast } from "sonner";
import { humanizeError, type HumanizeOptions } from "./humanizeError";

export function toastError(
  err: unknown,
  options?: HumanizeOptions | string
): string {
  const context = typeof options === "string" ? options : options?.context;
  // 保留工程細節給開發者；使用者不會看到這行。
  // eslint-disable-next-line no-console
  console.error(`[toastError]${context ? ` ${context}` : ""}`, err);
  const message = humanizeError(err, options);
  toast.error(message);
  return message;
}
