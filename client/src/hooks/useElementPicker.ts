// AIDV-864 PR②：點選模式 → hover 高亮 → click 擷取元素資訊；ESC 取消。純 DOM，無新依賴。
import { useCallback, useEffect, useRef } from "react";
import { getCssSelector } from "@/components/feedback/cssPath";

export interface PickedElement {
  selector: string;
  label: string;
  rect: { x: number; y: number; w: number; h: number };
  textSnippet?: string;
}

export function useElementPicker(
  active: boolean,
  onPick: (result: PickedElement) => void,
  onCancel: () => void,
) {
  const hlRef = useRef<HTMLDivElement | null>(null);

  const teardown = useCallback(() => {
    hlRef.current?.remove();
    hlRef.current = null;
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    if (!active) {
      teardown();
      return;
    }

    // Hover highlight overlay
    const hl = document.createElement("div");
    hl.setAttribute("aria-hidden", "true");
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hl.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "border:2px solid hsl(var(--primary, 221 83% 53%))",
      "background:hsl(var(--primary, 221 83% 53%) / 0.08)",
      "border-radius:4px",
      "z-index:99998",
      prefersReduced ? "" : "transition:left 60ms,top 60ms,width 60ms,height 60ms",
    ].filter(Boolean).join(";");
    document.body.appendChild(hl);
    hlRef.current = hl;
    document.body.style.cursor = "crosshair";

    const onOver = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t || t === hl) return;
      const r = t.getBoundingClientRect();
      hl.style.left   = `${r.left}px`;
      hl.style.top    = `${r.top}px`;
      hl.style.width  = `${r.width}px`;
      hl.style.height = `${r.height}px`;
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.target as Element;
      if (!t) return;
      const r    = t.getBoundingClientRect();
      const inner = (t as HTMLElement).innerText?.trim() ?? "";
      teardown();
      onPick({
        selector:    getCssSelector(t),
        label:       t.getAttribute("aria-label") ?? (inner.slice(0, 80) || t.tagName.toLowerCase()),
        rect:        { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        textSnippet: inner.slice(0, 300) || undefined,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { teardown(); onCancel(); }
    };

    document.addEventListener("mouseover", onOver, { capture: true });
    document.addEventListener("click",     onClick, { capture: true });
    document.addEventListener("keydown",   onKey);

    return () => {
      document.removeEventListener("mouseover", onOver, { capture: true });
      document.removeEventListener("click",     onClick, { capture: true });
      document.removeEventListener("keydown",   onKey);
      teardown();
    };
  }, [active, onPick, onCancel, teardown]);
}
