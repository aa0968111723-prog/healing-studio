// ============================================================================
// spine/seedVisual.ts — 由 seed 決定的影格佔位樣式（一致性示意）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬 lib/util.ts 的 frameStyle。同 seed + 同 variant → 永遠同一張
// 漸層，視覺化「固定 seed → 跨鏡一致 / 同 seed 重生」這個鐵則。真實版有 assetUrl 時
// 直接顯示影像，沒有時（idle / 尚未生成 / mock）用本樣式當佔位。純函式。
// ============================================================================

/** 回傳一個 CSS background（radial-gradient）字串；seed 相同則結果相同。 */
export function frameStyle(seed = 0, variant = 0): string {
  const h1 = Math.abs((seed * 47 + variant * 97) % 360);
  const h2 = (h1 + 38) % 360;
  const h3 = (h2 + 46) % 360;
  return `radial-gradient(130% 120% at 28% 22%, hsl(${h1} 72% 56%), hsl(${h2} 58% 30%) 55%, hsl(${h3} 54% 12%) 100%)`;
}
