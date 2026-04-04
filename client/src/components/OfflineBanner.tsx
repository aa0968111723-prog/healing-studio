import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * OfflineBanner – a global top-of-page banner that appears when the browser
 * loses network connectivity.  It listens to the `online` / `offline` window
 * events and also checks `navigator.onLine` on mount.
 *
 * When the connection is restored it briefly shows a "back online" message
 * before sliding away.
 */
export default function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const [visible, setVisible] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setVisible(true);
      setShowReconnected(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowReconnected(true);
      // Keep the "reconnected" banner visible for 3 seconds then slide away
      setTimeout(() => {
        setVisible(false);
        // Reset state after animation completes
        setTimeout(() => setShowReconnected(false), 400);
      }, 3000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!visible && !isOffline) return null;

  return (
    <div
      className={cn(
        "fixed top-0 left-0 right-0 z-[9999] transition-all duration-400 ease-out",
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      )}
    >
      {isOffline ? (
        /* ── Offline state ── */
        <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 text-white text-sm font-medium shadow-lg">
          <WifiOff size={16} className="flex-shrink-0 animate-pulse" />
          <span>
            目前處於離線狀態，部分功能暫時無法使用。連線恢復後即可繼續創作
          </span>
        </div>
      ) : showReconnected ? (
        /* ── Reconnected state ── */
        <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500 text-white text-sm font-medium shadow-lg">
          <Wifi size={16} className="flex-shrink-0" />
          <span>網路已恢復連線，可以繼續創作了</span>
        </div>
      ) : null}
    </div>
  );
}
