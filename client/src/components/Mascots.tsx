import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MASCOT_DIALOGUES } from "@shared/types";
import { useIsMobile } from "@/hooks/useMobile";

// ─── Idle Bear Mascot (Bottom-left, tracks mouse/scroll) ─────────────────────

export function IdleBear({ visible = true }: { visible?: boolean }) {
  const [dialogue, setDialogue] = useState<string>(MASCOT_DIALOGUES.idle[0]);
  const [eyePos, setEyePos] = useState({ x: 0, y: 0 });
  const [showBubble, setShowBubble] = useState(true);
  const isMobile = useIsMobile();
  const bearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * MASCOT_DIALOGUES.idle.length);
      setDialogue(MASCOT_DIALOGUES.idle[idx]);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isMobile) {
      const handleScroll = () => {
        const scrollY = window.scrollY;
        setEyePos({ x: 0, y: Math.min(scrollY / 100, 3) });
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => window.removeEventListener("scroll", handleScroll);
    } else {
      const handleMouseMove = (e: MouseEvent) => {
        if (!bearRef.current) return;
        const rect = bearRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = (e.clientX - centerX) / window.innerWidth * 6;
        const dy = (e.clientY - centerY) / window.innerHeight * 6;
        setEyePos({ x: Math.max(-3, Math.min(3, dx)), y: Math.max(-3, Math.min(3, dy)) });
      };
      window.addEventListener("mousemove", handleMouseMove);
      return () => window.removeEventListener("mousemove", handleMouseMove);
    }
  }, [isMobile]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={bearRef}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 left-4 z-50 flex items-end gap-2"
        onClick={() => {
          if (isMobile) {
            setShowBubble(!showBubble);
            const idx = Math.floor(Math.random() * MASCOT_DIALOGUES.idle.length);
            setDialogue(MASCOT_DIALOGUES.idle[idx]);
          }
        }}
      >
        {/* Bear SVG */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 cursor-pointer select-none">
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
            {/* Ears */}
            <circle cx="25" cy="22" r="14" fill="#D4C4A8" />
            <circle cx="75" cy="22" r="14" fill="#D4C4A8" />
            <circle cx="25" cy="22" r="8" fill="#EAC9C1" />
            <circle cx="75" cy="22" r="8" fill="#EAC9C1" />
            {/* Head */}
            <circle cx="50" cy="50" r="32" fill="#D4C4A8" />
            {/* Face */}
            <ellipse cx="50" cy="56" rx="18" ry="14" fill="#EAC9C1" opacity="0.6" />
            {/* Eyes */}
            <g transform={`translate(${eyePos.x}, ${eyePos.y})`}>
              <circle cx="38" cy="45" r="4" fill="#6C6C6C" />
              <circle cx="62" cy="45" r="4" fill="#6C6C6C" />
              <circle cx="39.5" cy="43.5" r="1.5" fill="white" />
              <circle cx="63.5" cy="43.5" r="1.5" fill="white" />
            </g>
            {/* Nose */}
            <ellipse cx="50" cy="55" rx="5" ry="3.5" fill="#C5A898" />
            {/* Mouth */}
            <path d="M 45 60 Q 50 65 55 60" fill="none" stroke="#C5A898" strokeWidth="1.5" strokeLinecap="round" />
            {/* Blush */}
            <circle cx="30" cy="55" r="5" fill="#EAC9C1" opacity="0.5" />
            <circle cx="70" cy="55" r="5" fill="#EAC9C1" opacity="0.5" />
          </svg>
        </div>

        {/* Speech bubble */}
        <AnimatePresence>
          {showBubble && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, x: -10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: -10 }}
              className="healing-card bg-white px-3 py-2 max-w-[200px] sm:max-w-[240px] text-xs sm:text-sm text-foreground leading-relaxed"
            >
              {dialogue}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Hover Bird Mascot (perches on hovered elements / bottom sheet on mobile) ─

