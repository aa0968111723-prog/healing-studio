import type { ViewMode } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

// How long to wait after the last edit before flushing to the server. Keeps
// rapid toggles (e.g. dragging through scene tiles) from spamming the API
// while still feeling instant locally.
const SERVER_SYNC_DEBOUNCE_MS = 600;

export const DEFAULT_PERSONAL_SETTINGS: PersonalSettings = {
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

export type PersonalSettingsSyncStatus =
  | "idle"
  | "loading"
  | "saving"
  | "synced"
  | "offline"
  | "error";

type PersonalSettingsContextValue = {
  settings: PersonalSettings;
  updateSettings: (patch: Partial<PersonalSettings>) => void;
  resetSettings: () => void;
  isHydrated: boolean;
  syncStatus: PersonalSettingsSyncStatus;
  /** True once the *server* copy (or its absence due to no auth) has been resolved. */
  isServerSynced: boolean;
  lastSyncedAt: number | null;
  refresh: () => Promise<void>;
};

const PersonalSettingsContext = createContext<PersonalSettingsContextValue | null>(
  null
);

export function parseStoredSettings(raw: string | null): PersonalSettings {
  if (!raw) return DEFAULT_PERSONAL_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<PersonalSettings>;
    return mergePersonalSettings(DEFAULT_PERSONAL_SETTINGS, parsed);
  } catch {
    return DEFAULT_PERSONAL_SETTINGS;
  }
}

export function mergePersonalSettings(
  base: PersonalSettings,
  patch: Partial<PersonalSettings> | null | undefined
): PersonalSettings {
  if (!patch || typeof patch !== "object") return base;
  return {
    displayName:
      typeof patch.displayName === "string" ? patch.displayName : base.displayName,
    timezone:
      typeof patch.timezone === "string" && patch.timezone.trim()
        ? patch.timezone
        : base.timezone,
    bio: typeof patch.bio === "string" ? patch.bio : base.bio,
    compactMode:
      typeof patch.compactMode === "boolean"
        ? patch.compactMode
        : base.compactMode,
    confirmBeforeGenerate:
      typeof patch.confirmBeforeGenerate === "boolean"
        ? patch.confirmBeforeGenerate
        : base.confirmBeforeGenerate,
    soundEnabled:
      typeof patch.soundEnabled === "boolean"
        ? patch.soundEnabled
        : base.soundEnabled,
    desktopNotif:
      typeof patch.desktopNotif === "boolean"
        ? patch.desktopNotif
        : base.desktopNotif,
    viewMode:
      patch.viewMode === "desktop" ||
      patch.viewMode === "mobile" ||
      patch.viewMode === "auto"
        ? patch.viewMode
        : base.viewMode,
    orbCuteMode:
      typeof patch.orbCuteMode === "boolean"
        ? patch.orbCuteMode
        : base.orbCuteMode,
    orbRandomFly:
      typeof patch.orbRandomFly === "boolean"
        ? patch.orbRandomFly
        : base.orbRandomFly,
  };
}

/**
 * Translate the server-side `system_settings` row into our local
 * PersonalSettings shape. The `timezone` column lives on the row directly;
 * everything else lives under `extraSettings.personal` to stay forward-
 * compatible with the wider system_settings schema (which also tracks UI
 * theme, privacy consent, backup preferences, etc.).
 */
export function decodeServerSettings(
  data: { timezone?: string | null; extraSettings?: Record<string, unknown> | null } | undefined
): Partial<PersonalSettings> | null {
  if (!data) return null;
  const personalRaw =
    data.extraSettings && typeof data.extraSettings === "object"
      ? (data.extraSettings as Record<string, unknown>).personal
      : undefined;
  const personal =
    personalRaw && typeof personalRaw === "object"
      ? (personalRaw as Partial<PersonalSettings>)
      : {};
  return {
    ...personal,
    timezone:
      typeof data.timezone === "string" && data.timezone.trim()
        ? data.timezone
        : personal.timezone,
  };
}

/**
 * Build the payload sent to `settings.update`. Everything except `timezone`
 * goes into `extraSettings.personal`; we preserve any other top-level keys
 * inside `extraSettings` that the server already knows about so we don't
 * clobber unrelated future settings (theme, accent, …).
 */
export function encodeServerPayload(
  settings: PersonalSettings,
  baselineExtra: Record<string, unknown> | null | undefined
): { timezone: string; extraSettings: Record<string, unknown> } {
  const baseline =
    baselineExtra && typeof baselineExtra === "object" ? baselineExtra : {};
  return {
    timezone: settings.timezone,
    extraSettings: {
      ...baseline,
      personal: {
        displayName: settings.displayName,
        bio: settings.bio,
        compactMode: settings.compactMode,
        confirmBeforeGenerate: settings.confirmBeforeGenerate,
        soundEnabled: settings.soundEnabled,
        desktopNotif: settings.desktopNotif,
        viewMode: settings.viewMode,
        orbCuteMode: settings.orbCuteMode,
        orbRandomFly: settings.orbRandomFly,
      },
    },
  };
}

function isAuthError(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    if (err.data?.code === "UNAUTHORIZED") return true;
    if (err.data?.httpStatus === 401) return true;
  }
  return false;
}

