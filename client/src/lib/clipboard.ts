import { toast } from "sonner";

/**
 * AIDV-579 — safe clipboard copy with honest user feedback.
 *
 * Awaits navigator.clipboard.writeText and falls back to execCommand for
 * non-HTTPS / permission-denied environments. Shows toast.success on success
 * (if successMsg is provided) and toast.error on failure, then throws so
 * callers with try/catch can react. Callers that void the promise get the
 * error toast for free without extra handling.
 */
export async function copyToClipboard(text: string, successMsg?: string): Promise<void> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.cssText = "position:fixed;opacity:0;top:0;left:0;pointer-events:none";
      document.body.appendChild(el);
      el.focus();
      el.select();
      ok = document.execCommand("copy");
      document.body.removeChild(el);
    } catch {
      ok = false;
    }
  }
  if (ok) {
    if (successMsg) toast.success(successMsg);
  } else {
    toast.error("複製失敗，請手動選取後複製");
    throw new Error("copy failed");
  }
}