export function HoverBird({
  show = false,
  message = "",
  position = { x: 0, y: 0 },
}: {
  show?: boolean;
  message?: string;
  position?: { x: number; y: number };
}) {
  const isMobile = useIsMobile();

  if (!show) return null;

  if (isMobile) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-0 left-0 right-0 z-50 bg-white healing-card rounded-b-none p-4 border-t"
        >
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 60 60" className="w-10 h-10 shrink-0">
              <ellipse cx="30" cy="32" rx="18" ry="16" fill="#C8D5E0" />
              <circle cx="30" cy="22" r="12" fill="#C8D5E0" />
              <circle cx="25" cy="20" r="2.5" fill="#6C6C6C" />
              <circle cx="35" cy="20" r="2.5" fill="#6C6C6C" />
              <circle cx="26" cy="19" r="1" fill="white" />
              <circle cx="36" cy="19" r="1" fill="white" />
              <path d="M 28 25 L 30 28 L 32 25" fill="#D4A5A5" />
              <ellipse cx="18" cy="35" rx="8" ry="4" fill="#C8D5E0" transform="rotate(-15 18 35)" />
              <ellipse cx="42" cy="35" rx="8" ry="4" fill="#C8D5E0" transform="rotate(15 42 35)" />
            </svg>
            <p className="text-sm text-foreground">{message}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="fixed z-50 pointer-events-none"
        style={{ left: position.x - 15, top: position.y - 45 }}
      >
        <svg viewBox="0 0 40 40" className="w-8 h-8 mascot-float">
          <ellipse cx="20" cy="22" rx="12" ry="10" fill="#C8D5E0" />
          <circle cx="20" cy="14" r="8" fill="#C8D5E0" />
          <circle cx="17" cy="13" r="1.5" fill="#6C6C6C" />
          <circle cx="23" cy="13" r="1.5" fill="#6C6C6C" />
          <path d="M 19 16 L 20 18 L 21 16" fill="#D4A5A5" />
        </svg>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Loading Rabbit Mascot (center, breathing + eye-rubbing) ─────────────────

export function LoadingRabbit({
  visible = false,
  message = "正在為你創作中...",
}: {
  visible?: boolean;
  message?: string;
}) {
  const [currentMessage, setCurrentMessage] = useState<string>(message);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * MASCOT_DIALOGUES.loading.length);
      setCurrentMessage(MASCOT_DIALOGUES.loading[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          {/* Rabbit SVG with breathing animation */}
          <div className="mascot-breathe w-28 h-28 sm:w-36 sm:h-36">
            <svg viewBox="0 0 120 140" className="w-full h-full drop-shadow-xl">
              {/* Ears */}
              <ellipse cx="42" cy="30" rx="10" ry="28" fill="#EAC9C1" />
              <ellipse cx="78" cy="30" rx="10" ry="28" fill="#EAC9C1" />
              <ellipse cx="42" cy="30" rx="6" ry="22" fill="#F5DDD5" />
              <ellipse cx="78" cy="30" rx="6" ry="22" fill="#F5DDD5" />
              {/* Body */}
              <ellipse cx="60" cy="100" rx="28" ry="25" fill="#F5EDE8" />
              {/* Head */}
              <circle cx="60" cy="68" r="28" fill="#F5EDE8" />
              {/* Eyes (with rub animation) */}
              <g className="mascot-eye-rub">
                <circle cx="48" cy="64" r="4" fill="#6C6C6C" />
                <circle cx="72" cy="64" r="4" fill="#6C6C6C" />
                <circle cx="49.5" cy="62.5" r="1.5" fill="white" />
                <circle cx="73.5" cy="62.5" r="1.5" fill="white" />
              </g>
              {/* Paws rubbing eyes */}
              <g className="mascot-eye-rub">
                <circle cx="38" cy="66" r="7" fill="#F5EDE8" opacity="0.8" />
                <circle cx="82" cy="66" r="7" fill="#F5EDE8" opacity="0.8" />
              </g>
              {/* Nose */}
              <ellipse cx="60" cy="73" rx="4" ry="3" fill="#D4A5A5" />
              {/* Mouth */}
              <path d="M 55 77 Q 60 81 65 77" fill="none" stroke="#D4A5A5" strokeWidth="1.5" strokeLinecap="round" />
              {/* Blush */}
              <circle cx="40" cy="74" r="5" fill="#EAC9C1" opacity="0.4" />
              <circle cx="80" cy="74" r="5" fill="#EAC9C1" opacity="0.4" />
              {/* Belly */}
              <ellipse cx="60" cy="102" rx="16" ry="14" fill="white" opacity="0.5" />
            </svg>
          </div>

          {/* Loading message */}
          <div className="healing-card bg-white px-6 py-3 text-center">
            <p className="text-sm sm:text-base text-foreground font-medium">{currentMessage}</p>
            <div className="flex justify-center gap-1 mt-2">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-primary/60"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.3 }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
