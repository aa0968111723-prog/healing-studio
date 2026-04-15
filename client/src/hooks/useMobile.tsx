import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

// ─── View Mode Toggle: force desktop or mobile view ──────────────────────
const VIEW_MODE_KEY = "view-mode-override";
type ViewMode = "auto" | "desktop" | "mobile";

export function useViewMode() {
  const [viewMode, setViewModeState] = React.useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === "desktop" || saved === "mobile") return saved;
    } catch {
      /* ignore */
    }
    return "auto";
  });

  const setViewMode = React.useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      if (mode === "auto") {
        localStorage.removeItem(VIEW_MODE_KEY);
      } else {
        localStorage.setItem(VIEW_MODE_KEY, mode);
      }
    } catch {
      /* ignore */
    }

    // Apply viewport meta tag change for desktop mode on mobile devices
    const metaViewport = document.querySelector('meta[name="viewport"]');
    if (metaViewport) {
      if (mode === "desktop") {
        metaViewport.setAttribute("content", "width=1280, initial-scale=0.35");
      } else {
        metaViewport.setAttribute(
          "content",
          "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover"
        );
      }
    }
  }, []);

  // Apply on mount
  React.useEffect(() => {
    if (viewMode !== "auto") {
      const metaViewport = document.querySelector('meta[name="viewport"]');
      if (metaViewport) {
        if (viewMode === "desktop") {
          metaViewport.setAttribute(
            "content",
            "width=1280, initial-scale=0.35"
          );
        }
      }
    }
  }, [viewMode]);

  return { viewMode, setViewMode };
}
