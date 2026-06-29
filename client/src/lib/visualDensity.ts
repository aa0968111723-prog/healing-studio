export type VisualDensity = "beginner" | "standard" | "professional";
const KEY = "hs-visual-density";
export function getVisualDensity(): VisualDensity {
  if (typeof window === "undefined") return "standard";
  // 無痕模式 / 停用儲存的瀏覽器讀取 localStorage 會丟例外；吞掉並退回預設，避免白畫面。
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "beginner" || value === "standard" || value === "professional" ? value : "standard";
  } catch {
    return "standard";
  }
}
export function setVisualDensity(value: VisualDensity) {
  if (typeof window === "undefined") return;
  // 寫入失敗（無痕 / 已滿 / 停用）不影響功能，靜默忽略即可。
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* localStorage unavailable — ignore */
  }
}
export function shouldShowAdvanced(density = getVisualDensity()): boolean { return density !== "beginner"; }
export function shouldShowDiagnostics(density = getVisualDensity()): boolean { return density === "professional"; }
