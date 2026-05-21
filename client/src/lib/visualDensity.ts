export type VisualDensity = "beginner" | "standard" | "professional";
const KEY = "hs-visual-density";
export function getVisualDensity(): VisualDensity {
  if (typeof window === "undefined") return "standard";
  const value = window.localStorage.getItem(KEY);
  return value === "beginner" || value === "standard" || value === "professional" ? value : "standard";
}
export function setVisualDensity(value: VisualDensity) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, value);
}
export function shouldShowAdvanced(density = getVisualDensity()): boolean { return density !== "beginner"; }
export function shouldShowDiagnostics(density = getVisualDensity()): boolean { return density === "professional"; }
