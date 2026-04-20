/**
 * AgentFocusSpotlight.tsx — Phase 3b 光球「看這裡」視覺聚焦覆蓋層
 * ────────────────────────────────────────────────────────────────────────────
 * 訂閱 `usePageAgent().spotlight`：當 LLM 或頁面端呼叫
 *   - `dispatch({ type: "focusElement", elementId, message })`
 *   - `showSpotlight(elementId, message)`
 * 本元件會：
 *   1. 用 SVG 遮罩在目標 DOM 上打出柔和光環
 *   2. scrollIntoView，確保使用者看得到
 *   3. 如果有 message，在光環旁邊浮一張小說明泡泡
 *   4. 點背景 / 按 Esc / 超時（autoHideMs）自動消失
 *
 * 不會阻擋頁面互動（pointer-events 設到 auto 只在背景吸點擊）。
 * 若目標 elementId 不存在就安靜退出，不吵使用者。
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { usePageAgent } from "@/contexts/PageAgentContext";

const PADDING = 10;
const RADIUS = 14;

export default function AgentFocusSpotlight() {
  const { spotlight, dismissSpotlight } = usePageAgent();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);

  // Track target element's rect（scroll / resize / layout 後都要重算）
  useEffect(() => {
    if (!spotlight) {
      setRect(null);
      return;
    }

    let cancelled = false;
    const el = document.getElementById(spotlight.elementId);
    if (!el) {
      // 找不到目標直接取消這次 spotlight，不要傻停在那
      dismissSpotlight();
      return;
    }

    const compute = () => {
      if (cancelled) return;
      setRect(el.getBoundingClientRect());
    };

    // 先滾到中央（平滑）讓使用者看得到
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* 舊瀏覽器不支援 options，略過 */
    }

    compute();
    const interval = window.setInterval(compute, 400);
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [spotlight, dismissSpotlight]);

  // Esc 關閉
  useEffect(() => {
    if (!spotlight) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissSpotlight();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spotlight, dismissSpotlight]);

  const show = Boolean(spotlight && rect);

  return (
    <AnimatePresence>
      {show && spotlight && rect && (
        <motion.div
          key={spotlight.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
          className="fixed inset-0 z-[9980] pointer-events-none"
          aria-label="光球視覺聚焦"
          role="presentation"
        >
          {/* 點背景關閉；spotlight 本身 pointer-events-none */}
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={() => dismissSpotlight()}
          />
          <SpotlightSvg rect={rect} />
          {spotlight.message && (
            <SpotlightBubble rect={rect} message={spotlight.message} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── SVG spotlight 遮罩 ──────────────────────────────────────────────────────

function SpotlightSvg({ rect }: { rect: DOMRect }) {
  const x = rect.left - PADDING;
  const y = rect.top - PADDING;
  const w = rect.width + PADDING * 2;
  const h = rect.height + PADDING * 2;
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <mask id="agent-spotlight-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={RADIUS} ry={RADIUS} fill="black" />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(15, 23, 42, 0.45)"
        mask="url(#agent-spotlight-mask)"
      />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={RADIUS}
        ry={RADIUS}
        fill="none"
        stroke="rgba(167, 243, 208, 0.9)"
        strokeWidth="2"
      />
      <rect
        x={x - 3}
        y={y - 3}
        width={w + 6}
        height={h + 6}
        rx={RADIUS + 3}
        ry={RADIUS + 3}
        fill="none"
        stroke="rgba(125, 211, 252, 0.55)"
        strokeWidth="3"
      >
        <animate
          attributeName="opacity"
          values="0.25;0.75;0.25"
          dur="2s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

// ─── 訊息泡泡（放在光環下方，超出視窗就改放上方） ─────────────────────────────

function SpotlightBubble({ rect, message }: { rect: DOMRect; message: string }) {
  const bubbleW = Math.min(280, window.innerWidth - 32);
  const bubbleH = 86;
  const gap = 14;

  let top = rect.bottom + gap;
  let left = rect.left + rect.width / 2 - bubbleW / 2;
  const overflowsBottom = top + bubbleH > window.innerHeight - 16;
  if (overflowsBottom) {
    top = rect.top - bubbleH - gap;
  }
  left = Math.max(16, Math.min(window.innerWidth - bubbleW - 16, left));
  top = Math.max(16, top);

  return (
    <motion.div
      initial={{ opacity: 0, y: overflowsBottom ? 6 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      style={{ position: "fixed", top, left, width: bubbleW }}
      className="pointer-events-auto"
    >
      <div className="relative rounded-2xl border border-emerald-200/70 bg-white/95 backdrop-blur-xl shadow-xl shadow-emerald-500/10 overflow-hidden dark:border-emerald-400/30 dark:bg-slate-900/95">
        <div className="h-1 bg-gradient-to-r from-emerald-300 via-sky-300 to-fuchsia-300" />
        <div className="p-3 flex items-start gap-2">
          <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-300 to-sky-300 flex items-center justify-center shadow-inner">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-300">
              光球指一下這裡 🌿
            </p>
            <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-100 leading-relaxed">
              {message}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
