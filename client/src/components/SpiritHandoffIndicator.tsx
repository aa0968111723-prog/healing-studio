/**
 * client/src/components/SpiritHandoffIndicator.tsx
 *
 * UI component showing spirit-to-spirit handoff transitions.
 * Displays: "{from spirit} 💡 → {to spirit} 🎨: handoff reason"
 * with animated transitions and spirit colors.
 */

import { motion, AnimatePresence } from "framer-motion";
import type { AgentRole } from "../../../shared/orb-agent-roles";
import { SPIRITS_BY_ID } from "@/lib/spiritsVisual";

// Visual data sourced from lib/spiritsVisual.ts — single source of truth
// shared with AgentChat 的 SPIRITS chip 與 ProactiveNotificationCenter。
// 之前在這裡內嵌一份 SPIRIT_VISUALS 結果與 source-of-truth 漂移
// (例：導導從 amber→blue) 而且只覆蓋部分精靈；改成直接讀 SPIRITS_BY_ID
// 即可保證 25 位精靈視覺一致且未來新增精靈時不需要在這同步維護。
const SPIRIT_VISUALS = SPIRITS_BY_ID;

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
