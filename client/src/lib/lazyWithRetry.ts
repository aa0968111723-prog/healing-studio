import { lazy, type ComponentType } from "react";

const RELOAD_FLAG_KEY = "hs-chunk-reload-attempt";
const RELOAD_COOLDOWN_MS = 15_000;
const RETRY_DELAY_MS = 800;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; message?: string };
  const name = e.name ?? "";
  const message = e.message ?? "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\d]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function importWithRetry<T>(
  factory: () => Promise<T>,
  options?: { retryDelayMs?: number; onStaleReload?: () => void }
): Promise<T> {
  try {
    return await factory();
  } catch (firstError) {
    if (!isChunkLoadError(firstError)) throw firstError;

    await delay(options?.retryDelayMs ?? RETRY_DELAY_MS);
    try {
      return await factory();
    } catch (secondError) {
      if (!isChunkLoadError(secondError)) throw secondError;

      // Likely stale index.html pointing at chunks that no longer exist.
      // Force one fresh fetch — gated by sessionStorage so a genuinely
      // broken deploy can't trap the user in a reload loop.
      if (typeof window !== "undefined") {
        try {
          const last = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) ?? "0");
          const now = Date.now();
          if (!Number.isFinite(last) || now - last > RELOAD_COOLDOWN_MS) {
            sessionStorage.setItem(RELOAD_FLAG_KEY, String(now));
            (options?.onStaleReload ?? (() => window.location.reload()))();
            return await new Promise<T>(() => {});
          }
        } catch {
          (options?.onStaleReload ?? (() => window.location.reload()))();
          return await new Promise<T>(() => {});
        }
      }
      throw secondError;
    }
  }
}

// React.lazy() with a single in-flight retry on transient network failure,
// then a one-time hard reload to pull a fresh index.html. Without this, a
// brief Wi-Fi blip during route transition surfaces as the full-screen
// "頁面暫時載入失敗" — but the underlying chunk would have loaded fine on a
// second attempt 800ms later.
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): ReturnType<typeof lazy<T>> {
  return lazy(() => importWithRetry(factory));
}
