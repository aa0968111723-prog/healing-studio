/**
 * client/src/components/SpiritHandoffIndicator.tsx
 *
 * UI component showing spirit-to-spirit handoff transitions.
 * Displays: "{from spirit} 💡 → {to spirit} 🎨: handoff reason"
 * with animated transitions and spirit colors.
 */

import { motion, AnimatePresence } from "framer-motion";
import type { AgentRole } from "../../../shared/orb-agent-roles";

// Import spirit visual data
const SPIRIT_VISUALS: Record<
  AgentRole,
  { emoji: string; nickname: string; gradient: string }
> = {
  director: { emoji: "🎯", nickname: "導導", gradient: "from-blue-400 to-blue-600" },
  composer: { emoji: "✍️", nickname: "編編", gradient: "from-green-400 to-green-600" },
  critic: { emoji: "🔎", nickname: "品品", gradient: "from-purple-400 to-purple-600" },
  researcher: { emoji: "🧭", nickname: "查查", gradient: "from-yellow-400 to-orange-500" },
  navigator: { emoji: "🧳", nickname: "路路", gradient: "from-cyan-400 to-cyan-600" },
  companion: { emoji: "🌿", nickname: "暖暖", gradient: "from-pink-400 to-pink-600" },
  accountant: { emoji: "💰", nickname: "財財", gradient: "from-emerald-400 to-emerald-600" },
  "quality-coach": { emoji: "✨", nickname: "巧巧", gradient: "from-amber-400 to-amber-600" },
  inspector: { emoji: "🛡️", nickname: "守守", gradient: "from-slate-400 to-slate-600" },
  "image-specialist": { emoji: "🎨", nickname: "圖圖", gradient: "from-pink-500 to-rose-500" },
  "video-specialist": { emoji: "🎬", nickname: "影影", gradient: "from-indigo-500 to-purple-500" },
  "music-specialist": { emoji: "🎵", nickname: "音音", gradient: "from-violet-400 to-fuchsia-500" },
  "voice-specialist": { emoji: "🎙️", nickname: "聲聲", gradient: "from-blue-400 to-indigo-500" },
  "training-specialist": { emoji: "🧪", nickname: "練練", gradient: "from-orange-400 to-red-500" },
  "learning-specialist": { emoji: "📚", nickname: "學學", gradient: "from-teal-400 to-cyan-500" },
  "legal-advisor": { emoji: "⚖️", nickname: "律律", gradient: "from-gray-500 to-slate-600" },
  "security-guard": { emoji: "🔒", nickname: "安安", gradient: "from-red-500 to-rose-600" },
  "community-manager": { emoji: "📣", nickname: "群群", gradient: "from-sky-400 to-blue-500" },
  "chief-orchestrator": { emoji: "🎩", nickname: "總總", gradient: "from-indigo-600 to-purple-700" },
  "onboarding-coach": { emoji: "🤝", nickname: "帶帶", gradient: "from-green-400 to-emerald-500" },
  "notes-curator": { emoji: "📒", nickname: "記記", gradient: "from-amber-400 to-yellow-500" },
  "settings-detail": { emoji: "⚙️", nickname: "細細", gradient: "from-gray-400 to-slate-500" },
  "plan-executor": { emoji: "🧩", nickname: "步步", gradient: "from-blue-500 to-indigo-600" },
  "inspiration-specialist": { emoji: "💡", nickname: "靈靈", gradient: "from-yellow-300 to-orange-400" },
  "anatomy-specialist": { emoji: "🫀", nickname: "體體", gradient: "from-red-400 to-pink-500" },
};

interface SpiritHandoffIndicatorProps {
  fromSpirit: AgentRole;
  toSpirit: AgentRole;
  reason: string;
  when?: string;
  onComplete?: () => void;
}

export function SpiritHandoffIndicator({
  fromSpirit,
  toSpirit,
  reason,
  when,
  onComplete,
}: SpiritHandoffIndicatorProps) {
  const fromVisual = SPIRIT_VISUALS[fromSpirit];
  const toVisual = SPIRIT_VISUALS[toSpirit];

  return (
    <AnimatePresence mode="wait" onExitComplete={onComplete}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="relative flex items-center gap-3 rounded-lg border border-gray-200 bg-gradient-to-r from-gray-50 to-white p-4 shadow-sm dark:border-gray-700 dark:from-gray-800 dark:to-gray-900"
      >
        {/* From Spirit */}
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 0.5, times: [0, 0.5, 1] }}
          className="flex shrink-0 items-center gap-2"
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${fromVisual.gradient} text-white shadow-md`}
          >
            <span className="text-lg">{fromVisual.emoji}</span>
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {fromVisual.nickname}
          </span>
        </motion.div>

        {/* Arrow Animation */}
        <motion.div
          initial={{ x: -10, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex shrink-0 items-center"
        >
          <svg
            className="h-6 w-6 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
        </motion.div>

        {/* To Spirit */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="flex shrink-0 items-center gap-2"
        >
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${toVisual.gradient} text-white shadow-md ring-2 ring-white dark:ring-gray-800`}
          >
            <span className="text-lg">{toVisual.emoji}</span>
          </div>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {toVisual.nickname}
          </span>
        </motion.div>

        {/* Handoff Reason */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="flex-1"
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {reason}
          </p>
          {when && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
              {when}
            </p>
          )}
        </motion.div>

        {/* Pulse indicator */}
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute right-2 top-2 h-2 w-2 rounded-full bg-green-500"
        />
      </motion.div>
    </AnimatePresence>
  );
}

interface SpiritHandoffChainProps {
  handoffs: Array<{
    fromSpirit: AgentRole;
    toSpirit: AgentRole;
    reason: string;
    when?: string;
  }>;
  currentIndex: number;
}

/**
 * Display a chain of spirit handoffs with progress indicator.
 * Shows completed, current, and upcoming handoffs.
 */
export function SpiritHandoffChain({ handoffs, currentIndex }: SpiritHandoffChainProps) {
  return (
    <div className="space-y-3">
      {handoffs.map((handoff, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isUpcoming = index > currentIndex;

        return (
          <div
            key={`${handoff.fromSpirit}-${handoff.toSpirit}-${index}`}
            className={`relative ${
              isCompleted ? "opacity-60" : isCurrent ? "opacity-100" : "opacity-40"
            }`}
          >
            {isCurrent && (
              <SpiritHandoffIndicator
                fromSpirit={handoff.fromSpirit}
                toSpirit={handoff.toSpirit}
                reason={handoff.reason}
                when={handoff.when}
              />
            )}
            {!isCurrent && (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <span className="text-xs text-gray-500">
                  {SPIRIT_VISUALS[handoff.fromSpirit].emoji}{" "}
                  {SPIRIT_VISUALS[handoff.fromSpirit].nickname} →{" "}
                  {SPIRIT_VISUALS[handoff.toSpirit].emoji}{" "}
                  {SPIRIT_VISUALS[handoff.toSpirit].nickname}
                </span>
                {isCompleted && (
                  <span className="ml-auto text-xs text-green-600 dark:text-green-400">
                    ✓ 完成
                  </span>
                )}
                {isUpcoming && (
                  <span className="ml-auto text-xs text-gray-400">待處理</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
