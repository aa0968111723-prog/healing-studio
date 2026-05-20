import * as React from "react";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";

// Keep in lockstep with --bp-mobile in client/src/index.css.
const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const {
    settings: { viewMode },
  } = usePersonalSettings();
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

  if (viewMode === "desktop") return false;
  if (viewMode === "mobile") return true;
  return !!isMobile;
}

// ─── View Mode Toggle: force desktop or mobile view ──────────────────────
export type ViewMode = "auto" | "desktop" | "mobile";

export function useViewMode() {
  const {
    settings: { viewMode },
    updateSettings,
  } = usePersonalSettings();

  const setViewMode = React.useCallback((mode: ViewMode) => {
    updateSettings({ viewMode: mode });

    // Apply viewport meta tag change for desktop mode on mobile devices
    const metaViewport = document.querySelector('meta[name="viewport"]');
    if (metaViewport) {
      const content =
        mode === "desktop"
          ? "width=1280, initial-scale=0.35"
          : "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover";
      metaViewport.setAttribute("content", content);
    }
    document.documentElement.dataset.viewMode = mode;
  }, [updateSettings]);

  // Apply on mount
  React.useEffect(() => {
    const metaViewport = document.querySelector('meta[name="viewport"]');
    if (metaViewport) {
      const content =
        viewMode === "desktop"
          ? "width=1280, initial-scale=0.35"
          : "width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover";
      metaViewport.setAttribute("content", content);
    }
    document.documentElement.dataset.viewMode = viewMode;
  }, [viewMode]);

  return { viewMode, setViewMode };
}
