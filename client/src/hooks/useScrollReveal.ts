import { useEffect, useRef, useState } from "react";

/**
 * useScrollReveal — IntersectionObserver-based one-time reveal.
 * Returns a ref to attach to the element, and a boolean indicating
 * whether it has entered the viewport. Reveal happens once.
 *
 * Usage:
 *   const { ref, visible } = useScrollReveal<HTMLDivElement>();
 *   <div ref={ref} className={cn("transition-all", visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4")} />
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit
) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // SSR / no IO support safety
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    // Respect prefers-reduced-motion: reveal immediately, no animation gating
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setVisible(true);
      return;
    }

    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      {
        rootMargin: "-10% 0px -10% 0px",
        threshold: 0.1,
        ...options,
      }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [options]);

  return { ref, visible };
}