export function PersonalSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, setSettings] = useState<PersonalSettings>(DEFAULT_PERSONAL_SETTINGS);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isServerSynced, setIsServerSynced] = useState(false);
  const [syncStatus, setSyncStatus] = useState<PersonalSettingsSyncStatus>(
    "idle"
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Track the last-known server `extraSettings` blob so that when we PATCH
  // we don't accidentally drop sibling keys (e.g. the AI brain config) that
  // other parts of the app might be writing to the same JSON column.
  const baselineExtraRef = useRef<Record<string, unknown> | null>(null);
  // Pending debounced flush handle.
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-fresh ref to the current settings, so the debounced timer reads
  // the latest values regardless of closure capture.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ── Hydrate from localStorage immediately so the UI doesn't flicker ─────
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

  // Persist every change locally — even before the server confirms — so a
  // refresh during a flaky connection still reflects the user's intent.
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
      typeof window === "undefined" ||
      !("Notification" in window) ||
      Notification.permission !== "default"
    ) {
      return;
    }
    Notification.requestPermission();
  }, [settings.desktopNotif, isHydrated]);

  // ── Server hydration: pull the canonical row once authenticated ─────────
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    // Don't auto-retry on auth failures — guests legitimately have no row,
    // we just want to know that quickly so localStorage can take over.
    retry: (failureCount, error) => {
      if (isAuthError(error)) return false;
      return failureCount < 1;
    },
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isHydrated) return;
    if (settingsQuery.isLoading) {
      setSyncStatus(prev => (prev === "saving" ? prev : "loading"));
      return;
    }
    if (settingsQuery.isError) {
      // Auth error → guest, just trust localStorage. Anything else → leave
      // an "offline" badge in the UI but keep the local copy live.
      const status = isAuthError(settingsQuery.error) ? "idle" : "offline";
      setSyncStatus(status);
      setIsServerSynced(true);
      return;
    }
    const data = settingsQuery.data;
    if (!data) {
      setSyncStatus("idle");
      setIsServerSynced(true);
      return;
    }
    baselineExtraRef.current =
      (data.extraSettings as Record<string, unknown> | null | undefined) ?? null;
    const decoded = decodeServerSettings(
      data as { timezone?: string | null; extraSettings?: Record<string, unknown> | null }
    );
    if (decoded) {
      setSettings(prev => mergePersonalSettings(prev, decoded));
    }
    setIsServerSynced(true);
    setSyncStatus("synced");
    setLastSyncedAt(Date.now());
  }, [
    isHydrated,
    settingsQuery.data,
    settingsQuery.isError,
    settingsQuery.error,
    settingsQuery.isLoading,
  ]);

  // ── Server sync: debounced flush via settings.update ────────────────────
  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => {
      // Refresh `settings.get` cache so other readers (e.g. a future
      // dedicated SystemSettings page) see the new values without a manual
      // invalidate.
      void utils.settings.get.invalidate();
      setSyncStatus("synced");
      setLastSyncedAt(Date.now());
    },
    onError: error => {
      if (isAuthError(error)) {
        // No session — local-only mode; not actually an error worth
        // flagging in red.
        setSyncStatus("idle");
        return;
      }
      setSyncStatus("error");
    },
  });

  const flushToServer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    // Only attempt the network write if the server hydration step decided we
    // actually have a session. Without this, guests would see a flash of red
    // "save failed" toast on every toggle.
    if (!isServerSynced) return;
    if (settingsQuery.isError && isAuthError(settingsQuery.error)) return;
    setSyncStatus("saving");
    const payload = encodeServerPayload(
      settingsRef.current,
      baselineExtraRef.current
    );
    // Optimistically update the baseline so the next flush starts from the
    // values we just sent.
    baselineExtraRef.current = payload.extraSettings;
    updateMutation.mutate(payload);
  }, [isServerSynced, settingsQuery.isError, settingsQuery.error, updateMutation]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushToServer, SERVER_SYNC_DEBOUNCE_MS);
  }, [flushToServer]);

  // Flush pending changes if the user navigates away or the tab is hidden,
  // so we don't lose a setting that was changed in the last few hundred ms.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBeforeUnload = () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
        flushToServer();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onBeforeUnload();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flushToServer]);

  const updateSettings = useCallback(
    (patch: Partial<PersonalSettings>) => {
      setSettings(prev => mergePersonalSettings(prev, patch));
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_PERSONAL_SETTINGS);
    scheduleFlush();
  }, [scheduleFlush]);

  const refresh = useCallback(async () => {
    await settingsQuery.refetch();
  }, [settingsQuery]);

  const value = useMemo<PersonalSettingsContextValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      isHydrated,
      syncStatus,
      isServerSynced,
      lastSyncedAt,
      refresh,
    }),
    [
      settings,
      updateSettings,
      resetSettings,
      isHydrated,
      syncStatus,
      isServerSynced,
      lastSyncedAt,
      refresh,
    ]
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
    throw new Error(
      "usePersonalSettings must be used within PersonalSettingsProvider"
    );
  }
  return ctx;
}
