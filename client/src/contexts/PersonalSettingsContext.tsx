import type { ViewMode } from "@/hooks/useMobile";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type PersonalSettings = {
  displayName: string;
  timezone: string;
  bio: string;
  compactMode: boolean;
  confirmBeforeGenerate: boolean;
  soundEnabled: boolean;
  desktopNotif: boolean;
  viewMode: ViewMode;
  orbCuteMode: boolean;
  orbRandomFly: boolean;
};

const STORAGE_KEY = "settings-personal-preferences-v2";

const DEFAULT_SETTINGS: PersonalSettings = {
  displayName: "",
  timezone:
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC"
      : "Etc/UTC",
  bio: "",
  compactMode: false,
  confirmBeforeGenerate: false,
  soundEnabled: true,
  desktopNotif: false,
  viewMode: "auto",
  orbCuteMode: false,
  orbRandomFly: false,
};

type PersonalSettingsContextValue = {
  settings: PersonalSettings;
  updateSettings: (patch: Partial<PersonalSettings>) => void;
  resetSettings: () => void;
  isHydrated: boolean;
};

const PersonalSettingsContext = createContext<PersonalSettingsContextValue | null>(
  null
);

function parseStoredSettings(raw: string | null): PersonalSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<PersonalSettings>;
    return {
      displayName:
        typeof parsed.displayName === "string" ? parsed.displayName : "",
      timezone:
        typeof parsed.timezone === "string" && parsed.timezone.trim()
          ? parsed.timezone
          : DEFAULT_SETTINGS.timezone,
      bio: typeof parsed.bio === "string" ? parsed.bio : "",
      compactMode: Boolean(parsed.compactMode),
      confirmBeforeGenerate: Boolean(parsed.confirmBeforeGenerate),
      soundEnabled:
        typeof parsed.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : DEFAULT_SETTINGS.soundEnabled,
      desktopNotif:
        typeof parsed.desktopNotif === "boolean"
          ? parsed.desktopNotif
          : DEFAULT_SETTINGS.desktopNotif,
      viewMode:
        parsed.viewMode === "desktop" ||
        parsed.viewMode === "mobile" ||
        parsed.viewMode === "auto"
          ? parsed.viewMode
          : DEFAULT_SETTINGS.viewMode,
      orbCuteMode:
        typeof parsed.orbCuteMode === "boolean"
          ? parsed.orbCuteMode
          : DEFAULT_SETTINGS.orbCuteMode,
      orbRandomFly:
        typeof parsed.orbRandomFly === "boolean"
          ? parsed.orbRandomFly
          : DEFAULT_SETTINGS.orbRandomFly,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function PersonalSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<PersonalSettings>(DEFAULT_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage can be locked out (privacy mode, strict CSP, quota).
    }
    setSettings(parseStoredSettings(raw));
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore — non-fatal */
    }
  }, [settings, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    document.documentElement.classList.toggle("hs-compact", settings.compactMode);
  }, [settings.compactMode, isHydrated]);

  useEffect(() => {
    if (
      !isHydrated ||
      !settings.desktopNotif ||
      !("Notification" in window) ||
      Notification.permission !== "default"
    ) {
      return;
    }
    Notification.requestPermission();
  }, [settings.desktopNotif, isHydrated]);

  const value = useMemo<PersonalSettingsContextValue>(
    () => ({
      settings,
      updateSettings: patch => setSettings(prev => ({ ...prev, ...patch })),
      resetSettings: () => setSettings(DEFAULT_SETTINGS),
      isHydrated,
    }),
    [settings, isHydrated]
  );

  return (
    <PersonalSettingsContext.Provider value={value}>
      {children}
    </PersonalSettingsContext.Provider>
  );
}

export function usePersonalSettings() {
  const ctx = useContext(PersonalSettingsContext);
  if (!ctx) {
    throw new Error("usePersonalSettings must be used within PersonalSettingsProvider");
  }
  return ctx;
}
