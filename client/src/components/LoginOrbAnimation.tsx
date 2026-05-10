/**
 * LoginOrbAnimation.tsx — 登入歡迎橫幅（輕量版）
 *
 * 之前是全螢幕 3D 光球 + 星空場景，但在手機上會直接擋住整個 dashboard，
 * 使用者必須等 6+ 秒（或猜到要點一下）才看得到主畫面。
 * 現在改成從頂端滑入的小橫幅：
 *   - 一顆會閃的星星 icon + 「歡迎回來」漸層文字 + 副標
 *   - 約 64px 高，置中靠上，dashboard 立即可見、可操作
 *   - 1.8 秒後自動滑出，總時長約 2.4 秒
 *   - 任何時候點擊或按 Esc 都能立即關掉
 *   - 尊重 prefers-reduced-motion（純淡入淡出）
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const HOLD_MS = 1800;
const SLIDE_MS = 0.45;
const Z_INDEX = 10050;

export default function LoginOrbAnimation() {
  const [show, setShow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Trigger when the OAuth callback redirected us with ?welcome=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;

    params.delete("welcome");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? `?${newSearch}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);

    setShow(true);
  }, []);

  const dismiss = useCallback(() => setShow(false), []);

  // Auto-dismiss after the hold window. Independently fired so a backgrounded
  // tab still hides the banner once it returns — the timer keeps ticking.
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(dismiss, HOLD_MS);
    return () => clearTimeout(t);
  }, [show, dismiss]);

  // Esc to dismiss.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, dismiss]);

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          aria-label="關閉歡迎訊息"
          onClick={dismiss}
          className="fixed left-1/2 top-4 sm:top-6"
          style={{
            zIndex: Z_INDEX,
            translateX: "-50%",
            // Pill that does NOT block the page; pointer-events stays default
            // so the user can dismiss by tapping the banner itself, but the
            // rest of the screen below is fully interactive immediately.
          }}
          initial={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -24, scale: 0.96 }
          }
          animate={
            reducedMotion
              ? { opacity: 1 }
              : { opacity: 1, y: 0, scale: 1 }
          }
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -16, scale: 0.98 }
          }
          transition={{ duration: SLIDE_MS, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className="flex items-center gap-3 rounded-full px-5 py-2.5 sm:px-6 sm:py-3"
            style={{
              background: "rgba(18, 16, 36, 0.72)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
              border: "1px solid rgba(220, 210, 255, 0.18)",
              boxShadow:
                "0 12px 40px rgba(8, 6, 24, 0.45), 0 0 0 1px rgba(255,255,255,0.04) inset",
            }}
          >
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,220,180,0.6) 50%, rgba(255,180,120,0.0) 100%)",
                boxShadow:
                  "0 0 12px rgba(255,210,160,0.85), 0 0 24px rgba(255,180,120,0.45)",
                animation: reducedMotion
                  ? undefined
                  : "hs-welcome-twinkle 1.6s ease-in-out infinite",
              }}
            />
            <span
              className="text-sm sm:text-[15px] font-medium tracking-[0.18em]"
              style={{
                background:
                  "linear-gradient(120deg, rgba(255,255,255,0.85) 0%, rgba(255,236,210,1) 50%, rgba(255,255,255,0.85) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              歡迎回來
            </span>
            <span
              aria-hidden
              className="hidden sm:inline-block h-3 w-px"
              style={{ background: "rgba(220, 210, 255, 0.22)" }}
            />
            <span
              className="hidden sm:inline-block text-xs tracking-[0.22em] font-light"
              style={{ color: "rgba(232, 224, 255, 0.62)" }}
            >
              Healing Studio
            </span>
          </div>
          <style>{`
            @keyframes hs-welcome-twinkle {
              0%, 100% { transform: scale(1); opacity: 0.95; }
              50%      { transform: scale(1.25); opacity: 1; }
            }
          `}</style>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
