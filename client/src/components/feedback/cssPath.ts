/**
 * getCssSelector — 從 DOM 元素產生簡短 CSS 路徑（純函式，無副作用）。
 * 策略：遇 id 即截斷；最多取 maxDepth 層；每層取 tag + 前 2 個 class + nth-of-type。
 * 輸出僅作為回饋 landmark.selector，不用於程式化操控 DOM。
 */
export function getCssSelector(el: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let cur: Element | null = el;

  while (cur && cur !== document.body && parts.length < maxDepth) {
    if (cur.id) {
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cur.id) : cur.id.replace(/[^a-z0-9_-]/gi, "-");
      parts.unshift(`#${esc}`);
      break;
    }

    let seg = cur.tagName.toLowerCase();

    const cls = Array.from(cur.classList)
      .filter(c => /^[a-z][\w-]*$/i.test(c) && c.length <= 40)
      .slice(0, 2);
    if (cls.length) seg += "." + cls.join(".");

    const parent = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(s => s.tagName === cur!.tagName);
      if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }

    parts.unshift(seg);
    cur = cur.parentElement;
  }

  return parts.join(" > ");
}
