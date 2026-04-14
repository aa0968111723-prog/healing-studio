import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

/**
 * Resolved theme applied to the DOM — always "light" or "dark".
 */
type ResolvedTheme = "light" | "dark";

/**
 * Four appearance modes:
 *  - light: always light
 *  - dark: always dark
 *  - auto: synced with ambient scene (nightSky/deepSea → dark, morning/cafe → light)
 *  - system: follows OS preference
 */
export type AppearanceMode = "light" | "dark" | "auto" | "system";

// Keep backward compatibility — "theme" = resolved light/dark
type Theme = ResolvedTheme;

interface ThemeContextType {
  /** Resolved theme on the DOM (always "light" | "dark") */
  theme: Theme;
  /** Current appearance mode selection */
  appearanceMode: AppearanceMode;
  /** Change appearance mode */
  setAppearanceMode: (mode: AppearanceMode) => void;
  /** Legacy toggle: flips between light ↔ dark mode */
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const APPEARANCE_STORAGE_KEY = "hs-appearance-mode";

/** Determine if the current ambient scene is "dark" */
function isSceneDark(): boolean {
  try {
    const sceneOverride = localStorage.getItem("hs-scene-override");
    if (sceneOverride === "nightSky" || sceneOverride === "deepSea") return true;
    if (sceneOverride === "morning" || sceneOverride === "cafe") return false;
  } catch { /* ignore */ }
  // Fallback: check time of day (same logic as AmbientEnvironment)
  const h = new Date().getHours();
  return h >= 22 || h < 5 || (h >= 17 && h < 22);
}

/** Determine resolved theme from mode */
function resolveTheme(mode: AppearanceMode): ResolvedTheme {
  switch (mode) {
    case "light": return "light";
    case "dark": return "dark";
    case "auto": return isSceneDark() ? "dark" : "light";
    case "system": {
      if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
      return "light";
    }
    default: return "light";
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = true,
}: ThemeProviderProps) {
  const [appearanceMode, setAppearanceModeRaw] = useState<AppearanceMode>(() => {
    try {
      const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "auto" || saved === "system") return saved;
    } catch { /* ignore */ }
    // Migrate legacy "theme" key → appearance mode
    try {
      const legacyTheme = localStorage.getItem("theme");
      if (legacyTheme === "dark") return "dark";
      if (legacyTheme === "light") return "light";
    } catch { /* ignore */ }
    return defaultTheme === "dark" ? "dark" : "light";
  });

  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(appearanceMode));

  // Re-resolve when mode changes
  useEffect(() => {
    setTheme(resolveTheme(appearanceMode));
  }, [appearanceMode]);

  // For "auto" mode: listen to scene override changes & time changes
  useEffect(() => {
    if (appearanceMode !== "auto") return;
    const interval = setInterval(() => {
      setTheme(resolveTheme("auto"));
    }, 30_000); // re-check every 30s
    // Also listen to localStorage changes (scene override from SceneSwitcher)
    function onStorage(e: StorageEvent) {
      if (e.key === "hs-scene-override") {
        setTheme(resolveTheme("auto"));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => { clearInterval(interval); window.removeEventListener("storage", onStorage); };
  }, [appearanceMode]);

  // For "system" mode: listen to OS preference changes
  useEffect(() => {
    if (appearanceMode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() { setTheme(resolveTheme("system")); }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [appearanceMode]);

  // Apply dark class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const setAppearanceMode = useCallback((mode: AppearanceMode) => {
    setAppearanceModeRaw(mode);
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
    } catch { /* ignore */ }
  }, []);

  const toggleTheme = switchable
    ? () => {
        const newMode: AppearanceMode = theme === "light" ? "dark" : "light";
        setAppearanceMode(newMode);
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, appearanceMode, setAppearanceMode, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
