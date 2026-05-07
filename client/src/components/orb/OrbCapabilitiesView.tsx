import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Play } from "lucide-react";
import {
  CREATIVE_CAPABILITIES,
  type CreativeCapability,
} from "@/data/creativeCapabilities";

interface Props {
  /** Called when the user clicks "試用" on a capability card. The parent
   *  is responsible for auth-gating, navigation, and closing the panel. */
  onTryCapability: (capability: CreativeCapability) => void;
  /** Compact mode trims paddings for the desktop side panel. */
  compact?: boolean;
}

const cubic = [0.16, 1, 0.3, 1] as const;

export default function OrbCapabilitiesView({
  onTryCapability,
  compact = false,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [expandedId, setExpandedId] = useState<string | null>(
    CREATIVE_CAPABILITIES[0]?.id ?? null
  );

  return (
    <div
      className={
        compact
          ? "px-4 pb-4 space-y-2"
          : "px-5 pb-5 space-y-2.5"
      }
    >
      <div className="flex items-start gap-2 mb-1">
        <Play
          className={`mt-0.5 shrink-0 text-purple-500 ${compact ? "w-3.5 h-3.5" : "w-4 h-4"}`}
        />
        <p
          className={`leading-relaxed text-gray-500 ${compact ? "text-xs" : "text-sm"}`}
        >
          選一個方向，光球帶你直接進入工作室。
        </p>
      </div>

      {CREATIVE_CAPABILITIES.map((cap, idx) => {
        const isOpen = expandedId === cap.id;
        const Icon = cap.icon;
        return (
          <motion.div
            key={cap.id}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.45,
              delay: reduceMotion ? 0 : idx * 0.04,
              ease: cubic,
            }}
            className="relative rounded-xl overflow-hidden border bg-white/70"
            style={{
              borderColor: isOpen
                ? `${cap.accentColor}55`
                : "rgba(0,0,0,0.06)",
              boxShadow: isOpen
                ? `0 8px 24px ${cap.accentColor}1f`
                : "0 1px 2px rgba(0,0,0,0.03)",
              transition: "border-color 0.4s, box-shadow 0.4s",
            }}
          >
            {/* Accent glow background — only visible when expanded */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(circle at 0% 0%, ${cap.accentColor}1c 0%, transparent 60%)`,
              }}
              animate={{ opacity: isOpen ? 1 : 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />

            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : cap.id)}
              aria-expanded={isOpen}
              className={`group relative w-full flex items-center gap-3 text-left ${
                compact ? "px-3 py-2.5" : "px-3.5 py-3"
              }`}
            >
              {/* Hover sheen sweep */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-[1100ms] ease-out"
                style={{
                  background: `linear-gradient(115deg, transparent 30%, ${cap.accentColor}1f 50%, transparent 70%)`,
                }}
              />
              <motion.div
                className={`relative shrink-0 rounded-lg flex items-center justify-center ${
                  compact ? "w-9 h-9" : "w-10 h-10"
                }`}
                style={{
                  background: `${cap.accentColor}18`,
                  border: `1px solid ${cap.accentColor}26`,
                }}
                animate={
                  isOpen
                    ? { scale: [1, 1.08, 1], rotate: [0, 3, 0] }
                    : { scale: 1, rotate: 0 }
                }
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              >
                <Icon
                  className={compact ? "w-4 h-4" : "w-4.5 h-4.5"}
                  style={{ color: cap.accentColor }}
                />
              </motion.div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className={`font-semibold text-gray-800 truncate ${
                      compact ? "text-sm" : "text-[15px]"
                    }`}
                  >
                    {cap.title}
                  </p>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] tracking-wider uppercase font-medium"
                    style={{
                      color: cap.accentColor,
                      background: `${cap.accentColor}14`,
                      border: `1px solid ${cap.accentColor}22`,
                    }}
                  >
                    {cap.tag}
                  </span>
                </div>
                <p
                  className={`text-gray-500 leading-snug truncate ${
                    compact ? "text-[11px]" : "text-xs"
                  }`}
                >
                  {cap.description}
                </p>
              </div>
              <motion.div
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: cubic }}
                className="shrink-0 text-gray-400"
              >
                <ChevronDown className={compact ? "w-4 h-4" : "w-4 h-4"} />
              </motion.div>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="expanded"
                  initial={
                    reduceMotion
                      ? { opacity: 0 }
                      : { height: 0, opacity: 0 }
                  }
                  animate={
                    reduceMotion
                      ? { opacity: 1 }
                      : { height: "auto", opacity: 1 }
                  }
                  exit={
                    reduceMotion
                      ? { opacity: 0 }
                      : { height: 0, opacity: 0 }
                  }
                  transition={{ duration: 0.45, ease: cubic }}
                  className="overflow-hidden"
                >
                  <div
                    className={`relative ${compact ? "px-3.5 pb-3" : "px-4 pb-4"}`}
                  >
                    <p
                      className={`text-gray-600 leading-relaxed mb-3 ${
                        compact ? "text-[12px]" : "text-[13px]"
                      }`}
                    >
                      {cap.longDescription}
                    </p>
                    <ul className="space-y-1.5 mb-3">
                      {cap.features.map((feat, i) => (
                        <li
                          key={i}
                          className={`flex items-start gap-2 text-gray-600 ${
                            compact ? "text-[11px]" : "text-xs"
                          }`}
                        >
                          <Check
                            className="mt-0.5 shrink-0"
                            style={{
                              color: cap.accentColor,
                              width: compact ? 12 : 13,
                              height: compact ? 12 : 13,
                            }}
                          />
                          <span className="leading-snug">{feat}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => onTryCapability(cap)}
                      className={`group relative w-full inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-all hover:shadow-md ${
                        compact ? "py-1.5 text-xs" : "py-2 text-[13px]"
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${cap.accentColor}1f, ${cap.accentColor}0a)`,
                        border: `1px solid ${cap.accentColor}3a`,
                        color: cap.accentColor,
                      }}
                    >
                      <Play
                        className={compact ? "w-3 h-3" : "w-3.5 h-3.5"}
                        style={{ fill: "currentColor" }}
                      />
                      <span>進入 {cap.title}</span>
                      <ArrowRight
                        className={`transition-transform group-hover:translate-x-0.5 ${
                          compact ? "w-3 h-3" : "w-3.5 h-3.5"
                        }`}
                      />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
