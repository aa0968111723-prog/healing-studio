import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";

// ─── Global Auth Expired Event ─────────────────────────────────────────────
// This event-based approach decouples the tRPC interceptor from the UI layer.
// Any part of the app can dispatch this event to trigger the login modal.

const AUTH_EXPIRED_EVENT = "auth:session-expired";

/** Dispatch from interceptors / onClick guards to show the modal */
export function emitAuthExpired() {
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

/** Check if user is likely authenticated (quick client-side check) */
export function isLikelyAuthenticated(): boolean {
  try {
    const raw = localStorage.getItem("manus-runtime-user-info");
    if (!raw || raw === "null" || raw === "undefined") return false;
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && parsed.id;
  } catch {
    return false;
  }
}

/** Guard for onClick handlers — returns true if auth is OK, false + shows modal if not */
export function requireAuth(): boolean {
  if (isLikelyAuthenticated()) return true;
  emitAuthExpired();
  return false;
}

// ─── Debounce: prevent multiple concurrent 401s from spawning multiple modals
let lastEmitTime = 0;
const DEBOUNCE_MS = 2000;

export function emitAuthExpiredDebounced() {
  const now = Date.now();
  if (now - lastEmitTime < DEBOUNCE_MS) return;
  lastEmitTime = now;
  emitAuthExpired();
}

// ─── AuthExpiredModal Component ────────────────────────────────────────────

export default function AuthExpiredModal() {
  const [visible, setVisible] = useState(false);

  const handleAuthExpired = useCallback(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [handleAuthExpired]);

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000]"
            onClick={handleDismiss}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-0 flex items-center justify-center z-[10001] pointer-events-none"
          >
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700 max-w-md w-full mx-4 p-8 pointer-events-auto relative">
              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8 text-amber-500" />
                </div>
              </div>

              {/* Title */}
              <h2 className="text-xl font-semibold text-center text-zinc-900 dark:text-zinc-100 mb-2">
                登入已過期
              </h2>

              {/* Description */}
              <p className="text-center text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed mb-2">
                您的登入狀態已過期，需要重新登入才能繼續操作。
              </p>
              <p className="text-center text-zinc-400 dark:text-zinc-500 text-xs mb-6">
                您的創作進度不會遺失，登入後即可繼續。
              </p>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleLogin}
                  className="w-full h-11 rounded-xl gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-md"
                >
                  <LogIn className="w-4 h-4" />
                  前往登入
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleDismiss}
                  className="w-full h-10 rounded-xl text-zinc-500 hover:text-zinc-700"
                >
                  稍後再說
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
